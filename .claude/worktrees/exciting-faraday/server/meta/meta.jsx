// meta/meta.jsx
const express = require("express");
const axios = require("axios");
const fs = require('fs');
const path = require('path');
// Ensure .env is loaded with explicit path
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const router = express.Router();
const { authMiddleware, optionalAuthMiddleware } = require("../auth");
const { saveLeads, getLeadsByCampaignAndAd } = require("../repositories/leadsRepository");
const { getInsights, upsertInsights } = require("../repositories/insightsRepository");
const { fetchLeadsFromMeta } = require("../jobs/leadsSync");
const { fetchAllAdAccountIds, runInsightsSyncForRange } = require("../jobs/insightsSync");
const { fetchInsightsFromMetaLive, enrichInsightsRow } = require("./insightsService");
const { fetchVideoPerformance } = require("./videoPerformanceService");
const { fetchDemographicInsightsSplit } = require("./demographicInsightsService");
const adsCache = require("./adsCache");
const { fetchInstagramInsights, fetchInstagramAudienceDemographics, fetchReachByFollowType, fetchOnlineFollowers, resolveIgAccountsFromPages } = require("./instagramInsightsService");
const { processOnlineFollowersResponse, buildBestTimesFromMediaViews } = require("./onlineFollowersProcessor");
const { fetchInstagramMediaInsights } = require("./instagramMediaInsightsService");
const insightsCache = require("../cache/insightsCache");
const { runAnalytics } = require("./instagramAnalyticsEngine");
// Meta API best-practice layer: DB cache, rate limit, one request per resource
const adAccountsService = require("../services/meta/adAccountsService");
const campaignsServiceMeta = require("../services/meta/campaignsService");
const adsServiceMeta = require("../services/meta/adsService");
const META_API_VERSION = "v21.0";
const { parseFieldData, findFirstValueByKeyPattern } = require("../constants/leadFieldLabels");
// Page Insights requires v22+ for page_follows, page_media_view (v21.0 returns invalid metric)
const META_PAGE_INSIGHTS_API_VERSION = process.env.META_PAGE_INSIGHTS_API_VERSION || "v24.0";

// In-memory cache for campaigns (ads use adsCache with Redis/in-memory, TTL 24h+)
let campaignsCache = {
  data: [],
  lastFetched: null,
  ttl: 5 * 60 * 1000 // 5 minutes
};

// Rate limiter for /api/meta/ads: max 2 concurrent, ~2s between starts to avoid "too many API calls"
const ADS_QUEUE = [];
let adsRateRunning = 0;
let adsRateLastStart = 0;
function scheduleAdsRateLimited(fn) {
  return new Promise((resolve, reject) => {
    ADS_QUEUE.push({ fn, resolve, reject });
    dequeueAdsRate();
  });
}
function dequeueAdsRate() {
  if (adsRateRunning >= 2 || ADS_QUEUE.length === 0) return;
  const now = Date.now();
  if (now - adsRateLastStart < 2000 && adsRateRunning > 0) {
    setTimeout(dequeueAdsRate, 2000 - (now - adsRateLastStart));
    return;
  }
  const { fn, resolve, reject } = ADS_QUEUE.shift();
  adsRateRunning++;
  adsRateLastStart = Date.now();
  Promise.resolve(fn()).then(resolve, reject).finally(() => {
    adsRateRunning--;
    dequeueAdsRate();
  });
}

function isMetaRateLimitError(err) {
  const c = err?.response?.data?.error?.code;
  const sub = err?.response?.data?.error?.error_subcode;
  const msg = (err?.response?.data?.error?.message || "").toLowerCase();
  return c === 4 || c === 17 || c === 80004 || sub === 2446079 || msg.includes("too many") || msg.includes("rate limit") || msg.includes("api call");
}

// In-memory cache for forms by ad
let formsCache = {
  data: {},
  lastFetched: {},
  ttl: 60 * 1000 // 60 seconds
};

// In-memory cache for pre-loaded leads data (by pageId + date range)
let preloadLeadsCache = {
  data: {},
  lastFetched: {},
  ttl: 5 * 60 * 1000 // 5 minutes
};

// Helper to normalize ad account ID (remove act_ prefix if present)
function normalizeAdAccountId(adAccountId) {
  if (!adAccountId) return adAccountId;
  // Remove act_ prefix if it exists
  return adAccountId.startsWith('act_') ? adAccountId.substring(4) : adAccountId;
}

// Helper to validate and return env credentials
function getCredentials() {
  const accessToken = (process.env.META_ACCESS_TOKEN || '').trim();
  const adAccountId = (process.env.META_AD_ACCOUNT_ID || '').trim();

  if (!accessToken || !adAccountId) {
    const missing = [];
    if (!accessToken) missing.push('META_ACCESS_TOKEN');
    if (!adAccountId) missing.push('META_AD_ACCOUNT_ID');
    throw new Error(`Meta credentials missing. Please configure ${missing.join(' and ')} in server/.env file.`);
  }
  return {
    accessToken,
    adAccountId: normalizeAdAccountId(adAccountId),
  };
}

// Helper to get system token for leads API (separate from user token)
function getSystemCredentials() {
  const systemToken = (process.env.META_SYSTEM_ACCESS_TOKEN || process.env.META_ACCESS_TOKEN || '').trim();
  const adAccountId = (process.env.META_AD_ACCOUNT_ID || '').trim();

  if (!systemToken || !adAccountId) {
    // Fallback to regular token if system token not configured
    const regularToken = (process.env.META_ACCESS_TOKEN || '').trim();
    if (!regularToken || !adAccountId) {
      const missing = [];
      if (!regularToken) missing.push('META_ACCESS_TOKEN');
      if (!adAccountId) missing.push('META_AD_ACCOUNT_ID');
      throw new Error(`Meta credentials missing. Please configure ${missing.join(' and ')} in server/.env file.`);
    }
  
    return {
      accessToken: regularToken,
      adAccountId: normalizeAdAccountId(adAccountId),
    };
  }

  return {
    accessToken: systemToken,
    adAccountId: normalizeAdAccountId(adAccountId),
  };
}

// Helper to get system token only (for pages/forms APIs that don't need adAccountId)
function getSystemToken() {
  const systemToken = (process.env.META_SYSTEM_ACCESS_TOKEN || process.env.META_ACCESS_TOKEN || '').trim();
  if (!systemToken) {
    throw new Error("Meta System Access Token missing. Please configure META_SYSTEM_ACCESS_TOKEN or META_ACCESS_TOKEN in server/.env file.");
  }
  return systemToken;
}

// ---------------------------------------------------------------------
// PAGE ACCESS TOKEN HELPER FUNCTIONS
// ---------------------------------------------------------------------

// In-memory cache for Page Access Tokens
// Meta's leadgen_forms and /leads APIs require a Page Access Token, not a System User Token
// We fetch Page Access Tokens using the System User Token and cache them to avoid repeated API calls
const pageTokenCache = {
  tokens: {}, // pageId -> { token: string, expiresAt: number }
  ttl: 60 * 60 * 1000 // 1 hour TTL
};

/**
 * Get Page Access Token for a specific page
 * 
 * Meta's leadgen_forms and /leads APIs require a Page Access Token, not a System User Token.
 * This function fetches the Page Access Token from Meta API using the System User Token
 * and caches it in memory to avoid repeated API calls.
 * 
 * @param {string} pageId - The Meta page ID
 * @returns {Promise<string>} - The page access token
 */
async function getPageAccessToken(pageId) {
  if (!pageId) {
    throw new Error("Page ID is required to fetch Page Access Token");
  }

  // Check cache first
  const cached = pageTokenCache.tokens[pageId];
  const now = Date.now();
  if (cached && cached.expiresAt > now) {
    return cached.token;
  }

  // Fetch from Meta API using System User Token
  try {
    const systemToken = getSystemToken();
    const response = await axios.get(
      `https://graph.facebook.com/${META_API_VERSION}/${pageId}`,
      {
        params: {
          fields: 'access_token',
          access_token: systemToken
        },
        timeout: 30000
      }
    );

    if (!response.data || !response.data.access_token) {
      throw new Error(`Page access token not found in API response for page ${pageId}`);
    }

    const pageToken = response.data.access_token;

    // Cache the token
    pageTokenCache.tokens[pageId] = {
      token: pageToken,
      expiresAt: now + pageTokenCache.ttl
    };

    return pageToken;
  } catch (error) {
    const errorData = error.response?.data?.error;
    const errorCode = errorData?.code;
    const errorMsg = errorData?.message || error.message;

    // Clear cache on error
    delete pageTokenCache.tokens[pageId];

    // Fallback 1: try GET pageId with META_ACCESS_TOKEN if different from system token (e.g. user token has page access)
    const systemToken = getSystemToken();
    const altToken = (process.env.META_ACCESS_TOKEN || '').trim();
    if (altToken && altToken !== systemToken) {
      try {
        const altRes = await axios.get(
          `https://graph.facebook.com/${META_API_VERSION}/${pageId}`,
          { params: { fields: 'access_token', access_token: altToken }, timeout: 30000 }
        );
        if (altRes.data && altRes.data.access_token) {
          const pageToken = altRes.data.access_token;
          pageTokenCache.tokens[pageId] = { token: pageToken, expiresAt: Date.now() + pageTokenCache.ttl };
          return pageToken;
        }
      } catch (altErr) {
        // ignore, try next fallback
      }
    }

    // Fallback 2: refresh cache from me/accounts and businesses/owned_pages, then check cache again
    try {
      await loadPageTokensIntoCache();
      const cached = pageTokenCache.tokens[pageId];
      if (cached && cached.expiresAt > Date.now()) {
        return cached.token;
      }
    } catch (refreshErr) {
      // ignore
    }

    // Handle specific error codes
    if (errorCode === 190) {
      throw new Error(`Page Access Token expired/invalid for page ${pageId}: ${errorMsg}. Please check your System User Token.`);
    }
    if (errorCode === 200) {
      throw new Error(`Permission error fetching Page Access Token for page ${pageId}: ${errorMsg}. Ensure your System User Token has 'pages_show_list' permission.`);
    }
    if (errorCode === 10) {
      throw new Error(`Permission denied for page ${pageId}: ${errorMsg}. Check that your System User Token has access to this page.`);
    }

    throw new Error(`Failed to get page access token for page ${pageId}: ${errorMsg}`);
  }
}

/**
 * Get page access token without throwing. Use when the page may not be in the System User's scope
 * (e.g. different page IDs). Returns { token } on success, { token: null, error: string } on failure.
 */
async function getPageAccessTokenSafe(pageId) {
  if (!pageId) return { token: null, error: "Page ID is required" };
  try {
    const token = await getPageAccessToken(pageId);
    return { token };
  } catch (e) {
    const msg = e?.message || String(e);
    return { token: null, error: msg };
  }
}

// ---------------------------------------------------------------------
// HELPER FUNCTIONS FOR FORM DISCOVERY
// ---------------------------------------------------------------------

// Helper: Extract form_id from creative object_story_spec
function extractFormIdFromCreative(creative) {
  try {
    const spec = creative.object_story_spec;
    if (spec && spec.link_data && spec.link_data.call_to_action) {
      const cta = spec.link_data.call_to_action;
      if (cta.type === 'LEARN_MORE' && cta.value && cta.value.lead_gen_form_id) {
        return cta.value.lead_gen_form_id;
      }
      // Check for other CTA types that might have lead_gen_form_id
      if (cta.value && cta.value.lead_gen_form_id) {
        return cta.value.lead_gen_form_id;
      }
    }
    // Alternative: check video_data for video ads
    if (spec && spec.video_data && spec.video_data.call_to_action) {
      const cta = spec.video_data.call_to_action;
      if (cta.value && cta.value.lead_gen_form_id) {
        return cta.value.lead_gen_form_id;
      }
    }
    // Check page_post_engagement for page posts
    if (spec && spec.page_id) {
      // For page posts, we might need to check the post itself
      // This is a fallback - most lead ads use link_data or video_data
    }
  } catch (err) {
    console.warn('Error extracting form_id from creative:', err.message);
  }
  return null;
}

// Helper: Get lead_gen_form_id from ad creative
async function getFormsFromAds(adIds, accessToken) {
  const adFormMap = new Map(); // ad_id -> [form_ids]
  
  // Process ads in batches to avoid rate limits
  const batchSize = 10;
  for (let i = 0; i < adIds.length; i += batchSize) {
    const batch = adIds.slice(i, i + batchSize);
    const promises = batch.map(async (adId) => {
      try {
        const creativeUrl = `https://graph.facebook.com/${META_API_VERSION}/${adId}/adcreatives`;
        const response = await axios.get(creativeUrl, {
          params: {
            access_token: accessToken,
            fields: "object_story_spec,effective_object_story_id"
          }
        });
        
        const creatives = response.data.data || [];
        const formIds = [];
        for (const creative of creatives) {
          const formId = extractFormIdFromCreative(creative);
          if (formId) {
            formIds.push(formId);
          }
        }
        
        if (formIds.length > 0) {
          adFormMap.set(adId, formIds);
        }
      } catch (err) {
        console.warn(`Error fetching creative for ad ${adId}:`, err.message);
      }
    });
    
    await Promise.all(promises);
  }
  
  return adFormMap;
}

// Helper: Get forms from campaigns
async function getFormsFromCampaigns(campaignIds, adAccountId, accessToken) {
  try {
    // Normalize ad account ID
    let accountId = adAccountId;
    if (accountId && accountId.startsWith('act_')) {
      accountId = accountId.substring(4);
    }
    
    // Get all ads in the specified campaigns
    const adsUrl = `https://graph.facebook.com/${META_API_VERSION}/act_${accountId}/ads`;
    const filtering = [{
      field: "campaign.id",
      operator: "IN",
      value: Array.isArray(campaignIds) ? campaignIds : [campaignIds]
    }];
    
    const response = await axios.get(adsUrl, {
      params: {
        access_token: accessToken,
        fields: "id",
        filtering: JSON.stringify(filtering),
        limit: 1000
      }
    });
    
    const ads = response.data.data || [];
    const adIds = ads.map(ad => ad.id);
    
    if (adIds.length === 0) {
      return new Set();
    }
    
    // Get forms from all ads
    const adFormMap = await getFormsFromAds(adIds, accessToken);
    
    // Collect all unique form IDs
    const formIds = new Set();
    adFormMap.forEach((formIdArray) => {
      formIdArray.forEach(formId => formIds.add(formId));
    });
    
    return formIds;
  } catch (err) {
    console.error("Error getting forms from campaigns:", err.response?.data || err.message);
    return new Set();
  }
}

// Helper: Get forms from ad account
async function getFormsFromAdAccount(adAccountId, accessToken) {
  try {
    // Normalize ad account ID
    let accountId = adAccountId;
    if (accountId && accountId.startsWith('act_')) {
      accountId = accountId.substring(4);
    }
    
    // Get all campaigns
    const campaignsUrl = `https://graph.facebook.com/${META_API_VERSION}/act_${accountId}/campaigns`;
    const campaignsResponse = await axios.get(campaignsUrl, {
      params: {
        access_token: accessToken,
        fields: "id",
        limit: 1000
      }
    });
    
    const campaigns = campaignsResponse.data.data || [];
    const campaignIds = campaigns.map(c => c.id);
    
    if (campaignIds.length === 0) {
      return new Set();
    }
    
    // Get forms from all campaigns
    return await getFormsFromCampaigns(campaignIds, accountId, accessToken);
  } catch (err) {
    console.error("Error getting forms from ad account:", err.response?.data || err.message);
    return new Set();
  }
}

// ---------------------------------------------------------------------
// 1) CAMPAIGN LIST API — DB cache 24h+. GET /api/meta/campaigns?ad_account_id=
//    Uses /act_{id}/campaigns via campaignsService; UI reads from DB only.
// ---------------------------------------------------------------------
router.get("/campaigns", optionalAuthMiddleware, async (req, res) => {
  try {
    const credentials = getCredentials();
    const adAccountId = (req.query.ad_account_id || credentials.adAccountId || '').toString().replace(/^act_/, '');
    if (!adAccountId) {
      return res.status(400).json({ error: "ad_account_id required", details: "Set query param or META_AD_ACCOUNT_ID in server/.env" });
    }
    const forceRefresh = req.query.refresh === '1' || req.query.refresh === 'true';
    const data = await campaignsServiceMeta.list(adAccountId, { forceRefresh });
    res.json({ data: data || [], cached: !forceRefresh });
  } catch (err) {
    console.error("Meta API Campaigns Error:", err.response?.data || err.message);
    if (err.response?.data?.error?.code === 190) {
      return res.status(401).json({
        error: "Meta Access Token expired or invalid",
        details: err.response.data.error.message,
        isAuthError: true,
        instruction: "Please update META_ACCESS_TOKEN in server/.env"
      });
    }
    res.status(500).json({
      error: "Failed to fetch campaigns",
      details: err.response?.data || err.message,
    });
  }
});

// ---------------------------------------------------------------------
// 2) INSIGHTS API — reads from database (and optionally live Meta via insightsService).
//    GET /api/meta/insights
//    Query: from, to, ad_account_id, time_increment, is_all_campaigns, is_all_ads, campaign_id, ad_id.
//    Select All → is_all_campaigns=1 or is_all_ads=1 (or omit IDs); backend passes '' to getInsights.
//    Explicit selection → campaign_id / ad_id comma-separated. One call per account per request; no loop over IDs.
// ---------------------------------------------------------------------
router.get("/insights", optionalAuthMiddleware, async (req, res) => {
  try {
    let credentials;
    try {
      credentials = getCredentials();
    } catch (e) {
      return res.status(400).json({
        error: "Meta credentials required",
        details: e.message,
      });
    }
    const { campaign_id, ad_id, from, to, days, ad_account_id, is_all_campaigns, is_all_ads } = req.query;

    let adAccountIds;
    const rawAdAccount = (ad_account_id || '').toString().trim();
    if (rawAdAccount) {
      if (rawAdAccount.includes(',')) {
        adAccountIds = rawAdAccount.split(',').map((s) => s.trim().replace(/^act_/, '')).filter(Boolean);
      } else {
        adAccountIds = [String(rawAdAccount).replace(/^act_/, '')];
      }
    } else {
      // "All Ad Accounts" - fetch insights from all ad accounts
      let accounts = await adAccountsService.listFromDb();
      if (!accounts || accounts.length === 0) {
        try {
          await adAccountsService.fetchAndCache();
          accounts = await adAccountsService.listFromDb();
        } catch (e) {
          console.warn("Insights: fetchAndCache ad accounts failed:", e?.message);
        }
      }
      adAccountIds = (accounts || [])
        .map((a) => String(a.account_id || a.id || '').replace(/^act_/, ''))
        .filter((id) => id && /^\d+$/.test(id));
      if (adAccountIds.length === 0) {
        adAccountIds = [credentials.adAccountId].filter(Boolean);
      }
    }
    if (!adAccountIds.length) {
      return res.status(400).json({
        error: "Ad Account ID is required",
        details: "Provide ad_account_id or set META_AD_ACCOUNT_ID in server/.env",
      });
    }
    if (adAccountIds.some((id) => !/^\d+$/.test(id))) {
      return res.status(400).json({
        error: "Invalid Ad Account ID format",
        details: `Ad Account IDs must be numeric, got: ${adAccountIds.join(',')}`,
      });
    }

    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    let fromDate = from;
    let toDate = to;
    const usedDefaultDates = !fromDate || !toDate || !dateRegex.test(fromDate) || !dateRegex.test(toDate);
    if (usedDefaultDates) {
      const today = new Date().toISOString().slice(0, 10);
      const dayMap = { 7: 7, 14: 14, 30: 30, 90: 90 };
      const d = days && dayMap[Number(days)] ? dayMap[Number(days)] : 7;
      const fromD = new Date();
      fromD.setDate(fromD.getDate() - d);
      fromDate = fromD.toISOString().slice(0, 10);
      toDate = today;
    }
    // #region agent log
    // Best-effort local debug ingestion. Must never crash the server if the ingest service isn't running.
    const _log = (obj) => {
      try {
        const req = require('http').request(
          {
            hostname: '127.0.0.1',
            port: 7244,
            path: '/ingest/a31de4bd-79e0-4784-8d49-20b7d56ddf12',
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            timeout: 1500,
          },
          () => {}
        );
        req.on('error', () => {});
        req.on('timeout', () => {
          try {
            req.destroy();
          } catch (_) {}
        });
        req.end(JSON.stringify(obj));
      } catch (_) {}
    };
    _log({ location: 'meta.jsx:GET/insights', message: 'parsed dates and filters', data: { rawFrom: from, rawTo: to, fromDate, toDate, campaign_id, ad_id, usedDefaultDates }, timestamp: Date.now(), sessionId: 'debug-session', hypothesisId: 'H2,H4' });
    // #endregion

    // Select All → no campaign.id / ad.id in filtering. Explicit selection → IN operator (single/multi).
    const isAllCampaigns = is_all_campaigns === '1' || is_all_campaigns === 'true';
    const isAllAds = is_all_ads === '1' || is_all_ads === 'true';
    const campaignIdForDb = isAllCampaigns ? '' : (campaign_id || '');
    const adIdForDb = isAllAds ? '' : (ad_id || '');
    const campaignIds = (campaign_id || '').split(',').map((s) => s.trim()).filter(Boolean);
    const adIds = (ad_id || '').split(',').map((s) => s.trim()).filter(Boolean);

    const useLive = req.query.live === '1' || req.query.live === 'true';
    const skipCache = req.query.refresh === '1' || req.query.refresh === 'true';
    const insightsCacheKey = insightsCache.buildInsightsKey({
      ad_account_id: adAccountIds.slice().sort().join(','),
      from: fromDate,
      to: toDate,
      campaign_id: campaignIdForDb,
      ad_id: adIdForDb,
      live: useLive,
    });
    const cachedInsights = skipCache ? null : insightsCache.get(insightsCacheKey);
    if (cachedInsights != null) {
      return res.json(cachedInsights);
    }

    const dbResults = await Promise.all(
      adAccountIds.map((adAccountId) =>
        getInsights({
          ad_account_id: adAccountId,
          from: fromDate,
          to: toDate,
          campaign_id: campaignIdForDb,
          ad_id: adIdForDb,
        })
      )
    );
    let data = dbResults.flat();
    // #region agent log
    _log({ location: 'meta.jsx:GET/insights', message: 'db result', data: { source: 'db', rowCount: data.length }, timestamp: Date.now(), sessionId: 'debug-session', hypothesisId: 'H2' });
    // #endregion

    if (useLive || data.length === 0) {
      try {
        const liveResults = await Promise.allSettled(
          adAccountIds.map(async (adAccountId) => {
            const liveData = await fetchInsightsFromMetaLive({
              accessToken: credentials.accessToken,
              adAccountId,
              from: fromDate,
              to: toDate,
              isAllCampaigns,
              isAllAds,
              campaignIds,
              adIds,
              skipCache,
            });
            if (liveData && liveData.length > 0) {
              await upsertInsights(adAccountId, liveData).catch((e) => console.warn("Insights upsert after live:", e.message));
              return liveData.map((row) => ({
                ...row,
                ad_account_id: String(adAccountId),
                ad_account_name: row.ad_account_name || '',
              }));
            }
            return [];
          })
        );
        const liveAggregate = liveResults
          .filter((r) => r.status === 'fulfilled')
          .flatMap((r) => r.value);
        const failedCount = liveResults.filter((r) => r.status === 'rejected').length;
        if (failedCount > 0) {
          console.warn(`Insights live fetch: ${failedCount}/${adAccountIds.length} account(s) failed`);
        }
        if (liveAggregate.length > 0) data = liveAggregate;
        else if (useLive && data.length === 0 && failedCount === adAccountIds.length) {
          const firstErr = liveResults.find((r) => r.status === 'rejected');
          console.error("Insights live fetch error (all failed):", firstErr?.reason?.message || firstErr?.reason);
          return res.status(500).json({
            error: "Failed to fetch insights from Meta",
            details: firstErr?.reason?.message || String(firstErr?.reason || 'All accounts failed'),
          });
        }
      } catch (liveErr) {
        if (useLive && data.length === 0) {
          console.error("Insights live fetch error:", liveErr?.message || liveErr);
          return res.status(500).json({
            error: "Failed to fetch insights from Meta",
            details: liveErr?.message || String(liveErr),
          });
        }
      }
      // #region agent log
      _log({ location: 'meta.jsx:GET/insights', message: 'live result', data: { source: 'live', rowCount: data.length }, timestamp: Date.now(), sessionId: 'debug-session', hypothesisId: 'H2' });
      // #endregion
    }

    // Ensure video3sViews / hold_rate etc. (Hook Rate) even for DB-only rows; Meta often exposes 3s as top-level field.
    data = data.map((row) => enrichInsightsRow(row));

    const payload = { data };
    insightsCache.set(insightsCacheKey, payload, 5 * 60); // 5 min TTL
    res.json(payload);
  } catch (err) {
    console.error("Insights DB Error:", err?.message || err);
    res.status(500).json({
      error: "Failed to fetch insights",
      details: err?.message || String(err),
    });
  }
});

// ---------------------------------------------------------------------
// VIDEO PERFORMANCE — Hook Rate and Hold Rate per ad from Meta Ads Insights.
// GET /api/meta/video-performance?adAccountId=&accessToken=&since=&until=
// ---------------------------------------------------------------------
router.get("/video-performance", optionalAuthMiddleware, async (req, res) => {
  try {
    const { adAccountId, accessToken: queryToken, since, until } = req.query;
    if (!adAccountId || !String(adAccountId).trim()) {
      return res.status(400).json({
        success: false,
        error: "adAccountId is required",
      });
    }
    let accessToken = (queryToken && String(queryToken).trim()) || null;
    if (!accessToken) {
      try {
        const credentials = getCredentials();
        accessToken = credentials.accessToken;
      } catch (e) {
        return res.status(400).json({
          success: false,
          error: "accessToken is required (query param or META_ACCESS_TOKEN in server .env)",
        });
      }
    }
    const data = await fetchVideoPerformance(adAccountId, accessToken, since || undefined, until || undefined);
    return res.json({ success: true, data });
  } catch (err) {
    const status = err.statusCode || 500;
    const message = err.message || "Failed to fetch video performance";
    if (status >= 500) {
      console.error("[VideoPerformance]", message);
    }
    return res.status(status).json({ success: false, error: message });
  }
});

