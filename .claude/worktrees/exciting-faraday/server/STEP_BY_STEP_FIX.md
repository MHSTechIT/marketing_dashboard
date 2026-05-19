# Step-by-Step Fix for Schema Cache Error

Follow these steps **in order** to fix the "Could not find the table 'public.users' in the schema cache" error.

## Prerequisites Check

First, verify your environment is configured:

1. Open terminal in the `server` directory
2. Run: `npm run check-users-table`
3. Review the output to see what needs to be fixed

## Step 1: Verify Table Exists (Manual Action Required)

**Action:** Check if the `users` table exists in Supabase

1. Go to [Supabase Dashboard](https://supabase.com/dashboard)
2. Select your project
3. Click **"Table Editor"** in the left sidebar
4. Look for `users` table in the list
   - ✅ **If you see `users` table** → Go to Step 3
   - ❌ **If you don't see `users` table** → Go to Step 2

## Step 2: Create Users Table (If Missing)

**Action:** Create the `users` table in Supabase

1. In Supabase Dashboard, click **"SQL Editor"** in the left sidebar
2. Click **"New Query"** button
3. Open the file `server/ensure-users-table.sql` in your code editor
4. **Copy the entire contents** of `ensure-users-table.sql`
5. **Paste** into the Supabase SQL Editor
6. Click **"Run"** button (or press `Ctrl+Enter` / `Cmd+Enter`)
7. Wait for the query to complete
8. You should see a success message: "✅ Users table is ready!"
9. **IMPORTANT:** Wait 10-30 seconds for schema cache to refresh

## Step 3: Refresh PostgREST Schema Cache

**Action:** Force PostgREST to reload its schema cache

### Method A: Via Dashboard (Easiest)

1. In Supabase Dashboard, go to **Settings** → **API**
2. Scroll down to find the **"Schema"** section
3. Look for **"Reload schema"** or **"Refresh schema cache"** button
4. Click the button
5. Wait 10-30 seconds for cache to refresh

### Method B: Via SQL Editor (If Method A doesn't work)

1. Go to **SQL Editor** in Supabase Dashboard
2. Click **"New Query"**
3. Paste this SQL:
   ```sql
   SELECT pg_notify('pgrst', 'reload schema');
   ```
4. Click **"Run"**
5. Wait 10-30 seconds

### Method C: Wait for Auto-Refresh

Sometimes Supabase automatically refreshes the cache within 30-60 seconds. Just wait and try again.

## Step 4: Verify Table is Exposed to API

**Action:** Ensure the table is accessible via PostgREST API

1. In Supabase Dashboard, go to **Database** → **Tables**
2. Click on the `users` table
3. Click the **"..."** (three dots) menu button
4. Select **"API Settings"** or **"Table Settings"**
5. Verify **"Expose to API"** is enabled (should be enabled by default)
   - If not enabled, enable it and save

## Step 5: Test Table Access

**Action:** Verify the table is accessible

### Option A: Use Verification Script

1. Open terminal in the `server` directory
2. Run: `npm run check-users-table`
3. Review the output:
   - ✅ **If all checks pass** → Go to Step 6
   - ❌ **If checks fail** → Review error messages and go back to Step 3

### Option B: Use SQL Editor

1. Go to **SQL Editor** in Supabase Dashboard
2. Click **"New Query"**
3. Paste this SQL:
   ```sql
   SELECT * FROM users LIMIT 1;
   ```
4. Click **"Run"**
5. Should work without errors (may return 0 rows if table is empty, which is fine)

## Step 6: Test Signup Endpoint

**Action:** Try signing up again

1. Go back to your signup page in the application
2. Fill in the form:
   - Email: `test@example.com`
   - Password: `test123456`
   - Full Name: `Test User` (optional)
3. Click **"Sign Up"** button
4. **Expected Result:**
   - ✅ **Success:** You should be redirected to dashboard or see success message
   - ❌ **If error persists:** Check error message and go back to Step 3

## Troubleshooting

### Error: "Table still not accessible after refreshing cache"

1. **Check Environment Variables:**
   - Open `server/.env` file
   - Verify these are set:
     ```env
     SUPABASE_URL=https://your-project-id.supabase.co
     SUPABASE_SERVICE_ROLE_KEY=your-service-role-key-here
     ```
   - Get these from: **Settings → API** in Supabase Dashboard

2. **Verify Row Level Security (RLS) is Disabled:**
   - Go to **Database → Tables → users**
   - Click **"Settings"** or **"..." menu → Settings**
   - Ensure **"RLS enabled"** is **OFF** (disabled)
   - If it's enabled, disable it and save

3. **Check Server Logs:**
   - Look at your server terminal for detailed error messages
   - The error message will tell you exactly what's wrong

4. **Verify Table Name:**
   - Table name must be exactly `users` (lowercase)
   - Not `Users` or `USERS`
   - Check in Table Editor to confirm

### Error: "Still getting schema cache error after all steps"

1. **Restart Your Server:**
   - Stop your Node.js server (Ctrl+C)
   - Start it again: `npm start`

2. **Double-check Schema Cache Refresh:**
   - Try Method A and Method B from Step 3
   - Wait a full 60 seconds after refreshing

3. **Check for Multiple Projects:**
   - Make sure you're working with the correct Supabase project
   - Verify the `SUPABASE_URL` in `.env` matches your project URL

4. **Contact Support:**
   - If none of the above works, the issue might be with Supabase itself
   - Check Supabase status page or contact support

## Success Indicators

You'll know everything is working when:

✅ `npm run check-users-table` shows all green checkmarks  
✅ SQL query `SELECT * FROM users LIMIT 1;` works without errors  
✅ Signup form submits successfully  
✅ You receive a JWT token and user object in response  
✅ No schema cache errors appear

## Quick Reference

**Run this command anytime to check status:**
```bash
npm run check-users-table
```

**Run this SQL in Supabase to refresh cache:**
```sql
SELECT pg_notify('pgrst', 'reload schema');
```

**Verify table exists:**
- Go to: Supabase Dashboard → Table Editor → Look for `users` table

**Refresh cache via Dashboard:**
- Go to: Settings → API → Schema section → Click "Reload schema"

