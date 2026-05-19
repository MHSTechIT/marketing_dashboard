/**
 * Shared project → ad account mapping for Ads Analytics and Best Performing Ad.
 * STRICT ID-BASED: Only the Ad Account IDs listed here are used. No other accounts are included.
 * Client-only; API does not return project.
 */

/**
 * Project → ad account IDs (without act_ prefix). Single source of truth.
 * Only these IDs are shown under each project and used for all dashboard metrics.
 */
export const PROJECT_AD_ACCOUNT_IDS = {
  'Free Webinar': [
    '1118966742784490', // My Health School – Test Account
    '1693523178051861', // MHS Integfarms – 1
    '986663466448607',  // MHS Integfarms – 2
    '1165675118015737', // MHS S-1
    '1538719834059161', // MHS 2025
    '1016470376862563', // New MHS 01
    '1421944619002441', // Integfarm MHS 01
    '1990711071494666', // Integfarms 01
    '384231607347196',  // MHS Ad Account 2024
    '530615489114338',  // My Health School – Current
    '1088771750122808', // My Health School 2025
    '1398296668512853'  // Integfarm MHS 02
  ],
  'Paid Webinar': [
    '332450076623103'   // MHS S-2
  ],
  'YouTube Ads': [
    '1512093733230882'  // Integfarms 02
  ],
  'Direct Walk-in': [
    '384231607347196'   // MHS Ad Account 2024
  ],
  'Dental': [
    '327236376911765'   // MHS Dental Care
  ],
  'True Food Store': [
    '705155253819861'   // Integfarms
  ],
  'Integfarms': []
};

/** Display names for IDs when account is not in the API list (e.g. synthetic entry). */
const ID_DISPLAY_NAME_FALLBACK = {
  '1118966742784490': 'My Health School – Test Account',
  '1693523178051861': 'MHS Integfarms – 1',
  '986663466448607': 'MHS Integfarms – 2',
  '1165675118015737': 'MHS S-1',
  '1538719834059161': 'MHS 2025',
  '1016470376862563': 'New MHS 01',
  '1421944619002441': 'Integfarm MHS 01',
  '1990711071494666': 'Integfarms 01',
  '384231607347196': 'MHS Ad Account 2024',
  '530615489114338': 'My Health School – Current',
  '1088771750122808': 'My Health School 2025',
  '1398296668512853': 'Integfarm MHS 02',
  '332450076623103': 'MHS S-2',
  '1512093733230882': 'Integfarms 02',
  '327236376911765': 'MHS Dental Care',
  '705155253819861': 'Integfarms'
};

export const PROJECT_ORDER = ['Free Webinar', 'Paid Webinar', 'YouTube Ads', 'Direct Walk-in', 'Dental', 'True Food Store', 'Integfarms'];

/** All specified ad account IDs (union of all projects). Use for "All Projects" so only these IDs are included. */
export const ALL_SPECIFIED_ACCOUNT_IDS = [...new Set(PROJECT_ORDER.flatMap((p) => (PROJECT_AD_ACCOUNT_IDS[p] || [])))];

/** Normalize name for matching (trim, case-insensitive, unify dashes). */
export const normalizeAccountName = (name) => {
  const s = (name || '').toString().trim().toLowerCase();
  return s.replace(/[\u2013\u2014\u2015]/g, '-').replace(/\s+/g, ' ');
};

/** Normalize account ID for consistent comparison (strip act_ prefix, string). */
export const normalizeAccountId = (id) => {
  const s = (id != null && id !== '') ? String(id).trim() : '';
  return s.replace(/^act_/i, '');
};

/**
 * Build ad accounts grouped by project. STRICT ID-BASED: only PROJECT_AD_ACCOUNT_IDS are included.
 * @param {Array} adAccounts - List of account objects with account_id/id and account_name/name
 * @returns {{ [projectName]: Array<{ value: string, displayName: string }>, Other: Array }}
 */
export function buildAdAccountsByProject(adAccounts) {
  const filtered = adAccounts || [];
  const idToEntry = new Map();
  filtered.forEach((acc) => {
    const rawId = acc.account_id || acc.id;
    const id = normalizeAccountId(rawId);
    const displayName = (acc.account_name || acc.name || `Account ${rawId}`).trim();
    idToEntry.set(id, { id, displayName, account: acc });
  });

  const result = {};
  PROJECT_ORDER.forEach((projectName) => {
    const ids = PROJECT_AD_ACCOUNT_IDS[projectName] || [];
    result[projectName] = ids.map((rawId) => {
      const id = normalizeAccountId(rawId);
      const entry = idToEntry.get(id);
      return {
        value: id,
        displayName: entry ? entry.displayName : (ID_DISPLAY_NAME_FALLBACK[id] || `Account ${id}`)
      };
    });
  });

  // No other ad accounts: only the specified IDs are used across the dashboard.
  result['Other'] = [];
  return result;
}
