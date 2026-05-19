/**
 * Instagram Business Account Insights Service
 *
 * Fetches insights for multiple Instagram Business Accounts via Meta Graph API v24.0.
 * - Accepts dynamic array of IG Business Account IDs (from DB or resolved from pages)
 * - Supports time range filters (7 days, 30 days, custom)
 * - Handles partial failures (one account fails, others still load)
 * - Rate-limit safe (uses schedule for concurrent control)
 *
 * Two request formats are used per account:
 * 1) Reached / Follows: GET .../{IG_USER_ID}/insights?metric=reach,follower_count&period=day&since=&until=
 * 2) Views / Interactions: GET .../{IG_USER_ID}/insights?metric=views,total_interactions&metric_type=total_value&period=day&since=&until=
 */

const axios = require("axios");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const META_API_VERSION = process.env.META_IG_API_VERSION || "v24.0";
const rateLimiter = require("../services/meta/rateLimiter");

function getAccessToken() {
  const token = (
    process.env.META_SYSTEM_ACCESS_TOKEN ||
    process.env.META_ACCESS_TOKEN ||
    ""
  ).trim();
  if (!token) {
    throw new Error(
      "Meta credentials missing. Configure META_SYSTEM_ACCESS_TOKEN or META_ACCESS_TOKEN in server/.env"
    );
  }
  return token;
}

/**
 * Resolve IG account IDs via instagram_accounts edge (requires Page access token).
 * GET /{page_id}/instagram_accounts returns { data: [{ id }] }
 * Matches Meta Graph API Explorer flow when using Page token.
 *
 * @param {string[]} pageIds - Facebook Page IDs
 * @param {(pageId: string) => Promise<string>} getPageTokenFn - Async function to get Page access token
 * @returns {Promise<{ accountIds: string[], pageToken?: string }>} IG IDs and first Page token for insights
 */
async function resolveIgAccountsViaInstagramAccountsEdge(pageIds, getPageTokenFn) {
  if (!pageIds || pageIds.length === 0) return { accountIds: [], pageToken: undefined };
  if (typeof getPageTokenFn !== "function") return { accountIds: [], pageToken: undefined };

  const seen = new Set();
  let firstPageToken = null;

  for (const pageId of pageIds) {
    try {
      const pageToken = await getPageTokenFn(pageId);
      if (!pageToken) continue;
      if (!firstPageToken) firstPageToken = pageToken;

      const url = `https://graph.facebook.com/${META_API_VERSION}/${pageId}/instagram_accounts`;
      const { data } = await rateLimiter.schedule(() =>
        axios.get(url, {
          params: { access_token: pageToken },
          timeout: 15000,
        })
      );

      const items = data?.data;
      if (Array.isArray(items)) {
        for (const item of items) {
          if (item?.id) seen.add(String(item.id));
        }
      }
    } catch (err) {
      console.warn(
        `[Instagram Insights] instagram_accounts edge failed for page ${pageId}:`,
        err?.response?.data?.error?.message || err.message
      );
    }
  }

  return { accountIds: Array.from(seen), pageToken: firstPageToken || undefined };
}

/**
 * Resolve Instagram Business Account IDs from Facebook Page IDs (fallback).
 * GET /{page-id}?fields=instagram_business_account
 *
 * @param {string[]} pageIds - Facebook Page IDs
 * @param {string} accessToken - System/User token
 * @returns {Promise<string[]>} Array of IG Business Account IDs (unique)
 */
async function resolveIgAccountsFromPages(pageIds, accessToken) {
  if (!pageIds || pageIds.length === 0) return [];

  const baseUrl = `https://graph.facebook.com/${META_API_VERSION}`;
  const seen = new Set();

  const results = await Promise.allSettled(
    pageIds.map((pageId) =>
      rateLimiter.schedule(() =>
        axios.get(`${baseUrl}/${pageId}`, {
          params: {
            fields: "instagram_business_account",
            access_token: accessToken,
          },
          timeout: 15000,
        })
      )
    )
  );

  for (const result of results) {
    if (result.status === "fulfilled" && result.value?.data?.instagram_business_account?.id) {
      seen.add(String(result.value.data.instagram_business_account.id));
    }
  }

  return Array.from(seen);
}

/**
 * Format YYYY-MM-DD to chart label "DD Mon" (e.g. "02 Nov").
 */
