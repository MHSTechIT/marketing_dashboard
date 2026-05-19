# How to Fix "Could not find the table 'public.users' in the schema cache" Error

This error occurs when PostgREST (Supabase's API layer) hasn't refreshed its schema cache after creating or modifying tables.

## Quick Fix (Choose one method)

### Method 1: Reload Schema via SQL (Recommended)
1. Go to **Supabase Dashboard → SQL Editor**
2. Click **"New Query"**
3. Copy and paste this SQL:
   ```sql
   SELECT pg_notify('pgrst', 'reload schema');
   ```
4. Click **"Run"** (or press `Ctrl+Enter`)
5. Wait 10-30 seconds for the cache to refresh
6. Try signing up again

### Method 2: Reload Schema via Dashboard
1. Go to **Supabase Dashboard → Settings → API**
2. Scroll down to the **"Schema"** section
3. Click **"Reload schema"** or **"Refresh schema cache"** button
4. Wait 30-60 seconds
5. Try signing up again

### Method 3: Wait for Auto-Refresh
Sometimes Supabase automatically refreshes the cache within 30-60 seconds. Just wait and try again.

## Verify Table Exists

Before refreshing the cache, make sure the table actually exists:

1. Go to **Supabase Dashboard → Table Editor**
2. Look for the `users` table in the left sidebar
3. If it doesn't exist, run the SQL from `server/supabase-complete-schema.sql`

## Create Users Table (If Missing)

If the `users` table doesn't exist:

1. Go to **Supabase Dashboard → SQL Editor**
2. Click **"New Query"**
3. Copy the entire contents of `server/supabase-complete-schema.sql`
4. Paste into the SQL Editor
5. Click **"Run"**
6. Then refresh the schema cache using Method 1 or 2 above

## Verify Table Structure

After creating the table, verify it has the correct columns:

```sql
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_schema = 'public' 
AND table_name = 'users'
ORDER BY ordinal_position;
```

You should see:
- `id` (integer)
- `email` (text)
- `password_hash` (text)
- `full_name` (text)
- `role` (text)
- `created_at` (timestamp with time zone)
- `updated_at` (timestamp with time zone)

## Troubleshooting

### Still getting the error after refreshing cache?
1. Make sure you're using `SUPABASE_SERVICE_ROLE_KEY` in your `.env` file (not `SUPABASE_ANON_KEY`)
2. Check that Row Level Security (RLS) is disabled: Go to **Database → Tables → users → Settings** and ensure RLS is disabled
3. Verify the table is in the `public` schema (default)
4. Try restarting your server after refreshing the cache

### Table exists but still can't access?
- Check that the table name is exactly `users` (lowercase)
- Verify your Supabase URL and keys are correct in `server/.env`
- Check server logs for more detailed error messages

## Environment Variables Check

Make sure your `server/.env` file has:

```env
SUPABASE_URL=https://your-project-id.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key-here
```

Get these from: **Supabase Dashboard → Settings → API**

