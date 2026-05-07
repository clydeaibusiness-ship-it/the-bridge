const express = require('express');
const router = express.Router();
const { createUser, getUserByClerkId } = require('../services/supabase');
const { sendWelcomeEmail } = require('../services/email');

/**
 * POST /api/auth/magic-link
 * Initiate Clerk magic link authentication
 */
router.post('/magic-link', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email required' });

    // TODO: Clerk magic link initiation
    // const clerk = require('@clerk/clerk-sdk-node');
    // await clerk.emails.createEmail({ ... });

    res.json({ sent: true });
  } catch (e) {
    console.error('Magic link error:', e.message);
    res.status(500).json({ error: 'Failed to send magic link' });
  }
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
