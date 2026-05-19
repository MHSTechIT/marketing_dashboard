/**
 * AI Insights API – uses Google Gemini to generate marketing insights and recommendations.
 * Requires GOOGLE_GEMINI_API_KEY in server .env.
 */

const express = require('express');
const axios   = require('axios');
const crypto  = require('crypto');

const router = express.Router();
const GEMINI_MODEL = 'gemini-2.0-flash-lite';

/** Call Google Gemini REST API via axios (no SDK needed). */
async function callGemini(prompt, { system = '', temperature = 0.6, maxTokens = 8192 } = {}) {
  const key = process.env.GOOGLE_GEMINI_API_KEY;
  const body = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { temperature, maxOutputTokens: maxTokens },
  };
  if (system) body.systemInstruction = { parts: [{ text: system }] };

  const { data } = await axios.post(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${key}`,
    body,
    { timeout: 30000 }
  );
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Gemini returned no content');
  return text;
}

/** Parse Gemini/axios errors into a clean { status, message, errorCode } object. */
function parseGeminiError(err) {
  if (err.response) {
    const status = err.response.status;
    const data   = err.response.data;
    const message = data?.error?.message || err.message || 'Gemini request failed';
    const code    = data?.error?.status  || '';
    if (status === 429 || code === 'RESOURCE_EXHAUSTED') return { status: 429, message, errorCode: 'quota_exceeded' };
    return { status: status || 500, message, errorCode: code || 'ai_error' };
  }
  return { status: 500, message: err.message || 'AI request failed', errorCode: 'ai_error' };
}

/** In-memory cache for Gemini AI insights to reduce quota usage. TTL 15 min. */
const AI_INSIGHTS_CACHE_TTL_SEC = 15 * 60;
const aiInsightsCache = new Map(); // key -> { data, expires }

function buildAIInsightsCacheKey(body) {
  const { dateRange, bestAds, bestReels, context, selectedPeriod } = body || {};
  const payload = JSON.stringify({
    from: dateRange?.from,
    to: dateRange?.to,
    selectedPeriod: selectedPeriod || null,
    platform: context?.platform,
    location: context?.location,
    age: context?.age,
    bestAds: bestAds || {},
    bestReels: bestReels || {}
  });
  return crypto.createHash('sha256').update(payload).digest('hex').slice(0, 24);
}

function getCachedAIInsights(key) {
  const entry = aiInsightsCache.get(key);
  if (!entry || Date.now() > entry.expires) {
    if (entry) aiInsightsCache.delete(key);
    return null;
  }
  return entry.data;
}

function setCachedAIInsights(key, data) {
  aiInsightsCache.set(key, {
    data,
    expires: Date.now() + AI_INSIGHTS_CACHE_TTL_SEC * 1000
  });
}

const PROMPT = `You are a marketing analytics AI. Generate a single JSON object for a marketing dashboard "AI Insights" page. Use realistic but varied numbers and campaign names. Return ONLY valid JSON, no markdown or explanation.

Required JSON shape (use these exact keys):

{
  "adsData": {
    "today": { "name": "string", "platform": "Meta or Website", "spend": number, "leads": number, "cpl": number (2 decimals), "reason": "1-2 sentence insight", "action": "SCALE" or "MONITOR" or "PAUSE" },
    "last_7_days": { ... same shape },
    "last_14_days": { ... same shape },
    "last_30_days": { ... same shape }
  },
  "reelsData": {
    "today": { "name": "string", "platform": "Instagram or Facebook", "reach": number, "engagements": number, "saves": number, "reason": "1-2 sentence insight", "action": "REPURPOSE" or "BOOST" or "MONITOR" },
    "last_7_days": { ... same shape },
    "last_14_days": { ... same shape },
    "last_30_days": { ... same shape }
  },
  "insights": [
    { "id": 1, "type": "string e.g. AD PERFORMANCE", "timeWindow": "Today or last 7 days or last 14 days or last 30 days", "category": "success" or "warning" or "info", "text": "1-2 sentence insight", "action": "→ Short action phrase" }
  ],
  "recommendations": [
    { "id": 1, "title": "string", "icon": "single emoji", "color": "green" or "red" or "blue" or "purple", "justification": "1-2 sentence data-driven reason" }
  ]
}

Rules: Include exactly 6 items in "insights" and 4 in "recommendations". ids 1-based. Actions in adsData/reelsData must be one of the allowed values. Generate diverse, actionable content.`;

const PROMPT_WITH_REAL_DATA = (bestAd, bestReel, dateRange, selectedPeriod) => {
  const periodLabel = selectedPeriod === 'today' ? 'Today'
    : selectedPeriod === 'last_7_days' ? 'last 7 days'
    : selectedPeriod === 'last_14_days' ? 'last 14 days'
    : selectedPeriod === 'last_30_days' ? 'last 30 days'
    : (dateRange ? `${dateRange.from} to ${dateRange.to}` : 'last 30 days');
  return `You are a marketing analytics AI. Below is REAL performance data from the user's Best Performing Ad and Best Performing Reel (from Meta/Instagram) for the selected period: ${periodLabel}. Generate insights and recommendations based ONLY on this data. Return ONLY valid JSON, no markdown or explanation.

Real data:
- Selected period: ${periodLabel}
- Best Performing Ad: ${JSON.stringify(bestAd || 'none')}
- Best Performing Reel: ${JSON.stringify(bestReel || 'none')}
- Date range: ${dateRange ? `${dateRange.from} to ${dateRange.to}` : 'not specified'}

Return a single JSON object with exactly these keys:
{
  "insights": [
    { "id": 1, "type": "string e.g. AD PERFORMANCE", "timeWindow": "${periodLabel}", "category": "success" or "warning" or "info", "text": "1-2 sentence insight based on the real data above", "action": "→ Short action phrase" }
  ],
  "recommendations": [
    { "id": 1, "title": "string", "icon": "single emoji", "color": "green" or "red" or "blue" or "purple", "justification": "1-2 sentence data-driven reason using the real metrics" }
  ]
}

Rules: Include exactly 6 items in "insights" and 4 in "recommendations". ids 1-based. All insights must use timeWindow: "${periodLabel}". Base every insight and recommendation on the actual campaign names, spend, leads, CPL, reach, engagements, and saves provided. Be specific (mention numbers or names where relevant).`;
};

/**
 * POST /api/ai/insights
 * Body: { bestAd?, bestReel?, bestAds?: { today, last_7_days, last_14_days, last_30_days }, bestReels?: { ... }, dateRange?: { from, to } }
 * When bestAds/bestReels (per period) are provided, server builds adsData/reelsData from them.
 * Otherwise falls back to single bestAd/bestReel or full AI-generated data.
 */
router.post('/insights', async (req, res) => {
  if (!process.env.GOOGLE_GEMINI_API_KEY) {
    return res.status(503).json({
      success: false,
      error: 'AI insights not configured',
      details: 'Add GOOGLE_GEMINI_API_KEY to server .env'
    });
  }

  const body = req.body || {};
  const { bestAd, bestReel, bestAds, bestReels, dateRange, selectedPeriod } = body;
  const skipCache = body.skipCache === true || body.refresh === true;
  const cacheKey = buildAIInsightsCacheKey(body);
  if (!skipCache) {
    const cached = getCachedAIInsights(cacheKey);
    if (cached) {
      res.setHeader('X-AI-Insights-Cache', 'hit');
      return res.json(cached);
    }
  }

  const hasPerPeriod = bestAds && typeof bestAds === 'object' && (Object.keys(bestAds).length > 0);
  const useRealData = hasPerPeriod || (bestAd && typeof bestAd === 'object') || (bestReel && typeof bestReel === 'object');

  try {
    let prompt = PROMPT;
    if (useRealData) {
      const periodOrder = selectedPeriod
        ? [selectedPeriod, 'last_30_days', 'last_14_days', 'last_7_days', 'today']
        : ['last_30_days', 'last_14_days', 'last_7_days', 'today'];
      const adForPrompt = hasPerPeriod
        ? periodOrder.map((k) => bestAds[k]).find(Boolean)
        : bestAd;
      const reelForPrompt = hasPerPeriod
        ? periodOrder.map((k) => bestReels[k]).find(Boolean)
        : bestReel;
      prompt = PROMPT_WITH_REAL_DATA(adForPrompt, reelForPrompt, dateRange, selectedPeriod);
    }

    let text = await callGemini(prompt, { temperature: 0.6, maxTokens: 8192 });
    text = text.trim();
    const jsonMatch = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/) || text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (jsonMatch) text = jsonMatch[1].trim();
    const parsed = JSON.parse(text);

    let adsData = parsed.adsData || {};
    let reelsData = parsed.reelsData || {};
    let insights = Array.isArray(parsed.insights) ? parsed.insights : [];
    let recommendations = Array.isArray(parsed.recommendations) ? parsed.recommendations : [];

    if (useRealData) {
      reelsData = {};
      adsData = {};
      const timeKeys = ['today', 'last_7_days', 'last_14_days', 'last_30_days'];
      if (hasPerPeriod) {
        timeKeys.forEach((k) => {
          adsData[k] = buildAdSlotFromReal(bestAds[k]);
          reelsData[k] = buildReelSlotFromReal(bestReels[k]);
        });
      } else {
        const adSlot = buildAdSlotFromReal(bestAd);
        const reelSlot = buildReelSlotFromReal(bestReel);
        timeKeys.forEach((k) => {
          adsData[k] = adSlot;
          reelsData[k] = reelSlot;
        });
      }
    }

    const responsePayload = {
      success: true,
      data: {
        adsData: ensureTimeWindows(adsData, 'ads'),
        reelsData: ensureTimeWindows(reelsData, 'reels'),
        insights: insights.slice(0, 6),
        recommendations: recommendations.slice(0, 4)
      }
    };
    setCachedAIInsights(cacheKey, responsePayload);
    return res.json(responsePayload);
  } catch (err) {
    const { status, message, errorCode } = parseGeminiError(err);
    console.error('[AI Insights] Gemini error:', message);
    const payload = { success: false, error: errorCode || 'ai_error', details: message };
    if (status === 429) payload.retryAfterSeconds = 60;
    return res.status(status).json(payload);
  }
});

const ASK_SYSTEM = `You are a helpful marketing analytics assistant for a Meta/Instagram ads dashboard. Spend and CPL are in Indian Rupees (₹). Use the provided dashboard JSON context when answering. If context is missing or thin, give sound general guidance and mention which metrics would sharpen the answer. Be concise: short paragraphs or bullets. Plain text only — no markdown code fences. Do not invent campaign numbers not present in context.`;

/**
 * POST /api/ai/ask
 * Body: { question: string, context?: object } — answers user questions with Claude using optional dashboard snapshot.
 */
router.post('/ask', async (req, res) => {
  if (!process.env.GOOGLE_GEMINI_API_KEY) {
    return res.status(503).json({
      success: false,
      error: 'AI not configured',
      details: 'Add GOOGLE_GEMINI_API_KEY to server .env'
    });
  }

  const question = String(req.body?.question ?? '').trim();
  if (!question) {
    return res.status(400).json({
      success: false,
      error: 'Missing question',
      details: 'Send a non-empty "question" string.'
    });
  }

  const rawCtx = req.body?.context;
  let contextBlock = '';
  if (rawCtx && typeof rawCtx === 'object') {
    try {
      const s = JSON.stringify(rawCtx);
      contextBlock = s.length > 14000 ? `${s.slice(0, 14000)}…` : s;
    } catch {
      contextBlock = '';
    }
  }

  const userContent = contextBlock
    ? `Dashboard context (JSON):\n${contextBlock}\n\nUser question:\n${question}`
    : question;

  try {
    let text = await callGemini(userContent, { system: ASK_SYSTEM, temperature: 0.45, maxTokens: 2048 });
    text = String(text).trim();
    const fence = text.match(/^```(?:\w+)?\s*([\s\S]*?)\s*```$/);
    if (fence) text = fence[1].trim();
    return res.json({ success: true, answer: text });
  } catch (err) {
    const { status, message, errorCode } = parseGeminiError(err);
    console.error('[AI Ask] Gemini error:', message);
    const payload = { success: false, error: errorCode || 'ai_error', details: message };
    if (status === 429) payload.retryAfterSeconds = 60;
    return res.status(status).json(payload);
  }
});

function lineLooksLikeContactFooter(s) {
  const t = String(s || '').trim();
  if (!t) return true;
  if (/^for\s+appointment\b/i.test(t)) return true;
  if (/^appointment\b/i.test(t) && /\d{5,}/.test(t)) return true;
  if (/\b(whatsapp|call\s+now|call\s+us|book\s+now|dm\s+us)\b/i.test(t) && /\d{4,}/.test(t)) return true;
  const digits = (t.match(/\d/g) || []).length;
  if (digits >= 10 && digits / Math.max(t.length, 1) > 0.2) return true;
  return false;
}

function lineLooksLikeReelSignature(s) {
  const t = String(s || '').trim();
  if (!t) return true;
  const low = t.toLowerCase();
  if (/\b(my\s+health\s+school|^\s*my\s+health\s+school)\b/i.test(t)) return true;
  if (/^dr\.?\s+/i.test(t) && t.length < 72 && !/[?!…]/.test(t)) {
    if (!/\b(benefits|loss|weight|how|why|what|secret|tip|explains|watch|reel|body|health\s+tip)\b/i.test(low)) return true;
  }
  if (/\|\s*my\s+health\s+school\b/i.test(t) && t.length < 120) return true;
  return false;
}

function lineLooksLikeFollowHandleCta(s) {
  const t = String(s || '').trim();
  if (!t) return false;
  if (/^follow\s+@/i.test(t)) return true;
  if (/\bfollow\s+@[\w.]+\b/i.test(t) && /\b(for\s+more|more\s+tips|tips|updates)\b/i.test(t.toLowerCase())) return true;
  return false;
}

function scoreReelTitleLine(line) {
  if (!line) return -1e9;
  let score = line.length;
  if (lineLooksLikeContactFooter(line)) score -= 500;
  if (lineLooksLikeFollowHandleCta(line)) score -= 450;
  if (lineLooksLikeReelSignature(line)) score -= 400;
  if (/[?!…]/.test(line)) score += 35;
  if (/\b(benefits|weight|loss|how\s+to|why\s+|doctor|dr\.)\b/i.test(line)) score += 25;
  return score;
}

/** Match client AIInsights.jsx — skip “Follow @…”, prefer hook; else join Dr | brand. */
function pickReelTitleFromCaption(caption, maxLen = 120) {
  if (!caption || typeof caption !== 'string') return 'Reel';
  const trimmed = caption.trim();
  const lines = trimmed.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return 'Reel';

  let bodyLines = lines;
  if (lines.length >= 2 && lineLooksLikeFollowHandleCta(lines[0])) {
    bodyLines = lines.slice(1);
  }
  if (bodyLines.length === 0) return 'Reel';

  let ordered = [];
  if (bodyLines.length >= 2) {
    ordered = bodyLines;
  } else {
    const one = bodyLines[0];
    if (lineLooksLikeFollowHandleCta(one) && !one.includes('|')) {
      return 'Reel';
    }
    if (one.includes('|')) {
      ordered = one.split('|').map((p) => p.trim()).filter(Boolean);
    } else if (lineLooksLikeContactFooter(one)) {
      ordered = one.split(/(?<=[.!?…])\s+/).map((p) => p.trim()).filter(Boolean);
      if (ordered.length <= 1) ordered = [one];
    } else {
      ordered = [one];
    }
  }

  const work = ordered.filter((c) => !lineLooksLikeFollowHandleCta(c));
  const parts = work.length ? work : ordered;

  const usable = (c) => c && !lineLooksLikeContactFooter(c) && !lineLooksLikeReelSignature(c) && !lineLooksLikeFollowHandleCta(c);
  let chosen = parts.find((c) => usable(c)) || '';
  if (!chosen) chosen = parts.find((c) => c && !lineLooksLikeContactFooter(c) && !lineLooksLikeFollowHandleCta(c)) || '';
  if (!chosen) chosen = parts[0] || '';
  chosen = chosen.trim();
  if (lineLooksLikeContactFooter(chosen)) {
    const stripped = trimmed.replace(/^\s*for\s+appointment\s*[—\-–:]?\s*[^|]*\|\s*/i, '').trim();
    if (stripped && !lineLooksLikeContactFooter(stripped)) chosen = stripped;
  }
  if (!chosen || lineLooksLikeContactFooter(chosen) || lineLooksLikeReelSignature(chosen)) {
    const sorted = [...parts].sort((a, b) => scoreReelTitleLine(b) - scoreReelTitleLine(a));
    chosen = (sorted[0] || chosen || 'Reel').trim();
  }
  const noFollow = parts.filter((c) => !lineLooksLikeFollowHandleCta(c));
  const hasContentHook = noFollow.some((c) => usable(c));
  if (!hasContentHook && noFollow.length >= 2) {
    const sigJoin = noFollow.filter((c) => lineLooksLikeReelSignature(c) || /\b(dr\.|doctor|school|clinic)\b/i.test(c));
    if (sigJoin.length >= 2) {
      chosen = sigJoin.join(' | ').trim();
    }
  }
  if (!chosen) return 'Reel';
  if (chosen.length <= maxLen) return chosen;
  return `${chosen.slice(0, maxLen - 1)}…`;
}

function pickReelSubtitleFromCaption(caption, primaryTitle, maxLen = 140) {
  if (!caption || typeof caption !== 'string' || !primaryTitle) return '';
  const firstLine = caption.split(/\r?\n/).map((l) => l.trim()).find(Boolean) || '';
  if (!firstLine.includes('|')) return '';
  const parts = firstLine.split('|').map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2) return '';
  const key = primaryTitle.trim().toLowerCase();
  let idx = parts.findIndex((p) => {
    const pl = p.toLowerCase();
    return pl === key || key.startsWith(pl) || pl.startsWith(key.slice(0, Math.min(28, key.length)));
  });
  if (idx < 0) idx = 0;
  const rest = parts.slice(idx + 1);
  if (rest.length === 0) return '';
  let sub = rest.join(' | ');
  if (sub.length > maxLen) sub = `${sub.slice(0, maxLen - 1)}…`;
  return sub;
}

function pickReelHeadlineLineFromCaption(caption, maxLen = 200) {
  if (!caption || typeof caption !== 'string') return '';
  const lines = caption.trim().split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return '';
  let body = lines;
  if (lines.length >= 2 && lineLooksLikeFollowHandleCta(lines[0])) body = lines.slice(1);
  const first = body[0] || lines[0] || '';
  if (!first) return '';
  return first.length <= maxLen ? first : `${first.slice(0, maxLen - 1)}…`;
}

function buildAdSlotFromReal(bestAd) {
  if (!bestAd || typeof bestAd !== 'object') {
    return { name: '—', platform: 'Meta', spend: 0, leads: 0, cpl: 0, reason: 'No ad data.', action: 'MONITOR', dateStart: '', dateStop: '' };
  }
  const spend = Math.round((Number(bestAd.spend) || 0) * 100) / 100;
  const leads = Number(bestAd.leads) || 0;
  const cpl = leads > 0 ? Math.round((spend / leads) * 100) / 100 : 0;
  const name = bestAd.name || bestAd.campaignName || bestAd.ad_name || 'Campaign';
  const platform = bestAd.platform || 'Meta';
  const fmtSpend = spend.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  let reason = bestAd.reason || `Best performer: ${leads} leads, ₹${fmtSpend} spend, ₹${cpl.toFixed(2)} CPL.`;
  if (bestAd.snapshotFallbackNote) reason += String(bestAd.snapshotFallbackNote);
  return {
    name: String(name).slice(0, 120),
    platform: String(platform).slice(0, 32),
    spend,
    leads,
    cpl,
    reason: String(reason).slice(0, 400),
    action: bestAd.action === 'PAUSE' || bestAd.action === 'SCALE' ? bestAd.action : 'MONITOR',
    dateStart: bestAd.dateStart || '',
    dateStop: bestAd.dateStop || ''
  };
}

function buildReelSlotFromReal(bestReel) {
  if (!bestReel || typeof bestReel !== 'object') {
    return {
      name: '—',
      headlineLine: '',
      subtitle: '',
      platform: 'Instagram',
      reach: 0,
      engagements: 0,
      saves: 0,
      hookRate: 0,
      video_avg_time_watched: 0,
      engagementRatePct: 0,
      reason: 'No reel data.',
      action: 'MONITOR',
      timestamp: '',
      thumbnail_url: '',
      likes: 0,
      comments: 0,
      shares: 0,
      views: 0,
      permalink: '',
      hideReelPublishTime: false,
      snapshotFallbackNote: ''
    };
  }
  const reach = Number(bestReel.reach) || Number(bestReel.views) || 0;
  const likes = Number(bestReel.likes) || 0;
  const comments = Number(bestReel.comments) || 0;
  const shares = Number(bestReel.shares) || 0;
  const saves = Number(bestReel.saves) || 0;
  const engagements = Number(bestReel.engagements) || Number(bestReel.total_interactions) || (likes + comments + shares + saves);
  const name = (bestReel.caption && String(bestReel.caption).trim())
    ? pickReelTitleFromCaption(bestReel.caption, 120)
    : (bestReel.name || 'Reel');
  const headlineLine = String(
    bestReel.headlineLine
    || (bestReel.caption && String(bestReel.caption).trim() ? pickReelHeadlineLineFromCaption(bestReel.caption, 200) : '')
    || name
  ).slice(0, 200);
  const subtitle = (bestReel.caption && String(bestReel.caption).trim())
    ? pickReelSubtitleFromCaption(bestReel.caption, name, 140)
    : String(bestReel.subtitle || '').slice(0, 140);
  const platform = bestReel.platform || 'Instagram';
  const fmtReach = reach >= 1000 ? `${(reach / 1000).toFixed(1)}K` : String(reach);
  const reason = bestReel.reason || `Top content: ${fmtReach} reach, ${engagements.toLocaleString('en-IN')} engagements, ${saves} saves.`;
  const hookRate = Math.min(Number(bestReel.hookRate ?? bestReel.hook_rate ?? 0), 100);
  const video_avg_time_watched = Math.min(Number(bestReel.video_avg_time_watched ?? bestReel.watchTime ?? 0) || 0, 120);
  let engagementRatePct = bestReel.engagementRatePct ?? bestReel.engagementRate;
  if (engagementRatePct == null || Number.isNaN(Number(engagementRatePct))) {
    engagementRatePct = reach > 0 ? Math.round((engagements / reach) * 1000) / 10 : 0;
  } else {
    engagementRatePct = Number(engagementRatePct);
  }
  const note = bestReel.snapshotFallbackNote ? String(bestReel.snapshotFallbackNote).trim() : '';
  return {
    name: String(name).slice(0, 120),
    headlineLine,
    subtitle: String(subtitle || '').slice(0, 140),
    platform: String(platform).slice(0, 32),
    reach,
    engagements,
    saves,
    likes,
    comments,
    shares,
    views: Number(bestReel.views) || 0,
    hookRate,
    video_avg_time_watched,
    engagementRatePct,
    reason: String(reason).slice(0, 400),
    action: bestReel.action === 'REPURPOSE' || bestReel.action === 'BOOST' ? bestReel.action : 'MONITOR',
    timestamp: bestReel.timestamp || '',
    thumbnail_url: bestReel.thumbnail_url || '',
    permalink: bestReel.permalink || '',
    hideReelPublishTime: !!bestReel.hideReelPublishTime,
    snapshotFallbackNote: note
  };
}

/** Ensure today, last_7_days, last_14_days, last_30_days exist with valid shape so UI does not break */
function ensureTimeWindows(obj, type) {
  const defaults = type === 'ads'
    ? { name: 'Campaign', platform: 'Meta', spend: 0, leads: 0, cpl: 0, reason: 'No data.', action: 'MONITOR' }
    : {
      name: 'Reel',
      headlineLine: '',
      subtitle: '',
      platform: 'Instagram',
      reach: 0,
      engagements: 0,
      saves: 0,
      hookRate: 0,
      video_avg_time_watched: 0,
      engagementRatePct: 0,
      reason: 'No data.',
      action: 'MONITOR',
      thumbnail_url: '',
      permalink: '',
      timestamp: '',
      hideReelPublishTime: false,
      snapshotFallbackNote: ''
    };
  const keys = ['today', 'last_7_days', 'last_14_days', 'last_30_days'];
  const out = {};
  for (const k of keys) {
    const v = obj[k];
    out[k] = v && typeof v === 'object' ? { ...defaults, ...v } : { ...defaults };
  }
  return out;
}

const { runSaturationAnalysis } = require('../services/saturationService');
const { runFatigueAnalysis } = require('../services/creativeFatigueService');
const { runLeadScoring, getLeadScores } = require('../services/leadQualityScoringService');
const { supabase } = require('../supabase');

/**
 * POST /api/ai/lead-saturation
 * Lead Saturation Detection – runs analysis and returns campaigns with score/status.
 * Body: { dateRange?: { from, to }, adAccountId? } (optional).
 * Returns: { success, campaigns: [...], summary: { total, saturated, warning, healthy, period_from, period_to } }
 */
router.post('/lead-saturation', async (req, res) => {
  try {
    const body = req.body || {};
    const result = await runSaturationAnalysis({
      dateRange: body.dateRange || null,
      adAccountId: body.adAccountId || null
    });
    if (!result.success) {
      return res.status(400).json({
        success: false,
        error: result.error || 'Saturation analysis failed',
        campaigns: result.campaigns || [],
        summary: result.summary || {}
      });
    }
    const avgIdx = result.summary.saturation_index_avg;
    return res.json({
      success: true,
      saturationLevel: result.summary.saturated > 0 ? 'high' : result.summary.warning > 0 ? 'medium' : 'low',
      message: result.summary.saturated > 0
        ? `${result.summary.saturated} campaign(s) critical (MHS Saturation Index & signals). Prioritise geo expansion, lookalikes, or creative refresh.`
        : result.summary.warning > 0
          ? `${result.summary.warning} campaign(s) in warning zone (index or frequency / reach / CPM / CTR).`
          : avgIdx != null
            ? `Average Saturation Index ${avgIdx}/100 — within healthy range for this period.`
            : 'No saturation detected for the period.',
      campaigns: result.campaigns,
      summary: result.summary,
      details: { dateRange: body.dateRange || null, adAccountId: body.adAccountId || null }
    });
  } catch (err) {
    console.error('[AI Lead Saturation] Error:', err.message);
    return res.status(500).json({
      success: false,
      error: 'Lead saturation analysis failed',
      details: err.message
    });
  }
});

/**
 * POST /api/ai/lead-quality
 * MHS Lead Intelligence (lead-intaligetionn-state.md): sugar bands + behavioural flags in lead_intel.
 * Body: { dateFrom, dateTo, campaignIds?: [] }
 */
router.post('/lead-quality', async (req, res) => {
  try {
    const body = req.body || {};
    const { dateFrom, dateTo, campaignIds } = body;
    const result = await runLeadScoring({ dateFrom, dateTo, campaignIds });
    if (!result.success) {
      return res.status(400).json({
        success: false,
        error: result.error,
        scored: result.scored ?? 0,
        samples: result.samples ?? []
      });
    }
    return res.json({
      success: true,
      scored: result.scored,
      samples: result.samples,
      summary: result.summary ?? null,
    });
  } catch (err) {
    console.error('[AI Lead Quality] Error:', err.message);
    return res.status(500).json({
      success: false,
      error: 'Lead quality scoring failed',
      details: err.message
    });
  }
});

/**
 * GET /api/ai/lead-quality/scores?dateFrom=&dateTo=&campaignId=&limit=
 * List stored lead scores for Lead Intelligence view.
 */
router.get('/lead-quality/scores', async (req, res) => {
  try {
    const dateFrom = req.query.dateFrom || null;
    const dateTo = req.query.dateTo || null;
    const campaignId = req.query.campaignId || null;
    const limit = Math.min(parseInt(req.query.limit, 10) || 10000, 10000);
    const result = await getLeadScores({ dateFrom, dateTo, campaignId, limit });
    return res.json(result);
  } catch (err) {
    console.error('[AI Lead Quality Scores] Error:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/ai/creative-fatigue
 * Creative Fatigue Detection – ad-level analysis.
 * Body: { dateRange?: { from, to }, adAccountId? } (optional).
 * Returns: { success, creatives: [...], summary: { total, fatigued, warning, healthy, period_from, period_to } }
 */
router.post('/creative-fatigue', async (req, res) => {
  try {
    const body = req.body || {};
    const result = await runFatigueAnalysis({
      dateRange: body.dateRange || null,
      adAccountId: body.adAccountId || null
    });
    if (!result.success) {
      return res.status(400).json({
        success: false,
        error: result.error || 'Creative fatigue analysis failed',
        creatives: result.creatives || [],
        summary: result.summary || {}
      });
    }
    return res.json({
      success: true,
      creatives: result.creatives,
      summary: result.summary
    });
  } catch (err) {
    console.error('[AI Creative Fatigue] Error:', err.message);
    return res.status(500).json({
      success: false,
      error: 'Creative fatigue analysis failed',
      details: err.message
    });
  }
});

/**
 * GET /api/ai/lead-saturation/latest
 * Returns the most recent saturation run for dashboard banner (saturated campaigns from last run).
 */
router.get('/lead-saturation/latest', async (req, res) => {
  try {
    if (!supabase) {
      return res.json({ success: true, saturated: [], summary: null });
    }
    const { data: latestRows } = await supabase
      .from('campaign_saturation_log')
      .select('created_at')
      .order('created_at', { ascending: false })
      .limit(1);
    const latestAt = latestRows && latestRows[0] ? latestRows[0].created_at : null;
    if (!latestAt) {
      return res.json({ success: true, saturated: [], summary: null });
    }
    const { data: allFromRun } = await supabase
      .from('campaign_saturation_log')
      .select('id, campaign_id, campaign_name, score, status, frequency, cpl, created_at')
      .order('created_at', { ascending: false })
      .limit(200);
    const rows = allFromRun || [];
    const latestMs = new Date(latestAt).getTime();
    const list = rows.filter(
      (r) => r.status === 'Saturated' && Math.abs(new Date(r.created_at).getTime() - latestMs) <= 2000
    );
    const summary = list.length > 0
      ? { saturatedCount: list.length, latestRun: latestAt }
      : null;
    return res.json({ success: true, saturated: list, summary });
  } catch (err) {
    console.error('[AI Lead Saturation Latest] Error:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
