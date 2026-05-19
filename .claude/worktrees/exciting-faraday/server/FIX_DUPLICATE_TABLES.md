# Fix Duplicate Tables Issue

## Problem Identified

From your Supabase Dashboard, I can see:

1. **Duplicate Users Tables:**
   - `users` (lowercase) - 0 rows, 7 columns ✅ (This is what the code uses)
   - `Users` (capitalized) - 3 rows, 6 columns ⚠️ (Old table with data)

2. **Unused MetaCredentials Table:**
   - `MetaCredentials` - 0 rows (Should be dropped - credentials stored in .env)

## Why This Causes Issues

- PostgREST (Supabase's API layer) can get confused when both `Users` and `users` exist
- The code is looking for `users` (lowercase) but old data is in `Users` (capitalized)
- Schema cache errors occur because PostgREST doesn't know which table to use

## Solution Steps

### Step 1: Migrate Data from Users to users

**Action:** Move the 3 rows from `Users` to `users`

1. Go to **Supabase Dashboard → SQL Editor**
2. Click **"New Query"**
3. Open `server/fix-duplicate-users-tables.sql` in your code editor
4. **Copy the entire contents** and paste into Supabase SQL Editor
5. Click **"Run"**
6. Review the output - it will show:
   - How many rows were migrated
   - Verification of the migration
7. **VERIFY:** Check that `users` table now has 3 rows (or appropriate number)

### Step 2: Verify Migration Success

**Action:** Make sure all data was migrated correctly

1. In Supabase Dashboard, go to **Table Editor**
2. Click on `users` table
3. Verify you can see your 3 user records
4. Check that all columns are present: `id`, `email`, `password_hash`, `full_name`, `role`, `created_at`, `updated_at`
5. **Important:** Test login with one of the migrated accounts to ensure passwords work

### Step 3: Drop Old Tables (After Verification)

**Action:** Remove the duplicate/unused tables

1. Go to **Supabase Dashboard → SQL Editor**
2. Click **"New Query"**
3. Open `server/cleanup-duplicate-tables.sql` in your code editor
4. **Read carefully** - the script will:
   - Drop `MetaCredentials` table (immediately)
   - Drop `Users` table (commented out - uncomment only after verifying migration)
5. **First run:** Only `MetaCredentials` will be dropped
6. **After verifying migration is successful:**
   - Edit the script
   - Uncomment the `DROP TABLE IF EXISTS public."Users" CASCADE;` line
   - Run again to drop `Users` table

### Step 4: Refresh Schema Cache

**Action:** Force PostgREST to reload schema

1. Go to **Settings → API**
2. Scroll to **"Schema"** section
3. Click **"Reload schema"** button
4. Wait 10-30 seconds

**OR** run in SQL Editor:
```sql
SELECT pg_notify('pgrst', 'reload schema');
```

### Step 5: Test Application

**Action:** Verify everything works

1. **Test login** with existing migrated accounts
2. **Test signup** with a new account
3. **Verify no schema cache errors**

## Expected Final State

After completing all steps, you should have:

- ✅ `users` table (lowercase) - with all your user data (3+ rows)
- ✅ `ads` table - 0 rows
- ✅ `leads` table - 8,677 rows
- ✅ `job_state` table - 1 row
- ❌ `Users` table - **removed**
- ❌ `MetaCredentials` table - **removed**

## Verification Commands

Run these in Supabase SQL Editor to verify:

```sql
-- Check users table has data
SELECT COUNT(*) as user_count FROM users;

-- Verify no Users table
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' 
AND table_name IN ('Users', 'MetaCredentials');
-- Should return 0 rows

-- List all tables (should only show: users, ads, leads, job_state)
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public'
ORDER BY table_name;
```

## Troubleshooting

### Issue: Migration failed
- Check column names match between Users and users
- Verify email uniqueness constraints
- Check server logs for specific errors

### Issue: Can't login after migration
- Verify password_hash was migrated correctly
- Check if bcrypt hashes are intact
- May need to reset passwords if hashes don't match

### Issue: Still getting schema cache errors
- Wait longer (up to 60 seconds)
- Try refreshing cache multiple times
- Restart your Node.js server

### Issue: Foreign key constraints prevent dropping Users
- Check if any other tables reference Users table
- Drop foreign keys first, then drop table
- Or use CASCADE option (already in script)

## Quick Reference

**Migrate data:**
- Run: `server/fix-duplicate-users-tables.sql` in Supabase SQL Editor

**Cleanup tables:**
- Run: `server/cleanup-duplicate-tables.sql` in Supabase SQL Editor (after migration)

**Refresh cache:**
- Settings → API → Reload schema
- OR: `SELECT pg_notify('pgrst', 'reload schema');`

**Verify:**
- `npm run check-users-table` in server directory
- Test login/signup in application

