-- Creative fatigue detection: store per-run results per ad (creative).
-- Run this in Supabase SQL Editor if you use Supabase for the dashboard.

CREATE TABLE IF NOT EXISTS public.creative_fatigue_log (
  id SERIAL PRIMARY KEY,
  ad_id TEXT,
  ad_name TEXT,
  campaign_id TEXT,
  campaign_name TEXT,
  ad_account_id TEXT NOT NULL,
  frequency NUMERIC(12,4),
  ctr NUMERIC(12,4),
  cpl NUMERIC(12,2),
  ctr_drop_pct NUMERIC(8,2),
  cpl_increase_pct NUMERIC(8,2),
  score INTEGER DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'Healthy',
  period_from DATE NOT NULL,
  period_to DATE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_creative_fatigue_ad_account_created
  ON public.creative_fatigue_log(ad_account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_creative_fatigue_ad_created
  ON public.creative_fatigue_log(ad_id, created_at DESC);

COMMENT ON TABLE public.creative_fatigue_log IS 'Creative fatigue detection runs: one row per ad per run';