// ---------------------------------------------------------------------
// INSIGHTS DEMOGRAPHICS — Auto-split by valid breakdown combinations (age+gender, country).
// Due to Meta Ads Insights API restrictions, demographic breakdowns are fetched using multiple
// API calls and merged internally, replicating Ads Manager behavior.
// GET /api/meta/insights/demographics?from=YYYY-MM-DD&to=YYYY-MM-DD&breakdowns=age,gender,country&ad_account_id=...
// ---------------------------------------------------------------------
router.get("/insights/demographics", optionalAuthMiddleware, async (req, res) => {
  try {
    let credentials;
    try {
      credentials = getCredentials();
    } catch (e) {
      return res.status(400).json({
        error: "Meta credentials required",
        details: e.message,
      });
    }

    const { from, to, breakdowns, ad_account_id, is_all_campaigns, is_all_ads, campaign_id, ad_id, page_id } = req.query;
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    let fromDate = from;
    let toDate = to;
    if (!fromDate || !toDate || !dateRegex.test(fromDate) || !dateRegex.test(toDate)) {
      const today = new Date().toISOString().slice(0, 10);
      const fromD = new Date();
      fromD.setDate(fromD.getDate() - 7);
      fromDate = fromD.toISOString().slice(0, 10);
      toDate = today;
    }

    const adAccountId = (ad_account_id || credentials.adAccountId || '').toString().replace(/^act_/, '');
    if (!adAccountId || !/^\d+$/.test(adAccountId)) {
      return res.status(400).json({
        error: "Valid Ad Account ID is required",
        details: "Provide ad_account_id or set META_AD_ACCOUNT_ID in server/.env",
      });
    }

    const requestedBreakdowns = (breakdowns || 'age,gender,country').toString().split(',').map((s) => s.trim()).filter(Boolean);
    const isAllCampaigns = is_all_campaigns === '1' || is_all_campaigns === 'true';
    const isAllAds = is_all_ads === '1' || is_all_ads === 'true';
    const campaignIds = (campaign_id || '').split(',').map((s) => s.trim()).filter(Boolean);
    let adIds = (ad_id || '').split(',').map((s) => s.trim()).filter(Boolean);
    const pageIdFilter = page_id ? String(page_id).trim() : null;

    // When a page is selected, find all ads belonging to that page so we can filter insights
    let filteredByPage = false;
    if (pageIdFilter && adIds.length === 0) {
      try {
        const pagePrefix = pageIdFilter + '_';
        let allAds = [];
        let nextUrl = `https://graph.facebook.com/${META_API_VERSION}/act_${adAccountId}/ads`;
        let nextParams = {
          access_token: credentials.accessToken,
          fields: 'id,creative{effective_object_story_id}',
          filtering: JSON.stringify([
            { field: 'effective_status', operator: 'IN', value: ['ACTIVE', 'PAUSED', 'ARCHIVED', 'IN_REVIEW', 'REJECTED', 'PENDING_REVIEW', 'LEARNING', 'ENDED'] }
          ]),
          limit: 500,
        };

        // Paginate through all ads
        while (nextUrl) {
          const { data: adsResp } = await axios.get(nextUrl, {
            params: nextParams,
            timeout: 30000,
            validateStatus: () => true,
          });
          if (adsResp?.data && Array.isArray(adsResp.data)) {
            allAds = allAds.concat(adsResp.data);
          }
          nextUrl = adsResp?.paging?.next || null;
          nextParams = {};
          if (allAds.length > 5000) break;
        }

        const pageAdIds = allAds
          .filter(ad => {
            const storyId = ad?.creative?.effective_object_story_id || '';
            return storyId.startsWith(pagePrefix);
          })
          .map(ad => ad.id);

        if (pageAdIds.length > 0) {
          adIds = pageAdIds;
          filteredByPage = true;
          console.log(`[Demographics] Found ${pageAdIds.length} ads for page ${pageIdFilter} (total: ${allAds.length})`);
        } else {
          console.log(`[Demographics] No ads found for page ${pageIdFilter} (total: ${allAds.length}) — using account-level data`);
        }
      } catch (err) {
        console.warn('[Demographics] Failed to look up ads for page filtering:', err.message);
      }
    }

    const payload = await fetchDemographicInsightsSplit({
      accessToken: credentials.accessToken,
      adAccountId,
      from: fromDate,
      to: toDate,
      breakdowns: requestedBreakdowns,
      isAllCampaigns: filteredByPage ? true : isAllCampaigns,
      isAllAds: filteredByPage ? false : isAllAds,
      campaignIds: filteredByPage ? [] : campaignIds,
      adIds,
    });

    return res.json(payload);
  } catch (err) {
    console.error("Insights demographics error:", err?.message || err);
    return res.status(500).json({
      error: "Failed to fetch demographic insights",
      details: err?.message || String(err),
    });
  }
});

// ---------------------------------------------------------------------
// INSIGHTS DAILY — Ad account daily time series (impressions, reach, clicks) for Page performance chart.
// GET /api/meta/insights/daily?from=YYYY-MM-DD&to=YYYY-MM-DD&ad_account_id=...
// Returns same shape as page insights: { data: { reach: [{date, value}], impressions: [{date, value}], clicks: [{date, value}] } }
// ---------------------------------------------------------------------
const DAILY_INSIGHTS_STATUS_FILTER = [
  { field: 'campaign.effective_status', operator: 'IN', value: ['ACTIVE', 'PAUSED', 'ARCHIVED', 'IN_REVIEW', 'REJECTED', 'PENDING_REVIEW', 'LEARNING', 'ENDED'] },
  { field: 'ad.effective_status', operator: 'IN', value: ['ACTIVE', 'PAUSED', 'ARCHIVED', 'IN_REVIEW', 'REJECTED', 'PENDING_REVIEW', 'LEARNING', 'ENDED'] },
];
router.get("/insights/daily", optionalAuthMiddleware, async (req, res) => {
  try {
    let credentials;
    try {
      credentials = getCredentials();
    } catch (e) {
      return res.status(400).json({
        error: "Meta credentials required",
        details: e.message,
      });
    }
    const { from, to, ad_account_id } = req.query;
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    let fromDate = from;
    let toDate = to;
    if (!fromDate || !toDate || !dateRegex.test(fromDate) || !dateRegex.test(toDate)) {
      const today = new Date().toISOString().slice(0, 10);
      const fromD = new Date();
      fromD.setDate(fromD.getDate() - 7);
      fromDate = fromD.toISOString().slice(0, 10);
      toDate = today;
    }
    const adAccountId = (ad_account_id || credentials.adAccountId || '').toString().replace(/^act_/, '');
    if (!adAccountId || !/^\d+$/.test(adAccountId)) {
      return res.status(400).json({
        error: "Valid Ad Account ID is required",
        details: "Provide ad_account_id or set META_AD_ACCOUNT_ID in server/.env",
      });
    }
    const insightsUrl = `https://graph.facebook.com/${META_API_VERSION}/act_${adAccountId}/insights`;
    const timeRange = JSON.stringify({ since: fromDate, until: toDate });
    const params = {
      access_token: credentials.accessToken,
      level: 'ad',
      time_increment: 1,
      time_range: timeRange,
      fields: 'date_start,impressions,reach,clicks',
      limit: 1000,
      filtering: JSON.stringify(DAILY_INSIGHTS_STATUS_FILTER),
    };
    const { data } = await axios.get(insightsUrl, { params, timeout: 60000 });
    const rows = Array.isArray(data.data) ? data.data : [];
    const byDate = new Map();
    rows.forEach((row) => {
      const date = row.date_start || null;
      if (!date) return;
      if (!byDate.has(date)) byDate.set(date, { reach: 0, impressions: 0, clicks: 0 });
      const agg = byDate.get(date);
      agg.reach += parseInt(row.reach || 0, 10);
      agg.impressions += parseInt(row.impressions || 0, 10);
      agg.clicks += parseInt(row.clicks || 0, 10);
    });
    const sortedDates = [...byDate.keys()].sort();
    const reach = sortedDates.map((date) => ({ date, value: byDate.get(date).reach }));
    const impressions = sortedDates.map((date) => ({ date, value: byDate.get(date).impressions }));
    const clicks = sortedDates.map((date) => ({ date, value: byDate.get(date).clicks }));
    return res.json({
      data: {
        reach,
        impressions,
        clicks,
      },
    });
  } catch (err) {
    console.error("Insights daily error:", err?.message || err);
    return res.status(500).json({
      error: "Failed to fetch daily insights",
      details: err?.response?.data?.error?.message || err?.message || String(err),
    });
  }
});

// ---------------------------------------------------------------------
// INSIGHTS DAILY SPEND — for Team Performance / Ad Spend charts. New endpoint; does not change existing APIs.
// GET /api/meta/insights/daily-spend?from=YYYY-MM-DD&to=YYYY-MM-DD&ad_account_id=...
// Returns { data: [ { date, spend } ] } sorted by date.
// ---------------------------------------------------------------------
router.get("/insights/daily-spend", optionalAuthMiddleware, async (req, res) => {
  try {
    let credentials;
    try {
      credentials = getCredentials();
    } catch (e) {
      return res.status(400).json({ error: "Meta credentials required", details: e.message });
    }
    const { from, to, ad_account_id } = req.query;
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    let fromDate = from;
    let toDate = to;
    if (!fromDate || !toDate || !dateRegex.test(fromDate) || !dateRegex.test(toDate)) {
      const today = new Date().toISOString().slice(0, 10);
      const fromD = new Date();
      fromD.setDate(fromD.getDate() - 7);
      fromDate = fromD.toISOString().slice(0, 10);
      toDate = today;
    }
    const adAccountId = (ad_account_id || credentials.adAccountId || '').toString().replace(/^act_/, '');
    if (!adAccountId || !/^\d+$/.test(adAccountId)) {
      return res.status(400).json({ error: "Valid Ad Account ID is required", details: "Provide ad_account_id or set META_AD_ACCOUNT_ID" });
    }
    const insightsUrl = `https://graph.facebook.com/${META_API_VERSION}/act_${adAccountId}/insights`;
    const timeRange = JSON.stringify({ since: fromDate, until: toDate });
    const params = {
      access_token: credentials.accessToken,
      level: "campaign",
      time_increment: 1,
      time_range: timeRange,
      fields: "date_start,spend",
      limit: 1000,
      filtering: JSON.stringify(DAILY_INSIGHTS_STATUS_FILTER),
    };
    const { data } = await axios.get(insightsUrl, { params, timeout: 60000 });
    const rows = Array.isArray(data.data) ? data.data : [];
    const byDate = new Map();
    rows.forEach((row) => {
      const date = row.date_start || null;
      if (!date) return;
      const spend = parseFloat(row.spend || 0) || 0;
      byDate.set(date, (byDate.get(date) || 0) + spend);
    });
    const sortedDates = [...byDate.keys()].sort();
    const result = sortedDates.map((date) => ({ date, spend: byDate.get(date) }));
    return res.json({ data: result });
  } catch (err) {
    console.error("Insights daily-spend error:", err?.message || err);
    return res.status(500).json({
      error: "Failed to fetch daily spend",
      details: err?.response?.data?.error?.message || err?.message || String(err),
    });
  }
});

// ---------------------------------------------------------------------
// INSIGHTS BACKFILL — trigger via Postman: POST body { from, to } (YYYY-MM-DD), optional ad_account_id.
// If ad_account_id omitted: fetch all ad accounts from Meta and run backfill for each.
// ---------------------------------------------------------------------
router.post("/insights/backfill", optionalAuthMiddleware, async (req, res) => {
  try {
    const { from, to, ad_account_id } = req.body || req.query;

    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!from || !to || !dateRegex.test(from) || !dateRegex.test(to)) {
      return res.status(400).json({
        error: "Invalid or missing date range",
        details: "Send JSON body: { from: 'YYYY-MM-DD', to: 'YYYY-MM-DD' }. Optional: ad_account_id.",
      });
    }

    const singleId = (ad_account_id != null && ad_account_id !== '' ? ad_account_id : '').toString().replace(/^act_/, '').trim();
    if (singleId && /^\d+$/.test(singleId)) {
      const { count } = await runInsightsSyncForRange(singleId, from, to);
      return res.json({ ok: true, message: `Backfill done for ${from}..${to}`, count });
    }

    let accounts;
    try {
      accounts = await fetchAllAdAccountIds();
      console.log(`[Backfill] Fetched ${accounts.length} ad accounts from Meta API:`, accounts.map(a => `${a.name} (${a.id})`).join(', '));
    } catch (e) {
      console.error('[Backfill] Failed to fetch ad accounts:', e.message, e.stack);
      return res.status(500).json({
        error: "Failed to fetch ad accounts",
        details: e?.message || String(e),
      });
    }
    if (!accounts || accounts.length === 0) {
      console.warn('[Backfill] No ad accounts found from Meta API. Check token permissions (e.g. ads_read).');
      return res.status(400).json({
        error: "No ad accounts found",
        details: "Check token permissions (e.g. ads_read). Meta API /me/adaccounts returned empty.",
      });
    }

    console.log(`[Backfill] Processing ${accounts.length} ad accounts for date range ${from}..${to}`);
    const results = [];
    let totalCount = 0;
    for (const { id, name } of accounts) {
      try {
        console.log(`[Backfill] Syncing account ${name} (${id}) for ${from}..${to}...`);
        const { count } = await runInsightsSyncForRange(id, from, to);
        console.log(`[Backfill] ✓ Account ${name} (${id}): ${count} insights rows synced`);
        results.push({ account_id: id, account_name: name, count });
        totalCount += count;
      } catch (err) {
        console.error(`[Backfill] ✗ Error for account ${id} (${name}):`, err?.response?.data || err?.message);
        results.push({ account_id: id, account_name: name, count: 0, error: err?.message || String(err) });
      }
    }
    
   
    res.json({
      ok: true,
      message: `Backfill done for ${from}..${to}`,
      accounts: results,
      totalCount,
    });
  } catch (err) {
    console.error("Insights backfill error:", err?.response?.data || err?.message || err);
    const code = err?.response?.data?.error?.code;
    if (code === 190) {
      return res.status(401).json({
        error: "Meta Access Token expired or invalid",
        details: err.response?.data?.error?.message,
        isAuthError: true,
      });
    }
    res.status(500).json({
      error: "Backfill failed",
      details: err?.message || String(err),
    });
  }
});

// ---------------------------------------------------------------------
// 3) CAMPAIGNS SUMMARY (SPEND, LEADS, CPL, etc.) — DB-first campaigns, one /insights request
//    GET /api/meta/active-campaigns?ad_account_id=&from=&to=
// ---------------------------------------------------------------------
router.get("/active-campaigns", optionalAuthMiddleware, async (req, res) => {
  try {
    const credentials = getCredentials();
    const { from, to, ad_account_id } = req.query;

    let adAccountId = (ad_account_id || credentials.adAccountId || '').toString().replace(/^act_/, '');
    if (!adAccountId) {
      return res.status(400).json({ error: "ad_account_id required" });
    }

    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    let since = null;
    let until = null;
    if (from && to && dateRegex.test(from) && dateRegex.test(to)) {
      since = from;
      until = to;
    }

    // 1) Campaign list from DB (cache 24h+); no Meta /campaigns call on every request
    const campaigns = await campaignsServiceMeta.list(adAccountId);
    if (!campaigns || campaigns.length === 0) {
      return res.json({ data: [], message: "No campaigns found" });
    }

    const campaignIds = campaigns.map((c) => c.id || c.campaign_id);

    // 2) One /insights request with IN filter for campaigns (per Meta best practice)
    const insightsUrl = `https://graph.facebook.com/${META_API_VERSION}/act_${adAccountId}/insights`;
    const filtering = [
      { field: "campaign.effective_status", operator: "IN", value: ["ACTIVE", "PAUSED", "ARCHIVED", "IN_REVIEW", "REJECTED", "PENDING_REVIEW", "LEARNING", "ENDED"] },
      { field: "campaign.id", operator: "IN", value: campaignIds },
    ];
    const params = {
      access_token: credentials.accessToken,
      level: "campaign",
      fields: "campaign_id,campaign_name,spend,actions,unique_actions",
      filtering: JSON.stringify(filtering),
      limit: 1000,
    };
    if (since && until) {
      params.time_range = JSON.stringify({ since, until });
    } else {
      params.date_preset = "last_30d";
    }

    const insightsResp = await axios.get(insightsUrl, { params });
    const insightsRows = insightsResp.data.data || [];

    const metricsByCampaign = {};

    insightsRows.forEach((row) => {
      const id = row.campaign_id;
      const spend = parseFloat(row.spend || "0") || 0;

      let leads = 0;
      let uniqueLeads = 0;

      if (Array.isArray(row.actions)) {
        row.actions.forEach((a) => {
          if (
            a.action_type === "lead" ||
            a.action_type === "leads" ||
            a.action_type === "onsite_conversion.lead_grouped"
          ) {
            leads += parseFloat(a.value || "0") || 0;
          }
        });
      }

      if (Array.isArray(row.unique_actions)) {
        row.unique_actions.forEach((a) => {
          if (
            a.action_type === "lead" ||
            a.action_type === "leads" ||
            a.action_type === "onsite_conversion.lead_grouped"
          ) {
            uniqueLeads += parseFloat(a.value || "0") || 0;
          }
        });
      }

      const cpl = leads > 0 ? spend / leads : null;

      metricsByCampaign[id] = {
        campaign_name: row.campaign_name,
        spend,
        leads,
        unique_leads: uniqueLeads,
        cpl,
      };
    });

    const result = campaigns.map((c) => {
      const m = metricsByCampaign[c.id] || {
        spend: 0,
        leads: 0,
        unique_leads: 0,
        cpl: null,
      };

      return {
        id: c.id,
        name: c.name,
        status: c.status,
        effective_status: c.effective_status,
        objective: c.objective,
        ad_spend: m.spend,
        leads: m.leads,
        unique_leads: m.unique_leads,
        cpl: m.cpl,
      };
    });

    res.json({ data: result });
  } catch (err) {
    console.error("Error fetching active campaign metrics:", err.response?.data || err.message);

    if (err.response?.data?.error?.code === 190) {
      return res.status(401).json({
        error: "Meta Access Token expired or invalid",
        details: err.response.data.error.message,
        isAuthError: true,
        instruction: "Please update META_ACCESS_TOKEN in server/.env"
      });
    }

    res.status(500).json({
      error: "Failed to fetch campaign metrics",
      details: err.response?.data || err.message,
    });
  }
});

// ---------------------------------------------------------------------
// 4) ADS LIST API — DB only. Never fetch on filter change. Sync via POST /ads/sync.
//    GET /api/meta/ads?ad_account_id=&campaign_id= (or &all=true)
//    UI reads from DB only; /act_{id}/ads is called once per account via sync.
// ---------------------------------------------------------------------
router.get("/ads", optionalAuthMiddleware, async (req, res) => {
  const send = (data, cached = true) => res.json({ data: Array.isArray(data) ? data : (data?.data ?? []), cached });

  try {
    const credentials = getCredentials();
    const accId = normalizeAdAccountId(req.query.ad_account_id || credentials.adAccountId);
    if (!accId) {
      return res.status(400).json({ error: "ad_account_id required", details: "Set query param or META_AD_ACCOUNT_ID in server/.env" });
    }
    const { campaign_id, all } = req.query;

    if (all === 'true' || all === '1') {
      let data = await adsServiceMeta.listFromDb(accId);
      if ((!data || data.length === 0)) {
        try {
          await adsServiceMeta.fetchAndCache(accId);
          data = await adsServiceMeta.listFromDb(accId);
        } catch (_) {}
      }
      return send(data || [], true);
    }

    if (campaign_id && String(campaign_id).trim() !== "") {
      const campaign_ids = String(campaign_id)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      let data = await adsServiceMeta.listFromDb(accId, { campaign_ids });
      if (!data || data.length === 0) {
        try {
          await adsServiceMeta.fetchAndCache(accId);
          data = await adsServiceMeta.listFromDb(accId, { campaign_ids });
        } catch (_) {}
      }
      return send(data || [], true);
    }

    const data = await adsServiceMeta.listFromDb(accId);
    return send(data || [], true);
  } catch (err) {
    console.error("Meta API Ads Error:", err.response?.data || err.message);
    if (err.response?.data?.error?.code === 190) {
      return res.status(401).json({
        error: "Meta Access Token expired or invalid",
        details: err.response?.data?.error?.message,
        isAuthError: true,
        instruction: "Please update META_ACCESS_TOKEN in server/.env",
      });
    }
    return res.status(500).json({
      error: "Failed to fetch ads",
      details: err.response?.data || err.message,
    });
  }
});

// POST /api/meta/ads/sync — trigger one-time fetch /act_{id}/ads and store in DB. Never called on filter change.
router.post("/ads/sync", optionalAuthMiddleware, async (req, res) => {
  try {
    const credentials = getCredentials();
    const accId = normalizeAdAccountId(req.body?.ad_account_id || req.query?.ad_account_id || credentials.adAccountId);
    if (!accId) {
      return res.status(400).json({ error: "ad_account_id required" });
    }
    await adsServiceMeta.fetchAndCache(accId);
    const data = await adsServiceMeta.listFromDb(accId);
    return res.json({ ok: true, data: data || [], message: "Ads synced for account " + accId });
  } catch (err) {
    console.error("Meta ads/sync Error:", err.response?.data || err.message);
    if (err.response?.data?.error?.code === 190) {
      return res.status(401).json({ error: "Meta Access Token expired or invalid", details: err.response?.data?.error?.message, isAuthError: true });
    }
    return res.status(500).json({ error: "Failed to sync ads", details: err.response?.data?.error?.message || err.message });
  }
});

async function fetchAllAdsCached(credentials, res, send, sendError) {
  const accId = normalizeAdAccountId(credentials.adAccountId);
  try {
    const adsUrl = `https://graph.facebook.com/${META_API_VERSION}/act_${credentials.adAccountId}/ads`;
    const { data } = await axios.get(adsUrl, {
      params: {
        access_token: credentials.accessToken,
        fields: "id,name,status,effective_status,campaign_id",
        limit: 1000,
      },
    });
    let allAds = data?.data ?? [];
    const campaignIds = [...new Set(allAds.map(ad => ad.campaign_id).filter(Boolean))];
    const campaignsMap = new Map();
    if (campaignIds.length > 0) {
      try {
        const campaignsUrl = `https://graph.facebook.com/${META_API_VERSION}/act_${credentials.adAccountId}/campaigns`;
        const campaignsResp = await axios.get(campaignsUrl, {
          params: { access_token: credentials.accessToken, fields: "id,name", limit: 1000 },
        });
        (campaignsResp.data?.data ?? []).forEach(c => campaignsMap.set(c.id, c.name));
      } catch (_) {}
    }
    const enrichedAds = allAds.map(ad => ({
      id: ad.id,
      name: ad.name,
      status: ad.status,
      effective_status: ad.effective_status,
      campaign_id: ad.campaign_id,
      campaign_name: campaignsMap.get(ad.campaign_id) || null,
    }));
    await adsCache.set(accId, 'all', enrichedAds);
    return send(enrichedAds, false);
  } catch (err) {
    if (isMetaRateLimitError(err)) {
      const fallback = await adsCache.getAnyCached(accId);
      if (fallback) {
        console.warn("Meta ads rate limit (all); returning cached data for account", accId);
        return send(fallback.data, true);
      }
      return sendError(429, {
        error: "Ad account has too many API calls",
        details: err.response?.data?.error?.message || "Rate limit reached.",
        code: "RATE_LIMIT",
      });
    }
    throw err;
  }
}

// ---------------------------------------------------------------------
// 5.0) AD ACCOUNTS API - DB-first. UI dropdown reads from DB only.
//    GET /api/meta/ad-accounts → list from DB; if empty, fetch /me/adaccounts and cache, then return.
//    ?refresh=true → force fetch from Meta (handles pagination) and refresh cache.
// ---------------------------------------------------------------------
router.get("/ad-accounts", optionalAuthMiddleware, async (req, res) => {
  try {
    const forceRefresh = req.query.refresh === 'true' || req.query.refresh === '1';
    let accounts = await adAccountsService.listFromDb();
    if (forceRefresh || !accounts || accounts.length === 0) {
      try {
        await adAccountsService.fetchAndCache();
        accounts = await adAccountsService.listFromDb();
      } catch (e) {
        console.warn("Meta /ad-accounts fetchAndCache failed:", e.message);
      }
    }
    const normalized = (accounts || []).map((a) => ({
      account_id: a.account_id,
      account_name: a.account_name || a.name || `Account ${a.account_id}`,
      currency: a.currency || "INR",
      timezone: a.timezone || a.timezone_name || "Asia/Kolkata",
      status: a.status || (a.account_status === 1 ? "ACTIVE" : "INACTIVE"),
    }));
    res.json(normalized);
  } catch (error) {
    console.error("Meta /ad-accounts error:", error.message);
    if (error.response?.data?.error?.code === 190) {
      return res.status(401).json({
        error: "Meta Access Token expired or invalid",
        details: error.response.data.error.message,
        isAuthError: true,
        instruction: "Please update META_ACCESS_TOKEN in server/.env",
      });
    }
    res.status(500).json({
      error: "Failed to fetch ad accounts",
      details: error.response?.data?.error?.message || error.message,
    });
  }
});

