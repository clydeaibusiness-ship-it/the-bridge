const express = require('express');
const router = express.Router();
const { updateMembershipTier, updateStripeCustomerId, getUserByClerkId } = require('../services/supabase');
const { sendSubscriptionConfirmation } = require('../services/email');

/**
 * GET /api/payments/checkout-redirect
 * Simple redirect to Stripe Checkout — no JS required
 */
// Tier-to-price mapping
const TIER_PRICES = {
  navigator: {
    monthly: process.env.STRIPE_NAVIGATOR_MONTHLY_PRICE_ID,
    annual: process.env.STRIPE_NAVIGATOR_ANNUAL_PRICE_ID
  },
  captain: {
    monthly: process.env.STRIPE_CAPTAIN_MONTHLY_PRICE_ID,
    annual: process.env.STRIPE_CAPTAIN_ANNUAL_PRICE_ID
  },
  // Legacy fallback
  ensign: {
    monthly: process.env.STRIPE_ENSIGN_MONTHLY_PRICE_ID,
    annual: process.env.STRIPE_ENSIGN_ANNUAL_PRICE_ID
  }
};

function resolvePriceId(tier, interval) {
  const t = TIER_PRICES[tier] || TIER_PRICES.captain;
  return (interval === 'annual' ? t.annual : t.monthly) || t.monthly;
}

router.get('/checkout-redirect', async (req, res) => {
  try {
    if (!process.env.STRIPE_SECRET_KEY) {
      return res.status(503).send('Payments not configured');
    }

    const tier = req.query.tier || 'captain';
    const interval = req.query.interval || 'monthly';
    const priceId = resolvePriceId(tier, interval);

    if (!priceId) return res.status(400).send('Invalid tier or interval');

    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      allow_promotion_codes: true,
      line_items: [{ price: priceId, quantity: 1 }],
      metadata: { tier },
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
    const { priceId, email, clerkId } = req.body;

    if (!process.env.STRIPE_SECRET_KEY) {
      return res.status(503).json({ error: 'Payments not configured' });
    }

    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

    const tier = req.body.tier || 'captain';
    const interval = req.body.interval || 'monthly';
    const resolvedPrice = priceId || resolvePriceId(tier, interval);

    if (!resolvedPrice) {
      return res.status(400).json({ error: 'Invalid tier or interval' });
    }

    const sessionParams = {
      mode: 'subscription',
      payment_method_types: ['card'],
      allow_promotion_codes: true,
      line_items: [{ price: resolvedPrice, quantity: 1 }],
      success_url: `${process.env.BASE_URL || 'https://captainsbridge.io'}/dashboard?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.BASE_URL || 'https://captainsbridge.io'}/#pricing`,
      metadata: { tier }
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
        const tier = session.metadata?.tier || 'captain';

        if (clerkId) {
          const user = await getUserByClerkId(clerkId);
          if (user) {
            await updateMembershipTier(user.id, tier);
            await updateStripeCustomerId(user.id, customerId);
            await sendSubscriptionConfirmation(user.email);
          }
        }
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object;
        // Downgrade to free tier
        // TODO: Look up user by stripe_customer_id and downgrade
        break;
      }

      case 'invoice.payment_failed': {
        // TODO: Send payment failed notification
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
