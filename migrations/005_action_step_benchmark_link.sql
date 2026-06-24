-- Migration 005: Link action steps to benchmarks
-- Adds benchmark_id so the progress timeline can group steps under their goal.
-- Existing rows get NULL (unlinked), which renders as "general" steps.

ALTER TABLE action_steps
  ADD COLUMN IF NOT EXISTS benchmark_id UUID REFERENCES member_benchmarks(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_action_steps_benchmark ON action_steps(benchmark_id);
