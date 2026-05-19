-- Direct SQL to migrate from auth.users to public.users
-- Run this in Supabase SQL Editor (Step by Step)

-- ============================================================================
-- STEP 1: Create migration function
-- ============================================================================
CREATE OR REPLACE FUNCTION migrate_auth_users_to_public()
RETURNS TABLE (
  migrated_count INTEGER,
  skipped_count INTEGER,
  error_count INTEGER
) 
SECURITY DEFINER
SET search_path = auth, public
AS $$
DECLARE
  user_record RECORD;
  existing_user_id INTEGER;
  migrated INTEGER := 0;
  skipped INTEGER := 0;
  error_count INTEGER := 0;
  full_name TEXT;
BEGIN
  -- Loop through all users in auth.users
  FOR user_record IN 
    SELECT 
      id,
      email,
      encrypted_password,
      raw_user_meta_data,
      created_at
    FROM auth.users
  LOOP
    BEGIN
      -- Check if user already exists in public."Users"
      SELECT "Id" INTO existing_user_id
      FROM public."Users"
      WHERE "Email" = user_record.email;
      
      IF existing_user_id IS NOT NULL THEN
        skipped := skipped + 1;
        CONTINUE;
      END IF;
      
      -- Extract full_name from metadata
      full_name := NULL;
      IF user_record.raw_user_meta_data IS NOT NULL THEN
        full_name := COALESCE(
          user_record.raw_user_meta_data->>'full_name',
          user_record.raw_user_meta_data->>'fullName',
          user_record.raw_user_meta_data->>'name'
        );
      END IF;
      
      -- Insert into public."Users" with correct column names
      INSERT INTO public."Users" (
        "Email",
        "PasswordHash",
        "FullName",
        "Role",
        "CreatedAt"
      ) VALUES (
        user_record.email,
        user_record.encrypted_password,
        full_name,
        'user', -- Default role
        user_record.created_at
      );
      
      migrated := migrated + 1;
      RAISE NOTICE 'Migrated user: %', user_record.email;
      
    EXCEPTION WHEN OTHERS THEN
      error_count := error_count + 1;
      RAISE NOTICE 'Error migrating user %: %', user_record.email, SQLERRM;
    END;
  END LOOP;
  
  RETURN QUERY SELECT migrated, skipped, error_count;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- STEP 2: Run the migration
-- ============================================================================
SELECT * FROM migrate_auth_users_to_public();

-- ============================================================================
-- STEP 3: Verify the migration (check counts)
-- ============================================================================
SELECT 
  'auth.users count' as table_name,
  COUNT(*)::text as count
FROM auth.users
UNION ALL
SELECT 
  'public."Users" count',
  COUNT(*)::text
FROM public."Users";

-- ============================================================================
-- STEP 4: View migrated users (optional)
-- ============================================================================
-- SELECT "Email", "FullName", "CreatedAt" 
-- FROM public."Users" 
-- ORDER BY "CreatedAt" DESC;

