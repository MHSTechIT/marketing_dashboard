/**
 * Lead Saturation (MHS guide v1.0 — March 2026)
 *
 * Saturation Index (0–100) = min(100, (Frequency / 3.5) × 50 + (Reach % / 70) × 50)
 * Reach % = (Unique Reach / Audience Size) × 100 when audience size is available from ad sets.
 * Realistic pool = Audience Size × 0.15; days until saturation (adjusted) = (pool / daily reach) / 3.5.
 *
 * Alert bands align with guide: index yellow >60 / red >80; frequency >3 / >4; reach% >50 / >70;
 * CPM WoW >+20% / >+35%; CTR drop >20% / >35%; adjusted days <30 / <14.
 *
 * Signal 4 — first-time impression share: Meta field first_time_impression_ratio (weighted by impressions);
 *   if <30% → saturation confirmed (feeds status). Falls back if API rejects the field.
 * Signal 5 — CTR × frequency diagnostic (MHS table): derived from CTR drop, frequency WoW, CPM WoW.
 */

const axios = require('axios');
const querystring = require('querystring');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });
const { getDuplicateRateByCampaign } = require('../repositories/leadsRepository');
const adAccountsService = require('./meta/adAccountsService');
const { supabase } = require('../supabase');

const META_API_VERSION = process.env.META_API_VERSION || 'v21.0';
const METHODOLOGY_VERSION = 'MHS_Lead_Saturation_v1.1';

const INSIGHT_FIELDS_BASE =
  'campaign_id,campaign_name,impressions,reach,frequency,spend,clicks,cpm,ctr,actions,date_start,date_stop';
const INSIGHT_FIELDS_WITH_FTI = `${INSIGHT_FIELDS_BASE},first_time_impression_ratio`;

/** MHS Signal 5 — frequency “stable” if |WoW| ≤ this % */
const FREQ_STABLE_MAX_ABS_PCT = 10;
/** Frequency “up” vs prior period */
const FREQ_UP_MIN_PCT = 5;
/** CTR decline must exceed this to classify Signal 5 */
const CTR_DROP_MIN_FOR_SIGNAL5_PCT = 5;
/** CPM “up” for full-saturation row */
const CPM_UP_MIN_FOR_FULL_SAT_PCT = 5;

function getCredentials() {
  const accessToken = (process.env.META_ACCESS_TOKEN || '').trim();
  const adAccountId = (process.env.META_AD_ACCOUNT_ID || '').trim();
  if (!accessToken) throw new Error('META_ACCESS_TOKEN required');
  return { accessToken, adAccountId: adAccountId ? adAccountId.replace(/^act_/, '') : null };
}

/** Match lead counting used elsewhere */
function getLeadsFromActions(actions) {
  if (!Array.isArray(actions)) return 0;
  let total = 0;
  for (const a of actions) {
    if (!a || !a.action_type) continue;
    const type = String(a.action_type).toLowerCase();
    const val = a.value != null ? Number(a.value) : (a.values && a.values[0] != null ? Number(a.values[0]) : 0);
    if (type === 'lead' || type === 'on_facebook_lead' || type === 'onsite_conversion.lead_grouped' || type.includes('lead')) {
      total += val || 0;
    }
  }
  return total;
}

function normalizeFirstTimeRatioRaw(raw) {
  if (raw == null || raw === '') return null;
  const r = Number(raw);
  if (!Number.isFinite(r) || r < 0) return null;
  if (r > 1) return r / 100;
  return r;
}

async function fetchCampaignInsightsWithFields(adAccountId, accessToken, from, to, fields) {
  const accId = (adAccountId || '').toString().replace(/^act_/, '');
  if (!accId || !accessToken) return [];

  const url = `https://graph.facebook.com/${META_API_VERSION}/act_${accId}/insights`;
  const params = {
    access_token: accessToken,
    level: 'campaign',
    time_increment: 1,
    time_range: JSON.stringify({ since: from, until: to }),
    fields,
    limit: 500,
    filtering: JSON.stringify([
      { field: 'campaign.effective_status', operator: 'IN', value: ['ACTIVE', 'PAUSED', 'ARCHIVED', 'IN_REVIEW', 'REJECTED', 'PENDING_REVIEW', 'LEARNING', 'ENDED'] },
    ]),
  };

  let all = [];
  let nextUrl = null;
  let pageCount = 0;
  do {
    const res = nextUrl
      ? await axios.get(nextUrl, { timeout: 60000 })
      : await axios.get(url, { params, timeout: 60000 });
    const data = res.data || {};
    const chunk = Array.isArray(data.data) ? data.data : [];
    all = all.concat(chunk);
    nextUrl = data.paging && data.paging.next && pageCount < 10 ? data.paging.next : null;
    pageCount++;
  } while (nextUrl);

  return all;
}

