const express = require('express');
const router = express.Router();
const Anthropic = require('@anthropic-ai/sdk');

// Lazy-init so bad key doesn't crash server on load
function getClient() {
  const key = (process.env.ANTHROPIC_API_KEY || '').trim();
  if (!key) throw new Error('ANTHROPIC_API_KEY not set');
  return new Anthropic({ apiKey: key });
}

async function callClaude(prompt) {
  const client = getClient();
  const msg = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1024,
    messages: [{ role: 'user', content: prompt }],
  });
  return msg.content[0]?.text || '';
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /reel-ad-bridge
// ─────────────────────────────────────────────────────────────────────────────
router.post('/reel-ad-bridge', async (req, res) => {
  try {
    const { reels = [], bestAds = [] } = req.body;

    // Compute adPotentialScore for each reel
    const scored = reels.map((r) => {
      const hook_rate_score = Math.min((r.hook_rate || 0) * 5, 15);
      const saves_rate = (r.saves || 0) / Math.max(r.reach || 1, 1);
      const saves_score = Math.min(saves_rate * 500, 25);
      const shares_rate = (r.shares || 0) / Math.max(r.reach || 1, 1);
      const shares_score = Math.min(shares_rate * 1000, 25);
      const watch_bonus =
        (r.video_avg_time_watched || 0) > 30
          ? 20
          : (r.video_avg_time_watched || 0) > 15
          ? 10
          : 0;
      const engagement_overall = Math.min(
        ((r.saves || 0) + (r.shares || 0)) / Math.max(r.reach || 1, 1) * 2000,
        15
      );
      const adPotentialScore =
        hook_rate_score + saves_score + shares_score + watch_bonus + engagement_overall;
      return { ...r, adPotentialScore };
    });

    // Sort by adPotentialScore desc, take top 5
    const top5WithScore = scored
      .sort((a, b) => b.adPotentialScore - a.adPotentialScore)
      .slice(0, 5);

    const prompt = `You are a performance marketing analyst for a health education brand (MHS - My Health School, diabetes awareness).

Best-performing ads for context:
${JSON.stringify(bestAds, null, 2)}

Top organic reels by ad potential:
${JSON.stringify(top5WithScore, null, 2)}

For each reel, provide:
1. A 1-sentence "Ad Potential" verdict (why this reel suits paid promotion)
2. A specific hook/angle to use in the ad copy
3. Which best ad's CPL profile it most resembles

Be concise. Format as JSON array: [{ id, verdict, hook_angle, resembles_ad, potential_score }]
Return ONLY valid JSON array.`;

    const raw = await callClaude(prompt);

    // Extract JSON from response
    let bridges = [];
    try {
      const match = raw.match(/\[[\s\S]*\]/);
      bridges = JSON.parse(match ? match[0] : raw);
    } catch (parseErr) {
      console.error('[reel-ad-bridge] JSON parse error:', parseErr.message);
      bridges = [];
    }

    // Merge back with reel data
    const bridgesWithData = bridges.map((b) => {
      const reel = top5WithScore.find((r) => r.id === b.id) || {};
      return { ...reel, ...b };
    });

    return res.json({
      success: true,
      bridges: bridgesWithData,
      analysedAt: new Date().toISOString(),
    });
  } catch (e) {
    console.error('[reel-ad-bridge] Error:', e.message);
    return res.status(500).json({ success: false, error: e.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /content-velocity
// ─────────────────────────────────────────────────────────────────────────────
router.post('/content-velocity', async (req, res) => {
  try {
    const { reels = [] } = req.body;

    // Compute viewsPerDay and daysOld for each reel
    const withVelocity = reels.map((r) => {
      const daysOld =
        (Date.now() - new Date(r.timestamp).getTime()) / 86400000;
      const viewsPerDay = (r.views || 0) / Math.max(daysOld, 0.5);
      return { ...r, daysOld, viewsPerDay };
    });

    // Compute median viewsPerDay
    const sorted = [...withVelocity]
      .map((r) => r.viewsPerDay)
      .sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    const median =
      sorted.length === 0
        ? 0
        : sorted.length % 2 === 0
        ? (sorted[mid - 1] + sorted[mid]) / 2
        : sorted[mid];

    // Flag reels
    const flagged = withVelocity
      .filter(
        (r) =>
          (r.viewsPerDay > median * 1.5 && r.daysOld < 14) ||
          (r.viewsPerDay > median * 3 && r.daysOld < 3)
      )
      .map((r) => {
        const isViral = r.viewsPerDay > median * 3 && r.daysOld < 3;
        return {
          ...r,
          flagType: isViral ? 'viral_candidate' : 'momentum',
        };
      });

    if (flagged.length === 0) {
      return res.json({
        success: true,
        alerts: [],
        totalReels: reels.length,
        flaggedCount: 0,
      });
    }

    const prompt = `You are a social media growth analyst for MHS (diabetes health education).

These reels are showing early velocity signals:
${JSON.stringify(flagged, null, 2)}

Median views/day across all ${reels.length} reels: ${median}

For each reel:
1. Alert type: "🚀 Viral Candidate" or "⚡ Momentum Rising"
2. Recommended action with timing (e.g., "Boost within next 6 hours")
3. Why this timing matters

Format as JSON array: [{ id, headlineLine, alert, action, reason }]
Return ONLY valid JSON array.`;

    const raw = await callClaude(prompt);

    let alerts = [];
    try {
      const match = raw.match(/\[[\s\S]*\]/);
      alerts = JSON.parse(match ? match[0] : raw);
    } catch (parseErr) {
      console.error('[content-velocity] JSON parse error:', parseErr.message);
      alerts = [];
    }

    return res.json({
      success: true,
      alerts,
      totalReels: reels.length,
      flaggedCount: flagged.length,
    });
  } catch (e) {
    console.error('[content-velocity] Error:', e.message);
    return res.status(500).json({ success: false, error: e.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /post-time-heatmap
// ─────────────────────────────────────────────────────────────────────────────
router.post('/post-time-heatmap', async (req, res) => {
  try {
    const { reels = [] } = req.body;

    // Build 7×24 matrix
    const matrix = Array.from({ length: 7 }, () =>
      Array.from({ length: 24 }, () => ({
        totalViews: 0,
        totalHookRate: 0,
        count: 0,
      }))
    );

    reels.forEach((r) => {
      const ist = new Date(
        new Date(r.timestamp).getTime() + 5.5 * 3600000
      );
      const hour = ist.getUTCHours();
      const dow = ist.getUTCDay();
      matrix[dow][hour].totalViews += r.views || 0;
      matrix[dow][hour].totalHookRate += r.hook_rate || 0;
      matrix[dow][hour].count += 1;
    });

    // Compute averages
    const heatmapData = [];
    const allAvgViews = [];

    for (let dow = 0; dow < 7; dow++) {
      for (let hour = 0; hour < 24; hour++) {
        const slot = matrix[dow][hour];
        const avgHookRate =
          slot.count > 0 ? slot.totalHookRate / slot.count : 0;
        const avgViews = slot.count > 0 ? slot.totalViews / slot.count : 0;
        heatmapData.push({ dow, hour, avgHookRate, avgViews, count: slot.count });
        if (slot.count > 0) allAvgViews.push(avgViews);
      }
    }

    // Normalize views
    const maxViews = Math.max(...allAvgViews, 1);
    const withNormalized = heatmapData.map((s) => ({
      ...s,
      normalizedViews: s.avgViews / maxViews,
    }));

    // Find top 5 slots by composite score
    const top5Slots = [...withNormalized]
      .filter((s) => s.count > 0)
      .sort(
        (a, b) =>
          b.avgHookRate * 0.6 +
          b.normalizedViews * 0.4 -
          (a.avgHookRate * 0.6 + a.normalizedViews * 0.4)
      )
      .slice(0, 5);

    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const matrixSummary = top5Slots
      .map(
        (s) =>
          `${days[s.dow]} ${s.hour}:00 IST — avgHookRate: ${s.avgHookRate.toFixed(2)}, avgViews: ${Math.round(s.avgViews)}, count: ${s.count}`
      )
      .join('\n');

    const prompt = `You are a content scheduling analyst for MHS (Indian health education audience, IST timezone).

Performance matrix (day × hour, IST):
Top 5 posting windows: ${JSON.stringify(top5Slots, null, 2)}

Full matrix summary: ${matrixSummary}

Provide:
1. Best 3 specific posting windows with day+time (e.g., "Tuesday 8 PM IST")
2. Why each window performs well (audience behaviour insight)
3. One posting schedule recommendation (5 posts/week)

Format as JSON: { windows: [{slot, day, hour_ist, reason}], schedule: string, insight: string }
Return ONLY valid JSON.`;

    const raw = await callClaude(prompt);

    let claudeResult = {};
    try {
      const match = raw.match(/\{[\s\S]*\}/);
      claudeResult = JSON.parse(match ? match[0] : raw);
    } catch (parseErr) {
      console.error('[post-time-heatmap] JSON parse error:', parseErr.message);
      claudeResult = { error: 'Could not parse Claude response' };
    }

    return res.json({
      success: true,
      matrix: heatmapData,
      insights: claudeResult,
      topSlots: top5Slots,
    });
  } catch (e) {
    console.error('[post-time-heatmap] Error:', e.message);
    return res.status(500).json({ success: false, error: e.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /fatigue-prediction
// ─────────────────────────────────────────────────────────────────────────────
router.post('/fatigue-prediction', async (req, res) => {
  try {
    const { creatives = [] } = req.body;

    // Project days until "Severe" for each creative
    const projected = creatives.map((c) => {
      const currentScore = c.fatigueScore || 0;
      const lifespan = Math.max(c.lifespan_days || 1, 1);
      const dailyRate = currentScore / lifespan;

      let daysUntilSevere;
      if (currentScore >= 70) {
        daysUntilSevere = 0;
      } else {
        daysUntilSevere = Math.round(
          (70 - currentScore) / Math.max(dailyRate, 0.5)
        );
      }
      // Clamp to 0–90
      daysUntilSevere = Math.max(0, Math.min(90, daysUntilSevere));

      const status =
        currentScore >= 70
          ? 'Severe'
          : currentScore >= 50
          ? 'Warning'
          : 'Healthy';

      return { ...c, daysUntilSevere, status };
    });

    const prompt = `You are a paid media optimizer for MHS (health education, India).

Creative fatigue analysis with forward projections:
${JSON.stringify(projected, null, 2)}

For each creative:
1. Urgency: "Immediate refresh needed" / "Plan refresh in N days" / "Healthy — monitor"
2. Specific recommendation: what type of new creative to test (e.g., "Test testimonial format", "Try new hook with same offer")
3. Budget implication: should spend be reduced/maintained/shifted?

Format as JSON array: [{ name, urgency, recommendation, budget_action }]
Return ONLY valid JSON array.`;

    const raw = await callClaude(prompt);

    let predictions = [];
    try {
      const match = raw.match(/\[[\s\S]*\]/);
      predictions = JSON.parse(match ? match[0] : raw);
    } catch (parseErr) {
      console.error('[fatigue-prediction] JSON parse error:', parseErr.message);
      predictions = [];
    }

    return res.json({ success: true, predictions });
  } catch (e) {
    console.error('[fatigue-prediction] Error:', e.message);
    return res.status(500).json({ success: false, error: e.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /cpl-watchtime
// ─────────────────────────────────────────────────────────────────────────────
router.post('/cpl-watchtime', async (req, res) => {
  try {
    const { ads = [], reels = [] } = req.body;

    // Filter reels with watch time data
    const reelsWithWatch = reels.filter(
      (r) => (r.video_avg_time_watched || 0) > 0
    );

    // Build paired data (round-robin match as approximation)
    const paired = reelsWithWatch
      .map((r, i) => ({
        watchTime: r.video_avg_time_watched,
        cpl: ads[i % Math.max(ads.length, 1)]?.cpl || 0,
      }))
      .filter((p) => p.cpl > 0);

    // Compute Pearson correlation
    let correlation = 0;
    const pairedCount = paired.length;

    if (pairedCount >= 2) {
      const n = pairedCount;
      const sumX = paired.reduce((s, p) => s + p.watchTime, 0);
      const sumY = paired.reduce((s, p) => s + p.cpl, 0);
      const sumXY = paired.reduce((s, p) => s + p.watchTime * p.cpl, 0);
      const sumX2 = paired.reduce((s, p) => s + p.watchTime * p.watchTime, 0);
      const sumY2 = paired.reduce((s, p) => s + p.cpl * p.cpl, 0);

      const numerator = n * sumXY - sumX * sumY;
      const denominator = Math.sqrt(
        (n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY)
      );
      correlation = denominator !== 0 ? numerator / denominator : 0;
    }

    // Summaries for Claude
    const reelSummary = reelsWithWatch.map((r) => ({
      id: r.id,
      headlineLine: r.headlineLine,
      video_avg_time_watched: r.video_avg_time_watched,
      hook_rate: r.hook_rate,
      views: r.views,
      reach: r.reach,
    }));

    const adSummary = [...ads]
      .sort((a, b) => (b.leads || 0) - (a.leads || 0))
      .slice(0, 10)
      .map((a) => ({
        name: a.name,
        campaign: a.campaign,
        leads: a.leads,
        spend: a.spend,
        cpl: a.cpl,
      }));

    const prompt = `You are a marketing analytics expert for MHS (Indian health education, diabetes awareness).

Data:
- Organic reels (with avg watch time): ${JSON.stringify(reelSummary, null, 2)}
- Top ads (by leads): ${JSON.stringify(adSummary, null, 2)}
- Pearson correlation between watch time and CPL: ${correlation.toFixed(3)}
- ${pairedCount} data points compared

Analyze:
1. Does higher watch time correlate with lower CPL? (use the correlation value)
2. What watch-time threshold seems to predict better ad performance?
3. One actionable recommendation to improve both reel quality and ad efficiency

Format as JSON: { correlation_interpretation: string, threshold_insight: string, recommendation: string, correlation_value: number }
Return ONLY valid JSON.`;

    const raw = await callClaude(prompt);

    let claudeResult = {};
    try {
      const match = raw.match(/\{[\s\S]*\}/);
      claudeResult = JSON.parse(match ? match[0] : raw);
    } catch (parseErr) {
      console.error('[cpl-watchtime] JSON parse error:', parseErr.message);
      claudeResult = { error: 'Could not parse Claude response' };
    }

    return res.json({
      success: true,
      correlation: {
        value: correlation,
        interpretation: claudeResult.correlation_interpretation || '',
      },
      reelSummary,
      adSummary,
      insight: claudeResult,
    });
  } catch (e) {
    console.error('[cpl-watchtime] Error:', e.message);
    return res.status(500).json({ success: false, error: e.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /budget-reallocation
// ─────────────────────────────────────────────────────────────────────────────
router.post('/budget-reallocation', async (req, res) => {
  try {
    const { bestAd = {}, summary = {}, dateRange = {} } = req.body;

    // Compute CPL gap and recommended budget shift
    const avgCpl = summary.cpl || 1;
    const bestCpl = bestAd.cpl || avgCpl;
    const cplGapPct = ((avgCpl - bestCpl) / avgCpl) * 100;

    const totalSpend = summary.spend || 0;
    let recommendedShift = 0;
    if (cplGapPct > 20) {
      recommendedShift = Math.round(totalSpend * 0.15);
    } else if (cplGapPct > 10) {
      recommendedShift = Math.round(totalSpend * 0.08);
    }

    const prompt = `You are a budget optimization specialist for MHS (health education, India). All amounts in Indian Rupees (₹).

Period: ${dateRange.from} to ${dateRange.to}
Total spend: ₹${totalSpend.toLocaleString('en-IN')}
Total leads: ${(summary.leads || 0).toLocaleString('en-IN')}
Average CPL: ₹${(avgCpl).toFixed(0)}

Best-performing ad:
- Name: ${bestAd.name}
- Campaign: ${bestAd.campaign}
- CPL: ₹${(bestCpl).toFixed(0)}
- Leads generated: ${bestAd.leads}
- CPL advantage over average: ${cplGapPct.toFixed(1)}%
- Recommended budget shift: ₹${recommendedShift.toLocaleString('en-IN')}

Provide:
1. A concrete budget reallocation recommendation with specific ₹ amounts
2. Expected leads increase if the recommended shift is made (use CPL math)
3. Which campaigns/accounts to reduce budget on (based on above-average CPL)
4. Risk factors to watch

Format as JSON: { recommendation: string, expected_leads_increase: number, reduce_from: string, risk_factors: string, shift_amount: number }
Return ONLY valid JSON.`;

    const raw = await callClaude(prompt);

    let claudeResult = {};
    try {
      const match = raw.match(/\{[\s\S]*\}/);
      claudeResult = JSON.parse(match ? match[0] : raw);
    } catch (parseErr) {
      console.error('[budget-reallocation] JSON parse error:', parseErr.message);
      claudeResult = { error: 'Could not parse Claude response' };
    }

    return res.json({
      success: true,
      cplGapPct,
      recommendedShift,
      result: claudeResult,
    });
  } catch (e) {
    console.error('[budget-reallocation] Error:', e.message);
    return res.status(500).json({ success: false, error: e.message });
  }
});

module.exports = router;
