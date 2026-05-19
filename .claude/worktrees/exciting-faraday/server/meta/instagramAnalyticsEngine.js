/**
 * Instagram Analytics Engine — single-media dashboard from Meta Graph API.
 * Input: IG_USER_ID, MEDIA_ID, accessToken.
 * Output: dashboard JSON with reach, estimated_views, hook_rate, hold_rate,
 * engagement_score, likes/comments/saved/shares, best_posting_time.
 */

const axios = require("axios");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const META_API_VERSION = process.env.META_IG_API_VERSION || "v24.0";
const rateLimiter = require("../services/meta/rateLimiter");

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function hourToLabel(hour) {
  const h = Number(hour);
  if (h === 0) return "12 AM";
  if (h === 12) return "12 PM";
  if (h < 12) return `${h} AM`;
  return `${h - 12} PM`;
}

/**
 * Calculate estimated views: reach * multiplier (VIDEO 1.5, else 1.2).
 * @param {number|string} reach
 * @param {string} mediaType
 * @returns {number}
 */
function calculateEstimatedViews(reach, mediaType) {
  const r = Number(reach);
  if (Number.isNaN(r) || r < 0) return 0;
  const multiplier = String(mediaType || "").toUpperCase() === "VIDEO" ? 1.5 : 1.2;
  return Math.round(r * multiplier);
}

/**
 * Hook rate: (estimated_views / reach) * 100. Guard divide-by-zero.
 * @param {number} estimatedViews
 * @param {number} reach
 * @returns {number}
 */
function calculateHookRate(estimatedViews, reach) {
  const r = Number(reach);
  if (!r || Number.isNaN(r)) return 0;
  const v = Number(estimatedViews);
  if (Number.isNaN(v)) return 0;
  return Math.round((v / r) * 10000) / 100;
}

/**
 * Hold rate: (content_interactions / reach) * 100. Guard divide-by-zero.
 * @param {number} contentInteractions
 * @param {number} reach
 * @returns {number}
 */
function calculateHoldRate(contentInteractions, reach) {
  const r = Number(reach);
  if (!r || Number.isNaN(r)) return 0;
  const c = Number(contentInteractions);
  if (Number.isNaN(c)) return 0;
  return Math.round((c / r) * 10000) / 100;
}

/**
 * Find best posting time from online_followers API response.
 * Expects value with keys "0"-"6" (days), each value = hourly data (array of 24 or object with hour keys).
 * @param {object} onlineFollowersResponse - Raw API response (e.g. { data: [...] } or { value: { "0": [...], ... } })
 * @returns {{ best_day: string|null, best_hour: string|null, peak_score: number }}
 */
function findBestPostingTime(onlineFollowersResponse) {
  const out = { best_day: null, best_hour: null, peak_score: 0 };
  try {
    let valueObj = onlineFollowersResponse?.value;
    if (!valueObj && Array.isArray(onlineFollowersResponse?.data)) {
      const metric = onlineFollowersResponse.data.find((m) => m && m.name === "online_followers");
      valueObj =
        metric?.values?.[0]?.value ??
        metric?.total_value?.value ??
        metric?.total_value;
    }
    if (!valueObj || typeof valueObj !== "object") return out;

    let bestDay = 0;
    let bestHour = 0;
    let peakScore = 0;

    for (let day = 0; day <= 6; day++) {
      const dayKey = String(day);
      const dayData = valueObj[dayKey];
      if (dayData == null) continue;

      let hourly = [];
      if (Array.isArray(dayData)) {
        hourly = dayData.slice(0, 24).map((v) => Number(v) || 0);
      } else if (typeof dayData === "object" && !Array.isArray(dayData)) {
        for (let h = 0; h < 24; h++) {
          hourly[h] = Number(dayData[String(h)] ?? dayData[h]) || 0;
        }
      }

      for (let hour = 0; hour < hourly.length; hour++) {
        const score = Number(hourly[hour]) || 0;
        if (score > peakScore) {
          peakScore = score;
          bestDay = day;
          bestHour = hour;
        }
      }
    }

    out.best_day = DAY_NAMES[bestDay] ?? null;
    out.best_hour = hourToLabel(bestHour);
    out.peak_score = peakScore;
    return out;
  } catch (err) {
    console.warn("[Instagram Analytics Engine] findBestPostingTime parse error:", err?.message);
    return out;
  }
}

/**
 * Extract single numeric value from insights metric (values[0].value or total_value).
 * @param {object} data - response.data (array of metrics) or single metric
 * @param {string} [metricName] - optional name to find in array
 * @returns {number}
 */