function formatChartDate(isoDate) {
  if (!isoDate) return "";
  const d = new Date(isoDate + "T00:00:00Z");
  const day = d.getUTCDate();
  const mon = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getUTCMonth()];
  return `${String(day).padStart(2, "0")} ${mon}`;
}

/**
 * Build daily views and engagements series from raw Meta insights data.
 * @param {object[]} data - Meta API response data array (metrics with name views, total_interactions)
 * @returns {Array<{ date: string, views: number, eng: number }>}
 */
function buildDailyViewsEngagements(data) {
  const byDate = {};
  for (const m of data || []) {
    const name = m.name;
    if (name !== "views" && name !== "total_interactions") continue;
    const values = m.values || [];
    for (const v of values) {
      const endTime = v?.end_time;
      const dateStr = endTime ? endTime.split("T")[0] : null;
      if (!dateStr) continue;
      const num = Number(v?.value) || 0;
      if (!byDate[dateStr]) byDate[dateStr] = { date: formatChartDate(dateStr), views: 0, eng: 0 };
      if (name === "views") byDate[dateStr].views += num;
      else if (name === "total_interactions") byDate[dateStr].eng += num;
    }
  }
  return Object.keys(byDate)
    .sort()
    .map((k) => byDate[k]);
}

/**
 * Extract numeric value from Meta API response. Handles both time_series (values array)
 * and total_value response formats per Meta docs.
 */
function extractMetricValue(m) {
  const values = m.values || [];
  const totalVal = m.total_value;
  const totalValue =
    totalVal != null
      ? typeof totalVal === "number"
        ? totalVal
        : totalVal?.value
      : null;
  if (totalValue != null) return Number(totalValue) || 0;
  let sum = 0;
  for (const v of values) {
    sum += Number(v?.value) || 0;
  }
  return sum;
}

/**
 * Sum all daily values from any metric (views, reach, total_interactions, etc.).
 * Use so dashboard totals match sum of daily breakdown, same as Follows.
 * @param {{ name: string, values: Array<{ value: number, end_time: string }> }} metric
 * @returns {number}
 */
function sumDailyMetricValues(metric) {
  const values = metric?.values || [];
  return values.reduce((sum, v) => sum + (Number(v?.value) || 0), 0);
}

/**
 * Sum all daily values from follower_count metric.
 * Use when API returns daily new followers per day (each value = new followers that day).
 * @param {{ name: string, values: Array<{ value: number, end_time: string }> }} followerCountMetric
 * @returns {number}
 */
function sumFollowerCountValues(followerCountMetric) {
  return sumDailyMetricValues(followerCountMetric);
}

/**
 * Compute total_follows and total_unfollows from follower_count daily deltas.
 * Unfollows are estimated using follower_count deltas because Instagram Graph API
 * does not expose daily unfollow metrics.
 *
 * @param {{ name: string, values: Array<{ value: number, end_time: string }> }} followerCountMetric
 * @returns {{ total_follows: number, total_unfollows: number, net_followers: number, date_range_days: number }}
 */
function computeUnfollowsFromFollowerCountDeltas(followerCountMetric) {
  const values = followerCountMetric?.values || [];
  if (values.length < 2) {
    return { total_follows: 0, total_unfollows: 0, net_followers: 0, date_range_days: values.length };
  }
  const sorted = [...values]
    .filter((v) => v && (v.value != null) && v.end_time)
    .map((v) => ({ value: Number(v.value) || 0, date: (v.end_time || "").split("T")[0] }))
    .sort((a, b) => a.date.localeCompare(b.date));
  let totalFollows = 0;
  let totalUnfollows = 0;
  for (let i = 1; i < sorted.length; i++) {
    const dailyChange = sorted[i].value - sorted[i - 1].value;
    if (dailyChange > 0) totalFollows += dailyChange;
    else if (dailyChange < 0) totalUnfollows += Math.abs(dailyChange);
  }
  const sumOfDailyValues = sorted.reduce((s, v) => s + v.value, 0);
  if (totalFollows === 0 && sumOfDailyValues > 0) {
    totalFollows = sumOfDailyValues;
  }
  return {
    total_follows: totalFollows,
    total_unfollows: totalUnfollows,
    net_followers: totalFollows - totalUnfollows,
    date_range_days: sorted.length,
  };
}

