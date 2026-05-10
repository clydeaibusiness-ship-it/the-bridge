/**
 * Clerk auth middleware — extracts user from session token.
 * Sets req.userId (Clerk user ID) and req.dbUser (Supabase users row) if authenticated.
 * Does NOT block unauthenticated requests — routes decide that.
 */
const { getUserByClerkId, createUser } = require('../services/supabase');

// verifyToken is a top-level export in @clerk/backend, NOT a method on clerkClient
let verifyTokenFn = null;
let clerkClient = null;

try {
  const clerkBackend = require('@clerk/backend');
  verifyTokenFn = clerkBackend.verifyToken;
  if (process.env.CLERK_SECRET_KEY) {
    clerkClient = clerkBackend.createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });
  }
} catch (e) {
  console.log('Clerk backend SDK not available:', e.message);
}

async function extractUser(req, res, next) {
  req.userId = null;
  req.dbUser = null;

  if (!verifyTokenFn || !process.env.CLERK_SECRET_KEY) return next();

  try {
    const token = req.cookies?.__session || req.headers.authorization?.replace('Bearer ', '');
    if (!token) return next();

    // verifyToken is a standalone function, takes token + options
    const payload = await verifyTokenFn(token, {
      secretKey: process.env.CLERK_SECRET_KEY
    });

    const sub = payload.sub;
    if (!sub) return next();

    req.userId = sub;

    // Look up or auto-create Supabase user
    let dbUser = await getUserByClerkId(sub);
    if (!dbUser && clerkClient) {
      try {
        const clerkUser = await clerkClient.users.getUser(sub);
        const email = clerkUser.emailAddresses?.[0]?.emailAddress || '';
        dbUser = await createUser(sub, email);
      } catch (createErr) {
        console.error('Auto-create user failed:', createErr.message);
      }
    }
    req.dbUser = dbUser;
  } catch (e) {
    console.error('Auth token verification failed:', e.message);
    // Token expired or invalid — treat as unauthenticated
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

module.exports = { extractUser, requireAuth };
