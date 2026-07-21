/**
 * push.js — web-push delivery to members' phones and desktops.
 *
 * VAPID keys come from env (VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY /
 * VAPID_SUBJECT). Subscriptions live in push_subscriptions, one row per
 * device. Dead subscriptions (404/410 from the push service) are removed
 * on send so the table self-cleans.
 */

const webpush = require('web-push');
const { getClient } = require('./supabase');

let configured = false;

function ensureConfigured() {
  if (configured) return true;
  const pub = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) return false;
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || 'mailto:earl@captainsbridge.io',
    pub,
    priv
  );
  configured = true;
  return true;
}

function getVapidPublicKey() {
  return process.env.VAPID_PUBLIC_KEY || null;
}

/** Save (upsert by endpoint) a browser push subscription for a member. */
async function saveSubscription(userId, subscription, userAgent = null) {
  const db = getClient();
  if (!db) throw new Error('Database not configured');
  if (!subscription || !subscription.endpoint || !subscription.keys) {
    throw new Error('Invalid subscription');
  }
  const { error } = await db.from('push_subscriptions').upsert(
    {
      user_id: userId,
      endpoint: subscription.endpoint,
      keys: subscription.keys,
      user_agent: userAgent,
    },
    { onConflict: 'endpoint' }
  );
  if (error) throw new Error('saveSubscription: ' + error.message);
}

/** Remove a subscription by endpoint (member disabled, or push service said gone). */
async function removeSubscription(endpoint) {
  const db = getClient();
  if (!db) return;
  await db.from('push_subscriptions').delete().eq('endpoint', endpoint);
}

/**
 * Send a push to every device a member has enabled.
 * payload: { title, body, url }
 * Returns the number of successful deliveries.
 */
async function sendPushToUser(userId, payload) {
  if (!ensureConfigured()) throw new Error('VAPID keys not configured');
  const db = getClient();
  if (!db) throw new Error('Database not configured');

  const { data: subs, error } = await db
    .from('push_subscriptions')
    .select('*')
    .eq('user_id', userId);
  if (error) throw new Error('sendPushToUser: ' + error.message);
  if (!subs || !subs.length) return 0;

  let delivered = 0;
  for (const sub of subs) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: sub.keys },
        JSON.stringify(payload),
        { TTL: 60 * 60 * 24 } // a day — a check-in older than that can wait for the next one
      );
      delivered++;
      await db
        .from('push_subscriptions')
        .update({ last_used_at: new Date().toISOString() })
        .eq('id', sub.id);
    } catch (e) {
      const code = e.statusCode || 0;
      if (code === 404 || code === 410) {
        // Device unsubscribed or expired — clean it up quietly.
        await removeSubscription(sub.endpoint);
      } else {
        console.error('[push] delivery failed:', code, e.message);
      }
    }
  }
  return delivered;
}

module.exports = { getVapidPublicKey, saveSubscription, removeSubscription, sendPushToUser };
