/**
 * Creative Fatigue (MHS creative_state.md — March 2026)
 *
 * Fatigue Score = (CTR Drop × 0.4) + (Days/Lifespan × 0.4) + (Hook Drop × 0.2)
 *   — CTR Drop & Hook Drop: % decline vs prior window (0–100 capped).
 *   — Days/Lifespan: % of adjusted lifespan consumed (capped at 150).
 * Lifespan: Adjusted = ((Audience × Target Frequency 3) ÷ Daily Reach) × 0.25 (doc).
 *
 * Status: 0–40 Fresh, 40–70 Aging, 70–100 Fatigued, 100+ Severe.
 * Weekly audit flags: CTR >30%, hook <15%, CPL vs first-7d >40%, quality below avg, days >21, neg feedback >0.1%.
 */

const axios = require('axios');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });
const adAccountsService = require('./meta/adAccountsService');
const { enrichInsightsRow } = require('../meta/insightsService');
const { resolveAudiencePoolForCampaign } = require('./saturationService');
const { supabase } = require('../supabase');

const META_API_VERSION = process.env.META_API_VERSION || 'v21.0';
const METHODOLOGY_VERSION = 'Creative_State_MHS_v1.0';
const TARGET_FREQUENCY = 3;
const FIRST_7_DAYS = 7;
const HISTORY_MAX_DAYS_BACK = 400;

const INSIGHT_FIELDS_FULL =
  'ad_id,ad_name,campaign_id,campaign_name,impressions,reach,clicks,spend,ctr,cpc,actions,date_start,date_stop,' +
  'video_play_actions,video_p25_watched_actions,video_p50_watched_actions,' +
  'video_p75_watched_actions,video_p100_watched_actions,quality_ranking,engagement_rate_ranking,conversion_rate_ranking';

const INSIGHT_FIELDS_BASE =
  'ad_id,ad_name,campaign_id,campaign_name,impressions,reach,clicks,spend,ctr,cpc,actions,date_start,date_stop';

function getCredentials() {
  const accessToken = (process.env.META_ACCESS_TOKEN || '').trim();
  const adAccountId = (process.env.META_AD_ACCOUNT_ID || '').trim();
  if (!accessToken) throw new Error('META_ACCESS_TOKEN required');
  return { accessToken, adAccountId: adAccountId ? adAccountId.replace(/^act_/, '') : null };
}

/** Match lead counting used in saturationService */
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

function daysInclusive(fromStr, toStr) {
  const a = new Date(`${fromStr}T12:00:00`);
  const b = new Date(`${toStr}T12:00:00`);
  return Math.max(1, Math.round((b - a) / 86400000) + 1);
}

