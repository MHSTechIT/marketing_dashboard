/**
 * Lead Intelligence scoring — MHS lead-intaligetionn-state.md (March 2026)
 *
 * Sugar (Thank You / form poll) mg/dL bands:
 *   >250 +40, 180–250 +30, 126–180 +20, <126 +10
 * Behavioural (GHL / TagMango / manual via lead_intel JSON on Leads):
 *   WhatsApp open <1h +15, click link +20, reply +25, payment page +30,
 *   masterclass +35, ask question +20, previous buyer +50, age 45–60 +10
 *
 * Tiers: 80–150 Hot, 50–79 Warm, 25–49 Nurture, 0–24 Cold (display: Hot Lead, Warm Lead, …)
 */

const { getLeadsByCampaignAndAd, getLeadsByDateRange } = require('../repositories/leadsRepository');
const { supabase } = require('../supabase');

const METHODOLOGY_VERSION = 'Lead_Intelligence_MHS_v1.0';

/** Tier thresholds (doc §75–80) */
const TIER_HOT_MIN = 80;
const TIER_WARM_MIN = 50;
const TIER_NURTURE_MIN = 25;

const SUGAR_POINTS = {
  very_high: 40,
  high: 30,
  controlled: 20,
  borderline: 10,
};

const BEHAVIOR_POINTS = {
  whatsapp_open_1h: 15,
  click_link: 20,
  reply_message: 25,
  payment_page_visit: 30,
  masterclass_attend: 35,
  ask_question: 20,
  previous_buyer: 50,
  age_45_60: 10,
};

/**
 * Parse poll text / number → estimated mg/dL for banding (best effort).
 */
function parseSugarMgDl(raw) {
  if (raw == null) return null;
  const s0 = String(raw).trim();
  if (!s0 || /^n\/?a$/i.test(s0)) return null;
  const s = s0.toLowerCase();

  if (/very\s*high|>?\s*250|above\s*250|over\s*250|250\s*\+|251|260|270|300/.test(s0)) return 260;
  if (/borderline|below\s*126|under\s*126|<\s*126|less\s*than\s*126/.test(s)) return 100;
  if (/controlled|126\s*[-–]\s*180|moderate/.test(s)) return 150;
  if (/180\s*[-–]\s*250|high(?!\s*er)|181|200|220|240/.test(s)) {
    const m = s.match(/(\d+(?:\.\d+)?)/);
    if (m) {
      const n = Number(m[1]);
      if (n >= 180 && n <= 250) return n;
    }
    return 200;
  }

  const m = s.match(/(\d+(?:\.\d+)?)/);
  if (m) {
    const n = Number(m[1]);
    if (!Number.isNaN(n) && n >= 40 && n <= 600) return n;
  }
  return null;
}

function sugarBand(mgDl) {
  if (mgDl == null) return { segment: null, points: 0 };
  if (mgDl > 250) return { segment: 'Very High', points: SUGAR_POINTS.very_high };
  if (mgDl >= 180) return { segment: 'High', points: SUGAR_POINTS.high };
  if (mgDl >= 126) return { segment: 'Controlled', points: SUGAR_POINTS.controlled };
  return { segment: 'Borderline', points: SUGAR_POINTS.borderline };
}

function getIntelFromLead(lead) {
  const raw = lead.lead_intel ?? lead.LeadIntel ?? lead.leadIntelligence;
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try {
      const o = JSON.parse(raw);
      return o && typeof o === 'object' ? o : {};
    } catch {
      return {};
    }
  }
  return {};
}

function truthy(v) {
  if (v === true || v === 1 || v === '1') return true;
  if (typeof v === 'string') return ['true', 'yes', 'y', '1'].includes(v.toLowerCase().trim());
  return false;
}

/**
 * Behavioural points from lead_intel (or flat lead.* booleans).
 */
