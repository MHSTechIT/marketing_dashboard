/**
 * Demographic Insights Service — Auto-split Meta Ads Insights API requests by valid breakdown combinations.
 *
 * Due to Meta Ads Insights API restrictions, demographic breakdowns are fetched using multiple API calls
 * and merged internally, replicating Ads Manager behavior.
 *
 * Allowed: age+gender, age only, gender only, country only.
 * NOT allowed: age+gender+country, age+country, gender+country (Meta returns #100).
 */

const axios = require('axios');

const META_API_VERSION = process.env.META_API_VERSION || 'v21.0';

// Fields must contain ONLY metrics (never breakdowns). Safe set for demographic requests.
const METRIC_FIELDS = 'impressions,reach,spend';
const METRIC_FIELDS_WITH_DATE = 'date_start,date_stop,impressions,reach,spend';

const STATUS_FILTER = [
  { field: 'campaign.effective_status', operator: 'IN', value: ['ACTIVE', 'PAUSED', 'ARCHIVED', 'IN_REVIEW', 'REJECTED', 'PENDING_REVIEW', 'LEARNING', 'ENDED'] },
  { field: 'ad.effective_status', operator: 'IN', value: ['ACTIVE', 'PAUSED', 'ARCHIVED', 'IN_REVIEW', 'REJECTED', 'PENDING_REVIEW', 'LEARNING', 'ENDED'] },
];

/** Allowed breakdown combinations (each entry is a valid set Meta accepts in one call). */
const ALLOWED_COMBINATIONS = [
  ['age', 'gender'],
  ['age'],
  ['gender'],
  ['country'],
  ['region'],
];

/** Invalid combinations that trigger Meta #100 — never send these. */
const INVALID_COMBINATIONS = [
  ['age', 'gender', 'country'],
  ['age', 'country'],
  ['gender', 'country'],
];

/**
 * Normalize breakdown list: lowercase, unique, only known keys.
 */
function normalizeBreakdowns(breakdowns) {
  const known = new Set(['age', 'gender', 'country', 'region']);
  if (!Array.isArray(breakdowns)) return [];
  return [...new Set(breakdowns.map((b) => String(b).toLowerCase().trim()).filter((b) => known.has(b)))];
}

/**
 * Check if a single combination (e.g. ['age','gender']) is invalid per Meta rules.
 */
function isInvalidCombination(combo) {
  const set = new Set(combo.map((c) => c.toLowerCase()));
  return INVALID_COMBINATIONS.some(
    (invalid) => invalid.length === set.size && invalid.every((k) => set.has(k))
  );
}

/**
 * Check if a combination is explicitly allowed (exact match to an allowed combo).
 */
function isAllowedCombination(combo) {
  const set = new Set(combo.map((c) => c.toLowerCase()));
  return ALLOWED_COMBINATIONS.some(
    (allowed) => allowed.length === set.size && allowed.every((k) => set.has(k))
  );
}

/**
 * Validate requested breakdowns and split into which API calls to make.
 * Never returns invalid combinations; only age+gender and country as separate calls.
 *
 * @param {string[]} requestedBreakdowns - e.g. ["age", "gender", "country", "region"]
 * @returns {{ ageGender: boolean, country: boolean, region: boolean, skipped: string[] }}
 */
function validateAndSplitBreakdowns(requestedBreakdowns) {
  const normalized = normalizeBreakdowns(requestedBreakdowns);
  const skipped = [];

  if (normalized.length === 0) {
    return { ageGender: false, country: false, region: false, skipped: [] };
  }

  if (isInvalidCombination(normalized)) {
    skipped.push(normalized.join('+'));
    const hasAge = normalized.includes('age');
    const hasGender = normalized.includes('gender');
    const hasCountry = normalized.includes('country');
    const hasRegion = normalized.includes('region');
    return {
      ageGender: hasAge || hasGender,
      country: hasCountry,
      region: hasRegion,
      skipped,
    };
  }

  const hasAge = normalized.includes('age');
  const hasGender = normalized.includes('gender');
  const hasCountry = normalized.includes('country');
  const hasRegion = normalized.includes('region');

  return {
    ageGender: hasAge || hasGender,
    country: hasCountry,
    region: hasRegion,
    skipped: [],
  };
}

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

function normAccountId(id) {
  return (id && String(id).replace(/^act_/, '')) || '';
}

/**
 * Call Meta GET act_{ad_account_id}/insights with the given breakdowns and params.
 * @returns {Promise<object[]>} Meta response data array (or [] on error).
 */
