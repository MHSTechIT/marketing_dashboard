// server/jobs/insightsSync.js
const axios = require('axios');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { upsertInsights } = require('../repositories/insightsRepository');

const META_API_VERSION = process.env.META_API_VERSION || 'v21.0';

function getAccessToken() {
  const token = (process.env.META_ACCESS_TOKEN || '').trim();
  if (!token) {
    throw new Error('META_ACCESS_TOKEN missing. Configure it in server/.env');
  }
  return token;
}

function getAdAccountId() {
  let id = (process.env.META_AD_ACCOUNT_ID || '').trim();
  if (!id) {
    throw new Error('META_AD_ACCOUNT_ID missing. Configure it in server/.env');
  }
  if (id.startsWith('act_')) {
    id = id.substring(4);
  }
  return id;
}

/**
 * Fetch all ad account IDs and names from Meta API (me/adaccounts).
 * Handles pagination to get ALL accounts, not just the first page.
 * @returns {Promise<Array<{id: string, name: string}>>} - Array of { id (numeric, no act_), name }
 */
async function fetchAllAdAccountIds() {
  const accessToken = getAccessToken();
  const url = `https://graph.facebook.com/${META_API_VERSION}/me/adaccounts`;
  
  let allAccounts = [];
  let currentParams = {
    access_token: accessToken,
    fields: 'account_id,name',
    limit: 100,
  };
  let pageCount = 0;
  const maxPages = 10; // Safety limit

  do {
    const resp = await axios.get(url, {
      params: currentParams,
      timeout: 15000,
    });
    
    const data = resp.data && resp.data.data ? resp.data.data : [];
    allAccounts = allAccounts.concat(data);
    
    // Check for pagination
    const nextUrl = resp.data.paging && resp.data.paging.next;
    if (nextUrl && pageCount < maxPages) {
      const urlObj = new URL(resp.data.paging.next);
      currentParams = {
        ...currentParams,
        after: urlObj.searchParams.get('after'),
      };
      pageCount++;
    } else {
      break;
    }
  } while (true);

  console.log(`[fetchAllAdAccountIds] Fetched ${allAccounts.length} ad accounts from Meta API (${pageCount + 1} page(s))`);
  
  const normalized = allAccounts.map((acc) => {
    let id = (acc.account_id != null ? acc.account_id : acc.id || '').toString();
    if (id.startsWith('act_')) id = id.substring(4);
    const name = (acc.name || acc.account_name || '').toString().trim() || `Account ${id}`;
    return { id, name };
  }).filter((a) => a.id);
  
  if (normalized.length > 0) {
    console.log(`[fetchAllAdAccountIds] Accounts: ${normalized.map(a => `${a.name} (${a.id})`).join(', ')}`);
  }
  
  return normalized;
}

/**
 * Fetch ad account display name from Meta API.
 * @param {string} adAccountId - Ad account ID (no act_ prefix)
 * @returns {Promise<string>} - Account name or empty string on failure
 */
async function fetchAdAccountName(adAccountId) {
  try {
    const accessToken = getAccessToken();
    const url = `https://graph.facebook.com/${META_API_VERSION}/act_${adAccountId}`;
    const resp = await axios.get(url, {
      params: { access_token: accessToken, fields: 'name' },
      timeout: 10000,
    });
    return (resp.data && resp.data.name) ? String(resp.data.name) : '';
  } catch (err) {
    return '';
  }
}

/**
 * Fetch insights from Meta API for a date range. Uses ad-level, all statuses, no campaign/ad filters.
 * @param {string} adAccountId - Ad account ID (no act_ prefix)
 * @param {string} since - YYYY-MM-DD
 * @param {string} until - YYYY-MM-DD
 * @returns {Promise<object[]>} - Array of Meta insight objects
 */
