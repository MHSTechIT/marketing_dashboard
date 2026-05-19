# Create User Permissions Table - Quick Guide

## Problem
The `user_permissions` table is missing from your Supabase database, causing the "Failed to create permissions" error.

## Solution
Run the SQL script to create the table.

## Steps to Create the Table

1. **Open Supabase Dashboard**
   - Go to https://supabase.com/dashboard
   - Select your project

2. **Open SQL Editor**
   - Click on **"SQL Editor"** in the left sidebar
   - Click **"New Query"**

3. **Run the SQL Script**
   - Open the file: `server/create-user-permissions-table.sql`
   - Copy the entire contents
   - Paste into the SQL Editor
   - Click **"Run"** (or press Ctrl+Enter)

4. **Wait for Confirmation**
   - You should see a success message
   - The table should be created

5. **Refresh Schema Cache** (Important!)
   - Go to **Settings** → **API**
   - Scroll down to **"Schema"** section
   - Click **"Reload schema"** button
   - Wait 10-30 seconds for the cache to refresh

6. **Verify Table Creation**
   - Go to **Database** → **Tables**
   - Look for `user_permissions` in the list
   - Click on it to verify it has all the columns:
     - user_id (primary key)
     - dashboard, dashboard_admin_leads, dashboard_content_marketing
     - best_ads, best_reels
     - plan_view, plan_edit
     - audience_view, audience_edit, audience_export
     - ai_insights
     - settings, meta_settings, team_management
     - created_at, updated_at

## After Creating the Table

Once the table is created and the schema cache is refreshed:
- Try saving permissions again in the Manage Permissions page
- The error should be resolved
- You should be able to create and update user permissions successfully

## Troubleshooting

If you still get errors after creating the table:

1. **Schema Cache Issue**
   - Make sure you clicked "Reload schema" in Settings → API
   - Wait at least 30 seconds after reloading

2. **Foreign Key Error**
   - Make sure the `users` table exists and has data
   - The `user_permissions` table references `users(id)`

3. **Permission Denied**
   - Make sure you're using the `SUPABASE_SERVICE_ROLE_KEY` in your `.env` file
   - The service role key bypasses RLS (Row Level Security)

## Notes

- The table uses `user_id` as the primary key (one permissions record per user)
- All permission fields default to `false`
- When a user is deleted, their permissions are automatically deleted (CASCADE)
- The `updated_at` field is automatically updated when permissions are modified
