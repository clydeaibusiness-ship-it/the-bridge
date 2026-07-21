-- ============================================================
-- Migration 009: Push notifications + Earl-initiated check-ins
-- Run in: Supabase Dashboard → SQL Editor → New Query → Paste → Run
-- Safe to run multiple times (IF NOT EXISTS everywhere).
--
-- Replaces the check-in popup with Earl-initiated messages delivered
-- as phone push notifications and recorded in the chat thread.
-- Also adds goal completion (member-confirmed, in conversation).
-- ============================================================

-- Web-push subscriptions — one row per device/browser a member enabled.
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  keys JSONB NOT NULL,                    -- { p256dh, auth }
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  last_used_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_push_subs_user ON push_subscriptions(user_id);

ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role_push_subs" ON push_subscriptions;
CREATE POLICY "service_role_push_subs" ON push_subscriptions FOR ALL
  USING (true) WITH CHECK (true);

-- Earl-initiated check-ins — a log of every message Earl composed and sent
-- on his own initiative. The message itself lives in commander_messages;
-- this table drives cadence ("when did Earl last reach out?").
CREATE TABLE IF NOT EXISTS earl_checkins (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  session_id UUID,
  content TEXT NOT NULL,
  pushed BOOLEAN DEFAULT false,           -- at least one push delivery succeeded
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_earl_checkins_user ON earl_checkins(user_id, created_at DESC);

ALTER TABLE earl_checkins ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role_earl_checkins" ON earl_checkins;
CREATE POLICY "service_role_earl_checkins" ON earl_checkins FOR ALL
  USING (true) WITH CHECK (true);

-- Goal completion — a goal (benchmark) is now closed out in conversation:
-- all its action steps done, or the member says they hit it, Earl asks
-- "mark it complete?", member confirms, Earl calls the tool.
ALTER TABLE member_benchmarks ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;

-- ============================================================
-- DONE.
-- ============================================================
