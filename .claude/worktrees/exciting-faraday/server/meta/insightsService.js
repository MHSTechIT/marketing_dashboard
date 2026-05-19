/**
 * Meta Insights live-fetch service: one API call per request, no loop over IDs.
 * Select All → call Meta with level + time_range only (aggregated). Explicit IDs → use filtering IN.
 * All calls go through a rate limiter (Bottleneck-style: max 2 concurrent, ~15/min) and an in-memory cache by (time_range, account, level, filters).
 *
 * ONE CALL, NO LOOP: We never iterate over campaign_ids or ad_ids to fire one Meta request per ID.
 * One request per (account, time_range, filter set). Filtering uses operator IN for selected IDs.
 *
 * META API REQUEST EXAMPLES:
 *
 * 1) Aggregated (Select All) — no campaign.id / ad.id in filtering, status only:
 *    GET https://graph.facebook.com/v21.0/act_{ad_account_id}/insights
 *      ?access_token=...
 *      &level=ad
 *      &time_increment=1
 *      &time_range={"since":"2024-01-01","until":"2024-01-07"}
 *      &fields=ad_id,ad_name,campaign_id,campaign_name,impressions,clicks,spend,actions,action_values,date_start,date_stop
 *      &limit=1000
 *      &filtering=[{"field":"campaign.effective_status","operator":"IN","value":["ACTIVE","PAUSED",...]},{"field":"ad.effective_status","operator":"IN","value":[...]}]
 *
 * 2) Filtered (explicit IDs) — use IN:
 *    Same URL, add to filtering:
 *      {"field":"campaign.id","operator":"IN","value":["123","456"]}
 *      {"field":"ad.id","operator":"IN","value":["a1","a2"]}
 *    Still one request with both filters.
 */

const axios = require('axios');

const META_API_VERSION = process.env.META_API_VERSION || 'v21.0';

// Simple rate limiter: max 2 concurrent, ~15 requests per minute (minTime 4s). No external deps.
const RATE_QUEUE = [];
let rateRunning = 0;
let rateLastStart = 0;
const RATE_MAX_CONCURRENT = 2;
const RATE_MIN_MS = 4000;

function scheduleRateLimited(fn) {
  return new Promise((resolve, reject) => {
    RATE_QUEUE.push({ fn, resolve, reject });
    dequeueRate();
  });
}
function dequeueRate() {
  if (rateRunning >= RATE_MAX_CONCURRENT || RATE_QUEUE.length === 0) return;
  const now = Date.now();
  if (now - rateLastStart < RATE_MIN_MS && rateRunning > 0) {
    setTimeout(dequeueRate, RATE_MIN_MS - (now - rateLastStart));
    return;
  }
  const { fn, resolve, reject } = RATE_QUEUE.shift();
  rateRunning++;
  rateLastStart = Date.now();
  Promise.resolve(fn()).then(resolve, reject).finally(() => {
    rateRunning--;
    dequeueRate();
  });
}

// In-memory cache: key = (from, to, adAccountId, campaignIdKey, adIdKey), value = { data, expires }
const CACHE_TTL_MS = 3 * 60 * 1000; // 3 minutes
const cache = new Map();

function cacheKey(from, to, adAccountId, campaignIdForKey, adIdForKey) {
  return `${from}|${to}|${adAccountId}|${campaignIdForKey || '*'}|${adIdForKey || '*'}`;
}

// No effective_status filter — matches Meta Ads Manager which shows all historical spend
// regardless of the ad/campaign's current status (deleted, paused, campaign_paused, etc.)
const STATUS_FILTER = []; // empty = no filter

/**
 * Get numeric value from a row's actions or action_values by action_type (for Hold Rate).
 */
function getActionValue(row, actionType) {
  if (!row) return 0;
  for (const arr of [row.actions, row.action_values]) {
    if (!Array.isArray(arr)) continue;
    const entry = arr.find((a) => a && a.action_type === actionType);
    if (entry != null && entry.value != null) return Number(entry.value) || 0;
  }
  return 0;
}

/** Meta can expose video completion as top-level arrays e.g. row.video_p100_watched_actions = [{ value: "x" }]. */
function getTopLevelActionValue(row, key) {
  if (!row || !key) return 0;
  const arr = row[key];
  if (!Array.isArray(arr) || arr.length === 0) return 0;
  const v = arr[0] && (arr[0].value != null ? arr[0].value : arr[0]);
  return Number(v) || 0;
}

