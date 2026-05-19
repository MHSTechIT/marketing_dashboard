-- Fix Leads Table Unique Constraint
-- This script ensures the public.Leads table has a unique constraint on lead_id
-- Run this SQL in your Supabase SQL Editor
-- 
-- The table name is public.Leads (capitalized, with quoted identifier)
-- Column names: mixed case (Name, Phone, TimeUtc, DateChar, Campaign, lead_id, etc.)

-- Handle both 'Leads' (capitalized) and 'leads' (lowercase) table names for compatibility
-- PostgreSQL unquoted identifiers are case-insensitive, but quoted identifiers preserve case

-- ============================================================================
-- 1. Ensure the table has the unique constraint on lead_id
-- ============================================================================
-- Primary target: public."Leads" (capitalized table name)
DO $$
BEGIN
    -- Primary: Handle quoted "Leads" table name (capitalized - this is the correct one)
    IF EXISTS (SELECT FROM information_schema.tables 
               WHERE table_schema = 'public' 
               AND table_name = 'Leads') THEN
        
        -- Drop existing constraint/index if it exists (try different possible names)
        ALTER TABLE public."Leads" 
        DROP CONSTRAINT IF EXISTS "Leads_lead_id_key" CASCADE;
        
        ALTER TABLE public."Leads" 
        DROP CONSTRAINT IF EXISTS "Leads_lead_id_unique" CASCADE;
        
        DROP INDEX IF EXISTS public."idx_Leads_lead_id_unique";
        DROP INDEX IF EXISTS public."idx_leads_lead_id";
        
        -- Create UNIQUE constraint on lead_id
        -- This is required for Supabase's ON CONFLICT to work properly
        -- PostgreSQL UNIQUE constraints allow multiple NULL values automatically
        ALTER TABLE public."Leads" 
        ADD CONSTRAINT "Leads_lead_id_key" UNIQUE ("lead_id");
        
        RAISE NOTICE 'Unique constraint "Leads_lead_id_key" created on public."Leads"("lead_id")';
    END IF;
    
    -- Fallback: Also handle lowercase 'leads' table name if it exists (for compatibility)
    IF EXISTS (SELECT FROM information_schema.tables 
               WHERE table_schema = 'public' 
               AND table_name = 'leads'
               AND table_name != 'Leads') THEN
        
        -- Drop existing constraint/index if it exists
        ALTER TABLE public.leads 
        DROP CONSTRAINT IF EXISTS leads_lead_id_key CASCADE;
        
        ALTER TABLE public.leads 
        DROP CONSTRAINT IF EXISTS leads_lead_id_unique CASCADE;
        
        DROP INDEX IF EXISTS idx_leads_lead_id_unique;
        DROP INDEX IF EXISTS idx_leads_lead_id;
        
        -- Create UNIQUE constraint on lead_id
        ALTER TABLE public.leads 
        ADD CONSTRAINT leads_lead_id_key UNIQUE (lead_id);
        
        RAISE NOTICE 'Unique constraint "leads_lead_id_key" created on public.leads(lead_id)';
    END IF;
    
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Error creating constraint: %', SQLERRM;
END $$;

-- ============================================================================
-- 2. Verify the constraint exists
-- ============================================================================
-- Run these queries to verify the unique constraint/index was created:

-- For public."Leads" table (capitalized - primary):
SELECT 
    conname AS constraint_name,
    contype AS constraint_type,
    pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid = 'public."Leads"'::regclass
AND conname LIKE '%lead_id%';

-- Check unique indexes on Leads table:
SELECT 
    schemaname,
    tablename,
    indexname,
    indexdef
FROM pg_indexes
WHERE schemaname = 'public'
AND tablename = 'Leads'
AND indexname LIKE '%lead_id%';

-- Alternative: Check all constraints and indexes for the Leads table
SELECT 
    'constraint' AS type,
    conname AS name,
    pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid = 'public."Leads"'::regclass
UNION ALL
SELECT 
    'index' AS type,
    indexname AS name,
    indexdef AS definition
FROM pg_indexes
WHERE schemaname = 'public'
AND tablename = 'Leads'
ORDER BY type, name;

