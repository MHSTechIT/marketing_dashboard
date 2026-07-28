# MHS Marketing Dashboard — Product Requirements Document (PRD)

**Final Project Documentation**

| Field | Value |
|---|---|
| Product | MHS Marketing Dashboard ("Final Dashboard") |
| Owner | My Health School (MHS) — diabetes-awareness / health-education brand |
| Document type | Comprehensive PRD & system documentation |
| Status | As-built (reflects the current code, live-v1) |
| Last updated | 2026-07-14 |
| Primary repo path | `Marketing-Dashboard-main live-v1` |

> This PRD documents the application **as built**. It covers every module, page, workflow, business rule, user role, database table, API endpoint, integration, background job, validation, report, dashboard, notification, and end-to-end process flow. A final "Known Gaps & Technical Debt" section records deviations found in the code so the document doubles as an honest engineering record.

---

## Table of Contents

1. [Product Overview](#1-product-overview)
2. [Goals, Users & Personas](#2-goals-users--personas)
3. [System Architecture](#3-system-architecture)
4. [Technology Stack](#4-technology-stack)
5. [User Roles & Permissions Model](#5-user-roles--permissions-model)
6. [Module Catalog](#6-module-catalog)
7. [Page-by-Page Functional Specification](#7-page-by-page-functional-specification)
8. [Core Business Logic & Algorithms](#8-core-business-logic--algorithms)
9. [Database Structure](#9-database-structure)
10. [API Reference](#10-api-reference)
11. [External Integrations](#11-external-integrations)
12. [Background Jobs & Schedulers](#12-background-jobs--schedulers)
13. [Notifications, Alerts & Health](#13-notifications-alerts--health)
14. [Reports & Dashboards](#14-reports--dashboards)
15. [Validations & Data Rules](#15-validations--data-rules)
16. [UI / UX Design System](#16-ui--ux-design-system)
17. [End-to-End Process Flows](#17-end-to-end-process-flows)
18. [Security, Configuration & Operations](#18-security-configuration--operations)
19. [Deployment](#19-deployment)
20. [Known Gaps & Technical Debt](#20-known-gaps--technical-debt)
21. [Glossary](#21-glossary)

---

## 1. Product Overview

The MHS Marketing Dashboard is a full-stack marketing-analytics platform that unifies **paid advertising performance** (Meta/Facebook & YouTube), **organic content performance** (Instagram/Facebook reels, posts, stories), **lead management & de-duplication**, **conversion tracking**, **planning & goal-setting**, and **AI-driven marketing intelligence** into a single web application.

It exists to answer, in one place, questions the MHS marketing team asks daily:

- Which ads and campaigns are performing, and at what cost per lead (CPL)?
- Which leads actually converted into paying customers?
- Which organic reels/posts/stories are winning, and when should we post?
- Are our audiences saturating or our creatives fatiguing?
- How are we tracking against weekly team targets?
- Which leads are hot and should be called first?

### Key capabilities

- 📊 **Ads Analytics** — campaign/ad performance, leads, CPL, CTR, CPM, ROAS, hook/hold rate.
- 📱 **Content Marketing Analytics** — followers, reach, organic leads, engagement, revenue.
- 🎯 **Lead Management** — Meta lead-form ingestion, upload/import, de-duplication, retention.
- 🔁 **Conversion Tracking** — phone-match of ad leads against a "Paid leads" Google Sheet.
- 🧮 **Planning** — weekly team targets vs achieved, budget forecasting.
- 🤖 **AI Insights** — saturation, creative fatigue, lead scoring, "Ask AI" chat, reel→ad bridge.
- 👥 **Team & Permissions** — user CRUD, fine-grained page-level access control.
- 📈 **Activity Tracking** — page-visit analytics and user engagement reporting.

---

## 2. Goals, Users & Personas

### Business goals

1. Give marketing leadership a single source of truth for paid + organic performance.
2. Reduce wasted spend by surfacing saturation/fatigue before CPL climbs.
3. Increase conversion by prioritizing high-quality leads (lead scoring) and fast follow-up.
4. Provide accountable weekly planning per team/page.
5. Keep lead data clean (de-dup) and compliant (30-day retention on uploaded leads).

### Personas

| Persona | Role | Primary pages |
|---|---|---|
| **Marketing Admin** | Full access, manages users & permissions | All pages, Team Management, Manage Permissions, Page Visit Tracking |
| **Performance Marketer** | Runs ads, monitors CPL/CTR/saturation | Dashboard, Best Ad, AI Insights, Plan |
| **Content Strategist** | Organic content & posting cadence | Best Reel, Audience, AI Insights |
| **Lead Ops / Sales** | Manages and prioritizes leads | Unique Leads, Dashboard (admin leads), conversions |
| **Team Lead** | Sets & tracks weekly goals | Plan |

---

## 3. System Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│                          CLIENT (React SPA)                           │
│  React 19 + React Router v7 · Recharts · Bootstrap 5 · Framer Motion  │
│  Auth: Bearer JWT in localStorage · Dev proxy /api → :4000            │
└───────────────┬──────────────────────────────────────────────────────┘
                │ REST (fetch), Bearer JWT
┌───────────────▼──────────────────────────────────────────────────────┐
│                    SERVER (Node.js / Express)                         │
│  Routers: /api/meta, /api/ai, /api/ai/features, /api/plan,            │
│  /api/conversions, /api/unique-leads, /api/activity, /api/permissions,│
│  /api/leads-sync, /api/youtube, /api/wix + inline auth/users/ads      │
│  Middleware: cors · express.json(20mb) · authMiddleware · requireAdmin │
│  Schedulers (production/RUN_SCHEDULERS only)                          │
└───┬───────────────┬───────────────┬───────────────┬──────────────────┘
    │               │               │               │
┌───▼────┐   ┌──────▼──────┐  ┌─────▼──────┐  ┌─────▼───────────────┐
│Supabase│   │ Meta Graph/ │  │Google Ads/ │  │ Wix · Anthropic ·   │
│/Postgres│  │ IG Graph API│  │Sheets API  │  │ (Gemini configured) │
└────────┘   └─────────────┘  └────────────┘  └─────────────────────┘
```

### Architectural notes

- **SPA + REST monolith.** One Express server serves the API and, in production, the built React app (`express.static(client/build)` + SPA catch-all).
- **Two DB access layers.** Most routes use a Supabase-compatible query-builder shim over `pg.Pool` (`pgClient.js`, selected by `supabase.js`); a few (`activityTracking`) use the raw `pg` pool. Despite "Supabase" naming, the default runtime target is **self-hosted PostgreSQL**; `USE_SUPABASE_HOSTED=true` switches to the hosted Supabase client.
- **Authorization is application-side.** Row Level Security is explicitly disabled on all tables; access control is enforced by JWT middleware + the permissions model.
- **Schedulers require a persistent process.** They run only under PM2/Render (`NODE_ENV=production` or `RUN_SCHEDULERS=true`), never on Vercel (serverless/stateless) and never on unflagged dev machines.
- **Resilience first.** `unhandledRejection`/`uncaughtException` are logged, not fatal, so a background-job error can never take the API down.

---

## 4. Technology Stack

### Frontend (`client/`)
- React 19 (Create React App / react-scripts 5), React Router v7
- Recharts (charts), Bootstrap 5, Font Awesome, Framer Motion (animation)
- ExcelJS (client-side `.xlsx` export/parse), custom CSV utilities
- Data layer: native `fetch`; auth via Bearer JWT in `localStorage`
- Dev proxy: `setupProxy.js` forwards `/api` → `http://localhost:4000`

### Backend (`server/`)
- Node.js + Express 4
- `@supabase/supabase-js` + custom `pg` query-builder shim; `pg` Pool
- `jsonwebtoken` (JWT), `bcrypt` (password hashing, 10 salt rounds)
- `googleapis` (Sheets/Ads), `axios` (HTTP), `@anthropic-ai/sdk` (Claude)
- `cors`, `dotenv`; optional `redis` (ads cache)
- Process manager: PM2 (`ecosystem.config.js`); dev: `nodemon`

### Data & infrastructure
- PostgreSQL (self-hosted) / Supabase (optional hosted)
- Google Sheets (paid-leads source, DW lead sinks, revenue metrics)
- Deploy targets: Render (`render.yaml`) and/or PM2 on an always-on server; Vercel supported for the API-without-schedulers case

---

## 5. User Roles & Permissions Model

Authorization operates in **two complementary layers**.

### Layer A — Coarse role (admin gate)
- `users.role` (TEXT, default `'user'`). The only privileged value is `'admin'` (case-insensitive).
- Enforced by `middleware/adminMiddleware.js`:
  - `adminMiddleware` re-fetches the user and 403s unless `role === 'admin'`.
  - `requireAdmin = authMiddleware + adminMiddleware`.
- Admin role governs **who may edit** permissions and team data.

### Layer B — Fine-grained page/feature permissions
Stored in `user_permissions` — **14 boolean flags**, one row per user (absent row ⇒ all `false`):

| Key | Grants |
|---|---|
| `dashboard` | Ads Analytics dashboard |
| `dashboard_admin_leads` | Admin lead tables on the dashboard |
| `dashboard_content_marketing` | Content-marketing dashboard section |
| `best_ads` | Best Performing Ad page |
| `best_reels` | Best Performing Reel page |
| `plan_view` / `plan_edit` | View / edit Plan |
| `audience_view` / `audience_edit` / `audience_export` | Audience view / edit / export |
| `ai_insights` | AI Insights page |
| `settings` | Settings section (parent) |
| `meta_settings` | Meta credentials settings |
| `team_management` | Team Management |

**Editing UI:** `/manage-permissions/:userId` renders the 14 flags as toggle switches with a **parent→child cascade** (parent OFF ⇒ children OFF; child ON ⇒ parent ON). Admin viewing their own permissions sees all forced ON; a non-admin viewing someone else is read-only.

**Enforcement:**
- `GET /api/permissions/:userId` — allowed if requester is admin **or** requesting own permissions, else 403.
- `POST /api/permissions/update` — **admin only** (`requireAdmin`); whitelists keys, coerces booleans, upserts.

> ⚠️ **Client-side gap:** the sidebar and routes do **not** currently gate menu visibility by these flags — all menu items render for any authenticated user. Enforcement is primarily server-side + page-level handling. See §20.

---

## 6. Module Catalog

| # | Module | Route(s) | Backend | Purpose |
|---|---|---|---|---|
| 1 | Ads Analytics Dashboard | `/` | `/api/meta/*`, `/api/google-sheets/*`, `/api/youtube`, `/api/wix`, `/api/ai/lead-saturation/latest` | Paid performance + admin leads + content marketing |
| 2 | Best Performing Ad | `/best-ad` | `/api/meta/insights`, `/api/conversions/*` | Top ads + conversion counts |
| 3 | Best Performing Reel | `/best-reel` | `/api/meta/instagram/*`, `/api/meta/facebook/*` | Organic content performance |
| 4 | Plan | `/plan` | `/api/plan/*`, `/api/meta/*` | Weekly team targets & tracking |
| 5 | Audience | `/audience` | `/api/meta/insights/demographics`, IG/FB audience | Demographics & platform reach |
| 6 | AI Insights | `/ai-insights` | `/api/ai/*`, `/api/ai/features/*` | Saturation, fatigue, scoring, Ask-AI |
| 7 | Unique Leads | `/unique-leads` | `/api/unique-leads/*` | Upload, dedupe, classify, retention |
| 8 | Team Management | `/team-management` | `/api/users` | User CRUD |
| 9 | Manage Permissions | `/manage-permissions/:userId` | `/api/permissions/*` | Per-user access control |
| 10 | Page Visit Tracking | `/page-visit-tracking` | `/api/activity/*` | Usage analytics |
| 11 | Conversions engine | (consumed by #1,#2) | `/api/conversions/*` | Lead→payment matching |
| 12 | Leads Sync (webhook + jobs) | `/api/leads-sync/*` | Meta → Sheets/DB | Real-time & scheduled lead ingestion |
| 13 | Auth | `/login`, `/signup` | `/api/auth/*` | JWT auth |
| 14 | High-Five Landing | `/high-five` | — | Marketing landing page |

**Scaffold/demo pages:** `/operation/task`, `/report/daily` (localStorage-only CRUD demos).
**Built-but-unrouted pages** (present in code, not in the router): `MetaSettings`, `TeamPerformanceGoals`, `Home`, `Collaboration` (see §20).

---

## 7. Page-by-Page Functional Specification

### 7.0 Application shell, routing & navigation

**Routing (`client/src/App.js`):** `BrowserRouter` with public `/login`, `/signup`; everything else under a `ProtectedRoute` that mounts the `ActivityTracker` + `Sidebar` shell and nested routes.

**Sidebar menu (in order):** Dashboard `/` · Best Performing Ad `/best-ad` · Best Performing Reel `/best-reel` · Plan `/plan` · Audience `/audience` · AI Insights `/ai-insights` · Unique Leads `/unique-leads` · **Settings** (submenu: Team Management `/team-management`, Page Visit Tracking `/page-visit-tracking`).

**Header:** hamburger toggle, page title derived from path, `ProfileDropdown` (name/email, theme switcher, logout). Responsive drawer under 992px.

**Auth flow:** login/signup POST to `/api/auth/*`, store `{token, user}` in `localStorage`; `ProtectedRoute` redirects unauthenticated users to `/login`; 401 responses across pages redirect to login; logout clears storage.

---

### 7.1 Ads Analytics + Content Marketing Dashboard — `/` (`Dashboards.jsx`)

**Purpose:** the flagship page — real-time Meta Ads performance, lead management, and organic content-marketing analytics on one long scroll.

**Section A — Ads Analytics**
- **Filters:** Project (custom dropdown), Ad Account, Campaign, Ad Name (`MultiSelectFilter`), Platform (single-select), Time Range (`DateRangeFilter`, IST, Meta-style presets + compare).
- **KPI cards:** Amount Spent, Conversions/Leads, Cost per Conversion (CPL), CPM, Opt-in Rate, Link Clicks, CTR, ROAS, Total Conversions, Conversion Rate %. Second KPI block: Ad Spend, Total Leads, Unique Leads, Cost per Lead, CTR (Link), Hook Rate, Hold Rate, ROAS, Impressions, Clicks, Conversions, Conversion Rate.
- **Charts:** Recharts (spend vs leads, impressions vs CPM, etc.).
- **Saturation banner:** campaign-saturation alert linking to AI Insights (`/api/ai/lead-saturation/latest`).

**Total Leads Admin View**
- Independent date filters; per-campaign leads table (`/api/meta/leads/db`); Meta-vs-DB sync-status pills; "Sync all pages" action; secondary filtered-leads table.

**Section B — Content Marketing**
- **Filters:** Source, PAGE, Time Range, Platform.
- **KPIs:** Views, Interactions, Follows (Excel export), Reached, Follower Growth Rate, Organic Leads, Organic Conversion, L1/L2/Total Organic Revenue, Unfollows.
- **Website block (Wix):** Total Sessions, Unique Visitors, Clicks to Contact, Form Views, Form Submissions, Lead Count.

**Permission keys:** `dashboard`, `dashboard_admin_leads`, `dashboard_content_marketing`. Handles Meta permission errors (ads_read, business_management, pages_read_engagement, leads_retrieval) with actionable messages.

---

### 7.2 Best Performing Ad — `/best-ad` (`BestPerformingAd.jsx`)

- **Purpose:** identify top ads per project/account with the dashboard KPI structure + conversion counts.
- **Filters:** Project, Ad Account (`MultiSelectFilter`), Time Range; "Run Live Data" manual refresh with as-of timestamp.
- **KPI cards:** Ad Spend, Total Leads, Cost per Lead, Conversion Rate, CPM, **Total Conversion Count** (Online + Offline).
- **UI:** performance funnel, "Amount spend & Lead Generated" ComposedChart, "Impressions & CPM" chart, sortable ad table, campaign-lead **drill-down modal**.
- **Total Conversion Count source:** computed by `/api/conversions/by-campaign` and `/drill-down` (phone-match to the "Paid leads" Google Sheet — see §8.4).
- **Permission key:** `best_ads`.

---

### 7.3 Best Performing Reel — `/best-reel` (`BestPerformingReel.jsx`)

- **Purpose:** organic content performance across Instagram/Facebook (Reels, Posts, Stories).
- **Filters:** Platform (`MultiSelectFilter`), PAGE (single), Time Range. Content-type **tabs**: All / Posts / Stories / Reels (Stories auto-sets last-7-days because Meta's story window is 24h and snapshots backfill ~7 days).
- **UI:** KPIs (Views, Reach, Interactions, Hook Rate); "Top Content by Views" / "Top Stories by Views" (clickable → daily-follows drill-down); performance tables; demographics; FB page audience.
- **Permission key:** `best_reels`.

---

### 7.4 Plan — `/plan` (`Plan.jsx`)

- **Purpose:** weekly team goal-setting and tracking.
- **UI:** four Webinar Budget cards (Free / Paid / YT / Direct-Walk-in) with collapsible target/current inputs, progress bars (persisted to `localStorage`); 2×2 area charts; draggable (Framer `Reorder`) KPI task list (9 presets — Video-to-Darshak, CTR, Hook/Hold Rate, WhatsApp Efficiency, Diabetes Ratio, etc.); **Team Performance** dashboard (donut score, radial goal-achievement, top-teams rings, budget-utilization gauge, weekly-trend line, details table). Add-Team & Set-Targets modals; week presets (this/last/next).
- **Backend:** `/api/plan/teams` (CRUD), `/api/plan/targets` (upsert), `/api/plan/aggregates?week_start=` (achieved vs target + budget forecast), `/api/plan/daily-spend`.
- **Permission keys:** `plan_view`, `plan_edit`.

---

### 7.5 Audience — `/audience` (`Audience.jsx`)

- **Purpose:** audience demographics & platform reach analytics.
- **Tabs:** Demographics / Platform. **Filters:** Time Range, Platform multi-select (All/Facebook/Instagram/Audience Network/Messenger/Threads/WhatsApp), Gender, PAGE.
- **UI:** age/gender chart, top countries & cities, Followers vs Non-Followers, best-posting-times heatmap (online followers), FB/IG audience cards, platform metric selectors (Reach/Results).
- **Permission keys:** `audience_view`, `audience_edit`, `audience_export`.

---

### 7.6 AI Insights — `/ai-insights` (`AIInsights.jsx`)

- **Purpose:** AI-driven campaign analysis and conversational Q&A.
- **Cards:** Lead Saturation, Creative Fatigue, Lead Intelligence, AI Marketing Intelligence, Best-ad / Best-reel summaries, insight feed.
- **"Ask AI Anything":** chat form with suggestion pills; context is built from the selected date-range campaign data and pinned to authoritative dashboard totals to prevent invented numbers.
- **Backend:** `/api/ai/insights`, `/api/ai/ask`, `/api/ai/lead-saturation`, `/api/ai/creative-fatigue`, `/api/ai/lead-quality`(+`/scores`), `/api/ai/features/*`.
- **Permission key:** `ai_insights`.

---

### 7.7 Unique Leads — `/unique-leads` (`UniqueLeads.jsx`)

- **Purpose:** upload, de-duplicate, classify, and retain leads by source.
- **UI:** `.xlsx`/`.csv` upload (client parse via ExcelJS + custom CSV, header aliasing, **max 50,000 rows**, phone reduced to last-10-digits); Source cards (Paid / YouTube / Free / Direct Walk-In); imported-data table with filter chips (All / by source / Duplicates / Last Import); User-ID search; bulk-delete (leads & duplicates) with select-all; **auto-delete-after-30-days** banner; per-category CSV export + duplicate report + template; duplicate-detected modal after import.
- **Backend:** `/api/unique-leads/import`, `/export`, `/duplicates`(+`/bulk`, `/:id`), `/bulk` (delete), `/auto-delete-info`.
- **Auth:** all endpoints require JWT; 401 → login.

---

### 7.8 Team Management — `/team-management` (`TeamManagement.jsx`)

- **Purpose:** CRUD application users/team members (Settings submenu).
- **UI:** search; members table (Name + country, Contact with copy-to-clipboard, Type badge, Created On, Actions); Add/Edit modal (name, country, phone, email, **Admin/Restricted** access radio, password fields); delete confirm; "Manage permissions" → `/manage-permissions/:id`.
- **Backend:** `/api/users` (GET/POST), `/api/users/:id` (PUT/DELETE).
- **Permission key:** `team_management` (under `settings`).

---

### 7.9 Manage Permissions — `/manage-permissions/:userId` (`ManagePermissions.jsx`)

- **Purpose:** per-user permission editor (14 flags as `PermissionToggle`s) with parent→child cascade.
- **Role gating:** admin required to edit others; admin's own permissions forced ON; non-admin viewing others is read-only.
- **Backend:** `GET /api/auth/me`, `GET /api/permissions/:userId`, `POST /api/permissions/update`.

---

### 7.10 Page Visit Tracking — `/page-visit-tracking` (`PageVisitTracking.jsx`)

- **Purpose:** admin analytics of user navigation (companion to the invisible `ActivityTracker`).
- **UI:** date From/To, Refresh, CSV & Excel export; KPI cards (Total Page Views, Unique Visitors, Active Today, Total Users, Avg Session, Most Visited); Daily Page Views area chart; Most Visited Pages bars; tabs — **User Activity** (searchable/sortable/paginated logs: user, page, URL, time, duration, device, browser, IP) and **User Engagement** (per-user sessions/views/avg/last-login/top-page).
- **Backend:** `/api/activity/summary`, `/daily`, `/most-visited`, `/user-engagement`, `/logs`.

---

### 7.11 Auth pages — `/login`, `/signup`

- **Login:** email + password → `POST /api/auth/login` → store `{token, user}`, redirect to intended route or `/`.
- **Signup:** fullName (optional) + email + password + confirm; client-side validation (required fields, matching passwords) → `POST /api/auth/signup`.

---

### 7.12 High-Five Landing — `/high-five` (`HighFiveLanding.jsx`)

Standalone animated marketing landing page (hero / features / how-it-works / CTA / footer). No data/API.

---

## 8. Core Business Logic & Algorithms

These algorithms are the analytical heart of the product and are health-domain specific (MHS = diabetes/health education).

### 8.1 Creative Fatigue Score — `creativeFatigueService.js`
Methodology `Creative_State_MHS_v2.0_performance_only`:

```
Fatigue Score (0–100) = CTR_Drop% × 0.5 + Hook_Drop% × 0.3 + CPL_Rise% × 0.2
```
- **CTR Drop** — % CTR decline (current vs prior equal-length window).
- **Hook Drop** — % decline in hook rate (3-sec plays ÷ impressions × 100).
- **CPL Rise** — % CPL increase vs the ad's **first-7-days baseline** (from `created_time`; history fetched up to 400 days back).
- **Age/lifespan removed from the score** in v2.0 (still shown informationally: `adjustedLifespan`, `age_pressure_pct`).
- **Status bands:** 0–30 Fresh · 30–55 Aging · 55–80 Fatigued · 80–100 Severe.
- Weekly audit flags (informational): CTR drop >30%, hook <15%, CPL vs first-7d >40%, below-average quality, days running >21, negative feedback >0.1%.
- Persisted to `creative_fatigue_log`.

### 8.2 Lead Saturation Index — `saturationService.js`
Methodology `MHS_Lead_Saturation_v1.1`:

```
Saturation Index (0–100) = min(100, (Frequency/3.5)×50 + (Reach%/70)×50)
Reach%          = (Unique Reach / Audience Size) × 100      (trusted audience only)
Realistic pool  = Audience Size × 0.15
Days-until-sat. = (pool / dailyReach) / 3.5
```
- Falls back to frequency-only scaling when audience size is not trusted.
- **Five MHS signals:** frequency, reach%, index thresholds, **first-time-impression share** (<30% → saturating), and a **CTR×frequency diagnostic** (Signal 5) that distinguishes full saturation vs audience saturation vs creative fatigue.
- **Status:** Red/Saturated, Yellow/Warning, or Healthy (multi-threshold `deriveStatus`).
- **Audience resolution:** 3-tier fallback — ad-set `estimated_audience_size` → batch fetch → `reachestimate`.
- Includes per-campaign `duplicate_rate`. Persisted to `campaign_saturation_log`.

### 8.3 Lead Quality Scoring — `leadQualityScoringService.js`
Methodology `Lead Intelligence MHS v1.0` (Supabase-only, no external API):
- **Sugar (blood-glucose) points** parsed from poll text/number → mg/dL band: >250 **+40**, 180–250 **+30**, 126–180 **+20**, <126 **+10** (handles English + Tamil free-text).
- **Behavioural points** from `lead_intel` JSON: WhatsApp-open <1h +15, click-link +20, reply +25, payment-page +30, masterclass +35, ask-question +20, previous-buyer +50, age 45–60 +10.
- **Tiers:** 80–150 **Hot** (call ≤2h) · 50–79 **Warm** (24h WhatsApp) · 25–49 **Nurture** (48h) · 0–24 **Cold** (weekly broadcast).
- Merges `Leads` + `unique_leads` deduped by last-10-digit phone; persisted to `lead_scores`.

### 8.4 Conversion Matching (Total Conversion Count) — `conversions.js` + `paidLeadsService.js`
- A lead **converts** when its normalized phone (or alternate) appears in the **"Paid leads" Google Sheet** *and* the paid date is within **`CONVERSION_WINDOW_DAYS` (default 30)** days **after** the lead date. Payments before the lead never qualify; earliest qualifying paid row is chosen.
- **Last-touch attribution:** each converted phone is credited to exactly one campaign (the most recent in-period lead before payment) — prevents double counting.
- **Online vs Offline** split from the sheet's Conversion Mode column (anything not "Online" ⇒ Offline, so Total = Online + Offline).
- Grouped by `campaign_id` (primary) and normalized campaign name (fallback); lead dates in IST.
- **Paid Sheet:** id `17pctKsTlWq93poCMVwnMzL7cPYuIfGN7coFieop2xdM`, tab auto-resolved; columns A–G = S.No, Access Batch, Paid Date, Paid Name, Phone, Alternate, Conversion Mode. Cached 10 min with stale fallback.

### 8.5 Lead De-duplication — `uniqueLeadsRepository.js`
- Phones normalized to **last 10 digits** = `user_id` (the unique key).
- **Source priority** when a phone appears across channels: Paid (1) > YouTube (2) > Free (3) > Direct Walk-In (4).
- Repeat markers built like "P-2, F-1"; duplicates recorded in `duplicate_leads`.
- `getDuplicateRateByCampaign` = (total − unique phones) / total → feeds saturation.

### 8.6 Hook & Hold Rate — `meta/insightsService.js`
- **Hook rate** = 3-sec video views ÷ impressions (× 100).
- **Hold rate** = ThruPlay / p75-style retention ÷ 3-sec views, with multiple action-array fallbacks. Reused by the fatigue service.

### 8.7 AI Features (Claude) — `aiFeatures.js`
Each endpoint computes numbers locally, then asks Claude Haiku 4.5 for JSON commentary:
- **Reel→Ad Bridge:** `adPotentialScore` (hook + saves + shares + watch bonus + engagement) → top reels to convert to ads.
- **Content Velocity:** viewsPerDay vs median → viral/momentum alerts.
- **Post-Time Heatmap:** 7×24 IST matrix of avg views + hook rate → top posting windows.
- **Fatigue Prediction:** projects days-until-severe + urgency/budget action.
- **CPL↔Watch-time correlation:** Pearson correlation + interpretation.
- **Budget Reallocation:** CPL gap % vs average → recommended shift (15%/8%/0 tiers).

---

## 9. Database Structure

**Engine:** PostgreSQL (self-hosted by default; hosted Supabase optional). Lowercase `public.*` identifiers; **RLS disabled** (app-side auth). Two real foreign keys exist; everything else is joined by string keys (`ad_account_id`, `campaign_id`, `ad_id`, `lead_id`, `phone`).

### 9.1 Core tables

**`users`** — application accounts
`id` SERIAL PK · `email` TEXT UNIQUE NOT NULL · `password_hash` TEXT NOT NULL (bcrypt) · `full_name` TEXT · `role` TEXT DEFAULT `'user'` · `created_at`/`updated_at` TIMESTAMPTZ (trigger-maintained). Index `idx_users_email`.

**`user_permissions`** — one row per user (FK → `users(id)` ON DELETE CASCADE, PK on `user_id`). 14 BOOLEAN columns (§5) + timestamps.

**`leads`** — individual Meta lead-form leads
`id` PK · `name` · `phone` · `time_utc` TIMESTAMPTZ · `date_char` CHAR(10) (IST) · `campaign` · `ad_id` · `campaign_id` · `lead_id` TEXT UNIQUE (dedup) · `form_id` · `page_id` · `created_time` TIMESTAMPTZ · `ad_name` · `sugar_poll` · `lead_intel` (JSONB on `"Leads"`) · `city`/`street`/`form_name` · timestamps. Multiple indexes incl. partial-unique on `lead_id`. A parallel quoted `"Leads"` table is kept in sync (`LEADS_DB_SHAPE=snake`).

**`ads`** — daily per-campaign aggregates
`id` PK · `campaign` · `date_char` CHAR(10) · `leads` INT · `spend` NUMERIC(18,2) · `actions_json` JSONB · timestamps.

**`meta_insights`** — cached Meta Ads insights
`ad_account_id`/`ad_account_name`, `campaign_id`/`campaign_name`, `ad_id`/`ad_name`, `date_start`/`date_stop`, `payload` JSONB. Unique upsert key on (account, campaign, ad, date_start, date_stop).

**Meta cache tables** — `meta_ad_accounts` (account_id UNIQUE, name, currency, timezone, status), `meta_campaigns` (UNIQUE(ad_account_id, campaign_id); name/status/objective), `meta_ads` (UNIQUE(ad_account_id, ad_id); name/status/campaign_id).

### 9.2 Feature tables

**`plan_teams`** — id PK, name, page_id, ad_account_id, sort_order, timestamps.
**`plan_weekly_targets`** — id PK, `team_id` FK → `plan_teams` ON DELETE CASCADE, `week_start` DATE, targets (followers, ad_spend, organic_leads, organic_revenue, stories, reels, posts), UNIQUE(team_id, week_start).

**`lead_scores`** — `lead_id` UNIQUE, name/phone/campaign_id, `sugar_level`, `form_completion`, `score`, `category`, plus extended `sugar_segment`, `tier`, `score_breakdown` JSONB, `methodology`.

**`campaign_saturation_log`** — per-run: campaign_id/name, ad_account_id, frequency, cpl, duplicate_rate, score, status, period_from/to, created_at.
**`creative_fatigue_log`** — per-ad: adds ad_id/ad_name, ctr, ctr_drop_pct, cpl_increase_pct + frequency/cpl/score/status/period.

**`unique_leads`** (v2 unified) — `user_id` TEXT UNIQUE (last-10-digit phone), date_time, batch_code, phone, sugar_poll, email, `lead_source_type` (combinable), created_at.
**`duplicate_leads`** — mirror of an attempted insert that collided: user_id, uploaded_as, existing_sources, detected_at.

**`instagram_story_snapshots`** — ig_account_id + media_id UNIQUE, permalink, timestamp, caption, thumbnail/media url, metrics (views/reach/likes/comments/shares/saved/total_interactions), captured_at. Preserves story metrics past Meta's 24h window.

**`user_activity_logs`** — page-visit rows (user_id/name/email/role, page_name/url, session_id, device_type, browser, ip, duration_seconds, visited_at).
**`user_sessions`** — session_id UNIQUE, login/logout time, session_duration, last_activity, device/browser/ip.

**`job_state`** — key/value cursor store for background jobs (e.g. `lastSuccessfulLeadsSyncUtc`).

### 9.3 Relationships
- `users (1) — (1) user_permissions` (FK, CASCADE).
- `plan_teams (1) — (N) plan_weekly_targets` (FK, CASCADE).
- All Meta/insight/log/lead tables are **application-joined** by text identifiers (no FK).
- Activity tables link by `user_id`/`session_id` as plain TEXT.

### 9.4 Connection & config
- `supabase.js` selects the client; default = `pgClient.js` (a chainable Supabase-compatible query builder over `pg.Pool`, reads `DB_HOST/DB_PORT/DB_NAME/DB_USER/DB_PASSWORD/DB_POOL_MAX/DB_SSL`). `USE_SUPABASE_HOSTED=true` switches to hosted Supabase.
- Repositories in `server/repositories/*` consume the shim; `activityTracking` uses the raw pool.
- **Dev fallback:** if DB creds are missing/unreachable, login and `/me` fall back to `server/data/dev-users.json` (bcrypt-verified, issues a normal JWT). Local login: `yuvaraja@gmail.com`.

### 9.5 Legacy
`server/schema.sql` (SQL Server `dbo.*`) is superseded. `MetaCredentials` table was **dropped** — Meta credentials now live only in `.env`. Numerous migrations resolve the `"Users"→users` / `"Leads"→leads` lowercase transition and PostgREST schema-cache issues.

---

## 10. API Reference

Base URL: server on `PORT` (default 4000). All paths below include their mount prefix. Auth column: **JWT** = `authMiddleware`, **Admin** = `requireAdmin`, **Opt** = optional auth, **—** = none.

### 10.1 Auth & users (inline in `server.js`)
| Method / Path | Auth | Purpose |
|---|---|---|
| `POST /api/auth/signup` | — | Create account (email, password, fullName) → JWT |
| `POST /api/auth/login` | — | Login → JWT (dev-users.json fallback if DB down) |
| `GET /api/auth/me` | JWT | Current user |
| `GET /api/users` | JWT | List users |
| `POST /api/users` | JWT | Create user |
| `PUT /api/users/:id` | JWT | Update user |
| `DELETE /api/users/:id` | JWT | Delete user |

### 10.2 Data (inline)
| Method / Path | Auth | Purpose |
|---|---|---|
| `GET /` | — | Liveness text |
| `GET /api/health` | — | Shallow health `{status, timestamp, port}` |
| `GET /api/health/deep` | — | Deep health: required tables/columns + leads-sync freshness (200/503) |
| `POST /api/dw-sync/trigger` | — | Manual DW→Sheet sync |
| `POST /api/dw-sync/reset-and-repush` | — | Reset DW sync state and re-push |
| `GET /api/ads` | — | Daily ad aggregates (`days`, `includeLeads`) |
| `GET /api/leads` | — | Paginated leads (`page`, `perPage`, `campaign`) |
| `GET /api/campaigns` | — | Distinct campaign names |
| `GET /api/actions` | — | Distinct action keys |
| `GET /api/google-sheets/revenue-metrics` | — | Ads-analytics revenue (Sheet CSV) |
| `GET /api/google-sheets/content-marketing-revenue` | — | Organic revenue (Sheet CSV) |

### 10.3 Permissions — `/api/permissions`
| Method / Path | Auth | Purpose |
|---|---|---|
| `GET /api/permissions/:userId` | JWT (admin or self) | Get 14 flags (defaults false) |
| `POST /api/permissions/update` | Admin | Upsert permissions |

### 10.4 Plan — `/api/plan`
| Method / Path | Auth | Purpose |
|---|---|---|
| `GET /api/plan/teams` | Opt | List teams |
| `POST /api/plan/teams` | Opt | Create team |
| `PUT /api/plan/teams/:id` | Opt | Update team |
| `DELETE /api/plan/teams/:id` | Opt | Delete team |
| `GET /api/plan/targets?week_start=` | Opt | Weekly targets |
| `PUT /api/plan/targets` | Opt | Upsert targets (conflict team_id+week_start) |
| `GET /api/plan/daily-spend?week_start=[&team_id]` | Opt | Proxy Meta daily spend |
| `GET /api/plan/aggregates?week_start=` | Opt | Achieved vs target + budget forecast |

### 10.5 Conversions — `/api/conversions`
| Method / Path | Auth | Purpose |
|---|---|---|
| `GET /api/conversions/by-campaign?from&to[&refresh=1]` | — | Conversion counts (Online/Offline) by campaign |
| `GET /api/conversions/drill-down?from&to&campaign_id` | — | Individual matched paid-leads |
| `POST /api/conversions/refresh-paid` | — | Force re-read paid sheet |

### 10.6 Unique Leads — `/api/unique-leads` (all JWT)
`POST /import` · `GET /export?category=` · `GET /duplicates` · `DELETE /duplicates/bulk` · `DELETE /duplicates/:id` · `DELETE /bulk` · `GET /auto-delete-info?category=`

### 10.7 Activity — `/api/activity` (all JWT, raw `pg`)
`POST /track` · `POST /session/start` · `POST /session/end` · `POST /heartbeat` · `GET /summary` · `GET /logs` · `GET /most-visited` · `GET /daily` · `GET /user-engagement`

### 10.8 Leads Sync — `/api/leads-sync` (public; webhook)
`GET /webhook` (verify) · `POST /webhook` (real-time delivery) · `POST /backfill` · `POST /sync` · `GET /status`

### 10.9 AI — `/api/ai` (Gemini) & `/api/ai/features` (Claude)
`POST /api/ai/insights` · `POST /api/ai/ask` · `POST /api/ai/lead-saturation`(+`/latest`) · `POST /api/ai/lead-quality`(+`GET /scores`) · `POST /api/ai/creative-fatigue`
Features: `POST /api/ai/features/{reel-ad-bridge | content-velocity | post-time-heatmap | fatigue-prediction | cpl-watchtime | budget-reallocation}`

### 10.10 YouTube & Wix
`GET /api/youtube/insights?from&to` (Google Ads VIDEO metrics; stub fallback) · `GET /api/wix/status` · `GET /api/wix/analytics?from&to[&diagnose]`

### 10.11 Meta — `/api/meta/*`
Large monolithic module (`meta/meta.jsx`) exposing pages, ad-accounts, campaigns, ads, insights (incl. `time_increment`, demographics, daily-spend), IG media/story/audience insights, FB content/media insights, leads (`/leads`, `/leads/db`, `/leads/preload`, `/leads/sync-all-pages`), active-campaigns, businesses, projects, statuses. Consumed extensively by the frontend and by `plan.js` aggregates.

**Error conventions:** per-handler try/catch, `{ error }` or `{ success:false, error }`; Supabase error codes (`PGRST116`, schema-cache) mapped to guidance; `plan` and `conversions` degrade DB-connection errors to empty/ok responses instead of 500. No global error middleware.

---

## 11. External Integrations

| System | Purpose | Auth | Notes |
|---|---|---|---|
| **Meta Graph / Marketing API** (v21.0; v24.0 for leads/tokens/IG) | Ad accounts, campaigns, ads, insights, lead-gen forms & leads, IG insights, reach estimates, token debug/refresh | User token, System-User token, per-page tokens, app id/secret | Core of the product |
| **Instagram Graph API** (v24.0) | Reels hook/hold, media & story insights, demographics | Page/System token via `instagram_accounts` edge | Story snapshots persisted |
| **Google Ads API** (REST v18) | YouTube (VIDEO) ad metrics | OAuth2 refresh-token flow | Deterministic stub if creds missing |
| **Google Sheets API** (v4) | Read "Paid leads"; write DW leads; read revenue metrics | Service-account key (4-tier fallback) | Paid-sheet drives conversions |
| **Wix Analytics Data API** (v2) | Site sessions/visitors/forms | `WIX_TOKEN` + `WIX_SITE_ID` | ~62-day retention window |
| **Anthropic Claude** (`claude-haiku-4-5`) | AI feature commentary | `ANTHROPIC_API_KEY` | Lazy client; billing-error mapping |
| **Google Gemini** (`gemini-2.5-flash`) | AI Insights / Ask-AI | `GOOGLE_GEMINI_API_KEY` | Used by `routes/aiInsights.js` |
| **Supabase / Postgres** | Primary datastore | Service-role key / direct PG | RLS disabled |
| **Redis** (optional) | Ads cache backing | `REDIS_URL` | In-memory fallback |

---

## 12. Background Jobs & Schedulers

Started by `startSchedulers()` in `server.js` (idempotent). **Guard `schedulersEnabled()`:** runs only when `NODE_ENV=production` **or** `RUN_SCHEDULERS=true`; force-off with `DISABLE_SCHEDULERS=true`; skipped on Vercel. Local/unflagged machines never run them (prevents double-pushing to the live sheet/token).

| Job | Interval | Startup | Purpose / guard |
|---|---|---|---|
| `leadsSync` → `startLeadsSyncScheduler` | 15 min | immediate | Meta lead-gen forms → `leads` table; cursor in `job_state`; 10-min overlap; backfills ≤7 days on gap; advances only if all pages succeed (Batch API) |
| `leadsSync` → `startLeadsReconcileScheduler` | 180 min | +5 min | Safety-net: re-fetch trailing 3 days, idempotent upsert |
| `insightsSync` | 1 hour | immediate | Trailing 90-min ad-level insights for all accounts, no status filter |
| `metaTokenRefresh` | 24 hours | immediate | Refresh user + system tokens within 7-day buffer; rewrites `.env` |
| `storySnapshotsSync` | 6 hours | +30s | Capture IG stories (24h window) into `instagram_story_snapshots` |
| `autoDeleteLeads` | 24 hours | immediate | Delete `unique_leads` older than 30 days |
| `dwLeadsGSheetSync` | 2 min | immediate | Push DW leads Meta → Google Sheet (form-name heuristic dedup) |
| `leadsSync route` → `startScheduler` | 5 min | inline | Webhook + poll safety-net → Sheet "DW-live data" tab (only guard: `!VERCEL`) |

**Real-time path:** `/api/leads-sync/webhook` delivers leads instantly; pollers are safety nets. Cross-process file lock + in-process writer mutex prevent duplicate sheet rows.

---

## 13. Notifications, Alerts & Health

- **Saturation alert banner** on the Dashboard (from `/api/ai/lead-saturation/latest`) links to AI Insights when campaigns are flagged Saturated.
- **AI Insights alerts:** creative-fatigue severity, content-velocity viral/momentum alerts, fatigue-prediction urgency, budget-reallocation recommendations.
- **In-app toasts** for exports, refreshes, and errors.
- **Meta permission errors** surfaced with specific remediation (which scope is missing).
- **Health endpoints:** `/api/health` (shallow) and `/api/health/deep` (required tables/columns + leads-sync cursor freshness <60 min → `ok`/`degraded`, 200/503) for uptime monitoring.
- **Retention notice:** Unique Leads shows an auto-delete-after-30-days banner with days remaining.
- No email/push/SMS notifications are implemented; alerting is in-app + operational logs (PM2).

---

## 14. Reports & Dashboards

| Report / Dashboard | Location | Contents | Export |
|---|---|---|---|
| Ads Analytics | `/` §A | Spend, leads, CPL, CPM, CTR, ROAS, conversions | Excel/CSV |
| Content Marketing | `/` §B | Views, reach, follows, organic leads/revenue, Wix site | Excel |
| Best Performing Ad | `/best-ad` | Funnel, spend vs leads, impressions vs CPM, conversion count | — |
| Best Performing Reel | `/best-reel` | Top content/stories, hook rate, demographics | — |
| Plan / Team Performance | `/plan` | Targets vs achieved, budget forecast, trend | — |
| Audience | `/audience` | Age/gender, geo, posting-time heatmap | Export (perm-gated) |
| AI Insights | `/ai-insights` | Saturation, fatigue, lead intelligence, Ask-AI | — |
| Unique Leads | `/unique-leads` | Source classification, duplicates | CSV per category + duplicate report + template |
| Page Visit Tracking | `/page-visit-tracking` | Usage KPIs, daily views, most-visited, engagement | CSV & Excel |
| Conversions drill-down | `/best-ad` modal | Individual paid-lead matches | — |

**Charting:** Recharts (Area/Line/Bar/Composed/Pie/RadialBar). **Exports:** CSV (Blob) and Excel (dynamic `import('exceljs')`).

---

## 15. Validations & Data Rules

**Auth:** email + password required; duplicate email → 409; bcrypt hashing (10 rounds); JWT `{id,email}`, expiry `JWT_EXPIRES_IN` (default 7d; render 30d).

**Permissions:** `userId` must parse to int; keys whitelisted to the 14 valid flags; values coerced to Boolean; target user must exist.

**Plan:** team `name` required; `ad_account_id` `act_` prefix stripped; `week_start` must match `YYYY-MM-DD`; numeric targets coerced, ints clamped ≥0; targets upserted on (team_id, week_start).

**Unique Leads import:** body must be a non-empty array, **≤50,000 rows**; first row must contain `phoneNumber`/`phone`; phones reduced to last-10-digits; source must be one of paid/youtube/free/direct_walk_in; export category validated against an allowlist.

**Conversions:** `campaign_id` required for drill-down; conversion window default 30 days; only paid dates ≥ lead date qualify; last-touch dedup by phone.

**Dates:** IST (`Asia/Kolkata`) canonicalization via `utils/istDate.js`; `date_char` stored as IST calendar day; date-range filters validated (and compare-range overlap checked client-side).

**Activity:** `duration_seconds` clamped 0–86400; logs paginated (`pageSize ≤ 200`); sort fields whitelisted.

**Uploads:** client-side XLSX/CSV parsing with header aliasing; 20 MB JSON body cap server-side.

---

## 16. UI / UX Design System

- **Shell:** fixed left sidebar + top header; responsive drawer <992px; page title derived from route; profile dropdown.
- **Filters (standardized):**
  - `DateRangeFilter` — IST modal, 14 Meta-style presets (Today, Yesterday, Last 7/14/28/30 days excluding today, This/Last week Sun–Sat, This/Last month, Maximum, Custom), dual-month calendars, optional Compare with overlap validation. Payload `{range_type, start_date, end_date, timezone, compare}`.
  - `MultiSelectFilter` — portaled searchable dropdown, Select-All, multi/single (radio) modes, status dots (ACTIVE green, PAUSED orange, ARCHIVED gray, REJECTED red, etc.), active options sorted first.
  - `PermissionToggle` — iOS-style switch with label/description.
- **KPI cards** — shared `kpi-card / kpi-label / kpi-value` grid across pages.
- **Theming (`utils/theme.js`):** light / dark / classic-dark / system; persisted to `localStorage['theme']`; CSS variables (`--bg`, `--text`, `--nav`, `--card`); OS `prefers-color-scheme` sync; `themechange` events broadcast across components.
- **Motion:** Framer Motion on Plan, High-Five, and animated views.
- **Modals:** overlay + `stopPropagation`; consistent Add/Edit/Confirm patterns.
- **Exports:** CSV Blob + ExcelJS.
- **Resilience:** consistent 401 → `/login`; best-effort activity tracking (never throws, `keepalive` on unload).

---

## 17. End-to-End Process Flows

### 17.1 Lead ingestion → conversion
```
Meta Lead Ad → lead-gen form submission
  → (real-time) /api/leads-sync/webhook  ┐
  → (15-min job) jobs/leadsSync ──────────┤→ leads table (dedup by lead_id)
  → (safety-net) reconcile (3-day) ───────┘
  → (2-min job) dwLeadsGSheetSync → Google Sheet (DW leads)
Paid customer recorded in "Paid leads" Google Sheet
  → /api/conversions/by-campaign: phone-match (30-day window, last-touch)
  → Total Conversion Count (Online/Offline) on Best Performing Ad
```

### 17.2 Ads performance monitoring
```
Meta Insights (hourly insightsSync + live /api/meta/insights)
  → Dashboard & Best Ad KPIs (CPL, CTR, CPM, ROAS, hook/hold)
  → saturationService / creativeFatigueService (persist logs)
  → Dashboard saturation banner + AI Insights cards
```

### 17.3 Weekly planning
```
Admin creates teams (page_id + ad_account_id)
  → sets weekly targets (PUT /api/plan/targets)
  → /api/plan/aggregates fetches achieved (page insights, media, active campaigns)
  → progress %, remaining, budget forecast (linear projection)
```

### 17.4 Lead upload & de-dup
```
User uploads XLSX/CSV → client parse (≤50k rows, phone last-10)
  → POST /api/unique-leads/import (source type)
  → repo dedup by user_id, source priority; collisions → duplicate_leads
  → 30-day retention (autoDeleteLeads job); export per category
```

### 17.5 User & permission provisioning
```
Admin (Team Management) creates user (Admin/Restricted)
  → Manage Permissions: toggle 14 flags (parent→child cascade)
  → POST /api/permissions/update (requireAdmin)
  → user sees permitted pages/features
```

### 17.6 Lead prioritization (scoring)
```
Leads + unique_leads → leadQualityScoringService (sugar band + behaviour)
  → tier Hot/Warm/Nurture/Cold with SLA
  → lead_scores table; surfaced in AI Insights Lead Intelligence
```

### 17.7 Session & activity analytics
```
ActivityTracker (per tab): session start → 60s heartbeat → page track → end (keepalive)
  → user_activity_logs / user_sessions
  → Page Visit Tracking dashboards (summary, daily, most-visited, engagement)
```

---

## 18. Security, Configuration & Operations

### Authentication & authorization
- Stateless JWT (`Bearer`), bcrypt password hashing (10 rounds).
- Admin gate (`requireAdmin`) for permission edits; per-user 14-flag model for feature access.
- RLS disabled — **all** authorization is app-side; keep middleware coverage complete.

### Configuration (key env vars)
- **JWT:** `JWT_SECRET` (⚠️ defaults to an insecure value — must be set), `JWT_EXPIRES_IN`.
- **Meta:** `META_ACCESS_TOKEN`, `META_SYSTEM_ACCESS_TOKEN(_1)`, `META_PAGE_TOKEN_<pageId>`, `META_PAGE_ACCESS_TOKEN`, `META_AD_ACCOUNT_ID`, `META_APP_ID/SECRET`, `META_PAGE_ID(S)`, `META_WEBHOOK_VERIFY_TOKEN`, `META_API_VERSION`.
- **DB:** `DB_HOST/PORT/NAME/USER/PASSWORD/POOL_MAX/SSL`, or `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`/`ANON_KEY` (+ `USE_SUPABASE_HOSTED`), `LEADS_DB_SHAPE`.
- **Google:** `GOOGLE_SERVICE_ACCOUNT_EMAIL/PRIVATE_KEY` (or JSON/file), `GOOGLE_SHEET_ID`, `CONTENT_MARKETING_SHEET_ID`, `PAID_LEADS_SHEET_ID/TAB`, Google Ads OAuth vars.
- **AI:** `ANTHROPIC_API_KEY`, `GOOGLE_GEMINI_API_KEY`.
- **Wix:** `WIX_SITE_ID`, `WIX_TOKEN`.
- **Schedulers:** `RUN_SCHEDULERS`, `ENABLE_SCHEDULERS`, `DISABLE_SCHEDULERS`, `CONVERSION_WINDOW_DAYS`, interval overrides.

### Operational notes
- Token refresh **rewrites `.env` at runtime** and updates `process.env` in memory.
- Caches: insights (3–5 min + 24h stale), ads (Redis ~25h), paid-leads (10 min), audience (5 min), campaigns (24h DB), video-performance (5 min).
- Rate limiters: Ads (2 concurrent/2s), IG (15 concurrent/200ms), insights (2 concurrent/4s), plus per-job exponential backoff.

### ⚠️ Security flags (for remediation — see §20)
- `JWT_SECRET` default value is insecure and must be overridden in every environment.
- `server/.env.example` reportedly contains a **live-looking `WIX_TOKEN` (JWT)** and a full JWT — rotate/remove.
- `auth.js` writes a debug line to `../.cursor/debug.log` on every authenticated request (leftover instrumentation).
- Several data endpoints (`/api/ads`, `/api/leads`, `/api/campaigns`, google-sheets, conversions, ai) are **unauthenticated** — review whether they should require JWT.

---

## 19. Deployment

### Targets
- **PM2 (recommended for schedulers)** — `ecosystem.config.js`: single fork instance (`instances:1`), autorestart, `max_memory_restart:700M`, `NODE_ENV=production`, `RUN_SCHEDULERS=true`. Schedulers require this persistent process; they cannot run on serverless.
- **Render** — `render.yaml`: `npm run build` (client build + server deps) then `npm start`; env vars with `sync:false` set in dashboard; `RUN_SCHEDULERS=true`.
- **Vercel** — API works but schedulers are skipped (stateless).

### Build & run
```bash
# build (installs client+server deps, builds UI)
npm run build
# start (production)
npm start                # → server/server.js on PORT 4000, serves client/build
# dev
cd server && npm start   # nodemon
cd client && npm start   # CRA dev server on :3000, proxy /api → :4000
```

### Ports
- Frontend dev: 3000 · Backend API: 4000 (production serves SPA from the same server).

---

## 20. Known Gaps & Technical Debt

Recorded from the code so the PRD is an honest as-built record:

**Frontend**
1. **Client-side permission gating is absent** — the sidebar/routes render all menu items regardless of the 14 permission flags; enforcement is server-side + page-level only.
2. **Four different auth `localStorage` keys** in play (`app_auth`, a hardcoded hex key, `ads_dashboard_auth`, `loggedInUser`); readers try several in sequence — should be unified.
3. **Two parallel auth implementations** — only the `utils/auth`-based `ProtectedRoute` is active; `AuthProvider`/`Auth/ProtectedRoute` are orphaned.
4. **Unrouted but fully-built pages:** `MetaSettings` (Meta credential form, maps to `meta_settings`), `TeamPerformanceGoals`, `Home`, `Collaboration` — not reachable via the router.
5. **`ErrorBoundary.jsx` is effectively empty**; multiple dead theme systems (`ThemeContext`, `Layout`, `ThemeBar`) are unused.
6. `/operation/task` and `/report/daily` are localStorage-only demo scaffolds.

**Backend / data**
7. **Inconsistent auth coverage** — several data/AI/conversion endpoints are unauthenticated.
8. **No global error middleware** — each handler self-contains error handling.
9. **Dual lead tables** (`leads` snake + quoted `"Leads"`) kept in sync via `LEADS_DB_SHAPE`; simplify when feasible.
10. **Two DB access layers** (Supabase shim vs raw `pg` pool) — converge for maintainability.
11. Token-refresh **rewriting `.env`** is fragile on read-only/containerized filesystems.

**Security**
12. Insecure default `JWT_SECRET`; possible committed secrets in `.env.example`; leftover `.cursor/debug.log` write.

**Note on Gemini vs Claude:** `routes/aiInsights.js` uses Google Gemini; `routes/aiFeatures.js` uses Anthropic Claude. Both keys must be configured for full AI functionality.

---

## 21. Glossary

| Term | Meaning |
|---|---|
| **CPL** | Cost per lead (spend ÷ leads) |
| **CPM** | Cost per 1,000 impressions |
| **CTR** | Click-through rate |
| **ROAS** | Return on ad spend |
| **Hook rate** | 3-sec video views ÷ impressions |
| **Hold rate** | Retention (ThruPlay/p75) ÷ 3-sec views |
| **Saturation Index** | 0–100 audience-fatigue score (frequency + reach%) |
| **Fatigue Score** | 0–100 creative-decline score (CTR/hook/CPL drops) |
| **Lead tier** | Hot/Warm/Nurture/Cold from lead-quality scoring |
| **Last-touch attribution** | Crediting a conversion to the most recent pre-payment lead's campaign |
| **DW leads** | Direct-Walk-in leads |
| **L1 / L2 revenue** | Level-1 / Level-2 revenue stages tracked in Sheets |
| **IST** | India Standard Time (Asia/Kolkata) — canonical timezone |
| **Conversion window** | Days after a lead within which a payment counts as its conversion (default 30) |

---

*End of document.*