function extractInsightValue(data, metricName) {
  const items = Array.isArray(data) ? data : data ? [data] : [];
  const metric = metricName ? items.find((m) => m && m.name === metricName) : items[0];
  if (!metric) return 0;
  const totalVal = metric.total_value;
  const fromTotal =
    totalVal != null
      ? typeof totalVal === "number"
        ? totalVal
        : Number(totalVal?.value)
      : null;
  if (fromTotal != null && !Number.isNaN(fromTotal)) return fromTotal;
  const values = metric.values || [];
  const first = values[0];
  const fromFirst = first?.value != null ? Number(first.value) : null;
  if (fromFirst != null && !Number.isNaN(fromFirst)) return fromFirst;
  return 0;
}

/**
 * Run full analytics for one media. Fetches media type, reach, engagement, online_followers;
 * computes estimated_views, hook_rate, hold_rate, engagement_score; returns dashboard JSON.
 * @param {{ igUserId: string, mediaId: string, accessToken: string }} opts
 * @returns {Promise<object>} Dashboard object (all metrics default to 0 on API errors)
 */
async function runAnalytics(opts) {
  const { igUserId, mediaId, accessToken } = opts || {};
  const token = (accessToken || "").trim();
  const mediaIdStr = (mediaId || "").trim();
  const igUserIdStr = (igUserId || "").trim();

  const defaultDashboard = () => ({
    media_id: mediaIdStr,
    media_type: "IMAGE",
    reach: 0,
    estimated_views: 0,
    hook_rate: "0%",
    hold_rate: "0%",
    engagement_score: "0%",
    likes: 0,
    comments: 0,
    saved: 0,
    shares: 0,
    best_posting_time: { day: null, hour: null, score: 0 },
  });

  if (!token || !mediaIdStr || !igUserIdStr) {
    return defaultDashboard();
  }

  const baseUrl = `https://graph.facebook.com/${META_API_VERSION}`;

  const apiGet = (url, params) =>
    rateLimiter.schedule(() =>
      axios.get(url, { params: { ...params, access_token: token }, timeout: 20000 })
    ).then((res) => res.data).catch((err) => {
      console.warn("[Instagram Analytics Engine] API error:", err?.response?.data?.error?.message || err.message);
      return null;
    });

  let mediaType = "IMAGE";
  try {
    const mediaRes = await apiGet(`${baseUrl}/${mediaIdStr}`, { fields: "media_type" });
    if (mediaRes && mediaRes.media_type) {
      mediaType = String(mediaRes.media_type);
    }
  } catch (_) {
    // keep default IMAGE
  }

  const [reachRes, engagementRes, onlineRes] = await Promise.all([
    apiGet(`${baseUrl}/${mediaIdStr}/insights`, { metric: "reach" }),
    apiGet(`${baseUrl}/${mediaIdStr}/insights`, { metric: "likes,comments,saved,shares" }),
    apiGet(`${baseUrl}/${igUserIdStr}/insights`, { metric: "online_followers", period: "lifetime" }),
  ]);

  const reach = extractInsightValue(reachRes?.data, "reach");
  const reachNum = Number(reach) || 0;

  let likes = 0;
  let comments = 0;
  let saved = 0;
  let shares = 0;
  if (engagementRes?.data) {
    likes = extractInsightValue(engagementRes.data, "likes");
    comments = extractInsightValue(engagementRes.data, "comments");
    saved = extractInsightValue(engagementRes.data, "saved");
    shares = extractInsightValue(engagementRes.data, "shares");
  }
  const contentInteractions = (Number(likes) || 0) + (Number(comments) || 0) + (Number(saved) || 0) + (Number(shares) || 0);

  const estimatedViews = calculateEstimatedViews(reachNum, mediaType);
  const hookRateNum = calculateHookRate(estimatedViews, reachNum);
  const holdRateNum = calculateHoldRate(contentInteractions, reachNum);
  const engagementScoreNum = calculateHoldRate(contentInteractions, reachNum);

  const bestPosting = findBestPostingTime(onlineRes || {});

  const formatPct = (n) => `${Number(n) || 0}%`;

  return {
    media_id: mediaIdStr,
    media_type: mediaType,
    reach: reachNum,
    estimated_views: estimatedViews,
    hook_rate: formatPct(hookRateNum),
    hold_rate: formatPct(holdRateNum),
    engagement_score: formatPct(engagementScoreNum),
    likes: Number(likes) || 0,
    comments: Number(comments) || 0,
    saved: Number(saved) || 0,
    shares: Number(shares) || 0,
    best_posting_time: {
      day: bestPosting.best_day,
      hour: bestPosting.best_hour,
      score: bestPosting.peak_score,
    },
  };
}

module.exports = {
  runAnalytics,
  calculateEstimatedViews,
  calculateHookRate,
  calculateHoldRate,
  findBestPostingTime,
};
