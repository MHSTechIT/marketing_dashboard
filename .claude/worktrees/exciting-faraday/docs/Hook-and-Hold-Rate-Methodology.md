# Ads Analytics Dashboard — Hook Rate & Hold Rate Methodology

**Document version:** 1.0  
**Product:** Marketing Dashboard — Ads Analytics (`Dashboards.jsx` + Meta Insights)  
**Last updated:** March 2026  

This document explains **exactly** how the **Hook Rate** and **Hold Rate** KPIs on the Ads Analytics Dashboard are computed in code, which **Meta Marketing API** fields are involved, and how **filters** (ad account, campaign, ad name, date range) affect the numbers.

---

## 1. Data source and scope

| Aspect | Detail |
|--------|--------|
| **API** | Meta Marketing API — **Ad Insights** (`GET /act_{ad_account_id}/insights`) |
| **Level** | **Ad** (one row per ad per day when `time_increment=1`) |
| **Storage / refresh** | Rows may be loaded from your database and/or **live** Meta on refresh (“Refresh with live data”). |
| **Dashboard aggregation** | For the KPI cards, metrics are **summed** across all insight rows that pass the current **filters** (platform, project, ad account, campaign, ad name, date range). |

**Important:** The KPIs use **ratio of totals** (sum numerators ÷ sum denominators), not an average of per-day percentages. That matches common “total row” behavior in reporting tools.

---

## 2. Hook Rate

### 2.1 What the UI describes

The Hook Rate card subtitle is:

> **3s views ÷ impressions · else plays ÷ impressions**

That matches the implementation: **three-second video views** are preferred; if Meta does not report 3-second views for the selected rows, the dashboard **falls back** to **video plays** vs impressions.

### 2.2 Formula (KPI / totals)

Let:

- \(I\) = **Impressions** — sum of `impressions` across filtered rows  
- \(V_{3s}\) = **3-second video views** — sum of `video3sViews` (from Meta field `video_3_sec_watched_actions` and related action types, after enrichment)  
- \(P\) = **Video plays** — sum of `videoPlays` (from `video_play_actions` / `video_play` / `video_view` style metrics)

**Hook Rate (%)** is computed as:

\[
\text{Hook Rate} =
\begin{cases}
\displaystyle \frac{V_{3s}}{I} \times 100 & \text{if } V_{3s} > 0 \\[8pt]
\displaystyle \frac{P}{I} \times 100 & \text{if } V_{3s} = 0 \text{ and } P > 0 \\[8pt]
0 & \text{otherwise}
\end{cases}
\]

If \(I = 0\), Hook Rate is **0%**.

### 2.3 Meta metrics involved (3-second path)

Typical sources for \(V_{3s}\) (resolved per row on server and client):

- `video_3_sec_watched_actions` (often returned as a **top-level** insights field, not only inside `actions[]`)
- Fallback action types such as `video_view_3s`, `video_views_3s`, autoplay variants, etc.

### 2.4 Meta metrics involved (fallback path)

If \(V_{3s} = 0\) for the aggregated totals but video activity exists:

- **Plays** \(P\) come from `video_play_actions`, or `video_play`, or `video_view` (see `enrichInsightsRow` in `server/meta/insightsService.js`).

### 2.5 Example interpretation (your screenshot)

For filters:

- **Ad account:** My Health School – Test Account  
- **Campaign:** `[DT] - LLA Form Ads – 11/03/2026` (example)  
- **Ad:** Ladu  

with **Hook Rate = 94.83%** and **Impressions ≈ 215,096** (from the same view):

- **If the primary 3-second path is used** (\(V_{3s} > 0\)):

\[
0.9483 \approx \frac{V_{3s}}{215{,}096}
\quad\Rightarrow\quad
V_{3s} \approx 0.9483 \times 215{,}096 \approx 203{,}900
\]

So about **204k** three-second views vs **215k** impressions (~95% of impressions logged at least 3s of video — plausible for video-heavy delivery).

- **If the fallback path were used** (\(V_{3s} = 0\), plays only), then \(P/I \approx 0.9483\) would imply **plays** nearly equal to **impressions**; the UI would still show the same percentage, but the **meaning** would be “plays per impression,” not “3s per impression.” The subtitle describes both behaviors.

**To know which branch applied:** compare **Impressions** to raw **3s** and **plays** in Meta Ads Manager or export insights for the same ad and date range; if `video_3_sec_watched_actions` > 0, the first branch is used.

---

## 3. Hold Rate

### 3.1 UI subtitle vs implementation

The Hold Rate card may show:

> **100% Watched / Video Play**

That phrase describes **one** of the valid branches in the product. The **KPI aggregate** in code uses a **priority order**: it first tries **milestone retention vs 3-second views** (e.g. 50% / 75% watched vs 3s), then falls back to **completions vs plays**, **ThruPlay**, etc. So the **number on the card** follows the **code below**, not only “p100 ÷ plays.”

