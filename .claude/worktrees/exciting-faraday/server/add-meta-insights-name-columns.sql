-- Add ad_account_name, campaign_name, ad_name to meta_insights (run if table already exists without them)
ALTER TABLE public.meta_insights ADD COLUMN IF NOT EXISTS ad_account_name TEXT DEFAULT '';
ALTER TABLE public.meta_insights ADD COLUMN IF NOT EXISTS campaign_name TEXT DEFAULT '';
ALTER TABLE public.meta_insights ADD COLUMN IF NOT EXISTS ad_name TEXT DEFAULT '';