/**
 * Build daily subscriber change series from follower_count metric (daily deltas).
 * @param {{ name: string, values: Array<{ value: number, end_time: string }> }} followerCountMetric
 * @returns {Array<{ date: string, val: number }>}
 */
function buildDailySubscriberChange(followerCountMetric) {
  const values = followerCountMetric?.values || [];
  if (values.length < 2) return [];
  const sorted = [...values]
    .filter((v) => v && (v.value != null) && v.end_time)
    .map((v) => ({ value: Number(v.value) || 0, date: (v.end_time || "").split("T")[0] }))
    .sort((a, b) => a.date.localeCompare(b.date));
  const out = [];
  for (let i = 1; i < sorted.length; i++) {
    const dailyChange = sorted[i].value - sorted[i - 1].value;
    out.push({ date: formatChartDate(sorted[i].date), val: dailyChange });
  }
  return out;
}

/**
 * Build daily unfollows report: date, follower_count, daily_change, follows, unfollows.
 * Used for "Last 28 days" report showing how total_unfollows is derived.
 * @param {{ name: string, values: Array<{ value: number, end_time: string }> }} followerCountMetric
 * @returns {Array<{ date: string, follower_count: number, daily_change: number, follows: number, unfollows: number }>}
 */
function buildUnfollowsReportDaily(followerCountMetric) {
  const values = followerCountMetric?.values || [];
  if (values.length < 2) return [];
  const sorted = [...values]
    .filter((v) => v && (v.value != null) && v.end_time)
    .map((v) => ({ value: Number(v.value) || 0, date: (v.end_time || "").split("T")[0] }))
    .sort((a, b) => a.date.localeCompare(b.date));
  const out = [];
  for (let i = 1; i < sorted.length; i++) {
    const followerCount = sorted[i].value;
    const dailyChange = followerCount - sorted[i - 1].value;
    const follows = dailyChange > 0 ? dailyChange : 0;
    const unfollows = dailyChange < 0 ? Math.abs(dailyChange) : 0;
    out.push({
      date: sorted[i].date,
      follower_count: followerCount,
      daily_change: dailyChange,
      follows,
      unfollows,
    });
  }
  return out;
}

/**
 * Normalize a single account's Meta API response into our format.
 * Handles both values (time_series) and total_value response shapes.
 *
 * @param {string} accountId
 * @param {object[]} data - Meta API response data array
 * @param {string} date - YYYY-MM-DD
 * @returns {{ accountId, reached, follows, views, interactions, date }}
 */
function normalizeAccountResponse(accountId, data, date) {
  const out = {
    accountId,
    reached: 0,
    follows: 0,
    views: 0,
    interactions: 0,
    total_follows_delta: 0,
    total_unfollows: 0,
    net_followers_delta: 0,
    date_range_days: 0,
    date: date || new Date().toISOString().slice(0, 10),
    daily_views_engagements: [],
    daily_subscriber_change: [],
    unfollows_report_daily: [],
  };

  if (!Array.isArray(data)) return out;

  out.daily_views_engagements = buildDailyViewsEngagements(data);

  for (const m of data) {
    const name = m.name;
    const values = m.values || [];
    const totalValue = m.total_value?.value ?? (typeof m.total_value === "number" ? m.total_value : null);

    if (name === "follower_count") {
      const latest = values.length > 0 ? values[values.length - 1] : null;
      out.follows = latest ? Number(latest.value) || 0 : totalValue != null ? Number(totalValue) : 0;
      const deltaResult = computeUnfollowsFromFollowerCountDeltas(m);
      // Follows card: use sum of daily values (daily new followers) instead of sum of deltas
      out.total_follows_delta = sumFollowerCountValues(m);
      out.total_unfollows = deltaResult.total_unfollows;
      out.net_followers_delta = deltaResult.net_followers;
      out.date_range_days = deltaResult.date_range_days;
      out.daily_subscriber_change = buildDailySubscriberChange(m);
      out.unfollows_report_daily = buildUnfollowsReportDaily(m);
      continue;
    }

    const sum = extractMetricValue(m);
    // Prefer sum of daily values for reach/views/interactions (same as Follows) so dashboard matches daily breakdown
    const dailySum = sumDailyMetricValues(m);
    switch (name) {
      case "reach":
        out.reached = dailySum > 0 ? dailySum : sum;
        break;
      case "views":
        out.views = dailySum > 0 ? dailySum : sum;
        break;
      case "impressions":
        if (out.views === 0) out.views = sum;
        break;
      case "total_interactions":
        out.interactions = dailySum > 0 ? dailySum : sum;
        break;
      case "profile_views":
        if (out.interactions === 0) out.interactions = sum;
        break;
      default:
        break;
    }
  }

  return out;
}

