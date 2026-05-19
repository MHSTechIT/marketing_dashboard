-- MHS Lead Intelligence (lead-intaligetionn-state.md): extended score storage.
-- Run in Supabase SQL Editor if you use lead_scores.

ALTER TABLE public.lead_scores ADD COLUMN IF NOT EXISTS sugar_segment TEXT;
ALTER TABLE public.lead_scores ADD COLUMN IF NOT EXISTS tier TEXT;
ALTER TABLE public.lead_scores ADD COLUMN IF NOT EXISTS score_breakdown JSONB;
ALTER TABLE public.lead_scores ADD COLUMN IF NOT EXISTS methodology TEXT;

COMMENT ON COLUMN public.lead_scores.tier IS 'Hot | Warm | Nurture | Cold (MHS score bands)';
COMMENT ON COLUMN public.lead_scores.sugar_segment IS 'Very High | High | Controlled | Borderline (sugar mg/dL bands)';

ALTER TABLE public."Leads" ADD COLUMN IF NOT EXISTS sugar_poll TEXT;
ALTER TABLE public."Leads" ADD COLUMN IF NOT EXISTS "SugarPoll" TEXT;
ALTER TABLE public."Leads" ADD COLUMN IF NOT EXISTS lead_intel JSONB DEFAULT '{}'::jsonb;
