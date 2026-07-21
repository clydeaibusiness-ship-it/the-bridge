/**
 * checkin-worker.js — Earl reaching out first.
 *
 * In-process scheduler (same pattern as the newsletter scheduler and memory
 * worker). Once an hour, during daytime Central, it finds members who have
 * gone quiet for a while and has Earl compose a short, situational message.
 * That message is saved into their chat thread as an assistant message AND
 * pushed to their phone. Their reply is a normal chat message from there.
 *
 * Off by default. dev and prod share one database, so set CHECKIN_WORKER=on
 * only in the environment that should actually send (prod).
 */

const crypto = require('crypto');
const {
  usersWithBenchmarks, getLastEarlCheckIn, getLastCommanderMessageAt,
  getBenchmarks, getActionSteps, getSessionDebriefs,
  getLatestCommanderSessionId, saveCommanderMessage, recordEarlCheckIn,
  getCommanderMessagesForApi,
} = require('./supabase');
const { composeCheckIn, commanderChat, getSoulVersion } = require('./claude');
const { sendPushToUser } = require('./push');
const { chicagoNow } = require('./newsletter/jobs');

const CADENCE_DAYS = 4;          // reach out after ~4 quiet days
const SEND_HOUR_START = 9;       // 9am Central
const SEND_HOUR_END = 19;        // 7pm Central
const MAX_PER_RUN = 20;          // safety cap per hourly tick

let timer = null;
const fired = new Set();

function daysSince(iso) {
  if (!iso) return Infinity;
  return (Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60 * 24);
}

/** Build the plain-text situation brief Earl composes from. */
async function buildSituation(userId) {
  const [benches, steps, debriefs] = await Promise.all([
    getBenchmarks(userId),
    getActionSteps(userId),
    getSessionDebriefs(userId, 1),
  ]);

  const lines = [];

  const openGoals = benches.filter(b => !b.completed_at);
  if (openGoals.length) {
    lines.push('Their open goals (in their own words):');
    for (const b of openGoals) lines.push(`  - "${b.statement}"`);
  }

  const activeSteps = steps.filter(s => s.status === 'active');
  if (activeSteps.length) {
    lines.push('Action steps they have not closed yet:');
    for (const s of activeSteps.slice(0, 5)) {
      const overdue = s.target_date && new Date(s.target_date) < new Date() ? ' (past the date they set)' : '';
      lines.push(`  - "${s.step_text}"${overdue}`);
    }
  }

  // A goal whose steps are all done — a natural moment to ask about closing it.
  for (const b of openGoals) {
    const bSteps = steps.filter(s => s.benchmark_id === b.id);
    if (bSteps.length && bSteps.every(s => s.status !== 'active')) {
      lines.push(`They have finished every step under this goal: "${b.statement}". This might be a moment to ask whether it feels reached.`);
      break;
    }
  }

  if (debriefs.length && debriefs[0].unresolved_item) {
    lines.push(`An open thread from last time you spoke: ${debriefs[0].unresolved_item}`);
  }

  // Memory profile, if the memory system is running — a richer read on who
  // they are and what they have been wrestling with.
  try {
    const memStore = require('./memory/store');
    const profile = await memStore.getProfile(userId);
    if (profile) lines.push(`What you remember about them:\n${profile}`);
  } catch (e) { /* memory optional */ }

  const daysQuiet = Math.round(daysSince(await getLastCommanderMessageAt(userId)));
  lines.push(`It has been about ${daysQuiet} day(s) since they last talked with you.`);

  return lines.join('\n');
}

/**
 * Send one member their check-in. Returns { created, pushed }:
 * created = a message was composed and saved; pushed = at least one device
 * received the notification.
 */
