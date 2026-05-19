-- Campaign saturation detection: store per-run results per campaign.
-- Run this in Supabase SQL Editor if you use Supabase for the dashboard.

CREATE TABLE IF NOT EXISTS public.campaign_saturation_log (
  id SERIAL PRIMARY KEY,
  campaign_id TEXT,
  campaign_name TEXT,
  ad_account_id TEXT NOT NULL,
  frequency NUMERIC(12,4),
  cpl NUMERIC(12,2),
  duplicate_rate NUMERIC(6,4),
  score INTEGER DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'Healthy',
  period_from DATE NOT NULL,
  period_to DATE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_campaign_saturation_ad_account_created
  ON public.campaign_saturation_log(ad_account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_campaign_saturation_campaign_created
  ON public.campaign_saturation_log(campaign_id, created_at DESC);

COMMENT ON TABLE public.campaign_saturation_log IS 'Lead saturation detection runs: one row per campaign per run';