// ---------------------------------------------------------------------
// 4.1) BUSINESSES API - Fetch Business Manager accounts
//    GET /api/meta/businesses
//    Uses META_ACCESS_TOKEN with business_management permission
// ---------------------------------------------------------------------
router.get("/businesses", optionalAuthMiddleware, async (req, res) => {
  try {
    const accessToken = (process.env.META_ACCESS_TOKEN || '').trim();
    if (!accessToken) {
      throw new Error("Meta Access Token missing. Please configure META_ACCESS_TOKEN in server/.env file.");
    }

    let allBusinesses = [];
    let nextUrl = `https://graph.facebook.com/${META_API_VERSION}/me/businesses`;
    let isFirstRequest = true;
    
    // Handle pagination
    while (nextUrl) {
      const requestConfig = {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      };
      
      // Only add params for the first request (paging.next URLs already contain all params)
      if (isFirstRequest) {
        requestConfig.params = {
          fields: "id,name",
          limit: 100,
        };
        isFirstRequest = false;
      }
      
      const response = await axios.get(nextUrl, requestConfig);
      
      const businessesData = response.data.data || [];
      allBusinesses = allBusinesses.concat(businessesData);
      
      // Check for pagination
      if (response.data.paging && response.data.paging.next) {
        nextUrl = response.data.paging.next;
      } else {
        nextUrl = null;
      }
    }
    
    // Normalize response format
    const businesses = allBusinesses.map(business => ({
      business_id: business.id,
      business_name: business.name || `Business ${business.id}`,
    }));

    res.json({ businesses });
  } catch (error) {
    console.error("Meta /businesses error:", error.response?.data || error.message);
    
    // Handle authentication errors
    if (error.response?.data?.error?.code === 190) {
      return res.status(401).json({
        error: "Meta Access Token expired or invalid",
        details: error.response.data.error.message,
        isAuthError: true,
        instruction: "Please update META_ACCESS_TOKEN in server/.env",
      });
    }
    
    // Handle permission errors
    if (error.response?.data?.error?.code === 200 || 
        error.response?.data?.error?.code === 10 ||
        (error.response?.data?.error?.message && 
         error.response.data.error.message.includes('business_management'))) {
      return res.status(403).json({
        error: "Insufficient permissions",
        details: error.response.data.error.message || "business_management permission is required",
        isPermissionError: true,
        instruction: "Please ensure your Meta Access Token has the 'business_management' permission",
      });
    }
    
    // If no businesses found, return empty array (not an error)
    if (error.response?.data?.error?.code === 100) {
      console.warn("No businesses found or error 100, returning empty array");
      return res.json({ businesses: [] });
    }

    res.status(500).json({
      error: "Failed to fetch businesses",
      details: error.response?.data || error.message,
    });
  }
});

// ---------------------------------------------------------------------
// 5.1) PAGES API - Fetch pages (Content Marketing PAGE filter)
//    GET /api/meta/pages
//    Uses META_SYSTEM_ACCESS_TOKEN_1 if set, else META_SYSTEM_ACCESS_TOKEN
//    Fallbacks: 1) me/accounts 2) businesses -> owned_pages 3) META_PAGE_ID
// ---------------------------------------------------------------------
const mapPage = (page) => ({
  id: page.id,
  name: page.name || `Page ${page.id}`,
  instagram_business_account_id: page.instagram_business_account?.id || null,
});

async function fetchPagesFromMeAccounts(accessToken) {
  const response = await axios.get(
    `https://graph.facebook.com/${META_API_VERSION}/me/accounts`,
    {
      params: {
        fields: "id,name,access_token,instagram_business_account{id}",
      },
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    }
  );
  if (response.data && response.data.id) return [response.data];
  if (Array.isArray(response.data)) return response.data;
  if (response.data?.data && Array.isArray(response.data.data)) return response.data.data;
  return [];
}

