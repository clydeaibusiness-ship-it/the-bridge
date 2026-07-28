-- ============================================================
-- Migration 012: One Friend (Phase D — accountability + alumni)
-- Run in: Supabase Dashboard → SQL Editor (project xxvzbdtvmtrasbantazt)
-- Safe to run multiple times.
--
-- Each member can invite ONE person who holds them to it. Once a month
-- Earl drafts a one-paragraph progress note; the member approves it
-- before it is emailed to their friend. (YouVersion's finding: even one
-- friend in the loop measurably deepens engagement.)
-- ============================================================

ALTER TABLE member_state ADD COLUMN IF NOT EXISTS friend_name TEXT;
ALTER TABLE member_state ADD COLUMN IF NOT EXISTS friend_email TEXT;
ALTER TABLE member_state ADD COLUMN IF NOT EXISTS friend_from_name TEXT;
ALTER TABLE member_state ADD COLUMN IF NOT EXISTS friend_invited_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS friend_notes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  note TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft'    -- 'draft' | 'sent' | 'skipped'
    CHECK (status IN ('draft', 'sent', 'skipped')),
  created_at TIMESTAMPTZ DEFAULT now(),
  sent_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_friend_notes_user ON friend_notes(user_id, created_at DESC);

ALTER TABLE friend_notes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role_friend_notes" ON friend_notes;
CREATE POLICY "service_role_friend_notes" ON friend_notes FOR ALL
  USING (true) WITH CHECK (true);

-- ============================================================
-- DONE.
-- ============================================================