async function callMetaInsights(accessToken, adAccountId, opts) {
  const accId = normAccountId(adAccountId);
  if (!accId || !accessToken) return [];
  const url = `https://graph.facebook.com/${META_API_VERSION}/act_${accId}/insights`;
  const {
    from,
    to,
    breakdowns,
    fields = METRIC_FIELDS,
    timeIncrement,
    filtering,
  } = opts;

  const timeRange = JSON.stringify({ since: from, until: to });
  const params = {
    access_token: accessToken,
    level: 'ad',
    time_range: timeRange,
    fields,
    limit: 1000,
    filtering: JSON.stringify(filtering || STATUS_FILTER),
  };
  if (breakdowns && breakdowns.length > 0) {
    params.breakdowns = breakdowns.join(',');
  }
  if (timeIncrement != null) {
    params.time_increment = timeIncrement;
  }

  try {
    const res = await axios.get(url, { params, timeout: 60000 });
    const data = res.data;
    return Array.isArray(data.data) ? data.data : [];
  } catch (err) {
    const rawCode = err?.response?.data?.error?.code;
    const code = rawCode != null ? Number(rawCode) : null;
    const msg = err?.response?.data?.error?.message || err.message;
    if (code === 100) {
      console.warn('[DemographicInsights] Meta API #100 (invalid breakdown) — request skipped or split. Details:', msg);
      return [];
    }
    // #10 = permission (e.g. pages_read_engagement / Region-level) — return empty instead of failing the whole request
    if (code === 10) {
      console.warn('[DemographicInsights] Meta API #10 (permission) — returning empty. Details:', msg);
      return [];
    }
    // Fallback: message mentions Region-level or pages_read_engagement → treat as permission, return []
    if (msg && typeof msg === 'string' && (msg.includes('(#10)') || msg.includes('pages_read_engagement') || msg.includes('Region-level'))) {
      console.warn('[DemographicInsights] Meta API permission-like error — returning empty. Details:', msg);
      return [];
    }
    console.warn('[DemographicInsights] Meta API error:', rawCode, msg);
    throw err;
  }
}

/**
 * Call 1: Age + Gender breakdown (aggregated) — for Age & Gender demographic charts.
 */
async function fetchAgeGenderBreakdown(accessToken, adAccountId, from, to, filtering) {
  return callMetaInsights(accessToken, adAccountId, {
    from,
    to,
    breakdowns: ['age', 'gender'],
    fields: METRIC_FIELDS,
    filtering,
  });
}

/**
 * Call 2: Country breakdown — for Top Countries / Geo charts.
 */
async function fetchCountryBreakdown(accessToken, adAccountId, from, to, filtering) {
  return callMetaInsights(accessToken, adAccountId, {
    from,
    to,
    breakdowns: ['country'],
    fields: METRIC_FIELDS,
    filtering,
  });
}

/**
 * Call 2b: Region breakdown — for Top towns/cities (region-level) from Meta Ads Insights.
 */
async function fetchRegionBreakdown(accessToken, adAccountId, from, to, filtering) {
  return callMetaInsights(accessToken, adAccountId, {
    from,
    to,
    breakdowns: ['region'],
    fields: METRIC_FIELDS,
    filtering,
  });
}

/**
 * Call 3: Day-wise Age + Gender (time_increment=1) — for time-series demographic graphs.
 * Meta expects until = end date; we use the same date range as the other calls.
 */
async function fetchTimeSeriesAgeGender(accessToken, adAccountId, from, to, filtering) {
  return callMetaInsights(accessToken, adAccountId, {
    from,
    to,
    breakdowns: ['age', 'gender'],
    fields: METRIC_FIELDS_WITH_DATE,
    timeIncrement: 1,
    filtering,
  });
}

/**
 * Aggregate breakdown rows into graph-ready format (sum metrics by breakdown keys).
 * Meta returns rows like { age: "25-34", gender: "male", impressions: "123", reach: "100", spend: "5.00" }.
 */
function aggregateBreakdownRows(rows, breakdownKeys) {
  const map = new Map();
  for (const row of rows) {
    const key = breakdownKeys.map((k) => (row[k] || 'unknown').trim()).join('|');
    if (!map.has(key)) {
      map.set(key, {});
      breakdownKeys.forEach((k) => (map.get(key)[k] = row[k] || 'unknown'));
      map.get(key).impressions = 0;
      map.get(key).reach = 0;
      map.get(key).spend = 0;
    }
    const agg = map.get(key);
    agg.impressions += Number(row.impressions) || 0;
    agg.reach += Number(row.reach) || 0;
    agg.spend += Number(parseFloat(row.spend) || 0);
  }
  return [...map.values()];
}

/**
 * Time-series rows: graph-ready array of { date_start, date_stop, age, gender, impressions, reach, spend }.
 * Preserves age/gender so frontend can plot multiple series; numeric fields normalized.
 */
function normalizeTimeSeriesRows(rows) {
  return rows.map((row) => ({
    date_start: row.date_start || null,
    date_stop: row.date_stop || null,
    age: row.age || null,
    gender: row.gender || null,
    impressions: Number(row.impressions) || 0,
    reach: Number(row.reach) || 0,
    spend: Number(parseFloat(row.spend) || 0),
  })).sort((a, b) => (a.date_start || '').localeCompare(b.date_start || ''));
}

