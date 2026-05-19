/**
 * Wix API routes
 * GET /api/wix/analytics?from=YYYY-MM-DD&to=YYYY-MM-DD
 * Returns normalized analytics rows for the dashboard (platform: 'wix').
 */
const express = require('express');
const router = express.Router();
const { optionalAuthMiddleware } = require('../auth');
const { fetchWixAnalytics, getWixCredentials } = require('../wix/wixService');

/**
 * GET /api/wix/status
 * Returns whether Wix credentials are configured. Use for troubleshooting.
 */
router.get('/status', optionalAuthMiddleware, (req, res) => {
  try {
    getWixCredentials();
    res.json({ configured: true, message: 'Wix credentials are set.' });
  } catch (e) {
    res.status(503).json({
      configured: false,
      message: 'Wix not configured',
      details: 'Set WIX_SITE_ID and WIX_TOKEN in server/.env, then restart the server.',
    });
  }
});

/**
 * GET /api/wix/analytics
 * Query: from (YYYY-MM-DD), to (YYYY-MM-DD), diagnose (optional, set to 1 for raw response)
 * Returns { rows: [...], error?: string, raw?: object } for dashboard merge and error display.
 */
router.get('/analytics', optionalAuthMiddleware, async (req, res) => {
  try {
    const from = (req.query.from || '').trim();
    const to = (req.query.to || '').trim();
    const diagnose = req.query.diagnose === '1' || req.query.diagnose === 'true';

    if (!from || !to) {
      return res.status(400).json({
        rows: [],
        error: 'Missing date range',
        details: 'Query params "from" and "to" (YYYY-MM-DD) are required',
      });
    }

    try {
      getWixCredentials();
    } catch (e) {
      return res.status(503).json({
        rows: [],
        error: 'Wix not configured',
        details: 'Set WIX_SITE_ID and WIX_TOKEN in server/.env',
      });
    }

    const result = await fetchWixAnalytics({ from, to, diagnose });
    res.json({
      rows: Array.isArray(result.rows) ? result.rows : [],
      error: result.error || null,
      raw: diagnose ? result.raw : undefined,
    });
  } catch (err) {
    console.error('[Wix route] Error:', err.message);
    res.status(500).json({
      rows: [],
      error: 'Failed to fetch Wix analytics',
      details: err.message,
    });
  }
});

module.exports = router;
