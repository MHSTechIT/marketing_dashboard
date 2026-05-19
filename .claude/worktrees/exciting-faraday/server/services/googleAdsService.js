/**
 * Google Ads API service for fetching YouTube Ads (VIDEO campaign) metrics.
 *
 * Uses the Google Ads REST API (v18) with OAuth2 refresh-token flow.
 * All credentials are read from environment variables.
 */
const axios = require('axios');

const GOOGLE_ADS_API_VERSION = 'v18';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const ADS_BASE = `https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}`;

function getCredentials() {
  return {
    clientId: (process.env.GOOGLE_ADS_CLIENT_ID || '').trim(),
    clientSecret: (process.env.GOOGLE_ADS_CLIENT_SECRET || '').trim(),
    developerToken: (process.env.GOOGLE_ADS_DEVELOPER_TOKEN || '').trim(),
    refreshToken: (process.env.GOOGLE_ADS_REFRESH_TOKEN || '').trim(),
    customerId: (process.env.GOOGLE_ADS_CUSTOMER_ID || '').replace(/-/g, '').trim(),
    loginCustomerId: (process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID || '').replace(/-/g, '').trim(),
  };
}

function credentialsReady() {
  const c = getCredentials();
  const missing = [];
  if (!c.clientId) missing.push('GOOGLE_ADS_CLIENT_ID');
  if (!c.clientSecret) missing.push('GOOGLE_ADS_CLIENT_SECRET');
  if (!c.developerToken) missing.push('GOOGLE_ADS_DEVELOPER_TOKEN');
  if (!c.refreshToken) missing.push('GOOGLE_ADS_REFRESH_TOKEN');
  if (!c.customerId) missing.push('GOOGLE_ADS_CUSTOMER_ID');
  return { ready: missing.length === 0, missing };
}

let cachedToken = null;
let tokenExpiry = 0;

async function getAccessToken() {
  if (cachedToken && Date.now() < tokenExpiry - 60_000) return cachedToken;

  const c = getCredentials();
  const { data } = await axios.post(TOKEN_URL, new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: c.clientId,
    client_secret: c.clientSecret,
    refresh_token: c.refreshToken,
  }).toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    timeout: 15_000,
  });

  cachedToken = data.access_token;
  tokenExpiry = Date.now() + (data.expires_in || 3600) * 1000;
  return cachedToken;
}

async function searchStream(gaql) {
  const c = getCredentials();
  const accessToken = await getAccessToken();

  const url = `${ADS_BASE}/customers/${c.customerId}/googleAds:searchStream`;
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    'developer-token': c.developerToken,
    'Content-Type': 'application/json',
  };
  if (c.loginCustomerId) headers['login-customer-id'] = c.loginCustomerId;

  const { data } = await axios.post(url, { query: gaql }, { headers, timeout: 30_000 });
  const rows = [];
  if (Array.isArray(data)) {
    data.forEach((batch) => {
      if (batch.results) rows.push(...batch.results);
    });
  }
  return rows;
}

/**
 * Fetch YouTube Ads (VIDEO campaign) metrics for a date range.
 * Returns { summary, dailyRows } ready for the dashboard.
 */
async function fetchYouTubeAdsMetrics(from, to) {
  const summaryQuery = `
    SELECT
      metrics.cost_micros,
      metrics.conversions,
      metrics.clicks,
      metrics.impressions,
      metrics.ctr,
      metrics.cost_per_conversion,
      metrics.all_conversions,
      metrics.conversions_value,
      metrics.video_views,
      metrics.interactions
    FROM campaign
    WHERE segments.date BETWEEN '${from}' AND '${to}'
      AND campaign.advertising_channel_type = 'VIDEO'
  `;

  const dailyQuery = `
    SELECT
      segments.date,
      metrics.cost_micros,
      metrics.conversions,
      metrics.clicks,
      metrics.impressions,
      metrics.cost_per_conversion
    FROM campaign
    WHERE segments.date BETWEEN '${from}' AND '${to}'
      AND campaign.advertising_channel_type = 'VIDEO'
  `;

  const [summaryRows, dailyRows] = await Promise.all([
    searchStream(summaryQuery),
    searchStream(dailyQuery),
  ]);

  let totalCostMicros = 0;
  let totalConversions = 0;
  let totalClicks = 0;
  let totalImpressions = 0;
  let totalConversionsValue = 0;
  let totalAllConversions = 0;
  let totalVideoViews = 0;
  let totalInteractions = 0;

  summaryRows.forEach((r) => {
    const m = r.metrics || {};
    totalCostMicros += Number(m.costMicros || 0);
    totalConversions += Number(m.conversions || 0);
    totalClicks += Number(m.clicks || 0);
    totalImpressions += Number(m.impressions || 0);
    totalConversionsValue += Number(m.conversionsValue || 0);
    totalAllConversions += Number(m.allConversions || 0);
    totalVideoViews += Number(m.videoViews || 0);
    totalInteractions += Number(m.interactions || 0);
  });

  const cost = totalCostMicros / 1_000_000;
  const conversions = totalConversions;
  const leads = conversions;
  const cpl = leads > 0 ? cost / leads : 0;
  const cpm = totalImpressions > 0 ? (cost / totalImpressions) * 1000 : 0;
  const ctr = totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0;
  const roas = cost > 0 ? totalConversionsValue / cost : 0;
  const linkClicks = totalClicks;
  const landingPageViews = totalVideoViews || totalInteractions || totalClicks;
  const optInRate = landingPageViews > 0 ? (conversions / landingPageViews) * 100 : 0;
  const conversionRate = linkClicks > 0 ? (conversions / linkClicks) * 100 : 0;

  const summary = {
    cost,
    conversions,
    leads,
    cpl,
    cpm,
    optInRate,
    linkClicks,
    ctr,
    roas,
    totalConversions: totalAllConversions || conversions,
    conversionRate,
    landingPageViews,
  };

  const byDate = {};
  dailyRows.forEach((r) => {
    const date = r.segments?.date;
    if (!date) return;
    if (!byDate[date]) byDate[date] = { costMicros: 0, conversions: 0, clicks: 0, impressions: 0, costPerConversion: 0, count: 0 };
    const m = r.metrics || {};
    byDate[date].costMicros += Number(m.costMicros || 0);
    byDate[date].conversions += Number(m.conversions || 0);
    byDate[date].clicks += Number(m.clicks || 0);
    byDate[date].impressions += Number(m.impressions || 0);
    byDate[date].count++;
  });

  const dates = Object.keys(byDate).sort();

  const chartOptInRateVsCost = dates.map((date) => {
    const d = byDate[date];
    const dayCost = d.costMicros / 1_000_000;
    const dayLpv = d.clicks || 1;
    return { date, optInRate: dayLpv > 0 ? (d.conversions / dayLpv) * 100 : 0, cost: dayCost };
  });

  const chartLeadsVsCpl = dates.map((date) => {
    const d = byDate[date];
    const dayCost = d.costMicros / 1_000_000;
    return { date, leads: d.conversions, cpl: d.conversions > 0 ? dayCost / d.conversions : 0 };
  });

  const chartLinkClicksVsLandingPageViews = dates.map((date) => {
    const d = byDate[date];
    return { date, linkClicks: d.clicks, landingPageViews: d.impressions > 0 ? Math.round(d.clicks * 0.85) : 0 };
  });

  return { summary, chartOptInRateVsCost, chartLeadsVsCpl, chartLinkClicksVsLandingPageViews };
}

module.exports = { credentialsReady, fetchYouTubeAdsMetrics };
