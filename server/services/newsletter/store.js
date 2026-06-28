/**
 * store.js — Supabase persistence for the newsletter. Reuses the product's
 * service-role client. Runs hold the three candidates for the edit window;
 * issues hold what was finalized and sent (and later published to the archive).
 */

const { getClient } = require('../supabase');

// ---- Runs (the 3-candidate edit window) ----

async function createRun({ sendDate, candidates, research }) {
  const db = getClient();
  if (!db) return null;
  const { data, error } = await db
    .from('newsletter_runs')
    .insert({ send_date: sendDate, candidates, research })
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function getRun(id) {
  const db = getClient();
  if (!db) return null;
  const { data, error } = await db.from('newsletter_runs').select('*').eq('id', id).single();
  if (error) return null;
  return data;
}

/** Latest draft run (what the admin page shows by default). */
async function getLatestDraft() {
  const db = getClient();
  if (!db) return null;
  const { data, error } = await db
    .from('newsletter_runs')
    .select('*')
    .eq('status', 'draft')
    .order('created_at', { ascending: false })
    .limit(1);
  if (error || !data?.length) return null;
  return data[0];
}

/** The draft due to send on a given date, if any. */
async function getDraftForSendDate(sendDate) {
  const db = getClient();
  if (!db) return null;
  const { data, error } = await db
    .from('newsletter_runs')
    .select('*')
    .eq('status', 'draft')
    .eq('send_date', sendDate)
    .order('created_at', { ascending: false })
    .limit(1);
  if (error || !data?.length) return null;
  return data[0];
}

/** Save the whole candidates array (used for edits) and/or the lock index. */
async function updateRun(id, patch) {
  const db = getClient();
  if (!db) return null;
  const { data, error } = await db.from('newsletter_runs').update(patch).eq('id', id).select().single();
  if (error) throw error;
  return data;
}

// ---- Issues (finalized + archive) ----

async function createIssue(issue) {
  const db = getClient();
  if (!db) return null;
  const { data, error } = await db.from('newsletter_issues').insert(issue).select().single();
  if (error) throw error;
  return data;
}

async function listIssues({ limit = 50 } = {}) {
  const db = getClient();
  if (!db) return [];
  const { data, error } = await db
    .from('newsletter_issues')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) return [];
  return data;
}

/** Purge research older than 15 days; the finalized issues are untouched. */
async function purgeExpiredRuns() {
  const db = getClient();
  if (!db) return 0;
  const { data, error } = await db
    .from('newsletter_runs')
    .update({ candidates: [], research: null, status: 'expired' })
    .lt('expires_at', new Date().toISOString())
    .neq('status', 'expired')
    .select('id');
  if (error) return 0;
  return data?.length || 0;
}

/** The draft due to send today (generated the evening before). */
async function getDueRun(sendDate) {
  const db = getClient();
  if (!db) return null;
  const { data, error } = await db
    .from('newsletter_runs')
    .select('*')
    .eq('status', 'draft')
    .eq('send_date', sendDate)
    .order('created_at', { ascending: false })
    .limit(1);
  if (error || !data?.length) return null;
  return data[0];
}

async function markRunSent(id) {
  return updateRun(id, { status: 'sent' });
}

// ---- Subscribers ----

async function getSubscriberByEmail(email) {
  const db = getClient();
  if (!db) return null;
  const { data } = await db.from('newsletter_subscribers').select('*').eq('email', email).limit(1);
  return (data && data[0]) || null;
}

/**
 * Add or reactivate a subscriber. A free signup never downgrades an existing
 * member row; a member signup upgrades source and links the account.
 */
async function addSubscriber({ email, userId = null, source = 'free' }) {
  const db = getClient();
  if (!db) return null;
  email = String(email).trim().toLowerCase();
  const existing = await getSubscriberByEmail(email);
  if (existing) {
    const patch = { subscribed: true, unsubscribed_at: null };
    if (source === 'member') { patch.source = 'member'; if (userId) patch.user_id = userId; }
    const { data } = await db.from('newsletter_subscribers').update(patch).eq('id', existing.id).select().single();
    return data;
  }
  const { data, error } = await db
    .from('newsletter_subscribers')
    .insert({ email, user_id: userId, source })
    .select()
    .single();
  if (error) throw error;
  return data;
}

/** All currently-subscribed rows (email + token for the unsubscribe link). */
async function getActiveSubscribers() {
  const db = getClient();
  if (!db) return [];
  const { data, error } = await db
    .from('newsletter_subscribers')
    .select('email, unsubscribe_token')
    .eq('subscribed', true);
  if (error) return [];
  return data;
}

/** Unsubscribe by token. Flips the flag only; never touches the account. */
async function unsubscribeByToken(token) {
  const db = getClient();
  if (!db || !token) return null;
  const { data, error } = await db
    .from('newsletter_subscribers')
    .update({ subscribed: false, unsubscribed_at: new Date().toISOString() })
    .eq('unsubscribe_token', token)
    .select('email');
  if (error || !data?.length) return null;
  return data[0].email;
}

/** One-time: subscribe every existing paid member. */
async function backfillMembers() {
  const db = getClient();
  if (!db) return 0;
  const { data, error } = await db
    .from('users')
    .select('id, email, membership_tier')
    .in('membership_tier', ['ensign', 'navigator', 'captain']);
  if (error || !data) return 0;
  let n = 0;
  for (const u of data) {
    if (!u.email) continue;
    try { await addSubscriber({ email: u.email, userId: u.id, source: 'member' }); n++; } catch (_) {}
  }
  return n;
}

// ---- Events (Resend webhook → open/click stats) ----

async function recordEvent({ issueId, email, type }) {
  const db = getClient();
  if (!db) return;
  const { error } = await db.from('newsletter_events').insert({ issue_id: issueId || null, email, type });
  if (error) console.error('[newsletter] event insert:', error.message);
}

/** Publish archive issues whose 7-day delay has elapsed. */
async function publishDueIssues() {
  const db = getClient();
  if (!db) return 0;
  const { data, error } = await db
    .from('newsletter_issues')
    .update({ published: true })
    .lte('publish_at', new Date().toISOString())
    .eq('published', false)
    .select('id');
  if (error) return 0;
  return data?.length || 0;
}

/** Aggregate event counts per issue, for the admin stats. */
async function getStatsForIssues(ids) {
  const db = getClient();
  if (!db || !ids?.length) return {};
  const { data, error } = await db.from('newsletter_events').select('issue_id, type').in('issue_id', ids);
  if (error) return {};
  const out = {};
  for (const e of data) {
    out[e.issue_id] = out[e.issue_id] || {};
    out[e.issue_id][e.type] = (out[e.issue_id][e.type] || 0) + 1;
  }
  return out;
}

module.exports = {
  createRun,
  getRun,
  getLatestDraft,
  getDraftForSendDate,
  getDueRun,
  updateRun,
  markRunSent,
  createIssue,
  listIssues,
  purgeExpiredRuns,
  getSubscriberByEmail,
  addSubscriber,
  getActiveSubscribers,
  unsubscribeByToken,
  backfillMembers,
  recordEvent,
  getStatsForIssues,
  publishDueIssues,
};
