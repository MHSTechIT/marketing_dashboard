/**
 * Campaigns service: /act_{id}/campaigns → cache 24h+ in DB. UI reads from DB.
 * Per Meta: GET /act_{ad_account_id}/campaigns with fields id,name,status,effective_status,objective.
 */

const axios = require('axios');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });
const { schedule, isMetaRateLimitError } = require('./rateLimiter');
const campaignsRepo = require('../../repositories/metaCampaignsRepository');

const META_API_VERSION = process.env.META_API_VERSION || 'v21.0';
const CACHE_TTL_MS = campaignsRepo.CACHE_TTL_MS || 24 * 60 * 60 * 1000;

function getAccessToken() {
  const t = (process.env.META_ACCESS_TOKEN || '').trim();
  if (!t) throw new Error('META_ACCESS_TOKEN required');
  return t;
}

function normalizeId(id) {
  return id && String(id).replace(/^act_/, '') || '';
}

/**
 * Fetch campaigns from Meta for one ad account and upsert into DB.
 * @param {string} adAccountId - Numeric, no act_ prefix
 */
async function fetchAndCache(adAccountId) {
  const accId = normalizeId(adAccountId);
  if (!accId) throw new Error('ad_account_id required');
  const accessToken = getAccessToken();
  const url = `https://graph.facebook.com/${META_API_VERSION}/act_${accId}/campaigns`;

  const run = async () => {
    const { data } = await axios.get(url, {
      params: {
        access_token: accessToken,
        fields: 'id,name,status,effective_status,objective',
        limit: 1000,
      },
      timeout: 20000,
    });
    const campaigns = (data && data.data) ? data.data : [];
    await campaignsRepo.upsert(accId, campaigns);
    return campaignsRepo.list(accId);
  };

  return schedule(run);
}

/**
 * List campaigns from DB for ad account(s). If stale (>24h), refresh from API then return.
 * @param {string|string[]} adAccountIds - Single id or array (no act_)
 * @param {object} opts - { forceRefresh: boolean }
 */
async function list(adAccountIds, opts = {}) {
  const ids = Array.isArray(adAccountIds) ? adAccountIds : [adAccountIds];
  const valid = ids.map(normalizeId).filter(Boolean);
  if (valid.length === 0) return [];

  const fromDb = await campaignsRepo.list(valid);
  if (opts.forceRefresh) {
    for (const id of valid) {
      await fetchAndCache(id).catch((e) => console.warn('[campaignsService] refresh failed for', id, e.message));
    }
    return campaignsRepo.list(valid);
  }

  const oldest = await campaignsRepo.oldestUpdatedAt(valid);
  const now = Date.now();
  if (oldest != null && now - oldest < CACHE_TTL_MS && fromDb.length > 0) {
    return fromDb;
  }
  // Stale or empty: refresh each account
  for (const id of valid) {
    try {
      await fetchAndCache(id);
    } catch (e) {
      if (isMetaRateLimitError(e)) {
        return fromDb.length > 0 ? fromDb : [];
      }
      console.warn('[campaignsService] fetch failed for', id, e.message);
    }
  }
  return campaignsRepo.list(valid);
}

module.exports = {
  fetchAndCache,
  list,
  getAccessToken,
  isMetaRateLimitError,
  CACHE_TTL_MS,
};
