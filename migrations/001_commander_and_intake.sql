-- Migration 001: Commander chat history, summaries, and unified intake
-- Run this in Supabase SQL Editor (Dashboard → SQL Editor → New Query)
-- Then click "Run" to execute.

-- 1. Commander messages table
CREATE TABLE IF NOT EXISTS commander_messages (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  session_id UUID NOT NULL,
  message_role TEXT NOT NULL CHECK (message_role IN ('user', 'assistant')),
  message_content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cmdr_msg_user ON commander_messages(user_id);
CREATE INDEX IF NOT EXISTS idx_cmdr_msg_session ON commander_messages(session_id);
CREATE INDEX IF NOT EXISTS idx_cmdr_msg_created ON commander_messages(user_id, created_at DESC);

-- 2. Commander summaries table
CREATE TABLE IF NOT EXISTS commander_summaries (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  session_id UUID NOT NULL,
  summary TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cmdr_sum_user ON commander_summaries(user_id, created_at DESC);

-- 3. Unified intake table (shared between simulator + navigation chart)
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
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_intake_user ON user_intake(user_id);

-- 4. RLS policies (service role bypasses by default, but let's be explicit)
ALTER TABLE commander_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE commander_summaries ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_intake ENABLE ROW LEVEL SECURITY;

-- Allow service role full access
CREATE POLICY "service_role_cmdr_msg" ON commander_messages FOR ALL
  USING (true) WITH CHECK (true);
CREATE POLICY "service_role_cmdr_sum" ON commander_summaries FOR ALL
  USING (true) WITH CHECK (true);
CREATE POLICY "service_role_intake" ON user_intake FOR ALL
  USING (true) WITH CHECK (true);
