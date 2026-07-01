/**
 * worker.js — in-process memory worker, same pattern as the newsletter
 * scheduler. Three duties:
 *
 *   Sweep    every 15 min: find sessions that ended (30+ min quiet) and
 *            queue them for derivation. The queue lives in the database, so
 *            a deploy mid-derivation loses nothing.
 *   Drain    every minute: derive queued sessions into facts + ledger.
 *   Reflect  daily 03:30 CT: rewrite the profile file of every member whose
 *            memory changed in the last day.
 *
 * Off by default. dev and prod share one database, so set MEMORY_WORKER=on
 * only where derivation should run; outbox rows are env-tagged and each
 * worker only touches rows from its own environment.
 */

const store = require('./store');
const { deriveSession, refreshProfile } = require('./derive');
const { chicagoNow } = require('../newsletter/jobs');

const SESSION_END_MINUTES = 30; // must match the session boundary in api.js

let timer = null;
let ticks = 0;
const fired = new Set();

async function drain() {
  const pending = await store.fetchPending(2);
  for (const row of pending) {
    try {
      const result = await deriveSession(row.user_id, row.session_id);
      await store.markProcessed(row.id);
      console.log('[memory] derived session', row.session_id, JSON.stringify(result));
    } catch (e) {
      await store.markFailed(row.id, row.attempts, e.message);
      console.error('[memory] derivation failed for session', row.session_id, e.message);
    }
  }
}

/** Queue any session that ended without being derived yet. */
async function sweep() {
  const since = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
  const messages = await store.recentMessagesForSweep(since);
  const sessions = new Map(); // session_id -> { userId, lastAt, count }
  for (const m of messages) {
    if (!m.session_id) continue;
    const s = sessions.get(m.session_id) || { userId: m.user_id, lastAt: m.created_at, count: 0 };
    s.count++;
    if (m.created_at > s.lastAt) s.lastAt = m.created_at;
    sessions.set(m.session_id, s);
  }
  const cutoff = Date.now() - SESSION_END_MINUTES * 60 * 1000;
  let queued = 0;
  for (const [sessionId, s] of sessions) {
    if (new Date(s.lastAt).getTime() > cutoff) continue; // still live
    if (s.count < 4) continue; // too short to be worth deriving
    if (await store.outboxHasSession(s.userId, sessionId)) continue;
    try {
      await store.enqueueSession(s.userId, sessionId);
      queued++;
    } catch (e) {
      console.error('[memory] enqueue failed:', e.message);
    }
  }
  if (queued) console.log(`[memory] sweep queued ${queued} session(s)`);
}

/** Nightly: refresh the profile of everyone whose memory moved in 24h. */
async function reflect() {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const userIds = await store.usersProcessedSince(since);
  for (const userId of userIds) {
    try {
      const updated = await refreshProfile(userId);
      if (updated) console.log('[memory] profile refreshed for', userId);
    } catch (e) {
      console.error('[memory] profile refresh failed for', userId, e.message);
    }
  }
}

function tick() {
  ticks++;
  drain().catch((e) => console.error('[memory] drain error:', e.message));
  if (ticks % 15 === 0) sweep().catch((e) => console.error('[memory] sweep error:', e.message));

  const c = chicagoNow();
  if (c.hour === 3 && c.minute >= 30 && c.minute < 35) {
    const key = 'reflect-' + c.dateStr;
    if (!fired.has(key)) {
      fired.add(key);
      if (fired.size > 60) fired.clear();
      reflect().catch((e) => console.error('[memory] reflect error:', e.message));
    }
  }
}

function start() {
  if (process.env.MEMORY_WORKER !== 'on') {
    console.log('[memory] worker disabled (set MEMORY_WORKER=on to enable)');
    return;
  }
  if (timer) return;
  timer = setInterval(tick, 60 * 1000);
  console.log(`[memory] worker started (env: ${store.ENV}) — drain 1m, sweep 15m, reflect 03:30 CT`);
}

module.exports = { start };
