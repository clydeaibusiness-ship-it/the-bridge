-- ============================================================
-- Migration 003: Add missing columns to existing tables
-- Run in: Supabase Dashboard → SQL Editor → New Query → Paste → Run
-- Safe to run multiple times (uses IF NOT EXISTS / exception handling)
-- ============================================================

-- ============================================================
-- user_intake — grant radar columns that CREATE TABLE IF NOT EXISTS skipped
-- ============================================================
ALTER TABLE user_intake ADD COLUMN IF NOT EXISTS city TEXT;
ALTER TABLE user_intake ADD COLUMN IF NOT EXISTS state TEXT;
ALTER TABLE user_intake ADD COLUMN IF NOT EXISTS county TEXT;
ALTER TABLE user_intake ADD COLUMN IF NOT EXISTS legal_entity TEXT;
ALTER TABLE user_intake ADD COLUMN IF NOT EXISTS granular_revenue TEXT;
ALTER TABLE user_intake ADD COLUMN IF NOT EXISTS owner_demographics TEXT[];
ALTER TABLE user_intake ADD COLUMN IF NOT EXISTS grant_fund_use TEXT;
ALTER TABLE user_intake ADD COLUMN IF NOT EXISTS sam_registration TEXT;
ALTER TABLE user_intake ADD COLUMN IF NOT EXISTS naics_code TEXT;
ALTER TABLE user_intake ADD COLUMN IF NOT EXISTS grant_intake_complete BOOLEAN DEFAULT false;
ALTER TABLE user_intake ADD COLUMN IF NOT EXISTS grant_radar_acknowledged BOOLEAN DEFAULT false;
ALTER TABLE user_intake ADD COLUMN IF NOT EXISTS next_scan_date TIMESTAMPTZ;
ALTER TABLE user_intake ADD COLUMN IF NOT EXISTS exact_revenue INTEGER;
ALTER TABLE user_intake ADD COLUMN IF NOT EXISTS exact_employee_count INTEGER;
ALTER TABLE user_intake ADD COLUMN IF NOT EXISTS business_basics_completed BOOLEAN DEFAULT false;

-- Session/simulator fields
ALTER TABLE user_intake ADD COLUMN IF NOT EXISTS ship_name TEXT;
ALTER TABLE user_intake ADD COLUMN IF NOT EXISTS destination_name TEXT;
ALTER TABLE user_intake ADD COLUMN IF NOT EXISTS industry_key TEXT;
ALTER TABLE user_intake ADD COLUMN IF NOT EXISTS flavor_text TEXT;
ALTER TABLE user_intake ADD COLUMN IF NOT EXISTS business_context TEXT;
ALTER TABLE user_intake ADD COLUMN IF NOT EXISTS chart_sections JSONB;
ALTER TABLE user_intake ADD COLUMN IF NOT EXISTS scanned_content TEXT;
ALTER TABLE user_intake ADD COLUMN IF NOT EXISTS intake_completed_at TIMESTAMPTZ;
ALTER TABLE user_intake ADD COLUMN IF NOT EXISTS simulator_resources JSONB;

-- ============================================================
-- commander_messages — soul_version column
-- ============================================================
ALTER TABLE commander_messages ADD COLUMN IF NOT EXISTS soul_version TEXT DEFAULT NULL;

-- ============================================================
-- grant_radar_results — detail columns
-- ============================================================
DO $$ BEGIN
  ALTER TABLE grant_radar_results ADD COLUMN detail_data JSONB;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE grant_radar_results ADD COLUMN fetch_failed BOOLEAN DEFAULT false;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- ============================================================
-- DONE. All missing columns added.
-- ============================================================