/**
 * Campaign-level insights (daily rows aggregated in aggregateByCampaign).
 * Tries first_time_impression_ratio for Signal 4; retries without it if Meta rejects the field.
 */
async function fetchCampaignInsights(adAccountId, accessToken, from, to) {
  try {
    return await fetchCampaignInsightsWithFields(adAccountId, accessToken, from, to, INSIGHT_FIELDS_WITH_FTI);
  } catch (e) {
    const err = e.response?.data?.error;
    const msg = err ? String(err.message || '') : '';
    const badField =
      /first_time_impression/i.test(msg) ||
      (err && err.code === 100 && /field/i.test(msg));
    if (badField) {
      console.warn('[saturationService] Insights without first_time_impression_ratio:', msg || e.message);
      return fetchCampaignInsightsWithFields(adAccountId, accessToken, from, to, INSIGHT_FIELDS_BASE);
    }
    throw e;
  }
}

function aggregateByCampaign(rows) {
  const byCampaign = new Map();
  for (const row of rows) {
    const cid = (row.campaign_id || '').toString();
    const name = (row.campaign_name || '').toString() || cid;
    const impressions = Number(row.impressions) || 0;
    const reach = Number(row.reach) || 0;
    const spend = Number(row.spend) || 0;
    const clicks = Number(row.clicks) || 0;
    const leads = getLeadsFromActions(row.actions);
    const ftiRatio = normalizeFirstTimeRatioRaw(row.first_time_impression_ratio);

    if (!byCampaign.has(cid)) {
      byCampaign.set(cid, {
        campaign_id: cid,
        campaign_name: name,
        impressions: 0,
        reach: 0,
        spend: 0,
        clicks: 0,
        leads: 0,
        fti_weighted: 0,
        fti_has_rows: false,
      });
    }
    const agg = byCampaign.get(cid);
    agg.impressions += impressions;
    agg.reach += reach;
    agg.spend += spend;
    agg.clicks += clicks;
    agg.leads += leads;
    if (ftiRatio != null && impressions > 0) {
      agg.fti_has_rows = true;
      agg.fti_weighted += impressions * ftiRatio;
    }
  }

  for (const agg of byCampaign.values()) {
    const imp = agg.impressions;
    const r = agg.reach;
    agg.frequency = r > 0 ? imp / r : 0;
    agg.cpm = imp > 0 ? (agg.spend / imp) * 1000 : 0;
    agg.ctr = imp > 0 ? (agg.clicks / imp) * 100 : 0;
    if (agg.fti_has_rows && imp > 0) {
      agg.first_time_impression_pct = (agg.fti_weighted / imp) * 100;
    } else {
      agg.first_time_impression_pct = null;
    }
    delete agg.fti_weighted;
    delete agg.fti_has_rows;
  }
  return Array.from(byCampaign.values());
}

function daysInclusive(fromStr, toStr) {
  const a = new Date(`${fromStr}T12:00:00`);
  const b = new Date(`${toStr}T12:00:00`);
  return Math.max(1, Math.round((b - a) / 86400000) + 1);
}

/**
 * Midpoint audience from ad set estimated_audience_size (range or number).
 */
function parseAudienceEstimate(raw) {
  if (raw == null) return null;
  if (typeof raw === 'number' && raw > 0) return raw;
  if (typeof raw === 'object') {
    const lo = Number(raw.lower_bound ?? raw.lowerBound ?? raw.min);
    const hi = Number(raw.upper_bound ?? raw.upperBound ?? raw.max);
    if (Number.isFinite(lo) && Number.isFinite(hi) && hi > 0) return (lo + hi) / 2;
    const n = Number(raw.value ?? raw.size);
    if (Number.isFinite(n) && n > 0) return n;
  }
  if (typeof raw === 'string') {
    const nums = raw.match(/[\d,]+/g);
    if (nums && nums.length) {
      const parsed = nums.map((s) => parseInt(s.replace(/,/g, ''), 10)).filter((x) => x > 0);
      if (parsed.length === 1) return parsed[0];
      if (parsed.length >= 2) return (parsed[0] + parsed[1]) / 2;
    }
  }
  return null;
}

