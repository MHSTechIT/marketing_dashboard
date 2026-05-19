# Database migrations

## Unique Leads Extraction (fix "Could not find the table 'public.unique_leads_paid' in the schema cache")

If the **Unique Leads** page shows: **"Could not find the table 'public.unique_leads_paid' in the schema cache"** when you click Import:

1. Open your **Supabase** project → **SQL Editor** → **New query**.
2. Copy the full contents of **`unique-leads-tables.sql`** and paste into the editor.
3. Click **Run**.
4. In Supabase: **Settings** → **API** → scroll to **Schema** → click **Reload schema** (wait ~10–30 seconds).
5. Refresh the Unique Leads page and try Import again.

Tables created: `unique_leads_paid`, `unique_leads_youtube`, `unique_leads_free`.

---

## Plan tables (fix "Could not find the table 'public.plan_teams' in the schema cache")

If the **Add team** modal (or Plan page) shows: **"Could not find the table 'public.plan_teams' in the schema cache"** or **"Team goals need database setup"**, run the Plan tables migration:

**Quick fix:** See **`FIX_PLAN_TEAMS_ERROR.md`** in this folder for step-by-step instructions.

## Plan tables migration steps

If the Plan page shows: **"Team goals need database setup. Run the Plan tables migration in Supabase..."**:

1. Open your **Supabase** project → **SQL Editor** → **New query**.
2. Copy the full contents of **`plan-tables.sql`** and paste into the editor.
3. Click **Run**.
4. In Supabase: **Settings** → **API** → scroll to **Schema** → click **Reload schema** (so the new tables are in the cache).
5. Refresh the Plan page in the app. The yellow message should disappear; add a team with **+ Add team** to see Team Performance & Effort & Goals.

Tables created: `plan_teams`, `plan_weekly_targets`.

---

## Instagram story snapshots (Stories tab: show existing + new data)

To show **existing** story data on the Stories tab (in addition to live stories from the last ~24h), run the story snapshots migration:

1. Open your **Supabase** project → **SQL Editor** → **New query**.
2. Copy the full contents of **`instagram-story-snapshots.sql`** and paste into the editor.
3. Click **Run**.
4. In Supabase: **Settings** → **API** → **Reload schema** (optional).

Table created: `instagram_story_snapshots`. The app saves story metrics when it fetches them (within the 24h window) and merges stored stories with live API results. A **scheduled job** (see `server/jobs/storySnapshotsSync.js`) runs every 6 hours when `META_PAGE_ID` or `META_PAGE_IDS` is set, so the table is filled even when no one is viewing the Stories tab—enabling "Top Stories by Views" to show data after the 24h API window.
