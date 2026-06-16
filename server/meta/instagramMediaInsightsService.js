/**
 * Instagram Media Insights Service (Reel Hook Rate & Hold Rate)
 *
 * Uses Instagram Graph API v24+ to:
 * 1) Fetch media list per IG Business Account (id, media_type, product_type, video_duration)
 * 2) Auto-detect Reels (VIDEO + REELS); retention metrics are ONLY supported for Reels (Meta #100 for feed videos)
 * 3) Conditionally request retention metrics for Reels vs standard metrics for non-Reels (never mix)
 * 4) Compute hook_rate and hold_rate for Reels only; return null + availability for non-Reels
 *
 * All Graph API calls go through an error-safe wrapper and the shared rate limiter.
 */

const axios = require("axios");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const META_API_VERSION = process.env.META_IG_API_VERSION || "v24.0";
const igRateLimiter = require("../services/meta/igRateLimiter");
const {
  resolveIgAccountsViaInstagramAccountsEdge,
  resolveIgAccountsFromPages,
  getDateRangeFromPeriod,
} = require("./instagramInsightsService");
const storySnapshots = require("../repositories/instagramStorySnapshotsRepository");

function getSystemToken() {
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
 * Error-safe Graph API GET. Catches Meta errors (including #100 invalid metric);
 * never throws metric errors to caller so they never reach the frontend.
 * @param {string} url - Full Graph API URL
 * @param {object} params - Query params (access_token added by caller)
 * @returns {Promise<object|null>} response.data or null on error
 */
async function graphApiGet(url, params) {
  try {
    const { data } = await axios.get(url, {
      params: { ...params },
      timeout: 20000,
    });
    return data;
  } catch (err) {
    const code = err?.response?.data?.error?.code;
    const msg = err?.response?.data?.error?.message || err.message;
    // #100 = invalid parameter/metric; do not propagate to frontend
    if (code === 100) {
      console.warn("[Instagram Media Insights] Meta error #100 (invalid metric) - retention metrics not supported for this media:", msg);
      return null;
    }
    console.warn("[Instagram Media Insights] Graph API error:", { code, message: msg });
    return null;
  }
}

/**
 * Step 1 — Fetch media list for an IG Business Account.
 * GET /{ig_user_id}/media?fields=id,media_type,product_type,video_duration,permalink,timestamp,caption
 * Handles pagination via next cursor.
 *
 * @param {string} igAccountId - IG Business Account ID
 * @param {string} accessToken - Page or system access token
 * @returns {Promise<Array<{ id, media_type, product_type, video_duration, permalink, timestamp, caption }>>}
 */
async function fetchMediaList(igAccountId, accessToken) {
  const baseUrl = `https://graph.facebook.com/${META_API_VERSION}/${igAccountId}/media`;
  const fields = "id,media_type,product_type,video_duration,permalink,timestamp,caption,thumbnail_url,media_url";
  const limit = 100;
  const all = [];

  let url = baseUrl;
  let params = { fields, limit, access_token: accessToken };

  while (url) {
    const data = await igRateLimiter.schedule(() => graphApiGet(url, params));
    if (!data) break;

    const items = data.data || [];
    for (const item of items) {
      all.push({
        id: item.id,
        media_type: item.media_type || null,
        product_type: item.product_type || null,
        video_duration: item.video_duration != null ? Number(item.video_duration) : null,
        permalink: item.permalink || null,
        timestamp: item.timestamp || null,
        caption: (item.caption && typeof item.caption === "string") ? item.caption : null,
        thumbnail_url: item.thumbnail_url || null,
        media_url: item.media_url || null,
      });
    }

    const nextUrl = data.paging?.next;
    if (!nextUrl || items.length === 0) break;
    url = nextUrl;
    params = {};
  }

  return all;
}

/**
 * Step 2 — Reel detection. Retention metrics (plays, video_views, video_avg_time_watched)
 * are ONLY supported when media_type === "VIDEO" and product_type === "REELS".
 * Requesting them for feed videos causes Meta error #100.
 * Fallback: if product_type is missing, treat as Reel when permalink contains "/reel/".
 *
 * @param {{ media_type?: string, product_type?: string, permalink?: string }} media
 * @returns {boolean}
 */
function isReel(media) {
  if (media.media_type === "VIDEO" && media.product_type === "REELS") return true;
  if (!media.product_type && (media.permalink || "").includes("/reel/")) return true;
  return false;
}

/**
 * Hook rate: (threeSecondViews / totalPlays) * 100.
 * Divide-by-zero safe, clamped 0–100, 2 decimals.
 */
function calcHookRate(threeSecondViews, totalPlays) {
  if (threeSecondViews == null || threeSecondViews < 0) return null;
  const total = Number(totalPlays) || 0;
  if (total <= 0) return null;
  const rate = (Number(threeSecondViews) / total) * 100;
  const clamped = Math.min(100, Math.max(0, rate));
  return Math.round(clamped * 100) / 100;
}

/**
 * Step 4 — Hold rate: (video_avg_time_watched / video_duration) * 100. Divide-by-zero safe, clamped 0–100, 2 decimals.
 */
function calcHoldRate(video_avg_time_watched, video_duration) {
  if (video_duration == null || video_duration <= 0) return 0;
  const rate = (Number(video_avg_time_watched) / Number(video_duration)) * 100;
  const clamped = Math.min(100, Math.max(0, rate));
  return Math.round(clamped * 100) / 100;
}

/**
 * Extract numeric value from a Meta insights metric (values array or total_value).
 */
function extractMetricValue(metric) {
  if (!metric) return 0;
  const totalVal = metric.total_value;
  const totalValue =
    totalVal != null
      ? typeof totalVal === "number"
        ? totalVal
        : totalVal?.value
      : null;
  if (totalValue != null) return Number(totalValue) || 0;
  const values = metric.values || [];
  let sum = 0;
  for (const v of values) {
    sum += Number(v?.value) || 0;
  }
  return sum;
}

/**
 * Step 3 — Conditional insights fetch per media.
 * Reels: views, reach, ig_reels_avg_watch_time, total_interactions, likes, comments (plays/video_views deprecated).
 * Non-Reels: views, reach, total_interactions, likes, comments, saved.
 *
 * @param {object} media - { id, media_type, product_type, video_duration, permalink, timestamp, caption }
 * @param {string} accessToken
 * @returns {Promise<{ media_id, permalink, timestamp, caption, media_type, product_type, views, reach, video_avg_time_watched, total_interactions, likes, comments, hook_rate, hold_rate, availability }>}
 */
async function fetchMediaInsights(media, accessToken) {
  const mediaId = media.id;
  const reel = isReel(media);
  const productType = media.product_type || (reel ? "REELS" : "FEED");

  const baseUrl = `https://graph.facebook.com/${META_API_VERSION}/${mediaId}/insights`;

  // Reels: views (3s+), reach, ig_reels_avg_watch_time. Do not request "plays" (deprecated in Meta v22.0+).
  // ig_reels_video_follow_count is fetched in a SEPARATE call so that if it fails (error #100),
  // it cannot zero-out the main metrics (views, likes, comments, saved, shares).
  if (reel) {
    const data = await igRateLimiter.schedule(() =>
      graphApiGet(baseUrl, {
        metric: "views,reach,ig_reels_avg_watch_time,total_interactions,likes,comments,saved,shares",
        access_token: accessToken,
      })
    );
    if (!data || !Array.isArray(data.data)) {
      return {
        media_id: mediaId,
        permalink: media.permalink || null,
        timestamp: media.timestamp || null,
        caption: media.caption || null,
        media_type: media.media_type || "VIDEO",
        product_type: productType,
        thumbnail_url: media.thumbnail_url || null,
        media_url: media.media_url || null,
        views: 0,
        reach: 0,
        video_avg_time_watched: 0,
        total_interactions: 0,
        likes: 0,
        comments: 0,
        saved: 0,
        shares: 0,
        follows: 0,
        hook_rate: null,
        hold_rate: null,
        availability: "not_supported",
      };
    }

    const metrics = {};
    for (const m of data.data) {
      metrics[m.name] = extractMetricValue(m);
    }

    const views = metrics.views ?? 0;
    const reach = metrics.reach ?? 0;
    const plays = metrics.plays ?? 0;
    const video_avg_time_watched = metrics.ig_reels_avg_watch_time ?? 0;
    const video_duration = media.video_duration ?? 0;
    const total_interactions = metrics.total_interactions ?? 0;
    const likes = metrics.likes ?? 0;
    const comments = metrics.comments ?? 0;
    const saved = metrics.saved ?? 0;
    const shares = metrics.shares ?? 0;
    // follows metric skipped — not used in reel scoring, saves one API call per reel
    const follows = 0;

    const totalPlays = Number(plays) || 0;
    const hook_rate = calcHookRate(views, totalPlays) ?? (reach > 0 ? calcHookRate(views, reach) : null);
    const hold_rate = calcHoldRate(video_avg_time_watched, video_duration);

    return {
      media_id: mediaId,
      permalink: media.permalink || null,
      timestamp: media.timestamp || null,
      caption: media.caption || null,
      media_type: media.media_type || "VIDEO",
      product_type: productType,
      thumbnail_url: media.thumbnail_url || null,
      media_url: media.media_url || null,
      views,
      reach,
      plays: totalPlays,
      video_views: views,
      video_avg_time_watched,
      total_interactions,
      likes,
      comments,
      saved,
      shares,
      follows,
      hook_rate,
      hold_rate,
      availability: "available",
    };
  }

  // Non-Reels (Posts/Stories): views, reach, total_interactions, likes, comments, saved, shares
  const data = await igRateLimiter.schedule(() =>
    graphApiGet(baseUrl, {
      metric: "views,reach,total_interactions,likes,comments,saved,shares",
      access_token: accessToken,
    })
  );

  if (!data || !Array.isArray(data.data)) {
    return {
      media_id: mediaId,
      permalink: media.permalink || null,
      timestamp: media.timestamp || null,
      caption: media.caption || null,
      media_type: media.media_type || "VIDEO",
      product_type: productType,
      thumbnail_url: media.thumbnail_url || null,
      media_url: media.media_url || null,
      views: 0,
      reach: 0,
      total_interactions: 0,
      likes: 0,
      comments: 0,
      saved: 0,
      shares: 0,
      hook_rate: null,
      hold_rate: null,
      availability: "not_supported",
    };
  }

  const metrics = {};
  for (const m of data.data) {
    metrics[m.name] = extractMetricValue(m);
  }

  const views = metrics.views ?? 0;
  const reach = metrics.reach ?? 0;
  const total_interactions = metrics.total_interactions ?? 0;
  const likes = metrics.likes ?? 0;
  const comments = metrics.comments ?? 0;
  const saved = metrics.saved ?? 0;
  const shares = metrics.shares ?? 0;

  return {
    media_id: mediaId,
    permalink: media.permalink || null,
    timestamp: media.timestamp || null,
    caption: media.caption || null,
    media_type: media.media_type || "VIDEO",
    product_type: productType,
    thumbnail_url: media.thumbnail_url || null,
    media_url: media.media_url || null,
    views,
    reach,
    video_views: views,
    video_avg_time_watched: 0,
    total_interactions,
    likes,
    comments,
    saved,
    shares,
    hook_rate: null,
    hold_rate: null,
    availability: "available",
  };
}

/**
 * Map contentType param to product_type filter.
 * @param {string} [contentType] - 'all' | 'posts' | 'stories' | 'reels'
 * @returns {string|null} - 'FEED' | 'STORY' | 'REELS' | null (all)
 */
function contentTypeToProductType(contentType) {
  if (!contentType || contentType === "all") return null;
  const map = { posts: "FEED", stories: "STORY", reels: "REELS" };
  return map[contentType] || null;
}

/**
 * Filter media list by product_type (and optionally timestamp for date range).
 * @param {Array} mediaList
 * @param {string|null} productType - 'FEED' | 'STORY' | 'REELS' | null
 * @param {{ from?: string, to?: string }} dateRange - YYYY-MM-DD
 * @returns {Array}
 */
function filterMediaByContentTypeAndDate(mediaList, productType, dateRange) {
  let filtered = mediaList;
  if (productType) {
    filtered = filtered.filter((m) => {
      const pt = m.product_type || (isReel(m) ? "REELS" : "FEED");
      return pt === productType;
    });
  }
  if (dateRange?.from && dateRange?.to) {
    const fromTs = new Date(dateRange.from + "T00:00:00Z").getTime();
    const toTs = new Date(dateRange.to + "T23:59:59Z").getTime();
    filtered = filtered.filter((m) => {
      if (!m.timestamp) return true;
      const t = new Date(m.timestamp).getTime();
      return t >= fromTs && t <= toTs;
    });
  }
  return filtered;
}

/**
 * Build byContentType aggregates from media results.
 * @param {Array} media
 * @returns {{ all: object, posts: object, stories: object, reels: object }}
 */
function buildByContentTypeAggregates(media) {
  const types = [
    { key: "all", productType: null },
    { key: "posts", productType: "FEED" },
    { key: "stories", productType: "STORY" },
    { key: "reels", productType: "REELS" },
  ];

  const result = {};
  for (const { key, productType } of types) {
    const items = productType
      ? media.filter((m) => (m.product_type || (isReel(m) ? "REELS" : "FEED")) === productType)
      : media;

    const views = items.reduce((s, m) => s + (Number(m.views) || Number(m.video_views) || 0), 0);
    const reach = items.reduce((s, m) => s + (Number(m.reach) || 0), 0);
    const total_interactions = items.reduce((s, m) => s + (Number(m.total_interactions) || 0), 0);

    const reelsWithHookRate = items.filter(
      (m) => m.hook_rate != null && !Number.isNaN(m.hook_rate) && (m.product_type === "REELS" || isReel(m))
    );
    const totalPlaysForReels = reelsWithHookRate.reduce(
      (s, m) => s + (Number(m.plays) || 0),
      0
    );
    const totalViewsForReels = reelsWithHookRate.reduce(
      (s, m) => s + (Number(m.views) || Number(m.video_views) || 0),
      0
    );
    const avgHookRate =
      totalPlaysForReels > 0
        ? Math.min(100, Math.round((totalViewsForReels / totalPlaysForReels) * 10000) / 100)
        : reelsWithHookRate.length > 0
          ? Math.round((reelsWithHookRate.map((m) => m.hook_rate).reduce((a, b) => a + b, 0) / reelsWithHookRate.length) * 100) / 100
          : null;
    const hookRates = reelsWithHookRate.map((m) => m.hook_rate);
    const median = (arr) => {
      if (!arr.length) return 0;
      const s = [...arr].sort((a, b) => a - b);
      const m = Math.floor(s.length / 2);
      return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
    };
    const medianHookRate = median(hookRates);
    const contentWinRate =
      hookRates.length > 0
        ? Math.round((hookRates.filter((r) => r >= medianHookRate).length / hookRates.length) * 100)
        : 0;

    result[key] = {
      views,
      reach,
      total_interactions,
      count: items.length,
      hook_rate: avgHookRate,
      content_win_rate: contentWinRate,
    };
  }
  return result;
}

/** Default max media items per account. Can be overridden per-call via opts.limit. */
const MEDIA_INSIGHTS_LIMIT = 100;

/**
 * Take up to maxItems for per-media insights, round-robin across calendar months (YYYY-MM).
 * Prevents "newest 50 only" from dropping last month's reels when the date range spans two months.
 */
function takeDiverseByMonthForInsights(filtered, maxItems) {
  if (!filtered || filtered.length <= maxItems) return filtered;
  const sorted = [...filtered].sort((a, b) => {
    const ta = a.timestamp ? new Date(a.timestamp).getTime() : 0;
    const tb = b.timestamp ? new Date(b.timestamp).getTime() : 0;
    return tb - ta;
  });
  const byMonth = new Map();
  for (const m of sorted) {
    const k = m.timestamp ? String(m.timestamp).slice(0, 7) : "_";
    if (!byMonth.has(k)) byMonth.set(k, []);
    byMonth.get(k).push(m);
  }
  const monthKeys = [...byMonth.keys()].sort((a, b) => b.localeCompare(a));
  const out = [];
  let round = 0;
  while (out.length < maxItems) {
    let added = false;
    for (const k of monthKeys) {
      const bucket = byMonth.get(k);
      if (bucket.length > round) {
        out.push(bucket[round]);
        added = true;
        if (out.length >= maxItems) break;
      }
    }
    if (!added) break;
    round += 1;
  }
  return out;
}

/** Max stories to fetch when using the dedicated /stories endpoint (limits per-account API calls). */
const STORY_FETCH_LIMIT = 25;

/**
 * Fetch story IDs from the dedicated stories edge.
 * GET /{ig-user-id}/stories — returns only IDs; stories are available ~24h after posting.
 * @param {string} igAccountId - IG Business Account ID
 * @param {string} accessToken - Page or system access token
 * @returns {Promise<Array<{ id: string }>>}
 */
async function fetchStoryIds(igAccountId, accessToken) {
  const url = `https://graph.facebook.com/${META_API_VERSION}/${igAccountId}/stories`;
  const data = await igRateLimiter.schedule(() =>
    graphApiGet(url, { access_token: accessToken })
  );
  if (!data || !Array.isArray(data.data)) return [];
  return (data.data || []).map((item) => ({ id: item.id }));
}

/**
 * Fetch a single media object by ID (for story details: thumbnail, timestamp, etc.).
 * @param {string} mediaId - IG Media ID
 * @param {string} accessToken
 * @returns {Promise<object|null>} Normalized media object or null
 */
async function fetchMediaById(mediaId, accessToken) {
  const fields = "id,media_type,product_type,video_duration,permalink,timestamp,caption,thumbnail_url,media_url";
  const url = `https://graph.facebook.com/${META_API_VERSION}/${mediaId}`;
  const item = await igRateLimiter.schedule(() =>
    graphApiGet(url, { fields, access_token: accessToken })
  );
  if (!item || !item.id) return null;
  return {
    id: item.id,
    media_type: item.media_type || null,
    product_type: "STORY",
    video_duration: item.video_duration != null ? Number(item.video_duration) : null,
    permalink: item.permalink || null,
    timestamp: item.timestamp || null,
    caption: (item.caption && typeof item.caption === "string") ? item.caption : null,
    thumbnail_url: item.thumbnail_url || null,
    media_url: item.media_url || null,
  };
}

/**
 * Fetch story list using the dedicated /stories endpoint, then resolve each to full media shape.
 * Use when contentType is 'stories' to maximize stories returned (API exposes them ~24h).
 * @param {string} igAccountId - IG Business Account ID
 * @param {string} accessToken - Page or system access token
 * @returns {Promise<Array>} Array of media objects (same shape as fetchMediaList items) with product_type STORY
 */
async function fetchStoryList(igAccountId, accessToken) {
  const ids = await fetchStoryIds(igAccountId, accessToken);
  if (ids.length === 0) return [];
  const limited = ids.slice(0, STORY_FETCH_LIMIT);
  const list = await Promise.all(
    limited.map(({ id }) => fetchMediaById(id, accessToken))
  );
  return list.filter(Boolean);
}

/**
 * Fetch media insights for one IG account: media list then conditional insights per media (parallel, rate-limited).
 * Limited to most recent MEDIA_INSIGHTS_LIMIT items to keep response time acceptable.
 *
 * @param {string} igAccountId
 * @param {string} accessToken
 * @param {{ contentType?: string, from?: string, to?: string }} opts
 * @returns {Promise<Array>}
 */
async function fetchAccountMediaInsights(igAccountId, accessToken, opts = {}) {
  const productType = contentTypeToProductType(opts.contentType);
  let filtered = [];

  // For stories, use the dedicated /stories endpoint first to get all available stories (~24h window).
  if (opts.contentType === "stories") {
    const storyList = await fetchStoryList(igAccountId, accessToken);
    if (storyList.length > 0) {
      filtered = [...storyList].sort((a, b) => {
        const ta = a.timestamp ? new Date(a.timestamp).getTime() : 0;
        const tb = b.timestamp ? new Date(b.timestamp).getTime() : 0;
        return tb - ta;
      });
    }
  }

  if (filtered.length === 0) {
    const mediaList = await fetchMediaList(igAccountId, accessToken);
    if (mediaList.length === 0) return [];
    filtered = filterMediaByContentTypeAndDate(mediaList, productType, {
      from: opts.from,
      to: opts.to,
    });
    // When date filter returns empty but we have a range, show latest content (no date filter) so Top Content by Views is not blank.
    if (filtered.length === 0 && opts.from && opts.to) {
      filtered = filterMediaByContentTypeAndDate(mediaList, productType, {});
    }
  }

  if (filtered.length === 0) return [];

  const effectiveLimit = (opts.limit && Number(opts.limit) > 0) ? Number(opts.limit) : MEDIA_INSIGHTS_LIMIT;

  // Sort by timestamp descending (most recent first) and cap to limit
  filtered = [...filtered].sort((a, b) => {
    const ta = a.timestamp ? new Date(a.timestamp).getTime() : 0;
    const tb = b.timestamp ? new Date(b.timestamp).getTime() : 0;
    return tb - ta;
  });
  filtered = takeDiverseByMonthForInsights(filtered, effectiveLimit);

  const results = await Promise.all(filtered.map((media) => fetchMediaInsights(media, accessToken)));
  return results;
}

/**
 * Top-level: fetch Instagram media insights (with Hook Rate & Hold Rate for Reels) for multiple accounts.
 * Resolves IG account IDs and token using the same pattern as instagramInsightsService.
 *
 * @param {object} opts
 * @param {string[]} [opts.accountIds] - Direct IG Business Account IDs
 * @param {string[]} [opts.pageIds] - Resolve IG IDs from these Page IDs
 * @param {(pageId: string) => Promise<string>} [opts.getPageToken] - Page access token getter
 * @param {string} [opts.from] - YYYY-MM-DD (optional; used with to)
 * @param {string} [opts.to] - YYYY-MM-DD (optional)
 * @param {string} [opts.period] - 'last_7_days' | 'last_30_days' (used if from/to not set)
 * @returns {Promise<{ media: array, error?: string, warnings?: string[] }>}
 */
async function fetchInstagramMediaInsights(opts = {}) {
  const systemToken = getSystemToken();
  let accountIds = opts.accountIds && opts.accountIds.length > 0 ? [...opts.accountIds] : [];
  let accessToken = systemToken;

  if (accountIds.length === 0 && opts.pageIds && opts.pageIds.length > 0) {
    if (typeof opts.getPageToken === "function") {
      const edgeResult = await resolveIgAccountsViaInstagramAccountsEdge(
        opts.pageIds,
        opts.getPageToken
      );
      accountIds = edgeResult.accountIds;
      if (edgeResult.pageToken) accessToken = edgeResult.pageToken;
    }
    if (accountIds.length === 0) {
      accountIds = await resolveIgAccountsFromPages(opts.pageIds, systemToken);
    }
  }

  if (opts.pageIds && opts.pageIds.length > 0 && typeof opts.getPageToken === "function" && accessToken === systemToken) {
    for (const pageId of opts.pageIds) {
      const pageToken = await opts.getPageToken(pageId);
      if (pageToken) {
        accessToken = pageToken;
        break;
      }
    }
  }

  if (accountIds.length === 0) {
    return {
      media: [],
      error: "No Instagram Business Account IDs to fetch. Provide accountIds or pageIds.",
    };
  }

  const warnings = [];
  let allMedia = [];

  // Process all accounts in parallel — reduces wall time from N×T to max(T) per account.
  const accountResults = await Promise.allSettled(
    accountIds.map((accountId) =>
      fetchAccountMediaInsights(accountId, accessToken, {
        contentType: opts.contentType,
        from: opts.from,
        to: opts.to,
        limit: opts.limit,
      })
    )
  );

  for (let i = 0; i < accountIds.length; i++) {
    const result = accountResults[i];
    const accountId = accountIds[i];
    if (result.status === "rejected") {
      warnings.push(`Account ${accountId}: ${result.reason?.message || result.reason}`);
      continue;
    }
    const list = result.value || [];
    allMedia.push(...list);
    if (opts.contentType === "stories" && list.length > 0) {
      try {
        await storySnapshots.saveStories(accountId, list);
      } catch (_) {
        // Table may not exist; don't fail the request
      }
    }
  }

  if (opts.contentType === "stories" && accountIds.length > 0) {
    try {
      const stored = await storySnapshots.getStoriesByAccountIds(accountIds, 100);
      const byId = new Map();
      const storyKey = (m) => {
        if (!m) return "";
        const k = String(m.media_id || m.id || "").trim();
        return k;
      };
      const addStory = (m) => {
        const k = storyKey(m);
        if (!k) return;
        const normalized = {
          ...m,
          media_id: m.media_id || m.id,
          id: m.id || m.media_id,
        };
        if (!byId.has(k)) byId.set(k, normalized);
      };
      for (const m of allMedia) addStory(m);
      for (const m of stored) addStory(m);
      allMedia = [...byId.values()]
        .sort((a, b) => (b.views || b.video_views || 0) - (a.views || a.video_views || 0))
        .slice(0, MEDIA_INSIGHTS_LIMIT);
    } catch (_) {
      // Table may not exist; keep live-only
    }
  }

  // For stories only: filter by date range when from/to provided. If that would leave 0 items, try last 7d / 30d, then show all merged stories (snapshots + live).
  let storiesFallbackUsed = false;
  if (opts.contentType === "stories" && opts.from && opts.to && allMedia.length > 0) {
    const mergedBeforeDateFilter = [...allMedia];
    const fromTs = new Date(opts.from + "T00:00:00Z").getTime();
    const toTs = new Date(opts.to + "T23:59:59Z").getTime();
    const filteredByDate = allMedia.filter((m) => {
      if (!m.timestamp) return true;
      const t = new Date(m.timestamp).getTime();
      return t >= fromTs && t <= toTs;
    });
    if (filteredByDate.length > 0) {
      allMedia = filteredByDate;
    } else {
      const fallbackEnd = new Date(opts.to + "T23:59:59Z").getTime();
      const fallbackStart7 = new Date(opts.to + "T00:00:00Z");
      fallbackStart7.setUTCDate(fallbackStart7.getUTCDate() - 7);
      const fallbackStart7Ts = fallbackStart7.getTime();
      const fallbackFiltered = mergedBeforeDateFilter.filter((m) => {
        if (!m.timestamp) return true;
        const t = new Date(m.timestamp).getTime();
        return t >= fallbackStart7Ts && t <= fallbackEnd;
      });
      if (fallbackFiltered.length > 0) {
        allMedia = fallbackFiltered;
        storiesFallbackUsed = true;
      } else {
        const fallbackStart30 = new Date(opts.to + "T00:00:00Z");
        fallbackStart30.setUTCDate(fallbackStart30.getUTCDate() - 30);
        const fallbackStart30Ts = fallbackStart30.getTime();
        const fallback30 = mergedBeforeDateFilter.filter((m) => {
          if (!m.timestamp) return true;
          const t = new Date(m.timestamp).getTime();
          return t >= fallbackStart30Ts && t <= fallbackEnd;
        });
        if (fallback30.length > 0) {
          allMedia = fallback30;
          storiesFallbackUsed = true;
        } else if (mergedBeforeDateFilter.length > 0) {
          allMedia = mergedBeforeDateFilter;
          storiesFallbackUsed = true;
        }
      }
    }
  }

  const byContentType = buildByContentTypeAggregates(allMedia);

  // Ensure every media item has `id` for client (Stories use media_id from insights; Posts/Reels often have id from media list)
  const mediaWithId = allMedia.map((m) => ({ ...m, id: m.id || m.media_id }));

  return {
    media: mediaWithId,
    byContentType,
    ...(opts.contentType === "stories" && storiesFallbackUsed && { storiesFallbackUsed: true }),
    ...(warnings.length > 0 && { warnings }),
  };
}

module.exports = {
  fetchInstagramMediaInsights,
  fetchMediaList,
  fetchMediaInsights,
  fetchAccountMediaInsights,
  isReel,
  calcHookRate,
  calcHoldRate,
  graphApiGet,
};
