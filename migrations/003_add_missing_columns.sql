-- ============================================================
-- Migration 003: Add missing columns to existing tables
-- Run in: Supabase Dashboard → SQL Editor → New Query → Paste → Run
-- Safe to run multiple times (uses IF NOT EXISTS / exception handling)
-- ============================================================

-- ============================================================
-- user_intake — additional columns that CREATE TABLE IF NOT EXISTS skipped
-- ============================================================
ALTER TABLE user_intake ADD COLUMN IF NOT EXISTS city TEXT;
ALTER TABLE user_intake ADD COLUMN IF NOT EXISTS state TEXT;
ALTER TABLE user_intake ADD COLUMN IF NOT EXISTS county TEXT;
ALTER TABLE user_intake ADD COLUMN IF NOT EXISTS legal_entity TEXT;
ALTER TABLE user_intake ADD COLUMN IF NOT EXISTS granular_revenue TEXT;
ALTER TABLE user_intake ADD COLUMN IF NOT EXISTS owner_demographics TEXT[];
ALTER TABLE user_intake ADD COLUMN IF NOT EXISTS exact_revenue INTEGER;
ALTER TABLE user_intake ADD COLUMN IF NOT EXISTS exact_employee_count INTEGER;
ALTER TABLE user_intake ADD COLUMN IF NOT EXISTS business_basics_completed BOOLEAN DEFAULT false;

-- ============================================================
-- commander_messages — soul_version column
-- ============================================================
ALTER TABLE commander_messages ADD COLUMN IF NOT EXISTS soul_version TEXT DEFAULT NULL;

-- ============================================================
-- DONE. All missing columns added.
-- ============================================================


