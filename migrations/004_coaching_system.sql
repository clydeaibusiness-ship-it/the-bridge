-- ============================================================
-- Migration 004: Coaching System (The Bridge as a coaching product)
-- Run in: Supabase Dashboard → SQL Editor → New Query → Paste → Run
-- Safe to run multiple times (IF NOT EXISTS everywhere).
--
-- Purely additive. Creates empty tables for the coaching lifecycle:
-- intake responses, benchmarks, action steps, check-ins, debriefs,
-- periodic reports, graduation records, anonymous aggregate data,
-- plus a per-member coaching-state row.
--
-- This migration does NOT touch the existing user_intake table and
-- does NOT backfill existing members. The intake cutover/backfill is
-- a separate migration run at the moment /intake is switched over.
-- ============================================================


-- ============================================================
-- 1. MEMBER STATE — one row per member, the coaching-lifecycle spine
-- ============================================================
CREATE TABLE IF NOT EXISTS member_state (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE UNIQUE,

  -- Intake progress (the gate is Stage 1)
  stage_1_complete BOOLEAN DEFAULT false,
  stage_2_complete BOOLEAN DEFAULT false,
  stage_3_complete BOOLEAN DEFAULT false,
  stage_1_completed_at TIMESTAMPTZ,
  stage_2_completed_at TIMESTAMPTZ,
  stage_3_completed_at TIMESTAMPTZ,

  -- Intake change allowance (3 total, locks at zero)
  intake_changes_remaining INTEGER DEFAULT 3,

  -- Hidden operational benchmark layer (Q7,Q10-Q16 etc.) — never shown to member
  hidden_metrics JSONB,

  -- Lifecycle clock
  coaching_started_at TIMESTAMPTZ DEFAULT now(),
  six_month_milestone_handled BOOLEAN DEFAULT false,
  graduated_at TIMESTAMPTZ,

  -- Extension (half price, requires owner confirmation before Stripe change)
  extension_offered BOOLEAN DEFAULT false,
  extension_pending_confirmation BOOLEAN DEFAULT false,
  extension_active BOOLEAN DEFAULT false,
  extension_started_at TIMESTAMPTZ,

  -- Referral (9-month, in-person coaching)
  referral_made BOOLEAN DEFAULT false,

  -- Anonymous data collection opt-out (default opted-in, disclosed in onboarding)
  anonymous_data_opt_out BOOLEAN DEFAULT false,

  -- Periodic report bookkeeping
  last_periodic_report_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_member_state_user ON member_state(user_id);

ALTER TABLE member_state ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role_member_state" ON member_state;
CREATE POLICY "service_role_member_state" ON member_state FOR ALL
  USING (true) WITH CHECK (true);


-- ============================================================
-- 2. INTAKE RESPONSES — one row per answered question (tall)
--    round 1 = initial intake; round 2+ = graduation exit interview
-- ============================================================
CREATE TABLE IF NOT EXISTS intake_responses (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  round INTEGER NOT NULL DEFAULT 1,
  stage INTEGER NOT NULL,                 -- 1, 2, or 3
  question_field TEXT NOT NULL,           -- e.g. 'desired_outcome', 'north_star'
  answer TEXT,
  follow_up_question TEXT,                -- the follow-up that was asked, if any
  follow_up_answer TEXT,                  -- the member's answer to the follow-up
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (user_id, round, question_field)
);

CREATE INDEX IF NOT EXISTS idx_intake_resp_user ON intake_responses(user_id);
CREATE INDEX IF NOT EXISTS idx_intake_resp_lookup ON intake_responses(user_id, round, stage);

ALTER TABLE intake_responses ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role_intake_resp" ON intake_responses;
CREATE POLICY "service_role_intake_resp" ON intake_responses FOR ALL
  USING (true) WITH CHECK (true);


-- ============================================================
-- 3. MEMBER BENCHMARKS — 3-5 success statements in the member's words
-- ============================================================
CREATE TABLE IF NOT EXISTS member_benchmarks (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  statement TEXT NOT NULL,                -- the member's own language
  position INTEGER DEFAULT 0,             -- display order
  starting_rating INTEGER,               -- 1-10 at creation
  current_rating INTEGER,                -- 1-10 latest
  approved BOOLEAN DEFAULT false,        -- member approved during review
  active BOOLEAN DEFAULT true,           -- member may remove a statement
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_benchmark_user ON member_benchmarks(user_id);

ALTER TABLE member_benchmarks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role_member_benchmarks" ON member_benchmarks;
CREATE POLICY "service_role_member_benchmarks" ON member_benchmarks FOR ALL
  USING (true) WITH CHECK (true);


-- ============================================================
-- 4. BENCHMARK RATINGS — rating history (the arc)
-- ============================================================
CREATE TABLE IF NOT EXISTS benchmark_ratings (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  benchmark_id UUID REFERENCES member_benchmarks(id) ON DELETE CASCADE,
  rating INTEGER NOT NULL,                -- 1-10
  source TEXT DEFAULT 'check_in',        -- 'check_in' | 'commander' | 'initial'
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bench_rating_user ON benchmark_ratings(user_id);
CREATE INDEX IF NOT EXISTS idx_bench_rating_bench ON benchmark_ratings(benchmark_id, created_at);

ALTER TABLE benchmark_ratings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role_benchmark_ratings" ON benchmark_ratings;
CREATE POLICY "service_role_benchmark_ratings" ON benchmark_ratings FOR ALL
  USING (true) WITH CHECK (true);


-- ============================================================
-- 5. ACTION STEPS — member commitments, in their exact words
-- ============================================================
CREATE TABLE IF NOT EXISTS action_steps (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  step_text TEXT NOT NULL,               -- member's exact words
  status TEXT NOT NULL DEFAULT 'active'  -- 'active' | 'completed' | 'did_not_happen'
    CHECK (status IN ('active', 'completed', 'did_not_happen')),
  target_date DATE,                      -- if the member gave one
  source_session_id UUID,                -- commander session it came from
  follow_up_answer TEXT,                 -- from the Type 2 check-in
  created_at TIMESTAMPTZ DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_action_steps_user ON action_steps(user_id);
CREATE INDEX IF NOT EXISTS idx_action_steps_status ON action_steps(user_id, status);

ALTER TABLE action_steps ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role_action_steps" ON action_steps;
CREATE POLICY "service_role_action_steps" ON action_steps FOR ALL
  USING (true) WITH CHECK (true);


-- ============================================================
-- 6. CHECK-INS — 30-second prompts (rating / action follow-up / subjective)
-- ============================================================
CREATE TABLE IF NOT EXISTS check_ins (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,                     -- 'metric' | 'action_followup' | 'subjective'
  prompt_text TEXT NOT NULL,
  benchmark_id UUID REFERENCES member_benchmarks(id) ON DELETE SET NULL,
  action_step_id UUID REFERENCES action_steps(id) ON DELETE SET NULL,
  subjective_key TEXT,                   -- which fixed subjective question, if type=subjective
  rating INTEGER,                        -- 1-10 answer, if applicable
  choice TEXT,                           -- 'done' | 'working' | 'did_not_happen', if action_followup
  text_answer TEXT,                      -- optional free text
  status TEXT NOT NULL DEFAULT 'pending' -- 'pending' | 'answered' | 'snoozed'
    CHECK (status IN ('pending', 'answered', 'snoozed')),
  snoozed_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  answered_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_check_ins_user ON check_ins(user_id);
CREATE INDEX IF NOT EXISTS idx_check_ins_pending ON check_ins(user_id, status, created_at);

ALTER TABLE check_ins ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role_check_ins" ON check_ins;
CREATE POLICY "service_role_check_ins" ON check_ins FOR ALL
  USING (true) WITH CHECK (true);


-- ============================================================
-- 7. SESSION DEBRIEFS — silent 2-3 sentence reflection after each chat
--    (member-facing, lives in the progress view; distinct from the
--     internal commander_session_notes compression memory)
-- ============================================================
CREATE TABLE IF NOT EXISTS session_debriefs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  session_id UUID NOT NULL,
  summary TEXT NOT NULL,                 -- 2-3 sentences for the member
  shift_detected BOOLEAN DEFAULT false,  -- meaningful-shift signal from background Haiku
  unresolved_item TEXT,                  -- one thread for the next pre-conversation prompt
  dismissed BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_debrief_user ON session_debriefs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_debrief_session ON session_debriefs(session_id);

ALTER TABLE session_debriefs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role_session_debriefs" ON session_debriefs;
CREATE POLICY "service_role_session_debriefs" ON session_debriefs FOR ALL
  USING (true) WITH CHECK (true);


-- ============================================================
-- 8. PERIODIC REPORTS — 28-day reflection letter from the Commander
-- ============================================================
CREATE TABLE IF NOT EXISTS periodic_reports (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  letter TEXT NOT NULL,                  -- 3-5 sentences
  period_start TIMESTAMPTZ,
  period_end TIMESTAMPTZ,
  read BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_periodic_user ON periodic_reports(user_id, created_at DESC);

ALTER TABLE periodic_reports ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role_periodic_reports" ON periodic_reports;
CREATE POLICY "service_role_periodic_reports" ON periodic_reports FOR ALL
  USING (true) WITH CHECK (true);


-- ============================================================
-- 9. GRADUATION RECORDS — before/after comparison + certificate
-- ============================================================
CREATE TABLE IF NOT EXISTS graduation_records (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  before_round INTEGER DEFAULT 1,        -- intake_responses round used as "before"
  after_round INTEGER,                   -- exit interview round used as "after"
  comparison JSONB,                      -- 3-5 plain-language changes
  started_on DATE,
  graduated_on DATE,
  certificate_issued BOOLEAN DEFAULT false,
  free_access_until DATE,                -- up to 6 months continued access
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_graduation_user ON graduation_records(user_id);

ALTER TABLE graduation_records ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role_graduation_records" ON graduation_records;
CREATE POLICY "service_role_graduation_records" ON graduation_records FOR ALL
  USING (true) WITH CHECK (true);


-- ============================================================
-- 10. ANONYMOUS AGGREGATE DATA — no personal identifiers
--     (members can opt out via member_state.anonymous_data_opt_out;
--      enforcement is in application code before insert)
-- ============================================================
CREATE TABLE IF NOT EXISTS anonymous_aggregate_data (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  event_type TEXT NOT NULL,              -- 'intake_answer' | 'check_in_rating' |
                                         -- 'action_completion' | 'benchmark_progress' | ...
  industry TEXT,                         -- coarse bucket only, never identifying
  payload JSONB,                         -- de-identified values
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_anon_agg_type ON anonymous_aggregate_data(event_type, created_at);

ALTER TABLE anonymous_aggregate_data ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role_anon_agg" ON anonymous_aggregate_data;
CREATE POLICY "service_role_anon_agg" ON anonymous_aggregate_data FOR ALL
  USING (true) WITH CHECK (true);


-- ============================================================
-- DONE. 10 coaching-system tables created. No existing data touched.
-- Intake backfill/cutover is a separate migration (005), run only when
-- the rebuilt /intake goes live.
-- ============================================================
