-- Migration 007: Pending member activations
-- For the direct-to-Stripe ad flow where someone pays before creating a Clerk
-- account. The webhook stores a row here; it is consumed and deleted when the
-- person signs up and getOrCreateUser fires for the first time.
-- Safe to run multiple times (IF NOT EXISTS everywhere).

CREATE TABLE IF NOT EXISTS pending_member_activations (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  email TEXT NOT NULL,
  stripe_customer_id TEXT,
  activated BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Only one pending (unactivated) row per email.
CREATE UNIQUE INDEX IF NOT EXISTS idx_pending_activations_email
  ON pending_member_activations(email)
  WHERE activated = false;

CREATE INDEX IF NOT EXISTS idx_pending_activations_activated
  ON pending_member_activations(activated);
