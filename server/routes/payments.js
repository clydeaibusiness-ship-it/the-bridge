const express = require('express');
const router = express.Router();
const { updateMembershipTier, updateStripeCustomerId, getUserByClerkId, getOrCreateUser, createPendingActivation } = require('../services/supabase');
const { sendSubscriptionConfirmation } = require('../services/email');

/**
 * GET /api/payments/checkout-redirect
 * Simple redirect to Stripe Checkout — no JS required
 */
const PRICE_ID = process.env.STRIPE_PRICE_ID_EARL;

router.get('/checkout-redirect', async (req, res) => {
  try {
    if (!process.env.STRIPE_SECRET_KEY || !PRICE_ID) {
      return res.status(503).send('Payments not configured');
    }

    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      allow_promotion_codes: true,
      line_items: [{ price: PRICE_ID, quantity: 1 }],
      success_url: `${process.env.BASE_URL || 'https://captainsbridge.io'}/dashboard?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.BASE_URL || 'https://captainsbridge.io'}/#pricing`
    });

    res.redirect(303, session.url);
  } catch (e) {
    console.error('Checkout redirect error:', e.message);
    res.status(500).send('Failed to start checkout. Please try again.');
  }
});

/**
 * POST /api/payments/create-checkout
 * Create Stripe Checkout Session
 */
router.post('/create-checkout', async (req, res) => {
  try {
    const { email, clerkId } = req.body;

    if (!process.env.STRIPE_SECRET_KEY || !PRICE_ID) {
      return res.status(503).json({ error: 'Payments not configured' });
    }

    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

    const sessionParams = {
      mode: 'payment',
      payment_method_types: ['card'],
      allow_promotion_codes: true,
      line_items: [{ price: PRICE_ID, quantity: 1 }],
      success_url: `${process.env.BASE_URL || 'https://captainsbridge.io'}/dashboard?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.BASE_URL || 'https://captainsbridge.io'}/#pricing`,
      metadata: {}
    };

    if (email) sessionParams.customer_email = email;
    if (clerkId) sessionParams.metadata.clerk_id = clerkId;

    const session = await stripe.checkout.sessions.create(sessionParams);

    res.json({ url: session.url });
  } catch (e) {
    console.error('Checkout error:', e.message, e.type || '');
    res.status(500).json({ error: 'Failed to create checkout session', detail: e.message });
  }
});

/**
 * POST /api/payments/webhook
 * Stripe webhook handler
 * Note: This route receives raw body (configured in index.js)
 */
router.post('/webhook', async (req, res) => {
  if (!process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_WEBHOOK_SECRET) {
    return res.status(503).json({ error: 'Payments not configured' });
  }

  const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

  let event;
  try {
    const sig = req.headers['stripe-signature'];
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (e) {
    console.error('Stripe webhook signature verification failed:', e.message);
    return res.status(400).json({ error: 'Invalid signature' });
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        const clerkId = session.metadata?.clerk_id;
        const customerId = session.customer;
        const customerEmail = (session.customer_details?.email || session.customer_email || '').toLowerCase();

        if (clerkId) {
          // Normal flow: Clerk sign-up → Stripe payment. Activate immediately.
          const user = await getUserByClerkId(clerkId);
          if (user) {
            await updateMembershipTier(user.id, 'captain');
            await updateStripeCustomerId(user.id, customerId);
            await sendSubscriptionConfirmation(user.email);
            try {
              await require('../services/newsletter/store').addSubscriber({ email: user.email, userId: user.id, source: 'member' });
            } catch (e) {
              console.error('Newsletter auto-subscribe failed:', e.message);
            }
          }
        } else if (customerEmail) {
          // Ad flow: Stripe payment before Clerk sign-up.
          // Check if a Clerk account already exists for this email (e.g. returning visitor).
          let activated = false;
          try {
            let clerkBackend = null;
            try { clerkBackend = require('@clerk/backend'); } catch (_) {}
            if (clerkBackend && process.env.CLERK_SECRET_KEY) {
              const clerk = clerkBackend.createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });
              const existing = await clerk.users.getUserList({ emailAddress: [customerEmail] });
              const clerkUser = existing.data?.[0] || existing[0];
              if (clerkUser) {
                const user = await getOrCreateUser(clerkUser.id, customerEmail);
                if (user) {
                  await updateMembershipTier(user.id, 'captain');
                  await updateStripeCustomerId(user.id, customerId);
                  await sendSubscriptionConfirmation(customerEmail);
                  try {
                    await require('../services/newsletter/store').addSubscriber({ email: customerEmail, userId: user.id, source: 'member' });
                  } catch (_) {}
                  activated = true;
                }
              }
            }
          } catch (e) {
            console.error('Ad-flow Clerk lookup failed:', e.message);
          }

          if (!activated) {
            // No Clerk account yet. Store pending activation — consumed when they sign up.
            await createPendingActivation({ email: customerEmail, stripeCustomerId: customerId });
            await sendSubscriptionConfirmation(customerEmail);
            console.log('[webhook] pending activation stored for', customerEmail);
          }
        }
        break;
      }
    }

    res.json({ received: true });
  } catch (e) {
    console.error('Stripe webhook processing error:', e.message);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

/**
 * POST /api/payments/portal
 * Create Stripe Customer Portal session for self-serve management
 */
router.post('/portal', async (req, res) => {
  try {
    const { stripeCustomerId } = req.body;

    if (!process.env.STRIPE_SECRET_KEY) {
      return res.status(503).json({ error: 'Payments not configured' });
    }

    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

    const session = await stripe.billingPortal.sessions.create({
      customer: stripeCustomerId,
      return_url: `${process.env.BASE_URL}/dashboard`
    });

    res.json({ url: session.url });
  } catch (e) {
    console.error('Portal error:', e.message);
    res.status(500).json({ error: 'Failed to create portal session' });
  }
});

module.exports = router;