async function fetchInsightsFromMeta(adAccountId, since, until) {
  const accessToken = getAccessToken();
  const url = `https://graph.facebook.com/${META_API_VERSION}/act_${adAccountId}/insights`;
  const timeRange = JSON.stringify({ since, until });

  const params = {
    access_token: accessToken,
    level: 'ad',
    fields: 'ad_id,ad_name,campaign_id,campaign_name,impressions,clicks,spend,ctr,cpc,actions,action_values,date_start,date_stop,video_play_actions,video_p25_watched_actions,video_p50_watched_actions,video_p75_watched_actions,video_p100_watched_actions',
    limit: 1000,
    time_range: timeRange,
    time_increment: 1,
    // No effective_status filter — matches Meta Ads Manager historical totals exactly
  };

  let allInsights = [];
  let currentParams = { ...params };
  let pageCount = 0;
  const maxPages = 20;

  do {
    const response = await axios.get(url, { params: currentParams, timeout: 60000 });
    const responseData = response.data;

    if (Array.isArray(responseData.data)) {
      allInsights = allInsights.concat(responseData.data);
    } else if (Array.isArray(responseData)) {
      allInsights = allInsights.concat(responseData);
    }

    const nextUrl = responseData.paging && responseData.paging.next;
    if (nextUrl && pageCount < maxPages) {
      const urlObj = new URL(responseData.paging.next);
      currentParams = { ...params, after: urlObj.searchParams.get('after') };
      pageCount++;
    } else {
      break;
    }
  } while (true);

  return allInsights;
}

/**
 * Run sync for a given date range: fetch from Meta and upsert into DB.
 * @param {string} adAccountId - Ad account ID (no act_ prefix)
 * @param {string} from - YYYY-MM-DD
 * @param {string} to - YYYY-MM-DD
 */
async function runInsightsSyncForRange(adAccountId, from, to) {
  const adAccountName = await fetchAdAccountName(adAccountId);
  const insights = await fetchInsightsFromMeta(adAccountId, from, to);
  if (insights.length === 0) {
    return { count: 0 };
  }
  await upsertInsights(adAccountId, insights, { adAccountName });
  return { count: insights.length };
}

/**
 * Sync job: fetch last 1.5 hours of data (as date range) and upsert for all ad accounts. Run every 1 hour.
 */
async function runInsightsSync() {
  let accounts;
  try {
    accounts = await fetchAllAdAccountIds();
    console.log(`[InsightsSync] Found ${accounts.length} ad accounts to sync`);
  } catch (e) {
    console.warn('[InsightsSync] Skipping: could not fetch ad accounts.', e.message);
    return;
  }
  if (!accounts || accounts.length === 0) {
    console.warn('[InsightsSync] No ad accounts from Meta, skipping insights sync.');
    return;
  }

  const now = new Date();
  const start = new Date(now.getTime() - 90 * 60 * 1000);
  const since = start.toISOString().slice(0, 10);
  const until = now.toISOString().slice(0, 10);

  console.log(`[InsightsSync] Starting sync for ${accounts.length} accounts, date range: ${since}..${until}`);
  let totalRows = 0;
  for (const { id, name } of accounts) {
    try {
      const { count } = await runInsightsSyncForRange(id, since, until);
      totalRows += count;
      if (count > 0) {
        console.log(`[InsightsSync] ✓ ${name} (${id}): ${count} rows for ${since}..${until}`);
      } else {
        console.log(`[InsightsSync] - ${name} (${id}): no new data for ${since}..${until}`);
      }
    } catch (err) {
      console.error(`[InsightsSync] ✗ Error for account ${id} (${name}):`, err.response?.data || err.message);
    }
  }
  console.log(`[InsightsSync] Completed: ${accounts.length} accounts processed, total ${totalRows} rows synced for ${since}..${until}`);
}

/**
 * Start scheduler: run on startup, then every 1 hour. Requires only META_ACCESS_TOKEN.
 */
function startInsightsSyncScheduler() {
  try {
    getAccessToken();
  } catch (e) {
    console.warn('[InsightsSync] Scheduler not started: META_ACCESS_TOKEN required.');
    return null;
  }

  runInsightsSync().catch((err) => console.error('[InsightsSync] Initial run failed:', err.message));
  const intervalId = setInterval(() => {
    runInsightsSync().catch((err) => console.error('[InsightsSync] Scheduled run failed:', err.message));
  }, 60 * 60 * 1000);

  return intervalId;
}

module.exports = {
  fetchAllAdAccountIds,
  fetchInsightsFromMeta,
  runInsightsSyncForRange,
  runInsightsSync,
  startInsightsSyncScheduler,
};
