/**
 * Wix Analytics Service
 * Fetches site analytics from Wix Analytics Data API and normalizes to dashboard row shape.
 * Credentials: WIX_SITE_ID and WIX_TOKEN in server .env (never in client).
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const axios = require('axios');

const WIX_ANALYTICS_BASE = 'https://www.wixapis.com/analytics/v2/site-analytics';

const MEASUREMENT_TYPES = [
  'TOTAL_SESSIONS',
  'TOTAL_UNIQUE_VISITORS',
  'CLICKS_TO_CONTACT',
  'TOTAL_FORMS_SUBMITTED',
];

/**
 * Get Wix credentials from env.
 * @returns {{ siteId: string, token: string }}
 */
function getWixCredentials() {
  const siteId = (process.env.WIX_SITE_ID || '').trim();
  const token = (process.env.WIX_TOKEN || '').trim();
  if (!siteId || !token) {
    throw new Error('Wix credentials missing. Set WIX_SITE_ID and WIX_TOKEN in server/.env');
  }
  return { siteId, token };
}

/**
 * Serialize params for Wix API - measurementTypes as repeated params (not array notation).
 */
function buildWixQueryString(params) {
  const parts = [];
  parts.push(`startDate=${encodeURIComponent(params.startDate)}`);
  parts.push(`endDate=${encodeURIComponent(params.endDate)}`);
  (params.measurementTypes || []).forEach((m) => parts.push(`measurementTypes=${encodeURIComponent(m)}`));
  return parts.join('&');
}

/**
 * Fetch analytics from Wix API and return normalized rows for the dashboard.
 * Wix stores analytics for 62 days; requests beyond that may error.
 * @param {{ from: string, to: string, diagnose?: boolean }} options - from/to as YYYY-MM-DD
 * @returns {Promise<{ rows: Array<object>, error?: string, raw?: object }>}
 */
const WIX_MAX_DAYS = 62;

function clampDateRange(from, to) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const maxStart = new Date(today);
  maxStart.setDate(maxStart.getDate() - WIX_MAX_DAYS);
  const fromDate = new Date(from + 'T00:00:00Z');
  const toDate = new Date(to + 'T00:00:00Z');
  let clampedFrom = from;
  let clampedTo = to;
  if (toDate > today) clampedTo = today.toISOString().slice(0, 10);
  if (fromDate < maxStart) clampedFrom = maxStart.toISOString().slice(0, 10);
  if (fromDate > toDate) clampedFrom = clampedTo;
  return { from: clampedFrom, to: clampedTo };
}

async function fetchWixAnalytics({ from, to, diagnose = false }) {
  const { siteId, token } = getWixCredentials();

  const { from: fromClamped, to: toClamped } = clampDateRange(from, to);
  if (fromClamped !== from || toClamped !== to) {
    console.warn('[Wix] Date range clamped to last 62 days:', { from, to, fromClamped, toClamped });
  }

  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'wix-site-id': siteId,
  };

  const doRequest = async (withMeasurementTypes) => {
    const params = { startDate: fromClamped, endDate: toClamped };
    if (withMeasurementTypes) params.measurementTypes = MEASUREMENT_TYPES;
    const queryString = buildWixQueryString(params);
    const url = `${WIX_ANALYTICS_BASE}/data?${queryString}`;
    return axios.get(url, {
      headers,
      timeout: 15000,
      validateStatus: (status) => status < 500,
    });
  };

  let response;
  try {
    response = await doRequest(true);
  } catch (err) {
    console.error('[Wix] API request failed:', err.message);
    if (err.response) {
      console.error('[Wix] Response status:', err.response.status, JSON.stringify(err.response.data)?.slice(0, 500));
    }
    return { rows: [], error: err.message || 'Wix API request failed' };
  }

  if (response.status === 401 || response.status === 403) {
    const msg = `Auth error (${response.status}). Ensure WIX_TOKEN has "Site Analytics - read" permission.`;
    console.error('[Wix]', msg, response.data);
    return { rows: [], error: msg };
  }

  if (response.status === 400) {
    const wixDetails = response.data?.details || response.data?.message || JSON.stringify(response.data);
    console.warn('[Wix] 400 Bad Request. Wix response:', wixDetails);
    // Try fallback with only core measurement types (some Wix API versions reject TOTAL_UNIQUE_VISITORS or TOTAL_FORMS_SUBMITTED)
    const coreTypes = ['TOTAL_SESSIONS', 'CLICKS_TO_CONTACT'];
    const doRequestCore = async () => {
      const params = { startDate: fromClamped, endDate: toClamped, measurementTypes: coreTypes };
      const qs = buildWixQueryString(params);
      const url = `${WIX_ANALYTICS_BASE}/data?${qs}`;
      return axios.get(url, { headers, timeout: 15000, validateStatus: (s) => s < 500 });
    };
    try {
      response = await doRequestCore();
    } catch (fallbackErr) {
      return { rows: [], error: `Wix API 400: ${wixDetails || 'Invalid request. Ensure date range is within last 62 days (YYYY-MM-DD).'}` };
    }
    if (response.status === 400) {
      try {
        response = await doRequest(false);
      } catch (e) {
        return { rows: [], error: `Wix API 400: ${wixDetails || 'Invalid date range or parameters. Wix stores analytics for 62 days only.'}` };
      }
    }
    if (response.status !== 200) {
      const fallbackDetails = response.data?.details || response.data?.message || '';
      return { rows: [], error: `Wix API error: 400. ${fallbackDetails || 'Check date range (last 62 days).'}` };
    }
  } else if (response.status !== 200) {
    console.error('[Wix] API error:', response.status, JSON.stringify(response.data)?.slice(0, 500));
    return { rows: [], error: `Wix API error: ${response.status}` };
  }

  const data = response.data;
  const rows = normalizeWixResponse(data, fromClamped, toClamped);
  const result = { rows };
  if (diagnose) result.raw = data;
  return result;
}