function behavioralPoints(lead, intel) {
  const breakdown = {};
  let points = 0;

  const on = (key, altKeys = []) => {
    const keys = [key, ...altKeys];
    for (const k of keys) {
      let v = intel[k];
      if (v == null || v === false) v = lead[k];
      if (truthy(v)) return true;
    }
    return false;
  };

  const add = (key, pts) => {
    if (on(key)) {
      breakdown[key] = pts;
      points += pts;
    }
  };

  if (on('whatsapp_open_1h', ['open_whatsapp_1h'])) {
    breakdown.whatsapp_open_1h = BEHAVIOR_POINTS.whatsapp_open_1h;
    points += BEHAVIOR_POINTS.whatsapp_open_1h;
  }

  add('click_link', BEHAVIOR_POINTS.click_link);
  add('reply_message', BEHAVIOR_POINTS.reply_message);
  add('payment_page_visit', BEHAVIOR_POINTS.payment_page_visit);
  add('masterclass_attend', BEHAVIOR_POINTS.masterclass_attend);
  add('ask_question', BEHAVIOR_POINTS.ask_question);
  add('previous_buyer', BEHAVIOR_POINTS.previous_buyer);

  let age = intel.age != null ? Number(intel.age) : null;
  if (age == null || Number.isNaN(age)) {
    const dob = intel.date_of_birth || intel.dob;
    if (dob) {
      const d = new Date(dob);
      if (!Number.isNaN(d.getTime())) {
        const diff = Date.now() - d.getTime();
        age = Math.floor(diff / (365.25 * 86400000));
      }
    }
  }
  if (age != null && !Number.isNaN(age) && age >= 45 && age <= 60) {
    breakdown.age_45_60 = BEHAVIOR_POINTS.age_45_60;
    points += BEHAVIOR_POINTS.age_45_60;
  }

  return { points, breakdown };
}

function tierFromScore(score) {
  const s = Number(score) || 0;
  if (s >= TIER_HOT_MIN) return 'Hot';
  if (s >= TIER_WARM_MIN) return 'Warm';
  if (s >= TIER_NURTURE_MIN) return 'Nurture';
  return 'Cold';
}

/** UI / legacy category strings */
function tierDisplayCategory(tier) {
  if (tier === 'Hot') return 'Hot Lead';
  if (tier === 'Warm') return 'Warm Lead';
  if (tier === 'Nurture') return 'Nurture';
  return 'Cold';
}

function actionTimingForTier(tier) {
  if (tier === 'Hot') return 'Within 2 hrs — personal call';
  if (tier === 'Warm') return '24 hrs — WhatsApp sequence';
  if (tier === 'Nurture') return '48 hrs — follow-up sequence';
  return 'Weekly — broadcast only';
}

/**
 * Score one lead (MHS model).
 */
function scoreOneLead(lead) {
  const sugarRaw =
    lead.sugar_level ??
    lead.sugar_poll ??
    lead.SugarPoll ??
    lead.sugarPoll ??
    null;
  // Preserve the original raw string (e.g. "above_250_sugar_level") for display
  const sugarPollRaw = typeof sugarRaw === 'string' ? sugarRaw : (lead.sugar_poll ?? lead.SugarPoll ?? lead.sugarPoll ?? null);
  const mgDl = typeof sugarRaw === 'number' ? sugarRaw : parseSugarMgDl(sugarRaw);
  const { segment: sugarSegment, points: sugarPts } = sugarBand(mgDl);

  const intel = getIntelFromLead(lead);
  const { points: behPts, breakdown: behBreakdown } = behavioralPoints(lead, intel);

  const totalScore = sugarPts + behPts;
  const tier = tierFromScore(totalScore);
  const category = tierDisplayCategory(tier);

  const breakdown = {
    sugar_mg_dl: mgDl,
    sugar_segment: sugarSegment,
    sugar_poll: sugarPollRaw,
    sugar_points: sugarPts,
    behavioral_points: behPts,
    behavioral: behBreakdown,
    total: totalScore,
  };

  return {
    score: Math.round(totalScore),
    tier,
    category,
    sugar_segment: sugarSegment,
    sugar_mg_dl: mgDl,
    sugar_poll: sugarPollRaw,
    action_timing: actionTimingForTier(tier),
    breakdown,
  };
}

function computeBatchSummary(results) {
  const n = results.length;
  if (!n) {
    return {
      total: 0,
      avg_score: null,
      hot_lead_rate_pct: null,
      hot_count: 0,
      warm_count: 0,
      nurture_count: 0,
      cold_count: 0,
      methodology: METHODOLOGY_VERSION,
    };
  }
  const sum = results.reduce((a, r) => a + (Number(r.score) || 0), 0);
  const hot = results.filter((r) => r.tier === 'Hot').length;
  return {
    total: n,
    avg_score: Math.round((sum / n) * 10) / 10,
    hot_lead_rate_pct: Math.round((hot / n) * 1000) / 10,
    hot_count: hot,
    warm_count: results.filter((r) => r.tier === 'Warm').length,
    nurture_count: results.filter((r) => r.tier === 'Nurture').length,
    cold_count: results.filter((r) => r.tier === 'Cold').length,
    methodology: METHODOLOGY_VERSION,
    benchmarks_note:
      'Doc targets: avg score >45, hot rate >25% (populate lead_intel on Leads for full behavioural scoring).',
  };
}

