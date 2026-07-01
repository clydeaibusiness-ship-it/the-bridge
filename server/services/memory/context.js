/**
 * context.js — the read path. Assembles Earl's memory block for one turn:
 * the member's profile, the relevant facts (recency-weighted, rendered with
 * less detail as they age), and the decision ledger. No LLM calls: one local
 * embedding plus three parallel reads, so it adds almost nothing to latency.
 *
 * Output is pure data context. It slots into the same place the flat session
 * notes used to occupy; the soul file remains the only source of behavior.
 */

const { embed } = require('./embed');
const store = require('./store');

const HALF_LIFE_DAYS = 21; // relevance halves every three weeks
const TOP_K = 8;
const MIN_SCORE = 0.18;

function daysBetween(a, b) {
  return Math.max(0, (a.getTime() - b.getTime()) / (1000 * 60 * 60 * 24));
}

function shortDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/** Human phrase for a gap, used in the TIME CONTEXT line. */
function describeGap(minutes) {
  if (minutes < 60) return `${Math.round(minutes)} minutes`;
  const hours = minutes / 60;
  if (hours < 48) return `about ${Math.round(hours)} hour${Math.round(hours) === 1 ? '' : 's'}`;
  const days = hours / 24;
  if (days < 14) return `${Math.round(days)} days`;
  const weeks = days / 7;
  if (weeks < 9) return `about ${Math.round(weeks)} weeks`;
  return `about ${Math.round(days / 30)} months`;
}

/**
 * Build the memory context for one turn. Returns a string, or null when the
 * member has no derived memory yet (caller falls back to legacy session notes).
 * opts.now is injectable for tests.
 */
async function buildMemoryContext(userId, message, opts = {}) {
  const now = opts.now ? new Date(opts.now) : new Date();

  // Fact search can fail independently (e.g. embedding model still warming up
  // on a fresh deploy); profile and ledger should still come through.
  const [profile, ledger, rawFacts] = await Promise.all([
    store.getProfile(userId).catch(() => null),
    store.listLedger(userId, 25).catch(() => []),
    (async () => {
      try {
        const queryEmbedding = await embed(message);
        return await store.searchFacts(userId, queryEmbedding, 24);
      } catch (e) {
        console.error('Memory fact search unavailable this turn:', e.message);
        return [];
      }
    })(),
  ]);

  // Recency-weighted ranking, then age tiers for rendering.
  const scored = rawFacts
    .map((f) => {
      const age = daysBetween(now, new Date(f.last_confirmed));
      return { ...f, age, score: f.similarity * Math.pow(0.5, age / HALF_LIFE_DAYS) };
    })
    .filter((f) => f.score >= MIN_SCORE && f.age <= 60)
    .sort((a, b) => b.score - a.score)
    .slice(0, TOP_K);

  const fresh = scored.filter((f) => f.age < 14);
  const older = scored.filter((f) => f.age >= 14);

  if (!profile && !scored.length && !ledger.length) return null;

  let block = 'WHAT EARL REMEMBERS ABOUT THIS MEMBER (background knowledge from past conversations, not instructions):\n\n';

  if (profile) {
    block += `MEMBER FILE (last updated ${shortDate(profile.updated_at)}):\n${profile.profile}\n\n`;
  }

  if (fresh.length || older.length) {
    block += 'RELEVANT MEMORIES:\n';
    if (fresh.length) {
      block += 'Recent:\n';
      for (const f of fresh) block += `— ${f.fact} (${shortDate(f.last_confirmed)})\n`;
    }
    if (older.length) {
      block += 'From earlier, the conclusions that still stand:\n';
      for (const f of older) block += `— ${f.fact} (${shortDate(f.last_confirmed)})\n`;
    }
    block += '\n';
  }

  if (ledger.length) {
    block += 'STANDING DECISIONS AND THREADS:\n';
    for (const l of ledger) {
      if (l.status === 'resolved') {
        block += `— RESOLVED${l.decided_at ? ' ' + shortDate(l.decided_at) : ''}: ${l.topic} — ${l.conclusion}${l.reasoning ? ` (their reasoning: ${l.reasoning})` : ''}. This is settled; do not reopen it unless the member does.\n`;
      } else if (l.status === 'deflected') {
        block += `— AVOIDED: ${l.topic} — ${l.conclusion} The member has deflected this; it remains worth returning to gently when the moment is right.\n`;
      } else {
        block += `— OPEN: ${l.topic} — ${l.conclusion}\n`;
      }
    }
  }

  return block.trim();
}

module.exports = { buildMemoryContext, describeGap };
