/**
 * jobs.js — generate / send / purge work plus Central-time scheduling logic.
 *
 * Everything is reckoned in America/Chicago.
 * Mondays look back 3 days; Wed/Fri look back 2, so all 7 days are covered.
 *
 * Window logic (used by the admin page):
 *   OPEN    — 7pm CT eve before send day through 6:30am CT send day
 *   LOCKED  — 6:30am–7:00am CT send day (auto-sends at 7am, no editing)
 *   CLOSED  — all other times
 *
 * The first FAST_TRACK_COUNT issues publish immediately to the archive (no
 * 7-day delay) so the archive fills up from day one.
 */

const store = require('./store');
const { generateCandidates } = require('./index');
const { sendIssueToList } = require('./send');
const { markUsed } = require('./library');

const SEND_DAYS = [1, 3, 5];   // Mon, Wed, Fri
const GEN_DAYS  = [0, 2, 4];   // Sun, Tue, Thu (evening before each send)
const FAST_TRACK_COUNT = 6;    // first N issues publish to archive immediately

// ---- Central-time helpers ----

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
    dateStr: `${p.year}-${p.month.toString().padStart(2,'0')}-${p.day.toString().padStart(2,'0')}`,
  };
}

/** Next Mon/Wed/Fri strictly after today (Central), as YYYY-MM-DD. */
function nextSendDate(date = new Date()) {
  const c = chicagoNow(date);
  const anchor = new Date(Date.UTC(c.year, c.month - 1, c.day, 12));
  do { anchor.setUTCDate(anchor.getUTCDate() + 1); }
  while (!SEND_DAYS.includes(anchor.getUTCDay()));
  return anchor.toISOString().slice(0, 10);
}

/** Monday reaches back 3 days; Wed/Fri reach back 2. */
function timespanForSendDate(sendDate) {
  const d = new Date(sendDate + 'T12:00:00Z');
  return d.getUTCDay() === 1 ? '3d' : '2d';
}

/**
 * The current admin window state and the next send date/time.
 * Returns { state: 'open'|'locked'|'closed', nextSend, minutesUntilSend }
 */
function windowState(date = new Date()) {
  const c = chicagoNow(date);
  const mins = c.hour * 60 + c.minute;
  const OPEN_START  = 19 * 60;       // 7:00pm
  const LOCK_START  = 6 * 60 + 30;   // 6:30am
  const SEND_TIME   = 7 * 60;        // 7:00am

  // Gen-day evening: window open from 7pm to midnight
  if (GEN_DAYS.includes(c.weekday) && mins >= OPEN_START) {
    return { state: 'open', nextSend: nextSendDate(date) };
  }
  // Send-day: locked 6:30–7am, open midnight–6:30am
  if (SEND_DAYS.includes(c.weekday)) {
    if (mins < LOCK_START) return { state: 'open',   nextSend: c.dateStr };
    if (mins < SEND_TIME)  return { state: 'locked', nextSend: c.dateStr,
      minutesUntilSend: SEND_TIME - mins };
  }
  return { state: 'closed', nextSend: nextSendDate(date) };
}

function slugify(s) {
  return String(s || 'issue').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
}

// ---- Jobs ----

/** Build the three candidates for the next send date. */
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

/** Finalize and send today's due run. */
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

  // First FAST_TRACK_COUNT issues publish immediately to fill the archive.
  // After that, the normal 7-day delay applies.
  const sentCount = await store.countSentIssues();
  const publishAt = sentCount < FAST_TRACK_COUNT
    ? now
    : new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const publishedNow = sentCount < FAST_TRACK_COUNT;

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
    published: publishedNow,
  });

  if (resource && resource.id) { try { markUsed(resource.id, now.toISOString()); } catch (_) {} }

  const subscribers = await store.getActiveSubscribers();
  const result = await sendIssueToList({ issue, sources: story.sources, resourceChosen: resource, subscribers });
  await store.markRunSent(run.id);

  // Say what happened, out loud. A send that quietly reaches nobody looks
  // identical to a send that worked, and the owner finds out days later.
  try {
    const { sendOwnerAlert } = require('../alert');
    if (result.failed > 0 || result.sent === 0) {
      sendOwnerAlert(
        'newsletter-send',
        `Newsletter delivery problem: ${result.sent} sent, ${result.failed} failed`,
        `Issue: ${issue.subject}\nSlug: ${issue.slug}\nSubscribers on the list: ${subscribers.length}\nDelivered: ${result.sent}\nFailed: ${result.failed}${result.error ? '\nError: ' + result.error : ''}`
      );
    }
  } catch (_) { /* never let alerting break the send */ }

  return { status: 'sent', issueId: issue.id, slug: issue.slug, recipients: result.sent, failed: result.failed };
}

/** Daily: purge 15-day-old research, publish archive issues whose delay elapsed. */
async function runPurge() {
  const purged = await store.purgeExpiredRuns();
  const published = await store.publishDueIssues();
  return { purged, published };
}

/** Hourly: flip any issue whose seven-day archive delay has elapsed. */
async function runPublish() {
  const published = await store.publishDueIssues();
  return published ? { published } : null; // stay quiet when there is nothing to do
}

module.exports = {
  chicagoNow, nextSendDate, timespanForSendDate, slugify,
  windowState, SEND_DAYS, GEN_DAYS, FAST_TRACK_COUNT,
  runGenerate, runSend, runPurge, runPublish,
};
