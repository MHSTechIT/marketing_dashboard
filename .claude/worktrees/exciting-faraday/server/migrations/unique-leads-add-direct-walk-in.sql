-- Add Direct Walk-In table to Unique Leads (run if you already have paid/youtube/free tables)
-- Priority: Paid > YouTube > Free > Direct Walk-In
-- Run in Supabase SQL Editor

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
