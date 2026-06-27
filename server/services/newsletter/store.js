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

module.exports = {
  createRun,
  getRun,
  getLatestDraft,
  getDraftForSendDate,
  updateRun,
  createIssue,
  listIssues,
  purgeExpiredRuns,
};
