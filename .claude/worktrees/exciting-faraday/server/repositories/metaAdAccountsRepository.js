/**
 * Meta Ad Accounts cache. UI reads from DB only.
 * Populated by AdAccountsService from /me/adaccounts.
 */

const { supabase } = require('../supabase');

async function upsert(accounts) {
  if (!supabase || !accounts || accounts.length === 0) {
    return { inserted: 0, updated: 0 };
  }
  const rows = accounts.map((acc) => ({
    account_id: String(acc.account_id || acc.id || '').replace(/^act_/, ''),
    name: acc.name || acc.account_name || '',
    currency: acc.currency || 'USD',
    timezone_name: acc.timezone_name || 'UTC',
    account_status: acc.account_status != null ? acc.account_status : 0,
    updated_at: new Date().toISOString(),
  })).filter((r) => r.account_id);

  const { data, error } = await supabase
    .from('meta_ad_accounts')
    .upsert(rows, {
      onConflict: 'account_id',
      ignoreDuplicates: false,
    })
    .select('account_id');

  if (error) throw error;
  return { inserted: (data || []).length, updated: 0 };
}

async function list() {
  if (!supabase) throw new Error('Supabase not configured');
  const { data, error } = await supabase
    .from('meta_ad_accounts')
    .select('account_id, name, currency, timezone_name, account_status')
    .order('name');
  if (error) throw error;
  return (data || []).map((r) => ({
    account_id: r.account_id,
    account_name: r.name || `Account ${r.account_id}`,
    currency: r.currency || 'USD',
    timezone: r.timezone_name || 'UTC',
    status: r.account_status === 1 ? 'ACTIVE' : 'INACTIVE',
  }));
}

module.exports = {
  upsert,
  list,
};
