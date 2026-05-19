import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import './AIInsights.css';

const API_BASE = process.env.REACT_APP_API_BASE || 'http://localhost:4000';
/** Ask AI uses Gemini; allow extra time for cold hosts and slow API responses */
const ASK_AI_FETCH_TIMEOUT_MS = 120000;

const getAuthToken = () => {
    try {
        const STORAGE_KEY = process.env.REACT_APP_STORAGE_KEY || 'app_auth';
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored) {
            const data = JSON.parse(stored);
            return data?.token ?? null;
        }
    } catch (e) {
        console.error('Error getting token:', e);
    }
    return null;
};

const toYMD = (d) => d.toISOString().slice(0, 10);

/** Calendar Y-M-D in local timezone (avoids UTC day shift vs Leads.DateChar). */
const toYMDLocal = (d) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
};

/** Period ranges for Last Month, Last Week, This Week, Today (for tabs) — local calendar dates (matches hero presets / Leads). */
const getPeriodRanges = () => {
    const today = new Date();
    const lastMonth = { from: '', to: '' };
    const lastMonthStart = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const lastMonthEnd = new Date(today.getFullYear(), today.getMonth(), 0);
    lastMonth.from = toYMDLocal(lastMonthStart);
    lastMonth.to = toYMDLocal(lastMonthEnd);

    const lastWeek = { from: '', to: '' };
    const lastWeekEnd = new Date(today);
    lastWeekEnd.setDate(lastWeekEnd.getDate() - lastWeekEnd.getDay() - 1);
    const lastWeekStart = new Date(lastWeekEnd);
    lastWeekStart.setDate(lastWeekStart.getDate() - 6);
    lastWeek.from = toYMDLocal(lastWeekStart);
    lastWeek.to = toYMDLocal(lastWeekEnd);

    const thisWeek = { from: '', to: '' };
    const thisWeekStart = new Date(today);
    thisWeekStart.setDate(thisWeekStart.getDate() - thisWeekStart.getDay());
    thisWeek.from = toYMDLocal(thisWeekStart);
    thisWeek.to = toYMDLocal(today);

    const todayRange = { from: toYMDLocal(today), to: toYMDLocal(today) };

    return { lastMonth, lastWeek, thisWeek, today: todayRange };
};

/**
 * Widen fetch range so snapshot tabs (last 30d … Today) always have rows in memory.
 * Hero range can extend further backward/forward (e.g. custom) without shrinking below this span.
 */
const mergeSnapshotDataRange = (hero) => {
    const p30 = getDateRangeForPreset('last_30_days');
    const pToday = getDateRangeForPreset('today');
    let from = p30.from;
    let to = pToday.to;
    if (hero?.from && String(hero.from) < from) from = hero.from;
    if (hero?.to && String(hero.to) > to) to = hero.to;
    return { from, to };
};

const isReelMediaItem = (m) => {
    if (!m) return false;
    const pl = String(m.permalink || '').toLowerCase();
    if (m.product_type === 'REELS') return true;
    if (!m.product_type && pl.includes('/reel')) return true;
    if (m.media_type === 'VIDEO' && pl.includes('/reel')) return true;
    return false;
};

const rowYMD = (r) => {
    const s = r?.date_start || r?.date_stop || r?.date;
    if (!s) return null;
    return String(s).slice(0, 10);
};

/** Single-day tabs: Meta often labels rows in account/UTC date — one day behind local “today”. */
const expandedSingleDayYmds = (period) => {
    const set = new Set([period.from, new Date().toISOString().slice(0, 10)]);
    const anchor = new Date(`${period.from}T12:00:00`);
    if (!Number.isNaN(anchor.getTime())) {
        const prev = new Date(anchor);
        prev.setDate(prev.getDate() - 1);
        set.add(toYMDLocal(prev));
    }
    return set;
};

/**
 * Wider Y-M-D set for matching Meta `time_increment=1` ad rows to “today” (timezone skew).
 * Covers local ±2 around the tab day and UTC ±2 around current UTC date.
 */
const expandedSingleDayInsightYmds = (period) => {
    const set = new Set();
    if (!period || period.from !== period.to) return set;
    const now = new Date();
    set.add(period.from);
    set.add(toYMDLocal(now));
    set.add(now.toISOString().slice(0, 10));
    expandedSingleDayYmds(period).forEach((y) => set.add(y));
    const anchor = new Date(`${period.from}T12:00:00`);
    if (!Number.isNaN(anchor.getTime())) {
        for (let d = -2; d <= 2; d++) {
            const x = new Date(anchor);
            x.setDate(x.getDate() + d);
            set.add(toYMDLocal(x));
        }
    }
    const utcMid = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 12, 0, 0));
    for (let d = -2; d <= 2; d++) {
        const x = new Date(utcMid);
        x.setUTCDate(x.getUTCDate() + d);
        set.add(x.toISOString().slice(0, 10));
    }
    return set;
};

/**
 * Reel publish time vs tab period: local *or* UTC calendar day in [from,to].
 * Single-day tabs (e.g. Today) also use expandedSingleDayYmds — same idea as Best ad when Meta’s day label is one off.
 */
const timestampInPeriod = (isoTs, period) => {
    if (!period?.from || !period?.to) return true;
    if (!isoTs) return false;
    const d = new Date(isoTs);
    if (Number.isNaN(d.getTime())) return false;
    const inRange = (ymd) => ymd >= period.from && ymd <= period.to;
    const yLocal = toYMDLocal(d);
    const yUtc = d.toISOString().slice(0, 10);
    if (inRange(yLocal) || inRange(yUtc)) return true;
    if (period.from === period.to) {
        const alt = expandedSingleDayYmds(period);
        return alt.has(yLocal) || alt.has(yUtc);
    }
    return false;
};

/** Inclusive local calendar window ending on toYmd: [to − (numDays−1), to]. Used so “Today” reel fallback never jumps months back. */
const rollingDaysEndingOn = (toYmd, numDays) => {
    const end = new Date(`${toYmd}T12:00:00`);
    if (Number.isNaN(end.getTime())) return { from: toYmd, to: toYmd };
    const start = new Date(end);
    start.setDate(start.getDate() - (numDays - 1));
    return { from: toYMDLocal(start), to: toYmd };
};

/** Keep Meta insight rows whose row day falls inside the tab period (time_increment=1 rows). */
const filterInsightsRowsByPeriod = (rows, period) => {
    if (!rows?.length || !period?.from || !period?.to) return [];
    let out = rows.filter((r) => {
        const ymd = rowYMD(r);
        if (!ymd) return false;
        return ymd >= period.from && ymd <= period.to;
    });
    if (out.length === 0 && period.from === period.to) {
        const alt = expandedSingleDayInsightYmds(period);
        out = rows.filter((r) => {
            const ymd = rowYMD(r);
            return ymd && alt.has(ymd);
        });
    }
    return out;
};

/** Preset ids for the hero date control (aligned with getDateRangeForPreset). */
const INSIGHTS_DATE_PRESET_OPTIONS = [
    { id: 'today', label: 'Today' },
    { id: 'last_7_days', label: 'last 7 days' },
    { id: 'last_14_days', label: 'last 14 days' },
    { id: 'last_30_days', label: 'last 30 days' },
    { id: 'custom', label: 'Custom' },
];

const getDateRangeForPreset = (presetId) => {
    const today = new Date();
    if (presetId === 'today') {
        return { from: toYMDLocal(today), to: toYMDLocal(today) };
    }
    if (presetId === 'last_7_days') {
        const start = new Date(today);
        start.setDate(start.getDate() - 6);
        return { from: toYMDLocal(start), to: toYMDLocal(today) };
    }
    if (presetId === 'last_14_days') {
        const start = new Date(today);
        start.setDate(start.getDate() - 13);
        return { from: toYMDLocal(start), to: toYMDLocal(today) };
    }
    if (presetId === 'last_30_days') {
        const start = new Date(today);
        start.setDate(start.getDate() - 29);
        return { from: toYMDLocal(start), to: toYMDLocal(today) };
    }
    return null;
};

/** Rolling windows for Performance snapshot tabs (same logic as hero presets). */
const getSnapshotPeriodRanges = () => ({
    today: getDateRangeForPreset('today'),
    last_7_days: getDateRangeForPreset('last_7_days'),
    last_14_days: getDateRangeForPreset('last_14_days'),
    last_30_days: getDateRangeForPreset('last_30_days'),
});

const SNAPSHOT_TIME_WINDOW_KEYS = ['today', 'last_7_days', 'last_14_days', 'last_30_days'];

const transformActions = (actions = []) => {
    if (!Array.isArray(actions)) return {};
    const map = {};
    actions.forEach((a) => {
        const key = a.action_type;
        const val = a.value != null ? Number(a.value) : (a.values ? Number(a.values[0]) : 0);
        if (key) map[key] = val;
    });
    return map;
};

const num = (v) => Number(v) || 0;
const fmtMoney = (v) => `₹${(Number(v) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Meta ad account id for tables (always act_ prefix). */
const fmtAdAccountId = (id) => {
    if (id == null || id === '') return '—';
    const raw = String(id).trim();
    if (!raw) return '—';
    const num = raw.replace(/^act_/i, '');
    return `act_${num}`;
};

/** MHS lead-intaligetionn-state.md timing by tier */
const mhsLeadTierActionTiming = (tier) => {
    const t = String(tier || '');
    if (t === 'Hot') return 'Within 2 hrs — personal call';
    if (t === 'Warm') return '24 hrs — WhatsApp sequence';
    if (t === 'Nurture') return '48 hrs — follow-up sequence';
    return 'Weekly — broadcast only';
};

const inferLeadTierFromRow = (r) => {
    if (r.tier) return r.tier;
    const c = String(r.category || '');
    if (c.includes('Hot')) return 'Hot';
    if (c.includes('Warm')) return 'Warm';
    if (c.includes('Nurture')) return 'Nurture';
    return 'Cold';
};
const fmtInt = (v) => (Number(v) || 0).toLocaleString('en-IN');
const fmtReach = (v) => { const n = Number(v) || 0; return n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n); };

const mapAdPickToSlot = (best) => {
    if (!best) {
        return {
            name: '—',
            platform: 'Meta',
            spend: 0,
            leads: 0,
            cpl: 0,
            reason: 'No ad data for this calendar period in the loaded analysis range.',
            action: 'MONITOR',
            dateStart: '',
            dateStop: ''
        };
    }
    const note = best.snapshotFallbackNote ? String(best.snapshotFallbackNote) : '';
    return {
        name: best.name,
        platform: best.platform || 'Meta',
        spend: best.spend,
        leads: best.leads,
        cpl: best.cpl,
        reason: `Best in this period: ${best.leads} leads, ${fmtMoney(best.spend)} spend, ${fmtMoney(best.cpl)} CPL.${note}`,
        action: 'MONITOR',
        dateStart: best.dateStart || '',
        dateStop: best.dateStop || ''
    };
};

const mapReelPickToSlot = (best) => {
    if (!best) {
        return {
            name: '—',
            headlineLine: '',
            platform: 'Instagram',
            reach: 0,
            engagements: 0,
            saves: 0,
            views: 0,
            likes: 0,
            comments: 0,
            shares: 0,
            hookRate: 0,
            video_avg_time_watched: 0,
            engagementRatePct: 0,
            reason: 'No reel in this calendar period within the loaded analysis range.',
            action: 'MONITOR',
            timestamp: '',
            thumbnail_url: '',
            permalink: '',
            subtitle: '',
            hideReelPublishTime: false,
            snapshotFallbackNote: ''
        };
    }
    const rch = best.reach || best.views || 0;
    const note = best.snapshotFallbackNote ? String(best.snapshotFallbackNote) : '';
    const hookR = Math.min(Number(best.hookRate ?? best.hook_rate ?? 0), 100);
    const watch = capWatchTime(best.video_avg_time_watched ?? best.watchTime);
    const engPct = best.engagementRatePct != null ? Number(best.engagementRatePct) : (best.engagementRate != null ? Number(best.engagementRate) : undefined);
    return {
        name: best.name,
        headlineLine: String(best.headlineLine || pickReelHeadlineLineFromCaption(best.caption, 200) || best.name || '').slice(0, 200),
        subtitle: best.subtitle || pickReelSubtitleFromCaption(best.caption, best.name, 140) || '',
        platform: best.platform || 'Instagram',
        reach: best.reach,
        engagements: best.engagements,
        saves: best.saves,
        views: best.views,
        likes: best.likes,
        comments: best.comments,
        shares: best.shares,
        hookRate: hookR,
        video_avg_time_watched: watch,
        engagementRatePct: engPct != null && !Number.isNaN(engPct) ? engPct : (rch > 0 ? Math.round(((Number(best.engagements) || 0) / rch) * 1000) / 10 : 0),
        reason: `Top in this period: ${fmtReach(rch)} reach, ${fmtInt(best.engagements)} engagements, ${best.saves} saves.${note}`,
        action: 'MONITOR',
        timestamp: best.timestamp || '',
        thumbnail_url: best.thumbnail_url || '',
        permalink: best.permalink || '',
        hideReelPublishTime: !!best.hideReelPublishTime,
        snapshotFallbackNote: note.trim()
    };
};

/** Match snapshot card to a scored row from reel intelligence (rich reason + flags). */
const findMatchedAnalysisReel = (card, reelAnalysis) => {
    if (!card || !reelAnalysis) return null;
    const p = String(card.permalink || '').trim();
    const nm = String(card.name || '').trim().slice(0, 80);
    const hl = String(card.headlineLine || '').trim().slice(0, 120);
    const buckets = [
        reelAnalysis.trending_reels,
        reelAnalysis.repost_recommended,
        reelAnalysis.rising_reels,
        reelAnalysis.stable_top_performers,
        reelAnalysis.top_reels
    ];
    const singles = [
        reelAnalysis.monthly_best_reel,
        reelAnalysis.daily_best_reel,
        reelAnalysis.this_week_best_reel,
        reelAnalysis.last_week_best_reel,
        reelAnalysis.all_time_best_reel
    ].filter(Boolean);
    const candidates = [];
    buckets.forEach((arr) => {
        if (Array.isArray(arr)) arr.forEach((x) => x && candidates.push(x));
    });
    singles.forEach((x) => candidates.push(x));
    const seen = new Set();
    for (const row of candidates) {
        const k = `${row.permalink || ''}#${row.name || ''}`;
        if (seen.has(k)) continue;
        seen.add(k);
        const rp = String(row.permalink || '').trim();
        const rn = String(row.name || '').trim().slice(0, 80);
        if (p && rp && p === rp) return row;
        if (nm && rn && (rn === nm || nm.startsWith(rn) || rn.startsWith(nm.slice(0, 40)))) return row;
        if (hl && rn) {
            const a = hl.slice(0, 40);
            const b = rn.slice(0, 40);
            if (a && b && (hl.includes(rn.slice(0, 35)) || rn.includes(a) || a === b)) return row;
        }
    }
    return null;
};

const buildFallbackReelPerfSummary = (r, flags = []) => {
    if (!r) return '—';
    const views = Number(r.views || r.reach || 0);
    const reach = Number(r.reach || r.views || 0);
    let engPct = r.engagementRate ?? r.engagementRatePct;
    if (engPct == null || Number.isNaN(Number(engPct))) {
        const e = Number(r.engagements) || (Number(r.likes || 0) + Number(r.comments || 0) + Number(r.shares || 0) + Number(r.saves || 0));
        engPct = reach > 0 ? Math.round((e / reach) * 1000) / 10 : 0;
    } else {
        engPct = Number(engPct);
    }
    const shares = Number(r.shares || 0);
    const watch = capWatchTime(r.video_avg_time_watched ?? r.watchTime ?? 0);
    const hook = Math.round(Number(r.hookRate ?? r.hook_rate ?? 0));
    const engStr = engPct % 1 === 0 ? String(engPct) : engPct.toFixed(1);
    const parts = [`${fmtReach(views)} views`, `${engStr}% engagement`, `${fmtInt(shares)} shares`, `${watch.toFixed(1)}s avg watch`, `${hook}% hook rate`];
    const narrative = [];
    if (flags.includes('TRENDING')) narrative.push('rapid view growth and high engagement spike');
    if (flags.includes('STABLE_TOP_PERFORMER')) narrative.push('consistently high performance over 3+ days');
    if (flags.includes('RISING')) narrative.push('strong early traction');
    if (flags.includes('REPOST_RECOMMENDED')) narrative.push('high shares and saves — strong repost candidate');
    const prefix = narrative.length ? `${narrative.join('; ')}. ` : '';
    return `${prefix}Key metrics: ${parts.join(', ')}.`.trim();
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** When /api/ai/insights returns placeholder reel slots but this run already computed real picks, keep local (avoids blank UI after refresh/races). */
const preferLocalReelSlotsIfApiEmpty = (localSlots, apiSlots) => {
    if (!apiSlots || typeof apiSlots !== 'object') return localSlots;
    const keys = SNAPSHOT_TIME_WINDOW_KEYS;
    const out = { ...apiSlots };
    for (const k of keys) {
        const L = localSlots[k];
        const A = apiSlots[k];
        const apiEmpty = !A || String(A.name || '').trim() === '' || String(A.name || '').trim() === '—';
        const localOk = L && String(L.name || '').trim() !== '' && String(L.name || '').trim() !== '—';
        if (apiEmpty && localOk) out[k] = L;
    }
    return out;
};

const adSlotLooksEmptyForMerge = (a) => {
    if (!a || typeof a !== 'object') return true;
    const name = String(a.name || '').trim();
    const badName = !name || name === '—';
    const noActivity = Number(a.leads || 0) === 0 && Number(a.spend || 0) === 0;
    return badName && noActivity;
};

/** Same idea as reels: do not let the AI response replace computed Meta picks with empty placeholders. */
const preferLocalAdSlotsIfApiEmpty = (localSlots, apiSlots) => {
    if (!apiSlots || typeof apiSlots !== 'object') return localSlots;
    const keys = SNAPSHOT_TIME_WINDOW_KEYS;
    const out = { ...apiSlots };
    for (const k of keys) {
        const L = localSlots[k];
        const A = apiSlots[k];
        const localOk = L && !adSlotLooksEmptyForMerge(L);
        if (adSlotLooksEmptyForMerge(A) && localOk) out[k] = L;
    }
    return out;
};

const fmtDate = (dateStr) => {
    if (!dateStr) return '';
    try {
        const d = new Date(dateStr);
        if (isNaN(d.getTime())) return dateStr;
        return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
    } catch { return dateStr; }
};
const fmtDateTime = (dateStr) => {
    if (!dateStr) return '';
    try {
        const d = new Date(dateStr);
        if (isNaN(d.getTime())) return dateStr;
        return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) +
            ' ' + d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
    } catch { return dateStr; }
};