/**
 * Meta Marketing API: GET act_{id}/reachestimate?targeting_spec=...
 * Used when ad sets no longer return estimated_audience_size (common after API changes).
 */
function broadTargetingForReachEstimate(t) {
  if (!t || typeof t !== 'object') return null;
  const out = {};
  const keys = [
    'geo_locations',
    'age_min',
    'age_max',
    'genders',
    'locales',
    'publisher_platforms',
    'facebook_positions',
    'instagram_positions',
    'messenger_positions',
    'device_platforms',
  ];
  for (const k of keys) {
    if (t[k] != null) out[k] = t[k];
  }
  return Object.keys(out).length ? out : null;
}

async function fetchReachEstimateFromTargeting(adAccountId, targeting, accessToken) {
  if (!targeting || typeof targeting !== 'object' || !adAccountId || !accessToken) return null;
  const acc = String(adAccountId).replace(/^act_/, '');
  const specStr = JSON.stringify(targeting);
  const url = `https://graph.facebook.com/${META_API_VERSION}/act_${acc}/reachestimate`;
  try {
    const usePost = specStr.length > 2800;
    const res = usePost
      ? await axios.post(
          url,
          querystring.stringify({ access_token: accessToken, targeting_spec: specStr }),
          {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            timeout: 60000,
          }
        )
      : await axios.get(url, {
          params: { access_token: accessToken, targeting_spec: specStr },
          timeout: 60000,
        });
    const payload = res.data || {};
    const block = Array.isArray(payload.data) ? payload.data[0] : payload;
    if (!block || block.unsupported) return null;
    if (block.estimate_ready === false) return null;
    const lo = Number(block.users_lower_bound);
    const hi = Number(block.users_upper_bound);
    if (Number.isFinite(lo) && Number.isFinite(hi) && hi > 0) return (lo + hi) / 2;
    const legacy = Number(block.users);
    if (Number.isFinite(legacy) && legacy > 0) return legacy;
  } catch (e) {
    const err = e.response?.data?.error;
    console.warn(
      '[saturationService] reachestimate failed:',
      e.message,
      err ? `${err.code} ${err.message}` : ''
    );
  }
  return null;
}

/** Batch GET ?ids= — sometimes returns audience when edge list omits it. */
async function batchFetchAdSetEstimatedAudience(adSetIds, accessToken) {
  if (!Array.isArray(adSetIds) || !adSetIds.length || !accessToken) return 0;
  let maxAudience = 0;
  const chunkSize = 45;
  for (let i = 0; i < adSetIds.length; i += chunkSize) {
    const chunk = adSetIds.slice(i, i + chunkSize).filter(Boolean);
    if (!chunk.length) continue;
    try {
      const url = `https://graph.facebook.com/${META_API_VERSION}/`;
      const res = await axios.get(url, {
        params: {
          access_token: accessToken,
          ids: chunk.join(','),
          fields: 'estimated_audience_size',
        },
        timeout: 45000,
      });
      const data = res.data || {};
      for (const id of chunk) {
        const node = data[id] ?? data[String(id)];
        if (!node) continue;
        const est = parseAudienceEstimate(node.estimated_audience_size);
        if (est != null && est > maxAudience) maxAudience = est;
      }
    } catch (e) {
      console.warn('[saturationService] batch adset audience failed:', e.message);
    }
  }
  return maxAudience;
}

/**
 * Resolve targetable audience size for Reach % and days-until-saturation (Meta only).
 * @returns {{ audience_size: number|null, audience_source: string|null }}
 */
