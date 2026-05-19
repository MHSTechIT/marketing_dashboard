-- Unique Leads Extraction feature: 4 tables (Paid, YouTube, Free, Direct Walk-In)
-- Phone number is the unique key. Priority: Paid > YouTube > Free > Direct Walk-In
-- Run in Supabase SQL Editor

-- ============================================================================
-- 1. PAID LEADS
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.unique_leads_paid (
  id SERIAL PRIMARY KEY,
  date_time TEXT,
  batch_code TEXT,
  name TEXT,
  phone TEXT NOT NULL,
  sugar_poll TEXT,
  email TEXT,
  lead_source_type TEXT DEFAULT 'Paid',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_leads_paid_phone ON public.unique_leads_paid(phone);
CREATE INDEX IF NOT EXISTS idx_unique_leads_paid_created ON public.unique_leads_paid(created_at);
ALTER TABLE public.unique_leads_paid DISABLE ROW LEVEL SECURITY;

-- ============================================================================
-- 2. YOUTUBE LEADS
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.unique_leads_youtube (
  id SERIAL PRIMARY KEY,
  date_time TEXT,
  batch_code TEXT,
  name TEXT,
  phone TEXT NOT NULL,
  sugar_poll TEXT,
  email TEXT,
  lead_source_type TEXT DEFAULT 'YouTube',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_leads_youtube_phone ON public.unique_leads_youtube(phone);
CREATE INDEX IF NOT EXISTS idx_unique_leads_youtube_created ON public.unique_leads_youtube(created_at);
ALTER TABLE public.unique_leads_youtube DISABLE ROW LEVEL SECURITY;

-- ============================================================================
-- 3. FREE LEADS
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.unique_leads_free (
  id SERIAL PRIMARY KEY,
  date_time TEXT,
  batch_code TEXT,
  name TEXT,
  phone TEXT NOT NULL,
  sugar_poll TEXT,
  email TEXT,
  lead_source_type TEXT DEFAULT 'Free',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_leads_free_phone ON public.unique_leads_free(phone);
CREATE INDEX IF NOT EXISTS idx_unique_leads_free_created ON public.unique_leads_free(created_at);
ALTER TABLE public.unique_leads_free DISABLE ROW LEVEL SECURITY;

-- ============================================================================
-- 4. DIRECT WALK-IN LEADS
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.unique_leads_direct_walk_in (
  id SERIAL PRIMARY KEY,
  date_time TEXT,
  batch_code TEXT,
  name TEXT,
  phone TEXT NOT NULL,
  sugar_poll TEXT,
  email TEXT,
  lead_source_type TEXT DEFAULT 'Direct Walk-In',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_leads_direct_walk_in_phone ON public.unique_leads_direct_walk_in(phone);
CREATE INDEX IF NOT EXISTS idx_unique_leads_direct_walk_in_created ON public.unique_leads_direct_walk_in(created_at);
ALTER TABLE public.unique_leads_direct_walk_in DISABLE ROW LEVEL SECURITY;