/**
 * Normalise a phone number to its last 10 digits for deduplication.
 */
function last10Digits(phone) {
  if (!phone) return null;
  const digits = String(phone).replace(/\D/g, '');
  return digits.length >= 10 ? digits.slice(-10) : (digits || null);
}

/**
 * Fetch leads from unique_leads table for a date range.
 * Maps rows to the same shape expected by scoreOneLead so the two sources can be merged.
 */
async function getUniqueLeadsForScoring(dateFrom, dateTo) {
  if (!supabase) return [];
  try {
    let q = supabase
      .from('unique_leads')
      .select('phone, user_id, sugar_poll, lead_source_type, date_time, batch_code');
    if (dateFrom) q = q.gte('date_time', dateFrom);
    if (dateTo)   q = q.lte('date_time', dateTo + 'T23:59:59');
    const { data, error } = await q;
    if (error) {
      console.warn('[leadQualityScoring] unique_leads fetch error:', error.message);
      return [];
    }
    return (data || []).map(r => ({
      lead_id: null,
      name: r.phone || '',
      phone: r.phone || '',
      campaign_id: null,
      sugar_poll: r.sugar_poll || null,
      lead_source_type: r.lead_source_type || null,
    }));
  } catch (e) {
    console.warn('[leadQualityScoring] unique_leads fetch failed:', e.message);
    return [];
  }
}

/**
 * Run scoring for leads in date range. Persist to lead_scores.
 * Merges leads from the Leads table AND unique_leads table, deduplicating by phone.
 */
async function runLeadScoring(opts = {}) {
  const { dateFrom, dateTo, campaignIds } = opts || {};
  if (!dateFrom || !dateTo) {
    return { success: false, error: 'dateFrom and dateTo are required', scored: 0, samples: [], summary: null };
  }

  // --- Source 1: Leads table (has name, campaign_id, sugar_poll from form submissions) ---
  let leadsTableRows = [];
  try {
    if (campaignIds && campaignIds.length > 0) {
      leadsTableRows = await getLeadsByCampaignAndAd(campaignIds, null, dateFrom, dateTo);
    } else {
      leadsTableRows = await getLeadsByDateRange(dateFrom, dateTo);
    }
  } catch (e) {
    console.warn('[leadQualityScoring] Leads table fetch error:', e.message);
  }

  // --- Source 2: unique_leads table (broader pool: Paid, Free, YouTube, Walk-In) ---
  const uniqueLeadsRows = campaignIds && campaignIds.length > 0
    ? []
    : await getUniqueLeadsForScoring(dateFrom, dateTo);

  // --- Merge: prefer Leads table records, fill in from unique_leads where phone not seen ---
  const seenPhones = new Set();
  const leads = [];

  for (const lead of leadsTableRows) {
    const key = last10Digits(lead.Phone ?? lead.phone ?? '');
    if (key) seenPhones.add(key);
    leads.push(lead);
  }
  for (const lead of uniqueLeadsRows) {
    const key = last10Digits(lead.phone);
    if (key && seenPhones.has(key)) continue; // already scored from Leads table
    if (key) seenPhones.add(key);
    leads.push(lead);
  }

  console.log(
    `[leadQualityScoring] ${dateFrom}…${dateTo}: Leads=${leadsTableRows.length}, unique_leads=${uniqueLeadsRows.length}, merged=${leads.length}`
  );

  const results = [];
  for (const lead of leads) {
    const scored = scoreOneLead(lead);
    const rawId = lead.lead_id ?? lead.id ?? lead.Id;
    const leadDateTime =
      lead.date_time ??
      lead.TimeUtc ?? lead.time_utc ??
      lead.created_time ??
      lead.DateChar ?? lead.date_char ??
      null;
    results.push({
      lead_id: rawId != null && rawId !== '' ? String(rawId) : null,
      name: lead.Name ?? lead.name,
      phone: lead.Phone ?? lead.phone,
      campaign_id: lead.campaign_id,
      date_time: leadDateTime,
      score: scored.score,
      tier: scored.tier,
      category: scored.category,
      sugar_segment: scored.sugar_segment,
      sugar_mg_dl: scored.sugar_mg_dl,
      sugar_poll: scored.sugar_poll,
      action_timing: scored.action_timing,
      breakdown: scored.breakdown,
    });
  }

  const summary = computeBatchSummary(results);

  if (supabase && results.length > 0) {
    const toUpsert = results
      .filter((r) => r.lead_id)
      .map((r) => ({
        lead_id: r.lead_id,
        name: r.name ?? null,
        phone: r.phone ?? null,
        campaign_id: r.campaign_id ?? null,
        sugar_level: r.sugar_mg_dl != null ? Number(r.sugar_mg_dl) : null,
        form_completion: null,
        score: r.score,
        category: r.category,
        sugar_segment: r.sugar_segment,
        tier: r.tier,
        score_breakdown: { ...r.breakdown, date_time: r.date_time ?? null },
        methodology: METHODOLOGY_VERSION,
        updated_at: new Date().toISOString(),
      }));

    if (toUpsert.length > 0) {
      const { error: upErr } = await supabase.from('lead_scores').upsert(toUpsert, {
        onConflict: 'lead_id',
        ignoreDuplicates: false,
      });
      if (upErr) {
        const msg = upErr.message || '';
        if (/sugar_segment|tier|score_breakdown|methodology|column/i.test(msg)) {
          const slim = toUpsert.map((row) => ({
            lead_id: row.lead_id,
            name: row.name,
            phone: row.phone,
            campaign_id: row.campaign_id,
            sugar_level: row.sugar_level,
            score: row.score,
            category: row.category,
            updated_at: row.updated_at,
          }));
          const { error: e2 } = await supabase.from('lead_scores').upsert(slim, {
            onConflict: 'lead_id',
            ignoreDuplicates: false,
          });
          if (e2) console.error('[leadQualityScoring] upsert error:', e2.message);
          else {
            console.warn(
              '[leadQualityScoring] Extended columns missing; run server/migrations/lead-scores-mhs-intelligence.sql'
            );
          }
        } else {
          console.error('[leadQualityScoring] upsert error:', msg);
        }
      }
    }
  }

  return {
    success: true,
    scored: results.length,
    samples: results,
    summary,
  };
}