const formatDateHeaderShort = (ymd) => {
    if (!ymd) return '';
    try {
        const d = new Date(`${ymd}T12:00:00`);
        if (isNaN(d.getTime())) return ymd;
        return d.toLocaleDateString('en-IN', { month: 'short', day: 'numeric', year: 'numeric' });
    } catch {
        return ymd;
    }
};

const parseInsightsRows = (rawData) => {
    let data = rawData;
    if (data && !Array.isArray(data) && Array.isArray(data.data)) data = data.data;
    if (!Array.isArray(data)) return [];
    return data.map((d) => {
        const aggs = transformActions(d.actions || []);
        const leadCount =
            aggs['lead'] ||
            aggs['on_facebook_lead'] ||
            aggs['onsite_conversion.lead_grouped'] ||
            (Object.keys(aggs || {}).filter((k) => String(k).toLowerCase().includes('lead')).reduce((s, k) => s + (Number(aggs[k]) || 0), 0)) ||
            0;
        const spend = num(d.spend);
        const cpl = leadCount > 0 ? spend / leadCount : 0;
        return {
            ad_id: d.ad_id,
            ad_name: d.ad_name || 'Unnamed Ad',
            campaign_id: d.campaign_id,
            campaign_name: d.campaign_name || 'Unknown Campaign',
            ad_account_id: d.ad_account_id,
            ad_account_name: d.ad_account_name || '',
            spend,
            leads: leadCount,
            cpl,
            impressions: num(d.impressions),
            clicks: num(d.clicks),
            date_start: d.date_start || d.date,
            date_stop: d.date_stop || d.date_start || d.date
        };
    });
};

const fetchInsightsForAI = async (from, to, forceRefresh = false) => {
    try {
        const token = getAuthToken();
        const headers = { 'Content-Type': 'application/json' };
        if (token) headers['Authorization'] = `Bearer ${token}`;

        // On initial load, read from DB (no live=1) to avoid heavy Meta API calls
        // across many accounts that can timeout and return 500.
        // On explicit refresh, use live=1 to fetch fresh data from Meta.
        const liveParam = forceRefresh ? '&live=1&refresh=1' : '';
        const baseUrl = `${API_BASE}/api/meta/insights?time_increment=1&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&is_all_campaigns=1&is_all_ads=1`;
        const res = await fetch(`${baseUrl}${liveParam}`, { headers });
        if (!res.ok) {
            // DB fetch failed; try once with live as fallback
            if (!forceRefresh) {
                try {
                    const liveRes = await fetch(`${baseUrl}&live=1`, { headers });
                    if (liveRes.ok) return parseInsightsRows(await liveRes.json());
                } catch (_) { /* fall through */ }
            }
            return [];
        }
        const rows = parseInsightsRows(await res.json());

        // If DB returned no rows and this wasn't already a live request, retry with live
        if (rows.length === 0 && !forceRefresh) {
            try {
                const liveRes = await fetch(`${baseUrl}&live=1`, { headers });
                if (liveRes.ok) return parseInsightsRows(await liveRes.json());
            } catch (_) { /* fall through */ }
        }
        return rows;
    } catch (e) {
        console.error('fetchInsightsForAI error:', e);
        return [];
    }
};

const fetchPages = async () => {
    try {
        const token = getAuthToken();
        const headers = { 'Content-Type': 'application/json' };
        if (token) headers['Authorization'] = `Bearer ${token}`;
        const res = await fetch(`${API_BASE}/api/meta/pages`, { headers });
        if (!res.ok) return [];
        const data = await res.json();
        return data?.data || [];
    } catch (e) {
        return [];
    }
};

const fetchJsonWithTimeout = async (url, options = {}, timeoutMs = 30000) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetch(url, { ...options, signal: controller.signal });
        return res;
    } finally {
        clearTimeout(timer);
    }
};

const fetchMediaInsightsForAI = async (pageId, opts = {}) => {
    try {
        const token = getAuthToken();
        const headers = { 'Content-Type': 'application/json' };
        if (token) headers['Authorization'] = `Bearer ${token}`;
        const params = new URLSearchParams();
        params.append('pageIds', pageId);
        params.append('contentType', 'reels');
        if (opts.from) params.append('from', opts.from);
        if (opts.to) params.append('to', opts.to);
        if (opts.forceRefresh) params.append('refresh', '1');
        const res = await fetchJsonWithTimeout(`${API_BASE}/api/meta/instagram/media-insights?${params.toString()}`, { headers }, opts.timeoutMs || 30000);
        if (!res.ok) return null;
        return await res.json();
    } catch (e) {
        return null;
    }
};

const fetchMediaInsightsForPages = async (pages = [], opts = {}) => {
    const pageIds = pages
        .map((p) => p?.id || p?.page_id || '')
        .filter(Boolean);

    if (pageIds.length === 0) return null;

    const results = await Promise.allSettled(
        pageIds.map((pageId) => fetchMediaInsightsForAI(pageId, opts))
    );

    const mediaMap = new Map();
    results.forEach((result) => {
        if (result.status !== 'fulfilled' || !result.value?.media) return;
        result.value.media.forEach((item) => {
            const key = item.id || item.media_id || item.permalink || `${item.timestamp || ''}-${item.caption || ''}`;
            if (!key) return;
            if (!mediaMap.has(key)) mediaMap.set(key, item);
        });
    });

    return { media: [...mediaMap.values()] };
};

const pickBestAd = (rows) => {
    if (!rows || rows.length === 0) return null;
    const adMap = {};
    rows.forEach((r) => {
        const key = String(r.ad_id || r.ad_name || 'unknown').trim() || 'unknown';
        if (!adMap[key]) {
            adMap[key] = {
                name: (r.ad_name && String(r.ad_name).trim()) ? r.ad_name.trim() : (r.ad_id ? `Ad ${r.ad_id}` : 'Unknown'),
                campaignName: r.campaign_name || 'Campaign',
                platform: 'Meta',
                spend: 0,
                leads: 0,
                ad_account_name: r.ad_account_name || '',
                dateStart: r.date_start || '',
                dateStop: r.date_stop || ''
            };
        }
        adMap[key].spend += r.spend || 0;
        adMap[key].leads += r.leads || 0;
        if (r.date_start && (!adMap[key].dateStart || r.date_start < adMap[key].dateStart)) adMap[key].dateStart = r.date_start;
        if (r.date_stop && (!adMap[key].dateStop || r.date_stop > adMap[key].dateStop)) adMap[key].dateStop = r.date_stop;
    });
    const aggregated = Object.values(adMap).map((d) => ({
        ...d,
        spend: Math.round(d.spend * 100) / 100,
        cpl: d.leads > 0 ? Math.round((d.spend / d.leads) * 100) / 100 : 0
    }));
    aggregated.sort((a, b) => {
        const leadDiff = (b.leads || 0) - (a.leads || 0);
        if (leadDiff !== 0) return leadDiff;
        const cplDiff = (a.cpl || 0) - (b.cpl || 0);
        if (cplDiff !== 0) return cplDiff;
        return (b.spend || 0) - (a.spend || 0);
    });
    const best = aggregated[0];
    return best ? { name: best.name, campaignName: best.campaignName, platform: best.platform, spend: best.spend, leads: best.leads, cpl: best.cpl, ad_account_name: best.ad_account_name || undefined, dateStart: best.dateStart, dateStop: best.dateStop } : null;
};

/** Today tab: strict day (with timezone-tolerant row matching) then rolling 7d so the card is not blank when Meta dates are UTC-offset. */
const pickBestAdForTodaySnapshot = (rows, snap) => {
    const strict = pickBestAd(filterInsightsRowsByPeriod(rows, snap.today));
    if (strict) return strict;
    const roll7 = pickBestAd(filterInsightsRowsByPeriod(rows, rollingDaysEndingOn(snap.today.to, 7)));
    if (roll7) {
        return {
            ...roll7,
            snapshotFallbackNote: ' Meta rows show no activity on local “today” — showing best ad from the last 7 days (date alignment).'
        };
    }
    return null;
};

/** Instagram captions often lead with “For Appointment / phone / brand”; prefer hook or body lines for titles. */
const lineLooksLikeContactFooter = (s) => {
    const t = String(s || '').trim();
    if (!t) return true;
    if (/^for\s+appointment\b/i.test(t)) return true;
    if (/^appointment\b/i.test(t) && /\d{5,}/.test(t)) return true;
    if (/\b(whatsapp|call\s+now|call\s+us|book\s+now|dm\s+us)\b/i.test(t) && /\d{4,}/.test(t)) return true;
    const digits = (t.match(/\d/g) || []).length;
    if (digits >= 10 && digits / Math.max(t.length, 1) > 0.2) return true;
    return false;
};

/** “Dr. Name | My Health School” style byline — not the creative hook. */
const lineLooksLikeReelSignature = (s) => {
    const t = String(s || '').trim();
    if (!t) return true;
    const low = t.toLowerCase();
    if (/\b(my\s+health\s+school|^\s*my\s+health\s+school)\b/i.test(t)) return true;
    if (/^dr\.?\s+/i.test(t) && t.length < 72 && !/[?!…]/.test(t)) {
        if (!/\b(benefits|loss|weight|how|why|what|secret|tip|explains|watch|reel|body|health\s+tip)\b/i.test(low)) return true;
    }
    if (/\|\s*my\s+health\s+school\b/i.test(t) && t.length < 120) return true;
    return false;
};

const lineLooksLikeFollowHandleCta = (s) => {
    const t = String(s || '').trim();
    if (!t) return false;
    if (/^follow\s+@/i.test(t)) return true;
    if (/\bfollow\s+@[\w.]+\b/i.test(t) && /\b(for\s+more|more\s+tips|tips|updates)\b/i.test(t.toLowerCase())) return true;
    return false;
};

const scoreReelTitleLine = (line) => {
    if (!line) return -1e9;
    let score = line.length;
    if (lineLooksLikeContactFooter(line)) score -= 500;
    if (lineLooksLikeFollowHandleCta(line)) score -= 450;
    if (lineLooksLikeReelSignature(line)) score -= 400;
    if (/[?!…]/.test(line)) score += 35;
    if (/\b(benefits|weight|loss|how\s+to|why\s+|doctor|dr\.)\b/i.test(line)) score += 25;
    return score;
};

const pickReelTitleFromCaption = (caption, maxLen = 120) => {
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
    /* Only signature / brand pipe parts left (e.g. Dr… | My Health School) — show together, not “Follow @…”. */
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
};

/** Text after the chosen title on the first caption line (e.g. “Dr… | Brand”). */
const pickReelSubtitleFromCaption = (caption, primaryTitle, maxLen = 140) => {
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
};

/** First caption line for snapshot card (long hook + emoji + “Dr… |” on one line), after skipping a leading “Follow @…”. */
const pickReelHeadlineLineFromCaption = (caption, maxLen = 200) => {
    if (!caption || typeof caption !== 'string') return '';
    const lines = caption.trim().split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) return '';
    let body = lines;
    if (lines.length >= 2 && lineLooksLikeFollowHandleCta(lines[0])) body = lines.slice(1);
    const first = body[0] || lines[0] || '';
    if (!first) return '';
    return first.length <= maxLen ? first : `${first.slice(0, maxLen - 1)}…`;
};

/** Sanitize watch time — Meta sometimes returns impossibly high values */
const capWatchTime = (raw) => Math.min(Number(raw) || 0, 120);

const buildReelResult = (top) => {
    const reach = Number(top.reach) || Number(top.views) || 0;
    const likes = Number(top.likes) || 0;
    const comments = Number(top.comments) || 0;
    const shares = Number(top.shares) || 0;
    const saves = Number(top.saved) || 0;
    const engagements = Number(top.total_interactions) || (likes + comments + shares + saves);
    const name = pickReelTitleFromCaption(top.caption, 120);
    const headlineLine = pickReelHeadlineLineFromCaption(top.caption, 200) || name;
    const subtitle = pickReelSubtitleFromCaption(top.caption, name, 140);
    const hookRate = Math.min(Number(top.hook_rate || 0), 100);
    const video_avg_time_watched = capWatchTime(top.video_avg_time_watched);
    const engagementRatePct = reach > 0 ? Math.round((engagements / reach) * 1000) / 10 : 0;
    return {
        name,
        headlineLine,
        subtitle,
        platform: 'Instagram',
        reach,
        engagements,
        saves,
        caption: top.caption,
        permalink: top.permalink,
        timestamp: top.timestamp || '',
        thumbnail_url: top.thumbnail_url || top.media_url || '',
        likes,
        comments,
        shares,
        views: Number(top.views) || Number(top.video_views) || 0,
        hookRate,
        video_avg_time_watched,
        engagementRatePct
    };
};

const filterReels = (mediaPayload, period = null) => {
    const media = mediaPayload?.media || [];
    // Match analyzeReelPerformance / server: include reels even when insights are not_supported + zeros (otherwise Best reel stays blank).
    let reels = media.filter((m) => isReelMediaItem(m));
    if (period && period.from && period.to) {
        reels = reels.filter((m) => timestampInPeriod(m.timestamp, period));
    }
    return reels;
};

/** Performance Score = weighted sum of reel metrics (sanitized inputs) */
const computeReelScore = (reel) => {
    const views = Number(reel.views || reel.video_views || 0);
    const reach = Number(reel.reach || 0);
    const likes = Number(reel.likes || 0);
    const comments = Number(reel.comments || 0);
    const shares = Number(reel.shares || 0);
    const saves = Number(reel.saved || reel.saves || 0);
    const watchTime = capWatchTime(reel.video_avg_time_watched);
    const hookRate = Math.min(Number(reel.hook_rate || 0), 100);
    const engagementRate = reach > 0 ? ((likes + comments + shares + saves) / reach) * 100 : 0;
    return (views * 0.20) + (reach * 0.20) + (engagementRate * 0.15) + (shares * 0.15)
         + (saves * 0.10) + (comments * 0.10) + (watchTime * 0.05) + (hookRate * 0.05);
};

const pickBestReel = (mediaPayload, period = null) => {
    const reels = filterReels(mediaPayload, period);
    if (reels.length === 0) return null;
    const sorted = [...reels].sort((a, b) => computeReelScore(b) - computeReelScore(a));
    const best = sorted[0];
    const result = buildReelResult(best);
    result.score = Math.round(computeReelScore(best));
    return result;
};

/**
 * Rolling N-day tab: strict window first, then optional wider windows, then full batch (never leave card blank when IG has data).
 */
const pickBestReelForRollingTab = (mediaPayload, endYmd, numDays, widerDays, finalCapDays = 90) => {
    const strict = pickBestReel(mediaPayload, rollingDaysEndingOn(endYmd, numDays));
    if (strict) return strict;
    for (const w of widerDays || []) {
        const r = pickBestReel(mediaPayload, rollingDaysEndingOn(endYmd, w));
        if (r) {
            return {
                ...r,
                snapshotFallbackNote: ` No reel in the last ${numDays} days — showing top reel from the last ${w} days.`,
                hideReelPublishTime: true
            };
        }
    }
    const maxWider = (widerDays && widerDays.length) ? Math.max(...widerDays) : numDays;
    if (finalCapDays != null && finalCapDays > maxWider) {
        const capped = pickBestReel(mediaPayload, rollingDaysEndingOn(endYmd, finalCapDays));
        if (capped) {
            return {
                ...capped,
                snapshotFallbackNote: ` No reel in the last ${numDays} days in range — showing top reel within the last ${finalCapDays} days.`,
                hideReelPublishTime: true
            };
        }
    }
    return null;
};

