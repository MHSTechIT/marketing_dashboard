-- ============================================================================
-- Unique Leads v2: Unified table + Duplicate Leads tracking
-- Priority: Paid > YouTube > Free > Direct Walk-In
-- Duplicate detection key: last 10 digits of phone (= user_id)
-- Run in Supabase SQL Editor
-- ============================================================================

-- 1. UNIFIED UNIQUE LEADS TABLE
CREATE TABLE IF NOT EXISTS public.unique_leads (
  id SERIAL PRIMARY KEY,
  date_time TEXT,
  batch_code TEXT,
  phone TEXT NOT NULL,
  user_id TEXT NOT NULL,
  sugar_poll TEXT,
  email TEXT,
  lead_source_type TEXT NOT NULL DEFAULT 'Paid',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_leads_user_id ON public.unique_leads(user_id);
CREATE INDEX IF NOT EXISTS idx_unique_leads_created ON public.unique_leads(created_at);
CREATE INDEX IF NOT EXISTS idx_unique_leads_source ON public.unique_leads(lead_source_type);
ALTER TABLE public.unique_leads DISABLE ROW LEVEL SECURITY;

-- 2. DUPLICATE LEADS TABLE
CREATE TABLE IF NOT EXISTS public.duplicate_leads (
  id SERIAL PRIMARY KEY,
  date_time TEXT,
  batch_code TEXT,
  phone TEXT,
  user_id TEXT NOT NULL,
  sugar_poll TEXT,
  email TEXT,
  uploaded_as TEXT NOT NULL,
  existing_sources TEXT,
  detected_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_duplicate_leads_user_id ON public.duplicate_leads(user_id);
CREATE INDEX IF NOT EXISTS idx_duplicate_leads_detected ON public.duplicate_leads(detected_at);
ALTER TABLE public.duplicate_leads DISABLE ROW LEVEL SECURITY;

-- ============================================================================
-- 3. MIGRATE DATA FROM OLD TABLES (run only if old tables exist with data)
--    Priority order: Paid first, then YouTube, Free, Direct Walk-In
--    Leads in multiple tables get combined source types (e.g. "Paid, YouTube")
-- ============================================================================

-- Step A: Insert Paid leads
INSERT INTO public.unique_leads (date_time, batch_code, phone, user_id, sugar_poll, email, lead_source_type, created_at)
SELECT
  date_time, batch_code, phone,
  RIGHT(REGEXP_REPLACE(phone, '[^0-9]', '', 'g'), 10),
  sugar_poll, email, 'Paid', created_at
FROM public.unique_leads_paid
WHERE LENGTH(REGEXP_REPLACE(phone, '[^0-9]', '', 'g')) >= 10
ON CONFLICT (user_id) DO NOTHING;

-- Step B: Insert YouTube leads (append source if already exists from Paid)
INSERT INTO public.unique_leads (date_time, batch_code, phone, user_id, sugar_poll, email, lead_source_type, created_at)
SELECT
  date_time, batch_code, phone,
  RIGHT(REGEXP_REPLACE(phone, '[^0-9]', '', 'g'), 10),
  sugar_poll, email, 'YouTube', created_at
FROM public.unique_leads_youtube
WHERE LENGTH(REGEXP_REPLACE(phone, '[^0-9]', '', 'g')) >= 10
ON CONFLICT (user_id) DO UPDATE SET
  lead_source_type = CASE
    WHEN public.unique_leads.lead_source_type NOT LIKE '%YouTube%'
    THEN public.unique_leads.lead_source_type || ', YouTube'
    ELSE public.unique_leads.lead_source_type
  END;

-- Step C: Insert Free leads
INSERT INTO public.unique_leads (date_time, batch_code, phone, user_id, sugar_poll, email, lead_source_type, created_at)
SELECT
  date_time, batch_code, phone,
  RIGHT(REGEXP_REPLACE(phone, '[^0-9]', '', 'g'), 10),
  sugar_poll, email, 'Free', created_at
FROM public.unique_leads_free
WHERE LENGTH(REGEXP_REPLACE(phone, '[^0-9]', '', 'g')) >= 10
ON CONFLICT (user_id) DO UPDATE SET
  lead_source_type = CASE
    WHEN public.unique_leads.lead_source_type NOT LIKE '%Free%'
    THEN public.unique_leads.lead_source_type || ', Free'
    ELSE public.unique_leads.lead_source_type
  END;

-- Step D: Insert Direct Walk-In leads
INSERT INTO public.unique_leads (date_time, batch_code, phone, user_id, sugar_poll, email, lead_source_type, created_at)
SELECT
  date_time, batch_code, phone,
  RIGHT(REGEXP_REPLACE(phone, '[^0-9]', '', 'g'), 10),
  sugar_poll, email, 'Direct Walk-In', created_at
FROM public.unique_leads_direct_walk_in
WHERE LENGTH(REGEXP_REPLACE(phone, '[^0-9]', '', 'g')) >= 10
ON CONFLICT (user_id) DO UPDATE SET
  lead_source_type = CASE
    WHEN public.unique_leads.lead_source_type NOT LIKE '%Direct Walk-In%'
    THEN public.unique_leads.lead_source_type || ', Direct Walk-In'
    ELSE public.unique_leads.lead_source_type
  END;
