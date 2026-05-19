-- Meta Insights table: stores insights fetched from Meta API for dashboard and backfill.
-- Run in Supabase SQL Editor after supabase-complete-schema.sql (needs update_updated_at_column()).
-- One row per (ad_account_id, campaign_id, ad_id, date_start, date_stop). Upsert on conflict.

-- ============================================================================
-- META_INSIGHTS TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.meta_insights (
  id SERIAL PRIMARY KEY,
  ad_account_id TEXT NOT NULL,
  ad_account_name TEXT DEFAULT '',
  campaign_id TEXT NOT NULL DEFAULT '',
  campaign_name TEXT DEFAULT '',
  ad_id TEXT NOT NULL DEFAULT '',
  ad_name TEXT DEFAULT '',
  date_start TEXT NOT NULL,
  date_stop TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Unique constraint for upsert: one row per (ad_account, campaign, ad, date range)
CREATE UNIQUE INDEX IF NOT EXISTS idx_meta_insights_dedup
  ON public.meta_insights (ad_account_id, campaign_id, ad_id, date_start, date_stop);

-- Indexes for dashboard queries (filter by ad_account, date range)
CREATE INDEX IF NOT EXISTS idx_meta_insights_ad_account_dates
  ON public.meta_insights (ad_account_id, date_start, date_stop);
CREATE INDEX IF NOT EXISTS idx_meta_insights_campaign_id
  ON public.meta_insights (ad_account_id, campaign_id);
CREATE INDEX IF NOT EXISTS idx_meta_insights_ad_id
  ON public.meta_insights (ad_account_id, ad_id);

ALTER TABLE public.meta_insights DISABLE ROW LEVEL SECURITY;

-- Trigger to update updated_at
CREATE TRIGGER update_meta_insights_updated_at
  BEFORE UPDATE ON public.meta_insights
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
