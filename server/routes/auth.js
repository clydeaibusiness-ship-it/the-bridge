const express = require('express');
const router = express.Router();
const { createUser, getUserByClerkId } = require('../services/supabase');
const { sendWelcomeEmail } = require('../services/email');

// Clerk client - try the new SDK, fall back gracefully
let clerkClient = null;
try {
  const { createClerkClient } = require('@clerk/backend');
  if (process.env.CLERK_SECRET_KEY) {
    clerkClient = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });
  }
} catch (e) {
  console.log('Clerk backend SDK not available, using email-only auth');
}

/**
 * GET /api/auth/me
 * Check if user is authenticated via Clerk session token
 */
router.get('/me', async (req, res) => {
  try {
    if (!clerkClient) {
      return res.status(503).json({ error: 'Auth not configured' });
    }

    // Clerk sets __session cookie or Authorization header
    const token = req.cookies?.__session || req.headers.authorization?.replace('Bearer ', '');
    if (!token) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const { sub } = await clerkClient.verifyToken(token);
    const user = await clerkClient.users.getUser(sub);
    res.json({
      id: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.emailAddresses?.[0]?.emailAddress
    });
  } catch (e) {
    res.status(401).json({ error: 'Not authenticated' });
  }
});

/**
 * POST /api/auth/magic-link
 * Deprecated — all auth goes through Clerk.
 */
router.post('/magic-link', (req, res) => {
  res.status(410).json({ error: 'Magic link auth removed. Use Clerk sign-in.' });
});

/**
 * POST /api/auth/webhook
 * Clerk webhook handler — user created, session created, etc.
 */
router.post('/webhook', async (req, res) => {
  try {
    // TODO: Verify webhook signature using CLERK_WEBHOOK_SECRET
    const event = req.body;

    if (event.type === 'user.created') {
      const { id: clerkId, email_addresses } = event.data;
      const email = email_addresses?.[0]?.email_address;

      if (email) {
        await createUser(clerkId, email);
        await sendWelcomeEmail(email, 'your ship');
      }
    }

    res.json({ received: true });
  } catch (e) {
    console.error('Clerk webhook error:', e.message);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

/**
 * GET /api/auth/logout
 * Clear session and redirect
 */
router.get('/logout', (req, res) => {
  // TODO: Clerk session invalidation
  res.redirect('/');
});

module.exports = router;