function ymd(d) {
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function addDaysYmd(ymdStr, days) {
  const d = new Date(`${ymdStr}T12:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function parseMetaDate(s) {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** 0 = best (above average), 3 = worst (below ~10% / bottom) */
function qualityRankSeverity(row) {
  const q = row.quality_ranking || row.engagement_rate_ranking || row.conversion_rate_ranking;
  if (q == null || q === '') return null;
  const u = String(q).toUpperCase();
  if (u.includes('UNKNOWN') || u.includes('UNAVAILABLE')) return null;
  if (u.includes('ABOVE_AVERAGE') || u.includes('ABOVE AVERAGE')) return 0;
  if (u.includes('AVERAGE') && !u.includes('BELOW')) return 1;
  if (u.includes('BELOW')) {
    if (u.includes('10') || u.includes('BOTTOM') || u.includes('LOWEST')) return 3;
    return 2;
  }
  return 1;
}

function getNegativeFeedbackCount(row) {
  if (!Array.isArray(row.actions)) return 0;
  let n = 0;
  for (const a of row.actions) {
    if (!a || !a.action_type) continue;
    const t = String(a.action_type).toLowerCase();
    if (
      t.includes('negative_feedback') ||
      t.includes('negative feedback') ||
      (t.includes('hide') && t.includes('ad')) ||
      t.includes('report')
    ) {
      n += Number(a.value) || 0;
    }
  }
  return n;
}

function ctrSignalBand(dropPct) {
  const d = Math.max(0, Number(dropPct) || 0);
  if (d <= 15) return 'Healthy';
  if (d <= 30) return 'Early';
  if (d < 50) return 'Moderate';
  return 'Severe';
}

function hookRateBand(hr) {
  if (hr == null || Number.isNaN(hr)) return null;
  const h = Number(hr);
  if (h >= 30) return 'Excellent';
  if (h >= 20) return 'Good';
  if (h >= 10) return 'Warning';
  return 'Critical';
}

/**
 * Hook rate (doc): (3s plays ÷ impressions) × 100; else plays ÷ impressions (Hook-and-Hold doc).
 */
function hookRateFromAgg(agg) {
  const imp = agg.impressions || 0;
  if (imp <= 0) return null;
  if ((agg.video3s || 0) > 0) return (agg.video3s / imp) * 100;
  if ((agg.videoPlays || 0) > 0) return (agg.videoPlays / imp) * 100;
  return null;
}

function computeHookDropPct(hookCur, hookPrev) {
  if (hookPrev == null || hookPrev <= 0 || hookCur == null) return 0;
  if (hookCur >= hookPrev) return 0;
  return Math.min(100, ((hookPrev - hookCur) / hookPrev) * 100);
}

function computeCtrDropPct(ctrCur, ctrPrev) {
  if (ctrPrev == null || ctrPrev <= 0 || ctrCur == null) return 0;
  if (ctrCur >= ctrPrev) return 0;
  return Math.min(100, ((ctrPrev - ctrCur) / ctrPrev) * 100);
}

/**
 * MHS dashboard score (creative_state.md).
 */
function computeMhsFatigueScore(ctrDropPct, agePressurePct, hookDropPct) {
  const c = Math.min(100, Math.max(0, Number(ctrDropPct) || 0));
  const a = Math.min(150, Math.max(0, Number(agePressurePct) || 0));
  const h = Math.min(100, Math.max(0, Number(hookDropPct) || 0));
  return c * 0.4 + a * 0.4 + h * 0.2;
}

function getMhsFatigueStatus(score) {
  const s = Number(score) || 0;
  if (s > 100) return 'Severe';
  if (s >= 70) return 'Fatigued';
  if (s >= 40) return 'Aging';
  return 'Fresh';
}

function daysRunningFromCreated(createdYmd, toYmd) {
  if (!createdYmd || !toYmd) return null;
  const a = new Date(`${createdYmd}T12:00:00`);
  const b = new Date(`${toYmd}T12:00:00`);
  const diff = Math.round((b - a) / 86400000) + 1;
  return Math.max(1, diff);
}

async function fetchAdInsightsWithFields(adAccountId, accessToken, from, to, fields) {
  const accId = (adAccountId || '').toString().replace(/^act_/, '');
  if (!accId || !accessToken) return [];

  const url = `https://graph.facebook.com/${META_API_VERSION}/act_${accId}/insights`;
  const params = {
    access_token: accessToken,
    level: 'ad',
    time_increment: 1,
    time_range: JSON.stringify({ since: from, until: to }),
    fields,
    limit: 500,
    filtering: JSON.stringify([
      { field: 'campaign.effective_status', operator: 'IN', value: ['ACTIVE', 'PAUSED', 'ARCHIVED', 'IN_REVIEW', 'REJECTED', 'PENDING_REVIEW', 'LEARNING', 'ENDED'] },
      { field: 'ad.effective_status', operator: 'IN', value: ['ACTIVE', 'PAUSED', 'ARCHIVED', 'IN_REVIEW', 'REJECTED', 'PENDING_REVIEW', 'LEARNING', 'ENDED'] },
    ]),
  };

  let all = [];
  let nextUrl = null;
  let pageCount = 0;
  do {
    const res = nextUrl
      ? await axios.get(nextUrl, { timeout: 90000 })
      : await axios.get(url, { params, timeout: 90000 });
    const data = res.data || {};
    const chunk = Array.isArray(data.data) ? data.data : [];
    all = all.concat(chunk);
    nextUrl = data.paging && data.paging.next && pageCount < 20 ? data.paging.next : null;
    pageCount++;
  } while (nextUrl);

  return all;
}

async function fetchAdInsights(adAccountId, accessToken, from, to) {
  try {
    return await fetchAdInsightsWithFields(adAccountId, accessToken, from, to, INSIGHT_FIELDS_FULL);
  } catch (e) {
    const err = e.response?.data?.error;
    const msg = err ? String(err.message || '') : '';
    if (/quality_ranking|video_3_sec|engagement_rate|conversion_rate|field/i.test(msg) || err?.code === 100) {
      console.warn('[creativeFatigueService] Retrying insights with base fields:', msg || e.message);
      return fetchAdInsightsWithFields(adAccountId, accessToken, from, to, INSIGHT_FIELDS_BASE);
    }
    throw e;
  }
}

/**
 * Aggregate ad-level daily rows → one row per ad (totals + hook components).
 */
function aggregateByAd(rows) {
  const byAd = new Map();
  for (const raw of rows) {
    const row = enrichInsightsRow(raw);
    const adId = (row.ad_id || '').toString();
    const name = (row.ad_name || '').toString() || adId;
    const campaignId = (row.campaign_id || '').toString();
    const campaignName = (row.campaign_name || '').toString();
    const impressions = Number(row.impressions) || 0;
    const reach = Number(row.reach) || 0;
    const clicks = Number(row.clicks) || 0;
    const spend = Number(row.spend) || 0;
    const leads = getLeadsFromActions(row.actions);
    const video3s = Number(row.video3sViews) || 0;
    const videoPlays = Number(row.videoPlays) || 0;
    const negFb = getNegativeFeedbackCount(row);
    const qSev = qualityRankSeverity(row);

    if (!byAd.has(adId)) {
      byAd.set(adId, {
        ad_id: adId,
        ad_name: name,
        campaign_id: campaignId,
        campaign_name: campaignName,
        impressions: 0,
        reach: 0,
        clicks: 0,
        spend: 0,
        leads: 0,
        video3s: 0,
        videoPlays: 0,
        negFb: 0,
        qualityWorst: null,
        ctrSum: 0,
        ctrCount: 0,
      });
    }
    const agg = byAd.get(adId);
    agg.impressions += impressions;
    agg.reach += reach;
    agg.clicks += clicks;
    agg.spend += spend;
    agg.leads += leads;
    agg.video3s += video3s;
    agg.videoPlays += videoPlays;
    agg.negFb += negFb;
    if (qSev != null) {
      agg.qualityWorst = agg.qualityWorst == null ? qSev : Math.max(agg.qualityWorst, qSev);
    }
    const ctr = row.ctr != null ? Number(row.ctr) : (impressions > 0 ? (clicks / impressions) * 100 : 0);
    if (row.ctr != null) {
      agg.ctrSum += ctr;
      agg.ctrCount += 1;
    } else if (impressions > 0) {
      agg.ctrSum += (clicks / impressions) * 100;
      agg.ctrCount += 1;
    }
  }

  return Array.from(byAd.values()).map((a) => {
    const ctr =
      a.ctrCount > 0 ? a.ctrSum / a.ctrCount : (a.impressions > 0 ? (a.clicks / a.impressions) * 100 : 0);
    const hookRate = hookRateFromAgg(a);
    const negFbPct = a.impressions > 0 ? (a.negFb / a.impressions) * 100 : 0;
    return {
      ...a,
      ctr,
      hook_rate: hookRate,
      neg_feedback_pct: negFbPct,
    };
  });
}

/**
 * Baseline aggregate for first 7 days after ad created_time (from wide daily rows).
 */
function aggregateFirst7DaysForAd(wideRows, adId, createdYmd) {
  const endBaseline = addDaysYmd(createdYmd, FIRST_7_DAYS - 1);
  const byAd = new Map();
  for (const raw of wideRows) {
    if ((raw.ad_id || '').toString() !== adId) continue;
    const day = raw.date_start || raw.date_stop;
    if (!day || day < createdYmd || day > endBaseline) continue;
    const row = enrichInsightsRow(raw);
    const impressions = Number(row.impressions) || 0;
    const clicks = Number(row.clicks) || 0;
    const spend = Number(row.spend) || 0;
    const leads = getLeadsFromActions(row.actions);
    if (!byAd.has(adId)) {
      byAd.set(adId, { impressions: 0, clicks: 0, spend: 0, leads: 0 });
    }
    const agg = byAd.get(adId);
    agg.impressions += impressions;
    agg.clicks += clicks;
    agg.spend += spend;
    agg.leads += leads;
  }
  const agg = byAd.get(adId);
  if (!agg || agg.impressions <= 0) return { cpl: null, leads: 0 };
  const ctr = agg.impressions > 0 ? (agg.clicks / agg.impressions) * 100 : 0;
  const cpl = agg.leads > 0 ? agg.spend / agg.leads : null;
  return { cpl, leads: agg.leads, ctr, impressions: agg.impressions };
}

async function batchFetchAdCreatedTimes(adIds, accessToken) {
  const map = new Map();
  const ids = [...new Set(adIds.filter(Boolean))];
  const chunkSize = 45;
  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize);
    try {
      const url = `https://graph.facebook.com/${META_API_VERSION}/`;
      const res = await axios.get(url, {
        params: {
          access_token: accessToken,
          ids: chunk.join(','),
          fields: 'created_time',
        },
        timeout: 45000,
      });
      const data = res.data || {};
      for (const id of chunk) {
        const n = data[id] ?? data[String(id)];
        if (n && n.created_time) {
          const d = parseMetaDate(n.created_time);
          if (d) map.set(id, ymd(d));
        }
      }
    } catch (e) {
      console.warn('[creativeFatigueService] batch ad created_time failed:', e.message);
    }
  }
  return map;
}