/**
 * Get stored lead scores with optional filters.
 */
async function getLeadScores(opts = {}) {
  const { dateFrom, dateTo, campaignId, limit = 10000 } = opts || {};
  if (!supabase) return { success: true, data: [] };

  const baseSelect =
    'id, lead_id, name, phone, campaign_id, score, category, sugar_level, created_at, sugar_segment, tier, score_breakdown, methodology';

  // Filter by the lead's actual creation date stored in score_breakdown->date_time
  // (not updated_at which is when scoring ran — that caused post-scoring leads to be excluded).
  // Order by updated_at DESC so freshly re-scored leads surface first.
  let query = supabase.from('lead_scores').select(baseSelect).order('updated_at', { ascending: false }).limit(limit);

  if (dateFrom) query = query.gte('score_breakdown->>date_time', dateFrom + 'T00:00:00');
  if (dateTo)   query = query.lte('score_breakdown->>date_time', dateTo   + 'T23:59:59');
  if (campaignId) query = query.eq('campaign_id', campaignId);

  const { data, error } = await query;
  if (error) {
    const msg = error.message || '';
    // Fallback: if JSON path filter not supported, return all recent rows without date filter
    if (/score_breakdown|json|column/i.test(msg) || /sugar_segment|tier|methodology/i.test(msg)) {
      let q2 = supabase
        .from('lead_scores')
        .select('id, lead_id, name, phone, campaign_id, score, category, sugar_level, created_at, score_breakdown')
        .order('updated_at', { ascending: false })
        .limit(limit);
      if (campaignId) q2 = q2.eq('campaign_id', campaignId);
      const r2 = await q2;
      if (r2.error) throw r2.error;
      return { success: true, data: r2.data || [] };
    }
    throw error;
  }
  return { success: true, data: data || [] };
}

/** @deprecated use tierFromScore */
function getCategory(score100) {
  return tierDisplayCategory(tierFromScore(score100));
}

module.exports = {
  scoreOneLead,
  runLeadScoring,
  getLeadScores,
  getCategory,
  parseSugarMgDl,
  sugarBand,
  tierFromScore,
  METHODOLOGY_VERSION,
};