/**
 * “Today” tab: strict today (± expanded day); then rolling 7d / 14d. Never jump to full batch first (misleading vs ad dates).
 */
const pickBestReelForTodayTab = (mediaPayload, snap) => {
    const strict = pickBestReel(mediaPayload, snap.today);
    if (strict) return strict;
    const roll7 = pickBestReel(mediaPayload, rollingDaysEndingOn(snap.today.to, 7));
    if (roll7) {
        return {
            ...roll7,
            snapshotFallbackNote: ' No reel posted today — showing top reel published in the last 7 days.',
            hideReelPublishTime: true
        };
    }
    const roll14 = pickBestReel(mediaPayload, rollingDaysEndingOn(snap.today.to, 14));
    if (roll14) {
        return {
            ...roll14,
            snapshotFallbackNote: ' No reel posted today — showing top reel published in the last 14 days.',
            hideReelPublishTime: true
        };
    }
    return null;
};

const pickBestReelForLast7Tab = (mediaPayload, snap) =>
    pickBestReelForRollingTab(mediaPayload, snap.last_7_days.to, 7, [14, 30]);

const pickBestReelForLast14Tab = (mediaPayload, snap) =>
    pickBestReelForRollingTab(mediaPayload, snap.last_14_days.to, 14, [30]);

/** “last 30 days”: strict 30d, then ~60d / ~90d / full batch (sync may not include full month of posts). */
const pickBestReelForLast30Tab = (mediaPayload, snap) => {
    const end = snap.last_30_days.to;
    const strict = pickBestReel(mediaPayload, rollingDaysEndingOn(end, 30));
    if (strict) return strict;
    const roll62 = pickBestReel(mediaPayload, rollingDaysEndingOn(end, 62));
    if (roll62) {
        return {
            ...roll62,
            snapshotFallbackNote: ' No reels in the last 30 days in the current sync — showing top reel from the last ~60 days.',
            hideReelPublishTime: true
        };
    }
    const roll90 = pickBestReel(mediaPayload, rollingDaysEndingOn(end, 90));
    if (roll90) {
        return {
            ...roll90,
            snapshotFallbackNote: ' No reels in the last 30 days in the current sync — showing top reel from the last ~90 days.',
            hideReelPublishTime: true
        };
    }
    const roll120 = pickBestReel(mediaPayload, rollingDaysEndingOn(end, 120));
    if (roll120) {
        return {
            ...roll120,
            snapshotFallbackNote: ' No reels in the last 30 days in the current sync — showing top reel from the last ~120 days.',
            hideReelPublishTime: true
        };
    }
    return null;
};

/** Full reel intelligence analysis: normalized scoring, flags, time-based categorization */
const analyzeReelPerformance = (mediaPayload, periods) => {
    const media = mediaPayload?.media || [];
    const allReels = media.filter((m) => isReelMediaItem(m));
    const empty = { daily_best_reel: null, this_week_best_reel: null, last_week_best_reel: null, weekly_best_reel: null, monthly_best_reel: null, all_time_best_reel: null, trending_reels: [], repost_recommended: [], rising_reels: [], stable_top_performers: [], top_reels: [] };
    if (allReels.length === 0) return empty;

    const rawData = allReels.map((reel) => {
        const views = Number(reel.views || reel.video_views || 0);
        const reach = Number(reel.reach || 0);
        const likes = Number(reel.likes || 0);
        const comments = Number(reel.comments || 0);
        const shares = Number(reel.shares || 0);
        const saves = Number(reel.saved || 0);
        const hookRate = Math.min(Number(reel.hook_rate || 0), 100);
        const watchTime = capWatchTime(reel.video_avg_time_watched);
        const follows = Number(reel.follows || 0);
        const total = likes + comments + shares + saves;
        const engagementRate = reach > 0 ? Math.round((total / reach) * 10000) / 100 : 0;
        const ageMs = reel.timestamp ? Date.now() - new Date(reel.timestamp).getTime() : 0;
        const ageDays = ageMs > 0 ? ageMs / 86400000 : 0;
        const viewVelocity = ageDays > 0 ? Math.round(views / ageDays) : views;
        const shareVelocity = ageDays > 0 ? Math.round((shares / ageDays) * 10) / 10 : shares;
        return { reel, views, reach, engagementRate, shares, saves, comments, hookRate, watchTime, follows, ageDays, viewVelocity, shareVelocity };
    });

    const minMax = (arr, fn) => {
        const vals = arr.map(fn);
        const mn = Math.min(...vals);
        const mx = Math.max(...vals);
        const range = mx - mn;
        return (v) => range > 0 ? ((v - mn) / range) * 100 : 0;
    };
    const normViews = minMax(rawData, r => r.views);
    const normReach = minMax(rawData, r => r.reach);
    const normEng = minMax(rawData, r => r.engagementRate);
    const normShares = minMax(rawData, r => r.shares);
    const normSaves = minMax(rawData, r => r.saves);
    const normComments = minMax(rawData, r => r.comments);
    const normWatch = minMax(rawData, r => r.watchTime);
    const normHook = minMax(rawData, r => r.hookRate);

    const scored = rawData.map((d) => {
        const normalizedScore = (normViews(d.views) * 0.20) + (normReach(d.reach) * 0.20)
            + (normEng(d.engagementRate) * 0.15) + (normShares(d.shares) * 0.15)
            + (normSaves(d.saves) * 0.10) + (normComments(d.comments) * 0.10)
            + (normWatch(d.watchTime) * 0.05) + (normHook(d.hookRate) * 0.05);
        return {
            ...buildReelResult(d.reel),
            score: Math.round(normalizedScore), engagementRate: d.engagementRate,
            hookRate: d.hookRate, watchTime: d.watchTime, follows: d.follows,
            ageDays: Math.round(d.ageDays * 10) / 10, viewVelocity: d.viewVelocity,
            shareVelocity: d.shareVelocity, flags: [], reason: '',
        };
    }).sort((a, b) => b.score - a.score);

    const avg = (arr, fn) => arr.length > 0 ? arr.reduce((s, r) => s + fn(r), 0) / arr.length : 0;
    const avgScore = avg(scored, r => r.score);
    const avgEng = avg(scored, r => r.engagementRate);
    const avgVV = avg(scored, r => r.viewVelocity);
    const avgShares = avg(scored, r => r.shares || 0);
    const avgSaves = avg(scored, r => r.saves || 0);
    const p25Idx = Math.max(0, Math.floor(scored.length * 0.25) - 1);
    const topQuartileScore = scored[p25Idx]?.score || avgScore;

    scored.forEach((reel) => {
        const flags = [];
        const reasons = [];
        if (reel.viewVelocity > avgVV * 2 && reel.engagementRate > avgEng * 1.5) {
            flags.push('TRENDING');
            reasons.push('rapid view growth and high engagement spike');
        }
        if ((reel.shares || 0) > avgShares * 1.5 && (reel.saves || 0) > avgSaves * 1.5 && reel.engagementRate > avgEng) {
            flags.push('REPOST_RECOMMENDED');
            reasons.push('high shares, saves, and engagement — strong repost candidate');
        }
        if (reel.ageDays <= 1 && reel.score > avgScore) {
            flags.push('RISING');
            reasons.push('strong early performance within first 24 hours');
        }
        if (reel.ageDays >= 3 && reel.score >= topQuartileScore) {
            flags.push('STABLE_TOP_PERFORMER');
            reasons.push('consistently high performance over 3+ days');
        }
        reel.flags = flags;
        const highlights = [];
        if (reel.views > 0) highlights.push(`${fmtReach(reel.views)} views`);
        if (reel.engagementRate > avgEng) highlights.push(`${reel.engagementRate.toFixed(1)}% engagement`);
        if ((reel.shares || 0) > avgShares) highlights.push(`${reel.shares} shares`);
        if (reel.watchTime > 0) highlights.push(`${reel.watchTime.toFixed(1)}s avg watch`);
        if (reel.hookRate > 0) highlights.push(`${reel.hookRate}% hook rate`);
        const base = reasons.length > 0 ? reasons.join('; ') + '.' : '';
        const metrics = highlights.length > 0 ? ` Key metrics: ${highlights.join(', ')}.` : '';
        reel.reason = (base + metrics).trim() || `Performance score: ${reel.score}`;
    });

    const inPeriod = (reels, period) => {
        if (!period?.from || !period?.to) return [];
        return reels.filter((r) => timestampInPeriod(r.timestamp, period));
    };
    /** Best-scoring reel in period (not first row in global sort). */
    const bestIn = (period) => {
        const f = inPeriod(scored, period);
        if (f.length === 0) return null;
        return [...f].sort((a, b) => (b.score || 0) - (a.score || 0))[0];
    };
    /** When strict calendar period has no published reels, align with snapshot reel fallbacks (same data, no extra API). */
    const bestInRolling = (scoredRows, endYmd, numDays) => {
        const pr = rollingDaysEndingOn(endYmd, numDays);
        const f = scoredRows.filter((r) => timestampInPeriod(r.timestamp, pr));
        if (f.length === 0) return null;
        return [...f].sort((a, b) => (b.score || 0) - (a.score || 0))[0];
    };

    const thisWeekBest =
        bestIn(periods.thisWeek)
        || bestInRolling(scored, periods.today.to, 7)
        || bestInRolling(scored, periods.today.to, 14);
    const dailyBest = bestIn(periods.today) || bestInRolling(scored, periods.today.to, 7);
    const lastWeekBest =
        bestIn(periods.lastWeek)
        || bestInRolling(scored, periods.today.to, 14)
        || bestInRolling(scored, periods.today.to, 30);
    const monthlyBest =
        bestIn(periods.lastMonth)
        || bestInRolling(scored, periods.today.to, 62)
        || bestInRolling(scored, periods.today.to, 90)
        || scored[0]
        || null;

    return {
        daily_best_reel: dailyBest,
        this_week_best_reel: thisWeekBest,
        last_week_best_reel: lastWeekBest,
        weekly_best_reel: thisWeekBest || lastWeekBest,
        monthly_best_reel: monthlyBest,
        all_time_best_reel: scored[0] || null,
        trending_reels: scored.filter((r) => r.flags.includes('TRENDING')).slice(0, 5),
        repost_recommended: scored.filter((r) => r.flags.includes('REPOST_RECOMMENDED')).slice(0, 5),
        rising_reels: scored.filter((r) => r.flags.includes('RISING')).slice(0, 5),
        stable_top_performers: scored.filter((r) => r.flags.includes('STABLE_TOP_PERFORMER')).slice(0, 5),
        top_reels: scored.filter((r) => r.score >= topQuartileScore).slice(0, 10),
    };
};

const defaultAdsData = {
    today: { name: '—', platform: 'Meta', spend: 0, leads: 0, cpl: 0, reason: 'Loading…', action: 'MONITOR' },
    last_7_days: { name: '—', platform: 'Meta', spend: 0, leads: 0, cpl: 0, reason: 'Loading…', action: 'MONITOR' },
    last_14_days: { name: '—', platform: 'Meta', spend: 0, leads: 0, cpl: 0, reason: 'Loading…', action: 'MONITOR' },
    last_30_days: { name: '—', platform: 'Meta', spend: 0, leads: 0, cpl: 0, reason: 'Loading…', action: 'MONITOR' }
};

const defaultReelsData = {
    today: { name: '—', headlineLine: '', subtitle: '', platform: 'Instagram', reach: 0, engagements: 0, saves: 0, hookRate: 0, video_avg_time_watched: 0, engagementRatePct: 0, reason: 'Loading…', action: 'MONITOR', thumbnail_url: '', permalink: '', timestamp: '', snapshotFallbackNote: '' },
    last_7_days: { name: '—', headlineLine: '', subtitle: '', platform: 'Instagram', reach: 0, engagements: 0, saves: 0, hookRate: 0, video_avg_time_watched: 0, engagementRatePct: 0, reason: 'Loading…', action: 'MONITOR', thumbnail_url: '', permalink: '', timestamp: '', snapshotFallbackNote: '' },
    last_14_days: { name: '—', headlineLine: '', subtitle: '', platform: 'Instagram', reach: 0, engagements: 0, saves: 0, hookRate: 0, video_avg_time_watched: 0, engagementRatePct: 0, reason: 'Loading…', action: 'MONITOR', thumbnail_url: '', permalink: '', timestamp: '', snapshotFallbackNote: '' },
    last_30_days: { name: '—', headlineLine: '', subtitle: '', platform: 'Instagram', reach: 0, engagements: 0, saves: 0, hookRate: 0, video_avg_time_watched: 0, engagementRatePct: 0, reason: 'Loading…', action: 'MONITOR', thumbnail_url: '', permalink: '', timestamp: '', snapshotFallbackNote: '' }
};

