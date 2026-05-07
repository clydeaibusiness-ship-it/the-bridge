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
 * POST /api/auth/magic-link
 * Create a sign-in token and send email via Resend as fallback
 */
router.post('/magic-link', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email required' });

    if (clerkClient) {
      // Try Clerk's sign-in creation
      try {
        const signIn = await clerkClient.signIns.create({
          identifier: email,
          strategy: 'email_link',
          redirectUrl: `${process.env.BASE_URL || 'https://the-bridge-app-production.up.railway.app'}/dashboard`
        });
        return res.json({ sent: true, method: 'clerk' });
      } catch (clerkErr) {
        console.error('Clerk sign-in error:', clerkErr.message);
      }
    }

    // Fallback: send a simple magic link via Resend
    const { Resend } = require('resend');
    if (process.env.RESEND_API_KEY) {
      const resend = new Resend(process.env.RESEND_API_KEY);
      const token = Buffer.from(JSON.stringify({ email, ts: Date.now() })).toString('base64url');
      const link = `${process.env.BASE_URL || 'https://the-bridge-app-production.up.railway.app'}/api/auth/verify?token=${token}`;

      await resend.emails.send({
        from: 'The Bridge <captain@captainsbridge.io>',
        to: email,
        subject: 'Your sign-in link for The Bridge',
        html: `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:40px 20px;">
          <p style="font-size:16px;">Click the link below to sign in to The Bridge:</p>
          <p style="margin:24px 0;"><a href="${link}" style="display:inline-block;background:#0a0a0f;color:#f5f0e8;padding:14px 32px;text-decoration:none;font-size:14px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;border-radius:2px;">Sign In to The Bridge</a></p>
          <p style="font-size:13px;color:#888;">This link expires in 15 minutes.</p>
        </div>`
      });
      return res.json({ sent: true, method: 'email' });
    }

    res.status(503).json({ error: 'Email service not configured' });
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
