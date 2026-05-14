-- ============================================================
-- THE BRIDGE — Complete Database Schema
-- Run in: Supabase Dashboard → SQL Editor → New Query → Paste → Run
-- Safe to run multiple times (uses IF NOT EXISTS everywhere)
-- ============================================================

-- ============================================================
-- 1. USERS
-- ============================================================
CREATE TABLE IF NOT EXISTS users (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  clerk_id TEXT UNIQUE NOT NULL,
  email TEXT,
  membership_tier TEXT DEFAULT 'free',
  stripe_customer_id TEXT,
  commander_sessions_used INTEGER DEFAULT 0,
  commander_sessions_reset_date DATE DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_users_clerk ON users(clerk_id);

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_users" ON users FOR ALL
  USING (true) WITH CHECK (true);

-- ============================================================
-- 2. GAME STATE
-- ============================================================
CREATE TABLE IF NOT EXISTS game_state (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE UNIQUE,
  ship_name TEXT,
  destination_name TEXT,
  flavor_text TEXT,
  current_sector INTEGER DEFAULT 1,
  passenger_count INTEGER DEFAULT 0,
  lever_config JSONB,
  momentum NUMERIC,
  resilience NUMERIC,
  clarity NUMERIC,
  run_number INTEGER DEFAULT 1,
  last_saved TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_game_state_user ON game_state(user_id);

ALTER TABLE game_state ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_game_state" ON game_state FOR ALL
  USING (true) WITH CHECK (true);

-- ============================================================
-- 3. RUN HISTORY
-- ============================================================
CREATE TABLE IF NOT EXISTS run_history (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  run_number INTEGER,
  threat_log JSONB,
  lever_decisions JSONB,
  final_momentum NUMERIC,
  final_resilience NUMERIC,
  final_clarity NUMERIC,
  killing_threat TEXT,
  debrief_text TEXT,
  completed_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_run_history_user ON run_history(user_id);

ALTER TABLE run_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_run_history" ON run_history FOR ALL
  USING (true) WITH CHECK (true);

-- ============================================================
-- 4. ANONYMOUS EVENTS (free trial tracking)
-- ============================================================
CREATE TABLE IF NOT EXISTS anonymous_events (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id TEXT UNIQUE NOT NULL,
  industry TEXT,
  biggest_uncertainty TEXT,
  starting_levers JSONB,
  threats_encountered JSONB,
  turns_survived INTEGER DEFAULT 0,
  email_captured BOOLEAN DEFAULT false,
  converted_to_member BOOLEAN DEFAULT false,
  session_start TIMESTAMPTZ DEFAULT now(),
  last_event TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_anon_session ON anonymous_events(session_id);

ALTER TABLE anonymous_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_anon_events" ON anonymous_events FOR ALL
  USING (true) WITH CHECK (true);

-- ============================================================
-- 5. USER INTAKE (unified onboarding + grant radar intake fields)
-- ============================================================
CREATE TABLE IF NOT EXISTS user_intake (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE UNIQUE,
  business_name TEXT,
  website_url TEXT,
  facebook_url TEXT,
  business_description TEXT,
  years_operating TEXT,
  revenue_range TEXT,
  team_size TEXT,
  repeat_vs_new TEXT,
  switching_costs TEXT,
  systems_dependency TEXT,
  financial_state TEXT,
  biggest_uncertainty TEXT,
  success_in_one_year TEXT,
  website_content TEXT,
  facebook_content TEXT,
  industry TEXT,
  differentiator TEXT,
  challenge TEXT,
  exact_revenue INTEGER,
  exact_employee_count INTEGER,
  business_basics_completed BOOLEAN DEFAULT false,
  -- Grant radar intake fields
  city TEXT,
  state TEXT,
  county TEXT,
  legal_entity TEXT,
  granular_revenue TEXT,
  owner_demographics TEXT[],
  grant_fund_use TEXT,
  sam_registration TEXT,
  naics_code TEXT,
  grant_intake_complete BOOLEAN DEFAULT false,
  grant_radar_acknowledged BOOLEAN DEFAULT false,
  next_scan_date TIMESTAMPTZ,
  -- Session/simulator fields
  ship_name TEXT,
  destination_name TEXT,
  industry_key TEXT,
  flavor_text TEXT,
  business_context TEXT,
  chart_sections JSONB,
  scanned_content TEXT,
  intake_completed_at TIMESTAMPTZ,
  simulator_resources JSONB,
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_intake_user ON user_intake(user_id);

ALTER TABLE user_intake ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_intake" ON user_intake FOR ALL
  USING (true) WITH CHECK (true);

-- ============================================================
-- 6. COMMANDER MESSAGES
-- ============================================================
CREATE TABLE IF NOT EXISTS commander_messages (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  session_id UUID NOT NULL,
  message_role TEXT NOT NULL CHECK (message_role IN ('user', 'assistant')),
  message_content TEXT NOT NULL,
  soul_version TEXT DEFAULT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cmdr_msg_user ON commander_messages(user_id);
CREATE INDEX IF NOT EXISTS idx_cmdr_msg_session ON commander_messages(session_id);
CREATE INDEX IF NOT EXISTS idx_cmdr_msg_created ON commander_messages(user_id, created_at DESC);

ALTER TABLE commander_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_cmdr_msg" ON commander_messages FOR ALL
  USING (true) WITH CHECK (true);

-- ============================================================
-- 7. COMMANDER SUMMARIES
-- ============================================================
CREATE TABLE IF NOT EXISTS commander_summaries (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  session_id UUID NOT NULL,
  summary TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cmdr_sum_user ON commander_summaries(user_id, created_at DESC);

ALTER TABLE commander_summaries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_cmdr_sum" ON commander_summaries FOR ALL
  USING (true) WITH CHECK (true);

-- ============================================================
-- 8. COMMANDER SESSION NOTES (compression/long-term memory)
-- ============================================================
CREATE TABLE IF NOT EXISTS commander_session_notes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  session_id UUID NOT NULL,
  operator_insights TEXT,
  strategic_ground TEXT,
  unresolved_threads TEXT,
  conversation_turn_count INTEGER,
  generated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_csn_user ON commander_session_notes(user_id);

ALTER TABLE commander_session_notes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_csn" ON commander_session_notes FOR ALL
  USING (true) WITH CHECK (true);

-- ============================================================
-- 9. GRANT RADAR INTAKE (full 20-45 question form)
-- ============================================================
CREATE TABLE IF NOT EXISTS grant_radar_intake (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE UNIQUE,
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
  q21_conducts_rd TEXT,
  q22_has_ip TEXT,
  q23_university_partnerships TEXT,
  q24_professional_licenses TEXT,
  q24_licenses_detail TEXT,
  q25_facility TEXT,
  q26_equipment_value INTEGER,
  q27_mission_statement TEXT,
  q28_population_served TEXT,
  q29_has_board TEXT,
  q30_annual_budget INTEGER,
  q31_area_population TEXT,
  q32_creates_local_jobs TEXT,
  q33_currently_exports TEXT,
  q34_target_markets TEXT,
  q35_training_employee_count INTEGER,
  q36_training_skills TEXT,
  q37_additional_info TEXT,
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

-- ============================================================
-- 10. GRANT RADAR RESULTS (scan output)
-- ============================================================
CREATE TABLE IF NOT EXISTS grant_radar_results (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  results_json JSONB,
  detail_data JSONB,
  fetch_failed BOOLEAN DEFAULT false,
  scan_date TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_grr_user ON grant_radar_results(user_id);

ALTER TABLE grant_radar_results ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_grr" ON grant_radar_results FOR ALL
  USING (true) WITH CHECK (true);

-- ============================================================
-- 11. SAVED GRANTS
-- ============================================================
CREATE TABLE IF NOT EXISTS saved_grants (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  grant_name TEXT NOT NULL,
  grant_url TEXT,
  grant_description TEXT,
  grant_amount TEXT,
  jurisdiction TEXT,
  full_result_json JSONB,
  date_saved TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_saved_grants_user ON saved_grants(user_id);

ALTER TABLE saved_grants ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_saved_grants" ON saved_grants FOR ALL
  USING (true) WITH CHECK (true);

-- ============================================================
-- 12. GRANT APPLICATIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS grant_applications (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  grant_name TEXT NOT NULL,
  grant_url TEXT,
  grant_amount_available TEXT,
  date_applied DATE,
  status TEXT DEFAULT 'applied',
  outcome TEXT,
  amount_received NUMERIC,
  verification_image_url TEXT,
  verified BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_grant_apps_user ON grant_applications(user_id);

ALTER TABLE grant_applications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_grant_apps" ON grant_applications FOR ALL
  USING (true) WITH CHECK (true);

-- ============================================================
-- 13. GRANT WINS
-- ============================================================
CREATE TABLE IF NOT EXISTS grant_wins (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  grant_name TEXT NOT NULL,
  amount_received NUMERIC,
  jurisdiction TEXT,
  verified_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_grant_wins_user ON grant_wins(user_id);

ALTER TABLE grant_wins ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_grant_wins" ON grant_wins FOR ALL
  USING (true) WITH CHECK (true);

-- ============================================================
-- 14. GRANT WINS TEST (test mode mirror)
-- ============================================================
CREATE TABLE IF NOT EXISTS grant_wins_test (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  grant_name TEXT NOT NULL,
  amount_received NUMERIC,
  jurisdiction TEXT,
  verified_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE grant_wins_test ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_grant_wins_test" ON grant_wins_test FOR ALL
  USING (true) WITH CHECK (true);

-- ============================================================
-- 15. RPC: increment_commander_sessions
-- ============================================================
CREATE OR REPLACE FUNCTION increment_commander_sessions(user_id_input UUID)
RETURNS void AS $$
BEGIN
  UPDATE users
  SET commander_sessions_used = COALESCE(commander_sessions_used, 0) + 1
  WHERE id = user_id_input;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 16. STORAGE BUCKET (for grant verification documents)
-- ============================================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('grant-verification-documents', 'grant-verification-documents', false)
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- DONE. All 14 tables + 1 RPC function + 1 storage bucket created.
-- ============================================================