async function resolveAudiencePoolForCampaign(campaignId, adAccountId, accessToken) {
  if (!campaignId || !accessToken) {
    return { audience_size: null, audience_source: null };
  }
  const url = `https://graph.facebook.com/${META_API_VERSION}/${campaignId}/adsets`;
  const adsets = [];
  try {
    let nextUrl = null;
    let page = 0;
    do {
      const params = {
        access_token: accessToken,
        fields: 'id,estimated_audience_size,targeting',
        limit: 50,
      };
      const res = nextUrl
        ? await axios.get(nextUrl, { timeout: 45000 })
        : await axios.get(url, { params, timeout: 45000 });
      const data = res.data || {};
      adsets.push(...(Array.isArray(data.data) ? data.data : []));
      nextUrl = data.paging && data.paging.next && page < 5 ? data.paging.next : null;
      page++;
    } while (nextUrl);
  } catch (e) {
    console.warn('[saturationService] Ad sets fetch failed for campaign', campaignId, e.message);
  }

  let maxAudience = 0;
  for (const adset of adsets) {
    const est = parseAudienceEstimate(adset.estimated_audience_size);
    if (est != null && est > maxAudience) maxAudience = est;
  }

  const adsetIds = adsets.map((a) => a.id).filter(Boolean);
  if (maxAudience <= 0 && adsetIds.length) {
    const batchMax = await batchFetchAdSetEstimatedAudience(adsetIds, accessToken);
    if (batchMax > 0) maxAudience = batchMax;
  }

  if (maxAudience > 0) {
    return { audience_size: maxAudience, audience_source: 'adset_estimated_audience_size' };
  }

  if (adAccountId) {
    let tries = 0;
    for (const adset of adsets) {
      if (tries >= 12) break;
      const t = adset.targeting;
      if (!t || typeof t !== 'object') continue;
      tries++;
      let est = await fetchReachEstimateFromTargeting(adAccountId, t, accessToken);
      if (est == null) {
        const broad = broadTargetingForReachEstimate(t);
        if (broad && JSON.stringify(broad) !== JSON.stringify(t)) {
          est = await fetchReachEstimateFromTargeting(adAccountId, broad, accessToken);
        }
      }
      if (est != null && est > maxAudience) maxAudience = est;
    }
    if (maxAudience > 0) {
      return { audience_size: maxAudience, audience_source: 'reachestimate' };
    }
  }

  return { audience_size: null, audience_source: null };
}

/**
 * When Meta returns no audience: show MHS-style bands by frequency only (display).
 * Not used for status / saturation index (those stay frequency + trusted Meta reach only).
 */
function approximateReachPctFromFrequency(freq) {
  const f = Math.max(0, Number(freq) || 0);
  if (f <= 1.5) return 18;
  if (f <= 2) return 26;
  if (f <= 2.5) return 34;
  if (f <= 3) return 42;
  if (f <= 3.5) return 52;
  if (f <= 4) return 62;
  return Math.min(92, 68 + (f - 4) * 6);
}

/** Display-only days left heuristic (varies by frequency; not the MHS pool formula). */
function approximateDaysFromFrequency(freq) {
  const f = Math.max(0.5, Number(freq) || 0);
  if (f < 2) return Math.round(50 + (2 - f) * 15);
  if (f < 3) return 38;
  if (f < 3.5) return 24;
  if (f < 4) return 18;
  return Math.max(7, Math.round(72 / f));
}

/**
 * MHS Saturation Index. If reachPct is unknown, use frequency-only scale (0–100) per guide emphasis on frequency.
 */
function computeSaturationIndex(frequency, reachPct) {
  const f = Math.max(0, Number(frequency) || 0);
  const freqPart = (f / 3.5) * 50;
  if (reachPct == null || Number.isNaN(reachPct)) {
    return Math.min(100, (f / 3.5) * 100);
  }
  const r = Math.max(0, Math.min(100, Number(reachPct)));
  const reachPart = (r / 70) * 50;
  return Math.min(100, freqPart + reachPart);
}

function computeCpmWowPct(cpmCur, cpmPrev) {
  if (cpmPrev == null || cpmPrev <= 0 || cpmCur == null) return null;
  return ((cpmCur - cpmPrev) / cpmPrev) * 100;
}

/** Positive % = CTR dropped vs prior period */
function computeCtrDropPct(ctrCur, ctrPrev) {
  if (ctrPrev == null || ctrPrev <= 0 || ctrCur == null) return null;
  return ((ctrPrev - ctrCur) / ctrPrev) * 100;
}

