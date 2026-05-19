/* eslint-disable no-unused-vars */
/* eslint-disable react-hooks/exhaustive-deps */
import React, { useEffect, useMemo, useState, useCallback, useRef } from "react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  PieChart,
  Pie,
  Cell,
  Legend,
  BarChart,
  Bar,
  ComposedChart,
  Line,
} from "recharts";
import { getCurrentTheme, setTheme } from "../utils/theme";
import { calculateFollowerGrowthRate } from "../utils/followerGrowthRate";
import MultiSelectFilter from "../components/MultiSelectFilter";
import DateRangeFilter from "../components/DateRangeFilter";
import { downloadCSV } from "../utils/csvExport";
import { PROJECT_ORDER, ALL_SPECIFIED_ACCOUNT_IDS, buildAdAccountsByProject, normalizeAccountId } from "../constants/projectAdAccounts";
import ExcelJS from 'exceljs';
import './Dashboards.css';

const COLORS = ["#4F46E5", "#06B6D4", "#10B981", "#F59E0B", "#EF4444"];

/** Meta Lead Form API raw field name -> display label (e.g. Sugar Poll) */
const FIELD_LABELS = {
  'what_is_your_sugar_level?_உங்கள்_சர்க்கரை_அளவு_என்ன?': 'Sugar Poll',
  'what_is_your_sugar_level': 'Sugar Poll',
  'sugar_level': 'Sugar Poll',
  'sugar_poll': 'Sugar Poll'
};
const getFieldLabel = (name) => (name != null && FIELD_LABELS[name] !== undefined) ? FIELD_LABELS[name] : name;

/** Content Marketing: page names shown in PAGE filter and in Followers vs Page chart when Instagram/Facebook is selected.
 *  Matching is trim + case-insensitive; add API variants (e.g. "Dr. Farmer") so all 4 pages appear. */
const CONTENT_MARKETING_PAGE_NAMES = [
  'Integfarms My Health School',
  'My Health School',
  'MHS Dental Care',
  'Doctor Farmer',
  'Dr. Farmer', // API may return this instead of "Doctor Farmer"
];

/** Download an Excel file from headers and rows (array of arrays). columnWidths: array of numbers. */
async function downloadExcelFromRows(headers, rows, sheetName, filename, columnWidths) {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet(sheetName);
  worksheet.addRows([headers, ...rows]);
  if (columnWidths?.length) {
    worksheet.columns = columnWidths.map((w) => ({ width: w }));
  }
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// Helper to transform Meta "actions" array -> object map
const transformActions = (actions = []) => {
  if (!Array.isArray(actions)) return {};
  const map = {};
  actions.forEach((a) => {
    map[a.action_type] = Number(a.value);
  });
  return map;
};

// Get numeric value for Hold Rate: from named array (e.g. video_play_actions?.[0]?.value) or from actions/action_values by action_type
const getActionValue = (row, actionType) => {
  if (!row) return 0;
  for (const arr of [row.actions, row.action_values]) {
    if (!Array.isArray(arr)) continue;
    const entry = arr.find((a) => a && a.action_type === actionType);
    if (entry != null && entry.value != null) return Number(entry.value) || 0;
  }
  return 0;
};

const getTopLevelActionValue = (row, key) => {
  if (!row || !key || !row[key] || !Array.isArray(row[key]) || row[key].length === 0) return 0;
  const v = row[key][0] && (row[key][0].value != null ? row[key][0].value : row[key][0]);
  return Number(v) || 0;
};

// Get value for one action type (e.g. video_p50_watched_actions) from row/aggs/values — for Hold Rate numerator
const getActionCountForKey = (row, aggs, values, key) => {
  const fromRow = getTopLevelActionValue(row, key) || getActionValue(row, key);
  if (fromRow > 0) return fromRow;
  const fromAggs = (aggs && aggs[key]) ? Number(aggs[key]) || 0 : 0;
  if (fromAggs > 0) return fromAggs;
  const fromValues = (values && values[key]) ? Number(values[key]) || 0 : 0;
  return fromValues > 0 ? fromValues : 0;
};

// Best available video completion (p100, p95, p75, p50, p25) so Hold Rate can show when Meta uses any of these
const getVideoCompletionCount = (row, aggs, values) => {
  const tryKeys = ['video_p100_watched_actions', 'video_p100_watched', 'video_p95_watched_actions', 'video_p95_watched', 'video_p75_watched_actions', 'video_p75_watched', 'video_p50_watched_actions', 'video_p50_watched', 'video_p25_watched_actions', 'video_p25_watched'];
  for (const key of tryKeys) {
    const v = getActionCountForKey(row, aggs, values, key);
    if (v > 0) return v;
  }
  return 0;
};

// Helper: safe number
const num = (v) => Number(v) || 0;

/**
 * KPI Hook Rate: prefer 3s views ÷ impressions; if Meta returns no 3s data (common), use video plays ÷ impressions
 * so the card matches video activity (same idea as the old video-performance KPI).
 */
const aggregateHookRatePct = (video3sViews, impressions, videoPlays) => {
  if (impressions <= 0) return 0;
  if (video3sViews > 0) return (video3sViews / impressions) * 100;
  if (videoPlays > 0) return (videoPlays / impressions) * 100;
  return 0;
};

/**
 * KPI Hold Rate from summed video fields — aligned with server enrichInsightsRow / per-ad fallback.
 */
const aggregateHoldRatePct = (t) => {
  const video3sViews = t.video3sViews || 0;
  const videoThruPlays = t.videoThruPlays || 0;
  const videoViews = t.videoViews || 0;
  const plays = t.videoPlays || 0;
  const videoP50Watched = t.videoP50Watched || 0;
  const videoP75Watched = t.videoP75Watched || 0;
  const videoP100Watched = t.videoP100Watched || 0;
  const holdNumerator =
    videoP50Watched > 0
      ? videoP50Watched
      : videoP75Watched > 0
        ? videoP75Watched
        : videoThruPlays > 0
          ? videoThruPlays
          : videoP100Watched;
  if (video3sViews > 0 && holdNumerator > 0) {
    return parseFloat(((holdNumerator / video3sViews) * 100).toFixed(2));
  }
  if (plays > 0 && videoP100Watched > 0) {
    return parseFloat(((videoP100Watched / plays) * 100).toFixed(2));
  }
  if (plays > 0 && videoThruPlays > 0) {
    return parseFloat(((videoThruPlays / plays) * 100).toFixed(2));
  }
  if (videoViews > 0 && videoThruPlays > 0) {
    return parseFloat(((videoThruPlays / videoViews) * 100).toFixed(2));
  }
  if (video3sViews > 0 && videoThruPlays >= 0) {
    return parseFloat(((videoThruPlays / video3sViews) * 100).toFixed(2));
  }
  if (video3sViews > 0 && videoViews > 0) {
    return parseFloat(Math.min(100, (videoViews / video3sViews) * 100).toFixed(2));
  }
  if (video3sViews > 0 && plays > 0) {
    return parseFloat(Math.min(100, (plays / video3sViews) * 100).toFixed(2));
  }
  return 0;
};

// Helper to get auth token
const getAuthToken = () => {
  try {
    const STORAGE_KEY = process.env.REACT_APP_STORAGE_KEY || "app_auth";
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const data = JSON.parse(stored);
      return data.token;
    }
  } catch (e) {
    console.error("Error getting token:", e);
  }
  return null;
};

const API_BASE = process.env.REACT_APP_API_BASE || 'http://localhost:4000';

// Fetch Google Sheets revenue metrics
const fetchSheetsMetrics = async () => {
  try {
    const token = getAuthToken();
    const headers = { "Content-Type": "application/json" };
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    const res = await fetch(`${API_BASE}/api/google-sheets/revenue-metrics`, { headers });
    
    if (!res.ok) {
      throw new Error(`Failed to fetch sheets metrics: ${res.statusText}`);
    }

    const data = await res.json();
    return {
      onlineConversion: data.onlineConversion || 0,
      offlineConversion: data.offlineConversion || 0,
      l1Revenue: data.l1Revenue || 0,
      l2Revenue: data.l2Revenue || 0,
      totalRevenue: data.totalRevenue || 0,
      organicLeads: data.organicLeads || 0,
      organicRevenue: data.organicRevenue || 0,
      error: data.error || null
    };
  } catch (error) {
    console.error("Error fetching Google Sheets metrics:", error);
    throw error;
  }
};

// Fetch Content Marketing revenue from Google Sheets
const fetchContentMarketingRevenue = async (dateRange, source) => {
  try {
    const token = getAuthToken();
    const headers = { "Content-Type": "application/json" };
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    // Build query parameters
    const params = new URLSearchParams();
    if (dateRange && dateRange.startDate) {
      params.append('from', dateRange.startDate);
    }
    if (dateRange && dateRange.endDate) {
      params.append('to', dateRange.endDate);
    }
    if (source && Array.isArray(source) && source.length > 0) {
      // Use first source if multiple selected (or can be extended to support multiple)
      params.append('source', source[0]);
    } else if (source && typeof source === 'string' && source.trim() !== '') {
      params.append('source', source);
    }

    const queryString = params.toString();
    const url = `${API_BASE}/api/google-sheets/content-marketing-revenue${queryString ? `?${queryString}` : ''}`;
    
    const res = await fetch(url, { headers });
    
    if (!res.ok) {
      throw new Error(`Failed to fetch content marketing revenue: ${res.statusText}`);
    }

    const data = await res.json();
    return {
      organicLeads: data.organicLeads || 0,
      organicConversion: data.organicConversion || 0,
      l1Revenue: data.l1Revenue || 0,
      l2Revenue: data.l2Revenue || 0,
      totalRevenue: data.totalRevenue || 0,
      error: data.error || null
    };
  } catch (error) {
    console.error("Error fetching Content Marketing revenue:", error);
    throw error;
  }
};

// Fetch YouTube Ads / Google Ads insights (when Platform filter is YouTube)
const fetchYouTubeInsights = async (from, to) => {
  const token = getAuthToken();
  const headers = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(
    `${API_BASE}/api/youtube/insights?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
    { headers }
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.details || err.error || res.statusText);
  }
  return res.json();
};

// Fetch Instagram insights for multiple IG Business Accounts (Content Marketing Dashboard)
// Pass pageIds to resolve IG accounts from pages, or accountIds for direct IDs
const fetchInstagramInsights = async ({ pageIds, accountIds, from, to }) => {
  try {
    const token = getAuthToken();
    const headers = { "Content-Type": "application/json" };
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    const params = new URLSearchParams();
    if (pageIds && (Array.isArray(pageIds) ? pageIds.length : pageIds)) {
      params.append("pageIds", Array.isArray(pageIds) ? pageIds.join(",") : pageIds);
    }
    if (accountIds && Array.isArray(accountIds) && accountIds.length > 0) {
      params.append("accountIds", accountIds.join(","));
    }
    if (from) params.append("from", from);
    if (to) params.append("to", to);

    const url = `${API_BASE}/api/meta/instagram/insights?${params.toString()}`;
    const res = await fetch(url, { headers });

    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}));
      if (res.status === 401) {
        const error = new Error(errorData.details || errorData.error || "Authentication failed");
        error.isAuthError = true;
        throw error;
      }
      if (res.status === 403) {
        const error = new Error(errorData.details || errorData.error || "Permission denied");
        error.isPermissionError = true;
        throw error;
      }
      throw new Error(errorData.details || errorData.error || `Failed to fetch Instagram insights: ${res.statusText}`);
    }

    const json = await res.json();
    // Server returns the result at top level (totalFollows, totalViews, etc.), not under json.data
    const data = json.data ?? (json.totalFollows != null || json.totalViews != null ? json : null);
    return { data, error: json.error || null };
  } catch (error) {
    console.error("Error fetching Instagram insights:", error);
    throw error;
  }
};

// Fetch performance insights (page insights) for Content Marketing Dashboard
const fetchPerformanceInsights = async ({ pageId, from, to }) => {
  try {
    const token = getAuthToken();
    const headers = { "Content-Type": "application/json" };
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    // Build URL with query parameters (API expects 'from' and 'to')
    const params = new URLSearchParams();
    if (from) {
      params.append('from', from);
    }
    if (to) {
      params.append('to', to);
    }

    const queryString = params.toString();
    const url = `${API_BASE}/api/meta/pages/${pageId}/insights${queryString ? `?${queryString}` : ''}`;
    

    const res = await fetch(url, { headers });
    
    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}));
      const toMsg = (v) => (typeof v === 'string' ? v : (v?.error?.message ?? v?.message ?? (v && typeof v === 'object' ? JSON.stringify(v) : String(v ?? ''))));
      const errMsg = toMsg(errorData.details) || toMsg(errorData.error) || `Failed to fetch performance insights: ${res.statusText}`;

      if (res.status === 401) {
        const error = new Error(errMsg || "Authentication failed");
        error.isAuthError = true;
        throw error;
      }

      if (res.status === 403) {
        const error = new Error(errMsg || "Permission denied");
        error.isPermissionError = true;
        throw error;
      }

      throw new Error(errMsg);
    }

    const data = await res.json();
    
    // Return the data structure from the API
    return data.data || data;
  } catch (error) {
    console.error("Error fetching performance insights:", error);
    throw error;
  }
};

// Fetch insights from backend.
// When "Select All" is chosen for campaigns/ads, we send is_all_campaigns/is_all_ads and omit ID arrays
// so the backend does one aggregated call. Only send campaign_id/ad_id when user explicitly selected specific items.
const fetchDashboardData = async ({ days = 30, from = null, to = null, campaignIds = [], adIds = [], allCampaigns = false, allAds = false, adAccountId = null, useLive = false }) => {
  try {
    const token = getAuthToken();
    const headers = { "Content-Type": "application/json" };
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    // Build URL with date parameters
    let url = `${API_BASE}/api/meta/insights?time_increment=1`;

    if (from && to) {
      url += `&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
    }
    if (useLive) {
      url += '&live=1&refresh=1';
    }
    // #region agent log
    fetch('http://127.0.0.1:7244/ingest/a31de4bd-79e0-4784-8d49-20b7d56ddf12',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'Dashboards.jsx:fetchDashboardData',message:'insights request params',data:{from,to,campaignIds:campaignIds.slice(0,3),adIds:adIds.slice(0,3),allCampaigns,allAds,adAccountId,tzOffsetMin:new Date().getTimezoneOffset()},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'H1,H5'})}).catch(()=>{});
    // #endregion

    if (adAccountId) {
      url += `&ad_account_id=${encodeURIComponent(adAccountId)}`;
    }

    // Select All → omit IDs; send explicit flags so backend treats as aggregated (one call, no filter).
    if (allCampaigns) {
      url += '&is_all_campaigns=1';
      // Do not add campaign_id when "all" — never send full ID list.
    } else if (campaignIds.length > 0) {
      url += `&campaign_id=${encodeURIComponent(campaignIds.join(','))}`;
    }

    if (allAds) {
      url += '&is_all_ads=1';
      // Do not add ad_id when "all".
    } else if (adIds.length > 0) {
      url += `&ad_id=${encodeURIComponent(adIds.join(','))}`;
    }

    
    
    const res = await fetch(url, {
      headers,
    });

    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}));
      console.error("API error:", errorData);
      const details = errorData.details || errorData.error || res.statusText || "Failed to fetch insights";
      console.error("API error details:", details);
      throw new Error(details);
    }

    let data = await res.json();

    // Handle { data: [...] } structure from Meta API
    if (data && !Array.isArray(data) && Array.isArray(data.data)) {
      data = data.data;
    }

    if (!Array.isArray(data)) {
      console.error("API returned non-array:", data);
      return [];
    }

    // Log insights API response
    const sampleRecord = data[0];
    const dataLevel = sampleRecord?.ad_id ? "ad-level" : "campaign-level";
    const uniqueCampaignIds = [...new Set(data.map(r => r.campaign_id || r.campaign?.id).filter(Boolean))];
    console.log('[Insights API Response]', {
      rowCount: data.length,
      dataLevel: dataLevel,
      uniqueCampaignIds: uniqueCampaignIds.slice(0, 5),
    });
    
    // Normalize data
    return data.map((d) => {
      const aggs = transformActions(d.actions || []);
      const values = transformActions(d.action_values || []);
      // Match Meta Ads Manager "Leads (Form)" - include all known lead action types
      const leadCount = aggs['lead'] || aggs['leads'] || aggs['on_facebook_lead'] || aggs['onsite_conversion.lead_grouped'] || aggs['offsite_conversion.fb_pixel_lead'] || (Object.keys(aggs || {}).filter((k) => String(k).toLowerCase().includes('lead')).reduce((s, k) => s + (Number(aggs[k]) || 0), 0)) || 0;
      
      // Calculate conversions (purchase, complete_registration, etc.)
      const conversions = aggs['purchase'] || aggs['complete_registration'] || aggs['offsite_conversion.fb_pixel_purchase'] || 0;
      
      // Calculate CTR
      const impressions = num(d.impressions);
      const clicks = num(d.clicks);
      const ctr = impressions > 0 ? (clicks / impressions) * 100 : 0;
      
      // Calculate CPL
      const spend = num(d.spend);
      const cpl = leadCount > 0 ? spend / leadCount : 0;
      
      // Video metrics for Hook Rate and Hold Rate (p50/p75 work for ALL campaign types; ThruPlay only for Video Views)
      const videoViews = aggs['video_view'] || aggs['video_views'] || 0;
      // Prefer server-enriched / top-level Meta field — 3s views are often video_3_sec_watched_actions, not in actions[].
      const video3sViews =
        (d.video3sViews != null && d.video3sViews !== '')
          ? num(d.video3sViews)
          : getTopLevelActionValue(d, 'video_3_sec_watched_actions') ||
            getActionCountForKey(d, aggs, values, 'video_3_sec_watched_actions') ||
            aggs['video_view_3s'] ||
            aggs['video_views_3s'] ||
            aggs['video_view_3s_autoplayed'] ||
            aggs['video_views_3s_autoplayed'] ||
            aggs['video_3_sec_watched_actions'] ||
            aggs['video_continuous_2_sec_watched_actions'] ||
            aggs['video_15_sec_watched_actions'] ||
            0;
      const videoThruPlays = aggs['video_thruplay_watched_actions'] || aggs['video_thruplay'] || aggs['video_views_thruplay'] || 0;
      const videoP50Watched = getActionCountForKey(d, aggs, values, 'video_p50_watched_actions') || getActionCountForKey(d, aggs, values, 'video_p50_watched');
      const videoP75Watched = getActionCountForKey(d, aggs, values, 'video_p75_watched_actions') || getActionCountForKey(d, aggs, values, 'video_p75_watched');

      // Prefer server-enriched values when present (from insightsService.enrichInsightsRow), else compute client-side with same fallbacks as server
      const plays = (d.videoPlays != null && d.videoPlays !== '') ? num(d.videoPlays) : (getTopLevelActionValue(d, 'video_play_actions') || getTopLevelActionValue(d, 'video_play') || getTopLevelActionValue(d, 'video_view') || getActionValue(d, 'video_play_actions') || getActionValue(d, 'video_play') || getActionValue(d, 'video_view') || 0);
      const fullViews = (d.videoP100Watched != null && d.videoP100Watched !== '') ? num(d.videoP100Watched) : getVideoCompletionCount(d, aggs, values);
      const serverHoldRate = (d.hold_rate != null && d.hold_rate !== '') || (d.holdRate != null && d.holdRate !== '') ? num(d.hold_rate ?? d.holdRate) : null;
      let holdRate = serverHoldRate;
      if (holdRate == null || (typeof holdRate === 'number' && Number.isNaN(holdRate))) {
        holdRate = 0;
        const holdNumerator = videoP50Watched > 0 ? videoP50Watched : (videoP75Watched > 0 ? videoP75Watched : (videoThruPlays > 0 ? videoThruPlays : fullViews));
        if (video3sViews > 0 && holdNumerator > 0) {
          holdRate = parseFloat(((holdNumerator / video3sViews) * 100).toFixed(2));
        } else if (plays > 0 && fullViews > 0) {
          holdRate = parseFloat(((fullViews / plays) * 100).toFixed(2));
        } else if (plays > 0 && videoThruPlays > 0) {
          holdRate = parseFloat(((videoThruPlays / plays) * 100).toFixed(2));
        } else if (videoViews > 0 && videoThruPlays > 0) {
          holdRate = parseFloat(((videoThruPlays / videoViews) * 100).toFixed(2));
        } else if (video3sViews > 0 && videoThruPlays > 0) {
          // Fixed: was `>= 0` which is always true and always produced 0/N = 0
          holdRate = parseFloat(((videoThruPlays / video3sViews) * 100).toFixed(2));
        } else if (video3sViews > 0 && videoViews > 0) {
          holdRate = parseFloat((Math.min(100, (videoViews / video3sViews) * 100)).toFixed(2));
        } else if (video3sViews > 0 && plays > 0) {
          holdRate = parseFloat((Math.min(100, (plays / video3sViews) * 100)).toFixed(2));
        } else if (impressions > 0 && fullViews > 0) {
          // Fallback: p100 / impressions (works for all campaign types when video play data is absent)
          holdRate = parseFloat((Math.min(100, (fullViews / impressions) * 100)).toFixed(2));
        } else if (impressions > 0 && videoThruPlays > 0) {
          holdRate = parseFloat((Math.min(100, (videoThruPlays / impressions) * 100)).toFixed(2));
        }
      }

      // Hook Rate: 3s views / impressions; if Meta omits 3s, use plays / impressions (same as KPI aggregate)
      let hookRate = 0;
      if (d.hook_rate !== undefined && d.hook_rate !== null && d.hook_rate !== '') {
        hookRate = num(d.hook_rate);
      } else {
        hookRate = aggregateHookRatePct(video3sViews, impressions, plays);
      }

      return {
        campaign_id: d.campaign_id,
        campaign: d.campaign_name || "Unknown Campaign",
        ad_id: d.ad_id || null,
        ad_name: d.ad_name || "Unnamed Ad",
        date: d.date_start || d.date,
        spend: spend,
        impressions: impressions,
        clicks: clicks,
        leads: leadCount,
        conversions: conversions,
        ctr: ctr,
        cpl: cpl,
        hookRate: hookRate,
        holdRate: holdRate,
        videoPlays: plays,
        videoP100Watched: fullViews,
        videoP50Watched: videoP50Watched,
        videoP75Watched: videoP75Watched,
        videoViews: videoViews,
        video3sViews: video3sViews,
        videoThruPlays: videoThruPlays,
        actions: aggs,
        action_values: values,
        campaign_status: d.campaign_status || d.status || null,
        ad_status: d.ad_status || d.effective_status || null,
        lead_details: []
      };
    });
  } catch (e) {
    console.error("Failed to fetch dashboard data", e);
    return [];
  }
};

// Fetch insights from all ad accounts and combine into one dataset.
// Used when "All Ad Accounts" is selected so KPI cards show aggregated totals.
// Uses Promise.allSettled so one failing account does not block others; failed accounts are logged.
const fetchAllAccountsDashboardData = async ({ days, from, to, campaignIds, adIds, allCampaigns, allAds, accounts, useLive = false }) => {
  if (!accounts || accounts.length === 0) return [];
  try {
    const promises = accounts.map((account) =>
      fetchDashboardData({
        days,
        from,
        to,
        campaignIds,
        adIds,
        allCampaigns,
        allAds,
        adAccountId: account.account_id || account.id,
        useLive
      })
    );
    const settled = await Promise.allSettled(promises);
    const results = settled.map((s, i) => {
      if (s.status === 'fulfilled') return s.value;
      const acc = accounts[i];
      const name = acc?.account_name || acc?.name || acc?.account_id || acc?.id || 'unknown';
      console.warn(`[Dashboard] Ad account "${name}" failed:`, s.reason?.message || s.reason);
      return [];
    });
    return results.flat();
  } catch (e) {
    console.error("Failed to fetch multi-account dashboard data", e);
    return [];
  }
};

