/**
 * Clerk auth middleware — extracts user from session token.
 * Sets req.userId (Clerk user ID) and req.dbUser (Supabase users row) if authenticated.
 * Does NOT block unauthenticated requests — routes decide that.
 */
const { getUserByClerkId, createUser } = require('../services/supabase');

let clerkClient = null;
try {
  const { createClerkClient } = require('@clerk/backend');
  if (process.env.CLERK_SECRET_KEY) {
    clerkClient = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });
  }
} catch (e) {
  console.log('Clerk backend SDK not available');
}

async function extractUser(req, res, next) {
  req.userId = null;
  req.dbUser = null;

  if (!clerkClient) return next();

  try {
    const token = req.cookies?.__session || req.headers.authorization?.replace('Bearer ', '');
    if (!token) return next();

    const { sub } = await clerkClient.verifyToken(token);
    req.userId = sub;

    // Look up or auto-create Supabase user
    let dbUser = await getUserByClerkId(sub);
    if (!dbUser) {
      const clerkUser = await clerkClient.users.getUser(sub);
      const email = clerkUser.emailAddresses?.[0]?.emailAddress || '';
      dbUser = await createUser(sub, email);
    }
    req.dbUser = dbUser;
  } catch (e) {
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
