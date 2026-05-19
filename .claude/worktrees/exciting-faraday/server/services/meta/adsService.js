/**
 * Ads service: /act_{id}/ads fetched ONCE per account, stored in DB. Never fetch on filter change.
 * Per Meta: GET /act_{ad_account_id}/ads with fields id,name,status,effective_status,campaign_id.
 * UI and filter changes read from DB only. Sync via explicit refresh or job.
 */

const axios = require('axios');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });
const { schedule, isMetaRateLimitError } = require('./rateLimiter');
const adsRepo = require('../../repositories/metaAdsRepository');

const META_API_VERSION = process.env.META_API_VERSION || 'v21.0';

function getAccessToken() {
  const t = (process.env.META_ACCESS_TOKEN || '').trim();
  if (!t) throw new Error('META_ACCESS_TOKEN required');
  return t;
}

function normalizeId(id) {
  return id && String(id).replace(/^act_/, '') || '';
}

/**
 * Fetch all ads for one ad account from Meta and upsert into DB. Call this once per account (or on refresh).
 * @param {string} adAccountId - Numeric, no act_ prefix
 */
async function fetchAndCache(adAccountId) {
  const accId = normalizeId(adAccountId);
  if (!accId) throw new Error('ad_account_id required');
  const accessToken = getAccessToken();
  const url = `https://graph.facebook.com/${META_API_VERSION}/act_${accId}/ads`;

  const run = async () => {
    const { data } = await axios.get(url, {
      params: {
        access_token: accessToken,
        fields: 'id,name,status,effective_status,campaign_id',
        limit: 1000,
      },
      timeout: 20000,
    });
    const ads = (data && data.data) ? data.data : [];
    await adsRepo.upsert(accId, ads);
    return adsRepo.list(accId);
  };

  return schedule(run);
}

/**
 * List ads from DB only. No Meta call on filter change.
 * @param {string|string[]} adAccountIds - Single id or array (no act_)
 * @param {object} opts - { campaign_ids: string[] } optional filter by campaigns
 */
async function listFromDb(adAccountIds, opts = {}) {
  return adsRepo.list(adAccountIds, opts);
}

module.exports = {
  fetchAndCache,
  listFromDb,
  getAccessToken,
  isMetaRateLimitError,
};
