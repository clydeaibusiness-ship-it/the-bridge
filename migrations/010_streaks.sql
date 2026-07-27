-- ============================================================
-- Migration 010: The Walk — member streaks (Phase A of the habit loop)
-- Run in: Supabase Dashboard → SQL Editor → New Query → Paste → Run
-- Safe to run multiple times.
--
-- Streak = consecutive days the member showed up for their business
-- (talked to Earl, replied to a pulse, or closed an action step).
-- Two grace days per week are banked automatically so it bends
-- before it breaks.
-- ============================================================

ALTER TABLE member_state ADD COLUMN IF NOT EXISTS current_streak INTEGER DEFAULT 0;
ALTER TABLE member_state ADD COLUMN IF NOT EXISTS longest_streak INTEGER DEFAULT 0;
ALTER TABLE member_state ADD COLUMN IF NOT EXISTS streak_last_date DATE;
ALTER TABLE member_state ADD COLUMN IF NOT EXISTS streak_grace_used INTEGER DEFAULT 0;
ALTER TABLE member_state ADD COLUMN IF NOT EXISTS streak_week_start DATE;
ALTER TABLE member_state ADD COLUMN IF NOT EXISTS streak_milestone_sent INTEGER DEFAULT 0;

-- ============================================================
-- DONE.
-- ============================================================