/**
 * Convert YYYY-MM-DD date string to Unix timestamp (seconds).
 * Meta Instagram insights API requires Unix timestamps for since/until.
 */
function dateToUnix(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr + "T00:00:00Z");
  return Math.floor(d.getTime() / 1000);
}

/**
 * Call Instagram insights API for one set of metrics (optional metric_type).
 *
 * @param {string} igAccountId
 * @param {string} since - YYYY-MM-DD
 * @param {string} until - YYYY-MM-DD
 * @param {string} accessToken
 * @param {string} metrics - e.g. "reach,follower_count" or "views,total_interactions"
 * @param {string} [metricType] - e.g. "total_value" for views/total_interactions
 * @returns {Promise<object[] | null>} Meta API data array or null on error
 */
async function fetchInsightsRequest(igAccountId, since, until, accessToken, metrics, metricType) {
  const url = `https://graph.facebook.com/${META_API_VERSION}/${igAccountId}/insights`;
  const sinceUnix = dateToUnix(since);
  const untilUnix = dateToUnix(until);

  const params = {
    metric: metrics,
    period: "day",
    ...(metricType && { metric_type: metricType }),
    ...(sinceUnix != null && { since: sinceUnix }),
    ...(untilUnix != null && { until: untilUnix }),
    access_token: accessToken,
  };

  console.log("[Instagram Insights] Meta API call:", {
    igAccountId,
    metric: params.metric,
    metric_type: params.metric_type || "(none)",
    period: params.period,
  });

  try {
    const { data } = await axios.get(url, { params, timeout: 20000 });
    const rawData = data?.data || [];
    if (rawData.length > 0) {
      console.log("[Instagram Insights] Response metrics for account", igAccountId, ":", rawData.map((m) => m.name));
    }
    return rawData;
  } catch (err) {
    const code = err?.response?.data?.error?.code;
    const msg = err?.response?.data?.error?.message || err.message;
    console.error("[Instagram Insights] Meta API error for account", igAccountId, ":", { code, message: msg });
    return null;
  }
}

/**
 * Fetch insights for a single IG Business Account.
 * Uses three requests:
 * - Reached/Follows: metric=reach,follower_count&period=day
 * - Views/Interactions totals: metric=views,total_interactions&metric_type=total_value&period=day (for summary cards)
 * - Views/Interactions daily: metric=views,total_interactions&period=day (for chart time-series)
 *
 * @param {string} igAccountId
 * @param {string} since - YYYY-MM-DD (converted to Unix for Meta API)
 * @param {string} until - YYYY-MM-DD (converted to Unix for Meta API)
 * @param {string} accessToken
 * @returns {Promise<{ accountId, reached, follows, views, interactions, date } | null>}
 */
async function fetchSingleAccountInsights(igAccountId, since, until, accessToken) {
  const [reachData, viewsDataTotal, viewsDataDaily] = await Promise.all([
    fetchInsightsRequest(igAccountId, since, until, accessToken, "reach,follower_count"),
    fetchInsightsRequest(igAccountId, since, until, accessToken, "views,total_interactions", "total_value"),
    fetchInsightsRequest(igAccountId, since, until, accessToken, "views,total_interactions"),
  ]);

  const mergedData = [
    ...(Array.isArray(reachData) ? reachData : []),
    ...(Array.isArray(viewsDataTotal) ? viewsDataTotal : []),
    ...(Array.isArray(viewsDataDaily) ? viewsDataDaily : []),
  ];

  if (mergedData.length === 0) {
    console.warn("[Instagram Insights] No data returned for account", igAccountId);
    return null;
  }

  return normalizeAccountResponse(igAccountId, mergedData, until);
}

/**
 * Compute date range from period preset.
 * @param {string} period - 'last_7_days' | 'last_30_days'
 * @returns {{ since: string, until: string }}
 */
function getDateRangeFromPeriod(period) {
  const today = new Date();
  const until = new Date(today);
  until.setDate(until.getDate() - 1); // Yesterday (Meta often excludes today)
  const start = new Date(until);

  if (period === "last_30_days") {
    start.setDate(start.getDate() - 29);
  } else {
    start.setDate(start.getDate() - 6); // last_7_days
  }

  return {
    since: start.toISOString().slice(0, 10),
    until: until.toISOString().slice(0, 10),
  };
}