/**
 * Extract numeric value from a data point, supporting multiple field names.
 */
function getMetric(point, ...keys) {
  for (const k of keys) {
    const v = point?.[k];
    if (v !== undefined && v !== null) return Number(v);
  }
  return 0;
}

/**
 * Normalize Wix API response to dashboard row shape (one row per date or one aggregated row).
 * Handles: { data: { dataPoints } }, { dataPoints }, per-measurement-type arrays, and flat aggregates.
 */
function normalizeWixResponse(data, from, to) {
  const rows = [];

  // 1. Try standard dataPoints array: data.data.dataPoints or data.dataPoints or data.data
  let dataPoints = data?.data?.dataPoints ?? data?.dataPoints ?? data?.data;

  // 2. Per-measurement-type structure: data.data has TOTAL_SESSIONS, TOTAL_UNIQUE_VISITORS, etc. each with dataPoints
  if (!Array.isArray(dataPoints) && data?.data && typeof data.data === 'object') {
    const inner = data.data;
    const sessionsArr = inner.TOTAL_SESSIONS?.dataPoints ?? inner.totalSessions?.dataPoints;
    const visitorsArr = inner.TOTAL_UNIQUE_VISITORS?.dataPoints ?? inner.totalUniqueVisitors?.dataPoints;
    const clicksArr = inner.CLICKS_TO_CONTACT?.dataPoints ?? inner.clicksToContact?.dataPoints;
    const formsArr = inner.TOTAL_FORMS_SUBMITTED?.dataPoints ?? inner.totalFormsSubmitted?.dataPoints;

    if (Array.isArray(sessionsArr) || Array.isArray(visitorsArr) || Array.isArray(clicksArr) || Array.isArray(formsArr)) {
      const byDate = new Map();
      const merge = (arr, key, fieldNames) => {
        if (!Array.isArray(arr)) return;
        arr.forEach((p) => {
          const date = (p.date ?? p.startDate ?? p.endDate ?? from).toString().slice(0, 10);
          let val = 0;
          for (const fn of fieldNames) {
            const v = p[fn];
            if (v !== undefined && v !== null) { val = Number(v); break; }
          }
          if (!byDate.has(date)) byDate.set(date, { date, sessions: 0, uniqueVisitors: 0, clicksToContact: 0, formsSubmitted: 0 });
          const row = byDate.get(date);
          if (key === 'sessions') row.sessions = val;
          else if (key === 'uniqueVisitors') row.uniqueVisitors = val;
          else if (key === 'clicksToContact') row.clicksToContact = val;
          else if (key === 'formsSubmitted') row.formsSubmitted = val;
        });
      };
      merge(sessionsArr, 'sessions', ['value', 'count', 'total', 'TOTAL_SESSIONS', 'totalSessions']);
      merge(visitorsArr, 'uniqueVisitors', ['value', 'count', 'total', 'TOTAL_UNIQUE_VISITORS', 'totalUniqueVisitors']);
      merge(clicksArr, 'clicksToContact', ['value', 'count', 'total', 'CLICKS_TO_CONTACT', 'clicksToContact']);
      merge(formsArr, 'formsSubmitted', ['value', 'count', 'total', 'TOTAL_FORMS_SUBMITTED', 'totalFormsSubmitted']);
      dataPoints = Array.from(byDate.values());
      if (dataPoints.length === 0) dataPoints = null;
    }
  }

  if (Array.isArray(dataPoints) && dataPoints.length > 0) {
    dataPoints.forEach((point) => {
      const date = (point.date ?? point.startDate ?? point.endDate ?? from)?.toString?.()?.slice(0, 10) ?? from;
      const sessions = getMetric(point, 'totalSessions', 'sessions', 'TOTAL_SESSIONS');
      const uniqueVisitors = getMetric(point, 'totalUniqueVisitors', 'uniqueVisitors', 'TOTAL_UNIQUE_VISITORS');
      const clicksToContact = getMetric(point, 'clicksToContact', 'clicks', 'CLICKS_TO_CONTACT');
      const formsSubmitted = getMetric(point, 'totalFormsSubmitted', 'formsSubmitted', 'TOTAL_FORMS_SUBMITTED', 'leads');

      rows.push(normalizeRow({
        date,
        sessions,
        uniqueVisitors,
        formViews: getMetric(point, 'formViews', 'FORM_VIEWS'),
        formSubmissions: formsSubmitted,
        clicksToContact,
        impressions: sessions || uniqueVisitors,
        clicks: clicksToContact,
        leads: formsSubmitted,
      }));
    });
    return rows;
  }

  // 3. Single aggregate or flat metrics at top level or data level
  const src = data?.data && typeof data.data === 'object' ? data.data : data;
  if (src && typeof src === 'object' && !Array.isArray(src)) {
    const sessions = getMetric(src, 'totalSessions', 'sessions', 'TOTAL_SESSIONS');
    const uniqueVisitors = getMetric(src, 'totalUniqueVisitors', 'uniqueVisitors', 'TOTAL_UNIQUE_VISITORS');
    const clicksToContact = getMetric(src, 'clicksToContact', 'clicks', 'CLICKS_TO_CONTACT');
    const formsSubmitted = getMetric(src, 'totalFormsSubmitted', 'formsSubmitted', 'TOTAL_FORMS_SUBMITTED', 'leads');
    if (sessions > 0 || uniqueVisitors > 0 || clicksToContact > 0 || formsSubmitted > 0) {
      rows.push(normalizeRow({
        date: from,
        sessions,
        uniqueVisitors,
        formViews: getMetric(src, 'formViews', 'FORM_VIEWS'),
        formSubmissions: formsSubmitted,
        clicksToContact,
        impressions: sessions || uniqueVisitors,
        clicks: clicksToContact,
        leads: formsSubmitted,
      }));
      return rows;
    }
  }

  // 4. Unexpected structure: log for debugging
  if (data && typeof data === 'object' && Object.keys(data).length > 0) {
    console.warn('[Wix] Unexpected API response structure. Keys:', Object.keys(data));
    if (data.data && typeof data.data === 'object') {
      console.warn('[Wix] data.data keys:', Object.keys(data.data));
    }
  }

  // 5. No data: emit one row so platform filter and KPIs don't break
  rows.push(normalizeRow({ date: from, sessions: 0, uniqueVisitors: 0, formViews: 0, formSubmissions: 0, clicksToContact: 0, impressions: 0, clicks: 0, leads: 0 }));
  return rows;
}