// Fetch Wix analytics from backend (normalized to same row shape as Meta insights).
// Returns { rows: [...], error?: string }. Rows have platform: 'wix'.
const fetchWixAnalytics = async ({ from, to }) => {
  if (!from || !to) return { rows: [], error: 'Missing date range' };
  try {
    const token = getAuthToken();
    const headers = { "Content-Type": "application/json" };
    if (token) headers["Authorization"] = `Bearer ${token}`;
    const url = `${API_BASE}/api/wix/analytics?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
    const res = await fetch(url, { headers });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (res.status === 503) return { rows: [], error: data.error || 'Wix not configured' };
      console.error("[Wix] API error:", res.status, data);
      return { rows: data.rows || [], error: data.error || data.details || `Request failed (${res.status})` };
    }
    if (Array.isArray(data)) return { rows: data };
    return { rows: data.rows || [], error: data.error || null };
  } catch (e) {
    console.error("Failed to fetch Wix analytics", e);
    return { rows: [], error: e.message || 'Failed to fetch Wix analytics' };
  }
};

// Fetch ad accounts from Meta API
// forceRefresh: when true, asks server to re-fetch from Meta (handles pagination, gets all accounts)
const fetchAdAccounts = async (forceRefresh = false) => {
  try {
    const token = getAuthToken();
    const headers = { "Content-Type": "application/json" };
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    } else {
      console.warn('[fetchAdAccounts] ⚠️ No token available - request may fail');
    }

    const url = `${API_BASE}/api/meta/ad-accounts${forceRefresh ? '?refresh=true' : ''}`;
    
    const res = await fetch(url, { headers });
    
    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}));
      console.error("[fetchAdAccounts] ❌ API error:", {
        status: res.status,
        statusText: res.statusText,
        errorData,
        fullError: errorData
      });
      console.error("[fetchAdAccounts] Possible reasons:");
      console.error("[fetchAdAccounts] - API endpoint /api/meta/ad-accounts does not exist");
      console.error("[fetchAdAccounts] - Access token invalid or expired");
      console.error("[fetchAdAccounts] - Missing permissions (ads_read, business_management)");
      return [];
    }

    const data = await res.json();
    
    if (Array.isArray(data)) {
      return data;
    }
    
    // If response is wrapped in { data: [...] }, extract it
    if (data && Array.isArray(data.data)) {
      return data.data;
    }
    
    console.warn("[fetchAdAccounts] ⚠️ Unexpected response format:", {
      data,
      dataType: typeof data,
      keys: data ? Object.keys(data) : 'null/undefined'
    });
    console.warn("[fetchAdAccounts] Expected: array or { data: [...] }");
    return [];
  } catch (e) {
    console.error("[fetchAdAccounts] ❌ Exception caught:", {
      name: e.name,
      message: e.message,
      stack: e.stack,
      fullError: e
    });
    return [];
  }
}

// Fetch business accounts from Meta API
const fetchBusinessAccounts = async () => {
  try {
    const token = getAuthToken();
    const headers = { "Content-Type": "application/json" };
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    const res = await fetch(`${API_BASE}/api/meta/businesses`, { headers });
    
    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}));
      console.error("[Frontend] API error fetching business accounts:", {
        status: res.status,
        statusText: res.statusText,
        errorData
      });
      
      // Handle permission errors gracefully
      if (res.status === 403 || errorData.isPermissionError) {
        console.warn("[Frontend] Permission error - business_management permission may be missing");
        return [];
      }
      
      return [];
    }

    const data = await res.json();
    // API returns { businesses: [...] }
    if (data && Array.isArray(data.businesses)) {
      return data.businesses;
    }
    
    console.warn("[Frontend] Unexpected response format for business accounts:", data);
    return [];
  } catch (e) {
    console.error("[Frontend] Error fetching business accounts:", e);
    return [];
  }
}

const fetchCampaigns = async (adAccountId = null) => {
  try {
    const token = getAuthToken();
    const headers = { "Content-Type": "application/json" };
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    let url = `${API_BASE}/api/meta/active-campaigns`;
    if (adAccountId) {
      url += `?ad_account_id=${encodeURIComponent(adAccountId)}`;
    }
    

    const res = await fetch(url, { headers });
    
    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}));
      console.error('[fetchCampaigns] API error:', {
        status: res.status,
        error: errorData
      });
      return [];
    }
    
    const data = await res.json();
    
    // Return full objects or empty array
    if (Array.isArray(data)) {
      return data; // Return full campaign objects
    } else if (data && Array.isArray(data.data)) {
      // Handle case where it might be wrapped in { data: [...] }
      return data.data;
    }
    return [];
  } catch (e) {
    console.error('[fetchCampaigns] Error:', e);
    return [];
  }
}

const fetchProjects = async () => {
  try {
    const token = getAuthToken();
    const headers = { "Content-Type": "application/json" };
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    // TODO: Replace with actual API endpoint when available
    // For now, using a placeholder endpoint that may not exist yet
    const res = await fetch(`${API_BASE}/api/meta/projects`, { headers });
    
    // If endpoint doesn't exist, return empty array silently
    if (!res.ok) {
      if (res.status === 404) {
        // Endpoint doesn't exist yet - this is expected, return empty array
        return [];
      }
      // For other errors, try to parse but don't throw
      try {
        await res.json();
      } catch {
        // Ignore JSON parse errors
      }
      return [];
    }
    
    const data = await res.json();
    
    // Return full objects or empty array
    if (Array.isArray(data)) {
      return data;
    } else if (data && Array.isArray(data.data)) {
      return data.data;
    }
    return [];
  } catch (e) {
    // Silently fail if projects endpoint doesn't exist yet
    // Don't log to console to avoid cluttering error logs
    return [];
  }
}

// Fetch ads for one campaign. Backend reads from DB only; ad_account_id for multi-account.
const fetchAds = async (campaignId, adAccountId = null) => {
  try {
    if (!campaignId || String(campaignId).trim() === "") return [];
    const token = getAuthToken();
    const headers = { "Content-Type": "application/json" };
    if (token) headers["Authorization"] = `Bearer ${token}`;
    const params = new URLSearchParams({ campaign_id: campaignId });
    if (adAccountId) params.set("ad_account_id", String(adAccountId).replace(/^act_/, ""));
    const res = await fetch(`${API_BASE}/api/meta/ads?${params}`, { headers });
    const data = await res.json();
    if (Array.isArray(data)) return data;
    if (data && Array.isArray(data.data)) return data.data;
    return [];
  } catch (e) {
    console.error("Error fetching ads:", e);
    return [];
  }
};

/** One request: ads for one or more campaigns (comma-separated campaign_id), server-filtered in DB. */
const fetchAdsByCampaignIds = async (campaignIds, adAccountId = null) => {
  try {
    if (!campaignIds || campaignIds.length === 0) return [];
    const token = getAuthToken();
    const headers = { "Content-Type": "application/json" };
    if (token) headers["Authorization"] = `Bearer ${token}`;
    const params = new URLSearchParams({
      campaign_id: campaignIds.map((id) => String(id).trim()).filter(Boolean).join(","),
    });
    if (adAccountId) params.set("ad_account_id", String(adAccountId).replace(/^act_/, ""));
    const res = await fetch(`${API_BASE}/api/meta/ads?${params}`, { headers });
    const data = await res.json();
    if (Array.isArray(data)) return data;
    if (data && Array.isArray(data.data)) return data.data;
    return [];
  } catch (e) {
    console.error("Error fetching ads by campaign ids:", e);
    return [];
  }
};

// Fetch all ads for the account from DB (one request; backend never fetches on filter change).
const fetchAdsAll = async (adAccountId = null) => {
  try {
    const token = getAuthToken();
    const headers = { "Content-Type": "application/json" };
    if (token) headers["Authorization"] = `Bearer ${token}`;
    const params = new URLSearchParams({ all: "true" });
    if (adAccountId) params.set("ad_account_id", String(adAccountId).replace(/^act_/, ""));
    const res = await fetch(`${API_BASE}/api/meta/ads?${params}`, { headers });
    const data = await res.json();
    if (Array.isArray(data)) return data;
    if (data && Array.isArray(data.data)) return data.data;
    return [];
  } catch (e) {
    console.error("Error fetching all ads:", e);
    return [];
  }
};

// Fetch pages from Meta API
const fetchPages = async () => {
  try {
    const token = getAuthToken();
    const headers = { "Content-Type": "application/json" };
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    const res = await fetch(`${API_BASE}/api/meta/pages`, { headers });
    
    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}));
      console.error("API error fetching pages:", errorData);
      return [];
    }

    const data = await res.json();
    if (Array.isArray(data)) return { data: data, defaultPageId: '' };
    return { data: data.data || [], defaultPageId: (data.defaultPageId || '').trim() };
  } catch (e) {
    console.error("Error fetching pages:", e);
    return { data: [], defaultPageId: '' };
  }
}

// Fetch forms for a page from Meta API
const fetchForms = async (pageId) => {
  try {
    if (!pageId) return [];
    
    const token = getAuthToken();
    const headers = { "Content-Type": "application/json" };
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    const res = await fetch(`${API_BASE}/api/meta/pages/${pageId}/forms`, { headers });
    
    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}));
      console.error("API error fetching forms:", errorData);
      return [];
    }

    const data = await res.json();
    return data.data || [];
  } catch (e) {
    console.error("Error fetching forms:", e);
    return [];
  }
}


// Fetch forms for a specific ad from Meta API
const fetchDashboardForms = async ({ adId, from, to, pageId }) => {
  try {
    if (!adId) {
      return [];
    }
    
    const token = getAuthToken();
    const headers = { "Content-Type": "application/json" };
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    let url = `${API_BASE}/api/meta/forms`;
    const params = new URLSearchParams();
    params.append('adId', adId);
    
    if (from) {
      params.append('start', from);
    }
    if (to) {
      params.append('end', to);
    }
    if (pageId) {
      params.append('pageId', pageId);
    }
    
    if (params.toString()) {
      url += `?${params.toString()}`;
    }

    const res = await fetch(url, { headers });
    
    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}));
      console.error("API error fetching dashboard forms:", errorData);
      
      // Check for permission errors
      if (res.status === 403 || errorData.isPermissionError) {
        const permissionError = new Error(errorData.details || errorData.error || "Permission denied");
        permissionError.isPermissionError = true;
        throw permissionError;
      }
      
      // Check for authentication errors
      if (res.status === 401 || errorData.isAuthError) {
        const authError = new Error(errorData.details || errorData.error || "Authentication failed");
        authError.isAuthError = true;
        throw authError;
      }
      
      return [];
    }

    const data = await res.json();
    return data.data || [];
  } catch (e) {
    console.error("Error fetching dashboard forms:", e);
    // Re-throw permission/auth errors so they can be handled by the component
    if (e.isPermissionError || e.isAuthError) {
      throw e;
    }
    return [];
  }
}

// Fetch page insights (followers, reach) from Meta API
const fetchPageInsights = async ({ pageId, from, to }) => {
  try {
    if (!pageId) {
      return { followers: [], reach: [], current_followers: 0, current_reach: 0 };
    }
    
    const token = getAuthToken();
    const headers = { "Content-Type": "application/json" };
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    let url = `${API_BASE}/api/meta/pages/${pageId}/insights`;
    const params = new URLSearchParams();
    
    if (from) {
      params.append('from', from);
    }
    if (to) {
      params.append('to', to);
    }
    
    if (params.toString()) {
      url += `?${params.toString()}`;
    }

    const res = await fetch(url, { headers });
    
    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}));
      console.error("API error fetching page insights:", errorData);
      
      // Check for permission errors
      if (res.status === 403 || errorData.isPermissionError) {
        const permissionError = new Error(errorData.details || errorData.error || "Permission denied: pages_read_engagement permission required");
        permissionError.isPermissionError = true;
        throw permissionError;
      }
      
      // Check for authentication errors
      if (res.status === 401 || errorData.isAuthError) {
        const authError = new Error(errorData.details || errorData.error || "Authentication failed: Please check your Meta Access Token");
        authError.isAuthError = true;
        throw authError;
      }
      
      return { followers: [], reach: [], current_followers: 0, current_reach: 0 };
    }

    const data = await res.json();
    const insightsData = data.data || { followers: [], reach: [], current_followers: 0, current_reach: 0 };
    return insightsData;
  } catch (e) {
    console.error("Error fetching page insights:", e);
    // Re-throw permission/auth errors so they can be handled by the component
    if (e.isPermissionError || e.isAuthError) {
      throw e;
    }
    return { followers: [], reach: [], current_followers: 0, current_reach: 0 };
  }
}
    
// Fetch leads from Meta API - uses enhanced /api/meta/leads endpoint
const fetchLeads = async ({ formId, from, to, adAccountId, campaignId, adId, pageId }) => {
  try {
    const token = getAuthToken();
    const headers = { "Content-Type": "application/json" };
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }
  
    // Use the enhanced /api/meta/leads endpoint
    let url = `${API_BASE}/api/meta/leads`;
    const params = new URLSearchParams();
    
    // Filter parameters
    if (formId) {
      params.append('formId', formId);
    }
    if (adId) {
      params.append('adId', adId);
    }
    if (campaignId) {
      params.append('campaignId', campaignId);
    }
    if (pageId) {
      params.append('pageId', pageId);
    }
    
    // Date range parameters
    if (from) {
      params.append('start', from);
    }
    if (to) {
      params.append('end', to);
    }
    
    // Default limit: fetch up to 10000 leads (server clamps to 25-10000)
    params.append('limit', '10000');
    
    if (params.toString()) {
      url += `?${params.toString()}`;
    }

    const res = await fetch(url, { headers });
    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}));
      console.error("API error fetching leads:", {
        status: res.status,
        statusText: res.statusText,
        errorData
      });
      // Check for permission errors (403 status or explicit permission error flag)
      if (res.status === 403 || errorData.isPermissionError) {
        const errorMessage = errorData.details || errorData.error || errorData.message || "Permission denied: leads_retrieval permission required";
        const permissionError = new Error(errorMessage);
        permissionError.isPermissionError = true;
        permissionError.errorCode = errorData.errorCode;
        permissionError.instruction = errorData.instruction;
        throw permissionError;
      }
      
      // Check for authentication errors (401)
      if (res.status === 401 || errorData.isAuthError) {
        const authError = new Error(errorData.details || errorData.error || "Authentication failed: Please check your Meta Access Token");
        authError.isAuthError = true;
        throw authError;
      }
      
      // For other errors, return empty structure but log the error
      if (errorData.message) {
        console.warn("Leads API warning:", errorData.message);
      }
      return { data: [], meta: null };
    }

    const data = await res.json();
    
    // Enhanced endpoint returns { data: [...], meta: {...} }
    const result = {
      data: data.data || [],
      meta: data.meta || null
    };
    
    return result;
  } catch (e) {
    console.error("Error fetching leads:", e);
    // Re-throw permission errors so they can be handled by the component
    if (e.message && (e.message.includes('permission') || e.message.includes('leads_retrieval'))) {
      throw e;
    }
    return { data: [], meta: null };
  }
}

const aggregateByDate = (rows) => {
  const map = new Map();
  rows.forEach((r) => {
    const key = r.date;
    const cur = map.get(key) || { date: key, leads: 0, spend: 0, conversions: 0, actions: {} };
    cur.leads += r.leads || 0;
    cur.spend += r.spend || 0;
    cur.conversions += r.conversions || 0;
    Object.entries(r.actions || {}).forEach(([k, v]) => {
      cur.actions[k] = (cur.actions[k] || 0) + v;
    });
    map.set(key, cur);
  });
  // Calculate CPL for each date
  return Array.from(map.values())
    .map(item => ({
      ...item,
      cpl: item.leads > 0 ? item.spend / item.leads : 0
    }))
    .sort((a, b) => (a.date > b.date ? 1 : -1));
};

export default function AdsDashboardBootstrap() {
  const [days, setDays] = useState(30);
  const [adAccounts, setAdAccounts] = useState([]);
  const [adAccountsLoading, setAdAccountsLoading] = useState(true);
  const [selectedAdAccounts, setSelectedAdAccounts] = useState([]);
  const [campaigns, setCampaigns] = useState([]);
  const [campaignsLoading, setCampaignsLoading] = useState(false);
  const [adsLoading, setAdsLoading] = useState(false);
  const [ads, setAds] = useState([]);
  const [data, setData] = useState([]);
  const [allAdsData, setAllAdsData] = useState([]); // Store all unfiltered data for ad breakdown
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [toast, setToast] = useState(null); // Toast notification state
  const [saturationAlert, setSaturationAlert] = useState(null); // Latest saturated campaigns for banner

  // Auto-dismiss toast after 5 seconds
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => {
        setToast(null);
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  // Fetch latest saturation run for dashboard banner (saturated campaigns)
  const API_BASE = process.env.REACT_APP_API_BASE || 'http://localhost:4000';
  useEffect(() => {
    let cancelled = false;
    const token = (() => {
      try {
        const key = process.env.REACT_APP_STORAGE_KEY || 'app_auth';
        const stored = localStorage.getItem(key);
        return stored ? (JSON.parse(stored)?.token ?? null) : null;
      } catch (e) { return null; }
    })();
    fetch(`${API_BASE}/api/ai/lead-saturation/latest`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then((res) => res.json())
      .then((data) => {
        if (cancelled || !data.success || !Array.isArray(data.saturated) || data.saturated.length === 0) return;
        setSaturationAlert({ saturated: data.saturated, summary: data.summary });
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);
  const [projects, setProjects] = useState([]);
  const [selectedProjects, setSelectedProjects] = useState([]);
  const [selectedCampaigns, setSelectedCampaigns] = useState([]);
  const [selectedAds, setSelectedAds] = useState([]);
  const [selectedPlatforms, setSelectedPlatforms] = useState([]);
  const [selectedPlatform, setSelectedPlatform] = useState(null); // Single platform for main dashboard filter
  // All Projects filter (single selection: '' = All Projects, or project name from PROJECT_ORDER)
  const [selectedProject, setSelectedProject] = useState('');
  const [projectsDropdownOpen, setProjectsDropdownOpen] = useState(false);
  const [hoveredProject, setHoveredProject] = useState(null);
  const projectsDropdownRef = useRef(null);
  const [selectedL1Revenue, setSelectedL1Revenue] = useState([]);
  const [selectedL2Revenue, setSelectedL2Revenue] = useState([]);
  const [selectedAction, setSelectedAction] = useState("");
  const [page, setPage] = useState(1);
  
  // Initialize dateFilters with default last 7 days instead of empty
  // This ensures dates are always available when component loads
  // Match Meta dashboard behavior: Last 7 complete days, excluding today
  const getDefaultDates = () => {
    const today = new Date();
    const endDate = new Date(today);
    endDate.setDate(endDate.getDate() - 1); // Yesterday (exclude today, matching Meta)
    const startDate = new Date(endDate);
    startDate.setDate(startDate.getDate() - 6); // 7 days before yesterday (7 complete days)
    return {
      startDate: startDate.toISOString().slice(0, 10), // YYYY-MM-DD format
      endDate: endDate.toISOString().slice(0, 10)
    };
  };
  
  const [dateFilters, setDateFilters] = useState(() => getDefaultDates());
  const [selectedDateRange, setSelectedDateRange] = useState('last_7_days');
  const [showDateRangeFilter, setShowDateRangeFilter] = useState(false);
  const [dateRangeFilterValue, setDateRangeFilterValue] = useState(null);
  const [showAdBreakdown, setShowAdBreakdown] = useState(true);
  const [currentTheme, setCurrentTheme] = useState(() => {
    return document.documentElement.getAttribute("data-theme") || getCurrentTheme() || "light";
  });
  const [leads, setLeads] = useState([]);
  const [leadsLoading, setLeadsLoading] = useState(false);
  const [leadsError, setLeadsError] = useState(null);
  const [pages, setPages] = useState([]);
  const [pagesLoading, setPagesLoading] = useState(true);
  const [defaultFacebookPageId, setDefaultFacebookPageId] = useState('');
  const [forms, setForms] = useState([]);
  const [selectedPage, setSelectedPage] = useState(null);
  const [selectedForm, setSelectedForm] = useState(null);
  const [selectedPlatformForLeads, setSelectedPlatformForLeads] = useState(null); // Platform filter for Total Leads section
  const [activeCampaignIds, setActiveCampaignIds] = useState(new Set()); // Store active campaign IDs for filtering leads
  
  const [leadsContext, setLeadsContext] = useState(null);
  const [leadsTimeRange, setLeadsTimeRange] = useState(null); // Time range filter for leads section (null = no filter)
  const [showLeadsDateRangeFilter, setShowLeadsDateRangeFilter] = useState(false);
  const [leadsDateRangeFilterValue, setLeadsDateRangeFilterValue] = useState(null);
  const [downloadingLeads, setDownloadingLeads] = useState(false);
  const perPage = 10;

  // Independent filters for Total Leads Admin View
  const [adminViewCampaigns, setAdminViewCampaigns] = useState([]);
  const [adminViewAds, setAdminViewAds] = useState([]);
  const [adminViewDateFilters, setAdminViewDateFilters] = useState(() => getDefaultDates());
  const [adminViewDateRangeFilterValue, setAdminViewDateRangeFilterValue] = useState(null);
  const [showAdminViewDateRangeFilter, setShowAdminViewDateRangeFilter] = useState(false);
  const [adminViewAdsList, setAdminViewAdsList] = useState([]);
  const [adminViewAdsLoading, setAdminViewAdsLoading] = useState(false);

  // State for new filtered leads table (below Total Leads Admin View)
  const [filteredLeadsPage, setFilteredLeadsPage] = useState(null);
  const [filteredLeadsForm, setFilteredLeadsForm] = useState(null);
  const [filteredLeadsForms, setFilteredLeadsForms] = useState([]);
  const [filteredLeadsFormsLoading, setFilteredLeadsFormsLoading] = useState(false);
  const [filteredLeadsTimeRange, setFilteredLeadsTimeRange] = useState(() => {
    const today = new Date();
    const endDate = new Date(today);
    endDate.setDate(endDate.getDate() - 1); // Yesterday
    const startDate = new Date(endDate);
    startDate.setDate(startDate.getDate() - 6); // 7 days before yesterday
    return {
      startDate: startDate.toISOString().slice(0, 10),
      endDate: endDate.toISOString().slice(0, 10)
    };
  });
  const [filteredLeadsData, setFilteredLeadsData] = useState([]);
  const [filteredLeadsLoading, setFilteredLeadsLoading] = useState(false);
  const [filteredLeadsError, setFilteredLeadsError] = useState(null);
  const [filteredLeadsPageNum, setFilteredLeadsPageNum] = useState(1);
  const [filteredLeadsPerPage] = useState(10);
  const [filteredLeadsSelectedDateRange, setFilteredLeadsSelectedDateRange] = useState('last_7_days');
  const [showFilteredLeadsDateRangeFilter, setShowFilteredLeadsDateRangeFilter] = useState(false);
  const [downloadingFilteredLeads, setDownloadingFilteredLeads] = useState(false);
  const [downloadingFollowsExcel, setDownloadingFollowsExcel] = useState(false);

  // Pre-load state for leads optimization
  const [preloadedLeads, setPreloadedLeads] = useState([]);
  const [preloadedForms, setPreloadedForms] = useState([]);
  const [preloadedPageId, setPreloadedPageId] = useState(null);
  const [preloadedDateRange, setPreloadedDateRange] = useState({ start: null, end: null });
  const [preloadingLeads, setPreloadingLeads] = useState(false);

  // Sorting state for Campaign Performance table
  const [campaignSortField, setCampaignSortField] = useState(null);
  const [campaignSortDirection, setCampaignSortDirection] = useState('asc');

  // Sorting state for Ad Performance Breakdown table
  const [adSortField, setAdSortField] = useState('leads');
  const [adSortDirection, setAdSortDirection] = useState('desc');

  // Content Marketing Dashboard State
  // Initialize with default last 7 days (matching Meta dashboard behavior)
  const getContentDefaultDates = () => {
    const today = new Date();
    const endDate = new Date(today);
    endDate.setDate(endDate.getDate() - 1); // Yesterday (exclude today)
    const startDate = new Date(endDate);
    startDate.setDate(startDate.getDate() - 6); // 7 days before yesterday (7 complete days)
    return {
      startDate: startDate.toISOString().slice(0, 10), // YYYY-MM-DD format
      endDate: endDate.toISOString().slice(0, 10)
    };
  };

  // Last 28 days (yesterday minus 27 days through yesterday) for Unfollows card only
  const getLast28DaysRange = () => {
    const today = new Date();
    const endDate = new Date(today);
    endDate.setDate(endDate.getDate() - 1); // Yesterday
    const startDate = new Date(endDate);
    startDate.setDate(startDate.getDate() - 27); // 28 days inclusive
    return {
      startDate: startDate.toISOString().slice(0, 10),
      endDate: endDate.toISOString().slice(0, 10)
    };
  };
  
  const [contentFilters, setContentFilters] = useState(() => getContentDefaultDates());
  const [contentDateRange, setContentDateRange] = useState('last_7_days');
  const [contentPlatform, setContentPlatform] = useState('');
  const [selectedSource, setSelectedSource] = useState([]);
  const [showContentDateRangeFilter, setShowContentDateRangeFilter] = useState(false);
  const [contentDateRangeFilterValue, setContentDateRangeFilterValue] = useState(null);
  
  // Content Marketing PAGE filter (drives page insights for this section only)
  const [contentMarketingPage, setContentMarketingPage] = useState(null);

  // Content Marketing: PAGE filter and engagement data when Instagram or Facebook is selected in Source
  const isInstagramSelected = selectedSource && selectedSource.some((s) => (s?.id || s) === 'instagram');
  const isFacebookSelected = selectedSource && selectedSource.some((s) => (s?.id || s) === 'facebook');
  const isEngagementSourceSelected = isInstagramSelected || isFacebookSelected;

  // When Instagram or Facebook is selected, PAGE filter shows only these 4 pages (match trim + case-insensitive)
  const contentMarketingPageOptions = useMemo(() => {
    if (!isEngagementSourceSelected || !Array.isArray(pages)) return [];
    const allowed = new Set(CONTENT_MARKETING_PAGE_NAMES.map((n) => (n || '').trim().toLowerCase()));
    return pages.filter((p) => {
      const name = (p.name || p.label || '').trim().toLowerCase();
      return name && allowed.has(name);
    });
  }, [isEngagementSourceSelected, pages]);

  // Page Insights State
  const [pageInsightsLoading, setPageInsightsLoading] = useState(false);
  const [pageInsightsData, setPageInsightsData] = useState(null);
  const [pageInsightsError, setPageInsightsError] = useState(null);
  
  // Content Marketing Page Insights State
  const [contentPageInsightsLoading, setContentPageInsightsLoading] = useState(false);
  const [contentPageInsightsData, setContentPageInsightsData] = useState(null);
  const [contentPageInsightsError, setContentPageInsightsError] = useState(null);
  // Insights for all 4 Content Marketing pages (for Followers vs Page chart when Instagram/Facebook selected)
  const [contentMarketingAllPagesInsights, setContentMarketingAllPagesInsights] = useState([]);
  const [contentMarketingAllPagesInsightsLoading, setContentMarketingAllPagesInsightsLoading] = useState(false);
  const [contentMarketingAllPagesInsightsError, setContentMarketingAllPagesInsightsError] = useState(null);
  const [performanceInsightsLoading, setPerformanceInsightsLoading] = useState(false);
  const [performanceInsightsData, setPerformanceInsightsData] = useState(null);
  const [performanceInsightsError, setPerformanceInsightsError] = useState(null);
  const [unfollowsLast28Days, setUnfollowsLast28Days] = useState(null);
  const [unfollowsLast28Loading, setUnfollowsLast28Loading] = useState(false);
  const [unfollowsLast28Error, setUnfollowsLast28Error] = useState(null);
  const [unfollowsReportDaily, setUnfollowsReportDaily] = useState([]);
  const [showUnfollowsReport, setShowUnfollowsReport] = useState(false);
  
  // Platform-specific metrics (Content Marketing - shown when Platform filter is selected)
  const [contentPlatformMetricsLoading, setContentPlatformMetricsLoading] = useState(false);
  const [contentPlatformMetrics, setContentPlatformMetrics] = useState({
    totalSiteSessions: 0,
    uniqueVisitors: 0,
    clicksToContact: 0,
    formViews: 0,
    formSubmissions: 0,
    leadCount: 0,
  });
  const [contentPlatformSessionsBySource, setContentPlatformSessionsBySource] = useState([]);
  const [contentPlatformLeadsBySource, setContentPlatformLeadsBySource] = useState([]);
  const [contentPlatformMetricsError, setContentPlatformMetricsError] = useState(null);

  // YouTube Ads metrics (shown when Platform filter is YouTube)
  const [youtubeMetricsLoading, setYoutubeMetricsLoading] = useState(false);
  const [youtubeMetricsError, setYoutubeMetricsError] = useState(null);
  const [youtubeMetrics, setYoutubeMetrics] = useState(null);
  
  // Chart-specific Time Range Filter State for "Account Reach by Followers Count"
  const [chartTimeRange, setChartTimeRange] = useState(() => {
    const today = new Date();
    const endDate = new Date(today);
    endDate.setDate(endDate.getDate() - 1); // Yesterday
    const startDate = new Date(endDate);
    startDate.setDate(startDate.getDate() - 6); // 7 days before yesterday
    return {
      startDate: startDate.toISOString().slice(0, 10),
      endDate: endDate.toISOString().slice(0, 10)
    };
  });
  const [chartTimeRangeValue, setChartTimeRangeValue] = useState('last_7_days');
  const [showChartTimeRangeFilter, setShowChartTimeRangeFilter] = useState(false);
  const [chartTimeRangeFilterValue, setChartTimeRangeFilterValue] = useState(null);
  
  // Google Sheets metrics state
  const [sheetsMetrics, setSheetsMetrics] = useState({
    onlineConversion: 0,
    offlineConversion: 0,
    l1Revenue: 0,
    l2Revenue: 0,
    totalRevenue: 0,
    organicLeads: 0,
    organicRevenue: 0,
    loading: false,
    error: null
  });

  // Content Marketing revenue state (separate from main dashboard)
  const [contentMarketingRevenue, setContentMarketingRevenue] = useState({
    organicLeads: 0,
    organicConversion: 0,
    l1Revenue: 0,
    l2Revenue: 0,
    totalRevenue: 0,
    loading: false,
    error: null
  });

  const toggleTheme = () => {
    const newTheme = currentTheme === "light" ? "dark" : "light";
    setTheme(newTheme);
    setCurrentTheme(newTheme);
  };

  // Project → ad accounts (for All Projects filter and Ad Account dropdown). Strict ID-based: only specified IDs.
  const adAccountsByProject = useMemo(() => buildAdAccountsByProject(adAccounts), [adAccounts]);
  const specifiedAccountIdSet = useMemo(() => new Set(ALL_SPECIFIED_ACCOUNT_IDS.map((id) => normalizeAccountId(id))), []);
  const specifiedAdAccounts = useMemo(() => adAccounts.filter((acc) => specifiedAccountIdSet.has(normalizeAccountId(acc.account_id || acc.id))), [adAccounts, specifiedAccountIdSet]);
  const selectedProjectAccountIds = useMemo(() => {
    if (!selectedProject) return [];
    const list = adAccountsByProject[selectedProject] || [];
    return list.map((x) => normalizeAccountId(x.value)).filter(Boolean);
  }, [selectedProject, adAccountsByProject]);
  const accountsForProject = useMemo(() => {
    if (selectedProjectAccountIds.length === 0) return [];
    const idSet = new Set(selectedProjectAccountIds);
    return adAccounts.filter((acc) => idSet.has(normalizeAccountId(acc.account_id || acc.id)));
  }, [adAccounts, selectedProjectAccountIds]);

  const accountsForSelectedAdAccounts = useMemo(() => {
    if (selectedAdAccounts.length === 0) return [];
    const baseList = selectedProject ? accountsForProject : specifiedAdAccounts;
    const idSet = new Set(selectedAdAccounts.map((id) => normalizeAccountId(id)));
    return baseList.filter((acc) => idSet.has(normalizeAccountId(acc.account_id || acc.id)));
  }, [selectedAdAccounts, selectedProject, accountsForProject, specifiedAdAccounts]);

  const load = async (useLive = false) => {
    setLoading(true);
    setCampaignsLoading(true);
    setError(null);
    try {
      // First, fetch campaigns (selected accounts, project accounts, or all)
      let campData;
      if (selectedAdAccounts.length > 0) {
        const campaignPromises = selectedAdAccounts.map((id) => fetchCampaigns(id));
        const results = await Promise.all(campaignPromises);
        const byId = new Map();
        results.flat().forEach((c) => {
          const id = c.id || c.campaign_id;
          if (id && !byId.has(id)) byId.set(id, c);
        });
        campData = Array.from(byId.values());
      } else if (selectedProject && accountsForProject.length > 0) {
        const campaignPromises = accountsForProject.map((acc) =>
          fetchCampaigns(acc.account_id || acc.id)
        );
        const results = await Promise.all(campaignPromises);
        const byId = new Map();
        results.flat().forEach((c) => {
          const id = c.id || c.campaign_id;
          if (id && !byId.has(id)) byId.set(id, c);
        });
        campData = Array.from(byId.values());
      } else if (specifiedAdAccounts.length > 0) {
        const campaignPromises = specifiedAdAccounts.map((acc) =>
          fetchCampaigns(acc.account_id || acc.id)
        );
        const results = await Promise.all(campaignPromises);
        const byId = new Map();
        results.flat().forEach((c) => {
          const id = c.id || c.campaign_id;
          if (id && !byId.has(id)) byId.set(id, c);
        });
        campData = Array.from(byId.values());
      } else {
        campData = await fetchCampaigns(null);
      }
      const projectsData = await fetchProjects();

      // The active-campaigns API only returns active campaigns, so we can use the list directly
      const activeCampaignsList = campData || [];
      // Normalize campaign IDs to strings for consistent comparison
      const activeCampaignIds = new Set(activeCampaignsList.map(c => String(c.id)));
      
      // Store active campaign IDs in state for filtering leads in adBreakdown
      setActiveCampaignIds(activeCampaignIds);

      // Update campaigns state
      if (activeCampaignsList.length > 0) {
        setCampaigns(activeCampaignsList);
      } else {
        setCampaigns([]);
      }

      // Reset selected campaigns if they don't exist in the new list
      // This handles the case when ad account changes and old campaign selections are invalid
      if (selectedCampaigns.length > 0 && activeCampaignsList.length > 0) {
        const validCampaigns = selectedCampaigns.filter((cid) =>
          activeCampaignsList.some((c) => String(c.id) === String(cid))
        );
        if (validCampaigns.length !== selectedCampaigns.length) {
          setSelectedCampaigns(validCampaigns.length > 0 ? validCampaigns : []);
        }
      } else if (selectedCampaigns.length > 0 && activeCampaignsList.length === 0) {
        // No campaigns available for this account, clear selections
        setSelectedCampaigns([]);
      }

      // Now check if all campaigns/ads are selected (after campaigns are loaded)
      const allCampaignsSelected = selectedCampaigns.length === 0 || 
        (activeCampaignsList.length > 0 && selectedCampaigns.length === activeCampaignsList.length);
      const allAdsSelected = selectedAds.length === 0 || 
        (ads.length > 0 && selectedAds.length === ads.length);
      

      // When no ad accounts selected = "All Ad Accounts"; else use selected accounts.
      const isAllAdAccounts = selectedAdAccounts.length === 0 && (
        selectedProject ? accountsForProject.length > 0 : specifiedAdAccounts.length > 0
      );
      const accountsForFetch = selectedAdAccounts.length > 0
        ? accountsForSelectedAdAccounts
        : isAllAdAccounts
          ? (selectedProject ? accountsForProject : specifiedAdAccounts)
          : [];

      // No ad accounts to fetch: stop loading and tell user to select an account
      if (accountsForFetch.length === 0) {
        setLoading(false);
        setCampaignsLoading(false);
        setToast({
          type: 'warning',
          title: 'Select an Ad Account',
          message: 'Select at least one Ad Account from the dropdown to load dashboard data. If the list is empty, check your Meta connection and server (.env token).'
        });
        return;
      }

      let rows;
      let allAdsRows;

      // When "Select All" campaigns/ads, pass empty ID arrays and allCampaigns/allAds so backend
      // does one aggregated call. Never send full ID list for "all."
      const campaignIdsToSend = allCampaignsSelected ? [] : selectedCampaigns;
      const adIdsToSend = allAdsSelected ? [] : selectedAds;

      if (isAllAdAccounts && accountsForFetch.length > 0) {
        rows = await fetchAllAccountsDashboardData({
          days,
          from: dateFilters.startDate || null,
          to: dateFilters.endDate || null,
          campaignIds: campaignIdsToSend,
          adIds: adIdsToSend,
          allCampaigns: allCampaignsSelected,
          allAds: allAdsSelected,
          accounts: accountsForFetch,
          useLive
        });
        allAdsRows = await fetchAllAccountsDashboardData({
          days,
          from: dateFilters.startDate || null,
          to: dateFilters.endDate || null,
          campaignIds: campaignIdsToSend,
          adIds: [],
          allCampaigns: allCampaignsSelected,
          allAds: true,
          accounts: accountsForFetch,
          useLive
        });
      } else if (accountsForFetch.length > 0) {
        rows = await fetchAllAccountsDashboardData({
          days,
          from: dateFilters.startDate || null,
          to: dateFilters.endDate || null,
          campaignIds: campaignIdsToSend,
          adIds: adIdsToSend,
          allCampaigns: allCampaignsSelected,
          allAds: allAdsSelected,
          accounts: accountsForFetch,
          useLive
        });
        allAdsRows = await fetchAllAccountsDashboardData({
          days,
          from: dateFilters.startDate || null,
          to: dateFilters.endDate || null,
          campaignIds: campaignIdsToSend,
          adIds: [],
          allCampaigns: allCampaignsSelected,
          allAds: true,
          accounts: accountsForFetch,
          useLive
        });
      } else {
        rows = [];
        allAdsRows = [];
      }

      // Fetch Wix analytics and merge with Meta data (Wix rows have platform: 'wix')
      const fromDate = dateFilters.startDate || null;
      const toDate = dateFilters.endDate || null;
      if (fromDate && toDate) {
        const wixResult = await fetchWixAnalytics({ from: fromDate, to: toDate });
        const wixRows = wixResult.rows || [];
        if (wixRows.length > 0) {
          rows = [...(rows || []), ...wixRows];
          allAdsRows = [...(allAdsRows || []), ...wixRows];
        }
      }

      // Include all campaigns and ads (ACTIVE, PAUSED, ARCHIVED, ENDED, etc.) to match Meta Ads Manager
      const filterByActiveStatus = (rowsToFilter) => rowsToFilter;

      // Only filter by active campaigns if specific campaigns are selected
      // If all campaigns are selected, show all data without filtering
      // Always include Wix rows (platform === 'wix') so Platform filter can show Wix or All
      const isWixRow = (r) => r.platform === 'wix' || r.platform_id === 'wix';
      let filteredData = rows;
      if (!allCampaignsSelected && selectedCampaigns.length > 0) {
        filteredData = rows.filter(r => {
          if (isWixRow(r)) return true;
          return selectedCampaigns.some(selectedId => {
            const normalizedSelected = String(selectedId);
            const normalizedCampaignId = String(r.campaign_id);
            return normalizedSelected === normalizedCampaignId;
          });
        });
      } else if (!allCampaignsSelected && selectedCampaigns.length === 0) {
        filteredData = rows.filter(r => {
          if (isWixRow(r)) return true;
          return activeCampaignIds.has(String(r.campaign_id));
        });
      }
      
      // Always filter by active status (campaign and ad must be active)
      filteredData = filterByActiveStatus(filteredData);

      // Apply the same campaign filtering to allAdsRows for consistency
      let filteredAllAdsData = allAdsRows;
      if (!allCampaignsSelected && selectedCampaigns.length > 0) {
        filteredAllAdsData = allAdsRows.filter(r => {
          if (isWixRow(r)) return true;
          return selectedCampaigns.some(selectedId => {
            const normalizedSelected = String(selectedId);
            const normalizedCampaignId = String(r.campaign_id);
            return normalizedSelected === normalizedCampaignId;
          });
        });
      } else if (!allCampaignsSelected && selectedCampaigns.length === 0) {
        filteredAllAdsData = allAdsRows.filter(r => {
          if (isWixRow(r)) return true;
          return activeCampaignIds.has(String(r.campaign_id));
        });
      }
      
      // Always filter by active status (campaign and ad must be active)
      filteredAllAdsData = filterByActiveStatus(filteredAllAdsData);


      setData(filteredData);
      // Store all ads data (without ad filter) for ad breakdown table
      // This ensures the table always shows all ads regardless of "Ad Name" filter
      setAllAdsData(filteredAllAdsData);

      if (filteredData.length === 0) {
        // If we have rows but they were all filtered out
        if (rows.length > 0 && !allCampaignsSelected) {
          setToast({
            type: 'warning',
            title: 'Warning',
            message: 'No data found for selected campaigns.'
          });
        } else if (rows.length === 0) {
          setToast({
            type: 'warning',
            title: 'Warning',
            message: 'No data available. Please configure Meta credentials in server/.env file.'
          });
        }
      } else {
        setError(null); // Clear error if we have data
        setToast(null); // Clear toast if we have data
      }

      setPage(1);
    } catch (e) {
      console.error(e);
      const errorMessage = e.message || "Failed to load data. Please check your Meta credentials.";
      setToast({
        type: 'error',
        title: 'Error',
        message: errorMessage
      });
      setCampaigns([]);
    } finally {
      setCampaignsLoading(false);
      setLoading(false);
    }
  };

  // When project changes, restrict Ad Accounts to those in the selected project (or clear if none match)
  useEffect(() => {
    if (selectedAdAccounts.length === 0) return;
    if (!selectedProject || selectedProjectAccountIds.length === 0) return;
    const projectIdSet = new Set(selectedProjectAccountIds.map((id) => normalizeAccountId(id)));
    const filtered = selectedAdAccounts.filter((id) => projectIdSet.has(normalizeAccountId(id)));
    if (filtered.length !== selectedAdAccounts.length) {
      setSelectedAdAccounts(filtered);
      setSelectedCampaigns([]);
      setSelectedAds([]);
      setCampaigns([]);
      setAds([]);
    }
  }, [selectedProject, selectedProjectAccountIds, selectedAdAccounts]);

  // Close All Projects dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (projectsDropdownRef.current && !projectsDropdownRef.current.contains(e.target)) {
        setProjectsDropdownOpen(false);
      }
    };
    if (projectsDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [projectsDropdownOpen]);

  // Load ad accounts. forceRefresh=true re-fetches from Meta (pagination, all accounts).
  const loadAdAccounts = useCallback(async (forceRefresh = false) => {
    try {
      setAdAccountsLoading(true);
      const accountsData = await fetchAdAccounts(forceRefresh);
      setAdAccounts(accountsData || []);
    } catch (error) {
      console.error('[Dashboard] ❌ Error in loadAdAccounts:', error);
      setAdAccounts([]);
    } finally {
      setAdAccountsLoading(false);
    }
  }, []);

  // Load ad accounts on mount
  useEffect(() => {
    loadAdAccounts(false);
  }, [loadAdAccounts]);

  // Load pages on mount
  useEffect(() => {
    const loadPages = async () => {
      setPagesLoading(true);
      try {
        const result = await fetchPages();
        const list = result?.data ?? result ?? [];
        setPages(Array.isArray(list) ? list : []);
        setDefaultFacebookPageId(result?.defaultPageId || '');
      } finally {
        setPagesLoading(false);
      }
    };
    loadPages();
  }, []);


  // Pre-load leads when page + date range available
  useEffect(() => {
    const preloadLeadsForPage = async () => {
      // Only pre-load if:
      // 1. Page is selected
      // 2. Date range is available
      // 3. Not already loading
      // 4. Not already loaded for this page + date range
      
      if (!selectedPage || !dateFilters.startDate || !dateFilters.endDate || preloadingLeads) {
        return;
      }
      
      // Check if already pre-loaded for this page + date range
      if (preloadedPageId === selectedPage && 
          preloadedDateRange.start === dateFilters.startDate &&
          preloadedDateRange.end === dateFilters.endDate &&
          preloadedLeads.length > 0) {
        return;
      }
      
      setPreloadingLeads(true);
      try {
        const token = getAuthToken();
        const headers = { "Content-Type": "application/json" };
        if (token) {
          headers["Authorization"] = `Bearer ${token}`;
        }
        
        const url = `${API_BASE}/api/meta/leads/preload?pageId=${selectedPage}&start=${dateFilters.startDate}&end=${dateFilters.endDate}`;
        const response = await fetch(url, { headers });
        
        if (response.ok) {
          const data = await response.json();
          setPreloadedLeads(data.leads || []);
          setPreloadedForms(data.forms || []);
          setPreloadedPageId(selectedPage);
          setPreloadedDateRange({
            start: dateFilters.startDate,
            end: dateFilters.endDate
          });
        } else {
          console.warn('[Pre-load] Failed to pre-load leads:', response.statusText);
        }
      } catch (error) {
        console.error('[Pre-load] Error pre-loading leads:', error);
      } finally {
        setPreloadingLeads(false);
      }
    };
    
    preloadLeadsForPage();
  }, [selectedPage, dateFilters.startDate, dateFilters.endDate]);

  // Clear pre-loaded data when page or date range changes significantly
  useEffect(() => {
    if (preloadedPageId && 
        (preloadedPageId !== selectedPage || 
         preloadedDateRange.start !== dateFilters.startDate ||
         preloadedDateRange.end !== dateFilters.endDate)) {
      setPreloadedLeads([]);
      setPreloadedForms([]);
      setPreloadedPageId(null);
      setPreloadedDateRange({ start: null, end: null });
    }
  }, [selectedPage, dateFilters.startDate, dateFilters.endDate]);

  // Auto-trigger leads display when pre-loaded leads become available
  useEffect(() => {
    if (preloadedLeads.length > 0 &&
        selectedPage &&
        preloadedPageId === selectedPage &&
        preloadedDateRange.start === dateFilters.startDate &&
        preloadedDateRange.end === dateFilters.endDate) {
      loadLeads();
    }
  }, [preloadedLeads.length, selectedPage, dateFilters.startDate, dateFilters.endDate, preloadedPageId, preloadedDateRange]);

  // Fetch forms for filtered leads table when page is selected
  const fetchFilteredLeadsForms = async (pageId) => {
    if (!pageId) {
      setFilteredLeadsForms([]);
      return;
    }
    
    setFilteredLeadsFormsLoading(true);
    try {
      const formsData = await fetchForms(pageId);
      setFilteredLeadsForms(formsData);
      // Clear form selection when page changes
      setFilteredLeadsForm(null);
      setFilteredLeadsData([]);
    } catch (e) {
      console.error("Error fetching forms for filtered leads:", e);
      setFilteredLeadsForms([]);
    } finally {
      setFilteredLeadsFormsLoading(false);
    }
  };

  // Load filtered leads for the new table based on form and date range
  const loadFilteredLeads = async () => {
    if (!filteredLeadsForm || !filteredLeadsTimeRange?.startDate || !filteredLeadsTimeRange?.endDate) {
      setFilteredLeadsData([]);
      return;
    }

    setFilteredLeadsLoading(true);
    setFilteredLeadsError(null);
    try {
      // Use live Meta API endpoint (not database)
      const from = filteredLeadsTimeRange.startDate || null;
      const to = filteredLeadsTimeRange.endDate || null;
      
      // Build query parameters - use 'start' and 'end' to match backend API
      const params = new URLSearchParams();
      if (filteredLeadsForm) params.append('formId', filteredLeadsForm);
      if (filteredLeadsPage) params.append('pageId', filteredLeadsPage);
      if (from) params.append('start', from);
      if (to) params.append('end', to);
      params.append('limit', '10000'); // request up to 10000 (server clamps 25-10000)

      // Fetch from live Meta API endpoint
      const token = getAuthToken();
      const headers = { "Content-Type": "application/json" };
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }
      
      const url = `${API_BASE}/api/meta/leads?${params.toString()}`;
      const response = await fetch(url, { headers });
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        
        // Handle permission/auth errors with better messaging
        if (errorData.isPermissionError || response.status === 403) {
          const permissionError = new Error(errorData.details || errorData.error || "Permission denied");
          permissionError.type = 'permission';
          permissionError.details = errorData.instruction || errorData.details;
          throw permissionError;
        }
        
        if (errorData.isAuthError || response.status === 401) {
          const authError = new Error(errorData.details || errorData.error || "Authentication failed");
          authError.type = 'auth';
          authError.details = errorData.instruction || errorData.details;
          throw authError;
        }
        
        throw new Error(errorData.details || errorData.error || `HTTP ${response.status}`);
      }
      
      const data = await response.json();
      const leadsData = data.data || [];
      
      
      // Format leads for display (ensure all required fields are present)
      // Live API endpoint returns formatted data, just ensure consistency
      const formattedLeads = leadsData.map(lead => ({
        ...lead,
        Name: lead.Name || lead.name || 'N/A',
        Phone: lead.Phone || lead.phone || 'N/A',
        Date: lead.Date || lead.DateChar || (lead.created_time ? lead.created_time.split('T')[0] : ''),
        Time: lead.Time || lead.TimeUtc || lead.created_time || '',
        TimeUtc: lead.TimeUtc || lead.created_time || '',
        DateChar: lead.DateChar || (lead.created_time ? lead.created_time.split('T')[0] : ''),
        Street: lead.Street || lead.street || lead.address || 'N/A',
        City: lead.City || lead.city || 'N/A',
        page_name: lead.page_name || 'N/A',
        campaign_name: lead.campaign_name || lead.Campaign || 'N/A',
        ad_name: lead.ad_name || 'N/A',
        form_name: lead.form_name || 'N/A'
      }));

      setFilteredLeadsData(formattedLeads);
      setFilteredLeadsPageNum(1); // Reset to first page
    } catch (e) {
      console.error("Error loading filtered leads:", e);
      setFilteredLeadsError({
        message: e.message || "Failed to load leads",
        type: e.type || 'error',
        details: e.details
      });
      setFilteredLeadsData([]);
    } finally {
      setFilteredLeadsLoading(false);
    }
  };

  // useEffect: When filtered leads page changes, fetch forms.
  // Only for Total Leads PAGE filter - NOT triggered by Content Marketing PAGE filter (contentMarketingPage).
  useEffect(() => {
    if (filteredLeadsPage) {
      fetchFilteredLeadsForms(filteredLeadsPage);
    } else {
      setFilteredLeadsForms([]);
      setFilteredLeadsForm(null);
      setFilteredLeadsData([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredLeadsPage]);

  // useEffect: When filtered leads form or time range changes, fetch leads
  useEffect(() => {
    if (filteredLeadsForm && filteredLeadsTimeRange?.startDate && filteredLeadsTimeRange?.endDate) {
      loadFilteredLeads();
    } else {
      setFilteredLeadsData([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredLeadsForm, filteredLeadsTimeRange?.startDate, filteredLeadsTimeRange?.endDate]);


  // Load leads from database (filtered by campaign and ad)
  const loadLeads = useCallback(async () => {
    setLeadsLoading(true);
    setLeadsError(null); // Clear previous errors
    try {
      // Use main dashboard date filters
      const from = dateFilters.startDate || null;
      const to = dateFilters.endDate || null;
      
    // Extract filter IDs - support multiple selections (use main dashboard filters)
    const campaignIds = selectedCampaigns.length > 0 ? selectedCampaigns.map(String) : [];
    const adIds = selectedAds.length > 0 ? selectedAds.map(String) : [];
      
    // Build query parameters
      const params = new URLSearchParams();
    if (campaignIds.length > 0) params.append('campaignId', campaignIds.join(','));
    if (adIds.length > 0) params.append('adId', adIds.join(','));
      if (from) params.append('startDate', from);
      if (to) params.append('endDate', to);
      
      // Fetch from database endpoint
      const token = getAuthToken();
      const headers = { "Content-Type": "application/json" };
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }
      
      const url = `${API_BASE}/api/meta/leads/db?${params.toString()}`;
      
      // Log Total Leads Admin View API call with parameters
      console.log('[Total Leads Admin View API Call]', {
        url: url,
        campaignIds: campaignIds.length > 0 ? campaignIds : 'NONE',
        adIds: adIds.length > 0 ? adIds : 'NONE',
        startDate: from || 'NONE',
        endDate: to || 'NONE',
        params: Object.fromEntries(params)
      });
      
      const response = await fetch(url, { headers });
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.details || errorData.error || `HTTP ${response.status}`);
      }
      
      const data = await response.json();
      const leadsData = data.data || [];
      
      // Log Total Leads Admin View API response
      console.log('[Total Leads Admin View API Response]', {
        totalLeads: leadsData.length,
        rowCount: leadsData.length,
        hasData: leadsData.length > 0,
        sampleLead: leadsData.length > 0 ? {
          name: leadsData[0].Name || leadsData[0].name,
          campaign: leadsData[0].campaign_name || leadsData[0].Campaign,
          ad: leadsData[0].ad_name
        } : null
      });
      
      
      // Format leads for display (ensure all required fields are present)
      const formattedLeads = leadsData.map(lead => ({
        ...lead,
        Name: lead.Name || lead.name || 'N/A',
        Phone: lead.Phone || lead.phone || 'N/A',
        Date: lead.Date || lead.DateChar || (lead.created_time ? lead.created_time.split('T')[0] : ''),
        Time: lead.Time || lead.TimeUtc || lead.created_time || '',
        TimeUtc: lead.TimeUtc || lead.created_time || '',
        DateChar: lead.DateChar || (lead.created_time ? lead.created_time.split('T')[0] : ''),
        Street: lead.Street || lead.street || lead.address || 'N/A',
        City: lead.City || lead.city || 'N/A',
        page_name: lead.page_name || 'N/A',
        campaign_name: lead.campaign_name || lead.Campaign || 'N/A',
        ad_name: lead.ad_name || 'N/A',
        form_name: lead.form_name || 'N/A'
      }));
      
      setLeads(formattedLeads);
      setLeadsContext(null);
      setPage(1);
      setLeadsError(null); // Clear error on success
    } catch (e) {
      console.error("Error loading leads from database:", e);
      const errorMessage = e.message || "Failed to fetch leads from database";
      
      // Set error state
      setLeadsError({
        type: 'error',
        message: "Failed to fetch leads from database",
        details: errorMessage
      });
      setLeads([]);
      setLeadsContext(null);
    } finally {
      setLeadsLoading(false);
    }
  }, [selectedCampaigns, selectedAds, dateFilters.startDate, dateFilters.endDate]);


  // Auto-load leads when main dashboard filters change
  useEffect(() => {
    // Check if we have valid date range from main dashboard filters
    const hasValidDateRange = dateFilters.startDate && dateFilters.endDate;
    
    // Trigger loadLeads if date range is set
    const shouldLoadLeads = hasValidDateRange;
    
    if (shouldLoadLeads) {
      loadLeads();
    } else if (!hasValidDateRange) {
      // Clear leads if no valid date range
      setLeads([]);
    }
  }, [dateFilters.startDate, dateFilters.endDate, selectedCampaigns, selectedAds, loadLeads]);

  // Clear ads when ad account selection changes (avoid showing stale ads).
  useEffect(() => {
    setAds([]);
  }, [selectedAdAccounts]);

  // Load Ad Name options from DB via server-filtered campaign_id (comma-separated). Re-runs when campaigns or accounts change.
  const loadAdsForCampaigns = useCallback(
    async (selectedIds) => {
      if (!selectedIds || selectedIds.length === 0) {
        setAds([]);
        setSelectedAds([]);
        return;
      }
      setAdsLoading(true);
      try {
        const idList = selectedIds.map((id) => String(id).trim()).filter(Boolean);
        let merged = [];

        if (selectedAdAccounts.length === 1) {
          merged = await fetchAdsByCampaignIds(idList, selectedAdAccounts[0]);
        } else if (selectedAdAccounts.length > 1) {
          const parts = await Promise.all(
            selectedAdAccounts.map((accId) => fetchAdsByCampaignIds(idList, accId))
          );
          merged = parts.flat();
        } else {
          const isAllAdAccounts =
            selectedAdAccounts.length === 0 &&
            (selectedProject ? accountsForProject.length > 0 : (specifiedAdAccounts || []).length > 0);
          const accountPool = selectedProject ? accountsForProject : specifiedAdAccounts || [];
          if (isAllAdAccounts && accountPool.length > 0) {
            const parts = await Promise.all(
              accountPool.map((acc) => fetchAdsByCampaignIds(idList, acc.account_id || acc.id))
            );
            merged = parts.flat();
          } else {
            const raw = await fetchAdsAll(null);
            const idSet = new Set(idList);
            merged = raw.filter((ad) => idSet.has(String(ad.campaign_id || "")));
          }
        }

        const unique = Array.from(
          new Map(merged.map((ad) => [String(ad.id || ad.ad_id), ad])).values()
        );
        unique.sort((a, b) => (a.name || "").toLowerCase().localeCompare((b.name || "").toLowerCase()));
        setAds(unique);
      } catch (e) {
        console.error("Error loading ads for campaigns:", e);
        setAds([]);
      } finally {
        setAdsLoading(false);
      }
    },
    [selectedAdAccounts, selectedProject, accountsForProject, specifiedAdAccounts]
  );

  useEffect(() => {
    if (selectedCampaigns.length === 0) {
      setAds([]);
      setSelectedAds([]);
      return;
    }
    loadAdsForCampaigns(selectedCampaigns);
  }, [selectedCampaigns, loadAdsForCampaigns]);


  useEffect(() => {
    load();
    // eslint-disable-next-line
  }, [days, selectedAdAccounts, selectedProject, selectedProjects, selectedCampaigns, selectedAds, selectedPlatforms, selectedL1Revenue, selectedL2Revenue, adAccounts]);

  // Load leads when form or date filters change

  // Fetch page insights when selectedPage or chartTimeRange changes
  useEffect(() => {
    if (selectedPage && chartTimeRange.startDate && chartTimeRange.endDate) {
      setPageInsightsLoading(true);
      setPageInsightsError(null);
      fetchPageInsights({
        pageId: selectedPage,
        from: chartTimeRange.startDate,
        to: chartTimeRange.endDate
      })
        .then((data) => {
          if (data) {
            setPageInsightsData(data);
          }
        })
        .catch((error) => {
          console.error("Error fetching page insights:", error);
          if (error.isPermissionError) {
            setPageInsightsError({
              type: 'permission',
              message: "Permission Error: Your Meta Access Token needs 'pages_read_engagement' permission.",
              details: "Please ensure your Meta Access Token has the 'pages_read_engagement' permission. You may need to regenerate your token after adding this permission in Meta App Dashboard."
            });
          } else if (error.isAuthError) {
            setPageInsightsError({
              type: 'auth',
              message: "Authentication Error: Your Meta Access Token is invalid or expired.",
              details: error.message
            });
          } else {
            setPageInsightsError({
              type: 'error',
              message: "Failed to fetch page insights.",
              details: error.message
            });
          }
          setPageInsightsData(null);
        })
        .finally(() => {
          setPageInsightsLoading(false);
        });
    } else {
      setPageInsightsData(null);
      setPageInsightsError(null);
    }
  }, [selectedPage, chartTimeRange.startDate, chartTimeRange.endDate]);

  // Auto-select first page if no page is selected and pages are loaded
  useEffect(() => {
    if (!selectedPage && pages.length > 0) {
      setSelectedPage(pages[0].id);
    }
  }, [pages, selectedPage]);

  // When Instagram/Facebook is deselected in Source, clear Content Marketing PAGE so next time they see "Select a Page"
  useEffect(() => {
    if (!isEngagementSourceSelected) {
      setContentMarketingPage(null);
    }
  }, [isEngagementSourceSelected]);

  // When Facebook is selected and server has a default page (META_PAGE_ID), auto-select it so insights load for the reference page
  useEffect(() => {
    if (!isFacebookSelected || !defaultFacebookPageId || pages.length === 0) return;
    if (contentMarketingPage || selectedPage) return;
    const hasDefault = pages.some((p) => (p.id || p.value) === defaultFacebookPageId);
    if (hasDefault) {
      setContentMarketingPage(defaultFacebookPageId);
    }
  }, [isFacebookSelected, defaultFacebookPageId, pages, contentMarketingPage, selectedPage]);

  // Single flow: one Page Insights call for Content Marketing. Reuse result for both chart and performance cards.
  // Fetch when Instagram or Facebook is selected in Source. Instagram: prefer IG insights, fallback to Page. Facebook: Page insights only.
  useEffect(() => {
    if (!isEngagementSourceSelected) {
      setContentPageInsightsData(null);
      setContentPageInsightsError(null);
      setPerformanceInsightsData(null);
      setPerformanceInsightsError(null);
      return;
    }
    const pageIdToUse = contentMarketingPage || selectedPage || (pages.length > 0 ? pages[0]?.id : null);

    if (!pageIdToUse || !contentFilters.startDate || !contentFilters.endDate) {
      setContentPageInsightsData(null);
      setContentPageInsightsError(null);
      setPerformanceInsightsData(null);
      setPerformanceInsightsError(null);
      return;
    }

    setContentPageInsightsLoading(true);
    setPerformanceInsightsLoading(true);
    setContentPageInsightsError(null);
    setPerformanceInsightsError(null);

    const from = contentFilters.startDate;
    const to = contentFilters.endDate;

    fetchPageInsights({ pageId: pageIdToUse, from, to })
      .then((pageData) => {
        if (pageData) {
          setContentPageInsightsData(pageData);
          setContentPageInsightsError(null);
        }
        // When Facebook only (Instagram not selected): use Page insights. When Instagram selected: try IG first, fallback to Page.
        if (isFacebookSelected && !isInstagramSelected) {
          if (pageData && (pageData.total_views != null || pageData.total_interactions != null || pageData.total_reached != null || pageData.total_follows != null)) {
            setPerformanceInsightsData(pageData);
            setPerformanceInsightsError(null);
          }
          return;
        }
        return fetchInstagramInsights({ pageIds: pageIdToUse, from, to })
          .then((result) => {
            if (result.data) {
              setPerformanceInsightsData(result.data);
              setPerformanceInsightsError(null);
              return;
            }
            if (result.error) {
              setPerformanceInsightsError({
                type: "error",
                message: "Instagram insights unavailable",
                details: result.error,
              });
            }
            if (pageData && (pageData.total_views != null || pageData.total_interactions != null || pageData.total_reached != null || pageData.total_follows != null)) {
              setPerformanceInsightsData(pageData);
              setPerformanceInsightsError(null);
            }
          })
          .catch(() => {
            if (pageData && (pageData.total_views != null || pageData.total_interactions != null || pageData.total_reached != null || pageData.total_follows != null)) {
              setPerformanceInsightsData(pageData);
              setPerformanceInsightsError(null);
            }
          });
      })
      .catch((error) => {
        console.error("Error fetching Content Marketing insights:", error);
        const errPayload = error.isPermissionError
          ? {
              type: "permission",
              message: "Your Meta Access Token needs 'pages_read_engagement' (or 'instagram_manage_insights') permission.",
              details: error.message,
            }
          : error.isAuthError
            ? { type: "auth", message: "Meta Access Token invalid or expired.", details: error.message }
            : { type: "error", message: "Failed to fetch page insights.", details: error.message };
        setContentPageInsightsError(errPayload);
        setPerformanceInsightsError(errPayload);
        setContentPageInsightsData(null);
        setPerformanceInsightsData(null);
      })
      .finally(() => {
        setContentPageInsightsLoading(false);
        setPerformanceInsightsLoading(false);
      });
  }, [isEngagementSourceSelected, isFacebookSelected, contentMarketingPage, selectedPage, pages, contentFilters.startDate, contentFilters.endDate]);

  // Fetch insights for all 4 Content Marketing pages (for Followers vs Page chart) when Instagram or Facebook selected
  useEffect(() => {
    if (!isEngagementSourceSelected || contentMarketingPageOptions.length === 0 || !contentFilters.startDate || !contentFilters.endDate) {
      setContentMarketingAllPagesInsights([]);
      setContentMarketingAllPagesInsightsError(null);
      return;
    }
    const from = contentFilters.startDate;
    const to = contentFilters.endDate;
    setContentMarketingAllPagesInsightsLoading(true);
    setContentMarketingAllPagesInsightsError(null);
    Promise.all(
      contentMarketingPageOptions.map((p) =>
        fetchPageInsights({ pageId: p.id, from, to }).then((data) => ({
          pageId: p.id,
          name: p.name || p.label || 'Unknown',
          current_followers: data?.current_followers ?? 0,
          current_reach: data?.current_reach ?? 0,
        }))
      )
    )
      .then(setContentMarketingAllPagesInsights)
      .catch((err) => {
        console.error('Error fetching Content Marketing all-pages insights:', err);
        setContentMarketingAllPagesInsightsError(err?.message || 'Failed to load follower counts');
        setContentMarketingAllPagesInsights([]);
      })
      .finally(() => setContentMarketingAllPagesInsightsLoading(false));
  }, [isEngagementSourceSelected, contentMarketingPageOptions, contentFilters.startDate, contentFilters.endDate]);

  // Fetch unfollows for last 28 days only (independent of date range filter); when Instagram or Facebook selected
  useEffect(() => {
    if (!isEngagementSourceSelected) {
      setUnfollowsLast28Days(null);
      setUnfollowsLast28Error(null);
      return;
    }
    const pageIdToUse = contentMarketingPage || selectedPage || (pages.length > 0 ? pages[0]?.id : null);

    if (!pageIdToUse) {
      setUnfollowsLast28Days(null);
      setUnfollowsLast28Error(null);
      return;
    }

    const { startDate, endDate } = getLast28DaysRange();
    setUnfollowsLast28Loading(true);
    setUnfollowsLast28Error(null);

    const buildUnfollowsReportFromPageData = (pageData) => {
      const followers = Array.isArray(pageData?.followers) ? pageData.followers : [];
      const fanAdds = Array.isArray(pageData?.fan_adds) ? pageData.fan_adds : [];
      const fanRemoves = Array.isArray(pageData?.fan_removes) ? pageData.fan_removes : [];
      const byDate = (arr) => Object.fromEntries((arr || []).map((r) => [r.date, Number(r.value ?? r.follows ?? r.unfollows ?? 0)]));
      const followersByDate = byDate(followers);
      const followsByDate = byDate(fanAdds);
      const unfollowsByDate = byDate(fanRemoves);
      const dateSet = new Set([
        ...followers.map((r) => r.date),
        ...fanAdds.map((r) => r.date),
        ...fanRemoves.map((r) => r.date),
      ].filter(Boolean));
      const sortedDates = [...dateSet].sort();
      if (sortedDates.length === 0) return [];
      const rows = sortedDates.map((date, i) => {
        const follower_count = followersByDate[date] ?? null;
        const follows = followsByDate[date] ?? 0;
        const unfollows = unfollowsByDate[date] ?? 0;
        let daily_change = null;
        if (follower_count != null && i > 0) {
          const prev = followersByDate[sortedDates[i - 1]];
          if (prev != null) daily_change = follower_count - prev;
        } else if (follows !== 0 || unfollows !== 0) {
          daily_change = follows - unfollows;
        }
        return {
          date,
          follower_count,
          daily_change,
          follows,
          unfollows,
        };
      });
      return rows;
    };

    const fetchFromPageInsights = () =>
      fetchPerformanceInsights({
        pageId: pageIdToUse,
        from: startDate,
        to: endDate,
      }).then((pageData) => {
        setUnfollowsLast28Days({
          total_unfollows: pageData?.total_unfollows ?? 0,
          unfollowsChange: pageData?.unfollowsChange ?? 0,
        });
        setUnfollowsReportDaily(buildUnfollowsReportFromPageData(pageData));
      });

    if (isFacebookSelected && !isInstagramSelected) {
      fetchFromPageInsights()
        .catch((error) => {
          console.error("Error fetching unfollows (last 28 days):", error);
          setUnfollowsLast28Error(error?.message || "Failed to fetch unfollows");
          setUnfollowsLast28Days(null);
          setUnfollowsReportDaily([]);
        })
        .finally(() => setUnfollowsLast28Loading(false));
      return;
    }

    fetchInstagramInsights({
      pageIds: pageIdToUse,
      from: startDate,
      to: endDate,
    })
      .then((result) => {
        const igData = result?.data;
        if (igData && (igData.total_unfollows != null || igData.total_follows != null)) {
          setUnfollowsLast28Days({
            total_unfollows: igData.total_unfollows ?? 0,
            unfollowsChange: igData.unfollowsChange ?? 0,
          });
          setUnfollowsReportDaily(Array.isArray(igData.unfollows_report_daily) ? igData.unfollows_report_daily : []);
          return;
        }
        return fetchFromPageInsights();
      })
      .catch((error) => {
        console.error("Error fetching unfollows (last 28 days):", error);
        setUnfollowsLast28Error(error?.message || "Failed to fetch unfollows");
        setUnfollowsLast28Days(null);
        setUnfollowsReportDaily([]);
      })
      .finally(() => {
        setUnfollowsLast28Loading(false);
      });
  }, [isEngagementSourceSelected, isFacebookSelected, contentMarketingPage, selectedPage, pages]);

  // Fetch Content Marketing revenue when filters change
  useEffect(() => {
    const fetchContentRevenue = async () => {
      // Only fetch if date range is available
      if (!contentFilters.startDate || !contentFilters.endDate) {
        console.warn('[Content Marketing Revenue] Date range not set, skipping fetch');
        return;
      }

      setContentMarketingRevenue(prev => ({ ...prev, loading: true, error: null }));
      
      try {
        const dateRange = {
          startDate: contentFilters.startDate,
          endDate: contentFilters.endDate
        };
        
        // Map source filter IDs to Google Sheets source names
        // The API will handle the mapping, but we pass the filter IDs
        const sourceFilter = selectedSource && selectedSource.length > 0 ? selectedSource : null;
        
        const revenue = await fetchContentMarketingRevenue(dateRange, sourceFilter);
        setContentMarketingRevenue({
          ...revenue,
          loading: false,
          error: revenue.error
        });
      } catch (error) {
        console.error("Error fetching Content Marketing revenue:", error);
        setContentMarketingRevenue(prev => ({
          ...prev,
          loading: false,
          error: error.message
        }));
      }
    };

    fetchContentRevenue();
  }, [contentFilters.startDate, contentFilters.endDate, selectedSource]);

  // Fetch platform-specific metrics when Platform filter is selected (Content Marketing)
  // Uses contentFilters date range; aggregates Wix data when Wix is selected
  useEffect(() => {
    const hasPlatformSelected = selectedPlatforms && selectedPlatforms.length > 0;
    const hasDateRange = contentFilters?.startDate && contentFilters?.endDate;
    const platformId = (p) => (typeof p === 'object' && p !== null && p.id != null) ? p.id : p;
    const hasWix = hasPlatformSelected && selectedPlatforms.some(p => String(platformId(p) || '').toLowerCase() === 'wix');

    if (!hasPlatformSelected || !hasDateRange) {
      setContentPlatformMetrics({
        totalSiteSessions: 0,
        uniqueVisitors: 0,
        clicksToContact: 0,
        formViews: 0,
        formSubmissions: 0,
        leadCount: 0,
      });
      setContentPlatformSessionsBySource([]);
      setContentPlatformLeadsBySource([]);
      setContentPlatformMetricsError(null);
      return;
    }

    const fetchPlatformMetrics = async () => {
      setContentPlatformMetricsLoading(true);
      setContentPlatformMetricsError(null);
      try {
        let totalSessions = 0;
        let uniqueVisitors = 0;
        let clicksToContact = 0;
        let formViews = 0;
        let formSubmissions = 0;

        if (hasWix) {
          const wixResult = await fetchWixAnalytics({
            from: contentFilters.startDate,
            to: contentFilters.endDate,
          });
          if (wixResult.error) {
            setContentPlatformMetricsError(wixResult.error);
          }
          const wixRows = wixResult.rows || [];
          wixRows.forEach((r) => {
            totalSessions += r.sessions ?? r.impressions ?? 0;
            uniqueVisitors += r.unique_visitors ?? 0;
            clicksToContact += r.clicks_to_contact ?? r.clicks ?? 0;
            formViews += r.form_views ?? 0;
            formSubmissions += r.form_submissions ?? r.leads ?? 0;
          });
        }

        setContentPlatformMetrics({
          totalSiteSessions: totalSessions,
          uniqueVisitors: uniqueVisitors || totalSessions,
          clicksToContact,
          formViews,
          formSubmissions,
          leadCount: formSubmissions,
        });

        // Sessions vs Traffic Source & Leads vs Source - placeholder distribution when no breakdown API
        // Wix tracks traffic sources via UTM/referrers; when API supports breakdown, replace with real data
        const trafficSources = ['Organic Search', 'Direct', 'Organic Social', 'Referral'];
        const defaultWeights = [0.35, 0.30, 0.20, 0.15];
        const sessionsBySource = trafficSources.map((source, i) => ({
          source,
          sessions: Math.round(totalSessions * defaultWeights[i]),
        }));
        const leadsSources = ['Organic Search', 'Direct', 'Social', 'Referral'];
        const leadsBySource = leadsSources.map((source, i) => ({
          source,
          leads: Math.round(formSubmissions * defaultWeights[i]),
        }));
        setContentPlatformSessionsBySource(sessionsBySource);
        setContentPlatformLeadsBySource(leadsBySource);
      } catch (err) {
        console.error('[Content Platform Metrics] Error:', err);
        setContentPlatformMetricsError(err.message || 'Failed to load platform metrics');
        setContentPlatformMetrics({
          totalSiteSessions: 0,
          uniqueVisitors: 0,
          clicksToContact: 0,
          formViews: 0,
          formSubmissions: 0,
          leadCount: 0,
        });
        setContentPlatformSessionsBySource([]);
        setContentPlatformLeadsBySource([]);
      } finally {
        setContentPlatformMetricsLoading(false);
      }
    };

    fetchPlatformMetrics();
  }, [selectedPlatforms, contentFilters?.startDate, contentFilters?.endDate]);

  // Fetch YouTube Ads insights when Platform filter is YouTube
  useEffect(() => {
    if (selectedPlatform !== 'youtube' || !dateFilters?.startDate || !dateFilters?.endDate) {
      setYoutubeMetrics(null);
      setYoutubeMetricsError(null);
      return;
    }
    let cancelled = false;
    setYoutubeMetricsLoading(true);
    setYoutubeMetricsError(null);
    fetchYouTubeInsights(dateFilters.startDate, dateFilters.endDate)
      .then((data) => {
        if (!cancelled) setYoutubeMetrics(data);
      })
      .catch((err) => {
        if (!cancelled) setYoutubeMetricsError(err?.message || 'Failed to load YouTube metrics');
      })
      .finally(() => {
        if (!cancelled) setYoutubeMetricsLoading(false);
      });
    return () => { cancelled = true; };
  }, [selectedPlatform, dateFilters?.startDate, dateFilters?.endDate]);

  // Fetch Google Sheets metrics on mount and poll every 30 seconds
  useEffect(() => {
    const fetchMetrics = async () => {
      setSheetsMetrics(prev => ({ ...prev, loading: true, error: null }));
      try {
        const metrics = await fetchSheetsMetrics();
        setSheetsMetrics({
          ...metrics,
          loading: false,
          error: metrics.error
        });
      } catch (error) {
        console.error("Error fetching Google Sheets metrics:", error);
        setSheetsMetrics(prev => ({
          ...prev,
          loading: false,
          error: error.message
        }));
      }
    };

    // Fetch immediately on mount
    fetchMetrics();

    // Set up interval to poll every 30 seconds
    const intervalId = setInterval(fetchMetrics, 30000);

    // Cleanup interval on unmount
    return () => {
      clearInterval(intervalId);
    };
  }, []); // Empty dependency array - only run on mount

  // Sync theme state with document attribute changes
  useEffect(() => {
    const observer = new MutationObserver(() => {
      const theme = document.documentElement.getAttribute("data-theme") || "light";
      setCurrentTheme(theme);
    });

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });

    return () => observer.disconnect();
  }, []);

  const filteredRows = useMemo(() => {
    // If all campaigns are selected (or none selected), show all campaigns
    const allCampaignsSelected = selectedCampaigns.length === 0 || 
      (campaigns.length > 0 && selectedCampaigns.length === campaigns.length);
    
    // If all ads are selected (or none selected), show all ads
    const allAdsSelected = selectedAds.length === 0 || 
      (ads.length > 0 && selectedAds.length === ads.length);

    return data.filter((r) => {
      // Campaign filter: if all selected or none selected, show all
      const matchesCampaign = allCampaignsSelected 
        ? true 
        : selectedCampaigns.some(selectedId => {
            // Normalize both values to strings for comparison
            const normalizedSelected = String(selectedId);
            const normalizedCampaignId = String(r.campaign_id);
            return normalizedSelected === normalizedCampaignId;
          });
      
      // Ad filter: if all selected or none selected, show all
      const matchesAd = allAdsSelected 
        ? true 
        : selectedAds.some(selectedId => {
            // Normalize both values to strings for comparison
            const normalizedSelected = String(selectedId);
            const normalizedAdId = String(r.ad_id);
            return normalizedSelected === normalizedAdId;
          });
      const matchesProject = selectedProjects.length > 0 
        ? selectedProjects.includes(r.project_id || r.project?.id) 
        : true;
      
      // Platform filter: Ads Analytics single select (selectedPlatform) or Content Marketing multi (selectedPlatforms)
      const platformOrId = r.platform || r.platform_id;
      const matchesPlatform = selectedPlatform 
        ? platformOrId === selectedPlatform 
        : selectedPlatforms.length > 0 
          ? selectedPlatforms.includes(platformOrId) 
          : true;
      
      // L1 Revenue filter (placeholder - update when L1 revenue data is available)
      const matchesL1Revenue = selectedL1Revenue.length > 0 
        ? selectedL1Revenue.some(range => {
            const l1Rev = r.l1Revenue || 0;
            if (range === '0-1000') return l1Rev >= 0 && l1Rev <= 1000;
            if (range === '1000-5000') return l1Rev > 1000 && l1Rev <= 5000;
            if (range === '5000-10000') return l1Rev > 5000 && l1Rev <= 10000;
            if (range === '10000+') return l1Rev > 10000;
            return false;
          })
        : true;
      
      // L2 Revenue filter (placeholder - update when L2 revenue data is available)
      const matchesL2Revenue = selectedL2Revenue.length > 0 
        ? selectedL2Revenue.some(range => {
            const l2Rev = r.l2Revenue || 0;
            if (range === '0-500') return l2Rev >= 0 && l2Rev <= 500;
            if (range === '500-2000') return l2Rev > 500 && l2Rev <= 2000;
            if (range === '2000-5000') return l2Rev > 2000 && l2Rev <= 5000;
            if (range === '5000+') return l2Rev > 5000;
            return false;
          })
        : true;
      
      return matchesCampaign && matchesAd && matchesProject && matchesPlatform && matchesL1Revenue && matchesL2Revenue;
    });
  }, [data, selectedCampaigns, selectedAds, selectedProjects, selectedPlatform, selectedPlatforms, selectedL1Revenue, selectedL2Revenue, campaigns.length, ads.length]);

  // Debug logging for multi-select ad filter
  useEffect(() => {
    // Removed console.log
  }, [selectedAds, filteredRows]);

  const timeseries = useMemo(() => aggregateByDate(filteredRows), [filteredRows]);

  const byCampaign = useMemo(() => {
    const map = new Map();
    data.forEach((r) => {
      // Include all statuses (ACTIVE, PAUSED, ARCHIVED, ENDED, etc.) to match Meta Ads Manager
      const key = r.campaign;
      const cur = map.get(key) || { campaign: key, leads: 0, spend: 0 };
      cur.leads += r.leads || 0;
      cur.spend += r.spend || 0;
      map.set(key, cur);
    });
    return Array.from(map.values());
  }, [data]);

  const actionBreakdown = useMemo(() => {
    // Allowed action types to display
    const allowedActions = [
      'lead',
      'link_click',
      'like',
      'comment',
    ];
    
    const map = new Map();
    filteredRows.forEach((r) => {
      Object.entries(r.actions || {}).forEach(([k, v]) => {
        // Only include allowed action types
        if (allowedActions.includes(k)) {
        map.set(k, (map.get(k) || 0) + v);
        }
      });
    });
    return Array.from(map.entries())
      .map(([name, value]) => ({ name, value }))
      .filter(item => item.value > 0); // Only show actions with values > 0
  }, [filteredRows]);

  const totals = useMemo(() => {
    // Check if all campaigns are selected
    const allCampaignsSelected = selectedCampaigns.length === 0 || 
      (campaigns.length > 0 && selectedCampaigns.length === campaigns.length);
    
    // Check if all ads are selected
    const allAdsSelected = selectedAds.length === 0 || 
      (ads.length > 0 && selectedAds.length === ads.length);

    const t = {
      leads: 0, spend: 0, impressions: 0, clicks: 0, actions: {},
      onlineConv: 0, offlineConv: 0, l1Revenue: 0, l2Revenue: 0, totalRevenue: 0,
      conversions: 0, videoViews: 0, video3sViews: 0, videoThruPlays: 0, videoP50Watched: 0, videoP75Watched: 0,
      videoPlays: 0, videoP100Watched: 0
    };
    
    // Use filteredRows instead of data to respect all filters
    filteredRows.forEach((r) => {
      t.leads += r.leads || 0;
      t.spend += r.spend || 0;
      t.impressions += r.impressions || 0;
      t.clicks += r.clicks || 0;
      t.conversions += r.conversions || 0;
      t.videoViews += r.videoViews || 0;
      t.video3sViews += r.video3sViews || 0;
      t.videoThruPlays += r.videoThruPlays || 0;
      t.videoP50Watched += r.videoP50Watched || 0;
      t.videoP75Watched += r.videoP75Watched || 0;
      t.videoPlays += r.videoPlays || 0;
      t.videoP100Watched += r.videoP100Watched || 0;

      // Online/Offline metrics (assumed mappings) - only calculate if sheets data not available
      const acts = r.actions || {};
      t.onlineConv += acts['purchase'] || acts['website_purchase'] || 0;
      t.offlineConv += acts['offline_conversion'] || 0;

      // Revenue - only calculate if sheets data not available
      const vals = r.action_values || {};
      t.totalRevenue += vals['purchase'] || vals['website_purchase'] || 0;
      // L1/L2 placeholders
      t.l1Revenue += 0;
      t.l2Revenue += 0;

      Object.entries(r.actions || {}).forEach(([k, v]) => {
        t.actions[k] = (t.actions[k] || 0) + v;
      });
    });

    // Override with Google Sheets values if available (not loading and no error)
    if (!sheetsMetrics.loading && !sheetsMetrics.error) {
      // Use Google Sheets values for these metrics
      t.onlineConv = sheetsMetrics.onlineConversion || t.onlineConv;
      t.offlineConv = sheetsMetrics.offlineConversion || t.offlineConv;
      t.l1Revenue = sheetsMetrics.l1Revenue || t.l1Revenue;
      t.l2Revenue = sheetsMetrics.l2Revenue || t.l2Revenue;
      t.totalRevenue = sheetsMetrics.totalRevenue || t.totalRevenue;
    }

    // Calculate real metrics
    t.cpl = t.leads ? t.spend / t.leads : 0;
    t.ctr = t.impressions ? (t.clicks / t.impressions) * 100 : 0;
    t.uniqueLeads = t.leads; // Using total leads as proxy for unique
    
    // Hook / Hold: ratio of summed fields over filteredRows (matches Ads Manager–style totals for the current scope)
    t.hookRate = aggregateHookRatePct(t.video3sViews, t.impressions, t.videoPlays);
    t.holdRate = aggregateHoldRatePct(t);
    
    t.roas = t.spend ? t.totalRevenue / t.spend : 0;

    return t;
  }, [filteredRows, selectedCampaigns, selectedAds, campaigns.length, ads.length, sheetsMetrics]);

  // Get all individual ad sets for Campaign Performance table (not aggregated)
  // Always show ALL campaigns and ad names regardless of filter selections
  // Include all statuses (ACTIVE, PAUSED, ARCHIVED, ENDED, etc.) to match Meta Ads Manager
  const campaignPerformanceRows = useMemo(() => {
    return data
      .filter(r => r.ad_id && r.ad_name && r.campaign_id)
      .map(r => ({
        ...r,
        cpm: r.impressions > 0 ? (r.spend / (r.impressions / 1000)) : 0,
        ctr: r.impressions > 0 ? (r.clicks / r.impressions) * 100 : 0,
        cpl: r.leads > 0 ? r.spend / r.leads : 0,
        conversionRate: r.clicks > 0 ? (r.conversions / r.clicks) * 100 : 0
      }));
  }, [data]);

  // Aggregate data by Ad for detailed table view
  // Build from insights only; leads in table = same as cards (aggregated row.leads from Meta API).
  const adBreakdown = useMemo(() => {
    const sourceData = allAdsData.length > 0 ? allAdsData : data;
    // Aggregate insights by ad_id (sum spend/impressions/clicks; weighted hook/hold)
    const adAgg = new Map();
    sourceData.forEach(row => {
      if (!row.ad_id) return;
      // Include all statuses (ACTIVE, PAUSED, ARCHIVED, ENDED, etc.) to match Meta Ads Manager

      const id = row.ad_id;
      const cur = adAgg.get(id) || {
        ad_id: id,
        ad_name: row.ad_name || 'Unnamed Ad',
        campaign_id: row.campaign_id,
        campaign_name: row.campaign || row.campaign_name || 'N/A',
        spend: 0,
        impressions: 0,
        clicks: 0,
        conversions: 0,
        leads: 0,
        videoViews: 0,
        video3sViews: 0,
        videoThruPlays: 0,
        videoPlays: 0,
        videoP100Watched: 0,
        videoP50Watched: 0,
        videoP75Watched: 0,
        ad_status: row.ad_status || row.effective_status || 'ACTIVE',
        campaign_status: row.campaign_status || row.status || 'ACTIVE',
        hookRateSum: 0,
        hookRateWeight: 0,
        holdRateSum: 0,
        holdRateWeight: 0
      };
      cur.spend += row.spend || 0;
      cur.impressions += row.impressions || 0;
      cur.clicks += row.clicks || 0;
      cur.conversions += row.conversions || 0;
      cur.leads += row.leads || 0;
      cur.videoViews += row.videoViews || 0;
      cur.video3sViews += row.video3sViews || 0;
      cur.videoThruPlays += row.videoThruPlays || 0;
      cur.videoPlays += row.videoPlays || 0;
      cur.videoP100Watched += row.videoP100Watched || 0;
      cur.videoP50Watched += row.videoP50Watched || 0;
      cur.videoP75Watched += row.videoP75Watched || 0;
      if (row.hookRate != null && row.impressions > 0) {
        cur.hookRateSum += row.hookRate * row.impressions;
        cur.hookRateWeight += row.impressions;
      }
      // Hold Rate: weight by videoPlays, fallback to impressions if plays unavailable
      const holdWeight = (row.videoPlays || 0) > 0 ? row.videoPlays : (row.impressions || 0);
      if ((row.holdRate ?? 0) > 0 && holdWeight > 0) {
        cur.holdRateSum += row.holdRate * holdWeight;
        cur.holdRateWeight += holdWeight;
      }
      adAgg.set(id, cur);
    });

    let combinedAds = Array.from(adAgg.values()).map(ad => {
      // Use same leads as cards: aggregated from insights (row.leads per ad). Table and cards show same data.
      const leadsCount = ad.leads || 0;
      const hookRate = ad.hookRateWeight > 0 ? ad.hookRateSum / ad.hookRateWeight : aggregateHookRatePct(ad.video3sViews, ad.impressions, ad.videoPlays);
      // Hold Rate = (p50 or p75) / 3s views — works for ALL campaign types; fallback ThruPlays/p100
      const holdNum = (ad.videoP50Watched || 0) > 0 ? ad.videoP50Watched : (ad.videoP75Watched || 0) > 0 ? ad.videoP75Watched : (ad.videoThruPlays || 0) > 0 ? ad.videoThruPlays : ad.videoP100Watched;
      const holdRate = ad.holdRateWeight > 0 ? ad.holdRateSum / ad.holdRateWeight : (ad.video3sViews > 0 && holdNum > 0 ? parseFloat(((holdNum / ad.video3sViews) * 100).toFixed(2)) : (ad.videoPlays > 0 ? parseFloat(((ad.videoP100Watched / ad.videoPlays) * 100).toFixed(2)) : (ad.videoViews > 0 ? parseFloat(((ad.videoThruPlays / ad.videoViews) * 100).toFixed(2)) : 0)));
      return {
        ad_id: ad.ad_id,
        ad_name: ad.ad_name,
        campaign_id: ad.campaign_id,
        campaign_name: ad.campaign_name,
        campaign: ad.campaign_name,
        spend: ad.spend,
        impressions: ad.impressions,
        clicks: ad.clicks,
        conversions: ad.conversions,
        leads: leadsCount,
        ad_status: ad.ad_status,
        campaign_status: ad.campaign_status,
        videoPlays: ad.videoPlays || 0,
        hookRate,
        holdRate
      };
    });

    // Filter by selected campaigns if any are selected
    const allCampaignsSelected = selectedCampaigns.length === 0 || (campaigns.length > 0 && selectedCampaigns.length === campaigns.length);
    if (!allCampaignsSelected && selectedCampaigns.length > 0) {
      combinedAds = combinedAds.filter(ad => selectedCampaigns.some(sid => String(sid) === String(ad.campaign_id)));
    }

    const result = combinedAds.map(ad => {
      const ctr = ad.impressions > 0 ? (ad.clicks / ad.impressions) * 100 : 0;
      const cpl = ad.leads > 0 ? ad.spend / ad.leads : 0;
      const conversionRate = ad.clicks > 0 ? (ad.conversions / ad.clicks) * 100 : 0;
      return { ...ad, ctr, cpl, conversionRate };
    });

    result.sort((a, b) => b.leads - a.leads);
    return result;
  }, [data, allAdsData, selectedCampaigns, campaigns.length]);
    
  // Sort helper function
  const sortData = (data, field, direction) => {
    if (!field) return data;
    
    const sorted = [...data].sort((a, b) => {
      let aVal = a[field];
      let bVal = b[field];
    
      // Handle numeric fields
      if (typeof aVal === 'number' && typeof bVal === 'number') {
        return direction === 'asc' ? aVal - bVal : bVal - aVal;
      }
      
      // Handle string fields
      if (typeof aVal === 'string' && typeof bVal === 'string') {
        return direction === 'asc' 
          ? aVal.localeCompare(bVal)
          : bVal.localeCompare(aVal);
      }
      
      // Handle null/undefined
      if (aVal == null) return direction === 'asc' ? -1 : 1;
      if (bVal == null) return direction === 'asc' ? 1 : -1;
      
      return 0;
    });
    
    return sorted;
  };

  // Sorted Campaign Performance rows
  const sortedCampaignPerformanceRows = useMemo(() => {
    return sortData(campaignPerformanceRows, campaignSortField, campaignSortDirection);
  }, [campaignPerformanceRows, campaignSortField, campaignSortDirection]);
      
  // Sorted Ad Breakdown rows
  const sortedAdBreakdown = useMemo(() => {
    return sortData(adBreakdown, adSortField, adSortDirection);
  }, [adBreakdown, adSortField, adSortDirection]);
      
  // Use leads from Meta API - already filtered by form
  // IMPORTANT: Meta Graph API does NOT provide ad_id/campaign_id per lead
  // Campaign column shows filter context, not lead attribution
  const leadDetails = useMemo(() => {

    // Filter by date range if provided (use main dashboard date filters)
    let filtered = leads;
    if (dateFilters.startDate && dateFilters.endDate) {
      const startDate = new Date(dateFilters.startDate);
      startDate.setHours(0, 0, 0, 0);
      const endDate = new Date(dateFilters.endDate);
      endDate.setHours(23, 59, 59, 999);
      
      filtered = leads.filter(lead => {
        const leadTime = lead.created_time || lead.TimeUtc || lead.Time;
        if (!leadTime) return false;
        const leadDate = new Date(leadTime);
        return leadDate >= startDate && leadDate <= endDate;
      });
    }

    // Sort by created_time descending (most recent first)
    return filtered.sort((a, b) => {
      const timeA = new Date(a.created_time || a.TimeUtc || a.Time || 0).getTime();
      const timeB = new Date(b.created_time || b.TimeUtc || b.Time || 0).getTime();
      return timeB - timeA;
    });
  }, [leads, dateFilters.startDate, dateFilters.endDate]);

  // Get campaign context from filters (NOT from lead data)
  // Meta API doesn't provide campaign attribution per lead
  const getCampaignContext = useMemo(() => {
    // If context from API is available, use it (most accurate)
    if (leadsContext?.campaign_name) {
      return leadsContext.campaign_name;
    }
    // Fallback to filter-based context
    if (selectedCampaigns.length === 0 || 
        (campaigns.length > 0 && selectedCampaigns.length === campaigns.length)) {
      return "Multiple / Not Attributed";
    }
    if (selectedCampaigns.length === 1) {
      const campaign = campaigns.find(c => c.id === selectedCampaigns[0] || c.id?.toString() === selectedCampaigns[0]?.toString());
      if (campaign && campaign.name) {
        return campaign.name;
      }
      // If campaign not found, try to use the ID to find it
      return "Multiple / Not Attributed";
    }
    // Multiple campaigns selected - show names if possible
    if (selectedCampaigns.length > 1 && selectedCampaigns.length <= 5) {
      const campaignNames = selectedCampaigns
        .map(id => {
          const campaign = campaigns.find(c => c.id === id || c.id?.toString() === id?.toString());
          return campaign?.name;
        })
        .filter(Boolean);
      if (campaignNames.length > 0) {
        return campaignNames.length === 1 ? campaignNames[0] : `${campaignNames.length} Campaigns`;
      }
    }
    // Multiple campaigns selected
    return `${selectedCampaigns.length} Campaigns Selected`;
  }, [selectedCampaigns, campaigns, leadsContext]);

  // Get ad context from filters (NOT from lead data)
  // Meta API doesn't provide ad attribution per lead
  const getAdContext = useMemo(() => {
    // If context from API is available, use it (most accurate)
    if (leadsContext?.ad_name) {
      return leadsContext.ad_name;
    }
    // Fallback to filter-based context
    if (selectedAds.length === 0 || (ads.length > 0 && selectedAds.length === ads.length)) {
      return "Multiple / Not Attributed";
    }
    if (selectedAds.length === 1) {
      const ad = ads.find(a => a.id === selectedAds[0] || a.id?.toString() === selectedAds[0]?.toString());
      if (ad && ad.name) {
        return ad.name;
      }
      // If ad not found, return default
      return "Multiple / Not Attributed";
    }
    // Multiple ads selected - show names if possible
    if (selectedAds.length > 1 && selectedAds.length <= 5) {
      const adNames = selectedAds
        .map(id => {
          const ad = ads.find(a => a.id === id || a.id?.toString() === id?.toString());
          return ad?.name;
        })
        .filter(Boolean);
      if (adNames.length > 0) {
        return adNames.length === 1 ? adNames[0] : `${adNames.length} Ads`;
      }
    }
    // Multiple ads selected
    return `${selectedAds.length} Ads Selected`;
  }, [selectedAds, ads, leadsContext]);

  const totalPages = Math.max(1, Math.ceil(leadDetails.length / perPage));
  const visibleLeads = useMemo(() => {
    return leadDetails.slice((page - 1) * perPage, page * perPage);
  }, [leadDetails, page, perPage]);
  const actionOptions = useMemo(() => {
    const set = new Set();
    data.forEach((r) => Object.keys(r.actions || {}).forEach((k) => set.add(k)));
    return Array.from(set);
  }, [data]);

  // Sortable header component with up/down arrows
  const SortableHeader = ({ field, currentField, currentDirection, onClick, children, className = '' }) => {
    const isActive = currentField === field;
    const isRightAligned = className.includes('text-end');
    return (
      <th 
        className={`fw-bold ${className}`}
        style={{ fontSize: '0.7rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px' }}
      >
        <button
          type="button"
          onClick={onClick}
          className={`d-flex align-items-center gap-1 w-100 border-0 bg-transparent p-0 fw-bold ${isRightAligned ? 'justify-content-end' : ''}`}
          style={{ 
            fontSize: '0.7rem', 
            color: '#64748b', 
            textTransform: 'uppercase', 
            letterSpacing: '0.5px',
            cursor: 'pointer',
            outline: 'none'
          }}
        >
          <span>{children}</span>
          <span className="d-flex flex-column" style={{ fontSize: '0.55rem', lineHeight: '0.7', marginLeft: '2px' }}>
            <span style={{ 
              color: isActive && currentDirection === 'asc' ? '#2563eb' : '#9ca3af',
              opacity: isActive && currentDirection === 'asc' ? 1 : 0.5
            }}>▲</span>
            <span style={{ 
              color: isActive && currentDirection === 'desc' ? '#2563eb' : '#9ca3af',
              opacity: isActive && currentDirection === 'desc' ? 1 : 0.5,
              marginTop: '-3px'
            }}>▼</span>
          </span>
        </button>
      </th>
    );
  };

  const formatMoney = (v) => `₹${(v || 0).toFixed(2)}`;
  const formatNum = (v) => (v || 0).toLocaleString();
  const formatPerc = (v) => `${((v || 0)).toFixed(2)}%`;
  const formatChange = (v) => {
    if (v === null || v === undefined || Number.isNaN(v)) return '—';
    const arrow = v >= 0 ? '↑' : '↓';
    return `${arrow} ${Math.abs(v).toFixed(1)}%`;
  };
  const formatDate = (dateStr) => {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${months[date.getMonth()]} ${date.getDate()}`;
  };
  const formatDateTime = (dateStr, timeStr) => {
    // Use timeStr if available, otherwise use dateStr
    const timestamp = timeStr || dateStr;
    if (!timestamp) return '';
    
    try {
      // Use browser's local timezone for display (automatic timezone conversion)
      // new Date() correctly interprets timestamps with timezone offsets (e.g., +05:30)
      const date = new Date(timestamp);
      if (isNaN(date.getTime())) return '';
      
      const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const formattedDate = `${months[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
      
      // Use browser's local time (automatic timezone conversion)
      const hours = date.getHours().toString().padStart(2, '0');
      const minutes = date.getMinutes().toString().padStart(2, '0');
      return `${formattedDate} ${hours}:${minutes}`;
    } catch (e) {
      return '';
    }
  };

  // Helper function to calculate date range from time range preset (for leads section)
  const getDateRangeFromPreset = (preset) => {
    // If no preset provided, return null dates (no filter)
    if (!preset) {
      return { startDate: null, endDate: null };
    }
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    
    let startDate, endDate;
    
    switch (preset) {
      case 'last_7_days':
        endDate = new Date(yesterday);
        startDate = new Date(endDate);
        startDate.setDate(startDate.getDate() - 6);
        break;
      case 'last_14_days':
        endDate = new Date(yesterday);
        startDate = new Date(endDate);
        startDate.setDate(startDate.getDate() - 13);
        break;
      case 'last_30_days':
        endDate = new Date(yesterday);
        startDate = new Date(endDate);
        startDate.setDate(startDate.getDate() - 29);
        break;
      case 'last_90_days':
        endDate = new Date(yesterday);
        startDate = new Date(endDate);
        startDate.setDate(startDate.getDate() - 89);
        break;
      case 'this_month':
        startDate = new Date(today.getFullYear(), today.getMonth(), 1);
        endDate = new Date(yesterday);
        break;
      case 'last_month':
        startDate = new Date(today.getFullYear(), today.getMonth() - 1, 1);
        endDate = new Date(today.getFullYear(), today.getMonth(), 0);
        break;
      default:
        // Unknown preset - return null dates (no filter)
        return { startDate: null, endDate: null };
    }
    
    // Ensure start date is 00:00:00 and end date is 23:59:59
    startDate.setHours(0, 0, 0, 0);
    endDate.setHours(23, 59, 59, 999);
    
    return {
      startDate: startDate.toISOString().slice(0, 10),
      endDate: endDate.toISOString().slice(0, 10)
    };
  };

  // Fetch all filtered leads for download (without pagination limit)
  const fetchAllFilteredLeads = async () => {
    // Use main dashboard date filters
    const from = dateFilters.startDate || null;
    const to = dateFilters.endDate || null;
    
    // Extract filter IDs for contextual insights
    const adAccountId = selectedAdAccounts.length === 1 ? selectedAdAccounts[0] : null;
    const campaignId = selectedCampaigns.length > 0 ? selectedCampaigns[0] : null;
    const adId = selectedAds.length > 0 ? selectedAds[0] : null;
    
    try {
      const response = await fetchLeads({
        formId: null, // No form filter
        from,
        to,
        adAccountId,
        campaignId,
        adId,
        pageId: selectedPage
      });
      
      return {
        leads: response.data || [],
        meta: response.meta || null
      };
    } catch (e) {
      console.error("Error fetching all leads for download:", e);
      throw e;
    }
  };

  // Handle CSV download
  const handleDownloadCSV = async () => {
    if (leadDetails.length === 0) {
      setToast({
        type: 'warning',
        title: 'Warning',
        message: 'No leads available to download.'
      });
      return;
    }
    
    setDownloadingLeads(true);
    try {
      // Use currently displayed leads (already filtered and sorted)
      const allLeads = leadDetails;
      
      // Prepare CSV data
      const headers = ['Lead Name', 'Phone Number', 'Date & Time', 'Street', 'City', 'Page', 'Campaign', 'Ad Name', 'Form'];
      
      // Escape commas and quotes in CSV
      const escapeCSV = (val) => {
        if (val === null || val === undefined) return '';
        const str = String(val);
        if (str.includes(',') || str.includes('"') || str.includes('\n')) {
          return `"${str.replace(/"/g, '""')}"`;
        }
        return str;
      };
      
      const rows = allLeads.map(lead => {
        const leadName = lead.Name || lead.name || 'N/A';
        const phone = lead.Phone || lead.phone || 'N/A';
        const dateTime = formatDateTime(lead.Date || lead.date || lead.DateChar, lead.Time || lead.time || lead.TimeUtc || lead.created_time);
        const street = lead.Street || lead.street || 'N/A';
        const city = lead.City || lead.city || 'N/A';
        
        return [
          escapeCSV(leadName),
          escapeCSV(phone),
          escapeCSV(dateTime),
          escapeCSV(street),
          escapeCSV(city),
          escapeCSV(lead.page_name || 'N/A'),
          escapeCSV(lead.campaign_name || 'N/A'),
          escapeCSV(lead.ad_name || 'N/A'),
          escapeCSV(lead.form_name || 'N/A')
        ];
      });
      
      // Generate filename with date
      const dateStr = new Date().toISOString().slice(0, 10);
      const filename = `leads_${dateStr}.csv`;
      
      // Use existing CSV export utility
      downloadCSV(filename, [headers, ...rows]);
      
      setToast({
        type: 'success',
        title: 'Success',
        message: `Successfully downloaded ${allLeads.length} leads as CSV.`
      });
    } catch (e) {
      console.error("Error downloading CSV:", e);
      setToast({
        type: 'error',
        title: 'Error',
        message: 'Failed to download leads. Please try again.'
      });
    } finally {
      setDownloadingLeads(false);
    }
  };

  // Handle Excel download
  const handleDownloadExcel = async () => {
    if (leadDetails.length === 0) {
      setToast({
        type: 'warning',
        title: 'Warning',
        message: 'No leads available to download.'
      });
      return;
    }
    
    setDownloadingLeads(true);
    try {
      // Use currently displayed leads (already filtered and sorted)
      const allLeads = leadDetails;
      
      // Prepare Excel data
      const headers = ['Lead Name', 'Phone Number', 'Date & Time', 'Street', 'City', 'Page', 'Campaign', 'Ad Name', 'Form'];
      
      const rows = allLeads.map(lead => {
        const leadName = lead.Name || lead.name || 'N/A';
        const phone = lead.Phone || lead.phone || 'N/A';
        const dateTime = formatDateTime(lead.Date || lead.date || lead.DateChar, lead.Time || lead.time || lead.TimeUtc || lead.created_time);
        const street = lead.Street || lead.street || lead.address || 'N/A';
        const city = lead.City || lead.city || 'N/A';
        
        return [
          leadName, 
          phone, 
          dateTime, 
          street, 
          city, 
          lead.page_name || 'N/A',
          lead.campaign_name || 'N/A',
          lead.ad_name || 'N/A',
          lead.form_name || 'N/A'
        ];
      });
      
      const dateStr = new Date().toISOString().slice(0, 10);
      const filename = `leads_${dateStr}.xlsx`;
      const columnWidths = [25, 15, 20, 30, 20, 25, 30, 30, 25]; // 9 columns
      await downloadExcelFromRows(headers, rows, 'Leads', filename, columnWidths);
      
      setToast({
        type: 'success',
        title: 'Success',
        message: `Successfully downloaded ${allLeads.length} leads as Excel.`
      });
    } catch (e) {
      console.error("Error downloading Excel:", e);
      setToast({
        type: 'error',
        title: 'Error',
        message: 'Failed to download leads. Please try again.'
      });
    } finally {
      setDownloadingLeads(false);
    }
  };

  // Handle CSV download for filtered leads table
  const handleDownloadFilteredLeadsCSV = async () => {
    if (filteredLeadsData.length === 0) {
      setToast({
        type: 'warning',
        title: 'Warning',
        message: 'No leads available to download.'
      });
      return;
    }
    
    setDownloadingFilteredLeads(true);
    try {
      const headers = ['Date & Time', 'Campaign', 'Ad Name', 'Lead Name', 'Phone Number', 'Sugar Poll', 'City', 'Street', 'Form Name'];
      
      // Escape commas and quotes in CSV
      const escapeCSV = (val) => {
        if (val === null || val === undefined) return '';
        const str = String(val);
        if (str.includes(',') || str.includes('"') || str.includes('\n')) {
          return `"${str.replace(/"/g, '""')}"`;
        }
        return str;
      };
      
      const rows = filteredLeadsData.map(lead => {
        const dateTime = formatDateTime(lead.Date || lead.date || lead.DateChar, lead.Time || lead.time || lead.TimeUtc || lead.created_time);
        const sugarPoll = lead.SugarPoll || lead.sugar_poll || (lead.field_data && lead.field_data['Sugar Poll']) || 'N/A';
        return [
          escapeCSV(dateTime),
          escapeCSV(lead.campaign_name || 'N/A'),
          escapeCSV(lead.ad_name || 'N/A'),
          escapeCSV(lead.Name || 'N/A'),
          escapeCSV(lead.Phone || 'N/A'),
          escapeCSV(sugarPoll),
          escapeCSV(lead.City || 'N/A'),
          escapeCSV(lead.Street || 'N/A'),
          escapeCSV(lead.form_name || 'N/A')
        ];
      });
      
      // Generate filename with date
      const dateStr = new Date().toISOString().slice(0, 10);
      const filename = `filtered_leads_${dateStr}.csv`;
      
      // Use existing CSV export utility
      downloadCSV(filename, [headers, ...rows]);
      
      setToast({
        type: 'success',
        title: 'Success',
        message: `Successfully downloaded ${filteredLeadsData.length} leads as CSV.`
      });
    } catch (e) {
      console.error("Error downloading CSV:", e);
      setToast({
        type: 'error',
        title: 'Error',
        message: 'Failed to download leads. Please try again.'
      });
    } finally {
      setDownloadingFilteredLeads(false);
    }
  };

  // Format a date as "DD Mon" to match API daily_subscriber_change date strings
  const formatDayMon = (dateStr) => {
    const d = new Date(dateStr + 'T00:00:00');
    const day = d.getDate();
    const mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()];
    return `${String(day).padStart(2, '0')} ${mon}`;
  };

  // Export Follows to Excel (Meta-style: Date, Primary, Total row)
  const handleDownloadFollowsExcel = async () => {
    const dailyList =
      performanceInsightsData?.data?.daily_subscriber_change ??
      performanceInsightsData?.daily_subscriber_change ??
      (Array.isArray(performanceInsightsData?.fan_adds) ? performanceInsightsData.fan_adds : []);
    const startDate = contentFilters?.startDate;
    const endDate = contentFilters?.endDate;
    if (!startDate || !endDate) {
      setToast({ type: 'warning', title: 'Warning', message: 'Please select a date range first.' });
      return;
    }
    if (dailyList.length === 0) {
      setToast({ type: 'warning', title: 'Warning', message: 'No follows data available to export.' });
      return;
    }
    setDownloadingFollowsExcel(true);
    try {
      const byDayMon = {};
      dailyList.forEach((item) => {
        const rawDate = (item.date || '').trim();
        const dayMonKey = /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? formatDayMon(rawDate) : rawDate;
        const val = item?.val ?? item?.value;
        if (dayMonKey) byDayMon[dayMonKey] = (byDayMon[dayMonKey] || 0) + (Number(val) || 0);
      });
      const rows = [];
      let totalFollows = 0;
      const start = new Date(startDate + 'T00:00:00');
      const end = new Date(endDate + 'T00:00:00');
      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        const iso = d.toISOString().slice(0, 10);
        const dayMon = formatDayMon(iso);
        const follows = Math.max(0, byDayMon[dayMon] || 0);
        totalFollows += follows;
        rows.push([iso + 'T00:00:00', follows]);
      }
      rows.push(['Total', totalFollows]);
      const headers = ['Date', 'Primary'];
      const filename = `Facebook-follows-${startDate}.xlsx`;
      await downloadExcelFromRows(headers, rows, 'Facebook follows', filename, [24, 12]);
      setToast({ type: 'success', title: 'Success', message: 'Follows data exported to Excel.' });
    } catch (e) {
      console.error('Error exporting follows Excel:', e);
      setToast({ type: 'error', title: 'Error', message: 'Failed to export follows. Please try again.' });
    } finally {
      setDownloadingFollowsExcel(false);
    }
  };

  // Handle Excel download for filtered leads table
  const handleDownloadFilteredLeadsExcel = async () => {
    if (filteredLeadsData.length === 0) {
      setToast({
        type: 'warning',
        title: 'Warning',
        message: 'No leads available to download.'
      });
      return;
    }
    
    setDownloadingFilteredLeads(true);
    try {
      const headers = ['Date & Time', 'Campaign', 'Ad Name', 'Lead Name', 'Phone Number', 'Sugar Poll', 'City', 'Street', 'Form Name'];
      
      const rows = filteredLeadsData.map(lead => {
        const dateTime = formatDateTime(lead.Date || lead.date || lead.DateChar, lead.Time || lead.time || lead.TimeUtc || lead.created_time);
        const sugarPoll = lead.SugarPoll || lead.sugar_poll || (lead.field_data && lead.field_data['Sugar Poll']) || 'N/A';
        return [
          dateTime,
          lead.campaign_name || 'N/A',
          lead.ad_name || 'N/A',
          lead.Name || 'N/A',
          lead.Phone || 'N/A',
          sugarPoll,
          lead.City || 'N/A',
          lead.Street || 'N/A',
          lead.form_name || 'N/A'
        ];
      });
      
      const dateStr = new Date().toISOString().slice(0, 10);
      const filename = `filtered_leads_${dateStr}.xlsx`;
      const columnWidths = [20, 30, 30, 25, 15, 15, 20, 30, 30];
      await downloadExcelFromRows(headers, rows, 'Filtered Leads', filename, columnWidths);
      
      setToast({
        type: 'success',
        title: 'Success',
        message: `Successfully downloaded ${filteredLeadsData.length} leads as Excel.`
      });
    } catch (e) {
      console.error("Error downloading Excel:", e);
      setToast({
        type: 'error',
        title: 'Error',
        message: 'Failed to download leads. Please try again.'
      });
    } finally {
      setDownloadingFilteredLeads(false);
    }
  };

  // Handle time range filter apply for leads section
  const handleLeadsDateRangeApply = (payload) => {
    
    // Validate dates before setting
    if (!payload.start_date || !payload.end_date) {
      console.error('[LeadsDateRangeFilter] Invalid dates received:', payload);
      alert('Invalid date range selected. Please try again.');
      return;
    }
    
    // Validate date format (YYYY-MM-DD)
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(payload.start_date) || !dateRegex.test(payload.end_date)) {
      console.error('[LeadsDateRangeFilter] Invalid date format:', {
        start_date: payload.start_date,
        end_date: payload.end_date
      });
      alert('Invalid date format. Please try again.');
      return;
    }
    
    setLeadsDateRangeFilterValue(payload);
    setLeadsTimeRange(payload.range_type || 'custom');
    
    // Update date filters - useEffect will automatically reload leads
    setDateFilters({
      startDate: payload.start_date,
      endDate: payload.end_date
    });
    
    // Close the modal
    setShowLeadsDateRangeFilter(false);
  };

  // Handle time range filter apply for filtered leads table
  const handleFilteredLeadsDateRangeApply = (payload) => {
    
    // Validate dates before setting
    if (!payload.start_date || !payload.end_date) {
      console.error('[FilteredLeadsDateRangeFilter] Invalid dates received:', payload);
      alert('Invalid date range selected. Please try again.');
      return;
    }
    
    // Validate date format (YYYY-MM-DD)
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(payload.start_date) || !dateRegex.test(payload.end_date)) {
      console.error('[FilteredLeadsDateRangeFilter] Invalid date format:', {
        start_date: payload.start_date,
        end_date: payload.end_date
      });
      alert('Invalid date format. Please try again.');
      return;
    }
    
    setFilteredLeadsSelectedDateRange(payload.range_type || 'custom');
    setFilteredLeadsTimeRange({
      startDate: payload.start_date,
      endDate: payload.end_date
    });
    
    // Close the modal
    setShowFilteredLeadsDateRangeFilter(false);
  };

  // Helper to get display text for filtered leads time range
  const getFilteredLeadsTimeRangeDisplay = () => {
    if (filteredLeadsTimeRange?.startDate && filteredLeadsTimeRange?.endDate) {
      if (filteredLeadsSelectedDateRange === 'custom') {
        const start = new Date(filteredLeadsTimeRange.startDate);
        const end = new Date(filteredLeadsTimeRange.endDate);
        const startDisplay = start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        const endDisplay = end.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        return `${startDisplay} - ${endDisplay}`;
      }
      const presetLabels = {
        'today': 'Today',
        'yesterday': 'Yesterday',
        'today_yesterday': 'Today & Yesterday',
        'last_7_days': 'Last 7 days',
        'last_14_days': 'Last 14 days',
        'last_28_days': 'Last 28 days',
        'last_30_days': 'Last 30 days',
        'this_week': 'This week',
        'last_week': 'Last week',
        'this_month': 'This month',
        'last_month': 'Last month',
        'maximum': 'Maximum'
      };
      return presetLabels[filteredLeadsSelectedDateRange] || 'Last 7 days';
    }
    return 'Last 7 days';
  };

  // Content Marketing Date Range filter handler
  const handleContentDateRangeApply = (payload) => {
    
    // Validate dates before setting
    if (!payload.start_date || !payload.end_date) {
      console.error('[ContentDateRangeFilter] Invalid dates received:', payload);
      alert('Invalid date range selected. Please try again.');
      return;
    }
    
    // Validate date format (YYYY-MM-DD)
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(payload.start_date) || !dateRegex.test(payload.end_date)) {
      console.error('[ContentDateRangeFilter] Invalid date format:', {
        start_date: payload.start_date,
        end_date: payload.end_date
      });
      alert('Invalid date format. Please try again.');
      return;
    }
    
    setContentDateRangeFilterValue(payload);
    setContentDateRange(payload.range_type || 'custom');
    
    // Update content filters
    setContentFilters({
      startDate: payload.start_date,
      endDate: payload.end_date
    });
    
    // Close the modal
    setShowContentDateRangeFilter(false);
  };

  // Follower Growth Rate (Content Marketing): derive from daily new followers + current followers
  const followerGrowthResult = useMemo(() => {
    const dailyList =
      performanceInsightsData?.data?.daily_subscriber_change ??
      performanceInsightsData?.daily_subscriber_change ??
      (Array.isArray(performanceInsightsData?.fan_adds) ? performanceInsightsData.fan_adds : []);
    const dailyFollowersArray = Array.isArray(dailyList)
      ? dailyList.map((item) => ({
          date: item?.date,
          value: Math.max(0, Number(item?.val ?? item?.value) || 0),
        }))
      : [];
    const currentFollowersCount =
      performanceInsightsData?.totalFollows ??
      performanceInsightsData?.total_follows ??
      performanceInsightsData?.current_followers ??
      0;
    return calculateFollowerGrowthRate(dailyFollowersArray, currentFollowersCount);
  }, [performanceInsightsData]);

  // Helper to get display text for content date range
  const getContentDateRangeDisplay = () => {
    if (contentDateRangeFilterValue) {
      if (contentDateRangeFilterValue.range_type === 'custom' || contentDateRangeFilterValue.range_type === 'single_day') {
        const start = new Date(contentDateRangeFilterValue.start_date);
        const end = new Date(contentDateRangeFilterValue.end_date);
        const startDisplay = start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        const endDisplay = end.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        if (contentDateRangeFilterValue.start_date === contentDateRangeFilterValue.end_date) {
          return startDisplay;
        }
        return `${startDisplay} - ${endDisplay}`;
      }
      const presetLabels = {
        'today': 'Today',
        'yesterday': 'Yesterday',
        'single_day': 'Single day',
        'today_yesterday': 'Today & Yesterday',
        'last_7_days': 'Last 7 days',
        'last_14_days': 'Last 14 days',
        'last_28_days': 'Last 28 days',
        'last_30_days': 'Last 30 days',
        'this_week': 'This week',
        'last_week': 'Last week',
        'this_month': 'This month',
        'last_month': 'Last month',
        'maximum': 'Maximum'
      };
      return presetLabels[contentDateRangeFilterValue.range_type] || contentDateRange;
    }
    const presetLabels = {
      'last_7_days': 'Last 7 days',
      'last_14_days': 'Last 14 days',
      'last_30_days': 'Last 30 days',
      'this_week': 'This week',
      'last_week': 'Last week',
      'this_month': 'This month',
      'last_month': 'Last month'
    };
    return presetLabels[contentDateRange] || 'Last 7 days';
  };

  // Chart Time Range filter handler for "Account Reach by Followers Count"
  const handleChartTimeRangeApply = (payload) => {
    
    // Validate dates before setting
    if (!payload.start_date || !payload.end_date) {
      console.error('[ChartTimeRangeFilter] Invalid dates received:', payload);
      alert('Invalid date range selected. Please try again.');
      return;
    }
    
    // Validate date format (YYYY-MM-DD)
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(payload.start_date) || !dateRegex.test(payload.end_date)) {
      console.error('[ChartTimeRangeFilter] Invalid date format:', {
        start_date: payload.start_date,
        end_date: payload.end_date
      });
      alert('Invalid date format. Please try again.');
      return;
    }
    
    setChartTimeRangeFilterValue(payload);
    setChartTimeRangeValue(payload.range_type || 'custom');
    
    // Update chart time range filters
    setChartTimeRange({
      startDate: payload.start_date,
      endDate: payload.end_date
    });
    
    // Close the modal
    setShowChartTimeRangeFilter(false);
  };

  // Helper to get display text for chart time range
  const getChartTimeRangeDisplay = () => {
    if (chartTimeRangeFilterValue) {
      if (chartTimeRangeFilterValue.range_type === 'custom') {
        const start = new Date(chartTimeRangeFilterValue.start_date);
        const end = new Date(chartTimeRangeFilterValue.end_date);
        const startDisplay = start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        const endDisplay = end.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        return `${startDisplay} - ${endDisplay}`;
      }
      const presetLabels = {
        'today': 'Today',
        'yesterday': 'Yesterday',
        'today_yesterday': 'Today & Yesterday',
        'last_7_days': 'Last 7 days',
        'last_14_days': 'Last 14 days',
        'last_28_days': 'Last 28 days',
        'last_30_days': 'Last 30 days',
        'this_week': 'This week',
        'last_week': 'Last week',
        'this_month': 'This month',
        'last_month': 'Last month',
        'maximum': 'Maximum'
      };
      return presetLabels[chartTimeRangeFilterValue.range_type] || chartTimeRangeValue;
    }
    const presetLabels = {
      'last_7_days': 'Last 7 days',
      'last_14_days': 'Last 14 days',
      'last_30_days': 'Last 30 days',
      'this_week': 'This week',
      'last_week': 'Last week',
      'this_month': 'This month',
      'last_month': 'Last month'
    };
    return presetLabels[chartTimeRangeValue] || 'Last 7 days';
  };

  // Date range filter handler
  const handleDateRangeApply = (payload) => {
    // Validate dates before setting
    if (!payload.start_date || !payload.end_date) {
      console.error('[DateRangeFilter] Invalid dates received:', payload);
      alert('Invalid date range selected. Please try again.');
      return;
    }
    
    // Validate date format (YYYY-MM-DD)
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(payload.start_date) || !dateRegex.test(payload.end_date)) {
      console.error('[DateRangeFilter] Invalid date format:', {
        start_date: payload.start_date,
        end_date: payload.end_date
      });
      alert('Invalid date format. Please try again.');
      return;
    }
    
    setDateRangeFilterValue(payload);
    setDateFilters({
      startDate: payload.start_date,
      endDate: payload.end_date
    });
    
    // Update selected date range label
    if (payload.range_type === 'custom') {
      const start = new Date(payload.start_date);
      const end = new Date(payload.end_date);
      const startDisplay = start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      const endDisplay = end.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      setSelectedDateRange(`${startDisplay} - ${endDisplay}`);
    } else {
      const presetLabels = {
        'today': 'Today',
        'yesterday': 'Yesterday',
        'today_yesterday': 'Today & Yesterday',
        'last_7_days': 'Last 7 days',
        'last_14_days': 'Last 14 days',
        'last_28_days': 'Last 28 days',
        'last_30_days': 'Last 30 days',
        'this_week': 'This week',
        'last_week': 'Last week',
        'this_month': 'This month',
        'last_month': 'Last month',
        'maximum': 'Maximum'
      };
      setSelectedDateRange(presetLabels[payload.range_type] || payload.range_type);
    }
    
    // Calculate days from date range
    const start = new Date(payload.start_date);
    const end = new Date(payload.end_date);
    const diffTime = Math.abs(end - start);
    const calculatedDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
    setDays(calculatedDays);
  };

  // Helper to format date range display
  const getDateRangeDisplay = () => {
    if (dateRangeFilterValue) {
      if (dateRangeFilterValue.range_type === 'custom') {
        const start = new Date(dateRangeFilterValue.start_date);
        const end = new Date(dateRangeFilterValue.end_date);
        const startDisplay = start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        const endDisplay = end.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        return `${startDisplay} - ${endDisplay}`;
      }
      const presetLabels = {
        'today': 'Today',
        'yesterday': 'Yesterday',
        'today_yesterday': 'Today & Yesterday',
        'last_7_days': 'Last 7 days',
        'last_14_days': 'Last 14 days',
        'last_28_days': 'Last 28 days',
        'last_30_days': 'Last 30 days',
        'this_week': 'This week',
        'last_week': 'Last week',
        'this_month': 'This month',
        'last_month': 'Last month',
        'maximum': 'Maximum'
      };
      return presetLabels[dateRangeFilterValue.range_type] || selectedDateRange;
    }
    
    // selectedDateRange is a string, check if it includes 'Week'
    return selectedDateRange.includes('Week') ? selectedDateRange : `${dateFilters.startDate ? 'Custom' : 'Select Date'}: ${selectedDateRange}`;
  };

  // Platform options
  const platformOptions = [
    { id: 'facebook', name: 'Facebook' },
    { id: 'instagram', name: 'Instagram' },
    { id: 'youtube', name: 'YouTube' },
  ];

  // New data for content marketing charts (live data; no mock fallbacks)

  // 1. Followers Count vs Page - When Instagram/Facebook selected use all 4 pages; else single page from insights
  const followersByPlatformData = useMemo(() => {
    if (isEngagementSourceSelected && contentMarketingAllPagesInsights?.length > 0) {
      return contentMarketingAllPagesInsights.map((p) => ({
        page: p.name,
        followers: p.current_followers || 0,
      }));
    }
    const insights = contentPageInsightsData || pageInsightsData;
    const pageId = contentMarketingPage || selectedPage;
    if (insights && insights.current_followers > 0) {
      const pageName = (pageId && pages.find(p => p.id === pageId)?.name) || (contentPageInsightsData ? 'Page' : 'Facebook');
      return [{ page: pageName, followers: insights.current_followers }];
    }
    return [];
  }, [isEngagementSourceSelected, contentMarketingAllPagesInsights, contentPageInsightsData, contentMarketingPage, pageInsightsData, selectedPage, pages]);

  // 2. Leads Count vs Source - From platform metrics (e.g. Wix) or preloaded Meta leads by campaign/source
  const leadsBySourceData = useMemo(() => {
    if (contentPlatformLeadsBySource?.length > 0 && contentPlatformLeadsBySource.some((e) => (e.leads || 0) > 0)) {
      return contentPlatformLeadsBySource.map((e) => ({ source: e.source || 'Other', leads: Number(e.leads) || 0 }));
    }
    const start = contentFilters?.startDate;
    const end = contentFilters?.endDate;
    if (!Array.isArray(preloadedLeads) || preloadedLeads.length === 0 || !start || !end) return [];
    const bySource = {};
    preloadedLeads.forEach((lead) => {
      const dateStr = lead.created_time ? lead.created_time.split('T')[0] : (lead.Date || lead.DateChar || '');
      if (dateStr && dateStr >= start && dateStr <= end) {
        const source = lead.campaign_name || lead.Campaign || 'Other';
        bySource[source] = (bySource[source] || 0) + 1;
      }
    });
    return Object.entries(bySource)
      .map(([source, leads]) => ({ source, leads }))
      .sort((a, b) => b.leads - a.leads);
  }, [contentPlatformLeadsBySource, preloadedLeads, contentFilters?.startDate, contentFilters?.endDate]);

  // 3. Organic Revenue vs Date - API returns period total only; show single point for selected range
  const organicRevenueByDateData = useMemo(() => {
    const total = contentMarketingRevenue?.totalRevenue;
    const start = contentFilters?.startDate;
    const end = contentFilters?.endDate;
    if (total == null || total === 0 || !start || !end) return [];
    const label = start === end ? formatDayMon(start) : [start, end].map((d) => formatDayMon(d)).join(' – ');
    return [{ date: label, revenue: total }];
  }, [contentMarketingRevenue?.totalRevenue, contentFilters?.startDate, contentFilters?.endDate]);

  // 4. Leads Count vs Date - From preloaded leads in content date range
  const leadsCountByDateData = useMemo(() => {
    const start = contentFilters?.startDate;
    const end = contentFilters?.endDate;
    if (!Array.isArray(preloadedLeads) || preloadedLeads.length === 0 || !start || !end) return [];
    const byDate = {};
    preloadedLeads.forEach((lead) => {
      const dateStr = lead.created_time ? lead.created_time.split('T')[0] : (lead.Date || lead.DateChar || '');
      if (dateStr && dateStr >= start && dateStr <= end) {
        byDate[dateStr] = (byDate[dateStr] || 0) + 1;
      }
    });
    const sorted = Object.entries(byDate).sort((a, b) => a[0].localeCompare(b[0]));
    return sorted.map(([dateStr, leads]) => ({ date: formatDayMon(dateStr), leads }));
  }, [preloadedLeads, contentFilters?.startDate, contentFilters?.endDate]);

  // 5. Account Reach by Followers Count - When Instagram/Facebook selected use all 4 pages; else single page
  const accountReachByFollowersData = useMemo(() => {
    if (isEngagementSourceSelected && contentMarketingAllPagesInsights?.length > 0) {
      return contentMarketingAllPagesInsights.map((p) => ({
        page: p.name,
        followers: p.current_followers || 0,
        reach: p.current_reach || 0,
      }));
    }
    const insights = contentPageInsightsData || pageInsightsData;
    const pageId = contentMarketingPage || selectedPage;
    if (insights && (insights.current_followers > 0 || insights.current_reach > 0)) {
      const pageName = (pageId && pages.find(p => p.id === pageId)?.name) || (contentPageInsightsData ? 'Page' : 'Facebook');
      return [{ page: pageName, followers: insights.current_followers || 0, reach: insights.current_reach || 0 }];
    }
    return [];
  }, [isEngagementSourceSelected, contentMarketingAllPagesInsights, contentPageInsightsData, contentMarketingPage, pageInsightsData, selectedPage, pages]);


  return (
    <div className="dashboard-wrapper">
      {/* Header with Theme Toggle */}
      <div className="dashboard-header">
        <div className="d-flex justify-content-between align-items-center flex-wrap gap-3">
          <div>
            <h1 className="dashboard-title">
              <span className="title-emoji">📊</span> Ads Analytics Dashboard
            </h1>
            <p className="dashboard-subtitle">Track your campaign performance in real-time</p>
          </div>
        </div>
      </div>

      {/* Campaign Saturation Alert Banner */}
      {saturationAlert && saturationAlert.saturated && saturationAlert.saturated.length > 0 && (
        <div
          className="saturation-alert-banner"
          role="alert"
          style={{
            margin: '0 24px 16px',
            padding: '14px 18px',
            background: '#fef2f2',
            border: '1px solid #fecaca',
            borderRadius: '8px',
            display: 'flex',
            alignItems: 'flex-start',
            gap: '12px',
          }}
        >
          <span style={{ fontSize: '1.25rem', flexShrink: 0 }} aria-hidden>⚠</span>
          <div style={{ flex: 1 }}>
            <strong style={{ color: '#b91c1c' }}>Campaign Saturation Detected</strong>
            <p style={{ margin: '6px 0 0 0', color: '#991b1b', fontSize: '0.9375rem' }}>
              {saturationAlert.saturated.slice(0, 3).map((c) => c.campaign_name || c.campaign_id).join(', ')}
              {saturationAlert.saturated.length > 3 && ` +${saturationAlert.saturated.length - 3} more`}.
              Recommendation: Change creatives or expand audience.
            </p>
            <a href="/ai-insights" style={{ marginTop: '8px', display: 'inline-block', color: '#b91c1c', fontWeight: 600, fontSize: '0.875rem' }}>
              Run analysis on AI Insights →
            </a>
          </div>
        </div>
      )}

      {/* Toast Notifications */}
      {toast && (
        <>
          <style>
            {`
              @keyframes slideInRight {
                from {
                  transform: translateX(100%);
                  opacity: 0;
                }
                to {
                  transform: translateX(0);
                  opacity: 1;
                }
              }
              @keyframes slideOutRight {
                from {
                  transform: translateX(0);
                  opacity: 1;
                }
                to {
                  transform: translateX(100%);
                  opacity: 0;
                }
              }
            `}
          </style>
          <div
            style={{
              position: 'fixed',
              top: '20px',
              right: '20px',
              zIndex: 9999,
              minWidth: '320px',
              maxWidth: '500px',
              borderRadius: '8px',
              padding: '16px 20px',
              boxShadow: '0 4px 16px rgba(0,0,0,0.2)',
              display: 'flex',
              alignItems: 'flex-start',
              gap: '14px',
              backgroundColor: toast.type === 'success' ? '#4caf50' : 
                             toast.type === 'warning' ? '#8b6914' : 
                             '#d32f2f',
              color: 'white',
              animation: 'slideInRight 0.3s ease-out',
              fontFamily: 'system-ui, -apple-system, sans-serif'
            }}
          >
            {/* Icon */}
            <div style={{ 
              fontSize: '22px', 
              flexShrink: 0, 
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '28px',
              height: '28px'
            }}>
              {toast.type === 'success' && (
                <span style={{ 
                  display: 'inline-flex', 
                  alignItems: 'center', 
                  justifyContent: 'center',
                  width: '24px',
                  height: '24px',
                  borderRadius: '50%',
                  backgroundColor: 'rgba(255,255,255,0.25)',
                  color: 'white',
                  fontSize: '16px',
                  fontWeight: 'bold'
                }}>✓</span>
              )}
              {toast.type === 'warning' && (
                <span style={{ 
                  display: 'inline-block',
                  fontSize: '22px',
                  lineHeight: '1'
                }}>⚠</span>
              )}
              {toast.type === 'error' && (
                <span style={{ 
                  display: 'inline-block',
                  fontSize: '22px',
                  lineHeight: '1'
                }}>⚠</span>
              )}
            </div>
            
            {/* Content */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ 
                fontWeight: 'bold', 
                fontSize: '16px', 
                marginBottom: '6px',
                lineHeight: '1.3'
              }}>
                {toast.title}
              </div>
              <div style={{ 
                fontSize: '14px', 
                lineHeight: '1.5',
                marginBottom: toast.link ? '8px' : '0',
                opacity: 0.95
              }}>
                {toast.message}
              </div>
              {toast.link && (
                <a
                  href={toast.link}
                  style={{
                    color: 'white',
                    textDecoration: 'underline',
                    fontSize: '14px',
                    fontWeight: '500',
                    display: 'inline-block',
                    marginTop: '4px'
                  }}
                >
                  {toast.linkText || toast.link}
                </a>
              )}
            </div>
            
            {/* Close Button */}
          <button
            type="button"
              onClick={() => setToast(null)}
              style={{
                background: 'none',
                border: 'none',
                color: 'white',
                fontSize: '20px',
                cursor: 'pointer',
                padding: '0',
                marginLeft: '8px',
                flexShrink: 0,
                opacity: 0.85,
                transition: 'opacity 0.2s',
                lineHeight: '1',
                width: '20px',
                height: '20px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}
              onMouseEnter={(e) => e.target.style.opacity = '1'}
              onMouseLeave={(e) => e.target.style.opacity = '0.85'}
            aria-label="Close"
            >
              ×
            </button>
        </div>
        </>
      )}

      {/* Filters */}
      <div className="filter-card">
        <div className="filter-card-body">
          <div className="row g-3 align-items-center">
            <div className="col-12 col-md-auto">
              <label className="filter-label">
                <span className="filter-emoji">🌐</span> Platform
              </label>
              <select
                className="form-select form-select-sm"
                value={selectedPlatform || ''}
                onChange={(e) => {
                  setSelectedPlatform(e.target.value || null);
                  setPage(1);
                }}
                style={{ 
                  fontSize: '0.875rem', 
                  height: '36px',
                  borderRadius: '5px',
                  border: '1px solid rgba(0, 0, 0, 0.1)',
                  background: 'var(--card, #ffffff)'
                }}
              >
                <option value="">All Platforms</option>
                {platformOptions.map(platform => (
                  <option key={platform.id} value={platform.id}>
                    {platform.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="col-12 col-md-auto">
              <label className="filter-label">
                <span className="filter-emoji">📅</span> Time Range
              </label>
              <button
                type="button"
                className="d-flex align-items-center gap-2 px-3 py-2 border shadow-sm cursor-pointer"
                onClick={() => setShowDateRangeFilter(true)}
                  style={{
                    borderRadius: '5px',
                    color: 'var(--text, #64748b)',
                    borderColor: 'rgba(0, 0, 0, 0.1)',
                    transition: 'all 0.2s ease',
                    height: '36px',
                  minWidth: '180px',
                  border: '1px solid rgba(0, 0, 0, 0.1)',
                  background: 'var(--card, #ffffff)',
                  width: '100%'
                  }}
                >
                  <i className="far fa-calendar-alt text-secondary opacity-75"></i>
                  <span className="fw-medium small text-dark flex-grow-1 text-center" style={{ fontSize: '0.8rem' }}>
                  {getDateRangeDisplay()}
                  </span>
                  <i className="fas fa-chevron-down text-secondary opacity-50 small"></i>
                      </button>
                </div>
            {/* All Projects - two-column dropdown (projects left, accounts on hover right) */}
            <div className="col-12 col-md-auto filter-block projects-dropdown-wrapper">
              <label className="filter-label"><span className="filter-emoji">📁</span> All Projects</label>
              <div className="projects-dropdown" ref={projectsDropdownRef}>
                <button
                  type="button"
                  className="projects-dropdown-trigger"
                  onClick={() => setProjectsDropdownOpen((o) => !o)}
                  aria-expanded={projectsDropdownOpen}
                  aria-haspopup="listbox"
                >
                  <span className="projects-dropdown-trigger-text">
                    {selectedProject || 'All Projects'}
                  </span>
                  <i className="fas fa-chevron-down text-secondary opacity-50 small"></i>
                </button>
                {projectsDropdownOpen && (
                  <div className="projects-dropdown-panel">
                    <div
                      className="projects-dropdown-left"
                      onMouseLeave={() => setHoveredProject(null)}
                    >
                      <div
                        className={`projects-dropdown-project-row${selectedProject === '' ? ' projects-dropdown-project-row-selected' : ''}`}
                        onMouseEnter={() => setHoveredProject('')}
                        onClick={() => { setSelectedProject(''); setProjectsDropdownOpen(false); }}
                      >
                        All Projects
                      </div>
                      {PROJECT_ORDER.map((projectName) => (
                        <div
                          key={projectName}
                          className={`projects-dropdown-project-row${selectedProject === projectName ? ' projects-dropdown-project-row-selected' : ''}`}
                          onMouseEnter={() => setHoveredProject(projectName)}
                          onClick={() => { setSelectedProject(projectName); setProjectsDropdownOpen(false); }}
                        >
                          {projectName}
                        </div>
                      ))}
                    </div>
                    <div className="projects-dropdown-right">
                      {(hoveredProject === '' || (hoveredProject === null && selectedProject === '')) ? (
                        <div className="projects-dropdown-all-accounts">
                          {PROJECT_ORDER.map((projectName) => {
                            const accounts = adAccountsByProject[projectName] || [];
                            return (
                              <div key={projectName} className="projects-dropdown-project-group">
                                <div className="projects-dropdown-group-label">{projectName}</div>
                                {accounts.length === 0 ? (
                                  <span className="projects-dropdown-placeholder small">No accounts matched</span>
                                ) : (
                                  <ul className="projects-dropdown-account-list">
                                    {accounts.map((acct, idx) => (
                                      <li key={`${projectName}-${acct.value}-${idx}`} className="projects-dropdown-account-item">{acct.displayName}</li>
                                    ))}
                                  </ul>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      ) : hoveredProject === null ? (
                        <span className="projects-dropdown-placeholder">Select a project to see accounts</span>
                      ) : (adAccountsByProject[hoveredProject] || []).length === 0 ? (
                        <span className="projects-dropdown-placeholder">No accounts matched</span>
                      ) : (
                        <ul className="projects-dropdown-account-list">
                          {(adAccountsByProject[hoveredProject] || []).map((acct, idx) => (
                            <li key={`${hoveredProject}-${acct.value}-${idx}`} className="projects-dropdown-account-item">{acct.displayName}</li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
            <div className="col-12 col-md-auto dashboard-filter-col-stable">
              <MultiSelectFilter
                label="Ad Account"
                emoji="🏢"
                options={selectedProject ? accountsForProject : (specifiedAdAccounts || [])}
                selectedValues={selectedAdAccounts}
                onChange={(values) => {
                  setSelectedAdAccounts(values);
                  setSelectedCampaigns([]);
                  setSelectedAds([]);
                  setCampaigns([]);
                  setAds([]);
                  setPage(1);
                }}
                placeholder="All Ad Accounts"
                getOptionLabel={(opt) => opt.account_name || opt.name || `Account ${opt.account_id || opt.id}`}
                getOptionValue={(opt) => normalizeAccountId(opt.account_id || opt.id)}
                disabled={adAccountsLoading}
                loading={adAccountsLoading}
              />
            </div>
            <div className="col-12 col-md-auto dashboard-filter-col-stable dashboard-filter-col-campaign">
              <MultiSelectFilter
                label="Campaign"
                emoji="🎯"
                options={campaigns}
                selectedValues={selectedCampaigns}
                onChange={(values) => {
                  setSelectedCampaigns(values);
                  setSelectedAds([]); // Reset ad selection when campaign changes
                  setPage(1);
                }}
                placeholder="All Campaigns"
                getOptionLabel={(opt) => opt.name}
                getOptionValue={(opt) => opt.id}
                getOptionStatus={(opt) => opt.effective_status || opt.status || ''}
                disabled={campaignsLoading}
                loading={campaignsLoading}
              />
            </div>
            <div className="col-12 col-md-auto dashboard-filter-col-stable ad-name-filter-col">
              <MultiSelectFilter
                label="Ad Name"
                emoji="📢"
                options={ads}
                selectedValues={selectedAds}
                onChange={(values) => {
                  setSelectedAds(values);
                  setPage(1);
                }}
                placeholder="All Ads"
                getOptionLabel={(opt) => opt.name}
                getOptionValue={(opt) => opt.id}
                getOptionStatus={(opt) => opt.effective_status || opt.status || ''}
                disabled={adsLoading}
                loading={adsLoading}
              />
            </div>
            <div className="col-12 col-md-auto ms-md-auto d-flex gap-2">
              <button
                className="refresh-btn"
                onClick={() => load(false)}
                disabled={loading}
              >
                <span className="refresh-emoji">{loading ? "⏳" : "🔄"}</span>
                {loading ? "Refreshing..." : "Refresh Data"}
              </button>
              <button
                className="refresh-btn btn-outline-primary"
                onClick={async () => {
                  await loadAdAccounts(true);
                  load(true);
                }}
                disabled={loading}
                title="Fetch latest from Meta (includes ad accounts + video metrics e.g. Hook/Hold rate)"
              >
                <span className="refresh-emoji">{loading ? "⏳" : "🔄"}</span>
                {loading ? "Refreshing..." : "Refresh with live data"}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* YouTube Metrics (only when Platform = YouTube) */}
      {selectedPlatform === 'youtube' && (
        <>
          <div className="row g-3 mb-3 align-items-center">
            <div className="col">
              <h5 className="mb-0 text-dark d-flex align-items-center gap-2">
                <span className="filter-emoji">📺</span> YouTube Ads Metrics
              </h5>
              <small className="text-muted">From YouTube / Google Ads for selected date range</small>
            </div>
            {youtubeMetricsError && (
              <div className="col-auto">
                <span className="text-danger small">{youtubeMetricsError}</span>
              </div>
            )}
          </div>
          {/* 2x5 card layout: Row 1 */}
          <div className="row g-3 mb-3 row-cols-1 row-cols-sm-2 row-cols-lg-5">
            <div className="col">
              <div className="kpi-card kpi-card-primary">
                <div className="kpi-card-body">
                  <div className="kpi-icon">💰</div>
                  <small className="kpi-label">Cost / Amount Spent</small>
                  <div className="kpi-value">{youtubeMetricsLoading ? '…' : formatMoney(youtubeMetrics?.summary?.cost)}</div>
                </div>
              </div>
            </div>
            <div className="col">
              <div className="kpi-card kpi-card-success">
                <div className="kpi-card-body">
                  <div className="kpi-icon">👥</div>
                  <small className="kpi-label">Conversions / Leads</small>
                  <div className="kpi-value">{youtubeMetricsLoading ? '…' : formatNum(youtubeMetrics?.summary?.leads ?? youtubeMetrics?.summary?.conversions)}</div>
                </div>
              </div>
            </div>
            <div className="col">
              <div className="kpi-card kpi-card-warning">
                <div className="kpi-card-body">
                  <div className="kpi-icon">💵</div>
                  <small className="kpi-label">Cost per Conversion / CPL</small>
                  <div className="kpi-value">{youtubeMetricsLoading ? '…' : formatMoney(youtubeMetrics?.summary?.cpl)}</div>
                </div>
              </div>
            </div>
            <div className="col">
              <div className="kpi-card kpi-card-info">
                <div className="kpi-card-body">
                  <div className="kpi-icon">👁️</div>
                  <small className="kpi-label">CPM</small>
                  <div className="kpi-value">{youtubeMetricsLoading ? '…' : `₹${formatNum(youtubeMetrics?.summary?.cpm)}`}</div>
                </div>
              </div>
            </div>
            <div className="col">
              <div className="kpi-card kpi-card-teal">
                <div className="kpi-card-body">
                  <div className="kpi-icon">📋</div>
                  <small className="kpi-label">Opt-in Rate</small>
                  <div className="kpi-value">{youtubeMetricsLoading ? '…' : formatPerc(youtubeMetrics?.summary?.optInRate)}</div>
                </div>
              </div>
            </div>
          </div>
          {/* Row 2 */}
          <div className="row g-3 mb-4 row-cols-1 row-cols-sm-2 row-cols-lg-5">
            <div className="col">
              <div className="kpi-card kpi-card-success">
                <div className="kpi-card-body">
                  <div className="kpi-icon">🔗</div>
                  <small className="kpi-label">Link Clicks</small>
                  <div className="kpi-value">{youtubeMetricsLoading ? '…' : formatNum(youtubeMetrics?.summary?.linkClicks)}</div>
                </div>
              </div>
            </div>
            <div className="col">
              <div className="kpi-card kpi-card-purple">
                <div className="kpi-card-body">
                  <div className="kpi-icon">🖱️</div>
                  <small className="kpi-label">CTR</small>
                  <div className="kpi-value">{youtubeMetricsLoading ? '…' : formatPerc(youtubeMetrics?.summary?.ctr)}</div>
                </div>
              </div>
            </div>
            <div className="col">
              <div className="kpi-card kpi-card-orange">
                <div className="kpi-card-body">
                  <div className="kpi-icon">📈</div>
                  <small className="kpi-label">ROAS</small>
                  <div className="kpi-value">{youtubeMetricsLoading ? '…' : `${formatNum(youtubeMetrics?.summary?.roas)}x`}</div>
                </div>
              </div>
            </div>
            <div className="col">
              <div className="kpi-card kpi-card-warning">
                <div className="kpi-card-body">
                  <div className="kpi-icon">✅</div>
                  <small className="kpi-label">Total Conversions</small>
                  <div className="kpi-value">{youtubeMetricsLoading ? '…' : formatNum(youtubeMetrics?.summary?.totalConversions)}</div>
                </div>
              </div>
            </div>
            <div className="col">
              <div className="kpi-card kpi-card-pink">
                <div className="kpi-card-body">
                  <div className="kpi-icon">📊</div>
                  <small className="kpi-label">Conversion Rate %</small>
                  <div className="kpi-value">{youtubeMetricsLoading ? '…' : formatPerc(youtubeMetrics?.summary?.conversionRate)}</div>
                </div>
              </div>
            </div>
          </div>
          {/* First row: Opt-in Rate vs Cost, Leads vs CPL */}
          <div className="row g-4 mb-4">
            <div className="col-12 col-lg-6">
              <div className="chart-card">
                <div className="chart-card-body">
                  <strong className="chart-title"><span className="chart-emoji">📈</span> Opt-in Rate vs Cost / Amount Spent</strong>
                  <div className="chart-container" style={{ minHeight: 280 }}>
                    {youtubeMetrics?.chartOptInRateVsCost?.length > 0 ? (
                      <ResponsiveContainer width="100%" height={280}>
                        <ComposedChart data={youtubeMetrics.chartOptInRateVsCost} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                          <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                          <YAxis yAxisId="left" tick={{ fontSize: 10 }} />
                          <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10 }} />
                          <Tooltip />
                          <Legend />
                          <Bar yAxisId="left" dataKey="cost" fill="#4F46E5" name="Cost (₹)" radius={[4, 4, 0, 0]} />
                          <Line yAxisId="right" type="monotone" dataKey="optInRate" stroke="#10B981" strokeWidth={2} name="Opt-in Rate (%)" dot={{ r: 3 }} />
                        </ComposedChart>
                      </ResponsiveContainer>
                    ) : (
                      <div className="d-flex align-items-center justify-content-center text-muted" style={{ height: 280 }}>{youtubeMetricsLoading ? 'Loading…' : 'No data'}</div>
                    )}
                  </div>
                </div>
              </div>
            </div>
            <div className="col-12 col-lg-6">
              <div className="chart-card">
                <div className="chart-card-body">
                  <strong className="chart-title"><span className="chart-emoji">👥</span> Leads vs CPL</strong>
                  <div className="chart-container" style={{ minHeight: 280 }}>
                    {youtubeMetrics?.chartLeadsVsCpl?.length > 0 ? (
                      <ResponsiveContainer width="100%" height={280}>
                        <ComposedChart data={youtubeMetrics.chartLeadsVsCpl} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                          <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                          <YAxis yAxisId="left" tick={{ fontSize: 10 }} />
                          <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10 }} />
                          <Tooltip />
                          <Legend />
                          <Bar yAxisId="left" dataKey="leads" fill="#10B981" name="Leads" radius={[4, 4, 0, 0]} />
                          <Line yAxisId="right" type="monotone" dataKey="cpl" stroke="#F59E0B" strokeWidth={2} name="CPL (₹)" dot={{ r: 3 }} />
                        </ComposedChart>
                      </ResponsiveContainer>
                    ) : (
                      <div className="d-flex align-items-center justify-content-center text-muted" style={{ height: 280 }}>{youtubeMetricsLoading ? 'Loading…' : 'No data'}</div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
          {/* Second row: Link Clicks vs Landing Page Views */}
          <div className="row g-4 mb-4">
            <div className="col-12">
              <div className="chart-card">
                <div className="chart-card-body">
                  <strong className="chart-title"><span className="chart-emoji">🔗</span> Link Clicks vs Landing Page Views</strong>
                  <div className="chart-container" style={{ minHeight: 280 }}>
                    {youtubeMetrics?.chartLinkClicksVsLandingPageViews?.length > 0 ? (
                      <ResponsiveContainer width="100%" height={280}>
                        <AreaChart data={youtubeMetrics.chartLinkClicksVsLandingPageViews} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                          <defs>
                            <linearGradient id="ytLinkClicks" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#4F46E5" stopOpacity={0.4} /><stop offset="95%" stopColor="#4F46E5" stopOpacity={0} /></linearGradient>
                            <linearGradient id="ytLandingViews" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#10B981" stopOpacity={0.4} /><stop offset="95%" stopColor="#10B981" stopOpacity={0} /></linearGradient>
                          </defs>
                          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                          <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                          <YAxis tick={{ fontSize: 10 }} />
                          <Tooltip />
                          <Legend />
                          <Area type="monotone" dataKey="linkClicks" stroke="#4F46E5" fill="url(#ytLinkClicks)" name="Link Clicks" />
                          <Area type="monotone" dataKey="landingPageViews" stroke="#10B981" fill="url(#ytLandingViews)" name="Landing Page Views" />
                        </AreaChart>
                      </ResponsiveContainer>
                    ) : (
                      <div className="d-flex align-items-center justify-content-center text-muted" style={{ height: 280 }}>{youtubeMetricsLoading ? 'Loading…' : 'No data'}</div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </>
      )}

      {/* KPI Row - Animated Cards (Meta / other platforms) */}
      {selectedPlatform !== 'youtube' && (
      <>
      <div className="row g-3 mb-4">
        {/* 1. Ad Spend */}
        <div className="col-6 col-md-4 col-lg-3 col-xl">
          <div className="kpi-card kpi-card-primary">
            <div className="kpi-card-body">
              <div className="kpi-icon">💰</div>
              <small className="kpi-label">Ad Spend</small>
              <div className="kpi-value">{formatMoney(totals.spend)}</div>
              <small className="kpi-change kpi-change-positive">
                ↑ 12.5%
              </small>
            </div>
          </div>
        </div>

        {/* 2. Total Leads */}
        <div className="col-6 col-md-4 col-lg-3 col-xl">
          <div className="kpi-card kpi-card-success">
            <div className="kpi-card-body">
              <div className="kpi-icon">👥</div>
              <small className="kpi-label">Total Leads</small>
              <div className="kpi-value">{formatNum(totals.leads)}</div>
              <small className="kpi-subtitle">Volume</small>
            </div>
          </div>
        </div>

        {/* 3. Unique Leads */}
        {/*<div className="col-6 col-md-4 col-lg-3 col-xl">
          <div className="kpi-card kpi-card-info">
            <div className="kpi-card-body">
              <div className="kpi-icon">✨</div>
              <small className="kpi-label">Unique Leads</small>
              <div className="kpi-value">{formatNum(totals.uniqueLeads)}</div>
              <small className="kpi-subtitle">New</small>
            </div>
          </div>
        </div>*/}

        {/* 4. CPL */}
        <div className="col-6 col-md-4 col-lg-3 col-xl">
          <div className="kpi-card kpi-card-warning">
            <div className="kpi-card-body">
              <div className="kpi-icon">💵</div>
              <small className="kpi-label">Cost Per Lead</small>
              <div className="kpi-value">{formatMoney(totals.cpl)}</div>
              <small className="kpi-subtitle">Target: ₹5.00</small>
            </div>
          </div>
        </div>

        {/* 5. CTR */}
        <div className="col-6 col-md-4 col-lg-3 col-xl">
          <div className="kpi-card kpi-card-purple">
            <div className="kpi-card-body">
              <div className="kpi-icon">🖱️</div>
              <small className="kpi-label">CTR (Link)</small>
              <div className="kpi-value">{formatPerc(totals.ctr)}</div>
              <small className="kpi-subtitle">Click Rate</small>
            </div>
          </div>
        </div>

        {/* 6. Hook Rate — use video-performance API when available, else insights-derived */}
        <div className="col-6 col-md-4 col-lg-3 col-xl">
          <div className="kpi-card kpi-card-teal">
            <div className="kpi-card-body">
              <div className="kpi-icon">🎣</div>
              <small className="kpi-label">Hook Rate</small>
              <div className="kpi-value">{formatPerc(totals.hookRate)}</div>
              <small className="kpi-subtitle">3s views ÷ impressions · else plays ÷ impressions</small>
            </div>
          </div>
        </div>

        {/* 7. Hold Rate — use video-performance API when available, else insights-derived */}
        <div className="col-6 col-md-4 col-lg-3 col-xl">
          <div className="kpi-card kpi-card-pink">
            <div className="kpi-card-body">
              <div className="kpi-icon">⏸️</div>
              <small className="kpi-label">Hold Rate</small>
              <div className="kpi-value">{formatPerc(totals.holdRate)}</div>
              <small className="kpi-subtitle">100% Watched / Video Play</small>
            </div>
          </div>
        </div>

        {/* 8. ROAS */}
        <div className="col-6 col-md-4 col-lg-3 col-xl">
          <div className="kpi-card kpi-card-orange">
            <div className="kpi-card-body">
              <div className="kpi-icon">📈</div>
              <small className="kpi-label">ROAS</small>
              <div className="kpi-value">{formatNum(totals.roas)}x</div>
              <small className="kpi-subtitle">Return on Ad Spend</small>
            </div>
          </div>
        </div>
      </div>

      {/* Additional Metrics Row */}
      <div className="row g-3 mb-4">
        {/* Impressions */}
        <div className="col-6 col-md-4 col-lg-3 col-xl">
          <div className="kpi-card kpi-card-info">
            <div className="kpi-card-body">
              <div className="kpi-icon">👁️</div>
              <small className="kpi-label">Impressions</small>
              <div className="kpi-value">{formatNum(totals.impressions)}</div>
              <small className="kpi-subtitle">Views</small>
            </div>
          </div>
        </div>

        {/* Clicks */}
        <div className="col-6 col-md-4 col-lg-3 col-xl">
          <div className="kpi-card kpi-card-success">
            <div className="kpi-card-body">
              <div className="kpi-icon">🖱️</div>
              <small className="kpi-label">Clicks</small>
              <div className="kpi-value">{formatNum(totals.clicks)}</div>
              <small className="kpi-subtitle">Total Clicks</small>
            </div>
          </div>
        </div>

        {/* Conversions */}
        <div className="col-6 col-md-4 col-lg-3 col-xl">
          <div className="kpi-card kpi-card-warning">
            <div className="kpi-card-body">
              <div className="kpi-icon">✅</div>
              <small className="kpi-label">Conversions</small>
              <div className="kpi-value">{formatNum(totals.conversions)}</div>
              <small className="kpi-subtitle">Total Conversions</small>
            </div>
          </div>
        </div>

        {/* Conversion Rate */}
        <div className="col-6 col-md-4 col-lg-3 col-xl">
          <div className="kpi-card kpi-card-purple">
            <div className="kpi-card-body">
              <div className="kpi-icon">📊</div>
              <small className="kpi-label">Conversion Rate</small>
              <div className="kpi-value">{formatPerc(totals.clicks > 0 ? (totals.conversions / totals.clicks) * 100 : 0)}</div>
              <small className="kpi-subtitle">Clicks to Conversions</small>
            </div>
          </div>
        </div>
      </div>

      {/* Revenue Row */}
      <div className="row g-3 mb-4">
        {/* Online Conversion */}
        <div className="col-6 col-md-4 col-lg-2 col-xl">
          <div className="revenue-card revenue-card-online">
            <div className="revenue-card-body">
              <div className="revenue-icon">🛒</div>
              <small className="revenue-label">Online Conversion</small>
              <div className="revenue-value">{formatNum(totals.onlineConv)}</div>
            </div>
          </div>
        </div>

        {/* Offline Conversion */}
        <div className="col-6 col-md-4 col-lg-2 col-xl">
          <div className="revenue-card revenue-card-offline">
            <div className="revenue-card-body">
              <div className="revenue-icon">🏪</div>
              <small className="revenue-label">Offline Conversion</small>
              <div className="revenue-value">{formatNum(totals.offlineConv)}</div>
            </div>
          </div>
        </div>

        {/* L1 Revenue */}
        <div className="col-6 col-md-4 col-lg-2 col-xl">
          <div className="revenue-card revenue-card-l1">
            <div className="revenue-card-body">
              <div className="revenue-icon">💎</div>
              <small className="revenue-label">L1 Revenue</small>
              <div className="revenue-value">{formatMoney(totals.l1Revenue)}</div>
            </div>
          </div>
        </div>

        {/* L2 Revenue */}
        <div className="col-6 col-md-4 col-lg-2 col-xl">
          <div className="revenue-card revenue-card-l2">
            <div className="revenue-card-body">
              <div className="revenue-icon">💠</div>
              <small className="revenue-label">L2 Revenue</small>
              <div className="revenue-value">{formatMoney(totals.l2Revenue)}</div>
            </div>
          </div>
        </div>

        {/* Total Revenue */}
        <div className="col-6 col-md-4 col-lg-2 col-xl">
          <div className="revenue-card revenue-card-total">
            <div className="revenue-card-body">
              <div className="revenue-icon">💸</div>
              <small className="revenue-label">Total Revenue</small>
              <div className="revenue-value revenue-value-highlight">{formatMoney(totals.totalRevenue)}</div>
            </div>
          </div>
        </div>
      </div>
      </>
      )}

      {/* Charts (Meta - hidden when YouTube selected) */}
      {selectedPlatform !== 'youtube' && (
<div className="row g-4 mb-4">
        <div className="col-12 col-lg-6">
          <div className="chart-card">
            <div className="chart-card-body">
              <div className="d-flex justify-content-between align-items-center mb-3">
                <div>
                  <strong className="chart-title">
                    <span className="chart-emoji">📈</span> Leads over time
                  </strong>
                </div>
                <small className="chart-subtitle">
                  {days}-day range
                </small>
              </div>
              <div className="chart-container">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={timeseries} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="colorLeads" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#4F46E5" stopOpacity={0.4} />
                        <stop offset="95%" stopColor="#4F46E5" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                    <YAxis />
                    <CartesianGrid strokeDasharray="3 3" />
                    <Tooltip />
                    <Area 
                      type="monotone" 
                      dataKey="leads" 
                      stroke="#4F46E5" 
                      fill="url(#colorLeads)"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        </div>
        <div className="col-12 col-lg-6">
          <div className="chart-card">
            <div className="chart-card-body">
              <strong className="chart-title">
                <span className="chart-emoji">📊</span> Leads & CPL
              </strong>
              <div className="chart-container-large mt-3" style={{ height: '300px' }}>
                {timeseries && timeseries.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={timeseries} margin={{ top: 10, right: 20, left: 0, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                      <XAxis 
                        dataKey="date" 
                        tick={{ fontSize: 10, fill: '#64748b' }}
                        axisLine={false}
                        tickLine={false}
                        tickFormatter={formatDate}
                      />
                      <YAxis 
                        yAxisId="left"
                        tick={{ fontSize: 10, fill: '#64748b' }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <YAxis 
                        yAxisId="right"
                        orientation="right"
                        tick={{ fontSize: 10, fill: '#64748b' }}
                        axisLine={false}
                        tickLine={false}
                        tickFormatter={(value) => `₹${value.toFixed(0)}`}
                      />
                      <Tooltip 
                        contentStyle={{ 
                          borderRadius: '6px', 
                          border: 'none', 
                          boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                          padding: '8px',
                          backgroundColor: 'var(--card, #ffffff)'
                        }}
                        formatter={(value, name) => {
                          if (name === 'CPL (INR)') {
                            return [formatMoney(value), 'CPL (INR)'];
                          }
                          if (name === 'Leads') {
                            return [formatNum(value), 'Leads'];
                          }
                          return [formatNum(value), name];
                        }}
                        labelFormatter={(label) => `Date: ${formatDate(label)}`}
                      />
                      <Legend 
                        wrapperStyle={{ paddingTop: '8px', fontSize: '11px' }}
                        iconType="circle"
                      />
                      <Bar 
                        yAxisId="left"
                        dataKey="leads" 
                        name="Leads" 
                        fill="#6A4CAF"
                        radius={[8, 8, 0, 0]}
                        barSize={40}
                      />
                      <Line 
                        yAxisId="right"
                        type="monotone"
                        dataKey="cpl"
                        name="CPL (INR)" 
                        stroke="#10B981"
                        strokeWidth={2}
                        dot={{ fill: '#10B981', r: 3 }}
                        activeDot={{ r: 5 }}
                      />
                    </ComposedChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="d-flex align-items-center justify-content-center" style={{ height: '100%', color: '#64748b' }}>
                    <div className="text-center">
                      <p className="mb-2">No data available</p>
                      <small>Select a time range and campaigns to view Leads & CPL</small>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
        <div className="col-12 col-lg-12">
          <div className="chart-card">
            <div className="chart-card-body">
              <strong className="chart-title d-block mb-3">
                <span className="chart-emoji">🥧</span> Action Types (Breakdown)
              </strong>
              <div className="chart-container">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={actionBreakdown}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      outerRadius={90}
                      label
                    >
                      {actionBreakdown.map((entry, i) => (
                        <Cell 
                          key={`cell-${i}`} 
                          fill={COLORS[i % COLORS.length]}
                        />
                      ))}
                    </Pie>
                    <Tooltip />
                    <Legend verticalAlign="bottom" height={36} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        </div>
      </div>
      )}

      {/* Total Leads Table - Separate Row */}
      <div className="row g-4 mb-4">
        <div className="col-12">
          <div className="chart-card">
            <div className="chart-card-body">
              {/* Header Section with Title and Action Buttons */}
              <div className="d-flex flex-column flex-md-row justify-content-between align-items-start align-items-md-center mb-3 gap-2">
                <strong className="chart-title">
                  <span className="chart-emoji">👥</span> Total Leads Admin View
                </strong>
                <div className="d-flex gap-2 flex-wrap">
                  <div className="dropdown">
                    <button
                      className="btn btn-sm btn-outline-success dropdown-toggle"
                      type="button"
                      id="downloadLeadsDropdown"
                      data-bs-toggle="dropdown"
                      aria-expanded="false"
                      disabled={downloadingLeads || leadDetails.length === 0}
                      style={{ fontSize: '0.75rem' }}
                      title={leadDetails.length === 0 ? 'No leads available to download' : 'Download leads as CSV or Excel'}
                    >
                      {downloadingLeads ? (
                        <>
                          <span className="spinner-border spinner-border-sm me-1" role="status"></span>
                          <span className="d-none d-sm-inline">Downloading...</span>
                        </>
                      ) : (
                        <>
                          <i className="fas fa-download me-1"></i>
                          <span className="d-none d-sm-inline">Download Leads</span>
                          <span className="d-sm-none">Download</span>
                        </>
                      )}
                    </button>
                    <ul className="dropdown-menu" aria-labelledby="downloadLeadsDropdown">
                      <li>
                        <button
                          className="dropdown-item"
                          onClick={handleDownloadCSV}
                          disabled={downloadingLeads || leadDetails.length === 0}
                        >
                          <i className="fas fa-file-csv me-2"></i>
                          Download as CSV
                        </button>
                      </li>
                      <li>
                        <button
                          className="dropdown-item"
                          onClick={handleDownloadExcel}
                          disabled={downloadingLeads || leadDetails.length === 0}
                        >
                          <i className="fas fa-file-excel me-2"></i>
                          Download as Excel
                        </button>
                      </li>
                    </ul>
                  </div>
                  <button
                    className="btn btn-sm btn-outline-primary"
                    onClick={loadLeads}
                    disabled={leadsLoading || !dateFilters.startDate || !dateFilters.endDate}
                    style={{ fontSize: '0.75rem' }}
                    title="Manually refresh leads (requires date range to be selected)"
                  >
                    {leadsLoading ? (
                      <>
                        <span className="spinner-border spinner-border-sm me-1" role="status"></span>
                        <span className="d-none d-sm-inline">Loading...</span>
                      </>
                    ) : (
                      <>
                        <i className="fas fa-sync-alt me-1"></i>
                        Refresh
                      </>
                    )}
                  </button>
                </div>
              </div>
              
              {/* Alert Message Section */}
              {leadDetails.length === 0 && !leadsLoading && (
                <div className="alert alert-info mb-3" style={{ fontSize: '0.875rem', padding: '12px' }}>
                  <i className="fas fa-info-circle me-2"></i>
                  Leads will appear automatically after pre-loading.
                </div>
              )}
              
              {/* Table Section */}
              <div className="mt-3">
                {leadsLoading ? (
                  <div className="text-center py-5">
                    <div className="spinner-border text-primary" role="status">
                      <span className="visually-hidden">Loading leads...</span>
                    </div>
                    <p className="mt-3 text-muted">Loading leads from Meta API...</p>
                  </div>
                ) : (
                  <div className="table-responsive" style={{ maxHeight: '500px', overflowY: 'auto', WebkitOverflowScrolling: 'touch' }}>
                    <table className="table table-hover align-middle mb-0" style={{ fontSize: '0.8rem', width: '100%', tableLayout: 'auto' }}>
                        <thead className="table-light" style={{ position: 'sticky', top: 0, zIndex: 10 }}>
                          <tr>
                            <th className="fw-bold" style={{ fontSize: '0.7rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px', minWidth: '140px', whiteSpace: 'nowrap' }}>Date & Time</th>
                            <th className="fw-bold" style={{ fontSize: '0.7rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px', minWidth: '120px', maxWidth: '200px' }}>Campaign</th>
                            <th className="fw-bold" style={{ fontSize: '0.7rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px', minWidth: '120px', maxWidth: '200px' }}>Ad Name</th>
                            <th className="fw-bold" style={{ fontSize: '0.7rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px', minWidth: '120px', whiteSpace: 'nowrap' }}>Lead Name</th>
                            <th className="fw-bold" style={{ fontSize: '0.7rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px', minWidth: '110px', whiteSpace: 'nowrap' }}>Phone Number</th>
                            <th className="fw-bold" style={{ fontSize: '0.7rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px', minWidth: '100px' }}>Sugar Poll</th>
                            <th className="fw-bold" style={{ fontSize: '0.7rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px', minWidth: '80px', maxWidth: '120px' }}>City</th>
                            <th className="fw-bold" style={{ fontSize: '0.7rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px', minWidth: '100px', maxWidth: '150px' }}>Street</th>
                            <th className="fw-bold" style={{ fontSize: '0.7rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px', minWidth: '120px', maxWidth: '180px' }}>Form Name</th>
                          </tr>
                      </thead>
                      <tbody>
                        {leadDetails.length > 0 ? (
                          <>
                            {visibleLeads.map((lead, idx) => (
                              <tr key={lead.lead_id || lead.Id || lead.id || idx} style={{ cursor: 'pointer' }}>
                                <td style={{ color: '#64748b', whiteSpace: 'nowrap', fontSize: '0.75rem' }}>{formatDateTime(lead.Date || lead.date || lead.DateChar, lead.Time || lead.time || lead.TimeUtc || lead.created_time)}</td>
                                <td style={{ color: '#64748b', maxWidth: '200px' }}>
                                  <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={lead.campaign_name || 'N/A'}>
                                    {lead.campaign_name || 'N/A'}
                                  </div>
                                </td>
                                <td style={{ color: '#64748b', maxWidth: '200px' }}>
                                  <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={lead.ad_name || 'N/A'}>
                                    {lead.ad_name || 'N/A'}
                                  </div>
                                </td>
                                <td className="fw-medium" style={{ color: '#1e293b', maxWidth: '150px' }}>
                                  <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={lead.Name || lead.name || 'N/A'}>
                                    {lead.Name || lead.name || 'N/A'}
                                  </div>
                                </td>
                                <td style={{ color: '#64748b', whiteSpace: 'nowrap' }}>{lead.Phone || lead.phone || 'N/A'}</td>
                                <td style={{ color: '#64748b', maxWidth: '150px' }}>{lead.SugarPoll || lead.sugar_poll || (lead.field_data && lead.field_data['Sugar Poll']) || 'N/A'}</td>
                                <td style={{ color: '#64748b', maxWidth: '120px' }}>
                                  <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={lead.City || lead.city || 'N/A'}>
                                    {lead.City || lead.city || 'N/A'}
                                  </div>
                                </td>
                                <td style={{ color: '#64748b', maxWidth: '150px' }}>
                                  <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={lead.Street || lead.street || lead.address || 'N/A'}>
                                    {lead.Street || lead.street || lead.address || 'N/A'}
                                  </div>
                                </td>
                                <td style={{ color: '#64748b', maxWidth: '180px' }}>
                                  <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={lead.form_name || 'N/A'}>
                                    {lead.form_name || 'N/A'}
                                  </div>
                                </td>
                              </tr>
                            ))}
                            <tr className="table-active">
                              <td colSpan="9" className="fw-bold text-center" style={{ color: '#1e293b' }}>
                                Total Leads: {formatNum(leadDetails.length)} {totalPages > 1 && `(Page ${page} of ${totalPages})`}
                              </td>
                            </tr>
                          </>
                        ) : (
                          <tr>
                            <td colSpan="9" className="text-center py-4" style={{ color: '#64748b' }}>
                              {leadsLoading ? (
                                <span>Loading leads...</span>
                              ) : leadsError ? (
                                <div className="p-3">
                                  <div className="alert alert-warning mb-3" role="alert">
                                    <h6 className="alert-heading mb-2">
                                      <i className="fas fa-exclamation-triangle me-2"></i>
                                      {leadsError.type === 'permission' ? 'Permission Error' : 'Error'}
                                    </h6>
                                    <p className="mb-2">{leadsError.message}</p>
                                    {leadsError.details && (
                                      <small className="text-muted d-block mb-2">{leadsError.details}</small>
                                    )}
                                    {leadsError.type === 'permission' && (
                                      <div className="mt-3">
                                        <button 
                                          className="btn btn-sm btn-outline-secondary"
                                          onClick={() => {
                                            setLeadsError(null);
                                            loadLeads();
                                          }}
                                        >
                                          <i className="fas fa-redo me-1"></i>
                                          Retry
                                        </button>
                                      </div>
                                    )}
                                  </div>
                                  <div className="text-start mt-3" style={{ fontSize: '0.85rem' }}>
                                    <strong>Steps to fix:</strong>
                                    <ol className="mt-2 mb-0">
                                      <li>Go to <a href="https://developers.facebook.com/tools/explorer/" target="_blank" rel="noopener noreferrer">Facebook Graph API Explorer</a></li>
                                      <li>Select your app and generate a new access token</li>
                                      <li>Ensure <code>leads_retrieval</code> permission is selected</li>
                                      <li>Copy the new token and update <code>META_ACCESS_TOKEN</code> in server/.env file</li>
                                    </ol>
                                  </div>
                                </div>
                              ) : (
                                <div>
                                  <p className="mb-2">No leads data available.</p>
                                  <small className="text-muted">Please check your Meta API connection or filters.</small>
                                </div>
                              )}
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                )}
                {/* Pagination */}
                {leadDetails.length > 0 && totalPages > 1 && (
                  <div className="d-flex flex-column flex-sm-row justify-content-between align-items-start align-items-sm-center mt-3 gap-2">
                    <div>
                      <small className="text-muted">
                        Showing {((page - 1) * perPage) + 1} to {Math.min(page * perPage, leadDetails.length)} of {leadDetails.length} leads
                      </small>
                    </div>
                    <div className="d-flex gap-2">
                      <button
                        className="btn btn-sm btn-outline-secondary"
                        onClick={() => setPage(p => Math.max(1, p - 1))}
                        disabled={page === 1}
                      >
                        Previous
                      </button>
                      <button
                        className="btn btn-sm btn-outline-secondary"
                        onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                        disabled={page === totalPages}
                      >
                        Next
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* New Filtered Leads Table Section */}
      <div className="row g-4 mb-4">
        <div className="col-12">
          <div className="chart-card">
            <div className="chart-card-body">
              {/* Header with Title and Actions */}
              <div className="d-flex justify-content-between align-items-center mb-3">
                <strong className="chart-title">
                  <span className="chart-emoji">👥</span> Total Leads
                </strong>
              </div>

              {/* Filter Section */}
              <div className="row g-3 align-items-center flex-wrap mb-3" style={{ marginBottom: '1rem' }}>
                {/* Page Filter */}
                <div className="col-12 col-md-auto">
                  <label className="form-label small fw-bold text-uppercase text-muted mb-1" style={{ fontSize: '0.7rem', letterSpacing: '0.5px' }}>
                    <i className="fas fa-file-alt me-1"></i> PAGE
                  </label>
                  <select
                    className="form-select form-select-sm"
                    value={filteredLeadsPage || ''}
                    onChange={(e) => {
                      const pageId = e.target.value || null;
                      setFilteredLeadsPage(pageId);
                    }}
                    style={{
                      fontSize: '0.8rem',
                      minWidth: '200px',
                      backgroundColor: 'var(--card, #ffffff)',
                      color: 'var(--text, #1e293b)',
                      borderColor: 'var(--border-color, #cbd5e1)'
                    }}
                  >
                    <option value="">Select a Page</option>
                    {pages.map((page) => (
                      <option key={page.id} value={page.id}>
                        {page.name}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Form Filter */}
                <div className="col-12 col-md-auto">
                  <label className="form-label small fw-bold text-uppercase text-muted mb-1" style={{ fontSize: '0.7rem', letterSpacing: '0.5px' }}>
                    <i className="fas fa-edit me-1"></i> FORM
                  </label>
                  <select
                    className="form-select form-select-sm"
                    value={filteredLeadsForm || ''}
                    onChange={(e) => {
                      const formId = e.target.value || null;
                      setFilteredLeadsForm(formId);
                    }}
                    disabled={!filteredLeadsPage || filteredLeadsFormsLoading}
                    style={{
                      fontSize: '0.8rem',
                      minWidth: '200px',
                      backgroundColor: 'var(--card, #ffffff)',
                      color: 'var(--text, #1e293b)',
                      borderColor: 'var(--border-color, #cbd5e1)'
                    }}
                  >
                    <option value="">
                      {filteredLeadsFormsLoading ? 'Loading forms...' : filteredLeadsPage ? 'Select a Form' : 'Select a Page first'}
                    </option>
                    {filteredLeadsForms.map((form) => (
                      <option key={form.id} value={form.id}>
                        {form.name}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Time Range Filter */}
                <div className="col-12 col-md-auto">
                  <label className="form-label small fw-bold text-uppercase text-muted mb-1" style={{ fontSize: '0.7rem', letterSpacing: '0.5px' }}>
                    <i className="fas fa-calendar-alt me-1"></i> TIME RANGE
                  </label>
                  <button
                    className="btn btn-sm btn-outline-secondary d-flex align-items-center"
                    onClick={() => setShowFilteredLeadsDateRangeFilter(true)}
                    style={{
                      fontSize: '0.8rem',
                      minWidth: '180px',
                      justifyContent: 'space-between',
                      backgroundColor: 'var(--card, #ffffff)',
                      color: 'var(--text, #1e293b)',
                      borderColor: 'var(--border-color, #cbd5e1)'
                    }}
                  >
                    <span>{getFilteredLeadsTimeRangeDisplay()}</span>
                    <i className="fas fa-chevron-down ms-2"></i>
                  </button>
                </div>
              </div>

              {/* Table Actions */}
              <div className="d-flex justify-content-end align-items-center gap-2 mb-3">
                <div className="dropdown">
                  <button
                    className="btn btn-sm btn-outline-primary dropdown-toggle"
                    type="button"
                    id="filteredLeadsDownloadDropdown"
                    data-bs-toggle="dropdown"
                    aria-expanded="false"
                    disabled={downloadingFilteredLeads || filteredLeadsData.length === 0}
                  >
                    <i className="fas fa-download me-2"></i>
                    Download Leads
                  </button>
                  <ul className="dropdown-menu" aria-labelledby="filteredLeadsDownloadDropdown">
                    <li>
                      <button
                        className="dropdown-item"
                        onClick={handleDownloadFilteredLeadsCSV}
                        disabled={downloadingFilteredLeads || filteredLeadsData.length === 0}
                      >
                        <i className="fas fa-file-csv me-2"></i>
                        Download as CSV
                      </button>
                    </li>
                    <li>
                      <button
                        className="dropdown-item"
                        onClick={handleDownloadFilteredLeadsExcel}
                        disabled={downloadingFilteredLeads || filteredLeadsData.length === 0}
                      >
                        <i className="fas fa-file-excel me-2"></i>
                        Download as Excel
                      </button>
                    </li>
                  </ul>
                </div>
                <button
                  className="btn btn-sm btn-outline-primary"
                  onClick={loadFilteredLeads}
                  disabled={filteredLeadsLoading || !filteredLeadsTimeRange?.startDate || !filteredLeadsTimeRange?.endDate || !filteredLeadsForm}
                  style={{ fontSize: '0.75rem' }}
                >
                  {filteredLeadsLoading ? (
                    <>
                      <span className="spinner-border spinner-border-sm me-1" role="status"></span>
                      Loading...
                    </>
                  ) : (
                    <>
                      <i className="fas fa-sync-alt me-1"></i>
                      Refresh
                    </>
                  )}
                </button>
              </div>

              {/* Error Message */}
              {filteredLeadsError && (
                <div className={`alert ${filteredLeadsError.type === 'permission' || filteredLeadsError.type === 'auth' ? 'alert-warning' : 'alert-danger'} mb-3`} style={{ fontSize: '0.875rem' }}>
                  <h6 className="alert-heading mb-2">
                    <i className={`fas ${filteredLeadsError.type === 'permission' ? 'fa-exclamation-triangle' : filteredLeadsError.type === 'auth' ? 'fa-key' : 'fa-exclamation-circle'} me-2`}></i>
                    {filteredLeadsError.type === 'permission' ? 'Permission Error' : filteredLeadsError.type === 'auth' ? 'Authentication Error' : 'Error'}
                  </h6>
                  <p className="mb-2">{filteredLeadsError.message || 'Failed to load leads'}</p>
                  {filteredLeadsError.details && (
                    <small className="text-muted d-block mb-2">{filteredLeadsError.details}</small>
                  )}
                  {filteredLeadsError.type === 'permission' && (
                    <div className="mt-3">
                      <button 
                        className="btn btn-sm btn-outline-secondary"
                        onClick={() => {
                          setFilteredLeadsError(null);
                          loadFilteredLeads();
                        }}
                      >
                        <i className="fas fa-redo me-1"></i>
                        Retry
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* Table */}
              <div className="mt-3">
                {filteredLeadsLoading ? (
                  <div className="text-center py-5">
                    <div className="spinner-border text-primary" role="status">
                      <span className="visually-hidden">Loading leads...</span>
                    </div>
                    <p className="mt-3 text-muted">Loading leads...</p>
                  </div>
                ) : (
                  <div className="table-responsive" style={{ maxHeight: '500px', overflowY: 'auto', overflowX: 'auto', WebkitOverflowScrolling: 'touch', minWidth: '800px' }}>
                    <table className="table table-hover align-middle mb-0" style={{ fontSize: '0.8rem' }}>
                      <thead className="table-light" style={{ position: 'sticky', top: 0, zIndex: 10 }}>
                        <tr>
                          <th className="fw-bold" style={{ fontSize: '0.7rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Date & Time</th>
                          <th className="fw-bold" style={{ fontSize: '0.7rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                            Campaign
                            <i className="fas fa-info-circle ms-1" style={{ fontSize: '0.6rem', opacity: 0.6 }} title="Campaign name associated with the lead"></i>
                          </th>
                          <th className="fw-bold" style={{ fontSize: '0.7rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                            Ad Name
                            <i className="fas fa-info-circle ms-1" style={{ fontSize: '0.6rem', opacity: 0.6 }} title="Ad name associated with the lead"></i>
                          </th>
                          <th className="fw-bold" style={{ fontSize: '0.7rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Lead Name</th>
                          <th className="fw-bold" style={{ fontSize: '0.7rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Phone Number</th>
                          <th className="fw-bold" style={{ fontSize: '0.7rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Sugar Poll</th>
                          <th className="fw-bold" style={{ fontSize: '0.7rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>City</th>
                          <th className="fw-bold" style={{ fontSize: '0.7rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Street</th>
                          <th className="fw-bold" style={{ fontSize: '0.7rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Form Name</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredLeadsData.length > 0 ? (
                          <>
                            {filteredLeadsData
                              .slice((filteredLeadsPageNum - 1) * filteredLeadsPerPage, filteredLeadsPageNum * filteredLeadsPerPage)
                              .map((lead, idx) => (
                                <tr key={lead.id || lead.lead_id || idx}>
                                  <td>{formatDateTime(lead.Date || lead.date || lead.DateChar, lead.Time || lead.time || lead.TimeUtc || lead.created_time)}</td>
                                  <td>{lead.campaign_name || 'N/A'}</td>
                                  <td>{lead.ad_name || 'N/A'}</td>
                                  <td>{lead.Name || 'N/A'}</td>
                                  <td>{lead.Phone || 'N/A'}</td>
                                  <td>{lead.SugarPoll || lead.sugar_poll || (lead.field_data && lead.field_data['Sugar Poll']) || 'N/A'}</td>
                                  <td>{lead.City || 'N/A'}</td>
                                  <td>{lead.Street || 'N/A'}</td>
                                  <td>{lead.form_name || 'N/A'}</td>
                                </tr>
                              ))}
                          </>
                        ) : (
                          <tr>
                            <td colSpan="9" className="text-center py-5 text-muted">
                              <div>
                                <p className="mb-2">No leads data available.</p>
                                <small>Please check your Meta API connection or filters.</small>
                              </div>
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Pagination */}
              {filteredLeadsData.length > 0 && Math.ceil(filteredLeadsData.length / filteredLeadsPerPage) > 1 && (
                <div className="d-flex justify-content-between align-items-center mt-3">
                  <div>
                    <small className="text-muted">
                      Showing {((filteredLeadsPageNum - 1) * filteredLeadsPerPage) + 1} to {Math.min(filteredLeadsPageNum * filteredLeadsPerPage, filteredLeadsData.length)} of {filteredLeadsData.length} leads
                    </small>
                  </div>
                  <div className="d-flex gap-2">
                    <button
                      className="btn btn-sm btn-outline-secondary"
                      onClick={() => setFilteredLeadsPageNum(p => Math.max(1, p - 1))}
                      disabled={filteredLeadsPageNum === 1}
                    >
                      Previous
                    </button>
                    <button
                      className="btn btn-sm btn-outline-secondary"
                      onClick={() => setFilteredLeadsPageNum(p => Math.min(Math.ceil(filteredLeadsData.length / filteredLeadsPerPage), p + 1))}
                      disabled={filteredLeadsPageNum >= Math.ceil(filteredLeadsData.length / filteredLeadsPerPage)}
                    >
                      Next
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Date Range Filter Modal for Filtered Leads */}
      {showFilteredLeadsDateRangeFilter && (
        <DateRangeFilter
          isOpen={showFilteredLeadsDateRangeFilter}
          onClose={() => setShowFilteredLeadsDateRangeFilter(false)}
          onApply={handleFilteredLeadsDateRangeApply}
          initialValue={filteredLeadsSelectedDateRange === 'custom' && filteredLeadsTimeRange?.startDate && filteredLeadsTimeRange?.endDate
            ? {
                range_type: 'custom',
                start_date: filteredLeadsTimeRange.startDate,
                end_date: filteredLeadsTimeRange.endDate
              }
            : { range_type: filteredLeadsSelectedDateRange || 'last_7_days' }}
        />
      )}

      {/* Ad Performance Table - Detailed Breakdown */}
        <div className="row mb-4">
          <div className="col-12">
            <div className="chart-card">
              <div className="chart-card-body">
                <div className="d-flex justify-content-between align-items-center mb-3">
                  <strong className="chart-title">
                    <span className="chart-emoji">📊</span> Ad Performance Breakdown
                  </strong>
                  <div className="d-flex align-items-center gap-3">
                    <small className="text-muted">Real-time insights from Meta Ads API</small>
                  </div>
                </div>
                <div className="table-responsive" style={{ maxHeight: '500px', overflowY: 'auto', overflowX: 'auto', WebkitOverflowScrolling: 'touch', minWidth: '800px' }}>
                {sortedAdBreakdown.length > 0 ? (
                  <table className="table table-hover align-middle mb-0" style={{ width: '100%', tableLayout: 'auto' }}>
                    <thead className="table-light" style={{ position: 'sticky', top: 0, zIndex: 10, backgroundColor: '#f8f9fa' }}>
                      <tr>
                        <SortableHeader
                          field="ad_name"
                          currentField={adSortField}
                          currentDirection={adSortDirection}
                          onClick={() => {
                            if (adSortField === 'ad_name') {
                              setAdSortDirection(adSortDirection === 'asc' ? 'desc' : 'asc');
                            } else {
                              setAdSortField('ad_name');
                              setAdSortDirection('asc');
                            }
                          }}
                        >
                          Ad Name
                        </SortableHeader>
                        <SortableHeader
                          field="campaign"
                          currentField={adSortField}
                          currentDirection={adSortDirection}
                          onClick={() => {
                            if (adSortField === 'campaign') {
                              setAdSortDirection(adSortDirection === 'asc' ? 'desc' : 'asc');
                            } else {
                              setAdSortField('campaign');
                              setAdSortDirection('asc');
                            }
                          }}
                          className="text-end"
                        >
                          Campaign
                        </SortableHeader>
                        <SortableHeader
                          field="ad_status"
                          currentField={adSortField}
                          currentDirection={adSortDirection}
                          onClick={() => {
                            if (adSortField === 'ad_status') {
                              setAdSortDirection(adSortDirection === 'asc' ? 'desc' : 'asc');
                            } else {
                              setAdSortField('ad_status');
                              setAdSortDirection('asc');
                            }
                          }}
                          className="text-end"
                        >
                          Status
                        </SortableHeader>
                        <SortableHeader
                          field="spend"
                          currentField={adSortField}
                          currentDirection={adSortDirection}
                          onClick={() => {
                            if (adSortField === 'spend') {
                              setAdSortDirection(adSortDirection === 'asc' ? 'desc' : 'asc');
                            } else {
                              setAdSortField('spend');
                              setAdSortDirection('desc');
                            }
                          }}
                          className="text-end"
                        >
                          Spend
                        </SortableHeader>
                        <SortableHeader
                          field="impressions"
                          currentField={adSortField}
                          currentDirection={adSortDirection}
                          onClick={() => {
                            if (adSortField === 'impressions') {
                              setAdSortDirection(adSortDirection === 'asc' ? 'desc' : 'asc');
                            } else {
                              setAdSortField('impressions');
                              setAdSortDirection('desc');
                            }
                          }}
                          className="text-end"
                        >
                          Impressions
                        </SortableHeader>
                        <SortableHeader
                          field="clicks"
                          currentField={adSortField}
                          currentDirection={adSortDirection}
                          onClick={() => {
                            if (adSortField === 'clicks') {
                              setAdSortDirection(adSortDirection === 'asc' ? 'desc' : 'asc');
                            } else {
                              setAdSortField('clicks');
                              setAdSortDirection('desc');
                            }
                          }}
                          className="text-end"
                        >
                          Clicks
                        </SortableHeader>
                        <SortableHeader
                          field="ctr"
                          currentField={adSortField}
                          currentDirection={adSortDirection}
                          onClick={() => {
                            if (adSortField === 'ctr') {
                              setAdSortDirection(adSortDirection === 'asc' ? 'desc' : 'asc');
                            } else {
                              setAdSortField('ctr');
                              setAdSortDirection('desc');
                            }
                          }}
                          className="text-end"
                        >
                          CTR
                        </SortableHeader>
                        <SortableHeader
                          field="leads"
                          currentField={adSortField}
                          currentDirection={adSortDirection}
                          onClick={() => {
                            if (adSortField === 'leads') {
                              setAdSortDirection(adSortDirection === 'asc' ? 'desc' : 'asc');
                            } else {
                              setAdSortField('leads');
                              setAdSortDirection('desc');
                            }
                          }}
                          className="text-end"
                        >
                          Total Leads
                        </SortableHeader>
                        <SortableHeader
                          field="leads"
                          currentField={adSortField}
                          currentDirection={adSortDirection}
                          onClick={() => {
                            if (adSortField === 'leads') {
                              setAdSortDirection(adSortDirection === 'asc' ? 'desc' : 'asc');
                            } else {
                              setAdSortField('leads');
                              setAdSortDirection('desc');
                            }
                          }}
                          className="text-end"
                        >
                          Unique Leads
                        </SortableHeader>
                        <SortableHeader
                          field="cpl"
                          currentField={adSortField}
                          currentDirection={adSortDirection}
                          onClick={() => {
                            if (adSortField === 'cpl') {
                              setAdSortDirection(adSortDirection === 'asc' ? 'desc' : 'asc');
                            } else {
                              setAdSortField('cpl');
                              setAdSortDirection('asc');
                            }
                          }}
                          className="text-end"
                        >
                          CPL
                        </SortableHeader>
                        <SortableHeader
                          field="conversions"
                          currentField={adSortField}
                          currentDirection={adSortDirection}
                          onClick={() => {
                            if (adSortField === 'conversions') {
                              setAdSortDirection(adSortDirection === 'asc' ? 'desc' : 'asc');
                            } else {
                              setAdSortField('conversions');
                              setAdSortDirection('desc');
                            }
                          }}
                          className="text-end"
                        >
                          Conversions
                        </SortableHeader>
                        <SortableHeader
                          field="hookRate"
                          currentField={adSortField}
                          currentDirection={adSortDirection}
                          onClick={() => {
                            if (adSortField === 'hookRate') {
                              setAdSortDirection(adSortDirection === 'asc' ? 'desc' : 'asc');
                            } else {
                              setAdSortField('hookRate');
                              setAdSortDirection('desc');
                            }
                          }}
                          className="text-end"
                        >
                          Hook Rate
                        </SortableHeader>
                        <SortableHeader
                          field="holdRate"
                          currentField={adSortField}
                          currentDirection={adSortDirection}
                          onClick={() => {
                            if (adSortField === 'holdRate') {
                              setAdSortDirection(adSortDirection === 'asc' ? 'desc' : 'asc');
                            } else {
                              setAdSortField('holdRate');
                              setAdSortDirection('desc');
                            }
                          }}
                          className="text-end"
                        >
                          Hold Rate
                        </SortableHeader>
                      </tr>
                    </thead>
                    <tbody>
                      {sortedAdBreakdown.map((ad, idx) => (
                        <tr
                          key={ad.ad_id}
                          style={{ cursor: 'pointer' }}
                        >
                          <td className="fw-medium">{ad.ad_name}</td>
                          <td className="text-end text-muted small">{ad.campaign}</td>
                          <td className="text-end">
                            <span className={`badge ${ad.ad_status === 'ACTIVE' ? 'bg-success' : ad.ad_status === 'PAUSED' ? 'bg-warning' : 'bg-secondary'}`}>
                              {ad.ad_status}
                            </span>
                          </td>
                          <td className="text-end fw-bold">{formatMoney(ad.spend)}</td>
                          <td className="text-end">{formatNum(ad.impressions)}</td>
                          <td className="text-end">{formatNum(ad.clicks)}</td>
                          <td className="text-end fw-medium">{formatPerc(ad.ctr)}</td>
                          <td className="text-end fw-bold text-primary">{formatNum(ad.leads)}</td>
                          <td className="text-end">{formatNum(ad.leads)}</td>
                          <td className="text-end fw-medium">{formatMoney(ad.cpl)}</td>
                          <td className="text-end">{formatNum(ad.conversions)}</td>
                          <td className="text-end">{formatPerc(ad.hookRate)}</td>
                          <td className="text-end">{formatPerc(ad.holdRate ?? 0)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="table-light fw-bold">
                      <tr>
                        <td colSpan="3">Total</td>
                        <td className="text-end">{formatMoney(sortedAdBreakdown.reduce((sum, ad) => sum + ad.spend, 0))}</td>
                        <td className="text-end">{formatNum(sortedAdBreakdown.reduce((sum, ad) => sum + ad.impressions, 0))}</td>
                        <td className="text-end">{formatNum(sortedAdBreakdown.reduce((sum, ad) => sum + ad.clicks, 0))}</td>
                        <td className="text-end">{formatPerc(totals.ctr)}</td>
                        <td className="text-end">{formatNum(sortedAdBreakdown.reduce((sum, ad) => sum + ad.leads, 0))}</td>
                        <td className="text-end">{formatNum(sortedAdBreakdown.reduce((sum, ad) => sum + ad.leads, 0))}</td>
                        <td className="text-end">{formatMoney(totals.cpl)}</td>
                        <td className="text-end">{formatNum(sortedAdBreakdown.reduce((sum, ad) => sum + ad.conversions, 0))}</td>
                        <td className="text-end">{formatPerc(totals.hookRate)}</td>
                        <td className="text-end">{formatPerc(totals.holdRate ?? 0)}</td>
                      </tr>
                    </tfoot>
                  </table>
                ) : (
                  <div className="text-center py-5" style={{ color: '#64748b' }}>
                    <p className="mb-0">No ad data available. Check your Time Range, Project, and Ad Account filters, or verify your Meta API connection.</p>
                </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Content Marketing - Dashboard Section */}
      <div
        className="dashboard-wrapper"
        style={{ marginTop: '50px', paddingTop: '32px', borderTop: '2px solid #e2e8f0' }}
      >
        {/* Header */}
        <div className="dashboard-header">
          <div className="d-flex justify-content-between align-items-center flex-wrap gap-3">
            <div>
              <h1 className="dashboard-title">
                <span className="title-emoji">📱</span> Content Marketing - Dashboard
              </h1>
              <p className="dashboard-subtitle">Track your content performance and organic growth</p>
            </div>
          </div>
        </div>

        {/* Filters */}
        <div className="filter-card">
          <div className="filter-card-body">
            <div className="row g-3 align-items-center">
              {/* Date Filter - Using DateRangeFilter Modal */}
              <div className="col-12 col-md-auto">
                <label className="filter-label">
                  <span className="filter-emoji">📅</span> Time Range
                </label>
                <button
                  type="button"
                  className="d-flex align-items-center gap-2 px-3 py-2 border shadow-sm cursor-pointer"
                  onClick={() => setShowContentDateRangeFilter(true)}
                  style={{
                    borderRadius: '5px',
                    color: 'var(--text, #64748b)',
                    borderColor: 'rgba(0, 0, 0, 0.1)',
                    transition: 'all 0.2s ease',
                    height: '36px',
                    minWidth: '180px',
                    border: '1px solid rgba(0, 0, 0, 0.1)',
                    background: 'var(--card, #ffffff)',
                    width: '100%'
                  }}
                >
                  <i className="far fa-calendar-alt text-secondary opacity-75"></i>
                  <span className="fw-medium small text-dark flex-grow-1 text-center" style={{ fontSize: '0.8rem' }}>
                    {getContentDateRangeDisplay()}
                  </span>
                  <i className="fas fa-chevron-down text-secondary opacity-50 small"></i>
                </button>
              </div>
              {/* Source Filter */}
              <div className="col-12 col-md-auto">
                <MultiSelectFilter
                  label="Source"
                  emoji="🔗"
                  options={[
                    { id: 'facebook', name: 'Facebook' },
                    { id: 'instagram', name: 'Instagram' },
                    { id: 'online_leads', name: 'Online leads' },
                    { id: 'incoming_call', name: 'Incoming call' },
                    { id: 'website_leads', name: 'Website Leads' },
                    { id: 'comments', name: 'Comments' },
                    { id: 'direct_message', name: 'Direct Message' },
                  ]}
                  selectedValues={selectedSource}
                  onChange={(values) => {
                    setSelectedSource(values);
                  }}
                  placeholder="All Sources"
                  getOptionLabel={(opt) => opt.name}
                  getOptionValue={(opt) => opt.id}
                />
              </div>
              {/* PAGE Filter - when Instagram or Facebook is selected in Source (Content Marketing) */}
              {isEngagementSourceSelected && (
                <div className="col-12 col-md-auto">
                  <MultiSelectFilter
                    label="PAGE"
                    emoji="📄"
                    options={contentMarketingPageOptions}
                    selectedValues={contentMarketingPage ? [contentMarketingPage] : []}
                    onChange={(values) => {
                      setContentMarketingPage(values?.length ? values[0] : null);
                    }}
                    placeholder={pagesLoading ? "Loading pages…" : "Select a Page"}
                    getOptionLabel={(opt) => opt.name}
                    getOptionValue={(opt) => opt.id}
                    singleSelect
                  />
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Content Marketing Page Insights Error */}
        {contentPageInsightsError && (
          <div className="alert alert-warning mb-3" role="alert" style={{ fontSize: '0.85rem', padding: '8px 12px' }}>
            <small>
              <i className="fas fa-exclamation-triangle me-1"></i>
              {contentPageInsightsError.message}
              {contentPageInsightsError.details && (
                <div className="mt-1" style={{ fontSize: '0.8rem' }}>{contentPageInsightsError.details}</div>
              )}
            </small>
          </div>
        )}

        {/* Performance Insights Error - Views, Interactions, Follows, Reached (Instagram/Page) */}
        {performanceInsightsError && (
          <div className="alert alert-warning mb-3" role="alert" style={{ fontSize: '0.85rem', padding: '8px 12px' }}>
            <small>
              <i className="fas fa-exclamation-triangle me-1"></i>
              {performanceInsightsError.message}
              {performanceInsightsError.details && (
                <div className="mt-1" style={{ fontSize: '0.8rem' }}>{performanceInsightsError.details}</div>
              )}
            </small>
          </div>
        )}
        
        {/* Info message if no pages loaded (Content Marketing PAGE filter) */}
        {!pagesLoading && pages.length === 0 && (
          <div className="alert alert-info mb-3" role="alert" style={{ fontSize: '0.85rem', padding: '8px 12px' }}>
            <small>
              <i className="fas fa-info-circle me-1"></i>
              No pages available. Ensure your Meta token has <strong>pages_show_list</strong> (or use a User token with page access), or set <strong>META_PAGE_ID</strong> in server/.env to your Facebook Page ID.
            </small>
          </div>
        )}
        
        {isEngagementSourceSelected && pages.length > 0 && !contentMarketingPage && !selectedPage && (
          <div className="alert alert-info mb-3" role="alert" style={{ fontSize: '0.85rem', padding: '8px 12px' }}>
            <small>
              <i className="fas fa-info-circle me-1"></i>
              Please select a page from the filters above to view engagement insights.
            </small>
          </div>
        )}
        {!isEngagementSourceSelected && (
          <div className="alert alert-info mb-3" role="alert" style={{ fontSize: '0.85rem', padding: '8px 12px' }}>
            <small>
              <i className="fas fa-info-circle me-1"></i>
              Select <strong>Instagram</strong> or <strong>Facebook</strong> in the Source filter and choose a page to view engagement metrics (Views, Follows, Reached, etc.). Revenue cards below reflect the selected source(s).
            </small>
          </div>
        )}

        {/* KPI Row - Content Marketing */}
        <div className="row g-3 mb-4">
          {/* 0. Views */}
          <div className="col-6 col-md-4 col-lg-3 col-xl">
            <div className="kpi-card kpi-card-info">
              <div className="kpi-card-body">
                <div className="kpi-icon">👁️</div>
                <small className="kpi-label">Views</small>
                <div className="kpi-value">
                  {performanceInsightsLoading ? (
                    <span className="spinner-border spinner-border-sm" role="status"></span>
                  ) : (
                    formatNum(performanceInsightsData?.total_views ?? performanceInsightsData?.totalViews ?? 0)
                  )}
                </div>
                {performanceInsightsData && (
                  <small className={`kpi-change ${performanceInsightsData.viewsChange >= 0 ? 'kpi-change-positive' : 'kpi-change-negative'}`}>
                    {formatChange(performanceInsightsData.viewsChange)}
                  </small>
                )}
              </div>
            </div>
          </div>

          {/* 0.1 Interactions */}
          <div className="col-6 col-md-4 col-lg-3 col-xl">
            <div className="kpi-card kpi-card-teal">
              <div className="kpi-card-body">
                <div className="kpi-icon">🤝</div>
                <small className="kpi-label">Interactions</small>
                <div className="kpi-value">
                  {performanceInsightsLoading ? (
                    <span className="spinner-border spinner-border-sm" role="status"></span>
                  ) : (
                    formatNum(performanceInsightsData?.total_interactions ?? performanceInsightsData?.totalInteractions ?? 0)
                  )}
                </div>
                {performanceInsightsData && (
                  <small className={`kpi-change ${performanceInsightsData.interactionsChange >= 0 ? 'kpi-change-positive' : 'kpi-change-negative'}`}>
                    {formatChange(performanceInsightsData.interactionsChange)}
                  </small>
                )}
              </div>
            </div>
          </div>

          {/* 1. Follows (period count: new follows in selected range, Meta-style) */}
          <div className="col-6 col-md-4 col-lg-3 col-xl">
            <div className="kpi-card kpi-card-primary">
              <div className="kpi-card-body d-flex flex-column">
                <div className="d-flex align-items-center justify-content-between mb-1">
                  <small className="kpi-label">Follows</small>
                  <button
                    type="button"
                    className="btn btn-sm btn-outline-light border-0 py-1 px-2"
                    title="Export to Excel (Meta format)"
                    onClick={handleDownloadFollowsExcel}
                    disabled={performanceInsightsLoading || downloadingFollowsExcel || !performanceInsightsData || !((performanceInsightsData?.data?.daily_subscriber_change ?? performanceInsightsData?.daily_subscriber_change ?? performanceInsightsData?.fan_adds)?.length)}
                  >
                    {downloadingFollowsExcel ? (
                      <span className="spinner-border spinner-border-sm" role="status" aria-label="Exporting"></span>
                    ) : (
                      <i className="fas fa-file-excel" style={{ fontSize: '0.85rem' }}></i>
                    )}
                  </button>
                </div>
                <div className="kpi-icon">👥</div>
                <div className="kpi-value">
                  {performanceInsightsLoading ? (
                    <span className="spinner-border spinner-border-sm" role="status"></span>
                  ) : (
                    formatNum(
                      performanceInsightsData?.totalFollowsDelta ??
                      performanceInsightsData?.data?.total_follows ??
                      performanceInsightsData?.total_follows ??
                      performanceInsightsData?.totalFollows ??
                      performanceInsightsData?.current_followers ??
                      0
                    )
                  )}
                </div>
                {performanceInsightsData && (
                  <small className={`kpi-change ${performanceInsightsData.followsChange >= 0 ? 'kpi-change-positive' : 'kpi-change-negative'}`}>
                    {formatChange(performanceInsightsData.followsChange)}
                  </small>
                )}
              </div>
            </div>
          </div>

          {/* 2. Reached */}
          <div className="col-6 col-md-4 col-lg-3 col-xl">
            <div className="kpi-card kpi-card-success">
              <div className="kpi-card-body">
                <div className="kpi-icon">📱</div>
                <small className="kpi-label">Reached</small>
                <div className="kpi-value">
                  {performanceInsightsLoading ? (
                    <span className="spinner-border spinner-border-sm" role="status"></span>
                  ) : (
                    formatNum(performanceInsightsData?.total_reached ?? performanceInsightsData?.totalReached ?? 0)
                  )}
                </div>
                {performanceInsightsData && (
                  <small className={`kpi-change ${performanceInsightsData.reachChange >= 0 ? 'kpi-change-positive' : 'kpi-change-negative'}`}>
                    {formatChange(performanceInsightsData.reachChange)}
                  </small>
                )}
              </div>
            </div>
          </div>

          {/* 2.1 Follower Growth Rate */}
          <div className="col-6 col-md-4 col-lg-3 col-xl">
            <div className="kpi-card kpi-card-primary">
              <div className="kpi-card-body">
                <div className="kpi-icon">📊</div>
                <small className="kpi-label">Follower Growth Rate</small>
                <div className="kpi-value">
                  {performanceInsightsLoading ? (
                    <span className="spinner-border spinner-border-sm" role="status"></span>
                  ) : (
                    `${(followerGrowthResult.growthRate ?? 0).toFixed(2)}%`
                  )}
                </div>
                {performanceInsightsData && followerGrowthResult.totalNewFollowers >= 0 && (
                  <small className="kpi-change kpi-change-positive">
                    {formatNum(followerGrowthResult.totalNewFollowers)} new followers in {getContentDateRangeDisplay().toLowerCase()}
                  </small>
                )}
              </div>
            </div>
          </div>

          {/* 3. Organic Leads */}
          <div className="col-6 col-md-4 col-lg-3 col-xl">
            <div className="kpi-card kpi-card-info">
              <div className="kpi-card-body">
                <div className="kpi-icon">🌱</div>
                <small className="kpi-label">Organic Leads</small>
                <div className="kpi-value">
                  {contentMarketingRevenue.loading ? (
                    <span className="spinner-border spinner-border-sm" role="status"></span>
                  ) : (
                    formatNum(contentMarketingRevenue.organicLeads || 0)
                  )}
                </div>
                {contentMarketingRevenue.organicLeads > 0 && (
                  <small className="kpi-change kpi-change-positive">
                    ↑
                  </small>
                )}
              </div>
            </div>
          </div>

          {/* 4. Organic Conversion */}
          <div className="col-6 col-md-4 col-lg-3 col-xl">
            <div className="kpi-card kpi-card-warning">
              <div className="kpi-card-body">
                <div className="kpi-icon">💵</div>
                <small className="kpi-label">Organic Conversion</small>
                <div className="kpi-value">
                  {contentMarketingRevenue.loading ? (
                    <span className="spinner-border spinner-border-sm" role="status"></span>
                  ) : (
                    formatNum(contentMarketingRevenue.organicConversion || 0)
                  )}
                </div>
                {contentMarketingRevenue.organicConversion > 0 && (
                  <small className="kpi-change kpi-change-positive">
                    ↑
                  </small>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Additional KPI Row - Content Marketing */}
        <div className="row g-3 mb-4">
          {/* 5. L1 Revenue */}
          <div className="col-6 col-md-4 col-lg-3 col-xl">
            <div className="kpi-card kpi-card-l1">
              <div className="kpi-card-body">
                <div className="kpi-icon">💎</div>
                <small className="kpi-label">L1 Revenue Organic </small>
                <div className="kpi-value">
                  {contentMarketingRevenue.loading ? (
                    <span className="spinner-border spinner-border-sm" role="status"></span>
                  ) : (
                    formatMoney(contentMarketingRevenue.l1Revenue || 0)
                  )}
                </div>
                {contentMarketingRevenue.l1Revenue > 0 && (
                  <small className="kpi-change kpi-change-positive">
                    ↑
                  </small>
                )}
              </div>
            </div>
          </div>

          {/* 6. L2 Revenue */}
          <div className="col-6 col-md-4 col-lg-3 col-xl">
            <div className="kpi-card kpi-card-l2">
              <div className="kpi-card-body">
                <div className="kpi-icon">💠</div>
                <small className="kpi-label">L2 Revenue Organic</small>
                <div className="kpi-value">
                  {contentMarketingRevenue.loading ? (
                    <span className="spinner-border spinner-border-sm" role="status"></span>
                  ) : (
                    formatMoney(contentMarketingRevenue.l2Revenue || 0)
                  )}
                </div>
                {contentMarketingRevenue.l2Revenue > 0 && (
                  <small className="kpi-change kpi-change-positive">
                    ↑
                  </small>
                )}
              </div>
            </div>
          </div>

          {/* 7. Total Revenue */}
          <div className="col-6 col-md-4 col-lg-3 col-xl">
            <div className="kpi-card kpi-card-total">
              <div className="kpi-card-body">
                <div className="kpi-icon">💰</div>
                <small className="kpi-label">Total Organic Revenue</small>
                <div className="kpi-value">
                  {contentMarketingRevenue.loading ? (
                    <span className="spinner-border spinner-border-sm" role="status"></span>
                  ) : (
                    formatMoney(contentMarketingRevenue.totalRevenue || 0)
                  )}
                </div>
                {contentMarketingRevenue.totalRevenue > 0 && (
                  <small className="kpi-change kpi-change-positive">
                    ↑
                  </small>
                )}
              </div>
            </div>
          </div>

          {/* 8. Unfollows - always last 28 days (independent of date range filter); estimated from follower_count deltas on Instagram */}
          <div className="col-6 col-md-4 col-lg-3 col-xl">
            <div className="kpi-card kpi-card-unfollowers" title="Unfollow count for the last 28 days only. Does not change with the date range filter. Estimated from daily follower count changes (Instagram).">
              <div className="kpi-card-body">
                <div className="kpi-icon">👋</div>
                <small className="kpi-label">Unfollows</small>
                <div className="kpi-value">
                  {unfollowsLast28Loading ? (
                    <span className="spinner-border spinner-border-sm" role="status"></span>
                  ) : (
                    formatNum(unfollowsLast28Days?.total_unfollows ?? 0)
                  )}
                </div>
                {unfollowsLast28Error && (
                  <small className="text-muted" style={{ fontSize: '0.7rem' }}>{unfollowsLast28Error}</small>
                )}
                {unfollowsLast28Days != null && !unfollowsLast28Error && (
                  <small className={`kpi-change ${unfollowsLast28Days.unfollowsChange >= 0 ? 'kpi-change-negative' : 'kpi-change-positive'}`}>
                    {formatChange(unfollowsLast28Days.unfollowsChange)}
                  </small>
                )}
                <small className="kpi-subtitle">Last 28 days</small>
                {unfollowsReportDaily.length > 0 && (
                  <button
                    type="button"
                    className="btn btn-link btn-sm p-0 mt-1 text-muted"
                    style={{ fontSize: '0.75rem' }}
                    onClick={() => setShowUnfollowsReport((v) => !v)}
                  >
                    {showUnfollowsReport ? 'Hide report' : 'View report'}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Unfollows daily report (last 28 days derivation) */}
        {showUnfollowsReport && unfollowsReportDaily.length > 0 && (
          <div className="mb-4">
            <div className="card">
              <div className="card-body p-3">
                <h6 className="mb-2">Unfollows report (last 28 days)</h6>
                <p className="text-muted small mb-2">
                  Daily follower count and how total unfollows are derived. Negative daily change = unfollows; positive = follows. Total row: Follower count = sum of all daily counts; Follows/Unfollows = sum over 28 days.
                </p>
                <div className="table-responsive" style={{ maxHeight: 400, overflow: 'auto' }}>
                  <table className="table table-sm table-bordered mb-0">
                    <thead className="table-light" style={{ position: 'sticky', top: 0, zIndex: 1 }}>
                      <tr>
                        <th>Date</th>
                        <th>Follower count</th>
                        <th>Daily change</th>
                        <th>Follows</th>
                        <th>Unfollows</th>
                      </tr>
                    </thead>
                    <tbody>
                      {unfollowsReportDaily.map((row, i) => (
                        <tr key={i}>
                          <td>{row.date}</td>
                          <td>{formatNum(row.follower_count)}</td>
                          <td>{row.daily_change != null ? (row.daily_change >= 0 ? '+' : '') + formatNum(row.daily_change) : '–'}</td>
                          <td>{row.follows != null ? formatNum(row.follows) : '–'}</td>
                          <td>{row.unfollows != null ? formatNum(row.unfollows) : '–'}</td>
                        </tr>
                      ))}
                      <tr className="table-secondary fw-semibold">
                        <td>Total</td>
                        <td>{formatNum(unfollowsReportDaily.reduce((s, r) => s + (r.follower_count ?? 0), 0))}</td>
                        <td>–</td>
                        <td>{formatNum(unfollowsReportDaily.reduce((s, r) => s + (r.follows ?? 0), 0))}</td>
                        <td>{formatNum(unfollowsReportDaily.reduce((s, r) => s + (r.unfollows ?? 0), 0))}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                <div className="mt-2">
                  <button
                    type="button"
                    className="btn btn-outline-secondary btn-sm"
                    onClick={() => {
                      const headers = ['Date', 'Follower count', 'Daily change', 'Follows', 'Unfollows'];
                      const rows = unfollowsReportDaily.map((r) => [r.date, r.follower_count, r.daily_change ?? '', r.follows ?? '', r.unfollows ?? '']);
                      const totalFollows = unfollowsReportDaily.reduce((s, r) => s + (r.follows ?? 0), 0);
                      const totalUnfollows = unfollowsReportDaily.reduce((s, r) => s + (r.unfollows ?? 0), 0);
                      const totalFollowerCount = unfollowsReportDaily.reduce((s, r) => s + (r.follower_count ?? 0), 0);
                      rows.push(['Total', totalFollowerCount, '', totalFollows, totalUnfollows]);
                      const csv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
                      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
                      const a = document.createElement('a');
                      a.href = URL.createObjectURL(blob);
                      a.download = `unfollows-report-${unfollowsReportDaily[0]?.date || 'start'}-to-${unfollowsReportDaily[unfollowsReportDaily.length - 1]?.date || 'end'}.csv`;
                      a.click();
                      URL.revokeObjectURL(a.href);
                    }}
                  >
                    Download CSV
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Platform-Specific Metrics (shown when Platform filter is selected) */}
        {selectedPlatforms && selectedPlatforms.length > 0 && (
          <div className="mb-4" style={{ borderTop: '2px solid #e2e8f0', paddingTop: '24px', marginTop: '24px' }}>
            <div className="mb-3">
              <h5 className="mb-1" style={{ fontWeight: 600, color: 'var(--text, #334155)' }}>
                <span className="me-2">🌐</span> Platform-Specific Metrics
              </h5>
              <small className="text-muted">Aggregated by selected platform(s) and date range</small>
            </div>
            {contentPlatformMetricsError && (
              <div className="alert alert-warning mb-3" role="alert" style={{ fontSize: '0.85rem', padding: '8px 12px' }}>
                <small>
                  <i className="fas fa-exclamation-triangle me-1"></i>
                  Unable to load Wix analytics: {contentPlatformMetricsError}
                </small>
                {(contentPlatformMetricsError || '').toLowerCase().includes('not configured') && (
                  <div className="mt-2" style={{ fontSize: '0.8rem' }}>
                    <strong>Steps:</strong> 1) Add WIX_SITE_ID and WIX_TOKEN to server/.env. 2) Select &quot;Wix&quot; in the Platform filter. 3) Set a Time Range (Last 7 days). 4) Restart the server.
                  </div>
                )}
                {(contentPlatformMetricsError || '').includes('400') && (
                  <div className="mt-2" style={{ fontSize: '0.8rem' }}>
                    <strong>400 error:</strong> Wix stores analytics for 62 days only. Use Time Range within last 62 days. Check server logs for Wix API details.
                  </div>
                )}
              </div>
            )}
            {/* 3×3 Metric Cards */}
            <div className="row g-3 mb-4">
              <div className="col-6 col-md-4">
                <div className="kpi-card kpi-card-info">
                  <div className="kpi-card-body">
                    <div className="kpi-icon">📊</div>
                    <small className="kpi-label">Total Site Sessions</small>
                    <div className="kpi-value">
                      {contentPlatformMetricsLoading ? (
                        <span className="spinner-border spinner-border-sm" role="status"></span>
                      ) : (
                        formatNum(contentPlatformMetrics.totalSiteSessions)
                      )}
                    </div>
                  </div>
                </div>
              </div>
              <div className="col-6 col-md-4">
                <div className="kpi-card kpi-card-teal">
                  <div className="kpi-card-body">
                    <div className="kpi-icon">👤</div>
                    <small className="kpi-label">Unique Visitors</small>
                    <div className="kpi-value">
                      {contentPlatformMetricsLoading ? (
                        <span className="spinner-border spinner-border-sm" role="status"></span>
                      ) : (
                        formatNum(contentPlatformMetrics.uniqueVisitors)
                      )}
                    </div>
                  </div>
                </div>
              </div>
              <div className="col-6 col-md-4">
                <div className="kpi-card kpi-card-primary">
                  <div className="kpi-card-body">
                    <div className="kpi-icon">📞</div>
                    <small className="kpi-label">Clicks to Contact</small>
                    <div className="kpi-value">
                      {contentPlatformMetricsLoading ? (
                        <span className="spinner-border spinner-border-sm" role="status"></span>
                      ) : (
                        formatNum(contentPlatformMetrics.clicksToContact)
                      )}
                    </div>
                  </div>
                </div>
              </div>
              <div className="col-6 col-md-4">
                <div className="kpi-card kpi-card-warning">
                  <div className="kpi-card-body">
                    <div className="kpi-icon">👁️</div>
                    <small className="kpi-label">Form Views</small>
                    <div className="kpi-value">
                      {contentPlatformMetricsLoading ? (
                        <span className="spinner-border spinner-border-sm" role="status"></span>
                      ) : (
                        formatNum(contentPlatformMetrics.formViews)
                      )}
                    </div>
                  </div>
                </div>
              </div>
              <div className="col-6 col-md-4">
                <div className="kpi-card kpi-card-success">
                  <div className="kpi-card-body">
                    <div className="kpi-icon">📝</div>
                    <small className="kpi-label">Form Submissions</small>
                    <div className="kpi-value">
                      {contentPlatformMetricsLoading ? (
                        <span className="spinner-border spinner-border-sm" role="status"></span>
                      ) : (
                        formatNum(contentPlatformMetrics.formSubmissions)
                      )}
                    </div>
                  </div>
                </div>
              </div>
              <div className="col-6 col-md-4">
                <div className="kpi-card kpi-card-purple">
                  <div className="kpi-card-body">
                    <div className="kpi-icon">🌱</div>
                    <small className="kpi-label">Lead Count</small>
                    <div className="kpi-value">
                      {contentPlatformMetricsLoading ? (
                        <span className="spinner-border spinner-border-sm" role="status"></span>
                      ) : (
                        formatNum(contentPlatformMetrics.leadCount)
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
            {/* Charts: Sessions vs Traffic Source & Leads vs Source */}
            <div className="row g-4 mb-4">
              <div className="col-12 col-lg-6">
                <div className="chart-card">
                  <div className="chart-card-body">
                    <strong className="chart-title">
                      <span className="chart-emoji">📈</span> Sessions vs Traffic Source
                    </strong>
                    <p className="text-muted small mb-2 mt-1">Sessions broken down by traffic source</p>
                    <div className="chart-container-large mt-3" style={{ height: '320px' }}>
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={contentPlatformSessionsBySource} margin={{ top: 10, right: 20, left: 10, bottom: 70 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                          <XAxis 
                            dataKey="source" 
                            tick={{ fontSize: 10, fill: '#64748b', fontWeight: 500 }}
                            axisLine={false}
                            tickLine={false}
                            angle={-45}
                            textAnchor="end"
                            height={80}
                          />
                          <YAxis 
                            tick={{ fontSize: 11, fill: '#64748b', fontWeight: 500 }}
                            axisLine={false}
                            tickLine={false}
                          />
                          <Tooltip 
                            cursor={{ fill: 'rgba(79, 70, 229, 0.1)' }}
                            contentStyle={{ 
                              borderRadius: '8px', 
                              border: '1px solid rgba(0, 0, 0, 0.1)', 
                              boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                              padding: '10px 12px',
                              backgroundColor: 'var(--card, #ffffff)'
                            }}
                            formatter={(value) => [formatNum(value), 'Sessions']}
                            animationDuration={200}
                          />
                          <Bar 
                            dataKey="sessions" 
                            fill="#4F46E5" 
                            radius={[8, 8, 0, 0]}
                            barSize={40}
                            animationBegin={200}
                            animationDuration={1500}
                            animationEasing="ease-out"
                          >
                            {contentPlatformSessionsBySource.map((entry, index) => (
                              <Cell 
                                key={`sessions-cell-${index}`} 
                                fill={COLORS[index % COLORS.length]}
                                style={{ transition: 'all 0.3s ease', cursor: 'pointer' }}
                              />
                            ))}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                </div>
              </div>
              <div className="col-12 col-lg-6">
                <div className="chart-card">
                  <div className="chart-card-body">
                    <strong className="chart-title">
                      <span className="chart-emoji">📊</span> Leads vs Source
                    </strong>
                    <p className="text-muted small mb-2 mt-1">Lead count grouped by source</p>
                    <div className="chart-container-large mt-3" style={{ height: '320px' }}>
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={contentPlatformLeadsBySource} margin={{ top: 10, right: 20, left: 10, bottom: 70 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                          <XAxis 
                            dataKey="source" 
                            tick={{ fontSize: 10, fill: '#64748b', fontWeight: 500 }}
                            axisLine={false}
                            tickLine={false}
                            angle={-45}
                            textAnchor="end"
                            height={80}
                          />
                          <YAxis 
                            tick={{ fontSize: 11, fill: '#64748b', fontWeight: 500 }}
                            axisLine={false}
                            tickLine={false}
                          />
                          <Tooltip 
                            cursor={{ fill: 'rgba(16, 185, 129, 0.1)' }}
                            contentStyle={{ 
                              borderRadius: '8px', 
                              border: '1px solid rgba(0, 0, 0, 0.1)', 
                              boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                              padding: '10px 12px',
                              backgroundColor: 'var(--card, #ffffff)'
                            }}
                            formatter={(value) => [formatNum(value), 'Leads']}
                            animationDuration={200}
                          />
                          <Bar 
                            dataKey="leads" 
                            fill="#10B981" 
                            radius={[8, 8, 0, 0]}
                            barSize={40}
                            animationBegin={200}
                            animationDuration={1500}
                            animationEasing="ease-out"
                          >
                            {contentPlatformLeadsBySource.map((entry, index) => (
                              <Cell 
                                key={`leads-cell-${index}`} 
                                fill={COLORS[index % COLORS.length]}
                                style={{ transition: 'all 0.3s ease', cursor: 'pointer' }}
                              />
                            ))}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      
      
        {/* Content Marketing Charts */}
        {/* Chart 1: Followers Count vs Page & Chart 2: Leads Count vs Source */}
        <div className="row g-4 mb-4">
          <div className="col-12 col-lg-6">
            <div className="chart-card">
              <div className="chart-card-body">
                <div className="d-flex justify-content-between align-items-center">
                  <strong className="chart-title">
                    <span className="chart-emoji">👥</span> Followers Count vs Page
                  </strong>
                  {(pageInsightsLoading || contentMarketingAllPagesInsightsLoading) && (
                    <small className="text-muted">
                      <span className="spinner-border spinner-border-sm me-1" role="status"></span>
                      Loading...
                    </small>
                  )}
                </div>
                {(pageInsightsError || contentMarketingAllPagesInsightsError) && (
                  <div className="alert alert-warning mt-2 mb-2" role="alert" style={{ fontSize: '0.85rem', padding: '8px 12px' }}>
                    <small>
                      <i className="fas fa-exclamation-triangle me-1"></i>
                      {contentMarketingAllPagesInsightsError || pageInsightsError?.message}
                      {pageInsightsError?.details && (
                        <div className="mt-1" style={{ fontSize: '0.8rem' }}>{pageInsightsError.details}</div>
                      )}
                    </small>
                  </div>
                )}
                {!selectedPage && !contentMarketingPage && followersByPlatformData.length === 0 && (
                  <div className="alert alert-info mt-2 mb-2" role="alert" style={{ fontSize: '0.85rem', padding: '8px 12px' }}>
                    <small>
                      <i className="fas fa-info-circle me-1"></i>
                      {isEngagementSourceSelected ? 'Select a page for KPIs above, or wait for follower counts to load.' : 'Please select a page to view real followers data'}
                    </small>
                  </div>
                )}
                <div className="chart-container-large mt-3" style={{ height: '350px' }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={followersByPlatformData} margin={{ top: 10, right: 20, left: 10, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                      <XAxis 
                        dataKey="page" 
                        tick={{ fontSize: 11, fill: '#64748b', fontWeight: 500 }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <YAxis 
                        tick={{ fontSize: 11, fill: '#64748b', fontWeight: 500 }}
                        axisLine={false}
                        tickLine={false}
                        tickFormatter={(value) => `${(value / 1000).toFixed(0)}k`}
                      />
                      <Tooltip 
                        cursor={{ fill: 'rgba(79, 70, 229, 0.1)' }}
                        contentStyle={{ 
                          borderRadius: '8px', 
                          border: '1px solid rgba(0, 0, 0, 0.1)', 
                          boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                          padding: '10px 12px',
                          backgroundColor: 'var(--card, #ffffff)'
                        }}
                        formatter={(value) => [formatNum(value), 'Followers']}
                        animationDuration={200}
                      />
                      <Bar 
                        dataKey="followers" 
                        fill="#4F46E5" 
                        radius={[8, 8, 0, 0]}
                        barSize={50}
                        animationBegin={0}
                        animationDuration={1500}
                        animationEasing="ease-out"
                      >
                        {followersByPlatformData.map((entry, index) => (
                          <Cell 
                            key={`cell-${index}`} 
                            fill="#4F46E5"
                            style={{ 
                              transition: 'all 0.3s ease',
                              cursor: 'pointer'
                            }}
                      />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          </div>

          <div className="col-12 col-lg-6">
            <div className="chart-card">
              <div className="chart-card-body">
                <div>
                  <strong className="chart-title">
                    <span className="chart-emoji">📊</span> Leads Count vs Source
                  </strong>
                </div>
                <div className="chart-container-large mt-3" style={{ height: '350px' }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={leadsBySourceData} margin={{ top: 10, right: 20, left: 10, bottom: 70 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                      <XAxis 
                        dataKey="source" 
                        tick={{ fontSize: 10, fill: '#64748b', fontWeight: 500 }}
                        axisLine={false}
                        tickLine={false}
                        angle={-45}
                        textAnchor="end"
                        height={80}
                      />
                      <YAxis 
                        tick={{ fontSize: 11, fill: '#64748b', fontWeight: 500 }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <Tooltip 
                        cursor={{ fill: 'rgba(16, 185, 129, 0.1)' }}
                        contentStyle={{ 
                          borderRadius: '8px', 
                          border: '1px solid rgba(0, 0, 0, 0.1)', 
                          boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                          padding: '10px 12px',
                          backgroundColor: 'var(--card, #ffffff)'
                        }}
                        formatter={(value) => [formatNum(value), 'Leads']}
                        animationDuration={200}
                      />
                      <Bar 
                        dataKey="leads" 
                        fill="#10B981" 
                        radius={[8, 8, 0, 0]}
                        barSize={40}
                        animationBegin={200}
                        animationDuration={1500}
                        animationEasing="ease-out"
                      >
                        {leadsBySourceData.map((entry, index) => (
                          <Cell 
                            key={`cell-${index}`} 
                            fill="#10B981"
                            style={{ 
                              transition: 'all 0.3s ease',
                              cursor: 'pointer'
                            }}
                          />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Chart 3: Organic Revenue vs Date & Chart 4: Leads Count vs Date */}
        <div className="row g-4 mb-4">
          <div className="col-12 col-lg-6">
            <div className="chart-card">
              <div className="chart-card-body">
                <div>
                  <strong className="chart-title">
                    <span className="chart-emoji">💵</span> Organic Revenue vs Date
                  </strong>
                </div>
                <div className="chart-container-large mt-3" style={{ height: '350px' }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={organicRevenueByDateData} margin={{ top: 10, right: 20, left: 10, bottom: 5 }}>
                      <defs>
                        <linearGradient id="colorRevenueChart" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#F59E0B" stopOpacity={0.6} />
                          <stop offset="50%" stopColor="#F59E0B" stopOpacity={0.3} />
                          <stop offset="95%" stopColor="#F59E0B" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                      <XAxis 
                        dataKey="date" 
                        tick={{ fontSize: 11, fill: '#64748b', fontWeight: 500 }} 
                        axisLine={false}
                        tickLine={false}
                      />
                      <YAxis 
                        tick={{ fontSize: 11, fill: '#64748b', fontWeight: 500 }}
                        axisLine={false}
                        tickLine={false}
                        tickFormatter={(value) => `₹${(value / 1000).toFixed(0)}k`}
                      />
                      <Tooltip 
                        cursor={{ stroke: '#F59E0B', strokeWidth: 2, strokeDasharray: '5 5' }}
                        contentStyle={{ 
                          borderRadius: '8px', 
                          border: '1px solid rgba(0, 0, 0, 0.1)', 
                          boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
                          padding: '10px 12px',
                          backgroundColor: 'var(--card, #ffffff)'
                        }}
                        formatter={(value) => [`₹${value.toLocaleString()}`, 'Organic Revenue']}
                        animationDuration={200}
                        labelStyle={{ fontWeight: 600, marginBottom: '4px' }}
                      />
                      <Area 
                        type="monotone" 
                        dataKey="revenue" 
                        stroke="#F59E0B" 
                        strokeWidth={3}
                        fill="url(#colorRevenueChart)" 
                        name="Organic Revenue"
                        animationBegin={0}
                        animationDuration={1800}
                        animationEasing="ease-out"
                        dot={{ r: 5, fill: '#F59E0B', strokeWidth: 2, stroke: '#fff' }}
                        activeDot={{ r: 8, fill: '#F59E0B', strokeWidth: 3, stroke: '#fff', cursor: 'pointer' }}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          </div>

          <div className="col-12 col-lg-6">
            <div className="chart-card">
              <div className="chart-card-body">
                <div>
                  <strong className="chart-title">
                    <span className="chart-emoji">📈</span> Leads Count vs Date
                  </strong>
                </div>
                <div className="chart-container-large mt-3" style={{ height: '350px' }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={leadsCountByDateData} margin={{ top: 10, right: 20, left: 10, bottom: 5 }}>
                      <defs>
                        <linearGradient id="colorLeadsChart" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#10B981" stopOpacity={0.6} />
                          <stop offset="50%" stopColor="#10B981" stopOpacity={0.3} />
                          <stop offset="95%" stopColor="#10B981" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                      <XAxis 
                        dataKey="date" 
                        tick={{ fontSize: 11, fill: '#64748b', fontWeight: 500 }} 
                        axisLine={false}
                        tickLine={false}
                      />
                      <YAxis 
                        tick={{ fontSize: 11, fill: '#64748b', fontWeight: 500 }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <Tooltip 
                        cursor={{ stroke: '#10B981', strokeWidth: 2, strokeDasharray: '5 5' }}
                        contentStyle={{ 
                          borderRadius: '8px', 
                          border: '1px solid rgba(0, 0, 0, 0.1)', 
                          boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
                          padding: '10px 12px',
                          backgroundColor: 'var(--card, #ffffff)'
                        }}
                        formatter={(value) => [formatNum(value), 'Leads']}
                        animationDuration={200}
                        labelStyle={{ fontWeight: 600, marginBottom: '4px' }}
                      />
                      <Area 
                        type="monotone" 
                        dataKey="leads" 
                        stroke="#10B981" 
                        strokeWidth={3}
                        fill="url(#colorLeadsChart)" 
                        name="Leads Count"
                        animationBegin={200}
                        animationDuration={1800}
                        animationEasing="ease-out"
                        dot={{ r: 5, fill: '#10B981', strokeWidth: 2, stroke: '#fff' }}
                        activeDot={{ r: 8, fill: '#10B981', strokeWidth: 3, stroke: '#fff', cursor: 'pointer' }}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Chart 5: Account Reach by Followers Count */}
        <div className="row g-4 mb-4">
          <div className="col-12">
            <div className="chart-card">
              <div className="chart-card-body">
                <div className="d-flex justify-content-between align-items-center">
                  <strong className="chart-title">
                    <span className="chart-emoji">📱</span> Account Reach by Followers Count
                  </strong>
                  <div className="d-flex align-items-center gap-2">
                    {/* Time Range Filter Button */}
                    <button
                      type="button"
                      className="d-flex align-items-center gap-2 px-3 py-2 border shadow-sm cursor-pointer"
                      onClick={() => setShowChartTimeRangeFilter(true)}
                      style={{
                        borderRadius: '5px',
                        color: '#64748b',
                        borderColor: '#cbd5e1',
                        transition: 'all 0.2s ease',
                        height: '36px',
                        minWidth: '160px',
                        border: '1px solid rgba(0, 0, 0, 0.1)',
                        background: 'var(--card, #ffffff)',
                        fontSize: '0.8rem'
                      }}
                    >
                      <i className="far fa-calendar-alt text-secondary opacity-75"></i>
                      <span className="fw-medium small text-dark" style={{ fontSize: '0.8rem' }}>
                        {getChartTimeRangeDisplay()}
                      </span>
                      <i className="fas fa-chevron-down text-secondary opacity-50 small"></i>
                    </button>
                    {pageInsightsLoading && (
                      <small className="text-muted">
                        <span className="spinner-border spinner-border-sm me-1" role="status"></span>
                        Loading...
                      </small>
                    )}
                  </div>
                </div>
                {pageInsightsError && (
                  <div className="alert alert-warning mt-2 mb-2" role="alert" style={{ fontSize: '0.85rem', padding: '8px 12px' }}>
                    <small>
                      <i className="fas fa-exclamation-triangle me-1"></i>
                      {pageInsightsError.message}
                      {pageInsightsError.details && (
                        <div className="mt-1" style={{ fontSize: '0.8rem' }}>{pageInsightsError.details}</div>
                      )}
                    </small>
                  </div>
                )}
                {!selectedPage && !contentMarketingPage && (
                  <div className="alert alert-info mt-2 mb-2" role="alert" style={{ fontSize: '0.85rem', padding: '8px 12px' }}>
                    <small>
                      <i className="fas fa-info-circle me-1"></i>
                      Please select a page to view real reach and followers data
                    </small>
                  </div>
                )}
                <div className="chart-container-large mt-3" style={{ height: '400px' }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={accountReachByFollowersData} margin={{ top: 10, right: 20, left: 10, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                      <XAxis 
                        dataKey="page" 
                        tick={{ fontSize: 11, fill: '#64748b', fontWeight: 500 }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <YAxis 
                        yAxisId="left"
                        tick={{ fontSize: 11, fill: '#64748b', fontWeight: 500 }}
                        axisLine={false}
                        tickLine={false}
                        tickFormatter={(value) => `${(value / 1000).toFixed(0)}k`}
                      />
                      <YAxis 
                        yAxisId="right"
                        orientation="right"
                        tick={{ fontSize: 11, fill: '#64748b', fontWeight: 500 }}
                        axisLine={false}
                        tickLine={false}
                        tickFormatter={(value) => `${(value / 1000).toFixed(0)}k`}
                      />
                      <Tooltip 
                        cursor={{ fill: 'rgba(79, 70, 229, 0.05)' }}
                        contentStyle={{ 
                          borderRadius: '8px', 
                          border: '1px solid rgba(0, 0, 0, 0.1)', 
                          boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                          padding: '10px 12px',
                          backgroundColor: 'var(--card, #ffffff)'
                        }}
                        formatter={(value, name) => {
                          if (name === 'followers') {
                            return [formatNum(value), 'Followers'];
                          }
                          if (name === 'reach') {
                            return [formatNum(value), 'Reach'];
                          }
                          return [value, name];
                        }}
                        animationDuration={200}
                        labelStyle={{ fontWeight: 600, marginBottom: '4px' }}
                      />
                      <Legend 
                        wrapperStyle={{ paddingTop: '12px', fontSize: '12px', fontWeight: 500 }}
                        iconType="circle"
                      />
                      <Bar 
                        yAxisId="left"
                        dataKey="followers" 
                        fill="#4F46E5" 
                        name="Followers"
                        radius={[8, 8, 0, 0]}
                        barSize={60}
                        animationBegin={0}
                        animationDuration={1500}
                        animationEasing="ease-out"
                      >
                        {accountReachByFollowersData.map((entry, index) => (
                          <Cell 
                            key={`cell-followers-${index}`} 
                            fill="#4F46E5"
                            style={{ 
                              transition: 'all 0.3s ease',
                              cursor: 'pointer'
                            }}
                      />
                        ))}
                      </Bar>
                      <Bar 
                        yAxisId="right"
                        dataKey="reach" 
                        fill="#06B6D4" 
                        name="Reach"
                        radius={[8, 8, 0, 0]}
                        barSize={60}
                        animationBegin={300}
                        animationDuration={1500}
                        animationEasing="ease-out"
                      >
                        {accountReachByFollowersData.map((entry, index) => (
                          <Cell 
                            key={`cell-reach-${index}`} 
                            fill="#06B6D4"
                            style={{ 
                              transition: 'all 0.3s ease',
                              cursor: 'pointer'
                            }}
                      />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Date Range Filter Modal for Main Dashboard */}
      <DateRangeFilter
        isOpen={showDateRangeFilter}
        onClose={() => setShowDateRangeFilter(false)}
        onApply={handleDateRangeApply}
        initialValue={dateRangeFilterValue || {
          range_type: selectedDateRange === 'last_7_days' ? 'last_7_days' : 
                      selectedDateRange === 'last_14_days' ? 'last_14_days' :
                      selectedDateRange === 'last_30_days' ? 'last_30_days' :
                      selectedDateRange === 'This week' ? 'this_week' :
                      selectedDateRange === 'Last week' ? 'last_week' :
                      selectedDateRange === 'This month' ? 'this_month' :
                      selectedDateRange === 'Last month' ? 'last_month' :
                      'last_7_days', // Default to last 7 days
          start_date: dateFilters.startDate || null,
          end_date: dateFilters.endDate || null,
          timezone: 'Asia/Kolkata',
          compare: { enabled: false }
        }}
      />

      {/* Date Range Filter Modal for Leads Section */}
      <DateRangeFilter
        isOpen={showLeadsDateRangeFilter}
        onClose={() => setShowLeadsDateRangeFilter(false)}
        onApply={handleLeadsDateRangeApply}
        initialValue={leadsDateRangeFilterValue || {
          range_type: leadsTimeRange,
          start_date: dateFilters.startDate || null,
          end_date: dateFilters.endDate || null,
          timezone: 'Asia/Kolkata',
          compare: { enabled: false }
        }}
      />

      {/* Date Range Filter Modal for Content Marketing Section */}
      <DateRangeFilter
        isOpen={showContentDateRangeFilter}
        onClose={() => setShowContentDateRangeFilter(false)}
        onApply={handleContentDateRangeApply}
        initialValue={contentDateRangeFilterValue || {
          range_type: contentDateRange,
          start_date: contentFilters.startDate || null,
          end_date: contentFilters.endDate || null,
          timezone: 'Asia/Kolkata',
          compare: { enabled: false }
        }}
      />

      {/* Date Range Filter Modal for Chart "Account Reach by Followers Count" */}
      <DateRangeFilter
        isOpen={showChartTimeRangeFilter}
        onClose={() => setShowChartTimeRangeFilter(false)}
        onApply={handleChartTimeRangeApply}
        initialValue={chartTimeRangeFilterValue || {
          range_type: chartTimeRangeValue,
          start_date: chartTimeRange.startDate || null,
          end_date: chartTimeRange.endDate || null,
          timezone: 'Asia/Kolkata',
          compare: { enabled: false }
        }}
      />
    </div>
  );
}
