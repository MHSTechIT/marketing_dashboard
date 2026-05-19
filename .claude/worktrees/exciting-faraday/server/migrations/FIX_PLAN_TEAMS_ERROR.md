# Fix: "Could not find the table 'public.plan_teams' in the schema cache"

This error means the Plan page tables have not been created in your Supabase database yet. Follow these steps:

## Step 1: Create the tables in Supabase

1. Open your **Supabase** project: [https://supabase.com/dashboard](https://supabase.com/dashboard) → select your project.
2. Go to **SQL Editor** in the left sidebar.
3. Click **New query**.
4. Open the file **`server/migrations/plan-tables.sql`** in this project, copy **all** of its contents.
5. Paste into the Supabase SQL Editor.
6. Click **Run** (or press Ctrl+Enter).
7. You should see a success message (e.g. "Success. No rows returned").

## Step 2: Reload the schema cache

Supabase’s API (PostgREST) must reload its schema so it knows about the new tables. Use **one** of these:

**Option A – Dashboard (easiest)**  
1. In Supabase, go to **Settings** (gear icon) → **API**.  
2. Scroll to the **Schema** section.  
3. Click **Reload schema** (or “Refresh schema cache”).  
4. Wait about 30 seconds.

**Option B – SQL**  
1. In **SQL Editor**, run:
   ```sql
   SELECT pg_notify('pgrst', 'reload schema');
   ```
2. Wait 10–30 seconds.

## Step 3: Try again in the app

1. Refresh your app (or close and reopen the Add team modal).
2. Click **Add team**, enter a team name, and click **Add team** again.

The error should be gone. If it isn’t, wait another 30–60 seconds and try again (schema cache can take a moment to update).
