-- Migration 002: Grant Radar Intake table + revenue/employee exact numbers
-- Run in Supabase SQL Editor

-- 1. Grant Radar Intake table — stores all branching question answers
CREATE TABLE IF NOT EXISTS grant_radar_intake (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE UNIQUE,
  
  -- Core questions (1-20)
  q1_legal_name TEXT,
  q2_has_ein TEXT,                    -- 'yes' | 'no' | 'unsure'
  q3_sam_registered TEXT,             -- 'yes' | 'no' | 'unsure'
  q4_street_address TEXT,
  q5_business_description TEXT,
  q6_problem_solved TEXT,
  q7_primary_fund_use TEXT,
  q8_annual_revenue INTEGER,
  q9_employee_count INTEGER,
  q10_years_operating TEXT,
  q11_legal_structure TEXT,
  q12_owner_demographics TEXT[],      -- array of strings
  q13_separate_bank_account TEXT,     -- 'yes' | 'no'
  q14_filed_tax_returns TEXT,         -- 'yes' | 'no'
  q15_business_plan TEXT,             -- 'yes' | 'complete' | 'partial' | 'no'
  q16_short_term_goals TEXT,
  q17_success_metrics TEXT,
  q18_prior_grants TEXT,              -- 'yes_received' | 'yes_not_received' | 'no'
  q18_prior_grants_detail TEXT,
  q19_current_gov_funding TEXT,       -- 'yes' | 'no'
  q20_naics_code TEXT,
  
  -- Branch A: Technology and Innovation
  q21_conducts_rd TEXT,               -- 'yes' | 'no'
  q22_has_ip TEXT,                    -- 'yes' | 'no' | 'in_progress'
  q23_university_partnerships TEXT,   -- 'yes' | 'no'
  
  -- Branch B: Construction/Trades/Manufacturing
  q24_professional_licenses TEXT,     -- 'yes' + detail or 'no'
  q24_licenses_detail TEXT,
  q25_facility TEXT,                  -- 'own' | 'lease' | 'neither'
  q26_equipment_value INTEGER,
  
  -- Branch C: Nonprofit
  q27_mission_statement TEXT,
  q28_population_served TEXT,
  q29_has_board TEXT,                 -- 'yes' | 'no'
  q30_annual_budget INTEGER,
  
  -- Branch D: Rural/Distressed
  q31_area_population TEXT,           -- 'under_2500' | '2500_10000' | '10000_50000' | 'over_50000'
  q32_creates_local_jobs TEXT,        -- 'yes' | 'plans_to' | 'no'
  
  -- Branch E: Export/International
  q33_currently_exports TEXT,         -- 'yes' | 'no' | 'planning'
  q34_target_markets TEXT,
  
  -- Branch F: Workforce/Training
  q35_training_employee_count INTEGER,
  q36_training_skills TEXT,
  
  -- Final question
  q37_additional_info TEXT,
  
  -- Metadata
  completed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT now(),
  
  -- Branch flags (computed from business basics before form opens)
  branch_a_active BOOLEAN DEFAULT false,
  branch_b_active BOOLEAN DEFAULT false,
  branch_c_active BOOLEAN DEFAULT false,
  branch_d_active BOOLEAN DEFAULT false,
  branch_e_active BOOLEAN DEFAULT false,
  branch_f_active BOOLEAN DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_gri_user ON grant_radar_intake(user_id);

-- 2. Add exact revenue and employee count columns to user_intake
ALTER TABLE user_intake ADD COLUMN IF NOT EXISTS exact_revenue INTEGER;
ALTER TABLE user_intake ADD COLUMN IF NOT EXISTS exact_employee_count INTEGER;

-- 3. Add onboarding tracking
ALTER TABLE user_intake ADD COLUMN IF NOT EXISTS business_basics_completed BOOLEAN DEFAULT false;

-- 4. RLS
ALTER TABLE grant_radar_intake ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_gri" ON grant_radar_intake FOR ALL
  USING (true) WITH CHECK (true);
