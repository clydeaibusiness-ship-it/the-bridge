-- 013_demos.sql — Sales demo Earls.
--
-- A "demo" is a temporary, pre-briefed Earl for a prospect company the owner is
-- onboarding. The owner enters the company's website + what they know; the
-- system scrapes the site and generates a business context, a Navigation Chart,
-- and Earl's First Read. The owner reviews/edits, then publishes to an
-- unguessable public link the prospect can chat with. Temporary by design:
-- demos expire and are deletable, and each carries a message cap so a shared
-- link can't run up the API bill.

create table if not exists demos (
  id             uuid primary key default gen_random_uuid(),
  token          text unique not null,          -- the /demo/:token url segment
  company_name   text not null,
  website_url    text,
  facebook_url   text,
  notes          text,                           -- owner's free-text "everything I know"
  scanned_content jsonb,                         -- { websiteContent, facebookContent }
  business_context jsonb,                         -- generated + owner-edited briefing
  chart_sections jsonb,                          -- [ { title, body }, ... ]
  first_read     text,
  status         text not null default 'draft',  -- 'draft' | 'published'
  messages_used  int  not null default 0,
  message_cap    int  not null default 40,
  created_at     timestamptz not null default now(),
  expires_at     timestamptz not null default (now() + interval '30 days')
);

create index if not exists demos_token_idx on demos (token);
create index if not exists demos_created_idx on demos (created_at desc);
