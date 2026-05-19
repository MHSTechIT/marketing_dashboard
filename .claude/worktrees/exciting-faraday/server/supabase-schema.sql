-- Supabase Users Table Schema
-- Run this SQL in your Supabase SQL Editor to create the users table
-- IMPORTANT: Make sure you're in the 'public' schema (default)

-- Drop table if it exists (only if you want to start fresh)
-- DROP TABLE IF EXISTS public.users CASCADE;

-- Create the users table in the public schema
CREATE TABLE IF NOT EXISTS public.users (
  id BIGSERIAL PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  full_name TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create index on email for faster lookups
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- Row Level Security (RLS)
-- Since we're using custom JWT authentication at the application level,
-- we'll disable RLS for this table. Your backend JWT middleware handles authorization.
-- If you want to enable RLS, you'll need to use Supabase's service_role key instead of anon key

ALTER TABLE users DISABLE ROW LEVEL SECURITY;

-- If you prefer to use RLS with service role key, uncomment below and use SUPABASE_SERVICE_ROLE_KEY in .env:
-- ALTER TABLE users ENABLE ROW LEVEL SECURITY;
-- CREATE POLICY "Allow all for service role" ON users FOR ALL USING (true) WITH CHECK (true);

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to automatically update updated_at
CREATE TRIGGER update_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

