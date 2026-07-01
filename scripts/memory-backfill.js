/**
 * memory-backfill.js — one-time derivation over existing member history, so
 * Earl "already remembers" the past months the day memory goes live.
 *
 *   node scripts/memory-backfill.js            # every member with history
 *   node scripts/memory-backfill.js <userId>   # one member
 *
 * Idempotent: sessions already in the outbox are skipped, so it can be
 * re-run after an interruption. Facts keep their real historical dates
 * (that is what the decay slope runs on). Ends by writing each member's
 * profile file.
 */

require('dotenv').config();

const { getClient } = require('../server/services/supabase');
const store = require('../server/services/memory/store');
const { deriveSession, refreshProfile } = require('../server/services/memory/derive');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getAllMessages(db, userId) {
  // Page through, in case a member has more than 1000 messages.
  const all = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from('commander_messages')
      .select('session_id, message_role, message_content, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: true })
      .range(from, from + 999);
    if (error) throw error;
    all.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return all;
}

async function backfillUser(db, userId, label) {
  const messages = await getAllMessages(db, userId);
  if (!messages.length) {
    console.log(`- ${label}: no history, skipping`);
    return;
  }

  // Group into sessions, preserving chronological order.
  const order = [];
  const bySession = new Map();
  for (const m of messages) {
    if (!m.session_id) continue;
    if (!bySession.has(m.session_id)) {
      bySession.set(m.session_id, []);
      order.push(m.session_id);
    }
    bySession.get(m.session_id).push(m);
  }

  console.log(`- ${label}: ${messages.length} messages across ${order.length} sessions`);
  let derived = 0;
  for (const sessionId of order) {
    if (await store.outboxHasSession(userId, sessionId)) continue; // already done
    const msgs = bySession.get(sessionId);
    try {
      const result = await deriveSession(userId, sessionId, {
        messages: msgs,
        asOf: msgs[msgs.length - 1].created_at,
      });
      await store.enqueueSession(userId, sessionId, 'backfill', true);
      if (!result.skipped) derived++;
      process.stdout.write(`    session ${derived}/${order.length}: +${result.facts || 0} facts, +${result.decisions || 0} decisions, +${result.deflections || 0} deflections${result.skipped ? ' (skipped: ' + result.skipped + ')' : ''}\n`);
    } catch (e) {
      console.error(`    session ${sessionId} failed: ${e.message} (re-run to retry)`);
    }
    await sleep(1000);
  }

  try {
    const updated = await refreshProfile(userId);
    console.log(updated ? '    profile written' : '    nothing to profile yet');
  } catch (e) {
    console.error(`    profile failed: ${e.message}`);
  }
}

async function main() {
  const db = getClient();
  if (!db) { console.error('Supabase not configured (check .env)'); process.exit(1); }

  const onlyUser = process.argv[2];
  let users;
  if (onlyUser) {
    users = [{ id: onlyUser, email: onlyUser }];
  } else {
    const { data, error } = await db.from('users').select('id, email');
    if (error) throw error;
    users = data || [];
  }

  console.log(`Backfilling memory for ${users.length} user(s) (env tag: ${store.ENV})...\n`);
  for (const u of users) {
    await backfillUser(db, u.id, u.email || u.id);
  }
  console.log('\nBackfill complete.');
}

main().catch((e) => { console.error('Backfill fatal:', e); process.exit(1); });
