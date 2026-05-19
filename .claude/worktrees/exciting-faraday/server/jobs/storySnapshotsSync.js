// server/jobs/storySnapshotsSync.js
// Captures Instagram story metrics into instagram_story_snapshots so "Top Stories by Views"
// can show data after the 24h API window. Run periodically (e.g. every 6 hours).

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const axios = require('axios');
const { fetchInstagramMediaInsights } = require('../meta/instagramMediaInsightsService');

const META_API_VERSION = process.env.META_IG_API_VERSION || process.env.META_API_VERSION || 'v24.0';

function getSystemToken() {
  const token = (
    process.env.META_SYSTEM_ACCESS_TOKEN ||
    process.env.META_ACCESS_TOKEN ||
    ''
  ).trim();
  if (!token) {
    throw new Error(
      'Meta credentials missing. Configure META_SYSTEM_ACCESS_TOKEN or META_ACCESS_TOKEN in server/.env'
    );
  }
  return token;
}

/**
 * Get page access token for a page ID (for Instagram insights).
 * @param {string} pageId - Facebook Page ID
 * @returns {Promise<string|null>} - Page access token or null on failure
 */
async function getPageAccessToken(pageId) {
  if (process.env.META_PAGE_ACCESS_TOKEN) {
    return process.env.META_PAGE_ACCESS_TOKEN;
  }
  try {
    const systemToken = getSystemToken();
    const response = await axios.get(
      `https://graph.facebook.com/${META_API_VERSION}/${pageId}`,
      {
        params: { fields: 'access_token', access_token: systemToken },
        timeout: 15000,
      }
    );
    return (response.data && response.data.access_token) || null;
  } catch (err) {
    console.warn(
      `[StorySnapshotsSync] Page token for ${pageId}:`,
      err?.response?.data?.error?.message || err.message
    );
    return null;
  }
}

/**
 * Resolve page IDs from env: META_PAGE_IDS (comma-separated) or META_PAGE_ID.
 * @returns {string[]}
 */
function getPageIdsFromEnv() {
  const ids = (process.env.META_PAGE_IDS || process.env.META_PAGE_ID || '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
  return ids;
}

/**
 * Run story snapshot sync: fetch live stories from API and persist to instagram_story_snapshots.
 * The media insights service already saves when contentType is 'stories' and stories are returned.
 */
async function runStorySnapshotsSync() {
  const pageIds = getPageIdsFromEnv();
  if (pageIds.length === 0) {
    return;
  }

  try {
    const result = await fetchInstagramMediaInsights({
      pageIds,
      getPageToken: getPageAccessToken,
      contentType: 'stories',
    });

    const media = result.media || [];
    const errors = result.error ? [result.error] : [];
    const warnings = result.warnings || [];

    if (media.length > 0) {
      console.log(
        `[StorySnapshotsSync] Captured ${media.length} story snapshot(s) for page(s) ${pageIds.join(', ')}`
      );
    }
    if (errors.length > 0) {
      console.warn('[StorySnapshotsSync] Errors:', errors.join('; '));
    }
    if (warnings.length > 0) {
      console.warn('[StorySnapshotsSync] Warnings:', warnings.join('; '));
    }
  } catch (err) {
    console.error(
      '[StorySnapshotsSync] Sync failed:',
      err?.response?.data || err.message
    );
  }
}

/** Interval in ms: every 6 hours so stories (24h window) are captured multiple times. */
const INTERVAL_MS = 6 * 60 * 60 * 1000;

/**
 * Start scheduler: run on startup (after a short delay), then every 6 hours.
 * Requires META_PAGE_ID or META_PAGE_IDS and Meta token. If no page IDs, scheduler does not start.
 */
function startStorySnapshotsScheduler() {
  const pageIds = getPageIdsFromEnv();
  if (pageIds.length === 0) {
    console.warn(
      '[StorySnapshotsSync] META_PAGE_ID or META_PAGE_IDS not set; story snapshot scheduler disabled.'
    );
    return null;
  }
  try {
    getSystemToken();
  } catch (e) {
    console.warn('[StorySnapshotsSync] Meta token missing; scheduler disabled.');
    return null;
  }

  // Run once after 30s (allow server to finish startup), then every 6 hours
  setTimeout(() => {
    runStorySnapshotsSync().catch((err) =>
      console.error('[StorySnapshotsSync] Initial run failed:', err.message)
    );
  }, 30 * 1000);

  const intervalId = setInterval(() => {
    runStorySnapshotsSync().catch((err) =>
      console.error('[StorySnapshotsSync] Scheduled run failed:', err.message)
    );
  }, INTERVAL_MS);

  console.log(
    `[StorySnapshotsSync] Scheduler started (every 6h) for page(s): ${pageIds.join(', ')}`
  );
  return intervalId;
}

module.exports = {
  runStorySnapshotsSync,
  startStorySnapshotsScheduler,
  getPageIdsFromEnv,
};
