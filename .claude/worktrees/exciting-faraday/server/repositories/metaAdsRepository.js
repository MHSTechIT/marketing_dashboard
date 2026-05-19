/**
 * Meta Ads cache. Fetch /act_{id}/ads once per account; never on filter change.
 * UI and insights flow read from DB only. Sync triggered by job or explicit refresh.
 */

const { supabase } = require('../supabase');

async function upsert(adAccountId, ads) {
  if (!supabase || !adAccountId) return { inserted: 0, updated: 0 };
  const norm = (id) => String(id || '').replace(/^act_/, '');
  const accId = norm(adAccountId);
  if (!ads || ads.length === 0) return { inserted: 0, updated: 0 };

  const rows = ads.map((a) => ({
    ad_account_id: accId,
    ad_id: String(a.id || a.ad_id || ''),
    campaign_id: String(a.campaign_id || ''),
    name: a.name || '',
    status: a.status || '',
    effective_status: a.effective_status || '',
    updated_at: new Date().toISOString(),
  })).filter((r) => r.ad_id);

  const { error } = await supabase
    .from('meta_ads')
    .upsert(rows, {
      onConflict: 'ad_account_id,ad_id',
      ignoreDuplicates: false,
    });
  if (error) throw error;
  return { inserted: rows.length, updated: 0 };
}

/**
 * List ads for ad account(s). Optional filter by campaign_ids.
 * @param {string|string[]} adAccountIds - Single id or array (no act_)
 * @param {object} opts - { campaign_ids: string[] } optional; if empty, all ads for account(s)
 */
async function list(adAccountIds, opts = {}) {
  if (!supabase) throw new Error('Supabase not configured');
  const ids = Array.isArray(adAccountIds)
    ? adAccountIds.map((id) => String(id).replace(/^act_/, ''))
    : [String(adAccountIds || '').replace(/^act_/, '')];
  const valid = ids.filter(Boolean);
  if (valid.length === 0) return [];

  let q = supabase
    .from('meta_ads')
    .select('ad_account_id, ad_id, campaign_id, name, status, effective_status')
    .in('ad_account_id', valid);
  const campaignIds = opts.campaign_ids && Array.isArray(opts.campaign_ids)
    ? opts.campaign_ids.map(String).filter(Boolean)
    : [];
  if (campaignIds.length > 0) {
    q = q.in('campaign_id', campaignIds);
  }
  q = q.order('name');
  const { data, error } = await q;
  if (error) throw error;
  return (data || []).map((r) => ({
    id: r.ad_id,
    ad_id: r.ad_id,
    name: r.name,
    status: r.status,
    effective_status: r.effective_status,
    campaign_id: r.campaign_id,
    ad_account_id: r.ad_account_id,
  }));
}

module.exports = {
  upsert,
  list,
};
