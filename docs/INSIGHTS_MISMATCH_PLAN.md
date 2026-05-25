# Dashboard vs Meta Ads Manager Mismatch — Analysis & Fix Plan

## Problem

Dashboard numbers don’t match Meta Ads Manager when using the **same time range, campaign, and ad**.

---

## Hypotheses (H1–H5)

| ID | Cause | How to confirm from logs |
|----|--------|---------------------------|
| **H1** | **Timezone**: Frontend uses `toISOString().slice(0,10)` (UTC). Meta uses **ad account timezone**. Same “Last 7 days” can map to different calendar days → different totals. | Compare client `from`/`to` and `tzOffsetMin` with Meta’s date range for that account. If ad account is in a different TZ, H1 likely. |
| **H2** | **Data source**: Insights are **DB-first**. Live Meta is used only when DB returns empty or `?live=1`. DB is filled by sync job and backfill. Ranges never backfilled → DB empty while Meta has data. | Check `source: 'db'` vs `source: 'live'`, and `rowCount`. If always `db` and rowCount &gt; 0, mismatch could still be from DB having different dates/aggregation than Meta. |
| **H3** | **DB date filter**: `getInsights` uses `date_stop >= from` and `date_start <= to`. Wrong `from`/`to` (e.g. timezone) → first/last day excluded or range shifted. | Check repository log: `minDate`, `maxDate` vs requested `from`/`to`. If null, payloads may not expose dates in logs; DB filter uses table columns. |
| **H4** | **Backend default dates**: When `from`/`to` missing or invalid, backend uses server-local `new Date()` and `toISOString()`, which can differ from frontend and ad account TZ. | Check `usedDefaultDates`. If `false`, H4 rejected. |
| **H5** | **ID format**: `campaign_id`/`ad_id` type or format mismatch. | Check client `campaignIds`/`adIds` vs backend `campaign_id`/`ad_id`; look for type/format oddities. |

---

## Log Analysis (from existing run)

Using `.cursor/debug.log` from a prior run:

| Hypothesis | Verdict | Evidence |
|------------|--------|----------|
| **H1** | **Inconclusive** | Client sends `from: "2026-01-27"`, `to: "2026-01-27"`, `tzOffsetMin: -330` (IST). Need Meta’s “same day” range for that ad account to confirm TZ alignment. |
| **H2** | **Partially confirmed** | All entries show `source: 'db'`, `rowCount: 1` or `5`. Data is DB-first; no live calls in this run. Mismatch could be from DB date range or aggregation differing from Meta. |
| **H3** | **Inconclusive** | Repository logs show `minDate: null`, `maxDate: null` (payloads may not expose `date_start`/`date_stop` in returned payload). DB filter uses table columns; need to log table `date_start`/`date_stop` to verify range. |
| **H4** | **Rejected** | `usedDefaultDates: false`; dates come from client, not backend fallback. |
| **H5** | **Rejected / Unlikely** | IDs look normal (`120239767957840124`, etc.); no format mismatch in logs. |

---

## Fix Plan (conditional on evidence)

1. **If H1 confirmed (timezone)**  
   - Use **ad account timezone** (or a passed timezone) when building `from`/`to`.  
   - Options: (a) Fetch ad account timezone from Meta and build dates in that TZ; (b) Pass timezone from frontend and use it in date math; (c) For “Last N days,” send explicit `from`/`to` in ad account TZ from backend.  
   - Avoid using only `toISOString().slice(0,10)` in the user’s local TZ for “same day” as Meta.

2. **If H2 confirmed (data source / stale or partial DB)**  
   - When user explicitly compares to Meta Ads Manager, either:  
     - Prefer live: e.g. `?live=1` when a “Match Meta” or “Refresh from Meta” action is used, or  
     - Ensure backfill (and sync) covers the exact range the user selected.  
   - Keep DB-first for performance; use live only when correctness vs Meta is required.

3. **If H3 confirmed (DB date filter wrong)**  
   - Verify filter logic: `date_stop >= from` and `date_start <= to` for inclusive overlap.  
   - Ensure `from`/`to` are in the same format and meaning as stored `date_start`/`date_stop` (e.g. YYYY-MM-DD in ad account TZ).  
   - Add logging of table `date_start`/`date_stop` in the repository (e.g. `select('payload', 'date_start', 'date_stop')`) so logs show actual range.

4. **If H4 confirmed**  
   - Use same timezone/date logic as backend defaults as used when building client dates, or derive defaults from ad account TZ.

5. **H5**  
   - No change if IDs already match; if a mismatch appears in logs, normalize type/format (e.g. consistent `String()` and trimming).

---

## Reproduction Steps (for targeted debugging)

Use these when you need a clean run to re-check hypotheses or verify a fix:

1. **Clear the debug log**  
   Delete:  
   `d:\React\App backup\2.Dev_Source Code\Marketing-Dashboard-main\.cursor\debug.log`

2. **Start backend and client**  
   - From project root (or server folder): start the API server.  
   - From client folder: start the React app (`npm start` or similar).

3. **Reproduce the mismatch**  
   - Log in and open the dashboard.  
   - Set **date range** to the same preset or custom range you use in Meta Ads Manager (e.g. “Last 7 days”).  
   - Select the **same campaign** and **same ad** as in Meta.  
   - Let the insights request run (numbers load).

4. **Compare**  
   - In Meta Ads Manager, note the exact date range and timezone of the ad account, and the metrics for that campaign/ad.  
   - In the dashboard, note the shown metrics for that same range/campaign/ad.

5. **Capture logs**  
   - After the dashboard has loaded, the ingest endpoint will have written to `.cursor\debug.log`.  
   - Use that file for hypothesis checks (H1–H5) and for before/after verification when applying a fix.

6. **Optional — force live**  
   - To see live path in logs: call insights API with `?live=1` (e.g. from a “Refresh from Meta” button or a temporary dev-only link).  
   - Then compare DB vs live `rowCount` and, if logged, date ranges.

---

## Verification After a Fix

1. Keep all `// #region agent log` instrumentation in place.  
2. Clear `.cursor\debug.log`, then reproduce again with the same range/campaign/ad.  
3. In the new log, check:  
   - **H1**: `from`/`to` (and, if added, backend TZ or ad account TZ).  
   - **H2**: `source`, `rowCount`; if you added live fallback logic, confirm it runs when intended.  
   - **H3**: If you added table `date_start`/`date_stop` to logs, confirm they sit within the intended range.  
4. Compare dashboard numbers to Meta Ads Manager again.  
5. Only after confirmed success (and/or explicit user OK), remove the agent-log regions and ingest calls.

---

## Relevant Code Paths

- **Client dates**: `client/src/pages/Dashboards.jsx` — `getDefaultDates()`, preset handlers using `toISOString().slice(0,10)`, and `fetchDashboardData` sending `from`/`to`.  
- **Backend insights**: `server/meta/meta.jsx` — GET `/insights` date parsing, `getInsights`, and live fallback.  
- **DB layer**: `server/repositories/insightsRepository.js` — `getInsights` filters `date_stop >= from`, `date_start <= to`, returns `payload`.
