/**
 * checkin-worker.js — Earl reaching out first: the Daily Pulse.
 *
 * In-process scheduler (same pattern as the newsletter scheduler and memory
 * worker). Every morning (Central), each member gets ONE short personal line
 * from Earl, composed from their goals, open steps, and memory — the habit
 * anchor of the whole product. It lands in their chat thread AND on their
 * phone; replying continues the conversation. Members already active today
 * are skipped (they're engaged; no noise).
 *
 * Also sends the weekly owner digest (Monday morning) so the owner can watch
 * the loop working without asking.
 *
 * Off by default. dev and prod share one database, so set CHECKIN_WORKER=on
 * only in the environment that should actually send (prod).
 */

const crypto = require('crypto');
const {
  usersWithBenchmarks, getLastEarlCheckIn, getLastCommanderMessageAt,
  getBenchmarks, getActionSteps, getSessionDebriefs,
  getLatestCommanderSessionId, saveCommanderMessage, recordEarlCheckIn,
  getCommanderMessagesForApi, ensureMemberState, updateMemberState,
  recordMemberActivity, chicagoDateStr, getClient,
  usersWithFriends, getLastFriendNote, saveFriendNote,
} = require('./supabase');
const { composeCheckIn, commanderChat, getSoulVersion, composeFriendNote } = require('./claude');
const { sendPushToUser } = require('./push');
const { mint: mintReplyToken } = require('./replytoken');
const { chicagoNow } = require('./newsletter/jobs');

const SEND_HOUR_START = 8;       // pulse window opens 8am Central
const SEND_HOUR_END = 11;        // ...and closes 11am — one morning line, not all-day pings
const MAX_PER_RUN = 50;          // safety cap per run
const MILESTONES = [7, 30, 90, 180];

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

  // The Walk — their streak of showing up. On a milestone day, Earl marks it:
  // one warm sentence, in his voice, no fanfare.
  try {
    const state = await ensureMemberState(userId);
    const streak = state?.current_streak || 0;
    if (streak >= 2) lines.push(`They have shown up for their business ${streak} days in a row now.`);
    const due = MILESTONES.filter(m => streak >= m && (state?.streak_milestone_sent || 0) < m).pop();
    if (due) {
      lines.push(`MILESTONE: this is day ${due} of walking together. Acknowledge it in one warm, understated sentence woven into your message — proud of their consistency, no confetti, no exclamation marks.`);
      await updateMemberState(userId, { streak_milestone_sent: due });
    }
  } catch (e) { /* streaks optional */ }

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
      token: mintReplyToken(userId), // lets them reply from the notification later
    });
    pushed = delivered > 0;
  } catch (e) {
    console.error('[checkin] push failed for', userId, e.message);
  }

  await recordEarlCheckIn(userId, sessionId, message, pushed);
  return { created: true, pushed };
}

/** The Daily Pulse — one line from Earl per member per Chicago day. */
async function run() {
  const userIds = await usersWithBenchmarks();
  const today = chicagoDateStr();
  let sent = 0;
  for (const userId of userIds) {
    if (sent >= MAX_PER_RUN) break;
    try {
      const [lastCheckIn, lastMsg] = await Promise.all([
        getLastEarlCheckIn(userId),
        getLastCommanderMessageAt(userId),
      ]);
      // Already pulsed today → done.
      if (lastCheckIn?.created_at && chicagoDateStr(new Date(lastCheckIn.created_at)) === today) continue;
      // Member already talked to Earl today → they're engaged; don't add noise.
      if (lastMsg && chicagoDateStr(new Date(lastMsg)) === today) continue;

      const { created } = await checkInOne(userId);
      if (created) {
        sent++;
        console.log('[pulse] sent to', userId);
      }
    } catch (e) {
      console.error('[pulse] failed for', userId, e.message);
    }
  }
  if (sent) console.log(`[pulse] run complete — ${sent} sent`);
}

/**
 * Weekly owner digest — Monday morning: what the loop did last week.
 * Sent with Resend directly (same pattern as alert.js), so the owner can
 * watch the machine without asking.
 */