/**
 * Merge daily chart series from multiple accounts (by date, sum values).
 * @param {Array<Array<{ date: string, views?: number, eng?: number, val?: number }>>>} seriesList
 * @param {'views_eng'|'subscriber'} type
 * @returns {Array<{ date: string, views?: number, eng?: number, val?: number }>}
 */
function mergeDailySeries(seriesList, type) {
  const byDate = {};
  for (const arr of seriesList) {
    if (!Array.isArray(arr)) continue;
    for (const row of arr) {
      const d = row?.date;
      if (!d) continue;
      if (!byDate[d]) {
        if (type === "views_eng") byDate[d] = { date: d, views: 0, eng: 0 };
        else byDate[d] = { date: d, val: 0 };
      }
      if (type === "views_eng") {
        byDate[d].views += Number(row.views) || 0;
        byDate[d].eng += Number(row.eng) || 0;
      } else {
        byDate[d].val += Number(row.val) || 0;
      }
    }
  }
  return Object.keys(byDate)
    .sort()
    .map((k) => byDate[k]);
}

/**
 * Aggregate normalized account data for dashboard.
 *
 * @param {Array<{ accountId, reached, follows, views, interactions, daily_views_engagements, daily_subscriber_change }>} accounts
 * @returns {object}
 */
function aggregateAccounts(accounts) {
  const valid = accounts.filter(Boolean);
  const totalReached = valid.reduce((s, a) => s + (a.reached || 0), 0);
  const totalFollows = valid.reduce((s, a) => s + (a.follows || 0), 0);
  const totalViews = valid.reduce((s, a) => s + (a.views || 0), 0);
  const totalInteractions = valid.reduce((s, a) => s + (a.interactions || 0), 0);
  const totalUnfollows = valid.reduce((s, a) => s + (a.total_unfollows || 0), 0);
  const totalFollowsDelta = valid.reduce((s, a) => s + (a.total_follows_delta || 0), 0);
  const netFollowersDelta = totalFollowsDelta - totalUnfollows;
  const dateRangeDaysArr = valid.map((a) => a.date_range_days || 0);
  const maxDateRangeDays = dateRangeDaysArr.length > 0 ? Math.max(0, ...dateRangeDaysArr) : 0;

  const dailyViewsEngagements = mergeDailySeries(
    valid.map((a) => a.daily_views_engagements || []),
    "views_eng"
  );
  const dailySubscriberChange = mergeDailySeries(
    valid.map((a) => a.daily_subscriber_change || []),
    "subscriber"
  );
  // Use first account's daily report (same date range); multi-account could merge by date later
  const unfollowsReportDaily = (valid.length > 0 && valid[0].unfollows_report_daily) ? valid[0].unfollows_report_daily : [];

  return {
    totalReached,
    totalFollows,
    totalViews,
    totalInteractions,
    totalUnfollows,
    totalFollowsDelta,
    netFollowersDelta,
    date_range_days: maxDateRangeDays,
    daily_views_engagements: dailyViewsEngagements,
    daily_subscriber_change: dailySubscriberChange,
    unfollows_report_daily: unfollowsReportDaily,
    accounts: valid.map((a) => ({
      accountId: a.accountId,
      reached: a.reached || 0,
      follows: a.follows || 0,
      views: a.views || 0,
      interactions: a.interactions || 0,
      total_unfollows: a.total_unfollows || 0,
      total_follows_delta: a.total_follows_delta || 0,
    })),
  };
}

/**
 * Fetch insights for multiple IG Business Accounts.
 * Uses rate limiter to avoid Meta "too many API calls".
 * When pageIds + getPageToken provided: tries instagram_accounts edge with Page token first, then uses Page token for insights.
 *
 * @param {object} opts
 * @param {string[]} [opts.accountIds] - Direct IG Business Account IDs
 * @param {string[]} [opts.pageIds] - Resolve IG IDs from these Page IDs
 * @param {(pageId: string) => Promise<string>} [opts.getPageToken] - Async fn to get Page access token (for instagram_accounts edge)
 * @param {string} [opts.from] - YYYY-MM-DD
 * @param {string} [opts.to] - YYYY-MM-DD
 * @param {string} [opts.period] - 'last_7_days' | 'last_30_days' (used if from/to not set)
 * @returns {Promise<object>} Dashboard-ready structure
 */
