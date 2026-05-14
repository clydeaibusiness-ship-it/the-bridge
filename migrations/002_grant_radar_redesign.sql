-- Migration 002: Grant Radar Redesign
-- Run this in Supabase SQL Editor (Dashboard → SQL Editor → New Query)
-- Then click "Run" to execute ALL statements at once.

-- ============================================
-- 1. Grant Radar Intake table (20-45 questions)
-- ============================================
CREATE TABLE IF NOT EXISTS grant_radar_intake (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE UNIQUE,
  
  -- Core questions (1-20)
  q1_legal_name TEXT,
  q2_has_ein TEXT,
  q3_sam_registered TEXT,
  q4_street_address TEXT,
  q5_business_description TEXT,
  q6_problem_solved TEXT,
  q7_primary_fund_use TEXT,
  q8_annual_revenue INTEGER,
  q9_employee_count INTEGER,
  q10_years_operating TEXT,
  q11_legal_structure TEXT,
  q12_owner_demographics TEXT[],
  q13_separate_bank_account TEXT,
  q14_filed_tax_returns TEXT,
  q15_business_plan TEXT,
  q16_short_term_goals TEXT,
  q17_success_metrics TEXT,
  q18_prior_grants TEXT,
  q18_prior_grants_detail TEXT,
  q19_current_gov_funding TEXT,
  q20_naics_code TEXT,
  
  -- Branch A: Technology
  q21_conducts_rd TEXT,
  q22_has_ip TEXT,
  q23_university_partnerships TEXT,
  
  -- Branch B: Construction/Trades/Manufacturing
  q24_professional_licenses TEXT,
  q24_licenses_detail TEXT,
  q25_facility TEXT,
  q26_equipment_value INTEGER,
  
  -- Branch C: Nonprofit
  q27_mission_statement TEXT,
  q28_population_served TEXT,
  q29_has_board TEXT,
  q30_annual_budget INTEGER,
  
  -- Branch D: Rural/Distressed
  q31_area_population TEXT,
  q32_creates_local_jobs TEXT,
  
  -- Branch E: Export
  q33_currently_exports TEXT,
  q34_target_markets TEXT,
  
  -- Branch F: Workforce
  q35_training_employee_count INTEGER,
  q36_training_skills TEXT,
  
  -- Final
  q37_additional_info TEXT,
  
  -- Metadata
  completed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT now(),
  branch_a_active BOOLEAN DEFAULT false,
  branch_b_active BOOLEAN DEFAULT false,
  branch_c_active BOOLEAN DEFAULT false,
  branch_d_active BOOLEAN DEFAULT false,
  branch_e_active BOOLEAN DEFAULT false,
  branch_f_active BOOLEAN DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_gri_user ON grant_radar_intake(user_id);

ALTER TABLE grant_radar_intake ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_gri" ON grant_radar_intake FOR ALL
  USING (true) WITH CHECK (true);

-- ============================================
-- 2. Add exact number columns to user_intake
-- ============================================
ALTER TABLE user_intake ADD COLUMN IF NOT EXISTS exact_revenue INTEGER;
ALTER TABLE user_intake ADD COLUMN IF NOT EXISTS exact_employee_count INTEGER;
ALTER TABLE user_intake ADD COLUMN IF NOT EXISTS business_basics_completed BOOLEAN DEFAULT false;

-- ============================================
-- 3. Add detail_data to grant_radar_results
-- ============================================
-- These may fail if the columns already exist — that's fine
DO $$ BEGIN
  ALTER TABLE grant_radar_results ADD COLUMN detail_data JSONB;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE grant_radar_results ADD COLUMN fetch_failed BOOLEAN DEFAULT false;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
