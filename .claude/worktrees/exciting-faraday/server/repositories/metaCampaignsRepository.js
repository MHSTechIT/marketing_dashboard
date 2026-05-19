/**
 * Meta Campaigns cache. Cache 24h+ per ad account.
 * Populated by CampaignsService from /act_{id}/campaigns.
 */

const { supabase } = require('../supabase');

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

async function upsert(adAccountId, campaigns) {
  if (!supabase || !adAccountId) return { inserted: 0, updated: 0 };
  const norm = (id) => String(id || '').replace(/^act_/, '');
  const accId = norm(adAccountId);
  if (!campaigns || campaigns.length === 0) {
    return { inserted: 0, updated: 0 };
  }
  const rows = campaigns.map((c) => ({
    ad_account_id: accId,
    campaign_id: String(c.id || c.campaign_id || ''),
    name: c.name || '',
    status: c.status || '',
    effective_status: c.effective_status || '',
    objective: c.objective || '',
    updated_at: new Date().toISOString(),
  })).filter((r) => r.campaign_id);

  const { error } = await supabase
    .from('meta_campaigns')
    .upsert(rows, {
      onConflict: 'ad_account_id,campaign_id',
      ignoreDuplicates: false,
    });
  if (error) throw error;
  return { inserted: rows.length, updated: 0 };
}

/**
 * List campaigns for ad account(s). If cached_at older than 24h, caller should refresh from API.
 * @param {string|string[]} adAccountIds - Single id or array (numeric, no act_)
 * @param {object} opts - { useCacheOnly: boolean } not used here; TTL checked by service
 */
async function list(adAccountIds, opts = {}) {
  if (!supabase) throw new Error('Supabase not configured');
  const ids = Array.isArray(adAccountIds)
    ? adAccountIds.map((id) => String(id).replace(/^act_/, ''))
    : [String(adAccountIds || '').replace(/^act_/, '')];
  const valid = ids.filter(Boolean);
  if (valid.length === 0) return [];

  let q = supabase
    .from('meta_campaigns')
    .select('ad_account_id, campaign_id, name, status, effective_status, objective, updated_at')
    .in('ad_account_id', valid)
    .order('name');
  const { data, error } = await q;
  if (error) throw error;
  return (data || []).map((r) => ({
    id: r.campaign_id,
    campaign_id: r.campaign_id,
    name: r.name,
    status: r.status,
    effective_status: r.effective_status,
    objective: r.objective,
    ad_account_id: r.ad_account_id,
    _updated_at: r.updated_at,
  }));
}

/**
 * Oldest updated_at for given ad account(s). Used to decide if cache is stale (> 24h).
 */
async function oldestUpdatedAt(adAccountIds) {
  if (!supabase) return null;
  const ids = Array.isArray(adAccountIds) ? adAccountIds : [adAccountIds];
  const valid = ids.map((id) => String(id).replace(/^act_/, '')).filter(Boolean);
  if (valid.length === 0) return null;
  const { data, error } = await supabase
    .from('meta_campaigns')
    .select('updated_at')
    .in('ad_account_id', valid)
    .order('updated_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  return data.updated_at ? new Date(data.updated_at).getTime() : null;
}

module.exports = {
  upsert,
  list,
  oldestUpdatedAt,
  CACHE_TTL_MS,
};
