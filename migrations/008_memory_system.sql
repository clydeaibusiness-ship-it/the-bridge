-- 008: Earl's curated memory system.
-- Three derived stores (profile, facts, ledger) plus an ingestion queue.
-- All of it is rebuildable from commander_messages, which stays the source of truth.

create extension if not exists vector;

-- The mentor's private file on each member. One living document, updated nightly.
create table if not exists member_profiles (
  user_id uuid primary key,
  profile text not null,
  version int not null default 1,
  updated_at timestamptz not null default now()
);

-- Atomic facts with embeddings. Contradicted facts are superseded (kept as
-- history, excluded from retrieval). Restated facts get last_confirmed bumped.
create table if not exists memory_facts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  fact text not null,
  embedding vector(384),
  first_seen timestamptz not null default now(),
  last_confirmed timestamptz not null default now(),
  superseded_by uuid,
  source_session uuid,
  created_at timestamptz not null default now()
);
create index if not exists memory_facts_user_idx on memory_facts (user_id);

-- Decisions and threads with explicit status. This is what lets Earl tell a
-- reasoned conclusion (resolved) from avoidance (deflected) from unfinished
-- business (open).
create table if not exists decision_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  topic text not null,
  conclusion text not null,
  reasoning text,
  status text not null default 'open' check (status in ('resolved','deflected','open')),
  decided_at timestamptz,
  last_touched timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index if not exists decision_ledger_user_idx on decision_ledger (user_id);

-- Ingestion queue. Sessions to derive, tagged with the environment that will
-- process them (dev and prod share this database). Survives deploys.
create table if not exists memory_outbox (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  session_id uuid,
  env text not null,
  kind text not null default 'session',
  processed boolean not null default false,
  attempts int not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  processed_at timestamptz
);
create index if not exists memory_outbox_pending_idx on memory_outbox (env, processed, created_at);

-- Similarity search over live (non-superseded) facts. Recency decay is applied
-- in the app so the half-life can be tuned without a migration.
create or replace function match_memory_facts(p_user_id uuid, p_query vector(384), p_count int)
returns table(id uuid, fact text, similarity float, first_seen timestamptz, last_confirmed timestamptz)
language sql stable as $$
  select id, fact, 1 - (embedding <=> p_query) as similarity, first_seen, last_confirmed
  from memory_facts
  where user_id = p_user_id and superseded_by is null and embedding is not null
  order by embedding <=> p_query
  limit p_count;
$$;
