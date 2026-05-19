-- Create User Permissions Table in Supabase
-- Run this SQL in your Supabase SQL Editor to create the user_permissions table
-- This table is required for the permissions management feature

-- ============================================================================
-- USER PERMISSIONS TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.user_permissions (
  user_id INTEGER PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  dashboard BOOLEAN DEFAULT false,
  dashboard_admin_leads BOOLEAN DEFAULT false,
  dashboard_content_marketing BOOLEAN DEFAULT false,
  best_ads BOOLEAN DEFAULT false,
  best_reels BOOLEAN DEFAULT false,
  plan_view BOOLEAN DEFAULT false,
  plan_edit BOOLEAN DEFAULT false,
  audience_view BOOLEAN DEFAULT false,
  audience_edit BOOLEAN DEFAULT false,
  audience_export BOOLEAN DEFAULT false,
  ai_insights BOOLEAN DEFAULT false,
  settings BOOLEAN DEFAULT false,
  meta_settings BOOLEAN DEFAULT false,
  team_management BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create index on user_id for faster lookups
CREATE INDEX IF NOT EXISTS idx_user_permissions_user_id ON public.user_permissions(user_id);

-- Disable Row Level Security (RLS) - handled at application level
ALTER TABLE public.user_permissions DISABLE ROW LEVEL SECURITY;

-- Create trigger function for auto-updating updated_at (if it doesn't exist)
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to auto-update updated_at on row updates
DROP TRIGGER IF EXISTS update_user_permissions_updated_at ON public.user_permissions;
CREATE TRIGGER update_user_permissions_updated_at
  BEFORE UPDATE ON public.user_permissions
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- VERIFICATION QUERY (Optional - run to verify table was created)
-- ============================================================================
-- SELECT table_name, column_name, data_type, is_nullable, column_default
-- FROM information_schema.columns
-- WHERE table_schema = 'public' AND table_name = 'user_permissions'
-- ORDER BY ordinal_position;