async function fetchInstagramInsights(opts = {}) {
  console.log("[Instagram Insights] Service called with params:", {
    pageIds: opts.pageIds,
    accountIds: opts.accountIds,
    from: opts.from,
    to: opts.to,
    period: opts.period,
    hasGetPageToken: typeof opts.getPageToken === "function",
  });

  const systemToken = getAccessToken();
  let accountIds = opts.accountIds && opts.accountIds.length > 0
    ? [...opts.accountIds]
    : [];
  let insightsToken = systemToken;

  if (accountIds.length === 0 && opts.pageIds && opts.pageIds.length > 0) {
    if (typeof opts.getPageToken === "function") {
      const edgeResult = await resolveIgAccountsViaInstagramAccountsEdge(opts.pageIds, opts.getPageToken);
      accountIds = edgeResult.accountIds;
      if (edgeResult.pageToken) insightsToken = edgeResult.pageToken;
    }
    if (accountIds.length === 0) {
      accountIds = await resolveIgAccountsFromPages(opts.pageIds, systemToken);
    }
  }

  // When pageIds were provided, always use a Page access token for Instagram insights (Meta requirement)
  if (
    accountIds.length > 0 &&
    typeof opts.getPageToken === "function" &&
    opts.pageIds &&
    opts.pageIds.length > 0
  ) {
    if (insightsToken === systemToken) {
      for (const pageId of opts.pageIds) {
        const pageToken = await opts.getPageToken(pageId);
        if (pageToken) {
          insightsToken = pageToken;
          break;
        }
      }
    }
    if (insightsToken === systemToken) {
      console.warn("[Instagram Insights] Page access token required but could not be obtained for any page. Call GET /api/meta/pages first.");
      return {
        totalReached: 0,
        totalFollows: 0,
        totalViews: 0,
        totalInteractions: 0,
        accounts: [],
        data: null,
        error: "Page access token required for Instagram insights but could not be obtained. Ensure GET /api/meta/pages is called first so page tokens are available.",
      };
    }
  }

  if (accountIds.length === 0) {
    console.warn(
      "[Instagram Insights] No IG accounts resolved. Provide accountIds or pageIds with linked Instagram Business accounts."
    );
    return {
      totalReached: 0,
      totalFollows: 0,
      totalViews: 0,
      totalInteractions: 0,
      accounts: [],
      data: null,
      error: "No Instagram Business Account IDs to fetch. Provide accountIds or pageIds.",
    };
  }

  let since = opts.from;
  let until = opts.to;
  if (!since || !until) {
    const range = getDateRangeFromPeriod(opts.period || "last_7_days");
    since = range.since;
    until = range.until;
  }

  const tokenType = insightsToken === systemToken ? "system" : "page";
  console.log("[Instagram Insights] Token type for Meta API call:", tokenType);

  const results = await Promise.all(
    accountIds.map((id) =>
      rateLimiter.schedule(() =>
        fetchSingleAccountInsights(id, since, until, insightsToken)
      )
    )
  );

  const aggregated = aggregateAccounts(results);
  const date = until;

  const validCount = results.filter(Boolean).length;
  if (validCount === 0 && results.length > 0) {
    console.warn(
      "[Instagram Insights] All account fetches failed for",
      accountIds.length,
      "account(s). Check token permissions (instagram_manage_insights) and IG account linkage."
    );
  }

  const response = {
    ...aggregated,
    total_unfollows: aggregated.totalUnfollows,
    date,
    since,
    until,
    data: {
      total_views: aggregated.totalViews,
      total_interactions: aggregated.totalInteractions,
      total_follows: aggregated.totalFollowsDelta,
      total_reached: aggregated.totalReached,
      total_unfollows: aggregated.totalUnfollows,
      viewsChange: 0,
      interactionsChange: 0,
      followsChange: 0,
      reachChange: 0,
      unfollowsChange: 0,
      date_range_days: aggregated.date_range_days,
      period: `${since} to ${until}`,
      daily_views_engagements: aggregated.daily_views_engagements || [],
      daily_subscriber_change: aggregated.daily_subscriber_change || [],
      unfollows_report_daily: aggregated.unfollows_report_daily || [],
    },
    error: null,
  };
  console.log("[Instagram Insights] Service response:", {
    accountCount: accountIds.length,
    totalReached: response.totalReached,
    totalFollows: response.totalFollows,
    totalViews: response.totalViews,
    totalInteractions: response.totalInteractions,
    totalUnfollows: response.totalUnfollows,
  });
  return response;
}