/** Positive % = frequency increased vs prior period (MHS Signal 5) */
function computeFreqWowPct(freqCur, freqPrev) {
  if (freqPrev == null || freqPrev <= 0 || freqCur == null) return null;
  return ((freqCur - freqPrev) / freqPrev) * 100;
}

const SIGNAL5_COPY = {
  full_saturation: { label: 'Full saturation', fix: 'Urgent action' },
  audience_saturation: { label: 'Audience saturation', fix: 'Expand audience' },
  creative_fatigue: { label: 'Creative fatigue', fix: 'Change creative' },
};

/**
 * MHS Signal 5 — CTR × frequency diagnostic (order: full saturation, then audience, then creative fatigue).
 * @returns {'full_saturation'|'audience_saturation'|'creative_fatigue'|null}
 */
function computeSignal5Diagnostic(ctrDropPct, freqWowPct, cpmWowPct) {
  if (ctrDropPct == null || ctrDropPct < CTR_DROP_MIN_FOR_SIGNAL5_PCT) return null;

  const freqUp = freqWowPct != null && freqWowPct > FREQ_UP_MIN_PCT;
  const freqStable = freqWowPct != null && Math.abs(freqWowPct) <= FREQ_STABLE_MAX_ABS_PCT;
  const cpmUp = cpmWowPct != null && cpmWowPct > CPM_UP_MIN_FOR_FULL_SAT_PCT;

  if (freqUp && cpmUp) return 'full_saturation';
  if (freqUp) return 'audience_saturation';
  if (freqStable) return 'creative_fatigue';
  return null;
}

function computeDaysUntilSaturationAdjusted(audienceSize, reach, daysInPeriod) {
  if (!audienceSize || audienceSize <= 0 || !reach || reach <= 0 || !daysInPeriod) return null;
  const realisticPool = audienceSize * 0.15;
  const dailyReach = reach / daysInPeriod;
  if (dailyReach <= 0) return null;
  const basicDays = realisticPool / dailyReach;
  return basicDays / 3.5;
}

function deriveStatus(saturationIndex, s) {
  const si = Number(saturationIndex) || 0;
  const freq = s.frequency || 0;
  const rp = s.reach_pct;
  const cpmWow = s.cpm_wow_pct;
  const ctrDrop = s.ctr_drop_pct;
  const days = s.days_until_saturation_adjusted;
  const ftp = s.first_time_impression_pct;
  const sig5 = s.signal5_key;

  const red =
    si > 80 ||
    freq >= 4 ||
    (rp != null && rp >= 70) ||
    (cpmWow != null && cpmWow > 35) ||
    (ctrDrop != null && ctrDrop > 35) ||
    (days != null && days >= 0 && days < 14) ||
    sig5 === 'full_saturation';

  const yellow =
    si > 60 ||
    freq > 3 ||
    (rp != null && rp > 50) ||
    (cpmWow != null && cpmWow > 20) ||
    (ctrDrop != null && ctrDrop > 20) ||
    (days != null && days >= 0 && days < 30) ||
    (ftp != null && ftp < 30) ||
    sig5 === 'audience_saturation' ||
    sig5 === 'creative_fatigue';

  if (red) return 'Saturated';
  if (yellow) return 'Warning';
  return 'Healthy';
}

/**
 * @param {object} opts - { dateRange: { from, to }, adAccountId? }
 */
