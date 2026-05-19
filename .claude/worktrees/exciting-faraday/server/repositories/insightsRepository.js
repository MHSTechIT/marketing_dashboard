// server/repositories/insightsRepository.js
const { supabase } = require('../supabase');

/**
 * Normalize Meta insight row into DB keys. Uses empty string for missing campaign_id/ad_id for uniqueness.
 * @param {string} adAccountId - Ad account ID (no act_)
 * @param {object} item - Meta insight object (campaign_name, ad_name, etc.)
 * @param {string} [adAccountName] - Ad account display name (from Meta or env)
 */
function toRow(adAccountId, item, adAccountName = '') {
  const campaignId = (item.campaign_id != null && item.campaign_id !== '') ? String(item.campaign_id) : '';
  const adId = (item.ad_id != null && item.ad_id !== '') ? String(item.ad_id) : '';
  const dateStart = item.date_start != null ? String(item.date_start) : '';
  const dateStop = item.date_stop != null ? String(item.date_stop) : '';
  const campaignName = (item.campaign_name != null && item.campaign_name !== '') ? String(item.campaign_name) : '';
  const adName = (item.ad_name != null && item.ad_name !== '') ? String(item.ad_name) : '';
  return {
    ad_account_id: String(adAccountId),
    ad_account_name: adAccountName ? String(adAccountName) : '',
    campaign_id: campaignId,
    campaign_name: campaignName,
    ad_id: adId,
    ad_name: adName,
    date_start: dateStart,
    date_stop: dateStop,
    payload: item && typeof item === 'object' ? item : {},
  };
}

/**
 * Upsert insights so existing data is not stored again.
 * @param {string} adAccountId - Ad account ID (without act_)
 * @param {object[]} insights - Array of Meta insight objects (each has date_start, date_stop, campaign_id, ad_id, campaign_name, ad_name, etc.)
 * @param {object} [opts] - { adAccountName?: string }
 */
async function upsertInsights(adAccountId, insights, opts = {}) {
  if (!supabase) {
    throw new Error('Supabase not configured');
  }
  if (!insights || insights.length === 0) {
    return { inserted: 0, updated: 0 };
  }

  const adAccountName = opts.adAccountName || '';
  const normalized = insights.map((item) => toRow(adAccountId, item, adAccountName));
  const { data, error } = await supabase
    .from('meta_insights')
    .upsert(normalized, {
      onConflict: 'ad_account_id,campaign_id,ad_id,date_start,date_stop',
    });

  if (error) {
    throw error;
  }
  return { inserted: normalized.length, updated: 0 };
}

/**
 * Fetch insights from DB for dashboard. Same filters as GET /api/meta/insights.
 * Returns rows in Meta API shape (using payload) so the client gets the same structure.
 * @param {object} opts - { ad_account_id, from, to, campaign_id, ad_id }
 */
async function getInsights(opts) {
  if (!supabase) {
    throw new Error('Supabase not configured');
  }

  const { ad_account_id, from, to, campaign_id, ad_id } = opts || {};
  let q = supabase
    .from('meta_insights')
    .select('payload, ad_account_id, ad_account_name');

  if (ad_account_id) {
    q = q.eq('ad_account_id', String(ad_account_id).replace(/^act_/, ''));
  }
  if (from) {
    q = q.gte('date_stop', from); // insight overlaps [from, to]: date_stop >= from
  }
  if (to) {
    q = q.lte('date_start', to);  // insight overlaps [from, to]: date_start <= to
  }
  if (campaign_id && String(campaign_id).trim() !== '') {
    const ids = String(campaign_id).split(',').map((s) => s.trim()).filter(Boolean);
    if (ids.length === 1) {
      q = q.eq('campaign_id', ids[0]);
    } else if (ids.length > 1) {
      q = q.in('campaign_id', ids);
    }
  }
  if (ad_id && String(ad_id).trim() !== '') {
    const ids = String(ad_id).split(',').map((s) => s.trim()).filter(Boolean);
    if (ids.length === 1) {
      q = q.eq('ad_id', ids[0]);
    } else if (ids.length > 1) {
      q = q.in('ad_id', ids);
    }
  }

  const { data, error } = await q.order('date_start', { ascending: true });

  if (error) {
    throw error;
  }

  const rows = (data || []).map((r) => ({
    ...(r.payload || {}),
    ad_account_id: r.ad_account_id || '',
    ad_account_name: r.ad_account_name || '',
  }));
  // #region agent log
  const dates = rows.map((r) => r.date_start || r.date_stop).filter(Boolean);
  const sorted = [...dates].sort();
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
    req.end(
      JSON.stringify({
        location: 'insightsRepository.js:getInsights',
        message: 'db query result',
        data: {
          from,
          to,
          campaign_id: (campaign_id || '').slice(0, 20),
          ad_id: (ad_id || '').slice(0, 20),
          rowCount: rows.length,
          minDate: sorted[0] || null,
          maxDate: sorted[sorted.length - 1] || null,
        },
        timestamp: Date.now(),
        sessionId: 'debug-session',
        hypothesisId: 'H3',
      })
    );
  } catch (_) {}
  // #endregion
  return rows;
}

module.exports = {
  upsertInsights,
  getInsights,
};
