# AI Insights Features – Brief Documentation

This document briefly describes three AI Insights features: **Lead Saturation Detection**, **Creative Fatigue Detection**, and **Lead Intelligence**. All three are available on the **AI Insights** page in the Marketing Dashboard.

---

## 1. Lead Saturation Detection (MHS methodology)

**Purpose:** Detect when the addressable audience is exhausting (frequency + reach vs pool, CPM/CTR trends) so you can expand targeting or refresh creatives—aligned with the **MHS Lead Saturation Guide** (v1.0, March 2026).

**Workflow:**
- Analysis runs on load and via **Re-run** (default: last 7 days vs previous 7 days).
- Meta **campaign** insights: `frequency`, `reach`, `impressions`, `spend`, `clicks`, `cpm`, `ctr` (aggregated over the window).
- **Audience size** (best-effort): max `estimated_audience_size` from the ad set list, then **batch `GET ?ids=`** on ad sets (sometimes populated when the edge list omits it), then **`GET act_{id}/reachestimate`** per ad set (full `targeting`, then **geo/demographic-only** targeting if the first call fails). If Meta still returns nothing, the UI shows **Reach %** and **Days** from **frequency-band heuristics** (suffix **~** in the table). Those heuristics are **display-only**; **status** and **saturation index** use Meta reach when present, otherwise frequency + CPM/CTR only (heuristic reach is **not** fed into alerts).
- **Duplicate %** (supplementary): from your Leads DB, same as before.
- Each campaign gets a **Saturation Index** (0–100), supporting metrics, and **Status**.

**Saturation Index (0–100):**

`min(100, (Frequency ÷ 3.5) × 50 + (Reach % ÷ 70) × 50)`

If audience size is unavailable, the index uses **frequency only**: `min(100, (Frequency ÷ 3.5) × 100)`.

**Other signals:**

| Metric | How it's calculated |
|--------|---------------------|
| **CPM vs prior** | Week-on-week change: `(CPM_cur − CPM_prev) ÷ CPM_prev × 100` (same window length). |
| **CTR drop vs prior** | `(CTR_prev − CTR_cur) ÷ CTR_prev × 100` when CTR fell. |
| **Days until saturation*** | Realistic pool = `audience_size × 0.15`; daily reach = `reach ÷ days_in_window`; `adjusted days = (pool ÷ daily_reach) ÷ 3.5`. |

**Status (MHS alert bands):** **Saturated** if index > 80 or any critical signal (e.g. frequency ≥ 4.0, reach % ≥ 70%, CPM WoW > 35%, CTR drop > 35%, adjusted days < 14). **Warning** if index > 60 or moderate signals (e.g. frequency > 3, reach % > 50%, CPM WoW > 20%, CTR drop > 20%, adjusted days < 30). Otherwise **Healthy**.

**Summary:** `saturation_index_avg`, counts of Saturated / Warning / Healthy. **Saturation level** for the UI: **high** if any Saturated; **medium** if any Warning; **low** otherwise.

**Backend:** `server/services/saturationService.js`, `server/routes/aiInsights.js` (POST `/api/ai/lead-saturation`). Optional logging to `campaign_saturation_log` (`score` stores the rounded index for compatibility).

---

## 2. Creative Fatigue Detection

**Purpose:** Detect when ad creatives stop performing (high frequency, CTR drop, CPL increase).

**Workflow:**
- User clicks **Run analysis** in the Creative Fatigue section.
- Backend runs **ad-level** (not campaign-level) analysis for a date range (default: last 7 days vs previous 7 days).
- Meta ad-level insights are fetched; each ad (creative) gets a fatigue **Score** and **Status**.
- Results show a summary and a table per creative.

**Metrics:**

| Metric       | How it's calculated |
|-------------|----------------------|
| **Frequency** | From Meta: `impressions ÷ reach` for the ad in the current period. |
| **CTR**       | From Meta (or computed as clicks ÷ impressions × 100). |
| **CPL**       | From Meta: `spend ÷ leads` for the ad in the current period. |
| **CTR drop %** | Compare current vs previous period: if CTR decreased, (prev − cur) ÷ prev × 100. |
| **CPL increase %** | Compare current vs previous: if CPL increased, (cur − prev) ÷ prev × 100. |
| **Score**      | Rule-based: Frequency > 3 (+30), CTR drop > 25% (+30), CPL increase > 30% (+40). Max 100. |
| **Status**     | **Healthy** (score 0–40), **Warning** (40–60), **Fatigued** (60+). |

**Backend:** `server/services/creativeFatigueService.js`, `server/routes/aiInsights.js` (POST `/api/ai/creative-fatigue`). Optional logging to `creative_fatigue_log`.

---

## 3. Lead Intelligence

**Purpose:** Lead quality scoring from form completion (and sugar level when available). No CRM or lead source integration.

**Workflow:**
- User clicks **Run scoring** in the Lead Intelligence section.
- Backend loads leads from the Leads DB for the selected date range (and optional campaign filter).
- Each lead is scored using **form completion** and optional **sugar level** (from form/field data).
- Scores are stored in `lead_scores` and a sample is returned; the UI can also load stored scores via GET.

**Scoring (0–100):**
- **Form completion:** Full (name + phone) = 10 points; partial = 5 points.
- **Sugar level** (optional): From lead data; > 200 = 20, 150–200 = 15, < 150 = 10; missing = 10 (neutral).
- Raw max = 30; score = (raw ÷ 30) × 100, clamped 0–100.

**Categories:**

| Score   | Category    |
|--------|-------------|
| 80–100 | Hot Lead    |
| 60–80  | Warm Lead   |
| 40–60  | Average     |
| 0–40   | Low Intent  |

**APIs:**
- **POST** `/api/ai/lead-quality` – run scoring (body: `dateFrom`, `dateTo`, optional `campaignIds`).
- **GET** `/api/ai/lead-quality/scores` – list stored scores (query: `dateFrom`, `dateTo`, `campaignId`, `limit`).

**Backend:** `server/services/leadQualityScoringService.js`, `server/routes/aiInsights.js`. Data in `lead_scores` (Supabase).

---

## Quick Reference

| Feature                    | Level     | Data sources              | Main output                    |
|---------------------------|-----------|---------------------------|--------------------------------|
| Lead Saturation Detection | Campaign  | Meta insights + Leads DB  | Score, Status, Frequency, CPL, Duplicate % |
| Creative Fatigue Detection| Ad (creative) | Meta ad insights    | Score, Status, Frequency, CTR, CPL        |
| Lead Intelligence         | Lead      | Leads DB (+ form/sugar)   | Score, Category (Hot/Warm/Average/Low Intent) |

All three features are implemented on the **AI Insights** page (`client/src/pages/AIInsights.jsx`) and use the AI Insights API routes in `server/routes/aiInsights.js`.
