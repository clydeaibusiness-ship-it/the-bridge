-- ============================================================
-- Migration 006: Newsletter Earl
-- Run in: Supabase Dashboard → SQL Editor → New Query → Paste → Run
-- Safe to run multiple times (IF NOT EXISTS everywhere). Purely additive.
--
-- Four tables:
--   newsletter_subscribers — the list (free signups + auto-subscribed members)
--   newsletter_runs        — the 3-candidate edit window + raw research (15-day purge)
--   newsletter_issues      — the finalized/sent issue and its public-archive copy
--   newsletter_events      — Resend open/click/bounce events for per-issue stats
-- ============================================================


-- ============================================================
-- 1. SUBSCRIBERS
--    Free signup adds a row (source='free'). A paying member is auto-subscribed
--    (source='member', user_id set). Unsubscribing flips `subscribed` only —
--    it NEVER deletes a member's account data.
-- ============================================================
CREATE TABLE IF NOT EXISTS newsletter_subscribers (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  source TEXT NOT NULL DEFAULT 'free' CHECK (source IN ('free', 'member')),
  subscribed BOOLEAN NOT NULL DEFAULT true,
  unsubscribe_token UUID NOT NULL DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ DEFAULT now(),
  unsubscribed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_newsletter_subs_subscribed ON newsletter_subscribers(subscribed);
CREATE INDEX IF NOT EXISTS idx_newsletter_subs_user ON newsletter_subscribers(user_id);
CREATE INDEX IF NOT EXISTS idx_newsletter_subs_token ON newsletter_subscribers(unsubscribe_token);


-- ============================================================
-- 2. RUNS — one row per generation (the evening before a send).
--    Holds the three candidates and the raw research that powers the per-box
--    reload. `expires_at` drives the 15-day purge of research; the finalized
--    issue is copied to newsletter_issues, so purging a run never loses a
--    published issue.
-- ============================================================
CREATE TABLE IF NOT EXISTS newsletter_runs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  send_date DATE NOT NULL,
  candidates JSONB NOT NULL,          -- [{issue, score, story, principle, resources, resourceChosen, flagged}]
  research JSONB,                     -- article counts, story pool, source lists (for reload)
  locked_index INTEGER,              -- which candidate the owner locked in (null = leftmost wins)
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'expired')),
  created_at TIMESTAMPTZ DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '15 days')
);

CREATE INDEX IF NOT EXISTS idx_newsletter_runs_send_date ON newsletter_runs(send_date);
CREATE INDEX IF NOT EXISTS idx_newsletter_runs_expires ON newsletter_runs(expires_at);
CREATE INDEX IF NOT EXISTS idx_newsletter_runs_status ON newsletter_runs(status);


-- ============================================================
-- 3. ISSUES — the finalized issue that was (or will be) sent, and its public
--    archive copy. The archive trails the email by 7 days: publish_at = sent_at + 7d.
-- ============================================================
CREATE TABLE IF NOT EXISTS newsletter_issues (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  run_id UUID REFERENCES newsletter_runs(id) ON DELETE SET NULL,
  subject TEXT,
  section1 TEXT,
  section2 TEXT,
  section3 TEXT,
  resource JSONB,                     -- the one human resource chosen for Section 2
  principle JSONB,                    -- {lever, book, author, text}
  story JSONB,                        -- {headline, categoryLabel}
  sources JSONB,                      -- [{domain, lean, url, title}]
  score JSONB,                        -- {news_strength, voice, principle_fit, seo_aio, overall}
  slug TEXT UNIQUE,
  send_date DATE,
  sent_at TIMESTAMPTZ,
  publish_at TIMESTAMPTZ,            -- archive goes live at this time (sent_at + 7 days)
  published BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_newsletter_issues_slug ON newsletter_issues(slug);
CREATE INDEX IF NOT EXISTS idx_newsletter_issues_publish ON newsletter_issues(publish_at, published);
CREATE INDEX IF NOT EXISTS idx_newsletter_issues_sent ON newsletter_issues(sent_at);


-- ============================================================
-- 4. EVENTS — Resend delivery/open/click/bounce/complaint events per issue,
--    so the admin page can show open and click rates next to each issue.
-- ============================================================
CREATE TABLE IF NOT EXISTS newsletter_events (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  issue_id UUID REFERENCES newsletter_issues(id) ON DELETE CASCADE,
  email TEXT,
  type TEXT NOT NULL CHECK (type IN ('delivered', 'opened', 'clicked', 'bounced', 'complained')),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_newsletter_events_issue ON newsletter_events(issue_id);
CREATE INDEX IF NOT EXISTS idx_newsletter_events_type ON newsletter_events(type);