async function fetchPagesFromBusinesses(accessToken) {
  const businessesRes = await axios.get(
    `https://graph.facebook.com/${META_API_VERSION}/me/businesses`,
    {
      params: { fields: "id,name", limit: 100 },
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );
  const businesses = businessesRes.data?.data || [];
  if (businesses.length === 0) return [];

  const allPages = [];
  for (const biz of businesses) {
    try {
      const pagesRes = await axios.get(
        `https://graph.facebook.com/${META_API_VERSION}/${biz.id}/owned_pages`,
        {
          params: {
            fields: "id,name,access_token,instagram_business_account{id}",
          },
          headers: { Authorization: `Bearer ${accessToken}` },
        }
      );
      const pages = pagesRes.data?.data || [];
      allPages.push(...pages);
    } catch (e) {
      console.warn(`[Pages] Could not fetch owned_pages for business ${biz.id}:`, e.response?.data?.error?.message || e.message);
    }
  }
  return allPages;
}

async function fetchPageById(pageId, accessToken) {
  const response = await axios.get(
    `https://graph.facebook.com/${META_API_VERSION}/${pageId}`,
    {
      params: {
        fields: "id,name,access_token,instagram_business_account{id}",
      },
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );
  return response.data ? [response.data] : [];
}

/** Load all page tokens into cache (me/accounts + businesses). Used as fallback when getPageAccessToken fails. */
async function loadPageTokensIntoCache() {
  const systemToken = (
    (process.env.META_SYSTEM_ACCESS_TOKEN_1 || process.env.META_SYSTEM_ACCESS_TOKEN || process.env.META_ACCESS_TOKEN) || ''
  ).trim();
  const userToken = (process.env.META_ACCESS_TOKEN || '').trim();
  const pageIdEnv = (process.env.META_PAGE_ID || '').trim();
  if (!systemToken && !userToken) return [];
  const accessToken = systemToken || userToken;
  let rawPages = [];
  if (userToken) {
    try { rawPages = await fetchPagesFromMeAccounts(userToken); } catch (e) { /* ignore */ }
  }
  if (rawPages.length === 0 && systemToken) {
    try { rawPages = await fetchPagesFromMeAccounts(systemToken); } catch (e) { /* ignore */ }
  }
  if (rawPages.length === 0) {
    const bizToken = userToken || systemToken;
    if (bizToken) {
      try { rawPages = await fetchPagesFromBusinesses(bizToken); } catch (e) { /* ignore */ }
    }
  }
  if (rawPages.length === 0 && pageIdEnv) {
    try { rawPages = await fetchPageById(pageIdEnv, accessToken); } catch (e) { /* ignore */ }
  }
  const now = Date.now();
  const ttl = pageTokenCache.ttl || 60 * 60 * 1000;
  for (const page of rawPages) {
    if (page && page.id && page.access_token) {
      pageTokenCache.tokens[page.id] = { token: page.access_token, expiresAt: now + ttl };
    }
  }
  return rawPages;
}

router.get("/pages", optionalAuthMiddleware, async (req, res) => {
  try {
    const systemToken = (
      (process.env.META_SYSTEM_ACCESS_TOKEN_1 || process.env.META_SYSTEM_ACCESS_TOKEN || process.env.META_ACCESS_TOKEN) || ''
    ).trim();
    const userToken = (process.env.META_ACCESS_TOKEN || '').trim();
    const pageIdEnv = (process.env.META_PAGE_ID || '').trim();

    if (!systemToken && !userToken) {
      throw new Error("Meta Access Token missing. Configure META_SYSTEM_ACCESS_TOKEN_1 or META_SYSTEM_ACCESS_TOKEN in server/.env");
    }

    const accessToken = systemToken || userToken;
    let rawPages = [];

    // 1) Try me/accounts — use User token first (Meta returns pages for User tokens with pages_show_list;
    //    System User tokens often return empty for me/accounts)
    if (userToken) {
      try {
        rawPages = await fetchPagesFromMeAccounts(userToken);
      } catch (e) {
        console.warn("[Pages] me/accounts (user token) failed:", e.response?.data?.error?.message || e.message);
      }
    }
    if (rawPages.length === 0 && systemToken) {
      try {
        rawPages = await fetchPagesFromMeAccounts(systemToken);
      } catch (e) {
        console.warn("[Pages] me/accounts (system token) failed:", e.response?.data?.error?.message || e.message);
      }
    }

    // 2) If empty, try businesses -> owned_pages (works when pages are linked to Business)
    // Use user token first (often has business_management), then system token
    if (rawPages.length === 0) {
      const bizToken = userToken || systemToken;
      if (bizToken) {
        try {
          rawPages = await fetchPagesFromBusinesses(bizToken);
        } catch (e) {
          console.warn("[Pages] businesses/owned_pages fallback failed:", e.response?.data?.error?.message || e.message);
        }
      }
    }

    // 3) If still empty and META_PAGE_ID is set, fetch that specific page
    if (rawPages.length === 0 && pageIdEnv) {
      try {
        rawPages = await fetchPageById(pageIdEnv, accessToken);
      } catch (e) {
        console.warn("[Pages] META_PAGE_ID fallback failed:", e.response?.data?.error?.message || e.message);
      }
    }

    if (rawPages.length === 0) {
      console.warn(
        "[Pages] No pages returned. PAGE dropdown will be empty. " +
        "Fix: (1) Use a User token with pages_show_list for me/accounts, or " +
        "(2) Link pages to a Business and use a token with business_management, or " +
        "(3) Set META_PAGE_ID in server/.env to a Facebook Page ID."
      );
    } else {
      console.log(`[Pages] Returning ${rawPages.length} page(s) for PAGE filter.`);
    }

    const now = Date.now();
    const ttl = pageTokenCache.ttl || 60 * 60 * 1000;
    for (const page of rawPages) {
      if (page && page.id && page.access_token) {
        pageTokenCache.tokens[page.id] = {
          token: page.access_token,
          expiresAt: now + ttl,
        };
      }
    }

    const pages = rawPages.map(mapPage);
    const defaultPageId = (pageIdEnv || '').trim();

    res.json({ data: pages, defaultPageId });
  } catch (error) {
    console.error("Meta /pages error:", error.response?.data || error.message);

    if (error.response?.data?.error?.code === 190) {
      return res.status(401).json({
        error: "Meta Access Token expired or invalid",
        details: error.response.data.error.message,
        isAuthError: true,
        instruction: "Please update META_SYSTEM_ACCESS_TOKEN_1 or META_SYSTEM_ACCESS_TOKEN in server/.env",
      });
    }

    res.status(500).json({
      error: "Failed to fetch pages",
      details: error.response?.data || error.message,
    });
  }
});

// ---------------------------------------------------------------------
// 5.1.1) PAGE NAME API - Fetch page name by page ID
//    GET /api/meta/page-name?pageId=...
//    Uses META_SYSTEM_ACCESS_TOKEN
// ---------------------------------------------------------------------
router.get("/page-name", optionalAuthMiddleware, async (req, res) => {
  try {
    const { pageId } = req.query;
    
    if (!pageId || pageId.trim() === "") {
      return res.status(400).json({
        error: "pageId parameter is required",
        message: "Please provide a pageId to fetch page name"
      });
    }

    const accessToken = getSystemToken();
    const pageUrl = `https://graph.facebook.com/${META_API_VERSION}/${pageId}`;
    
    try {
      const response = await axios.get(pageUrl, {
        params: {
          access_token: accessToken,
          fields: "name"
        }
      });

      res.json({
        page_id: pageId,
        page_name: response.data.name || `Page ${pageId}`
      });
    } catch (pageErr) {
      console.error(`[Page Name] Error fetching page ${pageId}:`, pageErr.response?.data || pageErr.message);
      
      if (pageErr.response?.data?.error?.code === 190) {
        return res.status(401).json({
          error: "Meta Access Token expired or invalid",
          details: pageErr.response.data.error.message,
          isAuthError: true,
          instruction: "Please update META_SYSTEM_ACCESS_TOKEN in server/.env"
        });
      }

      // If page not found or permission error
      if (pageErr.response?.status === 404 || pageErr.response?.data?.error?.code === 100) {
        return res.status(404).json({
          error: "Page not found",
          details: pageErr.response?.data?.error?.message || "Page ID is invalid or inaccessible"
        });
      }

      throw pageErr;
    }
  } catch (err) {
    console.error("[Page Name] Error:", err.response?.data || err.message);
    
    res.status(500).json({
      error: "Failed to fetch page name",
      details: err.response?.data || err.message
    });
  }
});

// ---------------------------------------------------------------------
// Instagram audience demographics (city + country) for Top towns/cities and Top countries
// GET /api/meta/instagram-audience-demographics?page_id=...&timeframe=this_month
// Returns city_breakdown and country_breakdown from Instagram engaged_audience_demographics
// ---------------------------------------------------------------------
router.get("/instagram-audience-demographics", optionalAuthMiddleware, async (req, res) => {
  const emptyData = () => ({
    data: {
      city_breakdown: [],
      country_breakdown: [],
      age_breakdown: [],
      gender_breakdown: [],
      source: "instagram_audience",
    },
    message: "Page not accessible with current token. Add this page in Meta Business Suite or select a page your app can access.",
  });
  try {
    const { page_id, timeframe } = req.query;
    if (!page_id || String(page_id).trim() === "") {
      return res.status(400).json({
        error: "page_id is required",
        details: "Provide the Facebook Page ID that has a linked Instagram Business account.",
      });
    }
    const pageId = String(page_id).trim();
    const tf = (timeframe || "this_month").toLowerCase();
    const allowedTimeframes = ["this_week", "this_month", "last_90_days"];
    const actualTimeframe = allowedTimeframes.includes(tf) ? tf : "this_month";

    const systemToken = getSystemToken();
    const pageUrl = `https://graph.facebook.com/${META_API_VERSION}/${pageId}`;
    let igAccountId = null;
    let pageToken = null;
    const { token: pageTokenFirst } = await getPageAccessTokenSafe(pageId);
    if (pageTokenFirst) {
      try {
        const pageResFirst = await axios.get(pageUrl, {
          params: { access_token: pageTokenFirst, fields: "instagram_business_account{id}" },
          timeout: 10000,
        });
        if (pageResFirst.data?.instagram_business_account?.id) {
          igAccountId = pageResFirst.data.instagram_business_account.id;
          pageToken = pageTokenFirst;
        }
      } catch (_) {
        // ignore, fall back to system token
      }
    }
    if (!igAccountId) {
      try {
        const pageRes = await axios.get(pageUrl, {
          params: { access_token: systemToken, fields: "instagram_business_account{id}" },
          timeout: 10000,
        });
        igAccountId = pageRes.data?.instagram_business_account?.id;
      } catch (pageErr) {
        const code = pageErr?.response?.data?.error?.code;
        console.warn("[Instagram Audience Demographics] Page not accessible:", pageId, code, pageErr?.response?.data?.error?.message || pageErr.message);
        return res.status(200).json(emptyData());
      }
    }
    if (!igAccountId) {
      return res.status(200).json({
        ...emptyData(),
        message: "This page does not have a linked Instagram Business account. Select a page with Instagram linked.",
      });
    }
    if (!pageToken) {
      const { token: t, error: tokenError } = await getPageAccessTokenSafe(pageId);
      if (tokenError || !t) {
        console.warn("[Instagram Audience Demographics] Page token not available for page:", pageId, tokenError);
        return res.status(200).json(emptyData());
      }
      pageToken = t;
    }
    const { city_breakdown, country_breakdown, age_breakdown, gender_breakdown } = await fetchInstagramAudienceDemographics(
      igAccountId,
      pageToken,
      actualTimeframe
    );

    return res.json({
      data: {
        city_breakdown: city_breakdown || [],
        country_breakdown: country_breakdown || [],
        age_breakdown: age_breakdown || [],
        gender_breakdown: gender_breakdown || [],
        source: "instagram_audience",
      },
    });
  } catch (err) {
    const code = err?.response?.data?.error?.code;
    const msg = (err?.response?.data?.error?.message || err.message || "").toString();
    console.error("[Instagram Audience Demographics] Error:", code || err.message, msg);
    if (err.response?.status === 400) {
      return res.status(400).json({
        error: "Bad request",
        details: msg,
      });
    }
    if (code === 10 || code === "10" || msg.includes("(#10)") || msg.includes("pages_read_engagement") || msg.includes("Page Public Content Access") || msg.includes("Page Public Metadata Access")) {
      return res.status(200).json(emptyData());
    }
    return res.status(500).json({
      error: "Failed to fetch Instagram audience demographics",
      details: msg,
    });
  }
});

// ---------------------------------------------------------------------
// Instagram reach by follow_type (Followers vs Non-Followers)
// GET /api/meta/instagram/reach-by-follow-type?page_id=...&from=YYYY-MM-DD&to=YYYY-MM-DD
// Same format as Meta: metric=reach, period=day, metric_type=total_value, breakdown=follow_type
// ---------------------------------------------------------------------
router.get("/instagram/reach-by-follow-type", optionalAuthMiddleware, async (req, res) => {
  try {
    const { page_id, from, to } = req.query;
    if (!page_id || String(page_id).trim() === "") {
      return res.status(400).json({
        error: "page_id is required",
        details: "Provide the Facebook Page ID that has a linked Instagram Business account.",
      });
    }
    const pageId = String(page_id).trim();
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    let fromDate = from && dateRegex.test(String(from).trim()) ? String(from).trim() : null;
    let toDate = to && dateRegex.test(String(to).trim()) ? String(to).trim() : null;
    if (!fromDate || !toDate) {
      const end = new Date();
      end.setDate(end.getDate() - 1);
      const start = new Date(end);
      start.setDate(start.getDate() - 6);
      fromDate = start.toISOString().slice(0, 10);
      toDate = end.toISOString().slice(0, 10);
    }

    const systemToken = getSystemToken();
    const pageUrl = `https://graph.facebook.com/${META_API_VERSION}/${pageId}`;
    let igAccountId = null;
    let pageToken = null;
    const { token: pageTokenFirst } = await getPageAccessTokenSafe(pageId);
    if (pageTokenFirst) {
      try {
        const pageResFirst = await axios.get(pageUrl, {
          params: { access_token: pageTokenFirst, fields: "instagram_business_account{id}" },
          timeout: 10000,
        });
        if (pageResFirst.data?.instagram_business_account?.id) {
          igAccountId = pageResFirst.data.instagram_business_account.id;
          pageToken = pageTokenFirst;
        }
      } catch (_) {
        // ignore, fall back to system token
      }
    }
    if (!igAccountId) {
      try {
        const pageRes = await axios.get(pageUrl, {
          params: { access_token: systemToken, fields: "instagram_business_account{id}" },
          timeout: 10000,
        });
        igAccountId = pageRes.data?.instagram_business_account?.id;
      } catch (pageErr) {
        console.warn("[Instagram reach-by-follow-type] Page not accessible:", pageId, pageErr?.response?.data?.error?.message || pageErr.message);
        return res.status(200).json({
          data: {
            total_value: 0,
            follower_value: 0,
            non_follower_value: 0,
            followers_pct: 0,
            non_followers_pct: 0,
            name: "reach",
            period: "day",
            breakdown: "follow_type",
          },
          message: "Page not accessible with current token.",
        });
      }
    }
    if (!igAccountId) {
      return res.status(200).json({
        data: {
          total_value: 0,
          follower_value: 0,
          non_follower_value: 0,
          followers_pct: 0,
          non_followers_pct: 0,
          name: "reach",
          period: "day",
          breakdown: "follow_type",
        },
        message: "This page does not have a linked Instagram Business account.",
      });
    }
    if (!pageToken) {
      const { token: t, error: tokenError } = await getPageAccessTokenSafe(pageId);
      if (tokenError || !t) {
        console.warn("[Instagram reach-by-follow-type] Page token not available:", pageId, tokenError);
        return res.status(200).json({
          data: {
            total_value: 0,
            follower_value: 0,
            non_follower_value: 0,
            followers_pct: 0,
            non_followers_pct: 0,
            name: "reach",
            period: "day",
            breakdown: "follow_type",
          },
          message: "Page not accessible with current token.",
        });
      }
      pageToken = t;
    }
    const result = await fetchReachByFollowType(igAccountId, fromDate, toDate, pageToken);
    const total = result.total_value || 0;
    const followerVal = result.follower_value || 0;
    const nonFollowerVal = result.non_follower_value || 0;
    const followersPct = total > 0 ? Math.round((followerVal / total) * 100) : 0;
    const nonFollowersPct = total > 0 ? Math.round((nonFollowerVal / total) * 100) : 0;

    return res.json({
      data: {
        total_value: total,
        follower_value: followerVal,
        non_follower_value: nonFollowerVal,
        followers_pct: followersPct,
        non_followers_pct: nonFollowersPct,
        name: "reach",
        period: "day",
        breakdown: "follow_type",
      },
    });
  } catch (err) {
    const code = err?.response?.data?.error?.code;
    const msg = (err?.response?.data?.error?.message || err.message || "").toString();
    console.error("[Instagram reach-by-follow-type] Error:", code || err.message, msg);
    if (err.response?.status === 400) {
      return res.status(400).json({ error: "Bad request", details: msg });
    }
    if (code === 10 || code === "10" || msg.includes("(#10)") || msg.includes("pages_read_engagement") || msg.includes("Page Public Content Access") || msg.includes("Page Public Metadata Access")) {
      return res.status(200).json({
        data: {
          total_value: 0,
          follower_value: 0,
          non_follower_value: 0,
          followers_pct: 0,
          non_followers_pct: 0,
          name: "reach",
          period: "day",
          breakdown: "follow_type",
        },
        message: "Permission not available (pages_read_engagement). Returning empty data.",
      });
    }
    if (code === 190) {
      return res.status(401).json({ error: "Meta Access Token expired or invalid", details: msg, isAuthError: true });
    }
    if (code === 200) {
      return res.status(403).json({
        error: "Insufficient permissions for Instagram insights",
        details: msg,
        instruction: "Ensure Meta token has instagram_manage_insights or instagram_business_manage_insights",
      });
    }
    return res.status(500).json({
      error: "Failed to fetch Instagram reach by follow type",
      details: msg,
    });
  }
});

// ---------------------------------------------------------------------
// Facebook Page audience — demographics and follower count for Audience page when platform=Facebook
// GET /api/meta/facebook-page-audience?page_id=...&from=YYYY-MM-DD&to=YYYY-MM-DD
// ---------------------------------------------------------------------
router.get("/facebook-page-audience", optionalAuthMiddleware, async (req, res) => {
  try {
    const { page_id, from, to } = req.query;
    if (!page_id || String(page_id).trim() === "") {
      return res.status(400).json({
        error: "page_id is required",
        details: "Provide the Facebook Page ID.",
      });
    }
    const pageId = String(page_id).trim();
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    let fromDate = from && dateRegex.test(String(from).trim()) ? String(from).trim() : null;
    let toDate = to && dateRegex.test(String(to).trim()) ? String(to).trim() : null;
    if (!fromDate || !toDate) {
      const end = new Date();
      end.setDate(end.getDate() - 1);
      const start = new Date(end);
      start.setDate(start.getDate() - 6);
      fromDate = start.toISOString().slice(0, 10);
      toDate = end.toISOString().slice(0, 10);
    }

    const { token: accessToken, error: tokenError } = await getPageAccessTokenSafe(pageId);
    if (tokenError || !accessToken) {
      console.warn("[Facebook Page Audience] Page not accessible:", pageId, tokenError);
      return res.status(200).json({
        data: {
          follower_count: 0,
          follower_value: 0,
          non_follower_value: 0,
          total_value: 0,
          age_breakdown: [],
          gender_breakdown: [],
          city_breakdown: [],
          country_breakdown: [],
        },
        message: "Page not accessible with current token.",
      });
    }

    const since = fromDate;
    const until = toDate;

    // Try fetching a metric with multiple API versions and tokens
    const fetchMetricWithFallback = async (metric, period = "day") => {
      const apiVersions = [META_PAGE_INSIGHTS_API_VERSION, META_API_VERSION];
      let systemToken = null;
      try { systemToken = getSystemToken(); } catch (_) { /* no system token */ }
      const tokensToTry = [accessToken];
      if (systemToken && systemToken !== accessToken) tokensToTry.push(systemToken);

      const isLifetime = period === "lifetime";

      for (const apiVer of apiVersions) {
        for (const token of tokensToTry) {
          try {
            const url = `https://graph.facebook.com/${apiVer}/${pageId}/insights`;
            const params = { access_token: token, metric, period };
            if (!isLifetime) {
              params.since = since;
              params.until = until;
            }
            const { data } = await axios.get(url, {
              params,
              timeout: 15000,
              validateStatus: () => true,
            });
            if (data?.error) {
              console.warn(`[Facebook Page Audience] ${metric} failed (${apiVer}, period=${period}):`, data.error.message, "code:", data.error.code);
              continue;
            }
            if (data?.data?.length > 0) {
              console.log(`[Facebook Page Audience] ${metric} success (${apiVer}, period=${period})`);
              return data.data;
            }
          } catch (err) {
            console.warn(`[Facebook Page Audience] ${metric} exception (${apiVer}):`, err.message);
          }
        }
      }
      return [];
    };

    const fetchMediaViewByFollowers = async () => {
      const insightsUrl = `https://graph.facebook.com/${META_PAGE_INSIGHTS_API_VERSION}/${pageId}/insights`;
      try {
        const { data } = await axios.get(insightsUrl, {
          params: {
            access_token: accessToken,
            metric: "page_media_view",
            period: "day",
            since,
            until,
            breakdown: "is_from_followers",
          },
          timeout: 15000,
          validateStatus: () => true,
        });
        if (data?.error) {
          console.warn("[Facebook Page Audience] page_media_view+breakdown error:", data.error.message);
          return [];
        }
        return data.data || [];
      } catch (err) {
        console.warn("[Facebook Page Audience] page_media_view+breakdown exception:", err.message);
        return [];
      }
    };

    // page_fans_gender_age is deprecated in v18.0+; try alternatives in order
    const fetchGenderAgeData = async () => {
      const candidates = [
        { metric: "page_fans_gender_age", period: "lifetime" },
        { metric: "page_fans_gender_age", period: "day" },
        { metric: "page_impressions_by_age_gender_unique", period: "day" },
      ];
      for (const { metric, period } of candidates) {
        const result = await fetchMetricWithFallback(metric, period);
        if (result && result.length > 0) {
          const entry = result.find(m => m.name === metric);
          if (entry?.values?.length > 0) {
            const lastVal = entry.values[entry.values.length - 1]?.value;
            if (lastVal && typeof lastVal === "object" && Object.keys(lastVal).length > 0) {
              console.log(`[Facebook Page Audience] Using ${metric} (${period}) for age/gender data`);
              return result;
            }
          }
        }
      }
      return [];
    };

    const [fansData, cityData, countryData, genderAgeData, mediaViewData] = await Promise.all([
      fetchMetricWithFallback("page_follows"),
      fetchMetricWithFallback("page_follows_city"),
      fetchMetricWithFallback("page_follows_country"),
      fetchGenderAgeData(),
      fetchMediaViewByFollowers(),
    ]);

    let followerCount = 0;
    if (fansData && fansData.length > 0) {
      const metric = fansData.find((m) => m.name === "page_follows");
      if (metric && metric.values && metric.values.length > 0) {
        const last = metric.values[metric.values.length - 1];
        followerCount = parseInt(last.value || 0, 10) || 0;
      }
    }
    // Fallback: when Insights page_fans returns 0 or empty, get current follower count from Page node (fan_count / followers_count)
    if (followerCount === 0 && accessToken) {
      try {
        const pageUrl = `https://graph.facebook.com/${META_PAGE_INSIGHTS_API_VERSION}/${pageId}`;
        const { data: pageData } = await axios.get(pageUrl, {
          params: { access_token: accessToken, fields: "followers_count,fan_count" },
          timeout: 10000,
        });
        const fromFollowers = parseInt(pageData.followers_count || 0, 10) || parseInt(pageData.fan_count || 0, 10) || 0;
        if (fromFollowers > 0) followerCount = fromFollowers;
      } catch (pageErr) {
        if (pageErr?.response?.data?.error?.code !== 100) {
          console.warn("[Facebook Page Audience] Page node fallback for follower count failed:", pageErr?.response?.data?.error?.message || pageErr.message);
        }
      }
    }

    let followerValue = followerCount;
    let nonFollowerValue = 0;
    let totalValue = followerCount;
    if (mediaViewData && mediaViewData.length > 0) {
      let fromFollowersSum = 0;
      let fromNonFollowersSum = 0;
      mediaViewData.forEach((entry) => {
        const vals = entry.values || [];
        const b = entry.breakdowns || entry.breakdown || [];
        const bVal = Array.isArray(b) && b[0] ? (b[0].is_from_followers ?? b[0]["is_from_followers"]) : (b && b.is_from_followers);
        const nameMatch = (entry.name || "").match(/is_from_followers[=:]\s*(\w+)/i);
        const isFromFollowers = bVal !== undefined ? (bVal === "Yes" || bVal === true || String(bVal).toLowerCase() === "true") : (nameMatch && nameMatch[1] && /yes|true/i.test(nameMatch[1]));
        vals.forEach((v) => {
          const val = v.value;
          if (typeof val === "number") {
            if (isFromFollowers) fromFollowersSum += val;
            else fromNonFollowersSum += val;
          } else if (val && typeof val === "object" && !Array.isArray(val)) {
            Object.entries(val).forEach(([k, n]) => {
              const num = parseInt(n, 10) || 0;
              if (k === "Yes" || k === "true" || String(k).toLowerCase() === "yes" || k === "1") fromFollowersSum += num;
              else if (k === "No" || k === "false" || String(k).toLowerCase() === "no" || k === "0") fromNonFollowersSum += num;
            });
          }
        });
      });
      if (fromFollowersSum > 0 || fromNonFollowersSum > 0) {
        followerValue = fromFollowersSum;
        nonFollowerValue = fromNonFollowersSum;
        totalValue = fromFollowersSum + fromNonFollowersSum;
        if (followerValue === 0 && followerCount > 0 && nonFollowerValue > 0) {
          followerValue = followerCount;
          totalValue = followerCount + nonFollowerValue;
        }
      }
    }

    const city_breakdown = [];
    if (cityData && cityData.length > 0) {
      const metric = cityData.find((m) => m.name === "page_follows_city");
      if (metric && metric.values && metric.values.length > 0) {
        const last = metric.values[metric.values.length - 1];
        const val = last.value;
        if (val && typeof val === "object" && !Array.isArray(val)) {
          Object.entries(val).forEach(([city, count]) => {
            const n = parseInt(count, 10) || 0;
            if (city && n > 0) city_breakdown.push({ city, value: n });
          });
        }
      }
    }
    city_breakdown.sort((a, b) => (b.value || 0) - (a.value || 0));

    const country_breakdown = [];
    if (countryData && countryData.length > 0) {
      const metric = countryData.find((m) => m.name === "page_follows_country");
      if (metric && metric.values && metric.values.length > 0) {
        const last = metric.values[metric.values.length - 1];
        const val = last.value;
        if (val && typeof val === "object" && !Array.isArray(val)) {
          Object.entries(val).forEach(([country, count]) => {
            const n = parseInt(count, 10) || 0;
            if (country && n > 0) country_breakdown.push({ country, value: n });
          });
        }
      }
    }
    country_breakdown.sort((a, b) => (b.value || 0) - (a.value || 0));

    const age_breakdown = [];
    const gender_breakdown = [];
    if (genderAgeData && genderAgeData.length > 0) {
      const metric = genderAgeData.find((m) =>
        m.name === "page_fans_gender_age" || m.name === "page_impressions_by_age_gender_unique"
      );
      if (metric && metric.values && metric.values.length > 0) {
        const last = metric.values[metric.values.length - 1];
        const val = last.value;
        if (val && typeof val === "object" && !Array.isArray(val)) {
          const genderTotals = { M: 0, F: 0 };
          Object.entries(val).forEach(([key, count]) => {
            const n = parseInt(count, 10) || 0;
            if (!key || n === 0) return;
            const parts = String(key).split(".");
            const gender = parts[0] === "F" ? "female" : "male";
            const age = parts[1] || "";
            if (age) {
              genderTotals[parts[0] === "F" ? "F" : "M"] = (genderTotals[parts[0] === "F" ? "F" : "M"] || 0) + n;
              age_breakdown.push({ age, gender, value: n });
            }
          });
          gender_breakdown.push({ gender: "male", value: genderTotals.M });
          gender_breakdown.push({ gender: "female", value: genderTotals.F });
        }
      }
    }

    // Fallback: if Page Insights had no age/gender data, try the linked Instagram Business Account
    if (age_breakdown.length === 0) {
      try {
        const pageUrl = `https://graph.facebook.com/${META_API_VERSION}/${pageId}`;
        let igAccountId = null;
        const tokensToTry = [accessToken];
        let sysToken = null;
        try { sysToken = getSystemToken(); } catch (_) {}
        if (sysToken && sysToken !== accessToken) tokensToTry.push(sysToken);

        for (const tok of tokensToTry) {
          if (igAccountId) break;
          try {
            const { data: pgData } = await axios.get(pageUrl, {
              params: { access_token: tok, fields: "instagram_business_account{id}" },
              timeout: 10000, validateStatus: () => true,
            });
            if (pgData?.instagram_business_account?.id) {
              igAccountId = pgData.instagram_business_account.id;
            }
          } catch (_) {}
        }

        if (igAccountId) {
          console.log(`[Facebook Page Audience] Trying IG demographics fallback for page ${pageId}, IG account ${igAccountId}`);
          const igDemo = await fetchInstagramAudienceDemographics(igAccountId, accessToken, "this_month");
          if (igDemo.age_breakdown?.length > 0) {
            igDemo.age_breakdown.forEach(item => {
              age_breakdown.push({ age: item.age, gender: "combined", value: item.value });
            });
          }
          if (igDemo.gender_breakdown?.length > 0) {
            igDemo.gender_breakdown.forEach(item => {
              gender_breakdown.push({ gender: item.gender, value: item.value });
            });
          }
          if (age_breakdown.length > 0) {
            console.log(`[Facebook Page Audience] IG fallback success: ${age_breakdown.length} age items, ${gender_breakdown.length} gender items`);
          }
        }
      } catch (igErr) {
        console.warn("[Facebook Page Audience] IG demographics fallback failed:", igErr.message);
      }
    }

    const hasDemographics = age_breakdown.length > 0 || gender_breakdown.some(g => g.value > 0);
    console.log(`[Facebook Page Audience] page=${pageId} hasDemographics=${hasDemographics} ageItems=${age_breakdown.length} genderItems=${gender_breakdown.length}`);

    return res.json({
      data: {
        follower_count: followerCount,
        follower_value: followerValue,
        non_follower_value: nonFollowerValue,
        total_value: totalValue,
        age_breakdown,
        gender_breakdown,
        city_breakdown,
        country_breakdown,
        source: "facebook_page",
        demographics_available: hasDemographics,
      },
    });
  } catch (err) {
    const code = err?.response?.data?.error?.code;
    const msg = (err?.response?.data?.error?.message || err.message || "").toString();
    console.error("[Facebook Page Audience] Error:", code || err.message, msg);
    return res.status(500).json({
      error: "Failed to fetch Facebook Page audience",
      details: msg,
    });
  }
});

// ---------------------------------------------------------------------
// Instagram online_followers — best posting times (heatmap, peak hours, recommendation)
// GET /api/meta/instagram/online-followers?page_id=...
// Fetches metric=online_followers&period=lifetime, processes to best_times, peak_hours, heatmap_data, recommendation_text
// ---------------------------------------------------------------------
router.get("/instagram/online-followers", optionalAuthMiddleware, async (req, res) => {
  const emptyOnlineFollowers = () => processOnlineFollowersResponse({ data: [] });
  try {
    const { page_id } = req.query;
    if (!page_id || String(page_id).trim() === "") {
      return res.status(400).json({
        error: "page_id is required",
        details: "Provide the Facebook Page ID that has a linked Instagram Business account.",
      });
    }
    const pageId = String(page_id).trim();
    const systemToken = getSystemToken();
    const pageUrl = `https://graph.facebook.com/${META_API_VERSION}/${pageId}`;
    let igAccountId = null;
    let pageToken = null;
    const { token: pageTokenFirst } = await getPageAccessTokenSafe(pageId);
    if (pageTokenFirst) {
      try {
        const pageResFirst = await axios.get(pageUrl, {
          params: { access_token: pageTokenFirst, fields: "instagram_business_account{id}" },
          timeout: 10000,
        });
        if (pageResFirst.data?.instagram_business_account?.id) {
          igAccountId = pageResFirst.data.instagram_business_account.id;
          pageToken = pageTokenFirst;
        }
      } catch (_) {
        // ignore, fall back to system token
      }
    }
    if (!igAccountId) {
      try {
        const pageRes = await axios.get(pageUrl, {
          params: { access_token: systemToken, fields: "instagram_business_account{id}" },
          timeout: 10000,
        });
        igAccountId = pageRes.data?.instagram_business_account?.id;
      } catch (pageErr) {
        console.warn("[Instagram online-followers] Page not accessible:", pageId, pageErr?.response?.data?.error?.message || pageErr.message);
        return res.status(200).json({ ...emptyOnlineFollowers(), message: "Page not accessible with current token." });
      }
    }
    if (!igAccountId) {
      return res.status(200).json({
        ...emptyOnlineFollowers(),
        message: "This page does not have a linked Instagram Business account.",
      });
    }
    if (!pageToken) {
      const { token: t, error: tokenError } = await getPageAccessTokenSafe(pageId);
      if (t) {
        pageToken = t;
      } else {
        const systemTokenFallback = getSystemToken();
        if (systemTokenFallback) {
          pageToken = systemTokenFallback;
          console.warn("[Instagram online-followers] Using system token for page:", pageId, tokenError);
        }
      }
      if (!pageToken) {
        console.warn("[Instagram online-followers] Page token not available:", pageId, tokenError);
        return res.status(200).json({ ...emptyOnlineFollowers(), message: "Page not accessible with current token." });
      }
    }
    const raw = await fetchOnlineFollowers(igAccountId, pageToken);
    let result = processOnlineFollowersResponse(raw);
    if (result.is_sample_data && !result.message) {
      result.message = "Meta returned no online_followers data for this account.";
    }
    // When Meta returns no online_followers data, try fallback: best times from last 7 days media views
    if (result.is_sample_data) {
      try {
        const endDate = new Date();
        endDate.setUTCDate(endDate.getUTCDate() - 1);
        const startDate = new Date(endDate);
        startDate.setUTCDate(startDate.getUTCDate() - 6);
        const to = endDate.toISOString().slice(0, 10);
        const from = startDate.toISOString().slice(0, 10);
        const mediaResult = await fetchInstagramMediaInsights({
          pageIds: [pageId],
          getPageToken: getPageAccessToken,
          from,
          to,
          contentType: "all",
        });
        const mediaList = mediaResult?.media || [];
        const timezone = (req.query.timezone && String(req.query.timezone).trim()) || "UTC";
        const fallback = buildBestTimesFromMediaViews(mediaList, { timezone });
        if (fallback && (fallback.best_times?.length > 0 || fallback.heatmap_data?.some((d) => d.value > 0))) {
          result = { ...fallback, is_sample_data: false };
        }
      } catch (fallbackErr) {
        console.warn("[Instagram online-followers] Fallback from media views failed:", fallbackErr?.message || fallbackErr);
      }
    }
    return res.json(result);
  } catch (err) {
    const code = err?.response?.data?.error?.code;
    const msg = (err?.response?.data?.error?.message || err.message || "").toString();
    console.error("[Instagram online-followers] Error:", code || err.message, msg);
    if (err.response?.status === 400) {
      return res.status(400).json({ error: "Bad request", details: msg });
    }
    if (code === 10 || code === "10" || msg.includes("(#10)") || msg.includes("pages_read_engagement") || msg.includes("Page Public Content Access") || msg.includes("Page Public Metadata Access")) {
      return res.status(200).json({ ...emptyOnlineFollowers(), message: "Permission not available (pages_read_engagement). Returning empty data." });
    }
    if (code === 190) {
      return res.status(401).json({ error: "Meta Access Token expired or invalid", details: msg, isAuthError: true });
    }
    if (code === 200) {
      return res.status(403).json({
        error: "Insufficient permissions for Instagram insights",
        details: msg,
        instruction: "Ensure Meta token has instagram_manage_insights or instagram_business_manage_insights",
      });
    }
    return res.status(500).json({
      error: "Failed to fetch Instagram online followers",
      details: msg,
    });
  }
});

// ---------------------------------------------------------------------
// 5.2) FORMS API - Fetch leadgen forms for a page
//    GET /api/meta/pages/:pageId/forms
//    Uses Page Access Token (required by Meta's leadgen_forms API)
// ---------------------------------------------------------------------
router.get("/pages/:pageId/forms", optionalAuthMiddleware, async (req, res) => {
  try {
    const { pageId } = req.params;
    
    // Meta's leadgen_forms API requires a Page Access Token, not a System User Token
    const pageAccessToken = await getPageAccessToken(pageId);
    const formsUrl = `https://graph.facebook.com/${META_API_VERSION}/${pageId}/leadgen_forms`;
    
    const params = {
      access_token: pageAccessToken,
      fields: "id,name,locale,status",
      limit: 1000,
    };

    const { data } = await axios.get(formsUrl, { params });
    
    const forms = data.data || [];

    res.json({ data: forms });
  } catch (err) {
    console.error("Error fetching forms:", err.response?.data || err.message);
    
    const errorData = err.response?.data?.error;
    const errorCode = errorData?.code;
    const errorMsg = errorData?.message || err.message;

    // Handle token expiration (190)
    if (errorCode === 190) {
      // Clear cache for this page
      if (pageTokenCache.tokens[req.params.pageId]) {
        delete pageTokenCache.tokens[req.params.pageId];
      }
      return res.status(401).json({
        error: "Meta Access Token expired or invalid",
        details: errorMsg,
        isAuthError: true,
        instruction: "Please update META_SYSTEM_ACCESS_TOKEN in server/.env"
      });
    }

    // Handle permission errors (200, 10)
    if (errorCode === 200) {
      return res.status(403).json({
        error: "Permission error",
        details: errorMsg,
        instruction: "Ensure your System User Token has 'leads_retrieval' and 'pages_read_engagement' permissions"
      });
    }

    if (errorCode === 10) {
      return res.status(403).json({
        error: "Permission denied",
        details: errorMsg,
        instruction: "Check that your System User Token has access to this page and required permissions"
      });
    }

    res.status(500).json({
      error: "Failed to fetch forms",
      details: err.response?.data || err.message,
    });
  }
});

// ---------------------------------------------------------------------
// 5.2.1) FORMS BY AD API - Fetch forms that received leads from a specific ad
//    GET /api/meta/forms?adId=xxx&start=YYYY-MM-DD&end=YYYY-MM-DD
//    
//    Implementation: Derive forms from leads (Meta doesn't support "get forms by ad")
//    1. Fetch all leads in date range
//    2. Filter leads WHERE lead.ad_id === adId
//    3. Collect unique form_ids from filtered leads
//    4. Fetch form names for each form_id
//    5. Return list of forms
//    
//    Uses META_SYSTEM_ACCESS_TOKEN
// ---------------------------------------------------------------------
router.get("/forms", optionalAuthMiddleware, async (req, res) => {
  try {
    const { adId, start, end, pageId } = req.query;
    
    // Validate required parameters
    if (!adId || adId.trim() === "") {
      return res.status(400).json({
        error: "adId parameter is required",
        message: "Please provide an adId to fetch forms"
      });
    }

    // Validate date format if provided
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    let dateFrom = start;
    let dateTo = end;

    // Default to last 30 days if dates not provided
    if (!dateFrom || !dateTo || !dateRegex.test(dateFrom) || !dateRegex.test(dateTo)) {
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - 29);
      dateFrom = startDate.toISOString().slice(0, 10);
      dateTo = endDate.toISOString().slice(0, 10);
    }

    // Check for pre-loaded data first
    if (pageId) {
      const preloadCacheKey = `preload_${pageId}_${dateFrom}_${dateTo}`;
      const now = Date.now();
      if (preloadLeadsCache.data[preloadCacheKey] && preloadLeadsCache.lastFetched[preloadCacheKey] &&
          (now - preloadLeadsCache.lastFetched[preloadCacheKey]) < preloadLeadsCache.ttl) {
        const preloadedData = preloadLeadsCache.data[preloadCacheKey];
        const leads = preloadedData.leads || [];
        const forms = preloadedData.forms || [];
        
        // Normalize adId to string for comparison
        const normalizedAdId = String(adId);
        
        // Filter leads by adId - both sides normalized to strings
        const matchingLeads = leads.filter(lead => {
          if (!lead.ad_id) return false;
          const leadAdId = String(lead.ad_id);
          return leadAdId === normalizedAdId;
        });
        
        // Get unique form_ids from matching leads
        const formIds = [...new Set(matchingLeads.map(lead => lead.form_id).filter(Boolean))];
        
        // Map to forms with names from preloaded forms or from lead's form_name
        const formsList = formIds.map(formId => {
          // First try to find in preloaded forms list
          let form = forms.find(f => String(f.form_id) === String(formId));
          
          // If not found, try to get form name from lead's form_name
          if (!form) {
            const leadWithForm = matchingLeads.find(l => String(l.form_id) === String(formId));
            if (leadWithForm && leadWithForm.form_name) {
              form = { form_id: formId, name: leadWithForm.form_name };
            }
          }
          
          return {
            form_id: formId,
            name: form?.name || `Form ${formId}`
          };
        });
        
        // Cache the result for future use
        const cacheKey = `${adId}_${dateFrom}_${dateTo}`;
        formsCache.data[cacheKey] = formsList;
        formsCache.lastFetched[cacheKey] = now;
        
        return res.json({ data: formsList, cached: false, fromPreload: true });
      }
    }

    // Check cache
    const cacheKey = `${adId}_${dateFrom}_${dateTo}`;
    const now = Date.now();
    if (formsCache.data[cacheKey] && formsCache.lastFetched[cacheKey] && 
        (now - formsCache.lastFetched[cacheKey]) < formsCache.ttl) {
      return res.json({ data: formsCache.data[cacheKey], cached: true });
    }

    const accessToken = getSystemToken();
    const credentials = getCredentials();

    // Step 1: Fetch all accessible pages and their forms
    let pages = [];
    try {
      const pagesResponse = await axios.get(
        `https://graph.facebook.com/${META_API_VERSION}/me/accounts`,
        { params: { access_token: accessToken, fields: "id", limit: 1000 } }
      );
      pages = (pagesResponse.data.data || []).map(p => p.id);
    } catch (pagesErr) {
      console.error(`[Forms by Ad] Error fetching pages:`, pagesErr.response?.data || pagesErr.message);
      return res.json({ data: [], cached: false });
    }

    if (pages.length === 0) {
      
      formsCache.data[cacheKey] = [];
      formsCache.lastFetched[cacheKey] = now;
      return res.json({ data: [], cached: false });
    }

    // Step 2: Fetch all forms from all pages using Page Access Tokens
    // Meta's leadgen_forms API requires a Page Access Token, not a System User Token
    const allForms = [];
    const formPromises = pages.map(async (pageId) => {
      try {
        // Get Page Access Token for this page
        const pageAccessToken = await getPageAccessToken(pageId);
        const response = await axios.get(`https://graph.facebook.com/${META_API_VERSION}/${pageId}/leadgen_forms`, {
          params: {
            access_token: pageAccessToken,
            fields: "id,page_id",
            limit: 1000
          }
        });
        // Add page_id to each form for later use
        return (response.data.data || []).map(form => ({ ...form, page_id: pageId }));
      } catch (err) {
        const errorData = err.response?.data?.error;
        const errorCode = errorData?.code;
        
        // Handle token errors
        if (errorCode === 190) {
          // Clear cache for this page
          if (pageTokenCache.tokens[pageId]) {
            delete pageTokenCache.tokens[pageId];
          }
          console.warn(`[Forms by Ad] Token expired for page ${pageId}:`, errorData?.message || err.message);
        } else if (errorCode === 200 || errorCode === 10) {
          console.warn(`[Forms by Ad] Permission error for page ${pageId}:`, errorData?.message || err.message);
        } else {
          console.warn(`[Forms by Ad] Error fetching forms for page ${pageId}:`, err.message);
        }
        return [];
      }
    });

    const allFormsArrays = await Promise.all(formPromises);
    allForms.push(...allFormsArrays.flat());
    

    // Step 3: Fetch leads from all forms in the date range
    const startDate = new Date(dateFrom);
    startDate.setHours(0, 0, 0, 0);
    const endDate = new Date(dateTo);
    endDate.setHours(23, 59, 59, 999);

    const formIdsWithLeads = new Set();
    const leadPromises = allForms.map(async (form) => {
      try {
        // Meta's /leads API requires a Page Access Token for the form's page
        const formPageId = form.page_id;
        if (!formPageId) {
          console.warn(`[Forms by Ad] Form ${form.id} has no page_id, skipping`);
          return;
        }
        
        const pageAccessToken = await getPageAccessToken(formPageId);
        const leadsUrl = `https://graph.facebook.com/${META_API_VERSION}/${form.id}/leads`;
        const leadsResponse = await axios.get(leadsUrl, {
          headers: { Authorization: `Bearer ${pageAccessToken}` },
          params: {
            fields: "id,created_time,ad_id",
            limit: 1000 // Fetch enough to find matches
          }
        });

        const leads = leadsResponse.data.data || [];
        
        // Filter leads by date range and ad_id
        for (const lead of leads) {
          // Check date range
          if (lead.created_time) {
            const leadDate = new Date(lead.created_time);
            if (leadDate < startDate || leadDate > endDate) {
              continue;
            }
          }

          // Check if lead has ad_id and matches the requested adId
          // Note: Meta Leads API may not always return ad_id - we'll check if it exists
          if (lead.ad_id && lead.ad_id === adId) {
            formIdsWithLeads.add(form.id);
            
          }
        }
      } catch (leadErr) {
        const errorData = leadErr.response?.data?.error;
        const errorCode = errorData?.code;
        const errorMsg = errorData?.message || leadErr.message;
        
        // Handle token errors
        if (errorCode === 190) {
          // Clear cache for this page
          const formPageId = form.page_id;
          if (formPageId && pageTokenCache.tokens[formPageId]) {
            delete pageTokenCache.tokens[formPageId];
          }
          console.warn(`[Forms by Ad] Token expired while fetching leads for form ${form.id}:`, errorMsg);
        } else if (errorCode === 200 || errorCode === 10) {
          console.warn(`[Forms by Ad] Permission error while fetching leads for form ${form.id}:`, errorMsg);
        } else {
          // Skip forms that can't be accessed - non-fatal
          console.warn(`[Forms by Ad] Error checking leads for form ${form.id}:`, errorMsg);
        }
        // Continue to next form
      }
    });

    await Promise.all(leadPromises);

    // If no forms found via ad_id matching, try alternative approach:
    // Use Insights API to verify ad has leads, then return all forms from pages that have leads in date range
    if (formIdsWithLeads.size === 0) {
     
      
      // Check if ad has leads via Insights API
      let accountId = credentials.adAccountId;
      if (accountId && accountId.startsWith('act_')) {
        accountId = accountId.substring(4);
      }

      try {
        const insightsUrl = `https://graph.facebook.com/${META_API_VERSION}/act_${accountId}/insights`;
        const timeRange = JSON.stringify({ since: dateFrom, until: dateTo });
        
        const insightsResponse = await axios.get(insightsUrl, {
          params: {
            access_token: credentials.accessToken,
            level: "ad",
            fields: "ad_id,actions",
            filtering: JSON.stringify([{ field: "ad.id", operator: "IN", value: [adId] }]),
            time_range: timeRange,
            limit: 1
          }
        });

        const insightsData = insightsResponse.data.data || [];
        const hasLeads = insightsData.length > 0 && insightsData[0].actions?.some(
          action => action.action_type === 'lead' || action.action_type === 'onsite_conversion.lead_grouped'
        );

        if (!hasLeads) {
         
          formsCache.data[cacheKey] = [];
          formsCache.lastFetched[cacheKey] = now;
          return res.json({ data: [], cached: false });
        }

        // If ad has leads but we couldn't match via ad_id, return all forms that have leads in date range
        // This is a fallback when ad_id attribution is not available in Leads API
        for (const form of allForms) {
          try {
            const leadsUrl = `https://graph.facebook.com/${META_API_VERSION}/${form.id}/leads`;
            const leadsResponse = await axios.get(leadsUrl, {
              headers: { Authorization: `Bearer ${accessToken}` },
              params: {
                fields: "id,created_time",
                limit: 1000
              }
            });

            const leads = leadsResponse.data.data || [];
            const hasLeadsInRange = leads.some(lead => {
              if (!lead.created_time) return false;
              const leadDate = new Date(lead.created_time);
              return leadDate >= startDate && leadDate <= endDate;
            });

            if (hasLeadsInRange) {
              formIdsWithLeads.add(form.id);
            }
          } catch (err) {
            // Skip forms with errors
            continue;
          }
        }
      } catch (insightsErr) {
        console.warn(`[Forms by Ad] Error with Insights API fallback:`, insightsErr.message);
      }
    }

    if (formIdsWithLeads.size === 0) {
     
      formsCache.data[cacheKey] = [];
      formsCache.lastFetched[cacheKey] = now;
      return res.json({ data: [], cached: false });
    }

    // Step 4: Fetch form names for each form_id
    const formsList = [];
    for (const formId of formIdsWithLeads) {
      try {
        const formResponse = await axios.get(
          `https://graph.facebook.com/${META_API_VERSION}/${formId}`,
          { params: { access_token: accessToken, fields: "name" } }
        );
        formsList.push({
          form_id: formId,
          name: formResponse.data.name || `Form ${formId}`
        });
      } catch (formErr) {
        console.warn(`[Forms by Ad] Error fetching form ${formId} name:`, formErr.message);
        // Include form anyway with ID as name
        formsList.push({
          form_id: formId,
          name: `Form ${formId}`
        });
      }
    }

   

    // Cache the result
    formsCache.data[cacheKey] = formsList;
    formsCache.lastFetched[cacheKey] = now;

    res.json({ data: formsList, cached: false });
  } catch (err) {
    console.error("[Forms by Ad] Error:", err.response?.data || err.message);
    
    if (err.response?.data?.error?.code === 190) {
      return res.status(401).json({
        error: "Meta Access Token expired or invalid",
        details: err.response.data.error.message,
        isAuthError: true,
        instruction: "Please update META_SYSTEM_ACCESS_TOKEN in server/.env"
      });
    }

    res.status(500).json({
      error: "Failed to fetch forms",
      details: err.response?.data || err.message,
    });
  }
});

// ---------------------------------------------------------------------
// 5.2.1) PAGE INSIGHTS API - Fetch page insights (followers, reach, etc.)
//    GET /api/meta/pages/:pageId/insights
//    Uses Page Access Token (required by Meta for this endpoint)
// ---------------------------------------------------------------------
router.get("/pages/:pageId/insights", optionalAuthMiddleware, async (req, res) => {
  const emptyPageInsights = (since, until) => ({
    followers: [],
    reach: [],
    impressions: [],
    clicks: [],
    fan_adds: [],
    fan_removes: [],
    views: [],
    interactions: [],
    current_followers: 0,
    current_reach: 0,
    total_follows: 0,
    total_unfollows: 0,
    total_reached: 0,
    total_views: 0,
    total_interactions: 0,
    period: `${since} to ${until}`,
  });
  try {
    const { pageId } = req.params;
    const { from, to, metric } = req.query;

    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    let since = null;
    let until = null;
    if (from && to && dateRegex.test(from) && dateRegex.test(to)) {
      since = from;
      until = to;
    }
    if (!since || !until) {
      const today = new Date();
      const thirtyDaysAgo = new Date(today);
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      until = today.toISOString().split('T')[0];
      since = thirtyDaysAgo.toISOString().split('T')[0];
    }

    const { token: accessToken, error: tokenError } = await getPageAccessTokenSafe(pageId);
    if (tokenError || !accessToken) {
      console.warn("[Page Insights] Page not accessible:", pageId, tokenError);
      return res.status(200).json({
        data: emptyPageInsights(since, until),
        message: "Page not accessible with current token. Add this page in Meta Business Suite or select a page your app can access.",
      });
    }
    
    // Page Insights API: use multiple small requests so one deprecated/invalid metric doesn't fail the whole response.
    const insightsUrl = `https://graph.facebook.com/${META_PAGE_INSIGHTS_API_VERSION}/${pageId}/insights`;
    const periodLabel = `${since} to ${until}`;

    const fetchOneMetricSet = async (metricsString) => {
      try {
        const params = {
          access_token: accessToken,
          metric: metricsString,
          period: "day",
          since,
          until,
        };
        const { data } = await axios.get(insightsUrl, { params });
        return data.data || [];
      } catch (err) {
        const code = err?.response?.data?.error?.code;
        if (code === 100) {
          console.warn("[Page Insights] Metric set not supported:", metricsString, err?.response?.data?.error?.message);
        }
        return [];
      }
    };

    const mergeProcessedData = (base, next) => {
      const out = { ...base };
      if (next.total_reached > 0) {
        out.total_reached = next.total_reached;
        if (next.reach && next.reach.length) out.reach = next.reach;
      }
      if (next.current_reach > 0) out.current_reach = next.current_reach;
      if (next.total_views > 0) {
        out.total_views = next.total_views;
        if (next.views && next.views.length) out.views = next.views;
      }
      if (next.total_follows > 0 || next.fan_adds?.length) {
        out.total_follows = next.total_follows;
        if (next.fan_adds?.length) out.fan_adds = next.fan_adds;
      }
      if (next.total_unfollows > 0 || next.fan_removes?.length) {
        out.total_unfollows = next.total_unfollows;
        if (next.fan_removes?.length) out.fan_removes = next.fan_removes;
      }
      if (next.total_interactions > 0) {
        out.total_interactions = next.total_interactions;
        if (next.interactions?.length) out.interactions = next.interactions;
      }
      if (next.clicks?.length) out.clicks = next.clicks;
      if (next.current_followers > 0) out.current_followers = next.current_followers;
      if (next.impressions?.length) out.impressions = next.impressions;
      if (next.followers?.length) out.followers = next.followers;
      return out;
    };

    // Derive follows/unfollows from daily page_follows (follower count) when direct metrics are deprecated
    const deriveFollowsUnfollowsFromDailyCount = (followersArray) => {
      if (!Array.isArray(followersArray) || followersArray.length < 2) {
        return { fan_adds: [], fan_removes: [], total_follows: 0, total_unfollows: 0 };
      }
      const sorted = [...followersArray].sort((a, b) => (a.date || '').localeCompare(b.date || ''));
      const fan_adds = [];
      const fan_removes = [];
      let total_follows = 0;
      let total_unfollows = 0;
      for (let i = 1; i < sorted.length; i++) {
        const prev = parseInt(sorted[i - 1].value || 0);
        const curr = parseInt(sorted[i].value || 0);
        const date = sorted[i].date || null;
        if (!date) continue;
        const delta = curr - prev;
        if (delta > 0) {
          fan_adds.push({ date, value: delta });
          total_follows += delta;
        } else if (delta < 0) {
          fan_removes.push({ date, value: -delta });
          total_unfollows += -delta;
        }
      }
      return { fan_adds, fan_removes, total_follows, total_unfollows };
    };
    
    // Helper to process insights response into totals
    const processInsights = (insightsData, periodLabel) => {
      const processedData = {
        followers: [],
        reach: [],
        impressions: [],
        clicks: [],
        fan_adds: [],
        fan_removes: [],
        views: [],
        interactions: [],
        current_followers: 0,
        current_reach: 0,
        total_follows: 0,      // Total follows (page_fan_adds sum)
        total_unfollows: 0,    // Total unfollows (page_fan_removes sum)
        total_reached: 0,      // Total reached (page_impressions_unique sum)
        total_views: 0,        // Total views (page_views_total)
        total_interactions: 0, // Total interactions (page_engaged_users)
        period: periodLabel
      };
      
      insightsData.forEach(metric => {
        const metricName = metric.name;
        const values = metric.values || [];
        
        if (metricName === 'page_fans' || metricName === 'page_follows') {
          if (values.length > 0) {
            processedData.current_followers = parseInt(values[values.length - 1].value || 0);
          }
          processedData.followers = values.map(v => ({
            date: v.end_time ? v.end_time.split('T')[0] : null,
            value: parseInt(v.value || 0)
          })).filter(v => v.date);
        } else if (metricName === 'page_reach') {
          let totalReach = 0;
          const reachByDate = {};
          values.forEach(v => {
            const date = v.end_time ? v.end_time.split('T')[0] : null;
            if (date) {
              if (!reachByDate[date]) {
                reachByDate[date] = 0;
              }
              reachByDate[date] += parseInt(v.value || 0);
              totalReach += parseInt(v.value || 0);
            }
          });
          processedData.reach = Object.entries(reachByDate).map(([date, value]) => ({
            date,
            value
          })).sort((a, b) => a.date.localeCompare(b.date));
          processedData.current_reach = totalReach;
          if (processedData.total_reached === 0) {
            processedData.total_reached = totalReach;
          }
        } else if (metricName === 'page_impressions_unique') {
          let totalReached = 0;
          values.forEach(v => {
            totalReached += parseInt(v.value || 0);
          });
          processedData.total_reached = totalReached;
          processedData.current_reach = totalReached;
          processedData.reach = values.map(v => ({
            date: v.end_time ? v.end_time.split('T')[0] : null,
            value: parseInt(v.value || 0)
          })).filter(v => v.date);
        } else if (metricName === 'page_impressions' || metricName === 'page_media_view') {
          processedData.impressions = values.map(v => ({
            date: v.end_time ? v.end_time.split('T')[0] : null,
            value: parseInt(v.value || 0)
          })).filter(v => v.date);
          let mediaSum = 0;
          values.forEach(v => { mediaSum += parseInt(v.value || 0); });
          if (processedData.total_reached === 0) {
            processedData.total_reached = mediaSum;
          }
          // Use page_media_view (content played/displayed) for Views card when page_views not available
          if (processedData.total_views === 0 && mediaSum > 0) {
            processedData.total_views = mediaSum;
            processedData.views = processedData.impressions;
          }
        } else if (metricName === 'page_fan_adds') {
          let totalFollows = 0;
          processedData.fan_adds = values.map(v => {
            const value = parseInt(v.value || 0);
            totalFollows += value;
            return {
              date: v.end_time ? v.end_time.split('T')[0] : null,
              value: value
            };
          }).filter(v => v.date);
          processedData.total_follows = totalFollows;
        } else if (metricName === 'page_fan_removes') {
          let totalUnfollows = 0;
          processedData.fan_removes = values.map(v => {
            const value = parseInt(v.value || 0);
            totalUnfollows += value;
            return {
              date: v.end_time ? v.end_time.split('T')[0] : null,
              value: value
            };
          }).filter(v => v.date);
          processedData.total_unfollows = totalUnfollows;
        } else if (metricName === 'page_daily_follows') {
          let totalFollows = 0;
          processedData.fan_adds = values.map(v => {
            const value = parseInt(v.value || 0);
            totalFollows += value;
            return {
              date: v.end_time ? v.end_time.split('T')[0] : null,
              value: value
            };
          }).filter(v => v.date);
          processedData.total_follows = totalFollows;
        } else if (metricName === 'page_daily_unfollows_unique') {
          let totalUnfollows = 0;
          processedData.fan_removes = values.map(v => {
            const value = parseInt(v.value || 0);
            totalUnfollows += value;
            return {
              date: v.end_time ? v.end_time.split('T')[0] : null,
              value: value
            };
          }).filter(v => v.date);
          processedData.total_unfollows = totalUnfollows;
        } else if (metricName === 'page_views') {
          let totalViews = 0;
          processedData.views = values.map(v => {
            const value = parseInt(v.value || 0);
            totalViews += value;
            return {
              date: v.end_time ? v.end_time.split('T')[0] : null,
              value
            };
          }).filter(v => v.date);
          processedData.total_views = totalViews;
        } else if (metricName === 'page_consumptions') {
          let totalInteractions = 0;
          const clicksArr = values.map(v => {
            const value = parseInt(v.value || 0);
            totalInteractions += value;
            return {
              date: v.end_time ? v.end_time.split('T')[0] : null,
              value
            };
          }).filter(v => v.date);
          processedData.interactions = clicksArr;
          processedData.clicks = clicksArr;
          processedData.total_interactions = totalInteractions;
        } else if (metricName === 'page_post_engagements') {
          let totalInteractions = 0;
          processedData.interactions = values.map(v => {
            const value = parseInt(v.value || 0);
            totalInteractions += value;
            return {
              date: v.end_time ? v.end_time.split('T')[0] : null,
              value
            };
          }).filter(v => v.date);
          processedData.total_interactions = totalInteractions;
        }
      });
      
      return processedData;
    };
    
    // Fetch current period insights: multiple small requests, then merge (so one bad metric doesn't fail all).
    let processedData;
    if (metric) {
      const insightsData = await fetchOneMetricSet(metric);
      processedData = processInsights(insightsData.length ? insightsData : [], periodLabel);
    } else {
      const [reachViewsData, followsData, interactionsData, consumptionsData] = await Promise.all([
        fetchOneMetricSet("page_media_view,page_impressions_unique"),
        fetchOneMetricSet("page_daily_follows,page_daily_unfollows_unique,page_follows"),
        fetchOneMetricSet("page_post_engagements"),
        fetchOneMetricSet("page_consumptions"),
      ]);
      processedData = processInsights([], periodLabel);
      if (reachViewsData.length) {
        processedData = mergeProcessedData(processedData, processInsights(reachViewsData, periodLabel));
      }
      if (followsData.length) {
        processedData = mergeProcessedData(processedData, processInsights(followsData, periodLabel));
      }
      if (interactionsData.length) {
        processedData = mergeProcessedData(processedData, processInsights(interactionsData, periodLabel));
      }
      if (consumptionsData.length) {
        processedData = mergeProcessedData(processedData, processInsights(consumptionsData, periodLabel));
      }
      if ((processedData.total_follows === 0 && processedData.total_unfollows === 0) || !followsData.length) {
        const pageFollowsDaily = await fetchOneMetricSet("page_follows");
        if (pageFollowsDaily.length) {
          const processed = processInsights(pageFollowsDaily, periodLabel);
          if (processed.followers && processed.followers.length >= 2) {
            const derived = deriveFollowsUnfollowsFromDailyCount(processed.followers);
            if (derived.total_follows > 0 || derived.total_unfollows > 0) {
              processedData.total_follows = derived.total_follows;
              processedData.total_unfollows = derived.total_unfollows;
              if (derived.fan_adds.length) processedData.fan_adds = derived.fan_adds;
              if (derived.fan_removes.length) processedData.fan_removes = derived.fan_removes;
            }
          }
          if (processed.current_followers > 0) processedData.current_followers = processed.current_followers;
        }
      }
      if (processedData.total_reached === 0 && processedData.total_views === 0) {
        const fallback = await fetchOneMetricSet("page_impressions");
        if (fallback.length) {
          processedData = mergeProcessedData(processedData, processInsights(fallback, periodLabel));
        }
      }
    }

    // Fetch previous period for change calculations
    const startDate = new Date(since);
    const endDate = new Date(until);
    const diffDays = Math.max(1, Math.round((endDate - startDate) / (1000 * 60 * 60 * 24)));
    const prevUntilDate = new Date(startDate);
    prevUntilDate.setDate(prevUntilDate.getDate() - 1);
    const prevSinceDate = new Date(prevUntilDate);
    prevSinceDate.setDate(prevSinceDate.getDate() - diffDays);
    const prevSince = prevSinceDate.toISOString().split('T')[0];
    const prevUntil = prevUntilDate.toISOString().split('T')[0];

   
    res.json({ data: processedData });
  } catch (err) {
    const metaError = err.response?.data?.error;
    const errDetails = typeof metaError?.message === 'string'
      ? metaError.message
      : (typeof err.response?.data === 'object' ? JSON.stringify(err.response.data) : String(err.response?.data || err.message));
    console.error("Error fetching page insights:", err.response?.data || err.message);

    if (!err.response && err.message) {
      return res.status(503).json({
        error: "Could not obtain Page Access Token",
        details: err.message,
        isAuthError: false,
        instruction: "Ensure META_SYSTEM_ACCESS_TOKEN is valid so the server can fetch the page token from Meta."
      });
    }

    if (metaError?.code === 190) {
      return res.status(401).json({
        error: "Meta Access Token expired or invalid",
        details: metaError.message || errDetails,
        isAuthError: true,
        instruction: "Please update META_SYSTEM_ACCESS_TOKEN in server/.env so the server can obtain a Page Access Token."
      });
    }

    if (metaError?.code === 200) {
      return res.status(403).json({
        error: "Insufficient permissions",
        details: metaError.message || errDetails,
        isPermissionError: true,
        instruction: "Please ensure your Meta Access Token has 'pages_read_engagement' permission"
      });
    }

    if (metaError?.code === 100) {
      return res.status(400).json({
        error: "Invalid insights metric",
        details: metaError.message || "Some requested metrics are deprecated or invalid for this Page.",
        isPermissionError: false,
        instruction: "This error is from the Page Insights API (for the selected PAGE), not Ad Account. Ad Account insights (act_XXX/insights with impressions, reach, spend, breakdowns) use a different endpoint and are used for Age & Gender / Top Countries. For Page performance we try page_follows, page_media_view, then page_impressions. If all fail, the Page may not support these metrics or token may need pages_read_engagement."
      });
    }

    res.status(500).json({
      error: "Failed to fetch page insights",
      details: errDetails,
    });
  }
});

// ---------------------------------------------------------------------
// 5.2.2) FACEBOOK CONTENT INSIGHTS - Same shape as Instagram for Best Reel page
//    GET /api/meta/facebook/content-insights?pageId=...&from=YYYY-MM-DD&to=YYYY-MM-DD
//    Returns: total_views, total_reached, total_interactions, daily_views_engagements, daily_subscriber_change
// ---------------------------------------------------------------------
router.get("/facebook/content-insights", optionalAuthMiddleware, async (req, res) => {
  try {
    const { pageId, from, to } = req.query;
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!pageId || !from || !to || !dateRegex.test(from) || !dateRegex.test(to)) {
      return res.status(400).json({ error: "pageId, from, and to (YYYY-MM-DD) are required" });
    }
    const baseUrl = `${req.protocol}://${req.get("host")}`;
    const authHeader = req.get("Authorization");
    const headers = authHeader ? { Authorization: authHeader } : {};
    const insightsRes = await axios.get(
      `${baseUrl}/api/meta/pages/${encodeURIComponent(pageId)}/insights?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      { headers, validateStatus: () => true, timeout: 20000 }
    );
    const raw = insightsRes.data?.data;
    if (insightsRes.status !== 200 || !raw) {
      return res.status(insightsRes.status === 200 ? 502 : insightsRes.status).json({
        error: "Failed to load Facebook page insights",
        details: insightsRes.data?.message || insightsRes.data?.error || "No data returned",
      });
    }
    const formatChartDate = (dateStr) => {
      const d = new Date(dateStr + "T00:00:00Z");
      const day = d.getUTCDate();
      const mon = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getUTCMonth()];
      return `${String(day).padStart(2, "0")} ${mon}`;
    };
    const byDate = {};
    (raw.views || []).forEach((v) => {
      const d = v.date;
      if (!d) return;
      if (!byDate[d]) byDate[d] = { date: formatChartDate(d), views: 0, eng: 0 };
      byDate[d].views += Number(v.value) || 0;
    });
    (raw.interactions || []).forEach((v) => {
      const d = v.date;
      if (!d) return;
      if (!byDate[d]) byDate[d] = { date: formatChartDate(d), views: 0, eng: 0 };
      byDate[d].eng += Number(v.value) || 0;
    });
    const daily_views_engagements = Object.keys(byDate)
      .sort()
      .map((k) => byDate[k]);
    const subByDate = {};
    (raw.fan_adds || []).forEach((v) => {
      const d = v.date;
      if (!d) return;
      subByDate[d] = (subByDate[d] || 0) + (Number(v.value) || 0);
    });
    (raw.fan_removes || []).forEach((v) => {
      const d = v.date;
      if (!d) return;
      subByDate[d] = (subByDate[d] || 0) - (Number(v.value) || 0);
    });
    const daily_subscriber_change = Object.keys(subByDate)
      .sort()
      .map((k) => ({ date: formatChartDate(k), val: subByDate[k] }));
    const total_views = raw.total_views || 0;
    const total_reached = raw.total_reached || 0;
    const total_interactions = raw.total_interactions || 0;
    res.json({
      totalViews: total_views,
      totalReached: total_reached,
      totalInteractions: total_interactions,
      data: {
        total_views: total_views,
        total_reached: total_reached,
        total_interactions: total_interactions,
        daily_views_engagements,
        daily_subscriber_change,
      },
    });
  } catch (err) {
    console.error("[Facebook content-insights] Error:", err.message);
    res.status(500).json({
      error: "Failed to fetch Facebook content insights",
      details: err.message,
    });
  }
});

// ---------------------------------------------------------------------
// 5.2.3) FACEBOOK MEDIA (TOP CONTENT) - Page videos with view counts, same shape as Instagram media-insights
//    GET /api/meta/facebook/media-insights?pageId=...&from=...&to=... (from/to optional)
// ---------------------------------------------------------------------
router.get("/facebook/media-insights", optionalAuthMiddleware, async (req, res) => {
  try {
    const { pageId } = req.query;
    if (!pageId) {
      return res.status(400).json({ error: "pageId is required" });
    }
    const { token: accessToken, error: tokenError } = await getPageAccessTokenSafe(pageId);
    if (tokenError || !accessToken) {
      return res.status(200).json({
        media: [],
        byContentType: { all: { views: 0 }, posts: { views: 0 }, reels: { views: 0 }, stories: { views: 0 } },
        message: "Page not accessible with current token.",
      });
    }
    // Use v21.0 for posts/engagement/video data (v24.0 requires pages_read_engagement permission)
    const baseUrl = `https://graph.facebook.com/${META_API_VERSION}`;
    let metaErrorMessage = null;
    console.log("[Facebook media-insights] Starting for page", pageId, "using API", META_API_VERSION, "token:", accessToken?.substring(0, 20) + "...");

    const extractInsightValue = (metricsArr) => {
      if (!Array.isArray(metricsArr) || metricsArr.length === 0) return 0;
      const m0 = metricsArr[0];
      if (m0.total_value != null && m0.total_value.value != null) {
        return parseInt(String(m0.total_value.value), 10) || 0;
      }
      if (m0.values && m0.values.length > 0 && m0.values[0].value != null) {
        return parseInt(String(m0.values[0].value), 10) || 0;
      }
      return 0;
    };

    const media = [];
    let totalViews = 0;
    const pushMedia = (item) => {
      totalViews += item.views || 0;
      media.push(item);
    };

    // --- Try engagement with multiple tokens (page token first, then system token) ---
    const systemToken = getSystemToken();
    const tokensToTry = [accessToken];
    if (systemToken && systemToken !== accessToken) tokensToTry.push(systemToken);

    const fetchPostEngagement = async (postId) => {
      // Strategy 1: Direct engagement fields (requires pages_read_engagement)
      for (const token of tokensToTry) {
        try {
          const engRes = await axios.get(`${baseUrl}/${postId}`, {
            params: { access_token: token, fields: "reactions.summary(true).limit(0),comments.summary(true).limit(0),shares" },
            timeout: 8000,
            validateStatus: () => true,
          });
          if (!engRes.data?.error) {
            const eng = engRes.data || {};
            const result = {
              likes: parseInt(eng?.reactions?.summary?.total_count || 0, 10) || 0,
              comments: parseInt(eng?.comments?.summary?.total_count || 0, 10) || 0,
              shares: parseInt(eng?.shares?.count ?? 0, 10) || 0,
            };
            console.log("[Facebook engagement] direct success for", postId, "→", result);
            return result;
          }
          console.warn("[Facebook engagement] direct error for", postId, ":", engRes.data.error.message, "code:", engRes.data.error.code);
        } catch (_) { /* try next token */ }
      }

      // Strategy 2: Post insights (requires read_insights — different permission)
      try {
        const insRes = await axios.get(`${baseUrl}/${postId}/insights`, {
          params: {
            access_token: accessToken,
            metric: "post_reactions_by_type_total,post_activity_by_action_type",
          },
          timeout: 8000,
          validateStatus: () => true,
        });
        if (!insRes.data?.error && Array.isArray(insRes.data?.data)) {
          let likes = 0, comments = 0, shares = 0;
          const metricsCount = insRes.data.data.length;
          for (const metric of insRes.data.data) {
            const vals = metric?.values?.[0]?.value || metric?.total_value?.value || {};
            if (metric.name === "post_reactions_by_type_total") {
              likes = Object.values(vals).reduce((a, b) => a + (parseInt(b, 10) || 0), 0);
            }
            if (metric.name === "post_activity_by_action_type") {
              comments = parseInt(vals.comment || 0, 10) || 0;
              shares = parseInt(vals.share || 0, 10) || 0;
            }
          }
          if (likes > 0 || comments > 0 || shares > 0 || metricsCount > 0) {
            console.log("[Facebook engagement] insights success for", postId, "→", { likes, comments, shares }, "metricsReturned:", metricsCount);
            return { likes, comments, shares };
          }
          console.log("[Facebook engagement] insights returned empty data[] for", postId);
        }
        if (insRes.data?.error) {
          console.warn("[Facebook engagement] insights error for", postId, ":", insRes.data.error.message);
        }
      } catch (_) { /* fall through */ }

      // Strategy 3: Video-specific engagement (likes.summary, comments.summary — video nodes use different fields)
      try {
        const vidEngRes = await axios.get(`${baseUrl}/${postId}`, {
          params: { access_token: accessToken, fields: "likes.summary(true).limit(0),comments.summary(true).limit(0)" },
          timeout: 8000,
          validateStatus: () => true,
        });
        if (!vidEngRes.data?.error) {
          const eng = vidEngRes.data || {};
          const result = {
            likes: parseInt(eng?.likes?.summary?.total_count || 0, 10) || 0,
            comments: parseInt(eng?.comments?.summary?.total_count || 0, 10) || 0,
            shares: 0,
          };
          if (result.likes > 0 || result.comments > 0) {
            console.log("[Facebook engagement] video-likes success for", postId, "→", result);
            return result;
          }
        } else {
          console.warn("[Facebook engagement] video-likes error for", postId, ":", vidEngRes.data.error.message);
        }
      } catch (_) { /* fall through */ }

      return { likes: 0, comments: 0, shares: 0 };
    };

    // --- Video views: try video_insights first, then direct views field ---
    const fetchVideoViewsById = async (videoId) => {
      if (!videoId) return 0;

      // Attempt 1: video_insights endpoint (total_video_views)
      try {
        const vidInsRes = await axios.get(`${baseUrl}/${videoId}/video_insights`, {
          params: { access_token: accessToken, metric: "total_video_views", period: "lifetime" },
          timeout: 12000,
          validateStatus: () => true,
        });
        if (vidInsRes.data?.error) {
          console.warn("[Facebook views] video_insights error for", videoId, ":", vidInsRes.data.error.message, "code:", vidInsRes.data.error.code);
        } else {
          const val = extractInsightValue(vidInsRes.data?.data);
          if (val > 0) return val;
        }
      } catch (e) {
        console.warn("[Facebook views] video_insights exception for", videoId, ":", e.message);
      }

      // Attempt 2: direct views field on the video node
      try {
        const directRes = await axios.get(`${baseUrl}/${videoId}`, {
          params: { access_token: accessToken, fields: "views" },
          timeout: 8000,
          validateStatus: () => true,
        });
        if (directRes.data?.error) {
          console.warn("[Facebook views] direct views error for", videoId, ":", directRes.data.error.message);
        } else {
          const v = parseInt(directRes.data?.views || 0, 10) || 0;
          if (v > 0) return v;
        }
      } catch (e) {
        console.warn("[Facebook views] direct views exception for", videoId, ":", e.message);
      }

      return 0;
    };

    // Process items in batches to avoid Meta rate limiting
    const processBatch = async (items, fn, batchSize = 5) => {
      const results = [];
      for (let i = 0; i < items.length; i += batchSize) {
        const batch = items.slice(i, i + batchSize);
        const batchResults = await Promise.allSettled(batch.map(fn));
        results.push(...batchResults);
      }
      return results;
    };

    // ====================================================================
    // STEP 1: Fetch /published_posts — try WITH inline engagement fields first
    //   If the token has pages_read_engagement, we get engagement for free.
    //   If not, fall back to basic fields (engagement fetched per-post later).
    // ====================================================================
    let postsData = [];
    let hasInlineEngagement = false;

    const postFieldSets = [
      "id,permalink_url,created_time,message,full_picture,attachments{type,target{id}},reactions.summary(true).limit(0),comments.summary(true).limit(0),shares",
      "id,permalink_url,created_time,message,full_picture,attachments{type,target{id}}",
      "id,permalink_url,created_time,message,full_picture",
    ];

    for (const pFields of postFieldSets) {
      const postsRes = await axios.get(`${baseUrl}/${pageId}/published_posts`, {
        params: { access_token: accessToken, fields: pFields, limit: 25 },
        timeout: 15000,
        validateStatus: () => true,
      });
      if (!postsRes.data?.error) {
        postsData = postsRes.data?.data || [];
        hasInlineEngagement = postsData.length > 0 &&
          (postsData[0]?.reactions?.summary != null || postsData[0]?.comments?.summary != null || postsData[0]?.shares != null);
        console.log("[Facebook media-insights] /published_posts ok with fields:", pFields.substring(0, 60) + "...,", postsData.length, "posts, hasInlineEngagement:", hasInlineEngagement);
        break;
      }
      console.warn("[Facebook media-insights] /published_posts failed:", postsRes.data.error.message, "→ trying fewer fields...");
      if (pFields === postFieldSets[postFieldSets.length - 1]) {
        metaErrorMessage = postsRes.data.error.message || "Published posts API error";
      }
    }

    // ====================================================================
    // STEP 2: Fetch /videos (gives video IDs + views via video_insights)
    // ====================================================================
    let videosData = [];
    try {
      const videoFieldSets = [
        { fields: "id,permalink_url,created_time,picture", limit: 25 },
        { fields: "id,permalink_url,created_time", limit: 25 },
        { fields: "id,created_time", limit: 25 },
      ];
      let videosRes = null;
      for (const fs of videoFieldSets) {
        videosRes = await axios.get(`${baseUrl}/${pageId}/videos`, {
          params: { access_token: accessToken, fields: fs.fields, limit: fs.limit },
          timeout: 30000,
          validateStatus: () => true,
        });
        if (!videosRes.data?.error?.message?.includes("reduce the amount of data")) break;
        console.log("[Facebook media-insights] /videos retrying with fewer fields:", fs.fields, "→ next...");
      }
      if (videosRes.data?.error) {
        if (!metaErrorMessage) metaErrorMessage = videosRes.data.error.message || "Videos API error";
        console.warn("[Facebook media-insights] /videos error:", videosRes.data.error.message);
      }
      videosData = videosRes.data?.data || [];
    } catch (vidErr) {
      console.warn("[Facebook media-insights] /videos exception (non-fatal):", vidErr.message);
    }
    console.log("[Facebook media-insights] /videos returned", videosData.length, "videos");

    const videoViewsMap = {};
    const videoDataMap = {};
    const postVideoIdMap = {};

    // ====================================================================
    // STEP 2b: Extract video IDs from post attachments (fallback when /videos fails)
    // ====================================================================
    if (videosData.length === 0 && postsData.length > 0) {
      for (const p of postsData) {
        const att = p.attachments?.data?.[0];
        if (att?.type && (att.type.includes("video") || att.type === "video_autoplay" || att.type === "video_inline")) {
          const targetId = att.target?.id;
          if (targetId) {
            postVideoIdMap[p.id] = targetId;
            if (!videoDataMap[targetId]) {
              videosData.push({ id: targetId, created_time: p.created_time, picture: p.full_picture });
            }
          }
        }
      }
      if (Object.keys(postVideoIdMap).length > 0) {
        console.log("[Facebook media-insights] Extracted", Object.keys(postVideoIdMap).length, "video IDs from post attachments");
      }
    }

    // ====================================================================
    // STEP 3: Get views for ALL videos in batches (avoid rate limiting)
    // ====================================================================
    if (videosData.length > 0) {
      console.log("[Facebook media-insights] Fetching views for", videosData.length, "videos in batches of 5...");
      const viewResults = await processBatch(
        videosData,
        async (v) => {
          const views = await fetchVideoViewsById(v.id);
          console.log("[Facebook media-insights] video", v.id, "→ views:", views);
          return { id: v.id, views, video: v };
        },
        5
      );
      for (const r of viewResults) {
        if (r.status === "fulfilled" && r.value) {
          videoViewsMap[r.value.id] = r.value.views;
          videoDataMap[r.value.id] = r.value.video;
        }
      }
      const totalViewsCheck = Object.values(videoViewsMap).reduce((a, b) => a + b, 0);
      console.log("[Facebook media-insights] Total views from all sources:", totalViewsCheck, "for", Object.keys(videoViewsMap).length, "videos");
    }

    // Build a set to track which video IDs were matched to posts
    const matchedVideoIds = new Set();

    // ====================================================================
    // STEP 4: Process published_posts — get engagement + match video views
    // ====================================================================
    if (postsData.length > 0) {
      const postResults = await processBatch(
        postsData,
        async (p) => {
          const postTime = p.created_time ? new Date(p.created_time).getTime() : 0;
          const postPermalink = (p.permalink_url || "").replace(/\/$/, "");

          let matchedVideoId = postVideoIdMap[p.id] || null;
          let matchedViews = matchedVideoId ? (videoViewsMap[matchedVideoId] || 0) : 0;

          if (!matchedVideoId) {
            for (const [vId, vData] of Object.entries(videoDataMap)) {
              const vTime = vData.created_time ? new Date(vData.created_time).getTime() : 0;
              const vPermalink = (vData.permalink_url || "").replace(/\/$/, "");
              if ((vPermalink && postPermalink && vPermalink === postPermalink) ||
                  (postTime && vTime && Math.abs(postTime - vTime) < 60000)) {
                matchedVideoId = vId;
                matchedViews = videoViewsMap[vId] || 0;
                break;
              }
            }
          }

          if (matchedVideoId) matchedVideoIds.add(matchedVideoId);

          let engagement;
          if (hasInlineEngagement) {
            engagement = {
              likes: parseInt(p?.reactions?.summary?.total_count || 0, 10) || 0,
              comments: parseInt(p?.comments?.summary?.total_count || 0, 10) || 0,
              shares: parseInt(p?.shares?.count ?? 0, 10) || 0,
            };
          } else {
            // For matched videos, use the video ID for engagement (video nodes allow likes.summary without pages_read_engagement)
            const engagementId = matchedVideoId || p.id;
            engagement = await fetchPostEngagement(engagementId);
          }

          return {
            media_id: p.id,
            permalink: p.permalink_url || null,
            timestamp: p.created_time || null,
            caption: (p.message || "").slice(0, 500) || null,
            media_type: matchedVideoId ? "VIDEO" : "IMAGE",
            product_type: "FEED",
            thumbnail_url: p.full_picture || null,
            views: matchedViews,
            video_views: matchedViews,
            likes: engagement.likes,
            comments: engagement.comments,
            shares: engagement.shares,
            saved: 0,
            follows: 0,
            reach: 0,
            total_interactions: engagement.likes + engagement.comments + engagement.shares,
            availability: "available",
          };
        },
        5
      );

      for (const result of postResults) {
        if (result.status === "fulfilled" && result.value) {
          pushMedia(result.value);
        }
      }
    }

    // ====================================================================
    // STEP 5: Add unmatched videos (videos not in published_posts)
    //   - Video nodes use different engagement fields (likes, comments only)
    // ====================================================================
    const unmatchedVideoIds = Object.keys(videoDataMap).filter((id) => !matchedVideoIds.has(id));
    if (unmatchedVideoIds.length > 0) {
      const unmatchedResults = await processBatch(
        unmatchedVideoIds,
        async (vId) => {
          const v = videoDataMap[vId];
          const views = videoViewsMap[vId] || 0;
          const engagement = await fetchPostEngagement(vId);

          return {
            media_id: vId,
            permalink: v.permalink_url || null,
            timestamp: v.created_time || null,
            caption: (v.title || v.description || "").slice(0, 500) || null,
            media_type: "VIDEO",
            product_type: "FEED",
            thumbnail_url: v.picture || null,
            views,
            video_views: views,
            likes: engagement.likes,
            comments: engagement.comments,
            shares: engagement.shares,
            saved: 0,
            follows: 0,
            reach: 0,
            total_interactions: engagement.likes + engagement.comments + engagement.shares,
            availability: "available",
          };
        },
        5
      );

      for (const result of unmatchedResults) {
        if (result.status === "fulfilled" && result.value) {
          pushMedia(result.value);
        }
      }
    }

    media.sort((a, b) => (b.views || 0) - (a.views || 0));
    console.log("[Facebook media-insights] page", pageId, "→", postsData.length, "posts,", videosData.length, "videos →", media.length, "items, totalViews:", totalViews);
    const payload = {
      media,
      byContentType: {
        all: { views: totalViews },
        posts: { views: totalViews },
        reels: { views: 0 },
        stories: { views: 0 },
      },
    };
    if (media.length === 0 && metaErrorMessage) {
      payload.message = metaErrorMessage;
    }
    res.json(payload);
  } catch (err) {
    console.error("[Facebook media-insights] Error:", err.message);
    res.status(200).json({
      media: [],
      byContentType: { all: { views: 0 }, posts: { views: 0 }, reels: { views: 0 }, stories: { views: 0 } },
      message: "Unable to load Facebook content. Please try again.",
    });
  }
});

// ---------------------------------------------------------------------
// 5.2.1b) INSTAGRAM INSIGHTS API - Fetch insights for multiple IG Business Accounts
//    GET /api/meta/instagram/insights?accountIds=id1,id2&from=...&to=...
//    OR  GET /api/meta/instagram/insights?pageIds=id1,id2&from=...&to=...
//    POST /api/meta/instagram/insights  body: { accountIds: [...], from?, to?, period? }
//
//    Uses META_SYSTEM_ACCESS_TOKEN. Supports partial failures and rate limiting.
// ---------------------------------------------------------------------
router.get("/instagram/insights", optionalAuthMiddleware, async (req, res) => {
  try {
    const { accountIds: accountIdsParam, pageIds: pageIdsParam, from, to, period } = req.query;

    let accountIds = [];
    if (accountIdsParam) {
      accountIds = (typeof accountIdsParam === "string" ? accountIdsParam.split(",") : accountIdsParam || [])
        .map((id) => id.trim())
        .filter(Boolean);
    }
    let pageIds = [];
    if (pageIdsParam) {
      pageIds = (typeof pageIdsParam === "string" ? pageIdsParam.split(",") : pageIdsParam || [])
        .map((id) => id.trim())
        .filter(Boolean);
    }

    const fetchParams = {
      accountIds: accountIds.length > 0 ? accountIds : undefined,
      pageIds: pageIds.length > 0 ? pageIds : undefined,
      getPageToken: pageIds.length > 0 ? getPageAccessToken : undefined,
      from: from || undefined,
      to: to || undefined,
      period: period || undefined,
    };
    console.log("[Instagram Insights API] Request params:", {
      accountIds: fetchParams.accountIds,
      pageIds: fetchParams.pageIds,
      from: fetchParams.from,
      to: fetchParams.to,
      period: fetchParams.period,
    });

    const result = await fetchInstagramInsights(fetchParams);

    console.log("[Instagram Insights API] Response:", {
      totalReached: result?.totalReached,
      totalFollows: result?.totalFollows,
      totalViews: result?.totalViews,
      totalInteractions: result?.totalInteractions,
      error: result?.error,
    });
    return res.json(result);
  } catch (err) {
    console.error("[Instagram Insights API] Error:", {
      message: err.message,
      responseData: err.response?.data,
      status: err.response?.status,
    });
    if (err.response?.data?.error?.code === 190) {
      return res.status(401).json({
        error: "Meta Access Token expired or invalid",
        details: err.response.data.error.message,
        isAuthError: true,
      });
    }
    if (err.response?.data?.error?.code === 200) {
      return res.status(403).json({
        error: "Insufficient permissions for Instagram insights",
        details: err.response.data.error.message,
        isPermissionError: true,
        instruction: "Ensure Meta token has instagram_manage_insights or instagram_business_manage_insights",
      });
    }
    return res.status(500).json({
      error: "Failed to fetch Instagram insights",
      details: err.response?.data || err.message,
    });
  }
});

router.post("/instagram/insights", optionalAuthMiddleware, async (req, res) => {
  try {
    const { accountIds, pageIds, from, to, period } = req.body || {};

    const result = await fetchInstagramInsights({
      accountIds: Array.isArray(accountIds) && accountIds.length > 0 ? accountIds : undefined,
      pageIds: Array.isArray(pageIds) && pageIds.length > 0 ? pageIds : undefined,
      getPageToken: Array.isArray(pageIds) && pageIds.length > 0 ? getPageAccessToken : undefined,
      from: from || undefined,
      to: to || undefined,
      period: period || undefined,
    });

    return res.json(result);
  } catch (err) {
    console.error("[Instagram Insights] Error:", err.response?.data || err.message);
    if (err.response?.data?.error?.code === 190) {
      return res.status(401).json({
        error: "Meta Access Token expired or invalid",
        details: err.response.data.error.message,
        isAuthError: true,
      });
    }
    if (err.response?.data?.error?.code === 200) {
      return res.status(403).json({
        error: "Insufficient permissions for Instagram insights",
        details: err.response.data.error.message,
        isPermissionError: true,
      });
    }
    return res.status(500).json({
      error: "Failed to fetch Instagram insights",
      details: err.response?.data || err.message,
    });
  }
});

// GET /api/meta/instagram/media-insights?accountIds=...|pageIds=...&from=...&to=...&contentType=... (or period=last_7_days)
// Returns media list with hook_rate/hold_rate for Reels; views, reach, total_interactions for all. Includes byContentType aggregates.
// Cache-first: 10–100 ms when cached; Meta is only called on cache miss (TTL 5 min).
// Token: Page Access Token or System User with instagram_manage_insights, instagram_basic, pages_read_engagement.
router.get("/instagram/media-insights", optionalAuthMiddleware, async (req, res) => {
  try {
    const { accountIds: accountIdsParam, pageIds: pageIdsParam, from, to, period, contentType } = req.query;
    const forceRefresh = req.query.refresh === "1" || req.query.refresh === "true";

    let accountIds = [];
    if (accountIdsParam) {
      accountIds = (typeof accountIdsParam === "string" ? accountIdsParam.split(",") : accountIdsParam || [])
        .map((id) => id.trim())
        .filter(Boolean);
    }
    let pageIds = [];
    if (pageIdsParam) {
      pageIds = (typeof pageIdsParam === "string" ? pageIdsParam.split(",") : pageIdsParam || [])
        .map((id) => id.trim())
        .filter(Boolean);
    }

    const cacheOpts = {
      accountIds: accountIds.length > 0 ? accountIds : undefined,
      pageIds: pageIds.length > 0 ? pageIds : undefined,
      from: from || undefined,
      to: to || undefined,
      period: period || undefined,
      contentType: contentType && ["all", "posts", "stories", "reels"].includes(String(contentType).toLowerCase()) ? String(contentType).toLowerCase() : undefined,
    };
    const cacheKey = insightsCache.buildMediaInsightsKey(cacheOpts);
    const cached = forceRefresh ? null : insightsCache.get(cacheKey);
    if (cached != null) {
      return res.json(cached);
    }

    const result = await fetchInstagramMediaInsights({
      accountIds: cacheOpts.accountIds,
      pageIds: cacheOpts.pageIds,
      getPageToken: pageIds.length > 0 ? getPageAccessToken : undefined,
      from: cacheOpts.from,
      to: cacheOpts.to,
      period: cacheOpts.period,
      contentType: cacheOpts.contentType,
    });

    insightsCache.set(cacheKey, result, 5 * 60); // 5 min TTL
    return res.json(result);
  } catch (err) {
    console.error("[Instagram Media Insights] Error:", err.response?.data || err.message);
    if (err.response?.data?.error?.code === 190) {
      return res.status(401).json({
        error: "Meta Access Token expired or invalid",
        details: err.response.data.error.message,
        isAuthError: true,
      });
    }
    if (err.response?.data?.error?.code === 200) {
      return res.status(403).json({
        error: "Insufficient permissions for Instagram insights",
        details: err.response.data.error.message,
        isPermissionError: true,
        instruction: "Ensure Meta token has instagram_manage_insights or instagram_business_manage_insights",
      });
    }
    return res.status(500).json({
      error: "Failed to fetch Instagram media insights",
      details: err.response?.data || err.message,
    });
  }
});

// GET /api/meta/instagram/analytics?ig_user_id=...&media_id=...&page_id=... (page_id optional; used for token and to resolve ig_user_id if omitted)
// Returns dashboard JSON: reach, estimated_views, hook_rate, hold_rate, engagement_score, likes, comments, saved, shares, best_posting_time
router.get("/instagram/analytics", optionalAuthMiddleware, async (req, res) => {
  try {
    const { ig_user_id: igUserIdParam, media_id: mediaIdParam, page_id: pageIdParam } = req.query;
    const mediaId = (mediaIdParam && String(mediaIdParam).trim()) || null;
    if (!mediaId) {
      return res.status(400).json({
        error: "media_id is required",
        message: "Provide media_id (Instagram media ID) as query parameter",
      });
    }

    let igUserId = (igUserIdParam && String(igUserIdParam).trim()) || null;
    let accessToken = (process.env.META_SYSTEM_ACCESS_TOKEN || process.env.META_ACCESS_TOKEN || "").trim();

    if (pageIdParam && String(pageIdParam).trim()) {
      const pageId = String(pageIdParam).trim();
      try {
        const pageToken = await getPageAccessToken(pageId);
        if (pageToken) accessToken = pageToken;
        if (!igUserId) {
          const systemToken = (process.env.META_SYSTEM_ACCESS_TOKEN || process.env.META_ACCESS_TOKEN || "").trim();
          const pageRes = await axios.get(
            `https://graph.facebook.com/${META_PAGE_INSIGHTS_API_VERSION}/${pageId}`,
            { params: { fields: "instagram_business_account", access_token: systemToken }, timeout: 10000 }
          );
          const igAccountId = pageRes.data?.instagram_business_account?.id;
          if (igAccountId) igUserId = String(igAccountId);
        }
      } catch (pageErr) {
        console.warn("[Instagram Analytics] page_id resolution failed:", pageErr?.message);
      }
    }

    if (!igUserId) {
      return res.status(400).json({
        error: "ig_user_id is required when page_id is not provided or could not resolve Instagram account",
        message: "Provide ig_user_id (Instagram Business Account ID) or a valid page_id with linked Instagram",
      });
    }

    if (!accessToken) {
      return res.status(503).json({
        error: "No access token available",
        message: "Configure META_ACCESS_TOKEN or provide page_id to use page token",
      });
    }

    const dashboard = await runAnalytics({
      igUserId,
      mediaId,
      accessToken,
    });
    return res.json(dashboard);
  } catch (err) {
    console.error("[Instagram Analytics] Error:", err?.response?.data || err?.message);
    if (err?.response?.data?.error?.code === 190) {
      return res.status(401).json({
        error: "Meta Access Token expired or invalid",
        details: err.response.data.error.message,
        isAuthError: true,
      });
    }
    if (err?.response?.data?.error?.code === 200) {
      return res.status(403).json({
        error: "Insufficient permissions for Instagram insights",
        details: err.response?.data?.error?.message,
        isPermissionError: true,
      });
    }
    return res.status(500).json({
      error: "Failed to run Instagram analytics",
      details: err?.response?.data || err?.message,
    });
  }
});

// GET /api/meta/instagram/accounts?pageIds=id1,id2 - Resolve IG Business Account IDs from pages
router.get("/instagram/accounts", optionalAuthMiddleware, async (req, res) => {
  try {
    const { pageIds: pageIdsParam } = req.query;
    if (!pageIdsParam) {
      return res.status(400).json({
        error: "pageIds parameter is required",
        message: "Provide pageIds as comma-separated list",
      });
    }
    const pageIds = (typeof pageIdsParam === "string" ? pageIdsParam.split(",") : pageIdsParam || [])
      .map((id) => id.trim())
      .filter(Boolean);
    if (pageIds.length === 0) {
      return res.status(400).json({ error: "No valid pageIds provided" });
    }

    const accessToken = (process.env.META_SYSTEM_ACCESS_TOKEN || process.env.META_ACCESS_TOKEN || "").trim();
    if (!accessToken) {
      throw new Error("Meta Access Token missing.");
    }
    const accountIds = await resolveIgAccountsFromPages(pageIds, accessToken);
    return res.json({ data: accountIds, pageIds });
  } catch (err) {
    console.error("[Instagram Accounts] Error:", err.response?.data || err.message);
    return res.status(500).json({
      error: "Failed to resolve Instagram accounts",
      details: err.response?.data || err.message,
    });
  }
});

// ---------------------------------------------------------------------
// 5.2.2) PRE-LOAD LEADS API - Pre-fetch all leads for a page in date range
//    GET /api/meta/leads/preload?pageId=...&start=...&end=...
//    
//    Pre-loads all forms and leads for a page in the specified date range.
//    Returns structured data with forms list and all leads including campaign_id and ad_id.
//    
//    Uses Page Access Token (META_PAGE_ACCESS_TOKEN or fetched from Meta API)
//    Page Access Token is required to get ad_id and campaign_id attribution data
// ---------------------------------------------------------------------
router.get("/leads/preload", optionalAuthMiddleware, async (req, res) => {
  try {
    const { pageId, start, end } = req.query;
    
    // Validate required parameters
    if (!pageId || pageId.trim() === "") {
      return res.status(400).json({
        error: "pageId parameter is required",
        message: "Please provide a pageId to pre-load leads"
      });
    }

    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!start || !end || !dateRegex.test(start) || !dateRegex.test(end)) {
      return res.status(400).json({
        error: "start and end date parameters are required",
        message: "Please provide start and end dates in YYYY-MM-DD format"
      });
    }

  

    // Convert date range to Date objects
    const startDate = new Date(start + 'T00:00:00');
    const endDate = new Date(end + 'T23:59:59');
    
    // Fetch leads from Meta API using the scheduler function
    const allLeads = await fetchLeadsFromMeta(pageId, startDate, endDate);
    
    

    // Save leads to database (only those with ad_id and campaign_id)
    let savedCount = 0;
    if (allLeads.length > 0) {
      try {
        const result = await saveLeads(allLeads);
        savedCount = result.inserted + result.updated;
        
      } catch (dbError) {
        
        return res.status(500).json({
          error: "Failed to save leads to database",
          details: dbError.message
        });
      }
    }

    // Return success response
    res.json({
      success: true,
      message: "Leads pre-loaded and saved to database",
      meta: {
        page_id: pageId,
        date_range: { start, end },
        total_leads_fetched: allLeads.length,
        total_leads_saved: savedCount
      }
    });
  } catch (err) {
    console.error("[Pre-load] Error:", err.response?.data || err.message);
    
    if (err.response?.data?.error?.code === 190) {
      return res.status(401).json({
        error: "Meta Access Token expired or invalid",
        details: err.response.data.error.message,
        isAuthError: true,
        instruction: "Please update META_SYSTEM_ACCESS_TOKEN in server/.env"
      });
    }

    // Check for permission errors
    if (err.response?.data?.error?.code === 200) {
      return res.status(403).json({
        error: "Insufficient permissions",
        details: err.response.data.error.message,
        isPermissionError: true,
        instruction: "Please ensure your Meta Access Token has 'leads_retrieval' permission"
      });
    }
    
    res.status(500).json({
      error: "Failed to pre-load leads",
      details: err.response?.data?.error?.message || err.message
    });
  }
});