async function runSaturationAnalysis(opts = {}) {
  const { dateRange, adAccountId: singleAccountId } = opts || {};
  const toDate = dateRange && dateRange.to ? dateRange.to : new Date().toISOString().split('T')[0];
  const fromDate = dateRange && dateRange.from ? dateRange.from : (() => {
    const d = new Date(toDate);
    d.setDate(d.getDate() - 6);
    return d.toISOString().split('T')[0];
  })();
  const prevTo = (() => { const d = new Date(fromDate); d.setDate(d.getDate() - 1); return d.toISOString().split('T')[0]; })();
  const prevFrom = (() => { const d = new Date(prevTo); d.setDate(d.getDate() - 6); return d.toISOString().split('T')[0]; })();
  const daysInPeriod = daysInclusive(fromDate, toDate);

  let credentials;
  try {
    credentials = getCredentials();
  } catch (e) {
    return { success: false, error: e.message, campaigns: [], summary: {} };
  }

  let accounts = [];
  if (singleAccountId) {
    const id = (singleAccountId || '').toString().replace(/^act_/, '');
    if (id) accounts = [{ account_id: id, account_name: `Account ${id}` }];
  }
  if (accounts.length === 0) {
    try {
      await adAccountsService.fetchAndCache().catch(() => {});
      accounts = await adAccountsService.listFromDb();
    } catch (e) {
      console.warn('[saturationService] No ad accounts from DB, using env account:', e.message);
      if (credentials.adAccountId) {
        const aid = String(credentials.adAccountId).replace(/^act_/, '');
        accounts = [{ account_id: aid, account_name: 'Default' }];
      }
    }
  }
  if (accounts.length === 0) {
    return { success: false, error: 'No ad accounts available', campaigns: [], summary: {} };
  }

  const accessToken = credentials.accessToken;
  const duplicateRatesCurrent = await getDuplicateRateByCampaign(fromDate, toDate).catch(() => []);
  const duplicateMap = new Map(duplicateRatesCurrent.map((r) => [r.campaign_id, r.duplicate_rate]));

  const pending = [];

  for (const acc of accounts) {
    const accId = acc.account_id || acc.id;
    if (!accId) continue;
    let currentRows = [];
    let previousRows = [];
    try {
      currentRows = await fetchCampaignInsights(accId, accessToken, fromDate, toDate);
      previousRows = await fetchCampaignInsights(accId, accessToken, prevFrom, prevTo);
    } catch (err) {
      console.error('[saturationService] Meta API error for account', accId, err.message);
      continue;
    }

    const currentAgg = aggregateByCampaign(currentRows);
    const previousAgg = new Map(aggregateByCampaign(previousRows).map((c) => [c.campaign_id, c]));

    const accDisplayName = (acc.account_name || acc.name || '').toString().trim() || null;
    for (const cur of currentAgg) {
      pending.push({
        cur,
        prev: previousAgg.get(cur.campaign_id) || {},
        accId,
        accName: accDisplayName,
      });
    }
  }

  const audienceResults = await Promise.all(
    pending.map((p) => resolveAudiencePoolForCampaign(p.cur.campaign_id, p.accId, accessToken))
  );

  const allCampaigns = [];

  pending.forEach((p, idx) => {
    const { cur, prev, accId, accName } = p;
    const { audience_size: audienceSize, audience_source: audienceSource } = audienceResults[idx] || {};

    const frequency = cur.frequency || 0;
    const reach = cur.reach || 0;
    const trusted =
      audienceSource === 'adset_estimated_audience_size' || audienceSource === 'reachestimate';

    const reachPctMeta =
      trusted && audienceSize && audienceSize > 0
        ? Math.min(100, (reach / audienceSize) * 100)
        : null;

    const daysMeta = trusted
      ? computeDaysUntilSaturationAdjusted(audienceSize, reach, daysInPeriod)
      : null;

    const saturationIndex = computeSaturationIndex(frequency, reachPctMeta);

    const cpmCur = cur.cpm || 0;
    const cpmPrev = prev.cpm != null ? prev.cpm : 0;
    const cpmWowPct = computeCpmWowPct(cpmCur, cpmPrev);

    const ctrCur = cur.ctr || 0;
    const ctrPrev = prev.ctr != null ? prev.ctr : 0;
    const ctrDropPct = computeCtrDropPct(ctrCur, ctrPrev);

    const freqPrev = prev.frequency != null ? prev.frequency : null;
    const freqWowPct = computeFreqWowPct(frequency, freqPrev);

    const firstTimePct =
      cur.first_time_impression_pct != null && Number.isFinite(cur.first_time_impression_pct)
        ? cur.first_time_impression_pct
        : null;

    const signal5Key = computeSignal5Diagnostic(ctrDropPct, freqWowPct, cpmWowPct);
    const signal5Meta = signal5Key ? SIGNAL5_COPY[signal5Key] : null;

    const reachPctDisplay =
      reachPctMeta != null ? reachPctMeta : approximateReachPctFromFrequency(frequency);
    const daysDisplay = daysMeta != null ? daysMeta : approximateDaysFromFrequency(frequency);

    const leadsCur = cur.leads || 0;
    const spendCur = cur.spend || 0;
    const cplCur = leadsCur > 0 ? spendCur / leadsCur : 0;

    const duplicateRatePct = (duplicateMap.get(cur.campaign_id) || 0) * 100;

    const status = deriveStatus(saturationIndex, {
      frequency,
      reach_pct: reachPctMeta,
      cpm_wow_pct: cpmWowPct,
      ctr_drop_pct: ctrDropPct,
      days_until_saturation_adjusted: daysMeta,
      first_time_impression_pct: firstTimePct,
      signal5_key: signal5Key,
    });

    const row = {
      campaign_id: cur.campaign_id,
      campaign_name: cur.campaign_name,
      ad_account_id: accId,
      ad_account_name: accName || null,
      frequency: Math.round(frequency * 100) / 100,
      freq_wow_pct: freqWowPct != null ? Math.round(freqWowPct * 10) / 10 : null,
      reach,
      audience_size: audienceSize != null ? Math.round(audienceSize * 100) / 100 : null,
      audience_source: audienceSource || null,
      reach_pct: Math.round(reachPctDisplay * 10) / 10,
      reach_pct_is_estimated: reachPctMeta == null,
      cpm: Math.round(cpmCur * 100) / 100,
      cpm_wow_pct: cpmWowPct != null ? Math.round(cpmWowPct * 10) / 10 : null,
      ctr: Math.round(ctrCur * 1000) / 1000,
      ctr_drop_pct: ctrDropPct != null ? Math.round(ctrDropPct * 10) / 10 : null,
      first_time_impression_pct:
        firstTimePct != null ? Math.round(firstTimePct * 10) / 10 : null,
      first_time_impression_available: firstTimePct != null,
      signal5_key: signal5Key || null,
      signal5_label: signal5Meta ? signal5Meta.label : null,
      signal5_fix: signal5Meta ? signal5Meta.fix : null,
      days_until_saturation_adjusted:
        daysDisplay != null ? Math.round(daysDisplay * 10) / 10 : null,
      days_is_estimated: daysMeta == null,
      saturation_index: Math.round(saturationIndex * 10) / 10,
      cpl: Math.round(cplCur * 100) / 100,
      duplicate_rate: Math.round(duplicateRatePct * 100) / 100,
      score: Math.round(Math.min(100, saturationIndex)),
      status,
      period_from: fromDate,
      period_to: toDate,
      methodology: METHODOLOGY_VERSION,
    };
    allCampaigns.push(row);
  });

  if (supabase) {
    const toInsert = allCampaigns.map((r) => ({
      campaign_id: r.campaign_id,
      campaign_name: r.campaign_name,
      ad_account_id: r.ad_account_id,
      frequency: r.frequency,
      cpl: r.cpl,
      duplicate_rate: r.duplicate_rate / 100,
      score: r.score,
      status: r.status,
      period_from: r.period_from,
      period_to: r.period_to,
    }));
    if (toInsert.length > 0) {
      await supabase.from('campaign_saturation_log').insert(toInsert).then(({ error }) => {
        if (error) console.error('[saturationService] Log insert error:', error.message);
      });
    }
  }

  const saturated = allCampaigns.filter((c) => c.status === 'Saturated');
  const warning = allCampaigns.filter((c) => c.status === 'Warning');
  const siValues = allCampaigns.map((c) => c.saturation_index || 0);
  const saturationIndexAvg = siValues.length ? siValues.reduce((a, b) => a + b, 0) / siValues.length : 0;

  const summary = {
    total: allCampaigns.length,
    saturated: saturated.length,
    warning: warning.length,
    healthy: allCampaigns.length - saturated.length - warning.length,
    period_from: fromDate,
    period_to: toDate,
    saturation_index_avg: Math.round(saturationIndexAvg * 10) / 10,
    methodology: METHODOLOGY_VERSION,
  };

  return {
    success: true,
    campaigns: allCampaigns,
    summary,
  };
}

module.exports = {
  runSaturationAnalysis,
  fetchCampaignInsights,
  aggregateByCampaign,
  computeSaturationIndex,
  deriveStatus,
  resolveAudiencePoolForCampaign,
  fetchReachEstimateFromTargeting,
  approximateReachPctFromFrequency,
  approximateDaysFromFrequency,
  computeFreqWowPct,
  computeSignal5Diagnostic,
};
