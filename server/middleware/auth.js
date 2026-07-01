/**
 * Clerk auth middleware.
 *
 * `clerkPageMiddleware` mounts app-wide and does Clerk's handshake: when a
 * signed-in member arrives with a stale/expired __session cookie, Clerk
 * transparently mints a fresh one instead of the server treating them as
 * signed-out. Without it, a stale cookie on a top-level navigation bounces
 * the member to /login, they get sent back by Clerk, and the two disagree
 * forever — the sign-in loop. It must run before extractUser and the gates.
 *
 * `extractUser` then reads the resolved auth (getAuth) and attaches the
 * Supabase user. Contract unchanged: sets req.userId + req.dbUser, never blocks.
 */
const { getUserByClerkId, getOrCreateUser } = require('../services/supabase');

let clerkExpress = null;
let clerkClient = null;
try {
  clerkExpress = require('@clerk/express');
  if (process.env.CLERK_SECRET_KEY) {
    clerkClient = clerkExpress.createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });
  }
} catch (e) {
  console.log('Clerk express SDK not available:', e.message);
}

// Publishable keys are non-secret (they already ship in the frontend). The
// server never had this in env, so derive it from which secret key this
// deploy holds: sk_live → production instance, otherwise the dev instance.
// An explicit CLERK_PUBLISHABLE_KEY env var still overrides.
const PK_LIVE = 'pk_live_Y2xlcmsuY2FwdGFpbnNicmlkZ2UuaW8k';
const PK_TEST = 'pk_test_b2JsaWdpbmctcHl0aG9uLTUuY2xlcmsuYWNjb3VudHMuZGV2JA';
function resolvePublishableKey() {
  if (process.env.CLERK_PUBLISHABLE_KEY) return process.env.CLERK_PUBLISHABLE_KEY;
  return String(process.env.CLERK_SECRET_KEY || '').startsWith('sk_live_') ? PK_LIVE : PK_TEST;
}

// The app-wide handshake middleware. A no-op passthrough when Clerk isn't
// configured (e.g. local dev without keys) so the server still boots.
function clerkPageMiddleware(req, res, next) {
  if (!clerkExpress || !process.env.CLERK_SECRET_KEY) return next();
  if (!clerkPageMiddleware._mw) {
    clerkPageMiddleware._mw = clerkExpress.clerkMiddleware({
      publishableKey: resolvePublishableKey(),
      secretKey: process.env.CLERK_SECRET_KEY,
    });
  }
  return clerkPageMiddleware._mw(req, res, next);
}

async function extractUser(req, res, next) {
  req.userId = null;
  req.dbUser = null;

  if (!clerkExpress || !process.env.CLERK_SECRET_KEY) return next();

  try {
    // Auth was resolved (and handshaked) by clerkPageMiddleware upstream.
    const auth = clerkExpress.getAuth(req);
    const sub = auth?.userId;
    if (!sub) return next();

    req.userId = sub;

    // Look up or auto-create Supabase user. getOrCreateUser is idempotent on
    // email, so a row created under a previous Clerk instance is reclaimed
    // (its clerk_id updated) rather than colliding on the unique email.
    let dbUser = await getUserByClerkId(sub);
    if (!dbUser && clerkClient) {
      try {
        const clerkUser = await clerkClient.users.getUser(sub);
        const email = clerkUser.emailAddresses?.[0]?.emailAddress || '';
        dbUser = await getOrCreateUser(sub, email);
      } catch (createErr) {
        console.error('Auto-create user failed:', createErr.message);
      }
    }
    req.dbUser = dbUser;
  } catch (e) {
    console.error('Auth resolution failed:', e.message);
    // Not signed in or Clerk unreachable — treat as unauthenticated.
  }

  next();
}

/**
 * Require authentication — returns 401 if not authenticated
 */
function requireAuth(req, res, next) {
  if (!req.dbUser) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  next();
}

/**
 * Require the owner — gates the newsletter admin to a single Clerk account
 * whose email matches NEWSLETTER_ADMIN_EMAIL (falls back to OWNER_EMAIL).
 * Fails closed: if no admin email is configured, nobody gets in.
 * Run after extractUser so req.dbUser is populated.
 */
function requireOwner(req, res, next) {
  if (!req.dbUser) return res.status(401).json({ error: 'Authentication required' });
  const allow = (process.env.NEWSLETTER_ADMIN_EMAIL || process.env.OWNER_EMAIL || '').toLowerCase();
  if (!allow) return res.status(503).json({ error: 'Admin email not configured' });
  if ((req.dbUser.email || '').toLowerCase() !== allow) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  next();
}

module.exports = { extractUser, requireAuth, requireOwner, clerkPageMiddleware };
