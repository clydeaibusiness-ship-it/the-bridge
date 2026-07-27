/**
 * replytoken.js — a small signed token that lets a member reply to a push
 * notification without a live login session.
 *
 * Why: a reply typed into a notification is a background fetch from the service
 * worker. It can't carry a fresh Clerk session (the __session JWT expires in
 * ~1 minute and there's no way to run Clerk's refresh handshake in the
 * background), so replies sent a few minutes after the push used to fail auth
 * silently. Instead we mint an HMAC token when we SEND the push, embed it in
 * the notification, and the reply carries it back. The token names the user
 * and can't be forged without the server secret. It only permits posting a
 * chat message as that member — low blast radius — and expires in 30 days.
 */

const crypto = require('crypto');

const SECRET =
  process.env.PUSH_REPLY_SECRET ||
  process.env.VAPID_PRIVATE_KEY ||
  process.env.CLERK_SECRET_KEY ||
  'earl-reply-fallback-secret-change-me';
const TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function sign(body) {
  return crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
}

/** Mint a reply token for a user. */
function mint(userId) {
  const exp = Date.now() + TTL_MS;
  const body = `${userId}.${exp}`;
  return `${body}.${sign(body)}`;
}

/** Verify a token and return its userId, or null if invalid/expired. */
function verify(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [userId, exp, sig] = parts;
  const expected = sign(`${userId}.${exp}`);
  try {
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  } catch (e) {
    return null;
  }
  if (!Number(exp) || Date.now() > Number(exp)) return null;
  return userId;
}

module.exports = { mint, verify };