export default function AIInsights() {
    const [activeTimeWindow, setActiveTimeWindow] = useState('last_30_days');

    const [loading, setLoading] = useState(true);
    /** 'data' = fetching Meta ads/reels, 'ai' = calling Gemini */
    const [loadingPhase, setLoadingPhase] = useState('data');
    const [error, setError] = useState(null);
    const [adsData, setAdsData] = useState(defaultAdsData);
    const [reelsData, setReelsData] = useState(defaultReelsData);
    const [insights, setInsights] = useState([]);
    const [recommendations, setRecommendations] = useState([]);
    // Rich campaign summary for the user's selected date range — used by Ask AI for filter-aware answers
    const [filteredAdsSummary, setFilteredAdsSummary] = useState(null);
    /** When AI returns 429 quota exceeded: show last result + this message and countdown */
    const [quotaRetrySeconds, setQuotaRetrySeconds] = useState(null);
    const [lastAnalysedAt, setLastAnalysedAt] = useState(null);
    const [askInput, setAskInput] = useState('');
    const [askHint, setAskHint] = useState('');
    const [askLoading, setAskLoading] = useState(false);
    const [askAnswer, setAskAnswer] = useState('');
    const [askError, setAskError] = useState('');

    /* Lead Saturation Detection – isolated state, does not affect Intelligence block */
    const [saturationLoading, setSaturationLoading] = useState(false);
    const [saturationError, setSaturationError] = useState(null);
    const [saturationResult, setSaturationResult] = useState(null);
    const [fatigueLoading, setFatigueLoading] = useState(false);
    const [fatigueError, setFatigueError] = useState(null);
    const [fatigueResult, setFatigueResult] = useState(null);
    const [qualityLoading, setQualityLoading] = useState(false);
    const [qualityError, setQualityError] = useState(null);
    const [qualityResult, setQualityResult] = useState(null);
    const [qualityScores, setQualityScores] = useState([]);
    const [leadDownloadOpen, setLeadDownloadOpen] = useState(false);
    const leadDownloadRef = useRef(null);
    const [satSort, setSatSort] = useState({ field: 'saturation_index', dir: 'desc' });
    const [fatSort, setFatSort] = useState({ field: 'fatigue_score', dir: 'desc' });
    const [leadSort, setLeadSort] = useState({ field: 'score', dir: 'desc' });
    useEffect(() => {
        if (!leadDownloadOpen) return;
        const handler = (e) => {
            if (leadDownloadRef.current && !leadDownloadRef.current.contains(e.target)) {
                setLeadDownloadOpen(false);
            }
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [leadDownloadOpen]);
    const [reelAnalysis, setReelAnalysis] = useState(null);

    const [insightsDatePreset, setInsightsDatePreset] = useState('last_30_days');
    const [customDraftFrom, setCustomDraftFrom] = useState('');
    const [customDraftTo, setCustomDraftTo] = useState('');
    /** Applied custom range only updates after “Apply range” (avoids refetch on every date input change). */
    const [customCommitted, setCustomCommitted] = useState({ from: '', to: '' });
    const [datePresetMenuOpen, setDatePresetMenuOpen] = useState(false);
    const datePresetWrapRef = useRef(null);
    /** Bumps on each fetchAIInsights start so stale async completions cannot overwrite newer results (fixes blank Best reel after refresh). */
    const aiInsightsFetchGenRef = useRef(0);

    const resolvedInsightsRange = useMemo(() => {
        if (insightsDatePreset === 'custom') {
            if (customCommitted.from && customCommitted.to && customCommitted.from <= customCommitted.to) {
                return { from: customCommitted.from, to: customCommitted.to };
            }
            return getDateRangeForPreset('last_30_days');
        }
        return getDateRangeForPreset(insightsDatePreset) || getDateRangeForPreset('last_30_days');
    }, [insightsDatePreset, customCommitted.from, customCommitted.to]);

    const insightsPresetLabel = useMemo(() => {
        const o = INSIGHTS_DATE_PRESET_OPTIONS.find((x) => x.id === insightsDatePreset);
        return o?.label || 'last 30 days';
    }, [insightsDatePreset]);

    const headerDateRangeLabel = useMemo(() => {
        const r = resolvedInsightsRange;
        if (!r?.from || !r?.to) return '—';
        return `${formatDateHeaderShort(r.from)} – ${formatDateHeaderShort(r.to)}`;
    }, [resolvedInsightsRange]);

    useEffect(() => {
        if (!datePresetMenuOpen) return;
        const onDoc = (e) => {
            if (datePresetWrapRef.current && !datePresetWrapRef.current.contains(e.target)) {
                setDatePresetMenuOpen(false);
            }
        };
        document.addEventListener('mousedown', onDoc);
        return () => document.removeEventListener('mousedown', onDoc);
    }, [datePresetMenuOpen]);

    const fetchAIInsights = useCallback(async (forceRefresh = false) => {
        const gen = ++aiInsightsFetchGenRef.current;
        const isStale = () => gen !== aiInsightsFetchGenRef.current;

        setLoading(true);
        setLoadingPhase('data');
        setError(null);
        setQuotaRetrySeconds(null);
        setFilteredAdsSummary(null); // clear stale summary while new data loads
        try {
            const { from: heroFrom, to: heroTo } = resolvedInsightsRange;
            const dateRange = { from: heroFrom, to: heroTo };
            const { from: dataFrom, to: dataTo } = mergeSnapshotDataRange(resolvedInsightsRange);
            const mediaOptsBase = {
                from: dataFrom,
                to: dataTo,
                forceRefresh,
                timeoutMs: 20000
            };

            let [insightsRows, pages] = await Promise.all([
                fetchInsightsForAI(dataFrom, dataTo, forceRefresh),
                fetchPages()
            ]);
            if (!isStale() && (!pages || pages.length === 0)) {
                await sleep(450);
                if (!isStale()) pages = await fetchPages();
            }

            let mediaPayload = await fetchMediaInsightsForPages(pages, mediaOptsBase);
            if (!isStale() && insightsRows.length > 0 && (!mediaPayload?.media || mediaPayload.media.length === 0)) {
                await sleep(500);
                if (!isStale()) {
                    mediaPayload = await fetchMediaInsightsForPages(pages, {
                        ...mediaOptsBase,
                        forceRefresh: true
                    });
                }
            }

            // --- Build rich summary for the user's SELECTED date range (used by Ask AI) ---
            const filteredRows = filterInsightsRowsByPeriod(insightsRows, { from: heroFrom, to: heroTo });
            if (filteredRows.length > 0) {
                // Aggregate totals
                const totals = filteredRows.reduce((acc, r) => {
                    acc.spend += num(r.spend); acc.leads += num(r.leads); acc.impressions += num(r.impressions);
                    acc.clicks += num(r.clicks); acc.conversions += num(r.conversions || 0);
                    return acc;
                }, { spend: 0, leads: 0, impressions: 0, clicks: 0, conversions: 0 });
                totals.cpl = totals.leads > 0 ? totals.spend / totals.leads : 0;
                totals.ctr = totals.impressions > 0 ? (totals.clicks / totals.impressions) * 100 : 0;

                // Group by ad_id: sum metrics per ad
                const adMap = {};
                for (const r of filteredRows) {
                    const key = r.ad_id || r.ad_name || 'unknown';
                    if (!adMap[key]) adMap[key] = { name: r.ad_name, campaign: r.campaign_name, spend: 0, leads: 0, impressions: 0, clicks: 0 };
                    adMap[key].spend += num(r.spend);
                    adMap[key].leads += num(r.leads);
                    adMap[key].impressions += num(r.impressions);
                    adMap[key].clicks += num(r.clicks);
                }
                const adList = Object.values(adMap).map(a => ({ ...a, cpl: a.leads > 0 ? a.spend / a.leads : 0, ctr: a.impressions > 0 ? (a.clicks / a.impressions) * 100 : 0 }));
                const topByLeads = [...adList].sort((a, b) => b.leads - a.leads).slice(0, 5).map(a => ({ name: a.name, campaign: a.campaign, leads: Math.round(a.leads), spend: +a.spend.toFixed(2), cpl: +a.cpl.toFixed(2), ctr: +a.ctr.toFixed(2) }));
                const topByCpl = [...adList].filter(a => a.leads > 0).sort((a, b) => a.cpl - b.cpl).slice(0, 5).map(a => ({ name: a.name, campaign: a.campaign, leads: Math.round(a.leads), cpl: +a.cpl.toFixed(2) }));
                const worstByCpl = [...adList].filter(a => a.leads > 0).sort((a, b) => b.cpl - a.cpl).slice(0, 3).map(a => ({ name: a.name, campaign: a.campaign, leads: Math.round(a.leads), cpl: +a.cpl.toFixed(2) }));

                if (!isStale()) setFilteredAdsSummary({
                    dateRange: { from: heroFrom, to: heroTo },
                    totalAds: adList.length,
                    totals: { spend: +totals.spend.toFixed(2), leads: Math.round(totals.leads), cpl: +totals.cpl.toFixed(2), ctr: +totals.ctr.toFixed(2), impressions: Math.round(totals.impressions), clicks: Math.round(totals.clicks) },
                    topAdsByLeads: topByLeads,
                    topAdsByCpl: topByCpl,
                    worstAdsByCpl: worstByCpl,
                });
            }
            // ---

            const calendarPeriods = getPeriodRanges();
            const snapPeriods = getSnapshotPeriodRanges();
            const bestAds = {
                today: pickBestAdForTodaySnapshot(insightsRows, snapPeriods),
                last_7_days: pickBestAd(filterInsightsRowsByPeriod(insightsRows, snapPeriods.last_7_days)),
                last_14_days: pickBestAd(filterInsightsRowsByPeriod(insightsRows, snapPeriods.last_14_days)),
                last_30_days: pickBestAd(filterInsightsRowsByPeriod(insightsRows, snapPeriods.last_30_days))
            };
            const bestReels = {
                today: pickBestReelForTodayTab(mediaPayload, snapPeriods),
                last_7_days: pickBestReelForLast7Tab(mediaPayload, snapPeriods),
                last_14_days: pickBestReelForLast14Tab(mediaPayload, snapPeriods),
                last_30_days: pickBestReelForLast30Tab(mediaPayload, snapPeriods)
            };
            const reelSlotsLocal = {
                today: mapReelPickToSlot(bestReels.today),
                last_7_days: mapReelPickToSlot(bestReels.last_7_days),
                last_14_days: mapReelPickToSlot(bestReels.last_14_days),
                last_30_days: mapReelPickToSlot(bestReels.last_30_days)
            };

            if (isStale()) return;

            setReelAnalysis(analyzeReelPerformance(mediaPayload, calendarPeriods));

            const adsSlotsLocal = {
                today: mapAdPickToSlot(bestAds.today),
                last_7_days: mapAdPickToSlot(bestAds.last_7_days),
                last_14_days: mapAdPickToSlot(bestAds.last_14_days),
                last_30_days: mapAdPickToSlot(bestAds.last_30_days)
            };
            // Show live ad/reel results immediately even if the AI summary step is slow.
            setAdsData(adsSlotsLocal);
            setReelsData(reelSlotsLocal);

            setLoadingPhase('ai');
            const token = getAuthToken();
            const headers = { 'Content-Type': 'application/json' };
            if (token) headers['Authorization'] = `Bearer ${token}`;
            const res = await fetchJsonWithTimeout(`${API_BASE}/api/ai/insights`, {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    bestAds,
                    bestReels,
                    dateRange,
                    selectedPeriod: insightsDatePreset !== 'custom' ? insightsDatePreset : null,
                    context: { platform: 'all', location: 'all', age: 'all' }
                })
            }, 20000);
            const json = await res.json().catch(() => ({}));
            if (!res.ok) {
                if (!isStale()) {
                    if (res.status === 429) {
                        setError('AI quota exceeded. Showing last analysis below.');
                        setQuotaRetrySeconds(typeof json.retryAfterSeconds === 'number' ? json.retryAfterSeconds : 60);
                    } else if (res.status === 402 || json.error === 'billing_error') {
                        setError('BILLING_ERROR');
                    } else {
                        // Strip raw JSON if it leaked into the message
                        const raw = json.details || json.error || res.statusText || 'Failed to load AI insights';
                        const clean = typeof raw === 'string' && raw.trimStart().startsWith('{')
                            ? 'AI service error. Please try again later.'
                            : raw;
                        setError(clean);
                    }
                }
                return;
            }
            if (!isStale() && json.success && json.data) {
                if (json.data.adsData) setAdsData(preferLocalAdSlotsIfApiEmpty(adsSlotsLocal, json.data.adsData));
                if (json.data.reelsData) {
                    setReelsData(preferLocalReelSlotsIfApiEmpty(reelSlotsLocal, json.data.reelsData));
                }
                if (Array.isArray(json.data.insights)) setInsights(json.data.insights);
                if (Array.isArray(json.data.recommendations)) setRecommendations(json.data.recommendations);
            }
        } catch (err) {
            if (!isStale()) {
                if (err?.name === 'AbortError') {
                    setError('AI insights timed out. Showing live ad and reel data only.');
                } else {
                    setError(err.message || 'Network error');
                }
            }
        } finally {
            if (!isStale()) {
                setLastAnalysedAt(new Date());
                setLoading(false);
            }
        }
    }, [resolvedInsightsRange, insightsDatePreset]);

    /* Countdown for quota retry: decrement every second, clear when 0 */
    useEffect(() => {
        if (quotaRetrySeconds == null || quotaRetrySeconds <= 0) return;
        const t = setInterval(() => {
            setQuotaRetrySeconds((s) => (s <= 1 ? null : s - 1));
        }, 1000);
        return () => clearInterval(t);
    }, [quotaRetrySeconds]);

    const fetchLeadSaturation = useCallback(async () => {
        setSaturationLoading(true);
        setSaturationError(null);
        setSaturationResult(null);
        try {
            const token = getAuthToken();
            const headers = { 'Content-Type': 'application/json' };
            if (token) headers['Authorization'] = `Bearer ${token}`;
            const dateRange = { from: resolvedInsightsRange.from, to: resolvedInsightsRange.to };
            const res = await fetch(`${API_BASE}/api/ai/lead-saturation`, {
                method: 'POST',
                headers,
                body: JSON.stringify({ dateRange })
            });
            const json = await res.json().catch(() => ({}));
            if (!res.ok) {
                setSaturationError(json.details || json.error || res.statusText || 'Lead saturation analysis failed');
                return;
            }
            setSaturationResult(json);
        } catch (err) {
            setSaturationError(err.message || 'Network error');
        } finally {
            setSaturationLoading(false);
        }
    }, [resolvedInsightsRange]);

    const fetchCreativeFatigue = useCallback(async () => {
        setFatigueLoading(true);
        setFatigueError(null);
        setFatigueResult(null);
        try {
            const token = getAuthToken();
            const headers = { 'Content-Type': 'application/json' };
            if (token) headers['Authorization'] = `Bearer ${token}`;
            const dateRange = { from: resolvedInsightsRange.from, to: resolvedInsightsRange.to };
            const res = await fetch(`${API_BASE}/api/ai/creative-fatigue`, {
                method: 'POST',
                headers,
                body: JSON.stringify({ dateRange })
            });
            const json = await res.json().catch(() => ({}));
            if (!res.ok) {
                setFatigueError(json.details || json.error || res.statusText || 'Creative fatigue analysis failed');
                return;
            }
            setFatigueResult(json);
        } catch (err) {
            setFatigueError(err.message || 'Network error');
        } finally {
            setFatigueLoading(false);
        }
    }, [resolvedInsightsRange]);

    const loadLeadScores = useCallback(async () => {
        try {
            const token = getAuthToken();
            const headers = {};
            if (token) headers['Authorization'] = `Bearer ${token}`;
            const { from, to } = resolvedInsightsRange;
            const res = await fetch(`${API_BASE}/api/ai/lead-quality/scores?dateFrom=${encodeURIComponent(from)}&dateTo=${encodeURIComponent(to)}&limit=10000`, { headers });
            const json = await res.json().catch(() => ({}));
            if (json.success && Array.isArray(json.data)) setQualityScores(json.data);
        } catch (e) { /* ignore */ }
    }, [resolvedInsightsRange]);

    const fetchLeadQuality = useCallback(async () => {
        setQualityLoading(true);
        setQualityError(null);
        setQualityResult(null);
        try {
            const token = getAuthToken();
            const headers = { 'Content-Type': 'application/json' };
            if (token) headers['Authorization'] = `Bearer ${token}`;
            const { from, to } = resolvedInsightsRange;
            const res = await fetch(`${API_BASE}/api/ai/lead-quality`, {
                method: 'POST',
                headers,
                body: JSON.stringify({ dateFrom: from, dateTo: to })
            });
            const json = await res.json().catch(() => ({}));
            if (!res.ok) {
                setQualityError(json.details || json.error || res.statusText || 'Lead quality scoring failed');
                return;
            }
            setQualityResult(json);
            if (json.success) {
                setQualityScores(Array.isArray(json.samples) ? json.samples : []);
                await loadLeadScores();
            }
        } catch (err) {
            setQualityError(err.message || 'Network error');
        } finally {
            setQualityLoading(false);
        }
    }, [resolvedInsightsRange, loadLeadScores]);

    useEffect(() => {
        fetchAIInsights();
    }, [fetchAIInsights]);

    useEffect(() => {
        loadLeadScores();
    }, [loadLeadScores]);

    useEffect(() => {
        fetchLeadSaturation();
        fetchCreativeFatigue();
    }, [fetchLeadSaturation, fetchCreativeFatigue]);

    const currentAd = adsData[activeTimeWindow] || defaultAdsData.last_30_days;
    const rawReel = reelsData[activeTimeWindow];
    const reelSlotLooksEmpty = (r) => {
        if (!r) return true;
        const name = String(r.name || '').trim();
        const hasName = name && name !== '—';
        const hasMetrics = Number(r.reach || 0) > 0 || Number(r.views || 0) > 0;
        const hasMeta = !!(r.permalink || r.thumbnail_url || r.timestamp);
        return !hasName && !hasMetrics && !hasMeta;
    };
    const periodLabels = {
        today: 'Today',
        last_7_days: 'last 7 days',
        last_14_days: 'last 14 days',
        last_30_days: 'last 30 days'
    };

    const analysisReelForPeriod = useMemo(() => {
        if (!reelAnalysis) return null;
        const map = {
            today: 'daily_best_reel',
            last_7_days: 'this_week_best_reel',
            last_14_days: 'last_week_best_reel',
            last_30_days: 'monthly_best_reel'
        };
        return reelAnalysis[map[activeTimeWindow]] || null;
    }, [reelAnalysis, activeTimeWindow]);

    /* Use slot whenever it has a real title, metrics, or a link — not only when views > 0 (Meta can return zeros). */
    const analysisReelNonEmpty = (r) => {
        if (!r) return false;
        const name = String(r.name || '').trim();
        const hasName = name && name !== '—';
        return !!(
            hasName ||
            Number(r.reach || 0) > 0 ||
            Number(r.views || 0) > 0 ||
            r.thumbnail_url ||
            r.permalink ||
            r.timestamp
        );
    };
    const hasUsableAnalysisReel = analysisReelNonEmpty(analysisReelForPeriod);
    /** Prefer Instagram snapshot slot when it has real data; analysis row is a fallback (avoids blank when daily_best uses a different day scope). */
    const displayReel = !reelSlotLooksEmpty(rawReel)
        ? rawReel
        : (hasUsableAnalysisReel ? analysisReelForPeriod : null);

    /** Thumbnail / subtitle / link: fill from snapshot slot when analysis row omits them. */
    const reelForCard = useMemo(() => {
        if (!displayReel) return null;
        const thumb = String(displayReel.thumbnail_url || rawReel?.thumbnail_url || '').trim();
        const permalink = String(displayReel.permalink || rawReel?.permalink || '').trim();
        const cap = displayReel.caption || rawReel?.caption || '';
        let subtitle = String(displayReel.subtitle || '').trim();
        if (!subtitle && cap && displayReel.name) {
            subtitle = pickReelSubtitleFromCaption(cap, displayReel.name, 140);
        }
        const headlineLine = String(displayReel.headlineLine || rawReel?.headlineLine || '').trim()
            || (cap ? pickReelHeadlineLineFromCaption(cap, 200) : '')
            || displayReel.name;
        const hookRate = Math.min(Number(displayReel.hookRate ?? displayReel.hook_rate ?? rawReel?.hookRate ?? rawReel?.hook_rate ?? 0), 100);
        const video_avg_time_watched = capWatchTime(
            displayReel.video_avg_time_watched ?? rawReel?.video_avg_time_watched ?? displayReel.watchTime ?? rawReel?.watchTime ?? 0
        );
        let engagementRatePct = displayReel.engagementRate ?? displayReel.engagementRatePct ?? rawReel?.engagementRatePct ?? rawReel?.engagementRate;
        if (engagementRatePct == null || Number.isNaN(Number(engagementRatePct))) {
            const reach = Number(displayReel.reach || displayReel.views || rawReel?.reach || rawReel?.views || 0);
            const eng = Number(displayReel.engagements) || Number(rawReel?.engagements)
                || (Number(displayReel.likes || 0) + Number(displayReel.comments || 0) + Number(displayReel.shares || 0) + Number(displayReel.saves || 0));
            engagementRatePct = reach > 0 ? Math.round((eng / reach) * 1000) / 10 : 0;
        } else {
            engagementRatePct = Number(engagementRatePct);
        }
        const snapshotFallbackNote = String(displayReel.snapshotFallbackNote || rawReel?.snapshotFallbackNote || '').trim();
        return {
            ...displayReel,
            thumbnail_url: thumb,
            permalink,
            subtitle,
            headlineLine,
            hookRate,
            video_avg_time_watched,
            engagementRatePct,
            snapshotFallbackNote
        };
    }, [displayReel, rawReel]);

    /** Merge flags from intelligence lists + period bests so Repost / Stable pills show for every tab, not only when analysis row wins. */
    const displayReelFlags = useMemo(() => {
        const base = displayReel?.flags || [];
        if (!reelAnalysis || !displayReel) return base;
        const p = String(displayReel.permalink || '').trim();
        const nm = String(displayReel.name || '').trim().slice(0, 80);
        const merge = new Set(base);
        const addFrom = (r) => {
            if (!r || !Array.isArray(r.flags) || r.flags.length === 0) return;
            const rp = String(r.permalink || '').trim();
            const rn = String(r.name || '').trim().slice(0, 80);
            const match = (p && rp && p === rp) || (nm && rn && rn === nm);
            if (match) r.flags.forEach((f) => merge.add(f));
        };
        [reelAnalysis.top_reels, reelAnalysis.repost_recommended, reelAnalysis.stable_top_performers, reelAnalysis.trending_reels, reelAnalysis.rising_reels].forEach((arr) => {
            if (!Array.isArray(arr)) return;
            arr.forEach(addFrom);
        });
        [reelAnalysis.monthly_best_reel, reelAnalysis.this_week_best_reel, reelAnalysis.daily_best_reel, reelAnalysis.last_week_best_reel, reelAnalysis.all_time_best_reel].forEach(addFrom);
        return [...merge];
    }, [reelAnalysis, displayReel]);

    const reelPerfSummary = useMemo(() => {
        if (!reelForCard) return '—';
        const matched = findMatchedAnalysisReel(reelForCard, reelAnalysis);
        let text = '';
        if (matched?.reason && String(matched.reason).trim()) {
            text = String(matched.reason).trim();
        } else {
            text = buildFallbackReelPerfSummary(reelForCard, displayReelFlags);
        }
        const note = String(reelForCard.snapshotFallbackNote || '').trim();
        if (note && !text.includes(note.slice(0, Math.min(28, note.length)))) {
            text = `${text}${text.endsWith('.') ? '' : '.'} ${note}`;
        }
        return text;
    }, [reelForCard, reelAnalysis, displayReelFlags]);

    const flagLabels = { TRENDING: 'Trending Reel', REPOST_RECOMMENDED: 'Repost Recommended', RISING: 'Rising Reel', STABLE_TOP_PERFORMER: 'Stable Top Performer' };
    const flagColors = { TRENDING: '#ef4444', REPOST_RECOMMENDED: '#8b5cf6', RISING: '#f59e0b', STABLE_TOP_PERFORMER: '#22c55e' };
    const flagIcons = { TRENDING: 'fa-fire', REPOST_RECOMMENDED: 'fa-retweet', RISING: 'fa-arrow-trend-up', STABLE_TOP_PERFORMER: 'fa-shield-check' };
    const periodLabel = periodLabels[activeTimeWindow] || '';
    const snapshotRollingLabelPeriod = activeTimeWindow !== 'today' ? getSnapshotPeriodRanges()[activeTimeWindow] : null;

    const saturationIndexPct = useMemo(() => {
        const avgFromSummary = saturationResult?.summary?.saturation_index_avg;
        if (avgFromSummary != null && !Number.isNaN(Number(avgFromSummary))) {
            return Math.min(100, Math.round(Number(avgFromSummary)));
        }
        const camps = saturationResult?.campaigns;
        if (!camps?.length) return null;
        const idxs = camps.map((c) => (c.saturation_index != null ? c.saturation_index : c.score) || 0);
        const avg = idxs.reduce((a, b) => a + b, 0) / idxs.length;
        return Math.min(100, Math.round(avg));
    }, [saturationResult]);

    const saturationStatusUi = useMemo(() => {
        const lvl = saturationResult?.saturationLevel;
        if (lvl === 'high') return { label: 'Critical', tone: 'crit' };
        if (lvl === 'medium') return { label: 'Warning', tone: 'mod' };
        return { label: 'Safe', tone: 'ok' };
    }, [saturationResult]);

    const saturationBars = useMemo(() => {
        const camps = saturationResult?.campaigns;
        if (!camps?.length) return [];
        const worst = [...camps].sort(
            (a, b) => (b.saturation_index ?? b.score ?? 0) - (a.saturation_index ?? a.score ?? 0)
        )[0];
        const freq = worst.frequency ?? 0;
        const rp = worst.reach_pct;
        const cpmWow = worst.cpm_wow_pct;
        const ctrDrop = worst.ctr_drop_pct;
        const fti = worst.first_time_impression_pct;
        const barTone = (danger, warn) => {
            if (danger) return 'danger';
            if (warn) return 'warn';
            return 'neutral';
        };
        return [
            {
                label: 'Frequency',
                value: typeof freq === 'number' ? `${freq.toFixed(1)}×` : '—',
                pct: Math.min(100, (freq / 5) * 100),
                tone: barTone(freq >= 4, freq > 3)
            },
            {
                label: 'Reach % of pool',
                value: rp != null ? `${Number(rp).toFixed(0)}%` : '—',
                pct: rp != null ? Math.min(100, rp) : 0,
                tone: barTone(rp >= 70, rp > 50)
            },
            {
                label: 'First-time impression share',
                value: fti != null ? `${Number(fti).toFixed(0)}%` : '—',
                pct: fti != null ? Math.min(100, fti) : 0,
                tone: barTone(fti != null && fti < 15, fti != null && fti < 30)
            },
            {
                label: 'CPM vs prior week',
                value: cpmWow != null ? `${cpmWow > 0 ? '+' : ''}${Number(cpmWow).toFixed(0)}%` : '—',
                pct: cpmWow != null ? Math.min(100, Math.abs(cpmWow)) : 0,
                tone: barTone(cpmWow >= 35, cpmWow >= 20)
            },
            {
                label: 'CTR drop vs prior',
                value: ctrDrop != null ? `${Number(ctrDrop).toFixed(0)}%` : '—',
                pct: ctrDrop != null ? Math.min(100, Math.abs(ctrDrop)) : 0,
                tone: barTone(ctrDrop >= 35, ctrDrop >= 20)
            }
        ];
    }, [saturationResult]);

    const topFatigueCreatives = useMemo(() => {
        const list = fatigueResult?.creatives;
        if (!Array.isArray(list)) return [];
        return [...list].sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, 5);
    }, [fatigueResult]);

    const fatigueAvgCtrDrop = useMemo(() => {
        const list = fatigueResult?.creatives;
        if (!Array.isArray(list) || !list.length) return null;
        const drops = list.map((c) => c.ctr_drop_pct || 0).filter((x) => x > 0);
        if (!drops.length) return 0;
        return Math.round(drops.reduce((a, b) => a + b, 0) / drops.length);
    }, [fatigueResult]);

    const fatigueStatusUi = useMemo(() => {
        const s = fatigueResult?.summary;
        if (!s) return { label: '—', tone: 'mod' };
        if ((s.severe ?? 0) > 0) return { label: 'Severe', tone: 'crit' };
        if ((s.fatigued ?? 0) > 0) return { label: 'Fatigued', tone: 'warn' };
        if ((s.aging ?? 0) > 0) return { label: 'Aging', tone: 'mod' };
        return { label: 'Fresh', tone: 'ok' };
    }, [fatigueResult]);

    const freshCreativesCount = useMemo(() => fatigueResult?.summary?.fresh ?? fatigueResult?.summary?.healthy ?? 0, [fatigueResult]);

    const hookSecondsDisplay = useMemo(() => {
        const w = displayReel?.watchTime;
        if (w != null && w > 0) return `${w.toFixed(1)}s`;
        return '—';
    }, [displayReel]);

    const leadSamples = useMemo(() => (qualityScores.length ? qualityScores : (qualityResult?.samples || [])), [qualityScores, qualityResult]);

    const leadCategoryBars = useMemo(() => {
        const samples = leadSamples;
        if (!samples.length) return [];
        const map = { 'Hot Lead': 0, 'Warm Lead': 0, Nurture: 0, Cold: 0 };
        samples.forEach((s) => {
            const k = s.category || 'Cold';
            if (map[k] !== undefined) map[k] += 1;
            else if (String(k).includes('Hot')) map['Hot Lead'] += 1;
            else if (String(k).includes('Warm')) map['Warm Lead'] += 1;
            else if (String(k).includes('Nurture') || String(k).includes('Average')) map.Nurture += 1;
            else map.Cold += 1;
        });
        const total = samples.length;
        const order = [
            { key: 'Hot Lead', short: 'Hot', color: '#ef4444' },
            { key: 'Warm Lead', short: 'Warm', color: '#f97316' },
            { key: 'Nurture', short: 'Nurture', color: '#3b82f6' },
            { key: 'Cold', short: 'Cold', color: '#64748b' }
        ];
        return order.map((o) => ({ ...o, pct: Math.round((map[o.key] / total) * 100) }));
    }, [leadSamples]);

    const leadIntelStats = useMemo(() => {
        const summary = qualityResult?.summary;
        const samples = leadSamples;
        const n = samples.length;
        const summaryTotal = summary && typeof summary.total === 'number' ? summary.total : null;
        const effectiveN = Math.max(n, summaryTotal ?? 0);
        if (
            qualityResult?.success &&
            summary &&
            typeof summary.avg_score === 'number' &&
            effectiveN > 0
        ) {
            return {
                total: summaryTotal ?? n,
                avgScore: summary.avg_score,
                hotLeadRatePct: summary.hot_lead_rate_pct,
                hotWarmPct: null,
            };
        }
        if (!n) return { total: null, avgScore: null, hotLeadRatePct: null, hotWarmPct: null };
        const sum = samples.reduce((s, r) => s + (Number(r.score) || 0), 0);
        const hot = samples.filter((r) => r.tier === 'Hot' || String(r.category || '').includes('Hot')).length;
        const warm = samples.filter((r) => r.tier === 'Warm' || (String(r.category || '').includes('Warm') && !String(r.category || '').includes('Hot'))).length;
        return {
            total: n,
            avgScore: Math.round((sum / n) * 10) / 10,
            hotLeadRatePct: Math.round((hot / n) * 1000) / 10,
            hotWarmPct: Math.round(((hot + warm) / n) * 1000) / 10,
        };
    }, [leadSamples, qualityResult]);

    const highIntentFollowups = useMemo(() => {
        const samples = leadSamples;
        return samples.filter((r) => {
            const c = String(r.category || '');
            return c.includes('Hot') || c.includes('Warm');
        }).length;
    }, [leadSamples]);

    const combinedAiInsightText = useMemo(() => {
        const first = insights[0];
        if (first?.text) return first.text;
        if (recommendations[0]?.justification) return recommendations[0].justification;
        return saturationResult?.message || '';
    }, [insights, recommendations, saturationResult]);

    const predictionSnippet = useMemo(() => {
        const rec = recommendations.find((r) => /cpl|₹|target/i.test(r.justification || r.title || ''));
        return rec?.justification || recommendations[0]?.justification || '';
    }, [recommendations]);

    const lastAnalysedLabel = useMemo(() => {
        if (!lastAnalysedAt) return '—';
        const diff = Math.floor((Date.now() - lastAnalysedAt.getTime()) / 60000);
        if (diff < 1) return 'just now';
        if (diff < 60) return `${diff} min ago`;
        const h = Math.floor(diff / 60);
        return `${h}h ago`;
    }, [lastAnalysedAt]);

    const suggestedQueries = useMemo(() => [
        'Why is CPL increasing?',
        'Which creative to pause?',
        'How to reach ₹600 CPL?',
        'Best audience segment?',
        'When will audience saturate?',
        'Best WhatsApp message today?',
        'How should I split budget across campaigns?',
        'Why did spend go up but leads drop?',
        'Which ad has the best hook rate vs CPL?',
        'Should I scale the top reel or double down on ads?',
        'How do I fix high CPM in the last 7 days?',
        'What to test next: creative, audience, or placement?',
        'How can I improve lead quality without raising CPL?',
        'Which lookalike or interest stack makes sense now?',
        'Is my funnel bottleneck awareness or conversion?',
        'What metrics should I watch daily vs weekly?',
        'How to refresh fatigued creatives safely?',
        'Compare Reels vs ad creatives for cost per lead.',
        'What’s a realistic CPL target for my niche?',
        'How much should I increase budget after a winning ad?',
        'When should I kill an ad vs let it learn?'
    ], []);

    const fatigueCreativeInsight = useMemo(() => {
        const list = fatigueResult?.creatives || [];
        const worst = [...list].sort((a, b) => (b.fatigue_score ?? b.score ?? 0) - (a.fatigue_score ?? a.score ?? 0))[0];
        const st = (worst?.status || '').toLowerCase();
        if (worst && (st === 'severe' || st === 'fatigued')) {
            return `“${worst.ad_name || 'An ad'}” is ${worst.status} (score ${worst.fatigue_score ?? worst.score ?? '—'}). MHS: refresh hook, creative, or angle; pause if severe.`;
        }
        const sorted = [...list].sort((a, b) => (a.cpl || 0) - (b.cpl || 0));
        const best = sorted.find((c) => (c.status || '').toLowerCase() === 'fresh');
        if (best && worst && best.ad_id !== worst.ad_id) {
            return `“${best.ad_name || 'A creative'}” is Fresh; watch Aging ads and run the weekly audit (CTR, hook, CPL vs first 7d, quality, days live).`;
        }
        return recommendations[0]?.justification || currentAd.reason || 'Score = CTR drop×0.4 + age pressure×0.4 + hook drop×0.2 (creative_state.md).';
    }, [fatigueResult, recommendations, currentAd]);

    const buildAskContext = useCallback(() => {
        const reel = reelForCard;
        return {
            dateRange: resolvedInsightsRange,
            activePeriod: periodLabel,
            // Rich campaign data for the selected date range — drives filter-aware Ask AI answers
            campaignSummary: filteredAdsSummary ?? null,
            bestAd: {
                name: currentAd?.name,
                spend: currentAd?.spend,
                leads: currentAd?.leads,
                cpl: currentAd?.cpl,
                reason: currentAd?.reason,
                action: currentAd?.action
            },
            bestReel: reel
                ? {
                    name: reel.name,
                    headlineLine: reel.headlineLine,
                    subtitle: reel.subtitle,
                    thumbnail_url: reel.thumbnail_url,
                    permalink: reel.permalink,
                    reach: reel.reach,
                    views: reel.views,
                    engagements: reel.engagements,
                    saves: reel.saves,
                    hookRate: reel.hookRate,
                    engagementRatePct: reel.engagementRatePct,
                    video_avg_time_watched: reel.video_avg_time_watched,
                    reason: reel.reason,
                    performanceSummary: reelPerfSummary
                }
                : null,
            insights: (insights || []).slice(0, 6).map((i) => ({
                type: i.type,
                timeWindow: i.timeWindow,
                text: i.text,
                action: i.action
            })),
            recommendations: (recommendations || []).slice(0, 4).map((r) => ({
                title: r.title,
                justification: r.justification
            })),
            leadSaturation: saturationResult
                ? {
                    level: saturationResult.saturationLevel,
                    message: saturationResult.message,
                    summary: saturationResult.summary
                        ? {
                            total: saturationResult.summary.total,
                            saturated: saturationResult.summary.saturated,
                            warning: saturationResult.summary.warning,
                            healthy: saturationResult.summary.healthy,
                            saturation_index_avg: saturationResult.summary.saturation_index_avg
                        }
                        : null
                }
                : null,
            creativeFatigue: fatigueResult?.summary ?? null,
            leadQuality: qualityResult?.summary ?? null
        };
    }, [
        resolvedInsightsRange,
        periodLabel,
        filteredAdsSummary,
        currentAd,
        reelForCard,
        reelPerfSummary,
        insights,
        recommendations,
        saturationResult,
        fatigueResult,
        qualityResult
    ]);

    const handleAskSubmit = useCallback(async (e) => {
        e?.preventDefault?.();
        const q = String(askInput || '').trim();
        if (!q) {
            setAskHint('');
            setAskAnswer('');
            setAskError('Type a question first.');
            return;
        }
        setAskHint('');
        setAskAnswer('');
        setAskError('');
        setAskLoading(true);
        try {
            const token = getAuthToken();
            const headers = { 'Content-Type': 'application/json' };
            if (token) headers['Authorization'] = `Bearer ${token}`;
            const res = await fetchJsonWithTimeout(
                `${API_BASE}/api/ai/ask`,
                {
                    method: 'POST',
                    headers,
                    body: JSON.stringify({
                        question: q,
                        context: buildAskContext()
                    })
                },
                ASK_AI_FETCH_TIMEOUT_MS
            );
            const json = await res.json().catch(() => ({}));
            if (!res.ok) {
                setAskError(json.details || json.error || res.statusText || 'Could not get an answer.');
                return;
            }
            if (json.success && json.answer) {
                setAskAnswer(String(json.answer));
            } else {
                setAskError(json.error || 'No answer returned.');
            }
        } catch (err) {
            if (err?.name === 'AbortError') {
                setAskError(
                    'Timed out waiting for the AI — not because your question was too long. The backend or Gemini was slow or unreachable. Confirm the API server is running (restart locally or redeploy), then try again.'
                );
            } else {
                setAskError(err.message || 'Network error');
            }
        } finally {
            setAskLoading(false);
        }
    }, [askInput, buildAskContext]);

    const creativeStatusClass = (status) => {
        const s = (status || '').toLowerCase();
        if (s === 'severe') return 'crit';
        if (s === 'fatigued') return 'warn';
        if (s === 'aging') return 'aging';
        return 'fresh';
    };

    const creativeStatusLabel = (status) => status || '—';

    const scrollToId = (id) => {
        const el = document.getElementById(id);
        el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };

    const allLeadScoringRows = qualityResult?.samples ?? qualityScores;

    const sortRows = (rows, field, dir) => {
        if (!field || !rows?.length) return rows ?? [];
        return [...rows].sort((a, b) => {
            const av = a[field] ?? (typeof a[field] === 'number' ? 0 : '');
            const bv = b[field] ?? (typeof b[field] === 'number' ? 0 : '');
            const cmp = typeof av === 'number' && typeof bv === 'number'
                ? av - bv
                : String(av).localeCompare(String(bv));
            return dir === 'desc' ? -cmp : cmp;
        });
    };

    const handleSort = (setter, field) => {
        setter(prev => ({ field, dir: prev.field === field && prev.dir === 'desc' ? 'asc' : 'desc' }));
    };

    const SortTh = ({ label, field, sort, setSort, align = 'left' }) => {
        const active = sort.field === field;
        return (
            <th className={align === 'right' ? 'text-end' : ''} style={{ fontSize: '0.7rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px', whiteSpace: 'nowrap', cursor: 'pointer', userSelect: 'none' }} onClick={() => handleSort(setSort, field)}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '3px', justifyContent: align === 'right' ? 'flex-end' : 'flex-start', width: '100%' }}>
                    {label}
                    <span style={{ display: 'inline-flex', flexDirection: 'column', fontSize: '0.5rem', lineHeight: '0.65', marginLeft: '2px' }}>
                        <span style={{ color: active && sort.dir === 'asc'  ? '#2563eb' : '#9ca3af', opacity: active && sort.dir === 'asc'  ? 1 : 0.5 }}>▲</span>
                        <span style={{ color: active && sort.dir === 'desc' ? '#2563eb' : '#9ca3af', opacity: active && sort.dir === 'desc' ? 1 : 0.5, marginTop: '-2px' }}>▼</span>
                    </span>
                </span>
            </th>
        );
    };

    const sortedSatCampaigns = sortRows(saturationResult?.campaigns, satSort.field, satSort.dir);
    const sortedFatCreatives = sortRows(fatigueResult?.creatives, fatSort.field, fatSort.dir);
    const sortedLeadRows     = sortRows(allLeadScoringRows, leadSort.field, leadSort.dir);
    const leadScoringRows    = sortedLeadRows.slice(0, 50);

    const downloadLeadsCSV = () => {
        const headers = ['Date & Time', 'Lead', 'Phone Number', 'Sugar Segment', 'Sugar Poll', 'Score', 'Tier', 'Category', 'Next Action'];
        const rows = allLeadScoringRows.map(r => [
            r.date_time ?? r.score_breakdown?.date_time ?? r.created_at ?? '—',
            r.name || '—',
            r.phone || '—',
            r.sugar_segment ?? r.score_breakdown?.sugar_segment ?? '—',
            r.sugar_poll ?? r.score_breakdown?.sugar_poll ?? '—',
            r.score ?? '—',
            inferLeadTierFromRow(r),
            r.category || '—',
            r.action_timing || mhsLeadTierActionTiming(inferLeadTierFromRow(r)),
        ].map(v => `"${String(v).replace(/"/g, '""')}"`));
        const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
        const blob = new Blob([csv], { type: 'text/csv' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'lead-intelligence-scoring.csv';
        a.click();
        setLeadDownloadOpen(false);
    };

    const downloadLeadsExcel = async () => {
        const ExcelJS = (await import('exceljs')).default;
        const wb = new ExcelJS.Workbook();
        const ws = wb.addWorksheet('Lead Scoring');
        ws.columns = [
            { header: 'Date & Time', key: 'date_time', width: 20 },
            { header: 'Lead', key: 'name', width: 24 },
            { header: 'Phone Number', key: 'phone', width: 18 },
            { header: 'Sugar Segment', key: 'sugar_segment', width: 16 },
            { header: 'Sugar Poll', key: 'sugar_poll', width: 12 },
            { header: 'Score', key: 'score', width: 8 },
            { header: 'Tier', key: 'tier', width: 10 },
            { header: 'Category', key: 'category', width: 12 },
            { header: 'Next Action', key: 'next_action', width: 32 },
        ];
        ws.getRow(1).font = { bold: true };
        allLeadScoringRows.forEach(r => ws.addRow({
            date_time: r.date_time ?? r.score_breakdown?.date_time ?? r.created_at ?? '—',
            name: r.name || '—',
            phone: r.phone || '—',
            sugar_segment: r.sugar_segment ?? r.score_breakdown?.sugar_segment ?? '—',
            sugar_poll: r.sugar_poll ?? r.score_breakdown?.sugar_poll ?? '—',
            score: r.score ?? '—',
            tier: inferLeadTierFromRow(r),
            category: r.category || '—',
            next_action: r.action_timing || mhsLeadTierActionTiming(inferLeadTierFromRow(r)),
        }));
        const buf = await wb.xlsx.writeBuffer();
        const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'lead-intelligence-scoring.xlsx';
        a.click();
        setLeadDownloadOpen(false);
    };

    return (
        <div className={`ai-insights-v2${loading ? ' ai-insights-v2--loading' : ''}`}>
            <header className="ai2-hero">
                <div className="ai2-hero-text">
                    <div className="ai2-hero-title-row">
                        <h1 className="ai2-title">AI Insights</h1>
                        <span className="ai2-pill ai2-pill-live">
                            <span className="ai2-pill-dot" aria-hidden />
                            Live Analysis
                        </span>
                    </div>
                    <p className="ai2-sub">
                        Real-time intelligence across your lead funnel, creative performance, and marketing strategy.
                        <span className="ai2-sub-muted"> Last analysed {lastAnalysedLabel}.</span>
                    </p>
                </div>
                <div className="ai2-hero-actions">
                    <div className="ai2-date-preset-wrap" ref={datePresetWrapRef}>
                        <button
                            type="button"
                            className="ai2-date-preset-trigger"
                            title="Analysis period"
                            aria-expanded={datePresetMenuOpen}
                            aria-haspopup="listbox"
                            onClick={() => {
                                setDatePresetMenuOpen((o) => {
                                    const next = !o;
                                    if (next && insightsDatePreset === 'custom' && customCommitted.from && customCommitted.to) {
                                        setCustomDraftFrom(customCommitted.from);
                                        setCustomDraftTo(customCommitted.to);
                                    }
                                    return next;
                                });
                            }}
                        >
                            <i className="fas fa-calendar-alt" aria-hidden />
                            <span className="ai2-date-preset-label">{insightsPresetLabel}</span>
                            <span className="ai2-date-preset-range">{headerDateRangeLabel}</span>
                            <i className={`fas fa-chevron-down ai2-date-preset-caret${datePresetMenuOpen ? ' ai2-date-preset-caret--open' : ''}`} aria-hidden />
                        </button>
                        {datePresetMenuOpen && (
                            <div className="ai2-date-preset-menu" role="listbox" aria-label="Date range">
                                {INSIGHTS_DATE_PRESET_OPTIONS.map((opt) => (
                                    <button
                                        key={opt.id}
                                        type="button"
                                        role="option"
                                        aria-selected={insightsDatePreset === opt.id}
                                        className={`ai2-date-preset-option${insightsDatePreset === opt.id ? ' ai2-date-preset-option--active' : ''}`}
                                        onClick={() => {
                                            setInsightsDatePreset(opt.id);
                                            if (SNAPSHOT_TIME_WINDOW_KEYS.includes(opt.id)) {
                                                setActiveTimeWindow(opt.id);
                                            }
                                            if (opt.id === 'custom') {
                                                const m = getDateRangeForPreset('last_30_days');
                                                setCustomDraftFrom(m.from);
                                                setCustomDraftTo(m.to);
                                                setCustomCommitted({ from: m.from, to: m.to });
                                            } else {
                                                setDatePresetMenuOpen(false);
                                            }
                                        }}
                                    >
                                        {opt.label}
                                    </button>
                                ))}
                                {insightsDatePreset === 'custom' && (
                                    <div className="ai2-date-custom-fields">
                                        <label className="ai2-date-custom-lbl">
                                            <span>From</span>
                                            <input
                                                type="date"
                                                className="ai2-date-custom-input"
                                                value={customDraftFrom}
                                                onChange={(e) => setCustomDraftFrom(e.target.value)}
                                            />
                                        </label>
                                        <label className="ai2-date-custom-lbl">
                                            <span>To</span>
                                            <input
                                                type="date"
                                                className="ai2-date-custom-input"
                                                value={customDraftTo}
                                                onChange={(e) => setCustomDraftTo(e.target.value)}
                                            />
                                        </label>
                                        <button
                                            type="button"
                                            className="ai2-date-custom-apply"
                                            disabled={!customDraftFrom || !customDraftTo || customDraftFrom > customDraftTo}
                                            onClick={() => {
                                                setCustomCommitted({ from: customDraftFrom, to: customDraftTo });
                                                setDatePresetMenuOpen(false);
                                            }}
                                        >
                                            Apply range
                                        </button>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                    <button
                        type="button"
                        className="ai2-btn-refresh"
                        onClick={() => fetchAIInsights(true)}
                        disabled={loading}
                    >
                        <i className="fas fa-sync-alt" />
                        {loading ? 'Refreshing…' : 'Refresh'}
                    </button>
                </div>
            </header>

            {loading && (
                <div className="ai2-loading" aria-busy="true">
                    <div className="ai2-loading-spinner" />
                    <p>{loadingPhase === 'ai' ? 'Generating AI insights…' : 'Loading ads & reels…'}</p>
                </div>
            )}

            {error && !loading && (
                error === 'BILLING_ERROR' ? (
                    <div className="ai2-banner" style={{ backgroundColor: '#fff7ed', borderColor: '#fdba74', color: '#92400e', display: 'flex', alignItems: 'flex-start', gap: '12px', padding: '16px 20px', borderRadius: '10px', border: '1px solid #fdba74', marginBottom: '16px' }}>
                        <i className="fas fa-exclamation-circle" style={{ fontSize: '1.2rem', marginTop: '2px', color: '#f97316' }} />
                        <div style={{ flex: 1 }}>
                            <strong style={{ display: 'block', marginBottom: '4px', fontSize: '0.95rem' }}>Google Gemini API — Quota Exceeded</strong>
                            <span style={{ fontSize: '0.85rem' }}>The Gemini API quota has been reached. Please check your Google AI Studio quota or try again later.</span>
                        </div>
                    </div>
                ) : (
                    <div className="ai2-banner ai2-banner-error">
                        <i className="fas fa-exclamation-triangle" />
                        <span>
                            {error}
                            {quotaRetrySeconds != null && quotaRetrySeconds > 0 && (
                                <span> Retry in {quotaRetrySeconds}s.</span>
                            )}
                        </span>
                        <button
                            type="button"
                            className="ai2-btn-ghost"
                            onClick={() => fetchAIInsights(false)}
                            disabled={quotaRetrySeconds != null && quotaRetrySeconds > 0}
                        >
                            Retry
                        </button>
                    </div>
                )
            )}

            <div className="ai2-grid-2">
                <section className="ai2-card" aria-labelledby="sat-card-title">
                    <div className="ai2-card-head">
                        <div className="ai2-card-head-icon ai2-icon-amber">
                            <i className="fas fa-lightbulb" />
                        </div>
                        <div className="ai2-card-head-text">
                            <h2 id="sat-card-title" className="ai2-card-title">Lead Saturation</h2>
                            <p className="ai2-card-sub">MHS index + Signal 4 (first-time impressions) + Signal 5 (CTR × frequency × CPM)</p>
                        </div>
                        <span className={`ai2-badge ai2-badge--${saturationStatusUi.tone}`}>{saturationStatusUi.label}</span>
                    </div>

                    <div className="ai2-sat-body">
                        <div className="ai2-donut-wrap" aria-hidden>
                            <div
                                className="ai2-donut"
                                style={{ '--pct': saturationIndexPct != null ? saturationIndexPct : 0 }}
                            />
                            <div className="ai2-donut-center">
                                <span className="ai2-donut-pct">{saturationIndexPct != null ? `${saturationIndexPct}%` : '—'}</span>
                                <span className="ai2-donut-lbl">Saturation Index</span>
                            </div>
                        </div>

                        <div className="ai2-bar-list">
                            {(saturationBars.length ? saturationBars : [
                                { label: 'Frequency', value: '—', pct: 0, tone: 'neutral' },
                                { label: 'Reach % of pool', value: '—', pct: 0, tone: 'neutral' },
                                { label: 'First-time impression share', value: '—', pct: 0, tone: 'neutral' },
                                { label: 'CPM vs prior week', value: '—', pct: 0, tone: 'neutral' },
                                { label: 'CTR drop vs prior', value: '—', pct: 0, tone: 'neutral' }
                            ]).map((row) => (
                                <div key={row.label} className="ai2-bar-row">
                                    <div className="ai2-bar-meta">
                                        <span>{row.label}</span>
                                        <span className="ai2-bar-val">{row.value}</span>
                                    </div>
                                    <div className="ai2-bar-track">
                                        <span className={`ai2-bar-fill ai2-bar-fill--${row.tone}`} style={{ width: `${Math.round(row.pct)}%` }} />
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    <p className="ai2-insight-copy">
                        {saturationResult?.message || (saturationLoading ? 'Running saturation analysis…' : 'We pull frequency, reach, first-time impression share, CPM, and CTR from Meta (current vs prior window), estimate audience from ad sets, compute the MHS Saturation Index (0–100), and classify Signal 5 (audience saturation vs creative fatigue vs full saturation). Yellow >60, red >80; first-time impressions below 30% confirms saturation per MHS.')}
                    </p>
                    {saturationError && (
                        <p className="ai2-inline-err">{saturationError}</p>
                    )}

                    <div className="ai2-card-foot">
                        <span>
                            {saturationResult?.summary
                                ? `${saturationResult.summary.saturated ?? 0} critical · ${saturationResult.summary.warning ?? 0} warning · ${saturationResult.summary.healthy ?? 0} healthy${saturationResult.summary.saturation_index_avg != null ? ` · avg index ${saturationResult.summary.saturation_index_avg}` : ''}`
                                : 'Red zone: expand geo or lookalikes + creative. Yellow: refresh creative first.'}
                        </span>
                        <button type="button" className="ai2-link-btn" onClick={() => scrollToId('ai2-detail-sat')}>
                            View details <i className="fas fa-arrow-right" />
                        </button>
                    </div>
                </section>

                <section className="ai2-card" aria-labelledby="fatigue-card-title">
                    <div className="ai2-card-head">
                        <div className="ai2-card-head-icon ai2-icon-red">
                            <i className="fas fa-exclamation-triangle" />
                        </div>
                        <div className="ai2-card-head-text">
                            <h2 id="fatigue-card-title" className="ai2-card-title">Creative Fatigue</h2>
                            <p className="ai2-card-sub">MHS score: CTR drop×0.4 + lifespan pressure×0.4 + hook drop×0.2</p>
                        </div>
                        <span className={`ai2-badge ai2-badge--${fatigueStatusUi.tone}`}>{fatigueStatusUi.label}</span>
                    </div>

                    <div className="ai2-metric-row3">
                        <div className="ai2-metric-box">
                            <span className="ai2-metric-k">CTR drop (avg)</span>
                            <span className="ai2-metric-v">
                                {fatigueAvgCtrDrop != null ? `-${fatigueAvgCtrDrop}%` : '—'}
                            </span>
                            <span className="ai2-metric-hint ai2-hint-bad">current vs prior window</span>
                        </div>
                        <div className="ai2-metric-box">
                            <span className="ai2-metric-k">Avg hook / watch</span>
                            <span className="ai2-metric-v">{hookSecondsDisplay}</span>
                            <span className="ai2-metric-hint">from best reel view</span>
                        </div>
                        <div className="ai2-metric-box">
                            <span className="ai2-metric-k">Fresh creatives</span>
                            <span className="ai2-metric-v">{freshCreativesCount}</span>
                            <span className={`ai2-metric-hint ${freshCreativesCount < 3 ? 'ai2-hint-warn' : ''}`}>Fresh (0–40)</span>
                        </div>
                    </div>

                    <ul className="ai2-creative-list">
                        {(topFatigueCreatives.length ? topFatigueCreatives.slice(0, 3) : [null, null, null]).map((c, i) => (
                            <li key={c?.ad_id || i} className="ai2-creative-li">
                                {c ? (
                                    <>
                                        <div className="ai2-creative-main">
                                            <span className="ai2-creative-name">{c.ad_name || c.ad_id}</span>
                                            <span className="ai2-creative-meta">
                                                CTR {typeof c.ctr === 'number' ? `${c.ctr.toFixed(2)}%` : '—'} · CPL {typeof c.cpl === 'number' ? fmtMoney(c.cpl) : '—'}
                                            </span>
                                        </div>
                                        <span className={`ai2-mini-badge ai2-mini-badge--${creativeStatusClass(c.status)}`}>
                                            {creativeStatusLabel(c.status)}
                                        </span>
                                    </>
                                ) : (
                                    <span className="ai2-creative-placeholder">{fatigueLoading ? 'Loading…' : 'No creatives in range'}</span>
                                )}
                            </li>
                        ))}
                    </ul>

                    <p className="ai2-insight-copy">{fatigueCreativeInsight}</p>
                    {fatigueError && <p className="ai2-inline-err">{fatigueError}</p>}

                    <div className="ai2-card-foot">
                        <span>
                            {fatigueResult?.summary
                                ? `Severe ${fatigueResult.summary.severe ?? 0} · Fatigued ${fatigueResult.summary.fatigued ?? 0} · Aging ${fatigueResult.summary.aging ?? 0} · Fresh ${fatigueResult.summary.fresh ?? 0}`
                                : 'Weekly audit: CTR >30%, hook <15%, CPL vs first 7d >40%, quality below avg, days >21, neg. feedback >0.1%.'}
                        </span>
                        <button type="button" className="ai2-link-btn" onClick={() => scrollToId('ai2-detail-fatigue')}>
                            Manage creatives <i className="fas fa-arrow-right" />
                        </button>
                    </div>
                </section>
            </div>

            <div className="ai2-grid-2 ai2-grid-2--mt">
                <section className="ai2-card" aria-labelledby="lead-intel-title">
                    <div className="ai2-card-head">
                        <div className="ai2-card-head-icon ai2-icon-blue">
                            <i className="fas fa-user" />
                        </div>
                        <div className="ai2-card-head-text">
                            <h2 id="lead-intel-title" className="ai2-card-title">Lead Intelligence</h2>
                            <p className="ai2-card-sub">MHS tiers: Hot 80+ · Warm 50–79 · Nurture 25–49 · Cold 0–24</p>
                        </div>
                        <span className={`ai2-pill ai2-pill-soft ${qualityLoading ? 'ai2-pill-animate' : ''}`}>
                            {qualityLoading ? 'Analysing' : 'Live'}
                        </span>
                    </div>

                    <div className="ai2-metric-row3">
                        <div className="ai2-metric-box">
                            <span className="ai2-metric-k">Scored leads</span>
                            <span className="ai2-metric-v">{leadIntelStats.total != null ? leadIntelStats.total : '—'}</span>
                            <span className="ai2-metric-hint ai2-hint-good">In selected window</span>
                        </div>
                        <div className="ai2-metric-box">
                            <span className="ai2-metric-k">Avg quality score</span>
                            <span className="ai2-metric-v">{leadIntelStats.avgScore != null ? `${leadIntelStats.avgScore}` : '—'}</span>
                            <span className="ai2-metric-hint">Benchmark {'>'}45 (doc)</span>
                        </div>
                        <div className="ai2-metric-box">
                            <span className="ai2-metric-k">Hot lead rate</span>
                            <span className="ai2-metric-v">{leadIntelStats.hotLeadRatePct != null ? `${leadIntelStats.hotLeadRatePct}%` : '—'}</span>
                            <span className="ai2-metric-hint ai2-hint-good">Target {'>'}25%</span>
                        </div>
                    </div>

                    <div className="ai2-seg-chart">
                        <p className="ai2-seg-title">MHS score tiers</p>
                        <div className="ai2-seg-bars">
                            {leadCategoryBars.length > 0 ? (
                                leadCategoryBars.map((seg) => (
                                    <div key={seg.key} className="ai2-seg-row">
                                        <span className="ai2-seg-label">{seg.short}</span>
                                        <div className="ai2-seg-track">
                                            <span className="ai2-seg-fill" style={{ width: `${seg.pct}%`, background: seg.color }} />
                                        </div>
                                        <span className="ai2-seg-pct">{seg.pct}%</span>
                                    </div>
                                ))
                            ) : (
                                <p className="ai2-muted">Run lead scoring or load stored scores to see segments.</p>
                            )}
                        </div>
                    </div>

                    <p className="ai2-insight-copy">
                        {combinedAiInsightText || 'Sugar poll points (40/30/20/10) + GHL/TagMango signals via Leads.lead_intel JSON. Hot = personal call within 2h; Warm = WhatsApp in 24h.'}
                    </p>
                    {qualityError && <p className="ai2-inline-err">{qualityError}</p>}

                    <div className="ai2-card-foot">
                        <span>{highIntentFollowups ? `${highIntentFollowups} high-intent leads in sample` : 'Run scoring to populate lead intelligence'}</span>
                        <button type="button" className="ai2-link-btn" onClick={() => scrollToId('ai2-detail-leads')}>
                            View segments <i className="fas fa-arrow-right" />
                        </button>
                    </div>
                </section>

                <section className="ai2-card" aria-labelledby="ai-mkt-title">
                    <div className="ai2-card-head">
                        <div className="ai2-card-head-icon ai2-icon-violet">
                            <i className="fas fa-gem" />
                        </div>
                        <div className="ai2-card-head-text">
                            <h2 id="ai-mkt-title" className="ai2-card-title">AI Marketing Intelligence</h2>
                            <p className="ai2-card-sub">Strategic recommendations &amp; predictions</p>
                        </div>
                        <span className="ai2-pill ai2-pill-actions">{recommendations.length} Actions</span>
                    </div>

                    <div className="ai2-action-list">
                        {recommendations.length === 0 && (
                            <p className="ai2-muted">Insights appear after the AI step completes. Use Refresh if empty.</p>
                        )}
                        {recommendations.map((rec) => {
                            const tone = rec.color === 'red' ? 'orange' : rec.color === 'green' ? 'green' : rec.color === 'purple' ? 'purple' : 'blue';
                            return (
                                <div key={rec.id} className={`ai2-action-item ai2-action-item--${tone}`}>
                                    <span className="ai2-action-ico" aria-hidden>{rec.icon}</span>
                                    <div>
                                        <div className="ai2-action-title">{rec.title}</div>
                                        <div className="ai2-action-body">{rec.justification}</div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>

                    <p className="ai2-prediction">
                        {predictionSnippet || 'Predicted CPL depends on creative refresh, audience expansion, and bid strategy — see recommendations above.'}
                    </p>

                    <div className="ai2-card-foot">
                        <span>{recommendations.length ? 'Execute actions above to move CPL toward target' : 'Full strategy refreshes with data sync'}</span>
                        <button type="button" className="ai2-link-btn" onClick={() => scrollToId('ai2-ask')}>
                            Full strategy report <i className="fas fa-arrow-right" />
                        </button>
                    </div>
                </section>
            </div>

            <section className="ai2-ask" id="ai2-ask" aria-labelledby="ask-title">
                <div className="ai2-ask-head">
                    <div className="ai2-card-head-icon ai2-icon-purple">
                        <i className="fas fa-comment-dots" />
                    </div>
                    <div>
                        <h2 id="ask-title" className="ai2-ask-title">Ask AI Anything</h2>
                        <p className="ai2-ask-sub">Ask about your funnel, CPL, audience, creatives or strategy.</p>
                    </div>
                </div>
                <form className="ai2-ask-form" onSubmit={handleAskSubmit}>
                    <input
                        type="text"
                        className="ai2-ask-input"
                        placeholder="e.g. Why is my CPL increasing this week?"
                        value={askInput}
                        onChange={(e) => setAskInput(e.target.value)}
                        disabled={askLoading}
                        aria-busy={askLoading}
                    />
                    <button type="submit" className="ai2-btn-ask" disabled={askLoading}>
                        <i className="fas fa-paper-plane" /> {askLoading ? 'Thinking…' : 'Ask AI'}
                    </button>
                </form>
                {askHint && <p className="ai2-ask-hint">{askHint}</p>}
                {askLoading && !askHint && <p className="ai2-ask-hint ai2-ask-hint--muted">Getting an answer…</p>}
                {askError && <p className="ai2-ask-error" role="alert">{askError}</p>}
                {askAnswer && (
                    <div className="ai2-ask-response" role="region" aria-label="AI answer">
                        {askAnswer}
                    </div>
                )}
                <div className="ai2-suggest">
                    {suggestedQueries.map((q) => (
                        <button key={q} type="button" className="ai2-suggest-pill" onClick={() => { setAskInput(q); }}>
                            {q}
                        </button>
                    ))}
                </div>
            </section>

            <details className="ai2-details">
                <summary>Performance snapshot · ads &amp; reels ({periodLabel})</summary>
                <div className="ai2-time-tabs">
                    {SNAPSHOT_TIME_WINDOW_KEYS.map((k) => (
                        <button
                            key={k}
                            type="button"
                            className={`ai2-time-tab ${activeTimeWindow === k ? 'active' : ''}`}
                            onClick={() => {
                                                setActiveTimeWindow(k);
                                                setInsightsDatePreset(k);
                                            }}
                        >
                            {periodLabels[k]}
                        </button>
                    ))}
                </div>
                <div className="ai2-perf-mini-grid">
                    <div className="ai2-perf-mini ai2-perf-mini--ad">
                        <h3>Best ad</h3>
                        <p className="ai2-perf-name">{currentAd.name}</p>
                        {(currentAd.dateStart || currentAd.dateStop) && (
                            <p className="ai2-perf-dates">
                                {fmtDate(currentAd.dateStart)} — {fmtDate(currentAd.dateStop)}
                            </p>
                        )}
                        <p className="ai2-perf-meta">{fmtMoney(currentAd.spend)} spend · {fmtInt(currentAd.leads)} leads · {fmtMoney(currentAd.cpl)} CPL</p>
                        <p className="ai2-perf-reason">{currentAd.reason}</p>
                    </div>
                    <div className="ai2-perf-mini ai2-perf-mini--reel">
                            <h3>Best reel</h3>
                            <div className="ai2-perf-reel-row">
                                {reelForCard?.thumbnail_url ? (
                                    reelForCard.permalink ? (
                                        <a
                                            href={reelForCard.permalink}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="ai2-perf-reel-thumb-wrap"
                                            aria-label="Open reel on Instagram"
                                        >
                                            <img src={reelForCard.thumbnail_url} alt="" className="ai2-perf-reel-thumb" loading="lazy" />
                                        </a>
                                    ) : (
                                        <span className="ai2-perf-reel-thumb-wrap">
                                            <img src={reelForCard.thumbnail_url} alt="" className="ai2-perf-reel-thumb" loading="lazy" />
                                        </span>
                                    )
                                ) : null}
                                <div className="ai2-perf-reel-body">
                                    <p className="ai2-perf-name ai2-perf-reel-headline">{reelForCard?.headlineLine || reelForCard?.name || '—'}</p>
                                    {reelForCard?.subtitle
                                    && !String(reelForCard.headlineLine || '').includes(String(reelForCard.subtitle).trim()) ? (
                                        <p className="ai2-perf-reel-sub">{reelForCard.subtitle}</p>
                                    ) : null}
                                    {reelForCard?.timestamp && (
                                        <p className="ai2-perf-dates">{fmtDateTime(reelForCard.timestamp)}</p>
                                    )}
                                    {!reelForCard?.timestamp && activeTimeWindow === 'today' && reelForCard?.hideReelPublishTime && (currentAd?.dateStart || currentAd?.dateStop) && (
                                        <p className="ai2-perf-dates">
                                            Snapshot day (same as Best ad): {fmtDate(currentAd.dateStart || currentAd.dateStop)}
                                            {currentAd.dateStop && currentAd.dateStop !== currentAd.dateStart ? ` — ${fmtDate(currentAd.dateStop)}` : ''}
                                        </p>
                                    )}
                                    {!reelForCard?.timestamp && snapshotRollingLabelPeriod && reelForCard?.hideReelPublishTime && snapshotRollingLabelPeriod.from && snapshotRollingLabelPeriod.to && (
                                        <p className="ai2-perf-dates">
                                            Period: {fmtDate(snapshotRollingLabelPeriod.from)} — {fmtDate(snapshotRollingLabelPeriod.to)}
                                        </p>
                                    )}
                                    <p className="ai2-perf-meta">
                                        {reelForCard?.hookRate != null && reelForCard.hookRate > 0
                                            ? `Hook ${Math.round(Number(reelForCard.hookRate))}% · `
                                            : ''}
                                        {fmtReach(reelForCard?.views || reelForCard?.reach || 0)} views
                                    </p>
                                    <p className="ai2-perf-reel-summary">{reelPerfSummary}</p>
                                    {displayReelFlags.length > 0 && (
                                        <div className="ai2-reel-flag-row">
                                            {displayReelFlags.map((f) => (
                                                <span key={f} className="ai2-mini-pill" style={{ background: flagColors[f] }}>
                                                    <i className={`fas ${flagIcons[f]}`} /> {flagLabels[f]}
                                                </span>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </div>
                    </div>
                </div>
            </details>

            {reelAnalysis && (
                <details className="ai2-details">
                    <summary>Reel intelligence (trending, repost, rising)</summary>
                    <div className="ai2-reel-intel-compact">
                        {['trending_reels', 'repost_recommended', 'rising_reels'].map((key) => (
                            <div key={key} className="ai2-reel-col">
                                <h4>{key.replace(/_/g, ' ')}</h4>
                                <ul>
                                    {(reelAnalysis[key] || []).slice(0, 3).map((reel, i) => (
                                        <li key={i}>{reel.name} · {fmtReach(reel.views)} views</li>
                                    ))}
                                </ul>
                            </div>
                        ))}
                    </div>
                </details>
            )}

            <div className="ai2-insights-feed" id="ai2-strategy-feed">
                <h3 className="ai2-h3">AI insight feed</h3>
                <div className="ai2-feed-list">
                    {insights.map((insight) => (
                        <div key={insight.id} className={`ai2-feed-card ai2-feed-card--${insight.category || 'info'}`}>
                            <div className="ai2-feed-head">
                                <span>{insight.type}</span>
                                <span className="ai2-feed-tw">{insight.timeWindow}</span>
                            </div>
                            <p>{insight.text}</p>
                            <div className="ai2-feed-action">{insight.action}</div>
                        </div>
                    ))}
                </div>
            </div>

            <div id="ai2-detail-sat" className="ai2-analysis-card">
                <div className="ai2-analysis-card-header">
                    <strong className="ai2-analysis-card-title">
                        <span style={{ fontSize: '1.1rem' }}>📉</span> Lead Saturation · Campaigns
                    </strong>
                    <div className="d-flex align-items-center gap-2 flex-wrap">
                        {saturationResult?.campaigns?.length > 0 && (
                            <small className="ai2-analysis-card-meta">{saturationResult.campaigns.length} campaign(s)</small>
                        )}
                        <small className="ai2-analysis-card-meta">MHS index · Signal 4 · Signal 5</small>
                        <button type="button" className="ai2-btn-secondary" style={{ margin: 0 }} onClick={fetchLeadSaturation} disabled={saturationLoading}>
                            {saturationLoading ? <><i className="fas fa-spinner fa-spin" /> Analysing…</> : <><i className="fas fa-rotate-right" /> Re-run analysis</>}
                        </button>
                    </div>
                </div>
                {saturationResult?.campaigns?.length > 0 ? (
                    <>
                    <div className="ai2-scroll-table">
                        <table className="table table-hover align-middle mb-0" style={{ width: '100%', tableLayout: 'auto' }}>
                            <thead className="table-light" style={{ backgroundColor: 'var(--card, #f8f9fa)' }}>
                                <tr>
                                    <SortTh label="Ad Account"  field="ad_account_name"             sort={satSort} setSort={setSatSort} />
                                    <SortTh label="Campaign"    field="campaign_name"                sort={satSort} setSort={setSatSort} />
                                    <SortTh label="Freq"        field="frequency"                    sort={satSort} setSort={setSatSort} align="right" />
                                    <SortTh label="Freq Δ"      field="freq_wow_pct"                 sort={satSort} setSort={setSatSort} align="right" />
                                    <SortTh label="Reach %"     field="reach_pct"                    sort={satSort} setSort={setSatSort} align="right" />
                                    <SortTh label="Index"       field="saturation_index"             sort={satSort} setSort={setSatSort} align="right" />
                                    <SortTh label="CPM Δ"       field="cpm_wow_pct"                  sort={satSort} setSort={setSatSort} align="right" />
                                    <SortTh label="CTR Δ"       field="ctr_drop_pct"                 sort={satSort} setSort={setSatSort} align="right" />
                                    <SortTh label="1st Imp %"   field="first_time_impression_pct"    sort={satSort} setSort={setSatSort} align="right" />
                                    <SortTh label="Signal 5"    field="signal5_label"                sort={satSort} setSort={setSatSort} />
                                    <SortTh label="Days*"       field="days_until_saturation_adjusted" sort={satSort} setSort={setSatSort} align="right" />
                                    <SortTh label="CPL"         field="cpl"                          sort={satSort} setSort={setSatSort} align="right" />
                                    <SortTh label="Dup %"       field="duplicate_rate"               sort={satSort} setSort={setSatSort} align="right" />
                                    <SortTh label="Status"      field="status"                       sort={satSort} setSort={setSatSort} />
                                </tr>
                            </thead>
                            <tbody>
                                {sortedSatCampaigns.map((c, i) => {
                                    const statusLower = String(c.status || '').toLowerCase();
                                    const badgeClass = statusLower.includes('warn') ? 'ai2-badge-danger' : statusLower.includes('saturat') ? 'ai2-badge-warn' : 'ai2-badge-success';
                                    const idx = c.saturation_index != null ? Number(c.saturation_index) : (c.score != null ? Number(c.score) : null);
                                    const chipClass = idx == null ? '' : idx >= 70 ? 'ai2-chip-danger' : idx >= 40 ? 'ai2-chip-warn' : 'ai2-chip-success';
                                    return (
                                        <tr key={c.campaign_id || i} style={{ cursor: 'default' }}>
                                            <td className="text-muted small" title={c.ad_account_name?.trim() ? fmtAdAccountId(c.ad_account_id) : undefined}>
                                                {c.ad_account_name?.trim() || fmtAdAccountId(c.ad_account_id)}
                                            </td>
                                            <td className="fw-medium">{c.campaign_name || c.campaign_id}</td>
                                            <td className="text-end">{typeof c.frequency === 'number' ? c.frequency.toFixed(2) : '—'}</td>
                                            <td className="text-end">{c.freq_wow_pct != null ? `${c.freq_wow_pct > 0 ? '+' : ''}${Number(c.freq_wow_pct).toFixed(0)}%` : '—'}</td>
                                            <td className="text-end">{c.reach_pct != null ? `${Number(c.reach_pct).toFixed(0)}%${c.reach_pct_is_estimated ? ' ~' : ''}` : '—'}</td>
                                            <td className="text-end">
                                                {idx != null ? <span className={`ai2-chip ${chipClass}`}>{idx.toFixed(0)}</span> : '—'}
                                            </td>
                                            <td className="text-end">{c.cpm_wow_pct != null ? `${c.cpm_wow_pct > 0 ? '+' : ''}${Number(c.cpm_wow_pct).toFixed(0)}%` : '—'}</td>
                                            <td className="text-end">{c.ctr_drop_pct != null ? `${Number(c.ctr_drop_pct).toFixed(0)}%` : '—'}</td>
                                            <td className="text-end">{c.first_time_impression_pct != null ? `${Number(c.first_time_impression_pct).toFixed(0)}%` : '—'}</td>
                                            <td title={c.signal5_fix || undefined}>{c.signal5_label || '—'}</td>
                                            <td className="text-end">{c.days_until_saturation_adjusted != null ? `${Math.round(c.days_until_saturation_adjusted)}${c.days_is_estimated ? ' ~' : ''}` : '—'}</td>
                                            <td className="text-end fw-medium">{typeof c.cpl === 'number' ? fmtMoney(c.cpl) : '—'}</td>
                                            <td className="text-end">{typeof c.duplicate_rate === 'number' ? `${c.duplicate_rate.toFixed(1)}%` : '—'}</td>
                                            <td><span className={`ai2-badge ${badgeClass}`}>{c.status}</span></td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                    <p className="ai2-muted ai2-table-footnote mt-2 mb-0" style={{ fontSize: '0.72rem' }}>
                        *Days = (15% × audience) ÷ daily reach ÷ 3.5. Values marked <strong>~</strong> use frequency-band heuristics.
                        {' '}<strong>Signal 4</strong>: first-time imp % below 30% = saturated.
                        {' '}<strong>Signal 5</strong>: hover cell for fix.
                    </p>
                    </>
                ) : (
                    <div className="text-center py-4" style={{ color: '#64748b' }}>
                        <p className="mb-0 small">Run analysis to see saturation data for your campaigns.</p>
                    </div>
                )}
            </div>

            <div id="ai2-detail-fatigue" className="ai2-analysis-card">
                <div className="ai2-analysis-card-header">
                    <strong className="ai2-analysis-card-title">
                        <span style={{ fontSize: '1.1rem' }}>🔥</span> Creative Fatigue · Ads
                    </strong>
                    <div className="d-flex align-items-center gap-2 flex-wrap">
                        {fatigueResult?.creatives?.length > 0 && (
                            <small className="ai2-analysis-card-meta">{fatigueResult.creatives.length} ad(s)</small>
                        )}
                        <small className="ai2-analysis-card-meta">CTR drop×0.4 + lifespan×0.4 + hook×0.2</small>
                        <button type="button" className="ai2-btn-secondary" style={{ margin: 0 }} onClick={fetchCreativeFatigue} disabled={fatigueLoading}>
                            {fatigueLoading ? <><i className="fas fa-spinner fa-spin" /> Analysing…</> : <><i className="fas fa-rotate-right" /> Re-run analysis</>}
                        </button>
                    </div>
                </div>
                {fatigueResult?.creatives?.length > 0 ? (
                    <>
                    <div className="ai2-scroll-table">
                        <table className="table table-hover align-middle mb-0" style={{ width: '100%', tableLayout: 'auto' }}>
                            <thead className="table-light">
                                <tr>
                                    <SortTh label="Ad Account"  field="ad_account_name"          sort={fatSort} setSort={setFatSort} />
                                    <SortTh label="Creative"    field="ad_name"                   sort={fatSort} setSort={setFatSort} />
                                    <SortTh label="Freq"        field="frequency"                 sort={fatSort} setSort={setFatSort} align="right" />
                                    <SortTh label="Hook %"      field="hook_rate"                 sort={fatSort} setSort={setFatSort} align="right" />
                                    <SortTh label="CTR %"       field="ctr"                       sort={fatSort} setSort={setFatSort} align="right" />
                                    <SortTh label="CTR Δ"       field="ctr_drop_pct"              sort={fatSort} setSort={setFatSort} align="right" />
                                    <SortTh label="CPL"         field="cpl"                       sort={fatSort} setSort={setFatSort} align="right" />
                                    <SortTh label="1st7 Δ"      field="cpl_increase_first7_pct"   sort={fatSort} setSort={setFatSort} align="right" />
                                    <SortTh label="Score"       field="fatigue_score"             sort={fatSort} setSort={setFatSort} align="right" />
                                    <SortTh label="Audit"       field="weekly_audit_count"        sort={fatSort} setSort={setFatSort} align="right" />
                                    <SortTh label="Status"      field="status"                    sort={fatSort} setSort={setFatSort} />
                                </tr>
                            </thead>
                            <tbody>
                                {sortedFatCreatives.map((c, i) => {
                                    const auditKeys = c.weekly_audit ? Object.entries(c.weekly_audit).filter(([, v]) => v).map(([k]) => k).join(', ') : '';
                                    const rawScore = c.fatigue_score != null ? Number(c.fatigue_score) : (c.score != null ? Number(c.score) : null);
                                    const chipClass = rawScore == null ? '' : rawScore >= 100 ? 'ai2-chip-danger' : rawScore >= 70 ? 'ai2-chip-warn' : rawScore >= 40 ? 'ai2-chip-yellow' : 'ai2-chip-success';
                                    const statusLower = String(c.status || '').toLowerCase();
                                    const badgeClass = statusLower.includes('severe') ? 'ai2-badge-danger' : statusLower.includes('fatigue') ? 'ai2-badge-warn' : statusLower.includes('aging') ? 'ai2-badge-yellow' : 'ai2-badge-success';
                                    return (
                                        <tr key={c.ad_id || i} style={{ cursor: 'default' }}>
                                            <td className="text-muted small" title={c.ad_account_name?.trim() ? fmtAdAccountId(c.ad_account_id) : undefined}>
                                                {c.ad_account_name?.trim() || fmtAdAccountId(c.ad_account_id)}
                                            </td>
                                            <td className="fw-medium">{c.ad_name || c.ad_id}</td>
                                            <td className="text-end">{typeof c.frequency === 'number' ? c.frequency.toFixed(2) : '—'}</td>
                                            <td className="text-end" title={c.hook_signal_band || undefined}>{c.hook_rate != null ? `${Number(c.hook_rate).toFixed(1)}%` : '—'}</td>
                                            <td className="text-end">{typeof c.ctr === 'number' ? `${c.ctr.toFixed(2)}%` : '—'}</td>
                                            <td className="text-end">{c.ctr_drop_pct != null && c.ctr_drop_pct > 0 ? `${Number(c.ctr_drop_pct).toFixed(0)}%` : '—'}</td>
                                            <td className="text-end fw-medium">{typeof c.cpl === 'number' ? fmtMoney(c.cpl) : '—'}</td>
                                            <td className="text-end">{c.cpl_increase_first7_pct != null && c.cpl_increase_first7_pct > 0 ? `+${Number(c.cpl_increase_first7_pct).toFixed(0)}%` : '—'}</td>
                                            <td className="text-end">
                                                {rawScore != null ? <span className={`ai2-chip ${chipClass}`}>{rawScore.toFixed(1)}</span> : '—'}
                                            </td>
                                            <td className="text-end" title={auditKeys || undefined}>{c.weekly_audit_count ?? 0}</td>
                                            <td><span className={`ai2-badge ${badgeClass}`}>{creativeStatusLabel(c.status)}</span></td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                    <p className="ai2-muted ai2-table-footnote mt-2 mb-0" style={{ fontSize: '0.72rem' }}>
                        Score bands: Fresh 0–40 · Aging 40–70 · Fatigued 70–100 · Severe 100+. Audit = weekly checklist flags (hover for keys).
                    </p>
                    </>
                ) : (
                    <div className="text-center py-4" style={{ color: '#64748b' }}>
                        <p className="mb-0 small">Run analysis to see creative fatigue data for your ads.</p>
                    </div>
                )}
            </div>

            <div id="ai2-detail-leads" className="ai2-analysis-card">
                <div className="ai2-analysis-card-header">
                    <strong className="ai2-analysis-card-title">
                        <span style={{ fontSize: '1.1rem' }}>🎯</span> Lead Intelligence · Scoring
                    </strong>
                    <div className="d-flex align-items-center gap-2 flex-wrap">
                        {qualityResult?.success && (() => {
                            const n = Math.max(qualityResult.scored ?? 0, qualityResult.samples?.length ?? 0);
                            const s = qualityResult.summary;
                            return n > 0 ? (
                                <small className="ai2-analysis-card-meta">
                                    {n} lead(s){s && typeof s.avg_score === 'number' ? ` · Avg ${s.avg_score} · Hot ${s.hot_lead_rate_pct ?? '—'}%` : ''}
                                </small>
                            ) : null;
                        })()}
                        <small className="ai2-analysis-card-meta">Sugar score · behavioural signals · tier</small>
                        <button type="button" className="ai2-btn-secondary" style={{ margin: 0 }} onClick={fetchLeadQuality} disabled={qualityLoading}>
                            {qualityLoading ? <><i className="fas fa-spinner fa-spin" /> Scoring…</> : <><i className="fas fa-rotate-right" /> Run scoring</>}
                        </button>
                        {allLeadScoringRows.length > 0 && (
                            <div ref={leadDownloadRef} style={{ position: 'relative' }}>
                                <button type="button" className="ai2-btn-secondary"
                                    onClick={() => setLeadDownloadOpen(o => !o)}
                                    style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '6px' }}>
                                    <i className="fas fa-download" /> Download <i className="fas fa-chevron-down" style={{ fontSize: '0.6rem' }} />
                                </button>
                                {leadDownloadOpen && (
                                    <div style={{ position: 'absolute', top: 'calc(100% + 4px)', right: 0, zIndex: 200, background: 'var(--card, #fff)', border: '1px solid rgba(0,0,0,0.1)', borderRadius: '8px', boxShadow: '0 4px 16px rgba(0,0,0,0.12)', minWidth: '185px', overflow: 'hidden' }}>
                                        <button type="button" onClick={downloadLeadsCSV}
                                            style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '100%', padding: '10px 16px', background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.83rem', color: 'var(--text, #374151)', textAlign: 'left' }}
                                            onMouseEnter={e => e.currentTarget.style.background = '#f3f4f6'} onMouseLeave={e => e.currentTarget.style.background = 'none'}>
                                            <i className="fas fa-file-csv" style={{ color: '#16a34a', width: '16px' }} /> Download as CSV
                                        </button>
                                        <button type="button" onClick={downloadLeadsExcel}
                                            style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '100%', padding: '10px 16px', background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.83rem', color: 'var(--text, #374151)', textAlign: 'left' }}
                                            onMouseEnter={e => e.currentTarget.style.background = '#f3f4f6'} onMouseLeave={e => e.currentTarget.style.background = 'none'}>
                                            <i className="fas fa-file-excel" style={{ color: '#15803d', width: '16px' }} /> Download as Excel
                                        </button>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </div>
                {(qualityScores.length > 0 || (qualityResult && qualityResult.samples?.length > 0)) ? (
                    <>
                    <div className="ai2-scroll-table">
                        <table className="table table-hover align-middle mb-0" style={{ width: '100%', tableLayout: 'auto' }}>
                            <thead className="table-light">
                                <tr>
                                    <SortTh label="Date & Time"   field="date_time"     sort={leadSort} setSort={setLeadSort} />
                                    <SortTh label="Lead"          field="name"          sort={leadSort} setSort={setLeadSort} />
                                    <SortTh label="Phone Number"  field="phone"         sort={leadSort} setSort={setLeadSort} />
                                    <SortTh label="Sugar Segment" field="sugar_segment" sort={leadSort} setSort={setLeadSort} />
                                    <SortTh label="Sugar Poll"    field="sugar_level"   sort={leadSort} setSort={setLeadSort} />
                                    <SortTh label="Score"         field="score"         sort={leadSort} setSort={setLeadSort} align="right" />
                                    <SortTh label="Tier"          field="tier"          sort={leadSort} setSort={setLeadSort} />
                                    <SortTh label="Category"      field="category"      sort={leadSort} setSort={setLeadSort} />
                                    <SortTh label="Next Action"   field="action_timing" sort={leadSort} setSort={setLeadSort} />
                                </tr>
                            </thead>
                            <tbody>
                                {leadScoringRows.map((r, i) => {
                                    const tier = inferLeadTierFromRow(r);
                                    const tierLower = String(tier || '').toLowerCase();
                                    const badgeClass = tierLower === 'hot' ? 'ai2-badge-danger' : tierLower === 'warm' ? 'ai2-badge-warn' : tierLower === 'nurture' ? 'ai2-badge-info' : 'ai2-badge-muted';
                                    const score = r.score ?? null;
                                    const chipClass = score == null ? '' : score >= 70 ? 'ai2-chip-success' : score >= 40 ? 'ai2-chip-warn' : 'ai2-chip-muted';
                                    return (
                                        <tr key={r.lead_id || r.phone || i} style={{ cursor: 'default' }}>
                                            <td className="text-muted small" style={{ whiteSpace: 'nowrap' }}>{(() => {
                                                const raw = r.date_time ?? r.score_breakdown?.date_time ?? r.created_at;
                                                if (!raw) return '—';
                                                const d = new Date(raw);
                                                if (isNaN(d)) return String(raw).slice(0, 16);
                                                return d.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
                                            })()}</td>
                                            <td className="fw-medium">{r.name || '—'}</td>
                                            <td className="text-muted small">{r.phone || '—'}</td>
                                            <td>{r.sugar_segment ?? r.score_breakdown?.sugar_segment ?? '—'}</td>
                                            <td className="text-muted small">{r.sugar_poll ?? r.score_breakdown?.sugar_poll ?? '—'}</td>
                                            <td className="text-end">
                                                {score != null ? <span className={`ai2-chip ${chipClass}`}>{score}</span> : '—'}
                                            </td>
                                            <td><span className={`ai2-badge ${badgeClass}`}>{tier}</span></td>
                                            <td>{r.category || '—'}</td>
                                            <td className="text-muted small">{r.action_timing || mhsLeadTierActionTiming(tier)}</td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                    <p className="ai2-muted ai2-table-footnote mt-2 mb-0" style={{ fontSize: '0.72rem' }}>
                        Sugar {'>'}250 = +40 · 180–250 = +30 · 126–180 = +20 · {'<'}126 = +10. Showing top 50 of {allLeadScoringRows.length} — download for all.
                    </p>
                    </>
                ) : (
                    <div className="text-center py-4" style={{ color: '#64748b' }}>
                        <p className="mb-0 small">Run scoring to see lead intelligence data.</p>
                    </div>
                )}
            </div>
        </div>
    );

}