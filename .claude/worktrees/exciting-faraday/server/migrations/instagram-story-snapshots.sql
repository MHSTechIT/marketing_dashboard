-- Instagram story metrics snapshots (so we can show "existing" stories after the 24h API window).
-- Run in Supabase Dashboard → SQL Editor if you use the Stories "existing + new" feature.

CREATE TABLE IF NOT EXISTS public.instagram_story_snapshots (
  id SERIAL PRIMARY KEY,
  ig_account_id TEXT NOT NULL,
  media_id TEXT NOT NULL,
  permalink TEXT,
  timestamp TIMESTAMPTZ,
  caption TEXT,
  thumbnail_url TEXT,
  media_url TEXT,
  views NUMERIC(18,0) DEFAULT 0,
  reach NUMERIC(18,0) DEFAULT 0,
  likes NUMERIC(18,0) DEFAULT 0,
  comments NUMERIC(18,0) DEFAULT 0,
  shares NUMERIC(18,0) DEFAULT 0,
  saved NUMERIC(18,0) DEFAULT 0,
  total_interactions NUMERIC(18,0) DEFAULT 0,
  captured_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(ig_account_id, media_id)
);

CREATE INDEX IF NOT EXISTS idx_instagram_story_snapshots_ig_account
  ON public.instagram_story_snapshots(ig_account_id);
CREATE INDEX IF NOT EXISTS idx_instagram_story_snapshots_captured
  ON public.instagram_story_snapshots(captured_at DESC);
ALTER TABLE public.instagram_story_snapshots DISABLE ROW LEVEL SECURITY;