function normalizeRow({ date, impressions = 0, clicks = 0, leads = 0, sessions, uniqueVisitors, formViews = 0, formSubmissions, clicksToContact }) {
  const spend = 0;
  const ctr = impressions > 0 ? (clicks / impressions) * 100 : 0;
  const cpl = leads > 0 ? spend / leads : 0;

  return {
    campaign_id: 'wix-site',
    campaign: 'Wix Site',
    ad_id: null,
    ad_name: 'Wix Analytics',
    date: typeof date === 'string' ? date.slice(0, 10) : date,
    spend,
    impressions,
    clicks,
    leads,
    sessions: sessions ?? impressions,
    unique_visitors: uniqueVisitors ?? 0,
    form_views: formViews ?? 0,
    form_submissions: formSubmissions ?? leads,
    clicks_to_contact: clicksToContact ?? clicks,
    conversions: 0,
    ctr,
    cpl,
    hookRate: 0,
    holdRate: 0,
    videoViews: 0,
    video3sViews: 0,
    videoThruPlays: 0,
    actions: {},
    action_values: {},
    campaign_status: 'ACTIVE',
    ad_status: 'ACTIVE',
    lead_details: [],
    platform: 'wix',
    platform_id: 'wix',
  };
}

module.exports = {
  fetchWixAnalytics,
  getWixCredentials,
};
