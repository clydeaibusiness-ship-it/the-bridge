/**
 * jobs.js — the actual generate / send / purge work, plus Central-time date
 * logic. Both the in-process scheduler and the cron HTTP endpoints call these,
 * so there is one source of truth.
 *
 * Everything is reckoned in America/Chicago. Mondays look back three days
 * (not two), so across Mon/Wed/Fri all seven days of news are covered:
 * Fri reaches Wed-Fri, Wed reaches Mon-Wed, Mon reaches the Sat-Sun-Mon gap.
 */

const store = require('./store');
const { generateCandidates } = require('./index');
const { sendIssueToList } = require('./send');
const { markUsed } = require('./library');

const SEND_DAYS = [1, 3, 5]; // Mon, Wed, Fri

/** Current wall-clock in America/Chicago, broken into parts. */
function chicagoNow(date = new Date()) {
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    year: 'numeric', month: '2-digit', day: '2-digit',
    weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  });
  const p = f.formatToParts(date).reduce((a, x) => ((a[x.type] = x.value), a), {});
  const wd = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[p.weekday];
  return {
    year: +p.year, month: +p.month, day: +p.day,
    weekday: wd, hour: +p.hour, minute: +p.minute,
    dateStr: `${p.year}-${p.month}-${p.day}`,
  };
}

/** Next Mon/Wed/Fri strictly after today (Central), as YYYY-MM-DD. */
function nextSendDate(date = new Date()) {
  const c = chicagoNow(date);
  // Anchor at noon UTC so day-stepping is immune to DST.
  const anchor = new Date(Date.UTC(c.year, c.month - 1, c.day, 12));
  do {
    anchor.setUTCDate(anchor.getUTCDate() + 1);
  } while (!SEND_DAYS.includes(anchor.getUTCDay()));
  return anchor.toISOString().slice(0, 10);
}

/** Monday reaches back 3 days; Wed/Fri reach back 2. */
function timespanForSendDate(sendDate) {
  const d = new Date(sendDate + 'T12:00:00Z');
  return d.getUTCDay() === 1 ? '3d' : '2d';
}

function slugify(s) {
  return String(s || 'issue').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
}

/** Build the three candidates for the next send date (evening-before job). */
async function runGenerate() {
  const sendDate = nextSendDate();
  const existing = await store.getDraftForSendDate(sendDate);
  if (existing) return { status: 'exists', runId: existing.id, sendDate };
  const timespan = timespanForSendDate(sendDate);
  const { candidates, research } = await generateCandidates({ count: 3, timespan });
  if (!candidates.length) return { status: 'empty', sendDate, research };
  const run = await store.createRun({ sendDate, candidates, research });
  return { status: 'generated', runId: run.id, sendDate, timespan };
}

/** Finalize and send today's due run (morning job). */
async function runSend() {
  const today = chicagoNow().dateStr;
  const run = await store.getDueRun(today);
  if (!run) return { status: 'nothing-due', date: today };

  const idx = Number.isInteger(run.locked_index) ? run.locked_index : 0;
  const cand = run.candidates?.[idx];
  if (!cand) return { status: 'no-candidate' };

  const iss = cand.issue || {};
  const story = cand.story || {};
  const resource = cand.resourceChosen || null;
  const now = new Date();
  const publishAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  const issue = await store.createIssue({
    run_id: run.id,
    subject: iss.subject,
    section1: iss.section1,
    section2: iss.section2,
    section3: iss.section3,
    resource,
    principle: cand.principle,
    story: { headline: story.headline, categoryLabel: story.categoryLabel },
    sources: story.sources,
    score: cand.score,
    slug: `${slugify(story.headline || iss.subject)}-${today}`,
    send_date: today,
    sent_at: now.toISOString(),
    publish_at: publishAt.toISOString(),
    published: false,
  });

  if (resource && resource.id) { try { markUsed(resource.id, now.toISOString()); } catch (_) {} }

  const subscribers = await store.getActiveSubscribers();
  const result = await sendIssueToList({ issue, sources: story.sources, resourceChosen: resource, subscribers });
  await store.markRunSent(run.id);
  return { status: 'sent', issueId: issue.id, slug: issue.slug, recipients: result.sent, failed: result.failed };
}

/** Daily: purge 15-day-old research, publish archive issues whose delay elapsed. */
async function runPurge() {
  const purged = await store.purgeExpiredRuns();
  const published = await store.publishDueIssues();
  return { purged, published };
}

module.exports = { chicagoNow, nextSendDate, timespanForSendDate, slugify, runGenerate, runSend, runPurge, SEND_DAYS };