/**
 * Fetch Instagram audience demographics (city, country, age, gender) for audience insights.
 * Uses metric=engaged_audience_demographics with breakdown=country, city, age, gender.
 * Requires period=lifetime and timeframe (this_week, this_month, etc.); does not support since/until.
 * Age and gender may be empty if the API or account does not support them.
 *
 * @param {string} igAccountId - Instagram Business Account ID
 * @param {string} accessToken - Page or Instagram access token (instagram_manage_insights)
 * @param {string} [timeframe] - this_week (7d), this_month (30d), or last_90_days
 * @returns {Promise<{ city_breakdown, country_breakdown, age_breakdown, gender_breakdown }>}
 */
async function fetchInstagramAudienceDemographics(igAccountId, accessToken, timeframe = "this_month") {
  const url = `https://graph.facebook.com/${META_API_VERSION}/${igAccountId}/insights`;
  const baseParams = {
    metric: "engaged_audience_demographics",
    period: "lifetime",
    timeframe,
    metric_type: "total_value",
    access_token: accessToken,
  };

  const parseBreakdownResults = (data, breakdownKey) => {
    const out = [];
    const items = data?.data || [];
    for (const metric of items) {
      const breakdowns = metric.total_value?.breakdowns || [];
      for (const bd of breakdowns) {
        const keys = bd.dimension_keys || [];
        const keyIndex = keys.indexOf(breakdownKey);
        if (keyIndex === -1) continue;
        const results = bd.results || [];
        for (const r of results) {
          const vals = r.dimension_values || [];
          const name = vals[keyIndex];
          const value = parseInt(r.value, 10) || 0;
          if (name != null && name !== "") out.push({ [breakdownKey]: name, value });
        }
      }
    }
    return out;
  };

  const fetchBreakdown = (breakdown) =>
    rateLimiter.schedule(() =>
      axios.get(url, { params: { ...baseParams, breakdown }, timeout: 20000 })
    ).then((res) => parseBreakdownResults(res.data, breakdown)).catch((err) => {
      console.warn("[Instagram Audience Demographics] breakdown=" + breakdown + ":", err?.response?.data?.error?.message || err.message);
      return [];
    });

  const isPermissionError = (err) => {
    const code = err?.response?.data?.error?.code;
    const msg = (err?.response?.data?.error?.message || err.message || "").toString();
    if (code === 10 || code === "10") return true;
    if (msg.includes("(#10)") || msg.includes("pages_read_engagement") || msg.includes("Page Public Content Access") || msg.includes("Page Public Metadata Access")) return true;
    return false;
  };

  try {
    const [country_breakdown, city_breakdown, age_breakdown, gender_breakdown] = await Promise.all([
      fetchBreakdown("country"),
      fetchBreakdown("city"),
      fetchBreakdown("age"),
      fetchBreakdown("gender"),
    ]);

    return { city_breakdown, country_breakdown, age_breakdown, gender_breakdown };
  } catch (err) {
    if (isPermissionError(err)) {
      const msg = err?.response?.data?.error?.message || err.message;
      console.warn("[Instagram Audience Demographics] Permission #10 — returning empty. Details:", msg);
      return { city_breakdown: [], country_breakdown: [], age_breakdown: [], gender_breakdown: [] };
    }
    const code = err?.response?.data?.error?.code;
    const msg = err?.response?.data?.error?.message || err.message;
    console.warn("[Instagram Audience Demographics] Error:", code, msg);
    throw err;
  }
}

/**
 * Fetch Instagram reach broken down by follow_type (Followers vs Non-Followers).
 * Meta API: GET /v24.0/{IG_USER_ID}/insights?metric=reach&period=day&metric_type=total_value&breakdown=follow_type
 * Returns same format as Meta Graph API: { data: [{ name, period, total_value, breakdowns }] }
 *
 * @param {string} igAccountId - Instagram Business Account ID
 * @param {string} since - YYYY-MM-DD
 * @param {string} until - YYYY-MM-DD
 * @param {string} accessToken - Page or Instagram access token (instagram_manage_insights)
 * @returns {Promise<{ total_value: number, follower_value: number, non_follower_value: number, raw?: object }>}
 */
