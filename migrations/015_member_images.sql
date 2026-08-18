-- 015_member_images.sql
-- Images a member uploads in the Earl chat (for context) and browses/deletes in
-- Settings. Bytes live in the private Supabase Storage bucket 'member-images'
-- (the server creates the bucket on first upload); this table is the index.

CREATE TABLE IF NOT EXISTS member_images (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL,
  storage_path TEXT NOT NULL,
  media_type   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS member_images_user_idx
  ON member_images (user_id, created_at DESC);
