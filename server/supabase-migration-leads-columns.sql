-- Migration: Add missing columns to public.leads
-- Run this in Supabase SQL Editor (Dashboard → SQL Editor)

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS sugar_poll TEXT,
  ADD COLUMN IF NOT EXISTS lead_intel TEXT;