// ---------------------------------------------------------------------
// 5.2.5) LEADS DATABASE API - Fetch leads from database filtered by campaign and ad
//    GET /api/meta/leads/db?campaignId=xxx&adId=xxx&formId=xxx&pageId=xxx&startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
//    
//    Returns leads from database filtered by:
//    - campaignId (optional) - Filter by campaign ID
//    - adId (optional) - Filter by ad ID
//    - formId (optional) - Filter by form ID
//    - pageId (optional) - Filter by page ID
//    - startDate (optional) - Start date filter (YYYY-MM-DD)
//    - endDate (optional) - End date filter (YYYY-MM-DD)
//    
//    All leads returned have both ad_id and campaign_id (as per requirements)
// ---------------------------------------------------------------------
router.get("/leads/db", optionalAuthMiddleware, async (req, res) => {
  try {
    const { campaignId, adId, formId, pageId, startDate, endDate } = req.query;

    // Support multiple campaign/ad IDs (comma-separated or repeated params)
    const parseIds = (val) => {
      if (!val) return [];
      if (Array.isArray(val)) return val.filter(Boolean).map(v => String(v));
      return String(val)
        .split(',')
        .map(v => v.trim())
        .filter(Boolean)
        .map(v => String(v));
    };

    const campaignIds = parseIds(campaignId);
    const adIds = parseIds(adId);
    
    
    
    // Fetch leads from database
    const leads = await getLeadsByCampaignAndAd(campaignIds, adIds, startDate, endDate, formId, pageId);
    
   
    // Enrich ad names from Meta API only for leads missing ad_name (legacy data)
    const adNameCache = {};
    const leadsNeedingAdEnrichment = leads.filter(lead => lead.ad_id && !lead.ad_name);
    const uniqueAdIds = [...new Set(leadsNeedingAdEnrichment.map(lead => lead.ad_id).filter(Boolean))];
    
    if (uniqueAdIds.length > 0) {
      
      const accessToken = getSystemToken();
      
      // Fetch ad names in parallel (with rate limiting - batch of 10 at a time)
      const batchSize = 10;
      for (let i = 0; i < uniqueAdIds.length; i += batchSize) {
        const batch = uniqueAdIds.slice(i, i + batchSize);
        await Promise.all(batch.map(async (adIdValue) => {
          try {
            const adResponse = await axios.get(
              `https://graph.facebook.com/${META_API_VERSION}/${adIdValue}`,
              { 
                params: { access_token: accessToken, fields: "name" },
                timeout: 5000
              }
            );
            adNameCache[adIdValue] = adResponse.data.name || 'N/A';
          } catch (err) {
            console.warn(`[Leads DB] Could not fetch ad name for ${adIdValue}:`, err.response?.data?.error?.message || err.message);
            adNameCache[adIdValue] = 'N/A';
          }
        }));
        
        // Small delay between batches to avoid rate limiting
        if (i + batchSize < uniqueAdIds.length) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }
    } else {
      
    }
    
    // Enrich form names from Meta API for all leads (form_name is not stored in DB)
    const formNameCache = {};
    const leadsNeedingFormEnrichment = leads.filter(lead => lead.form_id);
    const uniqueFormIds = [...new Set(leadsNeedingFormEnrichment.map(lead => lead.form_id).filter(Boolean))];
    
    if (uniqueFormIds.length > 0) {
      
      const accessToken = getSystemToken();
      
      // Fetch form names in parallel (with rate limiting - batch of 10 at a time)
      const batchSize = 10;
      for (let i = 0; i < uniqueFormIds.length; i += batchSize) {
        const batch = uniqueFormIds.slice(i, i + batchSize);
        await Promise.all(batch.map(async (formIdValue) => {
          try {
            const formResponse = await axios.get(
              `https://graph.facebook.com/${META_API_VERSION}/${formIdValue}`,
              { 
                params: { access_token: accessToken, fields: "name" },
                timeout: 5000
              }
            );
            formNameCache[formIdValue] = formResponse.data.name || 'N/A';
          } catch (err) {
            console.warn(`[Leads DB] Could not fetch form name for ${formIdValue}:`, err.response?.data?.error?.message || err.message);
            formNameCache[formIdValue] = 'N/A';
          }
        }));
        
        // Small delay between batches to avoid rate limiting
        if (i + batchSize < uniqueFormIds.length) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }
    } else {
      
    }
    
    // Format response to match frontend expectations
    // Use stored ad_name from database, fallback to API enrichment if missing
    const formattedLeads = leads.map(lead => {
      let adName = lead.ad_name || null;
      
      // If ad_name is missing in DB but we have ad_id, try to get from API cache (for legacy data)
      if (!adName && lead.ad_id && adNameCache[lead.ad_id]) {
        adName = adNameCache[lead.ad_id];
      }
      
      // Get form name from API cache (form_name is not stored in DB)
      let formName = 'N/A';
      if (lead.form_id && formNameCache[lead.form_id]) {
        formName = formNameCache[lead.form_id];
      }
      
      return {
        Id: lead.Id,
        Name: lead.Name,
        Phone: lead.Phone,
        Time: lead.Time,
        TimeUtc: lead.TimeUtc,
        Date: lead.Date,
        DateChar: lead.DateChar,
        Campaign: lead.Campaign,
        campaign: lead.campaign,
        ad_id: lead.ad_id,
        campaign_id: lead.campaign_id,
        lead_id: lead.lead_id,
        form_id: lead.form_id,
        page_id: lead.page_id,
        created_time: lead.created_time,
        // Legacy compatibility fields
        name: lead.name,
        phone: lead.phone,
        date: lead.date,
        time: lead.time,
        // Additional fields that frontend might expect
        Street: 'N/A', // Not stored in DB currently, can be added later
        City: 'N/A', // Not stored in DB currently, can be added later
        page_name: 'N/A', // Can be enriched from Meta API if needed
        campaign_name: lead.Campaign || 'N/A',
        ad_name: adName || 'N/A', // Use stored ad_name from DB, fallback to API if missing
        form_name: formName // Enriched from Meta API
      };
    });
    
   
    res.json({
      data: formattedLeads,
        meta: {
          total: formattedLeads.length,
          filters: {
            campaignId: campaignId || null,
            adId: adId || null,
            formId: formId || null,
            pageId: pageId || null,
            startDate: startDate || null,
            endDate: endDate || null
          }
        }
    });
  } catch (err) {
    console.error("[Leads DB] Error:", err.message);
    res.status(500).json({
      error: "Failed to fetch leads from database",
      details: err.message
    });
  }
});