/** Get value for one action type (e.g. video_p50_watched_actions) from row/aggs/values. */
function getActionCountForKey(row, aggs, values, key) {
  const fromRow = getTopLevelActionValue(row, key) || getActionValue(row, key);
  if (fromRow > 0) return fromRow;
  const fromAggs = (aggs && aggs[key]) ? Number(aggs[key]) || 0 : 0;
  if (fromAggs > 0) return fromAggs;
  const fromValues = (values && values[key]) ? Number(values[key]) || 0 : 0;
  return fromValues > 0 ? fromValues : 0;
}

/** Get video "full views" (100% or best available completion) from row. Tries p100, p95, p75, p50, p25. */
function getVideoCompletionCount(row, aggs, values) {
  const tryKeys = [
    'video_p100_watched_actions', 'video_p100_watched',
    'video_p95_watched_actions', 'video_p95_watched',
    'video_p75_watched_actions', 'video_p75_watched',
    'video_p50_watched_actions', 'video_p50_watched',
    'video_p25_watched_actions', 'video_p25_watched',
  ];
  for (const key of tryKeys) {
    const v = getActionCountForKey(row, aggs, values, key);
    if (v > 0) return v;
  }
  return 0;
}

/**
 * Build a map of action_type -> number from Meta actions/action_values array.
 */
function transformActions(actions) {
  if (!Array.isArray(actions)) return {};
  const map = {};
  for (const a of actions) {
    if (a && a.action_type != null) map[a.action_type] = Number(a.value) || 0;
  }
  return map;
}

/**
 * Enrich one Meta insight row with videoPlays, videoP100Watched, hold_rate (server-side Hold Rate).
 * Uses same logic as client: video_play_actions/video_view for plays, video_p100_watched for fullViews,
 * then fallbacks: ThruPlay/videoViews, ThruPlay/video3sViews, else 0.
 */
function enrichInsightsRow(row) {
  const aggs = transformActions(row.actions || []);
  const values = transformActions(row.action_values || []);
  const videoViews = aggs.video_view || aggs.video_views || 0;
  // Meta often returns 3s watches as top-level video_3_sec_watched_actions; not always in actions[].
  const video3sViews =
    getActionCountForKey(row, aggs, values, 'video_3_sec_watched_actions') ||
    aggs.video_view_3s ||
    aggs.video_views_3s ||
    aggs.video_view_3s_autoplayed ||
    aggs.video_views_3s_autoplayed ||
    aggs.video_3_sec_watched_actions ||
    0;
  const videoThruPlays = aggs.video_thruplay_watched_actions || aggs.video_thruplay || aggs.video_views_thruplay || 0;

  const plays =
    getTopLevelActionValue(row, 'video_play_actions') ||
    getTopLevelActionValue(row, 'video_play') ||
    getTopLevelActionValue(row, 'video_view') ||
    getActionValue(row, 'video_play_actions') ||
    getActionValue(row, 'video_play') ||
    getActionValue(row, 'video_view') ||
    0;
  const fullViews = getVideoCompletionCount(row, aggs, values);
  const p50 = getActionCountForKey(row, aggs, values, 'video_p50_watched_actions') || getActionCountForKey(row, aggs, values, 'video_p50_watched');
  const p75 = getActionCountForKey(row, aggs, values, 'video_p75_watched_actions') || getActionCountForKey(row, aggs, values, 'video_p75_watched');
  // Hold Rate = (p50 or p75) / 3-sec views × 100 — works for ALL campaign types; ThruPlay only for Video Views campaigns
  let hold_rate = 0;
  const holdNumerator = p50 > 0 ? p50 : (p75 > 0 ? p75 : (videoThruPlays > 0 ? videoThruPlays : fullViews));
  if (video3sViews > 0 && holdNumerator > 0) {
    hold_rate = Math.round((holdNumerator / video3sViews) * 10000) / 100;
  } else if (plays > 0 && fullViews > 0) {
    hold_rate = Math.round((fullViews / plays) * 10000) / 100;
  } else if (plays > 0 && videoThruPlays > 0) {
    hold_rate = Math.round((videoThruPlays / plays) * 10000) / 100;
  } else if (videoViews > 0 && videoThruPlays > 0) {
    hold_rate = Math.round((videoThruPlays / videoViews) * 10000) / 100;
  } else if (video3sViews > 0 && videoThruPlays >= 0) {
    hold_rate = Math.round((videoThruPlays / video3sViews) * 10000) / 100;
  } else if (video3sViews > 0 && videoViews > 0) {
    hold_rate = Math.min(100, Math.round((videoViews / video3sViews) * 10000) / 100);
  } else if (video3sViews > 0 && plays > 0) {
    hold_rate = Math.min(100, Math.round((plays / video3sViews) * 10000) / 100);
  }

  return {
    ...row,
    videoPlays: plays,
    videoP100Watched: fullViews,
    video3sViews,
    hold_rate,
  };
}