async function fetchReachByFollowType(igAccountId, since, until, accessToken) {
  const sinceUnix = dateToUnix(since);
  const untilUnix = dateToUnix(until);
  const url = `https://graph.facebook.com/${META_API_VERSION}/${igAccountId}/insights`;
  const params = {
    metric: "reach",
    period: "day",
    metric_type: "total_value",
    breakdown: "follow_type",
    access_token: accessToken,
    ...(sinceUnix != null && { since: sinceUnix }),
    ...(untilUnix != null && { until: untilUnix }),
  };

  try {
    const { data } = await rateLimiter.schedule(() =>
      axios.get(url, { params, timeout: 20000 })
    );
    const items = Array.isArray(data?.data) ? data.data : [];
    const reachItems = items.filter((m) => m.name === "reach");
    if (reachItems.length === 0) {
      return { total_value: 0, follower_value: 0, non_follower_value: 0, raw: data };
    }

    let totalValue = 0;
    let followerValue = 0;
    let nonFollowerValue = 0;
    for (const reachMetric of reachItems) {
      totalValue += parseInt(reachMetric.total_value?.value, 10) || 0;
      const breakdowns = reachMetric.total_value?.breakdowns || reachMetric.breakdowns || [];
      for (const bd of breakdowns) {
        const results = bd.results || [];
        for (const r of results) {
          const dims = r.dimension_values || [];
          const val = parseInt(r.value, 10) || 0;
          if (dims.includes("FOLLOWER")) followerValue += val;
          if (dims.includes("NON_FOLLOWER")) nonFollowerValue += val;
        }
      }
    }

    return {
      total_value: totalValue,
      follower_value: followerValue,
      non_follower_value: nonFollowerValue,
      raw: reachItems.length === 1 ? reachItems[0] : { aggregated_from: reachItems.length, items: reachItems },
    };
  } catch (err) {
    const code = err?.response?.data?.error?.code;
    const msg = (err?.response?.data?.error?.message || err.message || "").toString();
    if (code === 10 || code === "10" || msg.includes("(#10)") || msg.includes("pages_read_engagement") || msg.includes("Page Public Content Access") || msg.includes("Page Public Metadata Access")) {
      console.warn("[Instagram Reach by Follow Type] Permission #10 — returning empty. Details:", msg);
      return { total_value: 0, follower_value: 0, non_follower_value: 0 };
    }
    console.warn("[Instagram Reach by Follow Type] Error:", code, msg);
    throw err;
  }
}

/**
 * Fetch online_followers metric from Instagram Insights API.
 * GET /{IG_USER_ID}/insights?metric=online_followers&period=lifetime
 * @param {string} igAccountId - Instagram Business Account ID
 * @param {string} accessToken - Page or Instagram access token (instagram_manage_insights)
 * @returns {Promise<object>} Raw API response { data: [...] }
 */
async function fetchOnlineFollowers(igAccountId, accessToken) {
  const url = `https://graph.facebook.com/${META_API_VERSION}/${igAccountId}/insights`;
  const params = { metric: "online_followers", period: "lifetime", access_token: accessToken };
  try {
    const { data } = await rateLimiter.schedule(() => axios.get(url, { params, timeout: 20000 }));
    return data || { data: [] };
  } catch (err) {
    const code = err?.response?.data?.error?.code;
    const msg = (err?.response?.data?.error?.message || err.message || "").toString();
    if (code === 10 || code === "10" || msg.includes("(#10)") || msg.includes("pages_read_engagement") || msg.includes("Page Public Content Access") || msg.includes("Page Public Metadata Access")) {
      console.warn("[Instagram online_followers] Permission #10 — returning empty. Details:", msg);
      return { data: [] };
    }
    console.warn("[Instagram online_followers] Error:", msg);
    throw err;
  }
}

module.exports = {
  fetchInstagramInsights,
  fetchInstagramAudienceDemographics,
  fetchReachByFollowType,
  fetchOnlineFollowers,
  resolveIgAccountsFromPages,
  resolveIgAccountsViaInstagramAccountsEdge,
  normalizeAccountResponse,
  aggregateAccounts,
  getDateRangeFromPeriod,
  computeUnfollowsFromFollowerCountDeltas,
};
