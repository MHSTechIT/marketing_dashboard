-- Fix schema cache issue for users table
-- Run this SQL in your Supabase SQL Editor

-- Step 1: Refresh PostgREST schema cache
SELECT pg_notify('pgrst', 'reload schema');

-- Step 2: Verify the users table exists and is accessible
SELECT 
    table_name,
    table_schema
FROM information_schema.tables 
WHERE table_schema = 'public' 
AND table_name = 'users';

-- Step 3: Make sure the table is exposed to the API
-- (This is usually automatic, but we'll verify)
DO $$
BEGIN
    -- Ensure the table is in the public schema and accessible
    IF EXISTS (
        SELECT 1 
        FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'users'
    ) THEN
        RAISE NOTICE 'Users table exists in public schema';
    ELSE
        RAISE EXCEPTION 'Users table does not exist! Run supabase-complete-schema.sql first.';
    END IF;
END $$;

-- Step 4: Wait a moment for cache to refresh, then test
-- You can run this query to verify table structure
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_schema = 'public' 
AND table_name = 'users'
ORDER BY ordinal_position;