async function ownerDigest() {
  const to = process.env.OWNER_EMAIL || process.env.NEWSLETTER_ADMIN_EMAIL;
  const key = process.env.RESEND_API_KEY;
  if (!to || !key) return;
  const db = getClient();
  if (!db) return;

  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const [pulses, replies, stepsDone, goalsDone, newUsers, states] = await Promise.all([
    db.from('earl_checkins').select('id', { count: 'exact', head: true }).gte('created_at', since),
    db.from('commander_messages').select('id', { count: 'exact', head: true }).eq('message_role', 'user').gte('created_at', since),
    db.from('action_steps').select('id', { count: 'exact', head: true }).eq('status', 'completed').gte('completed_at', since),
    db.from('member_benchmarks').select('id', { count: 'exact', head: true }).gte('completed_at', since),
    db.from('users').select('id', { count: 'exact', head: true }).gte('created_at', since),
    db.from('member_state').select('current_streak').gt('current_streak', 0),
  ]);
  const streaks = (states.data || []).map(s => s.current_streak).sort((a, b) => b - a);
  const activeStreaks = streaks.length;
  const topStreak = streaks[0] || 0;
  const weekOf = chicagoDateStr();

  const line = (label, v) => `<tr><td style="padding:6px 14px 6px 0;color:#6a5c4a;">${label}</td><td style="padding:6px 0;font-weight:700;">${v ?? 0}</td></tr>`;
  const html = `<div style="font-family:Georgia,serif;max-width:480px;margin:0 auto;padding:24px;background:#f5f0e8;color:#1a1512;">
    <h2 style="margin:0 0 4px;">Earl — week in review</h2>
    <p style="margin:0 0 16px;color:#6a5c4a;font-size:14px;">Week of ${weekOf}. The habit loop, measured.</p>
    <table style="font-size:15px;border-collapse:collapse;">
      ${line('Pulses Earl sent', pulses.count)}
      ${line('Member messages (incl. pulse replies)', replies.count)}
      ${line('Action steps completed', stepsDone.count)}
      ${line('Goals completed', goalsDone.count)}
      ${line('Members with an active streak', activeStreaks)}
      ${line('Longest current streak (days)', topStreak)}
      ${line('New members this week', newUsers.count)}
    </table>
    <p style="margin:18px 0 0;color:#6a5c4a;font-size:12px;">Watch replies and streaks. When those climb week over week, the loop is working and it's time for the next phase.</p>
  </div>`;

  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'Earl Alerts <earl@captainsbridge.io>',
        to: [to],
        subject: `Earl weekly: ${replies.count ?? 0} replies, ${activeStreaks} streaks alive`,
        html,
      }),
    });
    console.log('[digest] weekly owner digest sent');
  } catch (e) {
    console.error('[digest] send failed:', e.message);
  }
}

/**
 * One Friend — on the 1st of each month, draft the progress note for every
 * member who invited someone. The member approves it in the app before it
 * sends; drafting never emails anyone.
 */
async function draftFriendNotes() {
  const friends = await usersWithFriends();
  for (const f of friends) {
    try {
      const last = await getLastFriendNote(f.user_id);
      if (last && daysSince(last.created_at) < 25) continue; // one per month
      const situation = await buildSituation(f.user_id);
      const note = await composeFriendNote({
        fromName: f.friend_from_name, friendName: f.friend_name, situation,
      });
      if (!note) continue;
      await saveFriendNote(f.user_id, note);
      try {
        await sendPushToUser(f.user_id, {
          title: 'Earl',
          body: `Your monthly note to ${f.friend_name || 'your friend'} is ready. Read it over and send it when it feels right.`,
          url: '/app',
          token: mintReplyToken(f.user_id),
        });
      } catch (e) { /* push optional */ }
      console.log('[friend] note drafted for', f.user_id);
    } catch (e) {
      console.error('[friend] draft failed for', f.user_id, e.message);
    }
  }
}

function tick() {
  const c = chicagoNow();
  // 1st of the month, 9am CT: draft the friend notes.
  if (c.day === 1 && c.hour === 9) {
    const fkey = `friend-${c.dateStr}`;
    if (!fired.has(fkey)) {
      fired.add(fkey);
      draftFriendNotes().catch((e) => console.error('[friend] error:', e.message));
    }
  }
  // Monday 8am CT: the owner digest (before the day's pulses).
  if (c.weekday === 1 && c.hour === 8) {
    const dkey = `digest-${c.dateStr}`;
    if (!fired.has(dkey)) {
      fired.add(dkey);
      ownerDigest().catch((e) => console.error('[digest] error:', e.message));
    }
  }
  if (c.hour < SEND_HOUR_START || c.hour >= SEND_HOUR_END) return;
  // Once per hour inside the window (catches members missed by an earlier run).
  const key = `pulse-${c.dateStr}-${c.hour}`;
  if (fired.has(key)) return;
  fired.add(key);
  if (fired.size > 200) fired.clear();
  run().catch((e) => console.error('[pulse] run error:', e.message));
}

function start() {
  if (process.env.CHECKIN_WORKER !== 'on') {
    console.log('[checkin] worker disabled (set CHECKIN_WORKER=on to enable)');
    return;
  }
  if (timer) return;
  timer = setInterval(tick, 5 * 60 * 1000);
  console.log(`[pulse] worker started — daily pulse ${SEND_HOUR_START}:00–${SEND_HOUR_END}:00 CT, Monday owner digest`);
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
  recordMemberActivity(userId).catch(() => {}); // the Walk: they showed up today

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
      token: mintReplyToken(userId), // so they can reply again from the notification
    });
  } catch (e) {
    console.error('[checkin] reply push failed for', userId, e.message);
  }

  return { reply };
}

module.exports = { start, checkInOne, replyToCheckIn };
