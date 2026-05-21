-- Migration: Add city, street and form_name columns to the leads table(s)
-- Run this in Supabase SQL Editor (Dashboard → SQL Editor) then click Run.
--
-- The dashboard reads from public.leads (snake_case shape, LEADS_DB_SHAPE=snake).
-- The quoted "Leads" table is kept in sync too so either shape works.

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS city TEXT,
  ADD COLUMN IF NOT EXISTS street TEXT,
  ADD COLUMN IF NOT EXISTS form_name TEXT;

ALTER TABLE public."Leads"
  ADD COLUMN IF NOT EXISTS city TEXT,
  ADD COLUMN IF NOT EXISTS street TEXT,
  ADD COLUMN IF NOT EXISTS form_name TEXT;