/**
 * Build filtering array for Meta Insights API.
 * Aggregated (Select All): status only. Filtered: add campaign.id IN and/or ad.id IN. One request, no loop.
 */
function buildFiltering(isAllCampaigns, isAllAds, campaignIds, adIds) {
  const list = [...STATUS_FILTER];
  if (!isAllCampaigns && campaignIds && campaignIds.length > 0) {
    list.push({ field: 'campaign.id', operator: 'IN', value: campaignIds.map(String) });
  }
  if (!isAllAds && adIds && adIds.length > 0) {
    list.push({ field: 'ad.id', operator: 'IN', value: adIds.map(String) });
  }
  return list;
}

/**
 * Fetch insights from Meta API. One call per (account, request). Uses rate limiter and cache.
 * @param {object} opts - { accessToken, adAccountId, from, to, isAllCampaigns, isAllAds, campaignIds, adIds }
 * @returns {Promise<object[]>} - Raw Meta insight objects (ad-level)
 */
async function fetchInsightsFromMetaLive(opts) {
  const {
    accessToken,
    adAccountId,
    from,
    to,
    isAllCampaigns = true,
    isAllAds = true,
    campaignIds = [],
    adIds = [],
    skipCache = false,
  } = opts || {};

  const normId = (id) => (id && String(id).replace(/^act_/, '')) || '';
  const accId = normId(adAccountId);
  if (!accId || !accessToken || !from || !to) {
    throw new Error('insightsService: accessToken, adAccountId, from, to are required');
  }

  const campaignIdForKey = isAllCampaigns ? '' : campaignIds.join(',');
  const adIdForKey = isAllAds ? '' : adIds.join(',');
  const key = cacheKey(from, to, accId, campaignIdForKey, adIdForKey);
  const now = Date.now();
  if (!skipCache) {
    const hit = cache.get(key);
    if (hit && hit.expires > now) {
      return hit.data;
    }
  }

  const run = async () => {
    const url = `https://graph.facebook.com/${META_API_VERSION}/act_${accId}/insights`;
    const timeRange = JSON.stringify({ since: from, until: to });
    const filtering = buildFiltering(isAllCampaigns, isAllAds, campaignIds, adIds);

    const params = {
      access_token: accessToken,
      level: 'ad',
      time_increment: 1,
      time_range: timeRange,
      fields: 'ad_id,ad_name,campaign_id,campaign_name,impressions,clicks,spend,ctr,cpc,actions,action_values,date_start,date_stop,video_play_actions,video_p25_watched_actions,video_p50_watched_actions,video_p75_watched_actions,video_p100_watched_actions',
      limit: 1000,
      filtering: JSON.stringify(filtering),
    };

    let allRows = [];
    let currentParams = { ...params };
    let pageCount = 0;
    const maxPages = 20;

    do {
      const res = await axios.get(url, { params: currentParams, timeout: 60000 });
      const data = res.data;
      const chunk = Array.isArray(data.data) ? data.data : (Array.isArray(data) ? data : []);
      allRows = allRows.concat(chunk);

      const nextUrl = data.paging && data.paging.next;
      if (nextUrl && pageCount < maxPages) {
        const u = new URL(data.paging.next);
        currentParams = { ...params, after: u.searchParams.get('after') };
        pageCount++;
      } else {
        break;
      }
    } while (true);

    // Debug: log first row's actionTypes so we can verify Meta's keys for Hook/Hold rate
    let actionTypes = [];
    if (allRows.length > 0) {
      const first = allRows[0];
      if (first && (first.actions || first.action_values)) {
        actionTypes = Array.isArray(first.actions) ? first.actions.map((a) => a.action_type) : [];
        const actionValueTypes = Array.isArray(first.action_values) ? first.action_values.map((a) => a.action_type) : [];
        console.log('[InsightsService] Sample row actions (first row):', {
          ad_id: first.ad_id,
          actionTypes,
          actionValueTypes,
          actionsSample: Array.isArray(first.actions) ? first.actions.slice(0, 15) : first.actions,
          hasActionValues: Array.isArray(first.action_values) && first.action_values.length > 0,
        });
      }
    }

    // Enrich each row with videoPlays, videoP100Watched, hold_rate (server-side Hold Rate)
    const enrichedRows = allRows.map((r) => enrichInsightsRow(r));

    cache.set(key, { data: enrichedRows, expires: now + CACHE_TTL_MS });
    return enrichedRows;
  };

  return scheduleRateLimited(run);
}

module.exports = {
  fetchInsightsFromMetaLive,
  cacheKey,
  buildFiltering,
  getActionValue,
  transformActions,
  enrichInsightsRow,
};
