-- ============================================================
-- Migration 011: Earl's First Read (Phase C — free interview funnel)
-- Run in: Supabase Dashboard → SQL Editor → New Query → Paste → Run
-- (Project xxvzbdtvmtrasbantazt — the live Earl database.)
-- Safe to run multiple times.
--
-- Stage 1 of the interview is now free. When an unpaid visitor finishes
-- it, Earl gives them one genuine read on their business. It is stored
-- here so it stays word-for-word the same when they come back.
-- ============================================================

ALTER TABLE member_state ADD COLUMN IF NOT EXISTS first_read TEXT;

-- ============================================================
-- DONE.
-- ============================================================
