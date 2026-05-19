-- Meta Ads API cache tables. Run after supabase-complete-schema.sql.
-- Ad accounts: /me/adaccounts → meta_ad_accounts (UI reads from DB only).
-- Campaigns: /act_{id}/campaigns → meta_campaigns (cache 24h+).
-- Ads: /act_{id}/ads → meta_ads (fetch once per account; never on filter change).

-- ============================================================================
-- META AD ACCOUNTS (from /me/adaccounts)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.meta_ad_accounts (
  id SERIAL PRIMARY KEY,
  account_id TEXT NOT NULL UNIQUE,
  name TEXT DEFAULT '',
  currency TEXT DEFAULT 'USD',
  timezone_name TEXT DEFAULT 'UTC',
  account_status INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_meta_ad_accounts_account_id ON public.meta_ad_accounts(account_id);
ALTER TABLE public.meta_ad_accounts DISABLE ROW LEVEL SECURITY;

-- ============================================================================
-- META CAMPAIGNS (from /act_{id}/campaigns, cache 24h+)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.meta_campaigns (
  id SERIAL PRIMARY KEY,
  ad_account_id TEXT NOT NULL,
  campaign_id TEXT NOT NULL,
  name TEXT DEFAULT '',
  status TEXT DEFAULT '',
  effective_status TEXT DEFAULT '',
  objective TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(ad_account_id, campaign_id)
);

CREATE INDEX IF NOT EXISTS idx_meta_campaigns_ad_account ON public.meta_campaigns(ad_account_id);
CREATE INDEX IF NOT EXISTS idx_meta_campaigns_campaign_id ON public.meta_campaigns(campaign_id);
ALTER TABLE public.meta_campaigns DISABLE ROW LEVEL SECURITY;

-- ============================================================================
-- META ADS (from /act_{id}/ads, fetch once per account; never on filter change)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.meta_ads (
  id SERIAL PRIMARY KEY,
  ad_account_id TEXT NOT NULL,
  ad_id TEXT NOT NULL,
  campaign_id TEXT NOT NULL DEFAULT '',
  name TEXT DEFAULT '',
  status TEXT DEFAULT '',
  effective_status TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(ad_account_id, ad_id)
);

CREATE INDEX IF NOT EXISTS idx_meta_ads_ad_account ON public.meta_ads(ad_account_id);
CREATE INDEX IF NOT EXISTS idx_meta_ads_campaign ON public.meta_ads(campaign_id);
CREATE INDEX IF NOT EXISTS idx_meta_ads_ad_id ON public.meta_ads(ad_id);
ALTER TABLE public.meta_ads DISABLE ROW LEVEL SECURITY;

-- Optional: cache validity for campaigns (24h). We use updated_at vs now() in app.
-- No extra column needed if we interpret updated_at as "last fetched from API".
