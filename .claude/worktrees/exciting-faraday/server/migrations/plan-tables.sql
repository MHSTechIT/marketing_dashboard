-- Plan page: plan_teams and plan_weekly_targets
-- Run this in Supabase Dashboard → SQL Editor → New query → Paste → Run
-- Fixes: "Could not find the table 'public.plan_teams' in the schema cache"

-- Ensure trigger function exists (safe if already created by main schema)
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TABLE IF NOT EXISTS public.plan_teams (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  page_id TEXT,
  ad_account_id TEXT,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_plan_teams_sort_order ON public.plan_teams(sort_order);
ALTER TABLE public.plan_teams DISABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.plan_weekly_targets (
  id SERIAL PRIMARY KEY,
  team_id INTEGER NOT NULL REFERENCES public.plan_teams(id) ON DELETE CASCADE,
  week_start DATE NOT NULL,
  target_followers NUMERIC(18,0) DEFAULT 0,
  target_ad_spend NUMERIC(18,2) DEFAULT 0,
  target_organic_leads NUMERIC(18,0) DEFAULT 0,
  target_organic_revenue NUMERIC(18,2) DEFAULT 0,
  target_stories INTEGER DEFAULT 0,
  target_reels INTEGER DEFAULT 0,
  target_posts INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(team_id, week_start)
);

CREATE INDEX IF NOT EXISTS idx_plan_weekly_targets_team_week ON public.plan_weekly_targets(team_id, week_start);
ALTER TABLE public.plan_weekly_targets DISABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS update_plan_teams_updated_at ON public.plan_teams;
CREATE TRIGGER update_plan_teams_updated_at
  BEFORE UPDATE ON public.plan_teams
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_plan_weekly_targets_updated_at ON public.plan_weekly_targets;
CREATE TRIGGER update_plan_weekly_targets_updated_at
  BEFORE UPDATE ON public.plan_weekly_targets
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