// ---------------------------------------------------------------------
// 5.2.6) LEADS BACKFILL API - Manually backfill historical leads data
//    POST /api/meta/leads/backfill?pageId=xxx&startDate=YYYY-MM-DD&endDate=YYYY-MM-DD&days=30
//    GET  /api/meta/leads/backfill?pageId=xxx&startDate=YYYY-MM-DD&endDate=YYYY-MM-DD&days=30
//    
//    Manually fetches leads from Meta API for a specified date range and saves them to database.
//    This is separate from the scheduled incremental sync and does NOT update JobState.
//    
//    Parameters:
//    - pageId (required) - Meta page ID
//    - startDate (optional) - Start date in YYYY-MM-DD format
//    - endDate (optional) - End date in YYYY-MM-DD format (defaults to today)
//    - days (optional) - Number of days to go back from today (alternative to startDate/endDate, defaults to 30)
//    
//    Returns:
//    - Success status
//    - Date range used
//    - Number of leads fetched, inserted, and updated
//    
//    Uses Page Access Token (META_PAGE_ACCESS_TOKEN or fetched from Meta API)
//    Page Access Token is required to get ad_id and campaign_id attribution data
// ---------------------------------------------------------------------
router.post("/leads/backfill", optionalAuthMiddleware, async (req, res) => {
  return handleBackfillRequest(req, res);
});

