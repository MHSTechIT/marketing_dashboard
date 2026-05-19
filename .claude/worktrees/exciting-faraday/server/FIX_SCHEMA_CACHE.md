# Fix Schema Cache Error - Quick Guide

## Error Message
```
Could not find the table 'public.users' in the schema cache
```

## What This Means
The table exists in your Supabase database, but PostgREST (Supabase's API layer) hasn't refreshed its schema cache yet. This is a common issue after creating new tables.

## Quick Fix (Choose One Method)

### Method 1: Reload Schema in Dashboard (Easiest) ⭐

1. Go to your **Supabase Dashboard**: https://supabase.com/dashboard
2. Select your project
3. Navigate to **Settings** → **API**
4. Scroll down to find **"Schema"** section
5. Click **"Reload schema"** or **"Refresh schema"** button
6. Wait 10-30 seconds
7. Try your request again

### Method 2: Run SQL Command

1. Go to **Supabase Dashboard** → **SQL Editor**
2. Click **"New Query"**
3. Copy and paste this SQL:
   ```sql
   SELECT pg_notify('pgrst', 'reload schema');
   ```
4. Click **"Run"** (or press Ctrl+Enter)
5. Wait 10-30 seconds
6. Try your request again

### Method 3: Verify Table is Exposed to API

1. Go to **Database** → **Tables**
2. Click on the **"users"** table
3. Click the **"..."** menu (three dots) in the top right
4. Select **"API Settings"** or **"Expose to API"**
5. Make sure it's checked/enabled
6. Wait a few seconds

### Method 4: Wait for Auto-Refresh (Simplest)

PostgREST usually auto-refreshes its schema cache every 30-60 seconds. Just wait a minute and try again.

### Method 5: Grant Explicit Permissions

If you're using the `anon` key (not `service_role`), run this in SQL Editor:

```sql
GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT ALL ON public.users TO anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.users_id_seq TO anon, authenticated;
```

**Note:** If you're using `SUPABASE_SERVICE_ROLE_KEY`, permissions should already be fine.

## Verify It's Fixed

Run the verification script:

```bash
cd server
npm run verify-supabase
```

You should see:
```
✅ Database connection successful
✅ Table is accessible via PostgREST API
```

## Still Having Issues?

1. **Verify table exists:**
   ```sql
   SELECT * FROM pg_tables WHERE schemaname = 'public' AND tablename = 'users';
   ```
   This should return a row. If not, create the table first.

2. **Check table is in public schema:**
   - Go to **Database** → **Tables**
   - Make sure "users" table is visible
   - Check the schema column shows "public"

3. **Use Service Role Key:**
   - Make sure you're using `SUPABASE_SERVICE_ROLE_KEY` (not `anon` key)
   - Get it from: **Settings** → **API** → **service_role** key

4. **Restart Supabase Project:**
   - In dashboard, go to **Settings** → **General**
   - Sometimes a project restart helps (only if other methods fail)

## Prevention

After creating new tables in Supabase:
1. Wait 30-60 seconds before using them via API
2. Or manually reload the schema cache using Method 1 above
3. Always use `service_role` key for backend/server operations