### 3.2 Inputs (summed over filtered rows)

From each insight row, after parsing `actions` / top-level fields, the dashboard sums:

| Symbol | Meaning | Typical Meta sources |
|--------|---------|----------------------|
| \(V_{3s}\) | 3-second views | `video_3_sec_watched_actions`, etc. |
| \(P_{50}\) | 50% video watched | `video_p50_watched_actions` |
| \(P_{75}\) | 75% video watched | `video_p75_watched_actions` |
| \(T\) | ThruPlay | `video_thruplay_watched_actions` |
| \(P_{100}\) | 100% / completion | `video_p100_watched_actions` (and similar) |
| \(P\) | Video plays | `video_play_actions` / `video_play` / `video_view` |
| \(V\) | Video views (aggregate action) | `video_view` / `video_views` |

### 3.3 Hold numerator (priority order)

Define the **hold numerator** \(H\) as the **first** positive value in this list:

1. \(P_{50}\) if \(P_{50} > 0\)  
2. Else \(P_{75}\) if \(P_{75} > 0\)  
3. Else \(T\) if \(T > 0\)  
4. Else \(P_{100}\)

### 3.4 Formula cascade (KPI / `aggregateHoldRatePct`)

The implementation evaluates **in order**:

1. **Primary (retention vs hook audience):**  
   If \(V_{3s} > 0\) and \(H > 0\):

   \[
   \text{Hold Rate} = \frac{H}{V_{3s}} \times 100
   \]

   (Result rounded to 2 decimals in code.)

2. **Else if** \(P > 0\) and \(P_{100} > 0\):

   \[
   \text{Hold Rate} = \frac{P_{100}}{P} \times 100
   \]

   (This aligns with “100% watched / video play” when the first branch does not apply.)

3. **Further fallbacks** use ThruPlay vs plays, ThruPlay vs video views, ThruPlay vs 3s, caps at 100% where noted — see `aggregateHoldRatePct` in `client/src/pages/Dashboards.jsx`.

If no branch applies, Hold Rate = **0%**.

### 3.5 Example interpretation (your screenshot)

**Hold Rate = 1.08%** with **Hook ≈ 94.83%** and **Impressions ≈ 215k**:

- If the **first branch** applied (\(H / V_{3s}\)):

\[
0.0108 \approx \frac{H}{V_{3s}}
\quad\Rightarrow\quad
H \approx 0.0108 \times V_{3s}
\]

With \(V_{3s} \approx 2.04 \times 10^5\), that gives \(H \approx 2{,}200\) **watched to the chosen milestone** (often **p50** or **p75** counts), expressed as a share of **3-second views**. A **low** percentage means: among people who watched at least 3 seconds, only a small fraction reached the 50%/75%/ThruPlay/completion numerator \(H\) **relative to how Meta attributes those counts** in your account.

- If the **p100 / plays** branch applied instead, 1.08% would mean roughly **1.08% of plays** ended in a counted 100% view — rare for long creatives; the branch used depends on which metrics Meta returns for that ad.

**To verify:** For the same ad and dates in Ads Manager, compare **3-second views**, **plays**, and **video milestone** columns to the sums implied above.

---

## 4. Filters and consistency

- **Ad account / campaign / ad name:** Only rows matching the selected filters enter `filteredRows`. Hook and Hold are **recomputed from summed fields** for that scope.  
- **Date range:** All daily ad-level rows in range are included in the sums.  
- **Non-Meta rows (e.g. Wix):** If present in the same table, they contribute to impressions/clicks but usually **not** to Meta video fields — they can dilute or leave video ratios unchanged depending on volume.

---

## 5. Code references (for engineers)

| Topic | Location |
|-------|----------|
| Hook / Hold aggregation helpers | `client/src/pages/Dashboards.jsx` — `aggregateHookRatePct`, `aggregateHoldRatePct` |
| KPI totals (sums + apply helpers) | `client/src/pages/Dashboards.jsx` — `totals` `useMemo` |
| Row enrichment (3s, plays, milestones) | `server/meta/insightsService.js` — `enrichInsightsRow` |
| Insights field list (includes `video_3_sec_watched_actions`, etc.) | `server/meta/insightsService.js` — `fetchInsightsFromMetaLive` `fields` |

---

## 6. Disclaimer

Meta’s definitions of **impressions**, **video plays**, and **milestone actions** can differ by placement, attribution settings, and API version. This document describes **this application’s** formulas. For an audit, compare exported **Ad Insights** for the same `ad_id` and `date_range` to the sums shown internally.

---

*Generated for the Marketing Dashboard codebase. You can print this file to PDF from any Markdown viewer or editor (e.g. VS Code Markdown PDF, Pandoc, or browser print).*