router.get("/leads/backfill", optionalAuthMiddleware, async (req, res) => {
  return handleBackfillRequest(req, res);
});

async function handleBackfillRequest(req, res) {
  try {
    const { pageId, startDate, endDate, days } = req.query;
    
    // Validate required parameters
    if (!pageId || pageId.trim() === "") {
      return res.status(400).json({
        error: "pageId parameter is required",
        message: "Please provide a pageId to backfill leads"
      });
    }

    // Calculate date range
    let startDateObj, endDateObj;
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    
    if (days) {
      // Use days parameter
      const daysNum = parseInt(days, 10);
      if (isNaN(daysNum) || daysNum <= 0) {
        return res.status(400).json({
          error: "Invalid days parameter",
          message: "days must be a positive number"
        });
      }
      endDateObj = new Date();
      endDateObj.setHours(23, 59, 59, 999);
      startDateObj = new Date();
      startDateObj.setDate(startDateObj.getDate() - daysNum);
      startDateObj.setHours(0, 0, 0, 0);
    } else if (startDate && endDate) {
      // Use provided date range
      if (!dateRegex.test(startDate) || !dateRegex.test(endDate)) {
        return res.status(400).json({
          error: "Invalid date format",
          message: "startDate and endDate must be in YYYY-MM-DD format"
        });
      }
      startDateObj = new Date(startDate + 'T00:00:00');
      endDateObj = new Date(endDate + 'T23:59:59');
    } else {
      // Default: last 30 days
      endDateObj = new Date();
      endDateObj.setHours(23, 59, 59, 999);
      startDateObj = new Date();
      startDateObj.setDate(startDateObj.getDate() - 30);
      startDateObj.setHours(0, 0, 0, 0);
    }

    // Validate date range
    if (startDateObj >= endDateObj) {
      return res.status(400).json({
        error: "Invalid date range",
        message: "startDate must be before endDate"
      });
    }

    const startDateStr = startDateObj.toISOString().split('T')[0];
    const endDateStr = endDateObj.toISOString().split('T')[0];

    
    // Fetch leads from Meta API
    const allLeads = await fetchLeadsFromMeta(pageId, startDateObj, endDateObj);
    
    // Save leads to database
    let result = { inserted: 0, updated: 0 };
    if (allLeads.length > 0) {
      try {
        result = await saveLeads(allLeads);
        
      } catch (dbError) {
        console.error('[Backfill] Error saving leads to database:', dbError);
        return res.status(500).json({
          error: "Failed to save leads to database",
          details: dbError.message
        });
      }
    }

    // Return success response
    res.json({
      success: true,
      message: "Leads backfilled successfully",
      data: {
        pageId: pageId,
        dateRange: {
          start: startDateStr,
          end: endDateStr
        },
        stats: {
          leadsFetched: allLeads.length,
          leadsInserted: result.inserted,
          leadsUpdated: result.updated
        }
      }
    });
  } catch (err) {
    console.error("[Backfill] Error:", err.response?.data || err.message);
    
    if (err.response?.data?.error?.code === 190) {
      return res.status(401).json({
        error: "Meta Access Token expired or invalid",
        details: err.response.data.error.message,
        isAuthError: true,
        instruction: "Please update META_SYSTEM_ACCESS_TOKEN in server/.env"
      });
    }

    // Check for permission errors
    if (err.response?.data?.error?.code === 200) {
      return res.status(403).json({
        error: "Insufficient permissions",
        details: err.response.data.error.message,
        isPermissionError: true,
        instruction: "Please ensure your Meta Access Token has 'leads_retrieval' permission"
      });
    }
    
    res.status(500).json({
      error: "Failed to backfill leads",
      details: err.response?.data?.error?.message || err.message
    });
  }
}

// ---------------------------------------------------------------------
// 5.3) LEADS API - Fetch actual lead data from Meta Lead Ads
//    GET /api/meta/leads?formId=xxx&adId=xxx&campaignId=xxx&pageId=xxx&start=YYYY-MM-DD&end=YYYY-MM-DD
//    
//    Supports filtering by:
//    - formId (optional, but recommended) - Filter by specific form
//    - adId (optional) - Find forms for ad, then fetch leads
//    - campaignId (optional) - For context enrichment only
//    - pageId (optional) - Fetch all forms from page, then leads
//    - start/end (optional) - Date range filter
//    
//    Each lead is enriched with:
//    - page_name - Fetched from Meta API
//    - campaign_name - From Insights API context
//    - ad_name - From Insights API context  
//    - form_name - Fetched from Meta API
//    
//    Uses META_SYSTEM_ACCESS_TOKEN
// ---------------------------------------------------------------------
router.get("/leads", optionalAuthMiddleware, async (req, res) => {
  try {
    const accessToken = getSystemToken();
    const credentials = getCredentials();
    
    // Get all filter parameters
    const { formId, adId, campaignId, pageId, start, end, days, limit = 500 } = req.query;
    
    // At least one of formId, adId, or pageId must be provided
    if (!formId && !adId && !pageId) {
      return res.status(400).json({
        error: "At least one filter parameter is required",
        message: "Please provide formId, adId, or pageId to fetch leads"
      });
    }
    
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    let dateFrom = start;
    let dateTo = end;

    // Calculate date range
    if (!dateFrom || !dateTo || !dateRegex.test(dateFrom) || !dateRegex.test(dateTo)) {
      const daysToFetch = days ? parseInt(days, 10) : 30;
      const validDays = isNaN(daysToFetch) || daysToFetch <= 0 ? 30 : Math.min(daysToFetch, 365);
      
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - (validDays - 1));
      
      dateFrom = startDate.toISOString().slice(0, 10);
      dateTo = endDate.toISOString().slice(0, 10);
      
     
    }

    // Check for pre-loaded data first (if pageId is provided and matches cache)
    if (pageId) {
      const preloadCacheKey = `preload_${pageId}_${dateFrom}_${dateTo}`;
      const now = Date.now();
      if (preloadLeadsCache.data[preloadCacheKey] && preloadLeadsCache.lastFetched[preloadCacheKey] &&
          (now - preloadLeadsCache.lastFetched[preloadCacheKey]) < preloadLeadsCache.ttl) {
        
        
        const preloadedData = preloadLeadsCache.data[preloadCacheKey];
        let filteredLeads = [...(preloadedData.leads || [])];
        
        // Apply filters from pre-loaded data
        if (formId) {
          filteredLeads = filteredLeads.filter(lead => lead.form_id === formId);
        }
        
        if (adId) {
          filteredLeads = filteredLeads.filter(lead => {
            if (!lead.ad_id) return false;
            return lead.ad_id === adId || lead.ad_id.toString() === adId.toString();
          });
        }
        
        if (campaignId) {
          filteredLeads = filteredLeads.filter(lead => {
            if (!lead.campaign_id) return false;
            return lead.campaign_id === campaignId || lead.campaign_id.toString() === campaignId.toString();
          });
        }
        
        // Date range is already filtered during pre-load, but double-check
        const startDate = new Date(dateFrom);
        startDate.setHours(0, 0, 0, 0);
        const endDate = new Date(dateTo);
        endDate.setHours(23, 59, 59, 999);
        
        filteredLeads = filteredLeads.filter(lead => {
          if (!lead.created_time) return false;
          const leadDate = new Date(lead.created_time);
          return leadDate >= startDate && leadDate <= endDate;
        });
        
        // Enrich with page_name, campaign_name, ad_name, form_name from cache
        const forms = preloadedData.forms || [];
        const enrichedLeads = await Promise.all(filteredLeads.map(async (lead) => {
          const enriched = { ...lead };
          
          // Get form name
          const form = forms.find(f => f.form_id === lead.form_id);
          enriched.form_name = form?.name || 'N/A';
          
          // Get page name
          try {
            const pageResponse = await axios.get(
              `https://graph.facebook.com/${META_API_VERSION}/${pageId}`,
              { params: { access_token: accessToken, fields: "name" } }
            );
            enriched.page_name = pageResponse.data.name || 'N/A';
          } catch (err) {
            enriched.page_name = 'N/A';
          }
          
          // Get campaign name if campaign_id exists
          if (lead.campaign_id) {
            try {
              const campaignResponse = await axios.get(
                `https://graph.facebook.com/${META_API_VERSION}/${lead.campaign_id}`,
                { params: { access_token: credentials.accessToken, fields: "name" } }
              );
              enriched.campaign_name = campaignResponse.data.name || 'N/A';
            } catch (err) {
              enriched.campaign_name = 'N/A';
            }
          } else {
            enriched.campaign_name = 'N/A';
          }
          
          // Get ad name if ad_id exists
          if (lead.ad_id) {
            try {
              const adResponse = await axios.get(
                `https://graph.facebook.com/${META_API_VERSION}/${lead.ad_id}`,
                { params: { access_token: credentials.accessToken, fields: "name" } }
              );
              enriched.ad_name = adResponse.data.name || 'N/A';
            } catch (err) {
              // Fallback: try Insights API
              try {
                let accountId = credentials.adAccountId;
                if (accountId && accountId.startsWith('act_')) {
                  accountId = accountId.substring(4);
                }
                const insightsResponse = await axios.get(
                  `https://graph.facebook.com/${META_API_VERSION}/act_${accountId}/ads`,
                  { 
                    params: { 
                      access_token: credentials.accessToken, 
                      fields: "id,name",
                      filtering: JSON.stringify([{ field: "ad.id", operator: "IN", value: [lead.ad_id] }])
                    } 
                  }
                );
                const ads = insightsResponse.data.data || [];
                enriched.ad_name = ads.length > 0 ? ads[0].name : 'N/A';
              } catch (insightsErr) {
                enriched.ad_name = 'N/A';
              }
            }
          } else {
            enriched.ad_name = 'N/A';
          }
          
          return enriched;
        }));
        
        // Apply limit if specified (clamp to 25-10000)
        const clampedLimit = Math.min(10000, Math.max(25, parseInt(limit, 10) || 500));
        const limitedLeads = limit ? enrichedLeads.slice(0, clampedLimit) : enrichedLeads;
        
      
        
        return res.json({
          data: limitedLeads,
          meta: {
            total_leads: enrichedLeads.length,
            returned: limitedLeads.length,
            fromPreload: true,
            cached: false
          }
        });
      }
    }

    // Step 1: Determine which forms to fetch leads from
    let formsToFetch = [];
    
    if (formId) {
      // Direct form ID provided
      // When pageId is also provided: use it directly - no need to call GET /formId (avoids permission
      // issues for pages like Integfarms My Health School, MHS Dental Care where System token may not
      // have access to the form object, but Page Access Token works for /formId/leads)
      if (pageId) {
        formsToFetch.push({
          form_id: formId,
          name: `Form ${formId}`,
          page_id: pageId
        });
      } else {
        // No pageId: must fetch form info to get page_id (requires System token to access form object)
        try {
          const formResponse = await axios.get(
            `https://graph.facebook.com/${META_API_VERSION}/${formId}`,
            { params: { access_token: accessToken, fields: "id,name,page_id" } }
          );
          if (!formResponse.data.page_id) {
            return res.status(400).json({
              error: "Form missing page_id",
              details: "Unable to determine which page this form belongs to. Cannot fetch leads without page_id."
            });
          }
          formsToFetch.push({
            form_id: formId,
            name: formResponse.data.name || `Form ${formId}`,
            page_id: formResponse.data.page_id
          });
        } catch (err) {
          const errorData = err.response?.data?.error;
          const errorCode = errorData?.code;
          const errorMsg = errorData?.message || err.message;

          if (errorCode === 190) {
            return res.status(401).json({
              error: "Meta Access Token expired or invalid",
              details: errorMsg,
              isAuthError: true,
              instruction: "Please update META_SYSTEM_ACCESS_TOKEN in server/.env"
            });
          }

          if (errorCode === 200 || errorCode === 10) {
            return res.status(403).json({
              error: "Permission error",
              details: errorMsg,
              instruction: "Ensure your System User Token has 'leads_retrieval' and assign the Page to your System User in Meta Business Manager"
            });
          }

          return res.status(400).json({
            error: "Invalid formId",
            details: errorMsg,
            instruction: "Provide pageId alongside formId when selecting a page (e.g. Integfarms My Health School, MHS Dental Care) to use Page Access Token instead."
          });
        }
      }
    } else if (adId) {
      // Fetch forms associated with ad - use same logic as /forms endpoint
      // Step 1: Verify ad has leads via Insights API
      let accountId = credentials.adAccountId;
      if (accountId && accountId.startsWith('act_')) {
        accountId = accountId.substring(4);
      }
      
      try {
        const insightsUrl = `https://graph.facebook.com/${META_API_VERSION}/act_${accountId}/insights`;
        const timeRange = JSON.stringify({ since: dateFrom, until: dateTo });
        
        const insightsResponse = await axios.get(insightsUrl, {
          params: {
            access_token: credentials.accessToken,
            level: "ad",
            fields: "ad_id,actions",
            filtering: JSON.stringify([{ field: "ad.id", operator: "IN", value: [adId] }]),
            time_range: timeRange,
            limit: 1
          }
        });
        
        const insightsData = insightsResponse.data.data || [];
        const hasLeads = insightsData.length > 0 && insightsData[0].actions?.some(
          action => action.action_type === 'lead' || action.action_type === 'onsite_conversion.lead_grouped'
        );
        
        if (!hasLeads) {
        
          return res.json({ data: [], meta: { total_leads: 0, message: "Ad has no leads in date range" } });
        }
        
        // Step 2: Fetch all forms from accessible pages
        const pagesResponse = await axios.get(
          `https://graph.facebook.com/${META_API_VERSION}/me/accounts`,
          { params: { access_token: accessToken, fields: "id", limit: 100 } }
        );
        const pages = (pagesResponse.data.data || []).map(p => p.id);
        
        // Step 3: Fetch all forms using Page Access Tokens
        // Meta's leadgen_forms API requires a Page Access Token, not a System User Token
        const formPromises = pages.map(async (pageId) => {
          try {
            const pageAccessToken = await getPageAccessToken(pageId);
            const response = await axios.get(`https://graph.facebook.com/${META_API_VERSION}/${pageId}/leadgen_forms`, {
              params: { access_token: pageAccessToken, fields: "id,name,page_id", limit: 100 }
            });
            return (response.data.data || []).map(f => ({ 
              form_id: f.id, 
              name: f.name || `Form ${f.id}`,
              page_id: f.page_id || pageId 
            }));
          } catch (err) {
            const errorData = err.response?.data?.error;
            const errorCode = errorData?.code;
            
            // Handle token errors
            if (errorCode === 190) {
              if (pageTokenCache.tokens[pageId]) {
                delete pageTokenCache.tokens[pageId];
              }
              console.warn(`[Leads API] Token expired for page ${pageId}:`, errorData?.message || err.message);
            } else if (errorCode === 200 || errorCode === 10) {
              console.warn(`[Leads API] Permission error for page ${pageId}:`, errorData?.message || err.message);
            } else {
              console.warn(`[Leads API] Error fetching forms for page ${pageId}:`, err.message);
            }
            return [];
          }
        });
        
        const allFormsArrays = await Promise.all(formPromises);
        formsToFetch = allFormsArrays.flat();
       
      } catch (err) {
       
        formsToFetch = [];
      }
    } else if (pageId) {
      // Fetch all forms from page using Page Access Token
      // Meta's leadgen_forms API requires a Page Access Token, not a System User Token
      try {
        const pageAccessToken = await getPageAccessToken(pageId);
        const formsResponse = await axios.get(
          `https://graph.facebook.com/${META_API_VERSION}/${pageId}/leadgen_forms`,
          { params: { access_token: pageAccessToken, fields: "id,name,page_id", limit: 100 } }
        );
        formsToFetch = (formsResponse.data.data || []).map(f => ({ 
          form_id: f.id, 
          name: f.name,
          page_id: f.page_id || pageId 
        }));
        
      } catch (err) {
        const errorData = err.response?.data?.error;
        const errorCode = errorData?.code;
        const errorMsg = errorData?.message || err.message;
        
        // Handle token errors
        if (errorCode === 190) {
          if (pageTokenCache.tokens[pageId]) {
            delete pageTokenCache.tokens[pageId];
          }
          return res.status(401).json({ 
            error: "Meta Access Token expired or invalid", 
            details: errorMsg,
            isAuthError: true,
            instruction: "Please update META_SYSTEM_ACCESS_TOKEN in server/.env"
          });
        }
        
        if (errorCode === 200 || errorCode === 10) {
          return res.status(403).json({ 
            error: "Permission error", 
            details: errorMsg,
            instruction: "Ensure your System User Token has 'leads_retrieval' and 'pages_read_engagement' permissions"
          });
        }
        
        console.error(`[Leads API] Error fetching forms for page:`, err.message);
        return res.status(400).json({ error: "Failed to fetch forms for page", details: errorMsg });
      }
    }

    if (formsToFetch.length === 0) {
      return res.json({ data: [], meta: { total_leads: 0, message: "No forms found for the specified filters" } });
    }

    // Step 2: Fetch leads from all identified forms
    let allLeads = [];
    const pageNameCache = {}; // Cache page names
    const formNameCache = {}; // Cache form names
    const adNameCache = {}; // Cache ad names
    const campaignNameCache = {}; // Cache campaign names

    const leadLimit = Math.min(10000, Math.max(25, parseInt(limit, 10) || 500));

    for (const formInfo of formsToFetch) {
      try {
        if (allLeads.length >= leadLimit) break;

        // Meta's /leads API requires a Page Access Token for the form's page
        const formPageId = formInfo.page_id;
        if (!formPageId) {
          console.warn(`[Leads API] Form ${formInfo.form_id} has no page_id, skipping`);
          continue;
        }
        
        const pageAccessToken = await getPageAccessToken(formPageId);
        const leadsUrl = `https://graph.facebook.com/${META_API_VERSION}/${formInfo.form_id}/leads`;
        // Request ad_id and campaign_id; use limit and pagination to fetch up to leadLimit (Meta default is 25 per page)
        let leads = [];
        let nextUrl = null;
        const metaPageLimit = 1000;
        do {
          const response = nextUrl
            ? await axios.get(nextUrl, { headers: { Authorization: `Bearer ${pageAccessToken}` } })
            : await axios.get(leadsUrl, {
                headers: { Authorization: `Bearer ${pageAccessToken}` },
                params: {
                  fields: "id,created_time,field_data,ad_id,campaign_id",
                  limit: metaPageLimit
                }
              });
          const chunk = response.data.data || [];
          leads = leads.concat(chunk);
          nextUrl = (response.data.paging && response.data.paging.next) || null;
        } while (nextUrl && leads.length < leadLimit);
        

        // Process each lead
        for (const lead of leads) {
          // Check if lead should be included based on adId filter (if provided)
          // Meta Leads API may include ad_id in the lead object
          if (adId && lead.ad_id && lead.ad_id !== adId) {
            continue; // Skip leads that don't match the requested adId
          }
          
          // Parse field_data (clean labels via FIELD_LABELS, e.g. Sugar Poll)
          const fieldData = parseFieldData(lead.field_data);

          // Extract name
          let leadName = 'N/A';
          for (const [key, value] of Object.entries(fieldData)) {
            if (key && typeof key === 'string' && 
                (key.toLowerCase().includes('name') || key.includes('பெயர்')) && 
                value && value.trim() !== '') {
              leadName = value;
              break;
            }
          }
          if (leadName === 'N/A') {
            leadName = fieldData.full_name || 
                      `${fieldData.first_name || ''} ${fieldData.last_name || ''}`.trim() || 
                      fieldData.name || 'N/A';
          }

          // Extract phone
          let phone = 'N/A';
          for (const [key, value] of Object.entries(fieldData)) {
            if (key && typeof key === 'string' && 
                (key.toLowerCase().includes('phone') || key.toLowerCase().includes('mobile')) && 
                value && value.trim() !== '') {
              phone = value.toString();
              break;
            }
          }
          if (phone === 'N/A') {
            phone = fieldData.phone_number || fieldData.phone || fieldData.mobile_number || 'N/A';
          }

          // Extract address
          let street = 'N/A';
          for (const [key, value] of Object.entries(fieldData)) {
            if (key && typeof key === 'string' && 
                (key.toLowerCase().includes('street') || key.toLowerCase().includes('address')) && 
                value && value.trim() !== '') {
              street = value.toString();
              break;
            }
          }
          if (street === 'N/A') {
            street = fieldData.street || fieldData.street_address || fieldData.address || findFirstValueByKeyPattern(fieldData, /street|address/i) || 'N/A';
          }
          const city = fieldData.city || findFirstValueByKeyPattern(fieldData, /city|town/i) || 'N/A';
          const sugarPoll = fieldData['Sugar Poll'] || findFirstValueByKeyPattern(fieldData, /sugar/i) || 'N/A';

          // Get form name (from cache or fetch)
          let formName = formNameCache[formInfo.form_id] || formInfo.name;
          if (!formNameCache[formInfo.form_id]) {
            formNameCache[formInfo.form_id] = formName;
          }

          // Get page name if pageId provided
          let pageName = null;
          if (pageId && !pageNameCache[pageId]) {
            try {
              const pageResponse = await axios.get(
                `https://graph.facebook.com/${META_API_VERSION}/${pageId}`,
                { params: { access_token: accessToken, fields: "name" } }
              );
              pageName = pageResponse.data.name;
              pageNameCache[pageId] = pageName;
            } catch (err) {
              console.warn(`[Leads API] Could not fetch page name for ${pageId}`);
            }
          } else if (pageId) {
            pageName = pageNameCache[pageId];
          }

          // Enrich ad name using this lead's ad_id (or request adId filter); cache by ad id
          const effectiveAdId = lead.ad_id || adId || null;
          let adName = effectiveAdId ? adNameCache[effectiveAdId] ?? null : null;
          if (effectiveAdId && adName == null) {
            try {
              const adResponse = await axios.get(
                `https://graph.facebook.com/${META_API_VERSION}/${effectiveAdId}`,
                { params: { access_token: credentials.accessToken, fields: "name" } }
              );
              adName = adResponse.data.name || null;
              adNameCache[effectiveAdId] = adName;
            } catch (err) {
              try {
                let accountId = credentials.adAccountId;
                if (accountId && accountId.startsWith('act_')) {
                  accountId = accountId.substring(4);
                }
                const insightsResponse = await axios.get(
                  `https://graph.facebook.com/${META_API_VERSION}/act_${accountId}/insights`,
                  {
                    params: {
                      access_token: credentials.accessToken,
                      level: "ad",
                      fields: "ad_id,ad_name",
                      filtering: JSON.stringify([{ field: "ad.id", operator: "IN", value: [effectiveAdId] }]),
                      limit: 1
                    }
                  }
                );
                const insightsData = insightsResponse.data.data || [];
                if (insightsData.length > 0 && insightsData[0].ad_name) {
                  adName = insightsData[0].ad_name;
                  adNameCache[effectiveAdId] = adName;
                }
              } catch (insightsErr) {
                // leave adName null
              }
            }
          }

          // Enrich campaign name using this lead's campaign_id (or request campaignId filter); cache by campaign id
          const effectiveCampaignId = lead.campaign_id || campaignId || null;
          let campaignName = effectiveCampaignId ? campaignNameCache[effectiveCampaignId] ?? null : null;
          if (effectiveCampaignId && campaignName == null) {
            try {
              const campaignResponse = await axios.get(
                `https://graph.facebook.com/${META_API_VERSION}/${effectiveCampaignId}`,
                { params: { access_token: credentials.accessToken, fields: "name" } }
              );
              campaignName = campaignResponse.data.name || null;
              campaignNameCache[effectiveCampaignId] = campaignName;
            } catch (err) {
              // leave campaignName null
            }
          }

          // Build lead object
          const mappedLead = {
            lead_id: lead.id,
            form_id: formInfo.form_id,
            created_time: lead.created_time,
            name: leadName,
            phone: phone,
            email: fieldData.email || null,
            address: street, // Using 'address' as specified in requirements
            city: city,
            street: street, // Keep for backward compatibility
            page_name: pageName || null,
            campaign_name: campaignName || null,
            ad_name: adName || null,
            form_name: formName,
            ad_id: lead.ad_id || (adId || null),
            campaign_id: lead.campaign_id || (campaignId || null),
            // Legacy fields
            Id: lead.id,
            Name: leadName,
            Phone: phone,
            Email: fieldData.email || 'N/A',
            Date: lead.created_time ? lead.created_time.split('T')[0] : '',
            Time: lead.created_time || '',
            TimeUtc: lead.created_time || '',
            DateChar: lead.created_time ? lead.created_time.split('T')[0] : '',
            Street: street,
            City: city,
            SugarPoll: sugarPoll,
            sugar_poll: sugarPoll,
            raw_field_data: lead.field_data || [],
            field_data: fieldData
          };

          allLeads.push(mappedLead);
        }
      } catch (formError) {
        const errorData = formError.response?.data?.error;
        const errorCode = errorData?.code;
        const errorMsg = errorData?.message || formError.message;
        
        // Handle token errors
        if (errorCode === 190) {
          // Clear cache for this page
          const formPageId = formInfo.page_id;
          if (formPageId && pageTokenCache.tokens[formPageId]) {
            delete pageTokenCache.tokens[formPageId];
          }
          console.error(`[Leads API] Token expired while fetching leads from form ${formInfo.form_id}:`, errorMsg);
        } else if (errorCode === 200 || errorCode === 10) {
          console.error(`[Leads API] Permission error while fetching leads from form ${formInfo.form_id}:`, errorMsg);
        } else {
          console.error(`[Leads API] Error fetching leads from form ${formInfo.form_id}:`, errorMsg);
        }
        // Continue with other forms
      }
    }

    // Step 3: Filter by date range
    let filteredLeads = allLeads;
    if (dateFrom && dateTo && dateRegex.test(dateFrom) && dateRegex.test(dateTo)) {
      const startDate = new Date(dateFrom);
      startDate.setHours(0, 0, 0, 0);
      const endDate = new Date(dateTo);
      endDate.setHours(23, 59, 59, 999);
      
      filteredLeads = allLeads.filter(lead => {
        if (!lead.created_time) return false;
        const leadDate = new Date(lead.created_time);
        return leadDate >= startDate && leadDate <= endDate;
      });
      
      
    }

    // Step 4: Apply additional filters
    // Filter by formId if specified
    if (formId) {
      filteredLeads = filteredLeads.filter(lead => lead.form_id === formId);
    }
    
    // Filter by adId if specified (check if lead has ad_id field)
    if (adId) {
      // Meta Leads API may or may not provide ad_id - filter if available
      filteredLeads = filteredLeads.filter(lead => {
        // Check if lead has ad_id field (from Meta API or added during processing)
        return lead.ad_id === adId || lead.ad_id === adId.toString();
      });
      
      // If no leads match after adId filter, the ad might not have attributed leads
     
    }
    
    // Note: pageId filtering is already handled in Step 1 (we only fetch forms from that page)

    // Step 5: Sort and limit
    filteredLeads.sort((a, b) => {
      const timeA = new Date(a.created_time || 0).getTime();
      const timeB = new Date(b.created_time || 0).getTime();
      return timeB - timeA;
    });

    if (filteredLeads.length > leadLimit) {
      filteredLeads = filteredLeads.slice(0, leadLimit);
    }

    res.json({ 
      data: filteredLeads,
      meta: {
        total_leads: filteredLeads.length,
        date_range: dateFrom && dateTo ? { from: dateFrom, to: dateTo } : null,
        filters: {
          formId: formId || null,
          adId: adId || null,
          campaignId: campaignId || null,
          pageId: pageId || null
        }
      }
    });
  } catch (err) {
    console.error("[Leads API] Error:", err.response?.data || err.message);

    const errorData = err.response?.data?.error;
    const errorCode = errorData?.code;
    const errorMsg = errorData?.message || err.message;

    // Handle token expiration (190)
    if (errorCode === 190) {
      // Clear all page token caches on token expiration
      pageTokenCache.tokens = {};
      return res.status(401).json({
        error: "Meta Access Token expired or invalid",
        details: errorMsg,
        isAuthError: true,
        instruction: "Please update META_SYSTEM_ACCESS_TOKEN in server/.env"
      });
    }

    // Handle permission errors (200, 10)
    if (errorCode === 200) {
      return res.status(403).json({
        error: "Permission error",
        details: errorMsg,
        instruction: "Ensure your System User Token has 'leads_retrieval' and 'pages_read_engagement' permissions"
      });
    }

    if (errorCode === 10) {
      return res.status(403).json({
        error: "Permission denied",
        details: errorMsg,
        instruction: "Check that your System User Token has access to the requested resources and required permissions"
      });
    }

    const errorMessage = errorMsg;
    
    if (errorCode === 10 || errorCode === 200 || 
        errorMessage.toLowerCase().includes('permission') ||
        errorMessage.toLowerCase().includes('leads_retrieval')) {
      return res.status(403).json({
        error: "Insufficient permissions to fetch leads",
        details: errorMessage,
        isPermissionError: true,
        errorCode: errorCode
      });
    }

    res.status(500).json({
      error: "Failed to fetch leads",
      details: err.response?.data || err.message,
      errorCode: errorCode
    });
  }
});

