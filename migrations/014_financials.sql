-- 014_financials.sql
-- Owner self-reported numbers (income, expenses, cash, debt) for the
-- "Your Numbers" block on the Situation screen. Stored as JSONB on the
-- member's intake row; the app reads it back via /api/intake/data.

ALTER TABLE user_intake
  ADD COLUMN IF NOT EXISTS financials JSONB;
