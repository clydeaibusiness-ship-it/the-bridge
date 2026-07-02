/**
 * alert.js — surface real failures to the owner immediately.
 *
 * The point is the opposite of hiding errors: when Earl snags for a member,
 * the owner should find out right away and know what broke, rather than
 * waiting for a customer to complain. Reuses Resend. Throttled per message
 * key so a sustained outage sends one email, not hundreds.
 */

const { Resend } = require('resend');

let resend = null;
function client() {
  if (!resend && process.env.RESEND_API_KEY) resend = new Resend(process.env.RESEND_API_KEY);
  return resend;
}

const FROM = 'Earl Alerts <earl@captainsbridge.io>';
const THROTTLE_MS = 10 * 60 * 1000; // at most one alert per key per 10 minutes
const lastSent = new Map();

function ownerEmail() {
  return process.env.OWNER_EMAIL || process.env.NEWSLETTER_ADMIN_EMAIL || '';
}

/**
 * Email the owner about a failure. Fire-and-forget; never throws, so alerting
 * can't itself break the request it is reporting on.
 * @param {string} key    throttle key (e.g. 'commander-chat') — same key coalesces
 * @param {string} subject
 * @param {string} body   plain text
 */
async function sendOwnerAlert(key, subject, body) {
  try {
    const to = ownerEmail();
    const api = client();
    if (!to || !api) {
      console.error('[alert] not configured (need RESEND_API_KEY + OWNER_EMAIL); would have sent:', subject);
      return;
    }
    const now = Date.now();
    const last = lastSent.get(key) || 0;
    if (now - last < THROTTLE_MS) return; // already alerted recently for this key
    lastSent.set(key, now);

    await api.emails.send({
      from: FROM,
      to,
      subject: `[Earl alert] ${subject}`,
      text: `${body}\n\nEnvironment: ${process.env.MEMORY_ENV || process.env.RAILWAY_ENVIRONMENT_NAME || 'unknown'}\nTime: ${new Date().toISOString()}\n\n(Further alerts for "${key}" are muted for 10 minutes.)`,
    });
    console.error('[alert] owner notified:', subject);
  } catch (e) {
    console.error('[alert] failed to send owner alert:', e.message);
  }
}

module.exports = { sendOwnerAlert };