// ---------------------------------------------------------------------
// 5.4) LEADS WITH CONTEXT - Contextual join of Leads + Insights
//    GET /api/meta/leads-with-context
//    
//    This endpoint implements a CONTEXTUAL (not relational) join of:
//    A. Leads API data (individual lead records)
//    B. Insights API data (aggregated campaign/ad metrics)
//    
//    JOIN STRATEGY:
//    - Join is STATISTICAL, not per-lead attribution
//    - Matching keys: Date window + Campaign/Ad filter context
//    - NEVER assumes one lead = one ad
//    
//    RESPONSE:
//    - Leads array (NO ad_id/campaign_id per lead)
//    - Context metadata (campaign/ad names from filters)
//    - Insights summary (aggregated metrics for context)
//    
//    IMPORTANT: This join does NOT add attribution to leads.
//    Campaign/Ad info is provided as UI context based on filters only.
// ---------------------------------------------------------------------
router.get("/leads-with-context", optionalAuthMiddleware, async (req, res) => {
  try {
    const {
      form_id,           // Required: form to fetch leads from
      from,              // Optional: start date (YYYY-MM-DD), defaults to 30 days ago
      to,                // Optional: end date (YYYY-MM-DD), defaults to today
      ad_account_id,     // Optional: filter insights by ad account
      campaign_id,       // Optional: filter insights by campaign (context only)
      ad_id,             // Optional: filter insights by ad (context only)
      limit = 500        // Optional: max leads to return
    } = req.query;
    
    // form_id is now optional when ad_id is provided
    // If ad_id is provided without form_id, we'll fetch leads from all forms
    // If both are provided, filter by the specific form
    if (!form_id && !ad_id) {
      return res.status(400).json({
        error: "Either form_id or ad_id parameter is required"
      });
    }

    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

    // Calculate date range: prioritize explicit from/to, then default to 30 days
    // Trim and normalize empty strings to undefined
    let dateFrom = from && typeof from === 'string' && from.trim() ? from.trim() : undefined;
    let dateTo = to && typeof to === 'string' && to.trim() ? to.trim() : undefined;

    if (!dateFrom || !dateTo || !dateRegex.test(dateFrom) || !dateRegex.test(dateTo)) {
      // Default to last 30 days when dates are not provided or invalid
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - 29); // Include today (30 days total)
      
      dateFrom = startDate.toISOString().slice(0, 10);
      dateTo = endDate.toISOString().slice(0, 10);
      
      
    }

   

    // STEP 1: Fetch leads from Meta Leads API
    // This returns only: created_time, id, field_data
    // Does NOT return: ad_id, campaign_id, ad_name, campaign_name
    
    const accessToken = getSystemToken();
    const formLeadsUrl = `https://graph.facebook.com/${META_API_VERSION}/${form_id}/leads`;
    
    let leadsData = [];
    try {
      // Pagination setup to fetch ALL leads
      let allRawLeads = [];
      let nextUrl = null;
      let currentParams = {};
      let pageCount = 0;
      const maxPages = 50; // Safety limit to prevent infinite loops
      
      do {
        // First page - add limit parameter, subsequent pages use after cursor
        if (!nextUrl) {
          currentParams.limit = 1000; // Max allowed by Meta API per request
        }
        
        const leadsResponse = await axios.get(formLeadsUrl, {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
          params: Object.keys(currentParams).length > 0 ? currentParams : undefined
        });
        
        const responseData = leadsResponse.data;
        const leads = responseData.data || [];
        allRawLeads = allRawLeads.concat(leads);
       
        // Check for next page
        if (responseData.paging && responseData.paging.next) {
          nextUrl = responseData.paging.next;
          // Extract cursor from next URL for next request
          const urlObj = new URL(responseData.paging.next);
          currentParams.after = urlObj.searchParams.get('after');
          // Remove limit for subsequent pages (it's in the URL already)
          delete currentParams.limit;
          pageCount++;
        } else {
          nextUrl = null;
        }
      } while (nextUrl && pageCount < maxPages);
      
      const rawLeads = allRawLeads;
      
      // Process and filter leads by date
      const startDate = new Date(dateFrom);
      startDate.setHours(0, 0, 0, 0);
      const endDate = new Date(dateTo);
      endDate.setHours(23, 59, 59, 999);
      
      const processedLeads = rawLeads
        .filter(lead => {
          if (!lead.created_time) return false;
          const leadDate = new Date(lead.created_time);
          return leadDate >= startDate && leadDate <= endDate;
        })
        .map(lead => {
          const fieldData = parseFieldData(lead.field_data);
          
          let leadName = 'N/A';
          for (const [key, value] of Object.entries(fieldData)) {
            if (key && typeof key === 'string' && 
                (key.toLowerCase().includes('name') || key.includes('பெயர்')) && 
                value && value.trim() !== '') {
              leadName = value;
              break;
            }
          }
          if (leadName === 'N/A') {
            leadName = fieldData.full_name || 
                      `${fieldData.first_name || ''} ${fieldData.last_name || ''}`.trim() || 
                      fieldData.name || 'N/A';
          }
          
          let phone = 'N/A';
          for (const [key, value] of Object.entries(fieldData)) {
            if (key && typeof key === 'string' && 
                (key.toLowerCase().includes('phone') || key.toLowerCase().includes('mobile')) && 
                value && value.trim() !== '') {
              phone = value.toString();
              break;
            }
          }
          if (phone === 'N/A') {
            phone = fieldData.phone_number || fieldData.phone || fieldData.mobile_number || 'N/A';
          }

          let street = fieldData.street || fieldData.street_address || fieldData.address || findFirstValueByKeyPattern(fieldData, /street|address/i) || 'N/A';
          const city = fieldData.city || findFirstValueByKeyPattern(fieldData, /city|town/i) || 'N/A';
          const sugarPoll = fieldData['Sugar Poll'] || findFirstValueByKeyPattern(fieldData, /sugar/i) || 'N/A';

          return {
            lead_id: lead.id,
            form_id: form_id,
            created_time: lead.created_time,
            name: leadName,
            phone: phone,
            email: fieldData.email || null,
            city: city,
            street: street,
            sugar_poll: sugarPoll,
            SugarPoll: sugarPoll,
            raw_field_data: lead.field_data || [],
            // Legacy date fields for frontend compatibility
            Date: lead.created_time ? lead.created_time.split('T')[0] : '',
            Time: lead.created_time || '',
            TimeUtc: lead.created_time || '',
            DateChar: lead.created_time ? lead.created_time.split('T')[0] : '',
            // Capitalized field names for backward compatibility
            Name: leadName,
            Phone: phone,
            City: city,
            Street: street,
            // NOTE: NO ad_id, campaign_id, ad_name, campaign_name
            // Meta API does not provide these per lead
          };
        })
        .sort((a, b) => new Date(b.created_time) - new Date(a.created_time));
      
      // Only apply limit if explicitly provided and greater than 0
      // Otherwise return all filtered leads
      if (limit && parseInt(limit, 10) > 0) {
        leadsData = processedLeads.slice(0, Math.min(parseInt(limit, 10), 50000)); // Max 50k for safety
      } else {
        leadsData = processedLeads; // Return all leads if no limit specified
      }
      
    } catch (leadsError) {
      console.error(`[Leads-With-Context] Error fetching leads:`, leadsError.response?.data || leadsError.message);
      // Continue even if leads fetch fails - return empty leads with insights context
      leadsData = [];
    }

    // STEP 2: Fetch insights from Meta Insights API
    // This provides aggregated metrics at ad/campaign level
    // Used for CONTEXT only, not per-lead attribution
   
    let insightsContext = {
      campaign_name: null,
      ad_name: null,
      total_leads_from_insights: 0,
      total_spend: 0,
      date_range: { from: dateFrom, to: dateTo },
      filters_applied: {
        ad_account_id: ad_account_id || null,
        campaign_id: campaign_id || null,
        ad_id: ad_id || null
      }
    };

    try {
      // Get credentials for insights API
      const credentials = getCredentials();
      let adAccountId = ad_account_id || credentials.adAccountId;
      if (adAccountId && adAccountId.startsWith('act_')) {
        adAccountId = adAccountId.substring(4);
      }

      const insightsUrl = `https://graph.facebook.com/${META_API_VERSION}/act_${adAccountId}/insights`;
      const timeRange = JSON.stringify({ since: dateFrom, until: dateTo });
      
      // Fetch at AD level to get both campaign and ad information
      const params = {
        access_token: credentials.accessToken,
        level: "ad",
        fields: "campaign_id,campaign_name,ad_id,ad_name,actions,spend,date_start",
        time_range: timeRange,
        limit: 1000
      };

      // Apply filters if provided
      const filtering = [];
      if (campaign_id && campaign_id.trim() !== "") {
        filtering.push({
          field: "campaign.id",
          operator: "IN",
          value: [campaign_id]
        });
      }
      if (ad_id && ad_id.trim() !== "") {
        filtering.push({
          field: "ad.id",
          operator: "IN",
          value: [ad_id]
        });
      }
      if (filtering.length > 0) {
        params.filtering = JSON.stringify(filtering);
      }

      const insightsResponse = await axios.get(insightsUrl, { params });
      const insightsRows = insightsResponse.data.data || [];
      
      

      // Aggregate insights to extract context
      let totalLeads = 0;
      let totalSpend = 0;
      const campaignNames = new Set();
      const adNames = new Set();

      insightsRows.forEach(row => {
        // Extract leads count from actions
        if (Array.isArray(row.actions)) {
          row.actions.forEach(action => {
            if (action.action_type === 'lead' || 
                action.action_type === 'leads' ||
                action.action_type === 'onsite_conversion.lead_grouped') {
              totalLeads += parseFloat(action.value || 0) || 0;
            }
          });
        }

        totalSpend += parseFloat(row.spend || 0) || 0;
        
        if (row.campaign_name) campaignNames.add(row.campaign_name);
        if (row.ad_name) adNames.add(row.ad_name);
      });

      insightsContext.total_leads_from_insights = totalLeads;
      insightsContext.total_spend = totalSpend;
      
      // Prioritize showing campaign name when single campaign is selected
      if (campaign_id && campaign_id.trim() !== "" && insightsRows.length > 0) {
        // Find the campaign that matches the selected campaign_id
        const matchingCampaign = insightsRows.find(row => row.campaign_id === campaign_id || row.campaign_id?.toString() === campaign_id.toString());
        if (matchingCampaign && matchingCampaign.campaign_name) {
          insightsContext.campaign_name = matchingCampaign.campaign_name;
        } else if (campaignNames.size === 1) {
          insightsContext.campaign_name = Array.from(campaignNames)[0];
        } else if (campaignNames.size > 1) {
          insightsContext.campaign_name = `${campaignNames.size} Campaigns`;
        } else {
          insightsContext.campaign_name = null;
        }
      } else {
        // No specific campaign filter - use aggregation logic
        insightsContext.campaign_name = campaignNames.size === 1 ? Array.from(campaignNames)[0] : 
                                        campaignNames.size > 1 ? `${campaignNames.size} Campaigns` : 
                                        null;
      }
      
      // Prioritize showing ad name when single ad is selected
      if (ad_id && ad_id.trim() !== "" && insightsRows.length > 0) {
        // Find the ad that matches the selected ad_id
        const matchingAd = insightsRows.find(row => row.ad_id === ad_id || row.ad_id?.toString() === ad_id.toString());
        if (matchingAd && matchingAd.ad_name) {
          insightsContext.ad_name = matchingAd.ad_name;
        } else if (adNames.size === 1) {
          insightsContext.ad_name = Array.from(adNames)[0];
        } else if (adNames.size > 1) {
          insightsContext.ad_name = `${adNames.size} Ads`;
        } else {
          insightsContext.ad_name = null;
        }
      } else {
        // No specific ad filter - use aggregation logic
        insightsContext.ad_name = adNames.size === 1 ? Array.from(adNames)[0] : 
                                  adNames.size > 1 ? `${adNames.size} Ads` : 
                                  null;
      }

      
    } catch (insightsError) {
     
    }

    // STEP 3: Return leads with contextual metadata
    // IMPORTANT: Leads array does NOT contain ad_id/campaign_id
    // Context is provided separately for UI display only
    res.json({
      leads: leadsData,
      context: insightsContext,
      meta: {
        leads_count: leadsData.length,
        date_range: { from, to },
        form_id: form_id,
        attribution_note: "Meta Graph API does not provide per-lead ad/campaign attribution. Campaign/Ad information shown is based on filter context and aggregated insights, not individual lead attribution."
      }
    });
  } catch (err) {
    console.error("[Leads-With-Context] Error:", err.response?.data || err.message);
    
    if (err.response?.data?.error?.code === 190) {
      return res.status(401).json({
        error: "Meta Access Token expired or invalid",
        details: err.response.data.error.message,
        isAuthError: true
      });
    }

    res.status(500).json({
      error: "Failed to fetch leads with context",
      details: err.response?.data || err.message
    });
  }
});

// ---------------------------------------------------------------------
// 6) FILTERED ADS API
//    POST /api/meta/ads/filtered
//    Body: { selectedCampaignIds: string[], selectedAdIds: string[] }
// ---------------------------------------------------------------------
router.post("/ads/filtered", optionalAuthMiddleware, async (req, res) => {
  try {
    const credentials = getCredentials();
    const { selectedCampaignIds = [], selectedAdIds = [] } = req.body;

    // Ensure arrays
    const campaignIds = Array.isArray(selectedCampaignIds) ? selectedCampaignIds : [];
    const adIds = Array.isArray(selectedAdIds) ? selectedAdIds : [];

    // Fetch all ads (from cache or API)
    const now = Date.now();
    let allAds = [];

    if (adsCache.data.length > 0 && adsCache.lastFetched && (now - adsCache.lastFetched) < adsCache.ttl) {
    
      allAds = adsCache.data;
    } else {
      // Fetch fresh data
      const adsUrl = `https://graph.facebook.com/${META_API_VERSION}/act_${credentials.adAccountId}/ads`;
      const { data } = await axios.get(adsUrl, {
        params: {
          access_token: credentials.accessToken,
          fields: "id,name,status,effective_status,campaign_id",
          limit: 1000,
        },
      });

      let ads = data.data || [];

      // Fetch campaign names
      const campaignIdsFromAds = [...new Set(ads.map(ad => ad.campaign_id).filter(Boolean))];
      const campaignsMap = new Map();
      
      if (campaignIdsFromAds.length > 0) {
        try {
          const campaignsUrl = `https://graph.facebook.com/${META_API_VERSION}/act_${credentials.adAccountId}/campaigns`;
          const campaignsResp = await axios.get(campaignsUrl, {
            params: {
              access_token: credentials.accessToken,
              fields: "id,name",
              limit: 1000,
            },
          });
          
          (campaignsResp.data.data || []).forEach(campaign => {
            campaignsMap.set(campaign.id, campaign.name);
          });
        } catch (campaignErr) {
          console.warn("Error fetching campaign names:", campaignErr.message);
        }
      }

      // Enrich ads with campaign name
      allAds = ads.map(ad => ({
        id: ad.id,
        name: ad.name,
        status: ad.status,
        effective_status: ad.effective_status,
        campaign_id: ad.campaign_id,
        campaign_name: campaignsMap.get(ad.campaign_id) || null,
      }));

      // Update cache
      adsCache.data = allAds;
      adsCache.lastFetched = now;
    }

    // Apply filtering logic
    let filteredAds = allAds;

    // Filter by campaigns
    if (campaignIds.length > 0 && !campaignIds.includes("ALL")) {
      filteredAds = filteredAds.filter(ad => 
        ad.campaign_id && campaignIds.includes(ad.campaign_id)
      );
    }

    // Filter by ads
    if (adIds.length > 0 && !adIds.includes("ALL")) {
      filteredAds = filteredAds.filter(ad => 
        adIds.includes(ad.id)
      );
    }

    res.json({
      data: filteredAds,
      total: filteredAds.length,
      filters: {
        campaigns: campaignIds.includes("ALL") ? "ALL" : campaignIds,
        ads: adIds.includes("ALL") ? "ALL" : adIds,
      }
    });

  } catch (err) {
    console.error("Meta API Filtered Ads Error:", err.response?.data || err.message);

    if (err.response?.data?.error?.code === 190) {
      return res.status(401).json({
        error: "Meta Access Token expired or invalid",
        details: err.response.data.error.message,
        isAuthError: true,
        instruction: "Please update META_ACCESS_TOKEN in server/.env"
      });
    }

    res.status(500).json({
      error: "Failed to fetch filtered ads",
      details: err.response?.data || err.message,
    });
  }
});

// ---------------------------------------------------------------------
// 7) CLEAR CACHE API (for testing/debugging)
//    POST /api/meta/cache/clear
// ---------------------------------------------------------------------
router.post("/cache/clear", optionalAuthMiddleware, (req, res) => {
  campaignsCache = { data: [], lastFetched: null, ttl: 5 * 60 * 1000 };
  adsCache = { data: [], lastFetched: null, ttl: 5 * 60 * 1000 };
  res.json({ success: true, message: "Cache cleared" });
});

module.exports = router;
