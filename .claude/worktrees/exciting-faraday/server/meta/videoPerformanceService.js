/**
 * Video Performance Service — fetches ad-level insights from Meta Ads API,
 * extracts video action metrics, and returns Hook Rate and Hold Rate per ad.
 * Used by GET /api/meta/video-performance.
 */

const axios = require("axios");

const META_API_VERSION = "v24.0";
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const cache = new Map();

function normalizeAdAccountId(id) {
  if (!id || typeof id !== "string") return "";
  const stripped = String(id).trim().replace(/^act_/, "");
  return stripped ? `act_${stripped}` : "";
}

function getActionValue(actionsArray, type) {
  if (!Array.isArray(actionsArray)) return 0;
  const entry = actionsArray.find((a) => a && a.action_type === type);
  if (!entry || entry.value == null) return 0;
  const n = Number(entry.value);
  return Number.isFinite(n) ? n : 0;
}

function getActionValueFromRow(row, type) {
  const fromActions = getActionValue(row.actions, type);
  if (fromActions > 0) return fromActions;
  return getActionValue(row.action_values, type);
}

/** Meta can return video completion as top-level arrays. */
function getTopLevel(row, key) {
  if (!row || !row[key] || !Array.isArray(row[key]) || row[key].length === 0) return 0;
  const v = row[key][0] && (row[key][0].value != null ? row[key][0].value : row[key][0]);
  return Number(v) || 0;
}

/** Best available video completion count (p100, p95, p75, p50, p25). */
function getVideoCompletionFromRow(row) {
  const keys = [
    "video_p100_watched_actions", "video_p100_watched",
    "video_p95_watched_actions", "video_p95_watched",
    "video_p75_watched_actions", "video_p75_watched",
    "video_p50_watched_actions", "video_p50_watched",
    "video_p25_watched_actions", "video_p25_watched",
  ];
  for (const key of keys) {
    const v = getTopLevel(row, key) || getActionValueFromRow(row, key);
    if (v > 0) return v;
  }
  return 0;
}

