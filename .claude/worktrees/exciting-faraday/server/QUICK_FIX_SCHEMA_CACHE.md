# ⚡ QUICK FIX: Schema Cache Error

## Error Message
```
Database error: Could not find the table 'public.users' in the schema cache
```

## 🚀 Fastest Solution (30 seconds)

1. **Open Supabase Dashboard**
   - Go to: https://supabase.com/dashboard
   - Select your project

2. **Refresh Schema Cache**
   - Go to **Settings** → **API**
   - Scroll down to find **"Schema"** section
   - Click **"Reload schema"** button
   - Wait 10-30 seconds

3. **Try Again**
   - Go back to your signup page
   - Try signing up again

## Alternative: Use SQL Editor

If the dashboard method doesn't work:

1. **Go to SQL Editor** in Supabase Dashboard
2. **Click "New Query"**
3. **Paste this SQL:**
   ```sql
   SELECT pg_notify('pgrst', 'reload schema');
   ```
4. **Click "Run"** (or press `Ctrl+Enter`)
5. **Wait 10-30 seconds**
6. **Try signing up again**

## Verify Table Exists First

Before refreshing cache, make sure the table exists:

1. Go to **Table Editor** in Supabase Dashboard
2. Look for `users` table in the left sidebar
3. If it doesn't exist:
   - Go to **SQL Editor**
   - Run the SQL from `server/supabase-complete-schema.sql`
   - Then refresh the cache (steps above)

## Still Not Working?

Check your `.env` file has:
```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

Get these from: **Settings → API** in Supabase Dashboard

