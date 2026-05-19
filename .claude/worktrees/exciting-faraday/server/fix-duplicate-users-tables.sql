-- Fix Duplicate Users Tables Issue
-- This script helps consolidate Users and users tables
-- Run this in your Supabase SQL Editor

-- ============================================================================
-- Step 1: Check current state
-- ============================================================================
SELECT 
  table_name,
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = t.table_name) as column_count
FROM information_schema.tables t
WHERE table_schema = 'public' 
AND LOWER(table_name) = 'users'
ORDER BY table_name;

-- ============================================================================
-- Step 2: Migrate data from Users (capitalized) to users (lowercase)
-- ============================================================================
-- Only migrate if Users table exists and has data
DO $$
DECLARE
  lowercase_users_count INTEGER;
  capitalized_users_count INTEGER;
BEGIN
  -- Check if both tables exist
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'Users') THEN
    -- Get row counts
    EXECUTE 'SELECT COUNT(*) FROM public."Users"' INTO capitalized_users_count;
    EXECUTE 'SELECT COUNT(*) FROM public.users' INTO lowercase_users_count;
    
    RAISE NOTICE 'Users table has % rows', capitalized_users_count;
    RAISE NOTICE 'users table has % rows', lowercase_users_count;
    
    -- Migrate data from Users to users if Users has data
    IF capitalized_users_count > 0 THEN
      RAISE NOTICE 'Migrating data from Users to users...';
      
      -- Insert data from Users to users, avoiding duplicates based on email
      INSERT INTO public.users (email, password_hash, full_name, role, created_at, updated_at)
      SELECT 
        "Email",
        "PasswordHash",
        "FullName",
        COALESCE("Role", 'user'),
        "CreatedAt",
        COALESCE("UpdatedAt", NOW())
      FROM public."Users"
      WHERE NOT EXISTS (
        SELECT 1 FROM public.users u 
        WHERE u.email = public."Users"."Email"
      )
      ON CONFLICT (email) DO NOTHING;
      
      RAISE NOTICE 'Migration complete!';
    ELSE
      RAISE NOTICE 'Users table is empty, no migration needed';
    END IF;
  ELSE
    RAISE NOTICE 'Users table does not exist, skipping migration';
  END IF;
END $$;

-- ============================================================================
-- Step 3: Verify migration
-- ============================================================================
SELECT 
  'users (lowercase)' as table_name,
  COUNT(*) as row_count
FROM public.users
UNION ALL
SELECT 
  'Users (capitalized)' as table_name,
  COUNT(*) as row_count
FROM public."Users"
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'Users');

-- ============================================================================
-- Step 4: Drop the old Users table (after verifying migration)
-- ============================================================================
-- UNCOMMENT THE LINE BELOW ONLY AFTER VERIFYING MIGRATION SUCCESSFUL
-- DROP TABLE IF EXISTS public."Users" CASCADE;

-- ============================================================================
-- Step 5: Refresh schema cache
-- ============================================================================
SELECT pg_notify('pgrst', 'reload schema');

-- ============================================================================
-- Step 6: Verify final state
-- ============================================================================
SELECT 
  'Final state: users table' as status,
  COUNT(*) as row_count,
  COUNT(DISTINCT email) as unique_emails
FROM public.users;

-- Verify no Users table exists
SELECT 
  CASE 
    WHEN EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'Users')
    THEN '⚠️  Users table still exists - manually drop it if migration is complete'
    ELSE '✅ Only users table exists (correct)'
  END as table_status;