/**
 * Execute demographic insights with automatic request splitting. Runs allowed calls in parallel,
 * merges results, and returns a single normalized response. Never sends invalid breakdown combinations.
 *
 * @param {object} opts
 * @param {string} opts.accessToken - Meta access token
 * @param {string} opts.adAccountId - Ad account ID (with or without act_ prefix)
 * @param {string} opts.from - YYYY-MM-DD
 * @param {string} opts.to - YYYY-MM-DD
 * @param {string[]} [opts.breakdowns] - Requested breakdowns e.g. ["age","gender","country"]
 * @param {boolean} [opts.isAllCampaigns=true]
 * @param {boolean} [opts.isAllAds=true]
 * @param {string[]} [opts.campaignIds=[]]
 * @param {string[]} [opts.adIds=[]]
 * @returns {Promise<{ age_gender_breakdown: object[], country_breakdown: object[], time_series_age_gender: object[], errors?: string[] }>}
 */
async function fetchDemographicInsightsSplit(opts) {
  const {
    accessToken,
    adAccountId,
    from,
    to,
    breakdowns = [],
    isAllCampaigns = true,
    isAllAds = true,
    campaignIds = [],
    adIds = [],
  } = opts || {};

  const normId = normAccountId(adAccountId);
  if (!normId || !accessToken || !from || !to) {
    throw new Error('demographicInsightsService: accessToken, adAccountId, from, to are required');
  }

  const { ageGender, country, region, skipped } = validateAndSplitBreakdowns(breakdowns);
  if (skipped.length > 0) {
    console.log('[DemographicInsights] Invalid combination requested and split:', skipped.join(', '));
  }

  const filtering = buildFiltering(isAllCampaigns, isAllAds, campaignIds, adIds);
  const errors = [];

  const promises = [];

  if (ageGender) {
    promises.push(
      Promise.allSettled([
        fetchAgeGenderBreakdown(accessToken, adAccountId, from, to, filtering),
        fetchTimeSeriesAgeGender(accessToken, adAccountId, from, to, filtering),
      ]).then(([agg, series]) => {
        const aggResult = agg.status === 'fulfilled' ? agg.value : [];
        const seriesResult = series.status === 'fulfilled' ? series.value : [];
        if (agg.status === 'rejected') errors.push('age_gender: ' + (agg.reason?.message || 'failed'));
        if (series.status === 'rejected') errors.push('time_series_age_gender: ' + (series.reason?.message || 'failed'));
        return {
          age_gender_breakdown: aggregateBreakdownRows(aggResult, ['age', 'gender']),
          time_series_age_gender: normalizeTimeSeriesRows(seriesResult),
        };
      })
    );
  } else {
    promises.push(Promise.resolve({ age_gender_breakdown: [], time_series_age_gender: [] }));
  }

  if (country) {
    promises.push(
      fetchCountryBreakdown(accessToken, adAccountId, from, to, filtering)
        .then((rows) => ({ country_breakdown: aggregateBreakdownRows(rows, ['country']) }))
        .catch((err) => {
          errors.push('country: ' + (err?.message || 'failed'));
          return { country_breakdown: [] };
        })
    );
  } else {
    promises.push(Promise.resolve({ country_breakdown: [] }));
  }

  if (region) {
    promises.push(
      fetchRegionBreakdown(accessToken, adAccountId, from, to, filtering)
        .then((rows) => ({ region_breakdown: aggregateBreakdownRows(rows, ['region']) }))
        .catch((err) => {
          errors.push('region: ' + (err?.message || 'failed'));
          return { region_breakdown: [] };
        })
    );
  } else {
    promises.push(Promise.resolve({ region_breakdown: [] }));
  }

  const results = await Promise.all(promises);

  const ageGenderResult = results[0] || {};
  const countryResult = results[1] || {};
  const regionResult = results[2] || {};

  const out = {
    age_gender_breakdown: ageGenderResult.age_gender_breakdown || [],
    country_breakdown: countryResult.country_breakdown || [],
    region_breakdown: regionResult.region_breakdown || [],
    time_series_age_gender: ageGenderResult.time_series_age_gender || [],
  };
  if (errors.length > 0) {
    out.errors = errors;
  }
  return out;
}

module.exports = {
  validateAndSplitBreakdowns,
  fetchAgeGenderBreakdown,
  fetchCountryBreakdown,
  fetchRegionBreakdown,
  fetchTimeSeriesAgeGender,
  fetchDemographicInsightsSplit,
  normalizeBreakdowns,
  isInvalidCombination,
  isAllowedCombination,
  ALLOWED_COMBINATIONS,
  INVALID_COMBINATIONS,
};
