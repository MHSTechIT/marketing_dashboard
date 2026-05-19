-- Lead quality scores (form/content-only: sugar level, form completion).
-- Run this in Supabase SQL Editor if you use Supabase for the dashboard.

CREATE TABLE IF NOT EXISTS public.lead_scores (
  id SERIAL PRIMARY KEY,
  lead_id TEXT UNIQUE,
  name TEXT,
  phone TEXT,
  campaign_id TEXT,
  sugar_level NUMERIC(8,2),
  form_completion TEXT,
  score INTEGER NOT NULL DEFAULT 0,
  category TEXT NOT NULL DEFAULT 'Average',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lead_scores_lead_id ON public.lead_scores(lead_id);
CREATE INDEX IF NOT EXISTS idx_lead_scores_campaign_created ON public.lead_scores(campaign_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lead_scores_created ON public.lead_scores(created_at DESC);

COMMENT ON TABLE public.lead_scores IS 'Lead quality score per lead (form/content signals only)';