async function fetchVideoPerformanceFromMeta(adAccountId, accessToken, since, until) {
  const url = `https://graph.facebook.com/${META_API_VERSION}/${adAccountId}/insights`;
  const params = {
    access_token: accessToken,
    level: "ad",
    fields: "ad_id,ad_name,impressions,actions,action_values,video_play_actions,video_p25_watched_actions,video_p50_watched_actions,video_p75_watched_actions,video_p100_watched_actions",
    limit: 1000,
  };
  if (since && until) {
    params.time_range = JSON.stringify({ since, until });
  } else {
    params.date_preset = "last_7d";
  }

  let allRows = [];
  let currentParams = { ...params };
  let pageCount = 0;
  const maxPages = 20;

  do {
    const res = await axios.get(url, { params: currentParams, timeout: 60000 });
    const data = res.data;
    const chunk = Array.isArray(data.data) ? data.data : [];
    allRows = allRows.concat(chunk);

    const nextUrl = data.paging && data.paging.next;
    if (nextUrl && pageCount < maxPages) {
      const u = new URL(data.paging.next);
      currentParams = { ...params, after: u.searchParams.get("after") };
      pageCount++;
    } else {
      break;
    }
  } while (true);

  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  return allRows.map((row) => {
    const impressions = Number(row.impressions) || 0;
    const plays =
      getTopLevel(row, "video_play_actions") ||
      getTopLevel(row, "video_play") ||
      getTopLevel(row, "video_view") ||
      getActionValue(row.actions, "video_play") ||
      getActionValue(row.actions, "video_view") ||
      getActionValue(row.action_values, "video_play") ||
      getActionValue(row.action_values, "video_view");
    const videoPlay = plays;
    const video3sViews =
      getTopLevel(row, "video_3_sec_watched_actions") ||
      getActionValueFromRow(row, "video_3_sec_watched_actions") ||
      getActionValueFromRow(row, "video_view_3s") ||
      getActionValueFromRow(row, "video_views_3s") ||
      0;
    const videoThruPlays =
      getTopLevel(row, "video_thruplay_watched_actions") ||
      getActionValueFromRow(row, "video_thruplay_watched_actions") ||
      0;
    const videoViews =
      getTopLevel(row, "video_view") ||
      getActionValueFromRow(row, "video_view") ||
      getActionValueFromRow(row, "video_views") ||
      0;
    const p100Watched = getVideoCompletionFromRow(row);
    const p50Watched =
      getTopLevel(row, "video_p50_watched_actions") ||
      getActionValueFromRow(row, "video_p50_watched_actions") ||
      getActionValueFromRow(row, "video_p50_watched") ||
      0;
    const p75Watched =
      getTopLevel(row, "video_p75_watched_actions") ||
      getActionValueFromRow(row, "video_p75_watched_actions") ||
      getActionValueFromRow(row, "video_p75_watched") ||
      0;
    let hookRate = impressions > 0 ? (plays / impressions) * 100 : 0;
    // Hold Rate = (p50 or p75) / 3-sec views × 100 — works for ALL campaign types (Conversions, Lead Gen, etc.). ThruPlay only exists for Video Views campaigns.
    const holdNumerator =
      p50Watched > 0
        ? p50Watched
        : p75Watched > 0
          ? p75Watched
          : videoThruPlays > 0
            ? videoThruPlays
            : p100Watched;
    let holdRate =
      video3sViews > 0 && holdNumerator > 0
        ? (holdNumerator / video3sViews) * 100
        : videoPlay > 0
          ? (p100Watched / videoPlay) * 100
          : 0;
    if (holdRate === 0 && video3sViews > 0 && videoViews > 0) {
      holdRate = Math.min(100, (videoViews / video3sViews) * 100);
    } else if (holdRate === 0 && video3sViews > 0 && videoPlay > 0) {
      holdRate = Math.min(100, (videoPlay / video3sViews) * 100);
    }
    hookRate = Math.round(hookRate * 100) / 100;
    holdRate = Math.round(holdRate * 100) / 100;
    return {
      adName: row.ad_name || "Unnamed",
      impressions,
      plays,
      completedViews: p100Watched,
      hookRate,
      holdRate,
    };
  });
}

async function fetchVideoPerformance(adAccountId, accessToken, since, until) {
  const normalizedId = normalizeAdAccountId(adAccountId);
  if (!normalizedId) {
    throw Object.assign(new Error("adAccountId is required"), { statusCode: 400 });
  }
  if (!accessToken || !String(accessToken).trim()) {
    throw Object.assign(
      new Error("accessToken is required (query param or META_ACCESS_TOKEN in server .env)"),
      { statusCode: 400 }
    );
  }

  const cacheKey = `video_perf:${normalizedId}:${since || ""}:${until || ""}`;
  const now = Date.now();
  const hit = cache.get(cacheKey);
  if (hit && hit.expires > now) {
    return hit.data;
  }

  try {
    const data = await fetchVideoPerformanceFromMeta(normalizedId, accessToken, since, until);
    cache.set(cacheKey, { data, expires: now + CACHE_TTL_MS });
    return data;
  } catch (err) {
    if (err.response && err.response.data && err.response.data.error) {
      const metaError = err.response.data.error;
      const code = metaError.code;
      const msg = metaError.message || err.message;
      if (code === 190 || (msg && msg.toLowerCase().includes("token"))) {
        throw Object.assign(new Error(msg), { statusCode: 401 });
      }
      if (code === 10 || code === 200 || (msg && msg.toLowerCase().includes("permission"))) {
        throw Object.assign(new Error(msg), { statusCode: 403 });
      }
      throw Object.assign(new Error(msg), { statusCode: 502 });
    }
    console.error("[VideoPerformance]", err.message);
    throw Object.assign(new Error(err.message || "Failed to fetch video performance"), {
      statusCode: 500,
    });
  }
}

module.exports = {
  fetchVideoPerformance,
  normalizeAdAccountId,
  getActionValue,
};
