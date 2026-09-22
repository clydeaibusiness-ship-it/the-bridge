/**
 * scheduler.js — in-process scheduler. Checks once a minute and fires the
 * newsletter jobs at the right America/Chicago times. No external cron, nothing
 * to configure in Railway.
 *
 *   Generate  Sunday 19:00  (the evening before the send)
 *   Send      Monday 07:00  (weekly)
 *   Purge     daily 03:00
 *   Publish   daily 08:00
 *
 * Firing is guarded per job-per-day, and the jobs themselves are idempotent
 * (generate skips if a draft exists; send only touches a draft and marks it
 * sent), so a restart mid-window can't double-send.
 */

const { chicagoNow, runGenerate, runSend, runPurge, runPublish, GEN_DAYS } = require('./jobs');

const fired = new Set();

function once(key, fn) {
  if (fired.has(key)) return;
  fired.add(key);
  if (fired.size > 200) fired.clear(); // bound the set
  Promise.resolve()
    .then(fn)
    .then((r) => console.log('[newsletter scheduler]', key, JSON.stringify(r)))
    .catch((e) => console.error('[newsletter scheduler]', key, e.message));
}

function tick() {
  const c = chicagoNow();
  const day = c.dateStr;
  const inWindow = c.minute < 5; // a 5-minute catch window each hour

  if (GEN_DAYS.includes(c.weekday) && c.hour === 19 && inWindow) once('gen-'  + day, runGenerate);
  if (c.weekday === 1 && c.hour === 7 && inWindow) once('send-' + day, runSend);
  if (c.hour === 3 && inWindow) once('purge-' + day, runPurge);
  // Publish due issues to the archive once a day, just after the 7am send
  // boundary (an issue becomes due seven days after its 7am send). Hourly
  // polling was pointless -- publishing is never more than a day sensitive.
  if (c.hour === 8 && inWindow) once('publish-' + day, runPublish);
}

let timer = null;
function start() {
  // Off by default. dev and prod share one database, so the scheduler must
  // only run where you actually want automatic sends. Set NEWSLETTER_SCHEDULER=on
  // there (and nowhere else) to avoid the dev service sending to the real list.
  if (process.env.NEWSLETTER_SCHEDULER !== 'on') {
    console.log('[newsletter scheduler] disabled (set NEWSLETTER_SCHEDULER=on to enable)');
    return;
  }
  if (timer) return;
  timer = setInterval(tick, 60 * 1000);
  console.log('[newsletter scheduler] started — generate Sun 19:00 CT, send Mon 07:00 CT, purge daily 03:00 CT');
}

module.exports = { start };
