-- Refresh PostgREST Schema Cache
-- Run this in Supabase SQL Editor if you get "schema cache" errors after creating tables

-- Method 1: Use pg_notify to trigger schema reload
SELECT pg_notify('pgrst', 'reload schema');

-- Method 2: Alternative - Grant permissions explicitly (if using anon key)
-- Make sure the users table is accessible
GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT ALL ON public.users TO anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.users_id_seq TO anon, authenticated;

-- Method 3: Verify table exists and is in public schema
SELECT 
  schemaname,
  tablename,
  tableowner
FROM pg_tables
WHERE schemaname = 'public' AND tablename = 'users';

-- If the above query returns no rows, the table doesn't exist
-- Run the schema.sql file first to create the table

