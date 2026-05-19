-- Cleanup Duplicate Tables and MetaCredentials
-- Run this AFTER migrating data from Users to users
-- Run this in your Supabase SQL Editor

-- ============================================================================
-- IMPORTANT: Verify migration first!
-- ============================================================================
-- Before running this script, verify that all data from Users has been migrated:
-- 1. Check row counts match
-- 2. Verify all emails from Users are in users table
-- 3. Test your application works with users table

-- ============================================================================
-- Step 1: Drop MetaCredentials table (we don't use it - credentials in .env)
-- ============================================================================
DROP TABLE IF EXISTS public."MetaCredentials" CASCADE;
DROP TABLE IF EXISTS public.meta_credentials CASCADE;

SELECT '✅ MetaCredentials table dropped' as status;

-- ============================================================================
-- Step 2: Drop old Users table (after data migration)
-- ============================================================================
-- ONLY UNCOMMENT THIS AFTER VERIFYING DATA MIGRATION IS COMPLETE
-- DROP TABLE IF EXISTS public."Users" CASCADE;

-- To verify Users table is safe to drop, check:
-- 1. All rows from Users are in users table
-- 2. Your application works correctly with users table
-- 3. No foreign key constraints reference Users table

-- Uncomment when ready:
-- SELECT '✅ Users table dropped' as status;

-- ============================================================================
-- Step 3: Verify only correct tables exist
-- ============================================================================
SELECT 
  table_name,
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = t.table_name) as columns
FROM information_schema.tables t
WHERE table_schema = 'public' 
AND table_name IN ('users', 'ads', 'leads', 'job_state')
ORDER BY table_name;

-- Should show only:
-- - users (7 columns)
-- - ads (6 columns)
-- - leads (13 columns)
-- - job_state (3 columns)

-- ============================================================================
-- Step 4: Refresh schema cache
-- ============================================================================
SELECT pg_notify('pgrst', 'reload schema');

SELECT '✅ Schema cache refresh triggered. Wait 10-30 seconds and try again.' as status;

