-- Drop MetaCredentials table from Supabase
-- This table is not used - Meta credentials are stored in .env file only
-- Run this SQL in your Supabase SQL Editor to remove the table

-- Drop the table if it exists (PostgreSQL uses quoted identifiers for capitalized names)
DROP TABLE IF EXISTS public."MetaCredentials" CASCADE;

-- Also try lowercase version in case it was created that way
DROP TABLE IF EXISTS public.meta_credentials CASCADE;

-- Verify table is dropped (optional - you can run this to confirm)
-- SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('MetaCredentials', 'meta_credentials');

