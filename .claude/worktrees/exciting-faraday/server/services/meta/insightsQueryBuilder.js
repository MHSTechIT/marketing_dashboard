/**
 * Insights query builder for Meta /act_{id}/insights.
 * One request per dashboard refresh per ad account.
 * Filtering: IN operator for single/multi campaign/ad; Select All → no campaign.id / ad.id in filtering.
 * Per Meta: filtering param is array of { field, operator, value }; level=ad; time_range={since,until}.
 */

const STATUS_FILTER = [
  { field: 'campaign.effective_status', operator: 'IN', value: ['ACTIVE', 'PAUSED', 'ARCHIVED', 'IN_REVIEW', 'REJECTED', 'PENDING_REVIEW', 'LEARNING', 'ENDED'] },
  { field: 'ad.effective_status', operator: 'IN', value: ['ACTIVE', 'PAUSED', 'ARCHIVED', 'IN_REVIEW', 'REJECTED', 'PENDING_REVIEW', 'LEARNING', 'ENDED'] },
];

const DEFAULT_FIELDS = 'ad_id,ad_name,campaign_id,campaign_name,impressions,clicks,spend,ctr,cpc,actions,action_values,date_start,date_stop';

/**
 * Build filtering array for Meta Insights API.
 * Select All (isAllCampaigns / isAllAds) → status filters only. Otherwise add campaign.id IN and/or ad.id IN.
 * @param {object} opts - { isAllCampaigns, isAllAds, campaignIds: string[], adIds: string[] }
 * @returns {Array<{field,operator,value}>}
 */
function buildFiltering(opts = {}) {
  const { isAllCampaigns = true, isAllAds = true, campaignIds = [], adIds = [] } = opts;
  const list = [...STATUS_FILTER];
  if (!isAllCampaigns && campaignIds && campaignIds.length > 0) {
    list.push({ field: 'campaign.id', operator: 'IN', value: campaignIds.map(String) });
  }
  if (!isAllAds && adIds && adIds.length > 0) {
    list.push({ field: 'ad.id', operator: 'IN', value: adIds.map(String) });
  }
  return list;
}

/**
 * Build params for GET act_{ad_account_id}/insights. One request per account.
 * @param {object} opts - { adAccountId, from, to, isAllCampaigns, isAllAds, campaignIds, adIds, fields }
 * @returns {{ url: string, params: object }}
 */
function buildParams(opts = {}) {
  const {
    adAccountId,
    from,
    to,
    isAllCampaigns = true,
    isAllAds = true,
    campaignIds = [],
    adIds = [],
    fields = DEFAULT_FIELDS,
    timeIncrement = 1,
    level = 'ad',
  } = opts;

  const norm = (id) => (id && String(id).replace(/^act_/, '')) || '';
  const accId = norm(adAccountId);
  const timeRange = JSON.stringify({ since: from, until: to });
  const filtering = buildFiltering({ isAllCampaigns, isAllAds, campaignIds, adIds });

  return {
    url: `https://graph.facebook.com/${process.env.META_API_VERSION || 'v21.0'}/act_${accId}/insights`,
    params: {
      level,
      time_increment: timeIncrement,
      time_range: timeRange,
      fields,
      limit: 1000,
      filtering: JSON.stringify(filtering),
    },
  };
}

module.exports = {
  buildFiltering,
  buildParams,
  STATUS_FILTER,
  DEFAULT_FIELDS,
};