function buildWeeklyAuditFlags({
  ctr_drop_pct,
  hook_rate,
  cpl_increase_first7_pct,
  quality_worst,
  days_running,
  neg_feedback_pct,
}) {
  return {
    ctr_drop_over_30: ctr_drop_pct > 30,
    hook_rate_under_15: hook_rate != null && hook_rate < 15,
    cpl_increase_over_40: cpl_increase_first7_pct != null && cpl_increase_first7_pct > 40,
    quality_below_average: quality_worst != null && quality_worst >= 2,
    days_running_over_21: days_running != null && days_running > 21,
    negative_feedback_over_0_1: neg_feedback_pct != null && neg_feedback_pct > 0.1,
  };
}

function auditFlagCount(flags) {
  return Object.values(flags).filter(Boolean).length;
}

/**
 * Run creative fatigue analysis (MHS creative_state.md).
 */
async function runFatigueAnalysis(opts = {}) {
  const { dateRange, adAccountId: singleAccountId } = opts || {};
  const toDate = dateRange && dateRange.to ? dateRange.to : new Date().toISOString().split('T')[0];
  const fromDate = dateRange && dateRange.from ? dateRange.from : (() => {
    const d = new Date(toDate);
    d.setDate(d.getDate() - 6);
    return d.toISOString().split('T')[0];
  })();
  const prevTo = (() => { const d = new Date(fromDate); d.setDate(d.getDate() - 1); return d.toISOString().split('T')[0]; })();
  const prevFrom = (() => { const d = new Date(prevTo); d.setDate(d.getDate() - 6); return d.toISOString().split('T')[0]; })();
  const daysInCurrent = daysInclusive(fromDate, toDate);

  let credentials;
  try {
    credentials = getCredentials();
  } catch (e) {
    return { success: false, error: e.message, creatives: [], summary: {} };
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
      if (credentials.adAccountId) {
        const aid = String(credentials.adAccountId).replace(/^act_/, '');
        accounts = [{ account_id: aid, account_name: 'Default' }];
      }
    }
  }
  if (accounts.length === 0) {
    return { success: false, error: 'No ad accounts available', creatives: [], summary: {} };
  }

  const accessToken = credentials.accessToken;
  const allCreatives = [];

  for (const acc of accounts) {
    const accId = acc.account_id || acc.id;
    if (!accId) continue;
    const accDisplayName = (acc.account_name || acc.name || '').toString().trim() || null;

    let currentRows = [];
    let previousRows = [];
    try {
      currentRows = await fetchAdInsights(accId, accessToken, fromDate, toDate);
      previousRows = await fetchAdInsights(accId, accessToken, prevFrom, prevTo);
    } catch (err) {
      console.error('[creativeFatigueService] Meta API error for account', accId, err.message);
      continue;
    }

    const currentAgg = aggregateByAd(currentRows);
    const previousAgg = new Map(aggregateByAd(previousRows).map((c) => [c.ad_id, c]));
    if (currentAgg.length === 0) continue;

    const createdMap = await batchFetchAdCreatedTimes(
      currentAgg.map((c) => c.ad_id),
      accessToken
    );

    let minCreated = null;
    for (const cur of currentAgg) {
      const cy = createdMap.get(cur.ad_id);
      if (cy && (minCreated == null || cy < minCreated)) minCreated = cy;
    }
    if (minCreated == null) minCreated = fromDate;
    const capFrom = addDaysYmd(toDate, -HISTORY_MAX_DAYS_BACK);
    const historyFrom = minCreated < capFrom ? capFrom : minCreated;

    let wideRows = [];
    if (historyFrom <= toDate) {
      try {
        wideRows = await fetchAdInsights(accId, accessToken, historyFrom, toDate);
      } catch (e) {
        console.warn('[creativeFatigueService] Wide history fetch failed:', e.message);
      }
    }

    const audienceCache = new Map();
    async function getAudience(campaignId) {
      if (!campaignId) return null;
      if (audienceCache.has(campaignId)) return audienceCache.get(campaignId);
      const r = await resolveAudiencePoolForCampaign(campaignId, accId, accessToken);
      audienceCache.set(campaignId, r.audience_size);
      return r.audience_size;
    }

    for (const cur of currentAgg) {
      const prev = previousAgg.get(cur.ad_id) || {};
      const reach = cur.reach || 0;
      const frequency = reach > 0 ? cur.impressions / reach : 0;
      const ctrCur = cur.ctr ?? 0;
      const ctrPrev = prev.ctr ?? 0;
      const ctrDropPct = computeCtrDropPct(ctrCur, ctrPrev);

      const hookCur = cur.hook_rate;
      const hookPrev = prev.hook_rate != null ? prev.hook_rate : null;
      const hookDropPct = computeHookDropPct(hookCur, hookPrev);

      const leadsCur = cur.leads || 0;
      const spendCur = cur.spend || 0;
      const cplCur = leadsCur > 0 ? spendCur / leadsCur : 0;

      const createdYmd = createdMap.get(cur.ad_id) || null;
      const daysRunning = daysRunningFromCreated(createdYmd, toDate);

      let cplBaseline = null;
      let cplIncreaseFirst7Pct = null;
      if (createdYmd && wideRows.length) {
        const base = aggregateFirst7DaysForAd(wideRows, cur.ad_id, createdYmd);
        cplBaseline = base.cpl;
        if (cplBaseline != null && cplBaseline > 0 && cplCur > cplBaseline) {
          cplIncreaseFirst7Pct = ((cplCur - cplBaseline) / cplBaseline) * 100;
        }
      }

      const audienceSize = await getAudience(cur.campaign_id);
      const dailyReach = reach > 0 ? reach / daysInCurrent : 0;
      let adjustedLifespan = null;
      let agePressurePct = 0;
      if (audienceSize && audienceSize > 0 && dailyReach > 0) {
        const estimated = (audienceSize * TARGET_FREQUENCY) / dailyReach;
        adjustedLifespan = estimated * 0.25;
        if (adjustedLifespan > 0 && daysRunning != null) {
          agePressurePct = Math.min(150, (daysRunning / adjustedLifespan) * 100);
        }
      } else if (daysRunning != null) {
        agePressurePct = Math.min(100, (daysRunning / 28) * 100);
      }

      const mhsScore = computeMhsFatigueScore(ctrDropPct, agePressurePct, hookDropPct);
      const status = getMhsFatigueStatus(mhsScore);

      const weekly_audit = buildWeeklyAuditFlags({
        ctr_drop_pct: ctrDropPct,
        hook_rate: hookCur,
        cpl_increase_first7_pct: cplIncreaseFirst7Pct,
        quality_worst: cur.qualityWorst,
        days_running: daysRunning,
        neg_feedback_pct: cur.neg_feedback_pct,
      });

      const row = {
        ad_id: cur.ad_id,
        ad_name: cur.ad_name,
        campaign_id: cur.campaign_id,
        campaign_name: cur.campaign_name,
        ad_account_id: accId,
        ad_account_name: accDisplayName,
        frequency: Math.round(frequency * 100) / 100,
        ctr: Math.round(ctrCur * 1000) / 1000,
        ctr_drop_pct: Math.round(ctrDropPct * 10) / 10,
        ctr_signal_band: ctrSignalBand(ctrDropPct),
        hook_rate: hookCur != null ? Math.round(hookCur * 10) / 10 : null,
        hook_signal_band: hookRateBand(hookCur),
        hook_drop_pct: Math.round(hookDropPct * 10) / 10,
        cpl: Math.round(cplCur * 100) / 100,
        cpl_baseline_first7: cplBaseline != null ? Math.round(cplBaseline * 100) / 100 : null,
        cpl_increase_first7_pct:
          cplIncreaseFirst7Pct != null ? Math.round(cplIncreaseFirst7Pct * 10) / 10 : null,
        quality_worst: cur.qualityWorst,
        neg_feedback_pct: Math.round((cur.neg_feedback_pct || 0) * 10000) / 10000,
        days_running: daysRunning,
        adjusted_lifespan_days: adjustedLifespan != null ? Math.round(adjustedLifespan * 10) / 10 : null,
        age_pressure_pct: Math.round(agePressurePct * 10) / 10,
        fatigue_score: Math.round(mhsScore * 10) / 10,
        score: Math.round(mhsScore * 10) / 10,
        status,
        weekly_audit,
        weekly_audit_count: auditFlagCount(weekly_audit),
        period_from: fromDate,
        period_to: toDate,
        methodology: METHODOLOGY_VERSION,
      };
      allCreatives.push(row);
    }
  }

  if (supabase) {
    const toInsert = allCreatives.map((r) => ({
      ad_id: r.ad_id,
      ad_name: r.ad_name,
      campaign_id: r.campaign_id,
      campaign_name: r.campaign_name,
      ad_account_id: r.ad_account_id,
      frequency: r.frequency,
      ctr: r.ctr,
      cpl: r.cpl,
      ctr_drop_pct: r.ctr_drop_pct,
      cpl_increase_pct: r.cpl_increase_first7_pct,
      score: r.score,
      status: r.status,
      period_from: r.period_from,
      period_to: r.period_to,
    }));
    if (toInsert.length > 0) {
      await supabase.from('creative_fatigue_log').insert(toInsert).then(({ error }) => {
        if (error) console.error('[creativeFatigueService] Log insert error:', error.message);
      });
    }
  }

  const severe = allCreatives.filter((c) => c.status === 'Severe');
  const fatigued = allCreatives.filter((c) => c.status === 'Fatigued');
  const aging = allCreatives.filter((c) => c.status === 'Aging');
  const fresh = allCreatives.filter((c) => c.status === 'Fresh');

  const summary = {
    total: allCreatives.length,
    severe: severe.length,
    fatigued: fatigued.length,
    aging: aging.length,
    fresh: fresh.length,
    period_from: fromDate,
    period_to: toDate,
    methodology: METHODOLOGY_VERSION,
    legacy_healthy: fresh.length,
    legacy_warning: aging.length,
    legacy_fatigued: fatigued.length + severe.length,
  };

  return {
    success: true,
    creatives: allCreatives,
    summary,
  };
}

module.exports = {
  runFatigueAnalysis,
  fetchAdInsights,
  aggregateByAd,
  computeMhsFatigueScore,
  getMhsFatigueStatus,
  METHODOLOGY_VERSION,
};
