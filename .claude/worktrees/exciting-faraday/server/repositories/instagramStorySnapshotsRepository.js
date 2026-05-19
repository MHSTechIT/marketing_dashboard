/**
 * Store and retrieve Instagram story metrics so we can show "existing" stories
 * after the 24h API window. Table: instagram_story_snapshots.
 */

const { supabase } = require('../supabase');

const TABLE = 'instagram_story_snapshots';
const DEFAULT_LIMIT = 50;

function rowToMedia(row) {
  return {
    media_id: row.media_id,
    permalink: row.permalink || null,
    timestamp: row.timestamp || null,
    caption: row.caption || null,
    media_type: 'VIDEO',
    product_type: 'STORY',
    thumbnail_url: row.thumbnail_url || null,
    media_url: row.media_url || null,
    views: Number(row.views) || 0,
    reach: Number(row.reach) || 0,
    video_views: Number(row.views) || 0,
    total_interactions: Number(row.total_interactions) || 0,
    likes: Number(row.likes) || 0,
    comments: Number(row.comments) || 0,
    shares: Number(row.shares) || 0,
    saved: Number(row.saved) || 0,
    hook_rate: null,
    hold_rate: null,
    availability: 'available',
  };
}

/**
 * Upsert story metrics for an IG account. No-op if Supabase not configured.
 * @param {string} igAccountId
 * @param {Array<object>} stories - Same shape as fetchMediaInsights result (media_id, views, likes, etc.)
 */
async function saveStories(igAccountId, stories) {
  if (!supabase || !igAccountId || !Array.isArray(stories) || stories.length === 0) {
    return { saved: 0 };
  }
  const rows = stories
    .filter((s) => s && (s.media_id || s.id))
    .map((s) => ({
      ig_account_id: String(igAccountId),
      media_id: String(s.media_id || s.id),
      permalink: s.permalink || null,
      timestamp: s.timestamp || null,
      caption: s.caption || null,
      thumbnail_url: s.thumbnail_url || null,
      media_url: s.media_url || null,
      views: Number(s.views) || Number(s.video_views) || 0,
      reach: Number(s.reach) || 0,
      likes: Number(s.likes) || 0,
      comments: Number(s.comments) || 0,
      shares: Number(s.shares) || 0,
      saved: Number(s.saved) || 0,
      total_interactions: Number(s.total_interactions) || 0,
    }));
  if (rows.length === 0) return { saved: 0 };

  const { error } = await supabase
    .from(TABLE)
    .upsert(rows, { onConflict: 'ig_account_id,media_id', ignoreDuplicates: false });

  if (error) {
    if (error.code === '42P01' || (error.message && error.message.includes('does not exist'))) {
      return { saved: 0 };
    }
    throw error;
  }
  return { saved: rows.length };
}

/**
 * Get stored stories for the given IG account IDs, sorted by views desc.
 * Returns [] if Supabase not configured or table missing.
 * @param {string[]} accountIds
 * @param {number} limit
 * @returns {Promise<Array<object>>} Media-shaped objects (product_type: 'STORY')
 */
async function getStoriesByAccountIds(accountIds, limit = DEFAULT_LIMIT) {
  if (!supabase || !Array.isArray(accountIds) || accountIds.length === 0) {
    return [];
  }
  const ids = accountIds.map((id) => String(id)).filter(Boolean);
  const { data, error } = await supabase
    .from(TABLE)
    .select('*')
    .in('ig_account_id', ids)
    .order('views', { ascending: false })
    .limit(Number(limit) || DEFAULT_LIMIT);

  if (error) {
    if (error.code === '42P01' || (error.message && error.message.includes('does not exist'))) {
      return [];
    }
    throw error;
  }
  return (data || []).map(rowToMedia);
}

module.exports = {
  saveStories,
  getStoriesByAccountIds,
  rowToMedia,
};
