/**
 * store.js — Supabase persistence for Earl's memory system.
 * Facts, decision ledger, member profiles, and the ingestion outbox.
 * Everything here is derived from commander_messages and rebuildable.
 */

const { getClient } = require('../supabase');

// Which environment this process is. Outbox rows are tagged with the env that
// created them and only processed by a worker running in the same env, so dev
// testing never derives into real member memory (dev and prod share one DB).
const ENV = process.env.MEMORY_ENV || process.env.RAILWAY_ENVIRONMENT_NAME || 'local';

// ---- Facts ----

async function insertFact({ userId, fact, embedding, sourceSession = null, asOf = null }) {
  const db = getClient();
  if (!db) return null;
  const when = asOf ? new Date(asOf).toISOString() : new Date().toISOString();
  const { data, error } = await db
    .from('memory_facts')
    .insert({ user_id: userId, fact, embedding, source_session: sourceSession, first_seen: when, last_confirmed: when })
    .select('id')
    .single();
  if (error) throw error;
  return data.id;
}

/** The member restated an existing fact: bump its freshness. */
async function confirmFact(id, asOf = null) {
  const db = getClient();
  if (!db) return;
  const when = asOf ? new Date(asOf).toISOString() : new Date().toISOString();
  await db.from('memory_facts').update({ last_confirmed: when }).eq('id', id);
}

/** A new fact contradicts an old one: old is kept as history, hidden from retrieval. */
async function supersedeFact(oldId, newId) {
  const db = getClient();
  if (!db) return;
  await db.from('memory_facts').update({ superseded_by: newId }).eq('id', oldId);
}

/** All live facts for a user (for derivation context). */
async function listFacts(userId, limit = 150) {
  const db = getClient();
  if (!db) return [];
  const { data, error } = await db
    .from('memory_facts')
    .select('id, fact, last_confirmed')
    .eq('user_id', userId)
    .is('superseded_by', null)
    .order('last_confirmed', { ascending: false })
    .limit(limit);
  if (error) return [];
  return data;
}

/** Similarity search over live facts (recency decay applied by the caller). */
async function searchFacts(userId, queryEmbedding, count = 24) {
  const db = getClient();
  if (!db) return [];
  const { data, error } = await db.rpc('match_memory_facts', {
    p_user_id: userId,
    p_query: queryEmbedding,
    p_count: count,
  });
  if (error) throw error;
  return data || [];
}

// ---- Decision ledger ----

async function listLedger(userId, limit = 40) {
  const db = getClient();
  if (!db) return [];
  const { data, error } = await db
    .from('decision_ledger')
    .select('id, topic, conclusion, reasoning, status, decided_at, last_touched')
    .eq('user_id', userId)
    .order('last_touched', { ascending: false })
    .limit(limit);
  if (error) return [];
  return data;
}

async function insertLedgerEntry({ userId, topic, conclusion, reasoning = null, status = 'open', decidedAt = null }) {
  const db = getClient();
  if (!db) return null;
  const { data, error } = await db
    .from('decision_ledger')
    .insert({ user_id: userId, topic, conclusion, reasoning, status, decided_at: decidedAt, last_touched: new Date().toISOString() })
    .select('id')
    .single();
  if (error) throw error;
  return data.id;
}

async function updateLedgerEntry(id, patch) {
  const db = getClient();
  if (!db) return;
  await db.from('decision_ledger').update({ ...patch, last_touched: new Date().toISOString() }).eq('id', id);
}

// ---- Member profile ----

async function getProfile(userId) {
  const db = getClient();
  if (!db) return null;
  const { data } = await db.from('member_profiles').select('*').eq('user_id', userId).limit(1);
  return (data && data[0]) || null;
}

async function saveProfile(userId, profile) {
  const db = getClient();
  if (!db) return;
  const existing = await getProfile(userId);
  if (existing) {
    await db.from('member_profiles')
      .update({ profile, version: existing.version + 1, updated_at: new Date().toISOString() })
      .eq('user_id', userId);
  } else {
    await db.from('member_profiles').insert({ user_id: userId, profile });
  }
}

// ---- Outbox (ingestion queue) ----

async function enqueueSession(userId, sessionId, kind = 'session', processed = false) {
  const db = getClient();
  if (!db) return;
  const row = { user_id: userId, session_id: sessionId, env: ENV, kind, processed };
  if (processed) row.processed_at = new Date().toISOString();
  const { error } = await db.from('memory_outbox').insert(row);
  if (error) throw error;
}

async function outboxHasSession(userId, sessionId) {
  const db = getClient();
  if (!db) return true; // fail safe: don't enqueue if we can't check
  const { data, error } = await db
    .from('memory_outbox')
    .select('id')
    .eq('user_id', userId)
    .eq('session_id', sessionId)
    .limit(1);
  if (error) return true;
  return data && data.length > 0;
}

async function fetchPending(limit = 3) {
  const db = getClient();
  if (!db) return [];
  const { data, error } = await db
    .from('memory_outbox')
    .select('*')
    .eq('env', ENV)
    .eq('processed', false)
    .lt('attempts', 5)
    .order('created_at', { ascending: true })
    .limit(limit);
  if (error) return [];
  return data;
}

async function markProcessed(id) {
  const db = getClient();
  if (!db) return;
  await db.from('memory_outbox').update({ processed: true, processed_at: new Date().toISOString() }).eq('id', id);
}

async function markFailed(id, attempts, message) {
  const db = getClient();
  if (!db) return;
  await db.from('memory_outbox').update({ attempts: attempts + 1, last_error: String(message).slice(0, 500) }).eq('id', id);
}

/** Users whose memory changed recently (for the nightly profile refresh). */
async function usersProcessedSince(sinceIso) {
  const db = getClient();
  if (!db) return [];
  const { data, error } = await db
    .from('memory_outbox')
    .select('user_id')
    .eq('processed', true)
    .gte('processed_at', sinceIso);
  if (error) return [];
  return [...new Set(data.map((r) => r.user_id))];
}

/** Recent messages, for the sweep that finds ended-but-underived sessions. */
async function recentMessagesForSweep(sinceIso, limit = 2000) {
  const db = getClient();
  if (!db) return [];
  const { data, error } = await db
    .from('commander_messages')
    .select('user_id, session_id, created_at')
    .gte('created_at', sinceIso)
    .order('created_at', { ascending: true })
    .limit(limit);
  if (error) return [];
  return data;
}

// ---- Erasure ----

/** Wipe every derived memory row for a user. The transcript is untouched. */
async function wipeMemory(userId) {
  const db = getClient();
  if (!db) return;
  // Clear self-references first so the delete can't trip on them.
  await db.from('memory_facts').update({ superseded_by: null }).eq('user_id', userId).not('superseded_by', 'is', null);
  await db.from('memory_facts').delete().eq('user_id', userId);
  await db.from('decision_ledger').delete().eq('user_id', userId);
  await db.from('member_profiles').delete().eq('user_id', userId);
  await db.from('memory_outbox').delete().eq('user_id', userId);
}

module.exports = {
  ENV,
  insertFact,
  confirmFact,
  supersedeFact,
  listFacts,
  searchFacts,
  listLedger,
  insertLedgerEntry,
  updateLedgerEntry,
  getProfile,
  saveProfile,
  enqueueSession,
  outboxHasSession,
  fetchPending,
  markProcessed,
  markFailed,
  usersProcessedSince,
  recentMessagesForSweep,
  wipeMemory,
};
