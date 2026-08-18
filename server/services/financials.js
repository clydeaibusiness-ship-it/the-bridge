/**
 * Earl's read of the owner's self-reported numbers.
 *
 * REAL DATA ONLY. Every remark is derived strictly from the figures the owner
 * entered. Nothing is invented, estimated, or plugged. The only questions Earl
 * is allowed to ask here are nudges to fill in a blank or to refresh a picture
 * that has gone a month stale — never a probing question.
 */

const FIELDS = [
  { key: 'revenue', label: 'monthly income' },
  { key: 'expenses', label: 'monthly expenses' },
  { key: 'cash', label: 'cash on hand' },
  { key: 'debt', label: 'debt' },
];

function num(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(String(v).replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function normalize(input) {
  input = input || {};
  return {
    revenue: num(input.revenue),
    expenses: num(input.expenses),
    cash: num(input.cash),
    debt: num(input.debt),
    updatedAt: input.updatedAt || null,
  };
}

function fmt(n) {
  return '$' + Math.round(n).toLocaleString('en-US');
}

function daysSince(iso) {
  if (!iso) return null;
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
}

/**
 * One short sentence, in Earl's voice, about where the numbers put them.
 * Returns "" only if the input is unusable.
 */
function computeRemark(fin) {
  const f = normalize(fin);
  const missing = FIELDS.filter((x) => f[x.key] === null);

  // Nothing entered — invite them in.
  if (missing.length === FIELDS.length) {
    return "Add your numbers and I'll tell you where you actually stand.";
  }

  // Some blanks — nudge to fill them (an allowed prompt).
  if (missing.length > 0) {
    const names = missing.map((m) => m.label);
    const list =
      names.length === 1
        ? names[0]
        : names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1];
    return `Add your ${list} so I can read this properly.`;
  }

  // A month stale — nudge to update (an allowed prompt).
  const stale = daysSince(f.updatedAt);
  if (stale !== null && stale >= 30) {
    return "It's been about a month. Update these so your read stays honest.";
  }

  const margin = f.revenue - f.expenses;

  if (margin < 0) {
    const burn = f.expenses - f.revenue;
    if (f.cash > 0 && burn > 0) {
      const months = f.cash / burn;
      if (months < 3) {
        const span = months < 1 ? 'a few weeks' : Math.round(months) + ' months';
        return `You're running short. At this pace your cash lasts about ${span}.`;
      }
      return `You're spending more than you bring in, but your cash still covers about ${Math.round(months)} months.`;
    }
    return "You're spending more than you're bringing in right now.";
  }

  if (margin === 0) {
    return 'You are breaking even. Every extra dollar of income becomes breathing room.';
  }

  if (f.debt > 0 && f.debt > margin * 6) {
    return 'You are profitable each month, though the debt is heavy against what you keep.';
  }

  return `You're keeping about ${fmt(margin)} a month after expenses. That's the right direction.`;
}

module.exports = { normalize, computeRemark, FIELDS };
