-- Ensure Users Table Exists and is Properly Configured
-- Run this SQL in your Supabase SQL Editor to create/verify the users table
-- This script is idempotent - safe to run multiple times

-- ============================================================================
-- Step 1: Create users table if it doesn't exist
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.users (
  id SERIAL PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  full_name TEXT,
  role TEXT DEFAULT 'user',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- Step 2: Create index on email for faster lookups
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_users_email ON public.users(email);

-- ============================================================================
-- Step 3: Disable Row Level Security (RLS) - handled at application level
-- ============================================================================
ALTER TABLE public.users DISABLE ROW LEVEL SECURITY;

-- ============================================================================
-- Step 4: Create trigger function for auto-updating updated_at
-- ============================================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- Step 5: Create trigger to auto-update updated_at on row updates
-- ============================================================================
DROP TRIGGER IF EXISTS update_users_updated_at ON public.users;
CREATE TRIGGER update_users_updated_at
  BEFORE UPDATE ON public.users
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- Step 6: Refresh PostgREST schema cache
-- ============================================================================
-- This tells PostgREST to reload its schema cache so the table is immediately accessible
SELECT pg_notify('pgrst', 'reload schema');

-- ============================================================================
-- Step 7: Verify table was created successfully
-- ============================================================================
-- Check table exists
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 
    FROM information_schema.tables 
    WHERE table_schema = 'public' 
    AND table_name = 'users'
  ) THEN
    RAISE NOTICE '✅ Users table exists';
  ELSE
    RAISE EXCEPTION '❌ Users table was not created!';
  END IF;
END $$;

-- Check columns exist
SELECT 
  column_name,
  data_type,
  is_nullable,
  column_default
FROM information_schema.columns 
WHERE table_schema = 'public' 
AND table_name = 'users'
ORDER BY ordinal_position;

-- Check RLS status
SELECT 
  tablename,
  rowsecurity
FROM pg_tables 
WHERE schemaname = 'public' 
AND tablename = 'users';

-- Success message
SELECT '✅ Users table is ready! Wait 10-30 seconds for schema cache to refresh, then try signing up again.' AS status;