async function checkInOne(userId) {
  const situation = await buildSituation(userId);
  const message = await composeCheckIn(situation);
  if (!message || message.length < 2) return { created: false, pushed: false };

  // Put it in the chat thread as an assistant message (tagged with the current
  // soul version so it survives the history filter), then record + push.
  const session = await getLatestCommanderSessionId(userId);
  const sessionId = (session && session.sessionId) || crypto.randomUUID();
  await saveCommanderMessage(userId, sessionId, 'assistant', message, getSoulVersion());

  let pushed = false;
  try {
    const delivered = await sendPushToUser(userId, {
      title: 'Earl',
      body: message.length > 140 ? message.slice(0, 137) + '…' : message,
      url: '/app',
    });
    pushed = delivered > 0;
  } catch (e) {
    console.error('[checkin] push failed for', userId, e.message);
  }

  await recordEarlCheckIn(userId, sessionId, message, pushed);
  return { created: true, pushed };
}

/** Find quiet members and send. */
async function run() {
  const userIds = await usersWithBenchmarks();
  let sent = 0;
  for (const userId of userIds) {
    if (sent >= MAX_PER_RUN) break;
    try {
      const [lastCheckIn, lastMsg] = await Promise.all([
        getLastEarlCheckIn(userId),
        getLastCommanderMessageAt(userId),
      ]);
      // Time since ANY contact — Earl's last outreach or their last message.
      const lastContact = Math.min(
        daysSince(lastCheckIn?.created_at),
        daysSince(lastMsg)
      );
      if (lastContact < CADENCE_DAYS) continue;

      const { created } = await checkInOne(userId);
      if (created) {
        sent++;
        console.log('[checkin] sent to', userId);
      }
    } catch (e) {
      console.error('[checkin] failed for', userId, e.message);
    }
  }
  if (sent) console.log(`[checkin] run complete — ${sent} sent`);
}

function tick() {
  const c = chicagoNow();
  if (c.hour < SEND_HOUR_START || c.hour >= SEND_HOUR_END) return;
  // Once per hour: guard on the Central date+hour so a restart doesn't double-fire.
  const key = `checkin-${c.dateStr}-${c.hour}`;
  if (fired.has(key)) return;
  fired.add(key);
  if (fired.size > 100) fired.clear();
  run().catch((e) => console.error('[checkin] run error:', e.message));
}

function start() {
  if (process.env.CHECKIN_WORKER !== 'on') {
    console.log('[checkin] worker disabled (set CHECKIN_WORKER=on to enable)');
    return;
  }
  if (timer) return;
  timer = setInterval(tick, 5 * 60 * 1000); // check every 5 min; the hourly guard rate-limits
  console.log(`[checkin] worker started — cadence ${CADENCE_DAYS}d, send window ${SEND_HOUR_START}:00–${SEND_HOUR_END}:00 CT`);
}

/**
 * Handle a member's reply typed straight into a notification. Records it,
 * runs it through the same commanderChat pipeline the app uses (so Earl has
 * his voice, history, and memory), saves his answer, and pushes it back so
 * the conversation continues in notifications. Returns { reply }.
 */
async function replyToCheckIn(userId, text) {
  const soulVersion = getSoulVersion();
  const session = await getLatestCommanderSessionId(userId);
  const sessionId = (session && session.sessionId) || crypto.randomUUID();

  // Pull history BEFORE saving the new message (commanderChat appends the
  // message itself — fetching after would duplicate it).
  const history = await getCommanderMessagesForApi(userId, 10, soulVersion);

  await saveCommanderMessage(userId, sessionId, 'user', text, soulVersion);

  // Memory context, best-effort — never let it block the reply.
  let memoryContext = '';
  try {
    const { buildMemoryContext } = require('./memory/context');
    memoryContext = (await buildMemoryContext(userId, text)) || '';
  } catch (e) { /* memory optional */ }

  const reply = await commanderChat(text, null, null, history, null, memoryContext, { userId, sessionId });
  await saveCommanderMessage(userId, sessionId, 'assistant', reply, soulVersion);

  try {
    await sendPushToUser(userId, {
      title: 'Earl',
      body: reply.length > 140 ? reply.slice(0, 137) + '…' : reply,
      url: '/app',
    });
  } catch (e) {
    console.error('[checkin] reply push failed for', userId, e.message);
  }

  return { reply };
}

module.exports = { start, checkInOne, replyToCheckIn };
