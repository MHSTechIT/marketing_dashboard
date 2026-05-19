/**
 * YouTube Ads / Google Ads insights for the Ads Analytics Dashboard.
 * GET /api/youtube/insights?from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * When Google Ads credentials are fully configured, fetches live data.
 * Otherwise falls back to stub data for UI development / demo.
 */
const express = require('express');
const router = express.Router();
const { optionalAuthMiddleware } = require('../auth');
const { credentialsReady, fetchYouTubeAdsMetrics } = require('../services/googleAdsService');

router.get('/insights', optionalAuthMiddleware, async (req, res) => {
  try {
    const from = (req.query.from || '').trim();
    const to = (req.query.to || '').trim();
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!from || !to || !dateRegex.test(from) || !dateRegex.test(to)) {
      return res.status(400).json({
        error: 'Missing or invalid date range',
        details: 'Query params "from" and "to" (YYYY-MM-DD) are required',
      });
    }

    // --- Try live Google Ads API first ---
    const { ready, missing } = credentialsReady();
    if (ready) {
      try {
        const liveData = await fetchYouTubeAdsMetrics(from, to);
        console.log('[YouTube insights] Live data fetched from Google Ads API');
        return res.json({ ...liveData, source: 'google_ads_api' });
      } catch (apiErr) {
        console.error('[YouTube insights] Google Ads API error, falling back to stub:', apiErr.response?.data || apiErr.message);
      }
    } else {
      console.log('[YouTube insights] Missing credentials:', missing.join(', '), '— using stub data');
    }

    // --- Stub / fallback ---
    const start = new Date(from);
    const end = new Date(to);
    const days = Math.max(1, Math.ceil((end - start) / (1000 * 60 * 60 * 24)));
    const labels = [];
    for (let d = 0; d < Math.min(days, 14); d++) {
      const date = new Date(start);
      date.setDate(date.getDate() + d);
      labels.push(date.toISOString().slice(0, 10));
    }

    const summary = {
      cost: 0, conversions: 0, leads: 0, cpl: 0, cpm: 0,
      optInRate: 0, linkClicks: 0, ctr: 0, roas: 0,
      totalConversions: 0, conversionRate: 0, landingPageViews: 0,
    };

    const useStub = process.env.YOUTUBE_INSIGHTS_STUB !== '0';
    if (useStub) {
      const seed = from.length + to.length;
      summary.cost = 5000 + (seed % 3000);
      summary.leads = 80 + (seed % 40);
      summary.conversions = summary.leads;
      summary.totalConversions = summary.conversions;
      summary.linkClicks = 450 + (seed % 200);
      summary.landingPageViews = 380 + (seed % 150);
      summary.cpl = summary.leads > 0 ? summary.cost / summary.leads : 0;
      summary.cpm = 120 + (seed % 30);
      summary.optInRate = summary.landingPageViews > 0 ? (summary.conversions / summary.landingPageViews) * 100 : 0;
      summary.ctr = 2.2 + (seed % 10) / 10;
      summary.roas = 1.5 + (seed % 20) / 10;
      summary.conversionRate = summary.linkClicks > 0 ? (summary.conversions / summary.linkClicks) * 100 : 0;
    }

    const chartOptInRateVsCost = labels.map((date, i) => ({
      date,
      optInRate: summary.optInRate ? summary.optInRate * (0.8 + (i % 5) * 0.05) : 0,
      cost: summary.cost ? (summary.cost / labels.length) * (0.9 + (i % 3) * 0.1) : 0,
    }));
    const chartLeadsVsCpl = labels.map((date, i) => ({
      date,
      leads: summary.leads ? Math.round((summary.leads / labels.length) * (0.85 + (i % 4) * 0.1)) : 0,
      cpl: summary.cpl ? summary.cpl * (0.9 + (i % 5) * 0.05) : 0,
    }));
    const chartLinkClicksVsLandingPageViews = labels.map((date, i) => ({
      date,
      linkClicks: summary.linkClicks ? Math.round((summary.linkClicks / labels.length) * (0.8 + (i % 6) * 0.08)) : 0,
      landingPageViews: summary.landingPageViews ? Math.round((summary.landingPageViews / labels.length) * (0.82 + (i % 5) * 0.07)) : 0,
    }));

    const missingMsg = ready ? '' : ` Missing env vars: ${missing.join(', ')}.`;
    return res.json({
      summary,
      chartOptInRateVsCost,
      chartLeadsVsCpl,
      chartLinkClicksVsLandingPageViews,
      source: 'stub',
      message: `Stub data.${missingMsg} Configure Google Ads credentials in .env for live YouTube metrics.`,
    });
  } catch (err) {
    console.error('[YouTube insights] Error:', err.message);
    return res.status(500).json({ error: 'Failed to fetch YouTube insights', details: err.message });
  }
});

module.exports = router;
