import React, { useState, useEffect, useMemo, useRef } from 'react';
import './BestPerformingAd.css';
import DateRangeFilter from '../components/DateRangeFilter';
import MultiSelectFilter from '../components/MultiSelectFilter';
import { PROJECT_ORDER, ALL_SPECIFIED_ACCOUNT_IDS, buildAdAccountsByProject, normalizeAccountId } from '../constants/projectAdAccounts';
import {
    XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
    Bar, Line, ComposedChart, Legend
} from 'recharts';

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

// USD to INR conversion rate (update as needed; reserved for future use)
// eslint-disable-next-line no-unused-vars
const USD_TO_INR = 83;

// Revenue per conversion (₹) used for ROAS: (Conversion Count * REVENUE_PER_CONVERSION) / Amount spend
const REVENUE_PER_CONVERSION = 3999;

// Helper to transform Meta "actions" array -> object map (same as Dashboard)
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

// Extract conversions from actions (same keys as Dashboard + extra Meta variants)
const getConversionsFromAggs = (aggs) => {
    return aggs['purchase'] || aggs['complete_registration'] || aggs['offsite_conversion.fb_pixel_purchase']
        || aggs['website_purchase'] || aggs['omni_purchase'] || aggs['offsite_conversion.purchase']
        || 0;
};

// Extract revenue from action_values for ROAS (Meta: purchase, offsite_conversion.fb_pixel_purchase, etc.)
const getRevenueFromActionValues = (values) => {
    if (!values || typeof values !== 'object') return 0;
    const keys = ['purchase', 'offsite_conversion.fb_pixel_purchase', 'website_purchase', 'omni_purchase', 'offsite_conversion.purchase'];
    let sum = 0;
    keys.forEach((k) => { sum += Number(values[k]) || 0; });
    return sum;
};

// Helper: safe number
const num = (v) => Number(v) || 0;

// Format currency (same as Ads Analytics Dashboard: raw API value with ₹)
const formatMoney = (v) => `₹${(v || 0).toFixed(2)}`;

// Format currency in INR (for tables/charts that explicitly convert)
const formatINR = (value) => {
    return `₹${(value || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

// Format number with Indian locale
const formatNum = (value) => {
    return value.toLocaleString('en-IN');
};

// Format percentage
const formatPerc = (value) => {
    return `${value.toFixed(2)}%`;
};

// Format ROAS (e.g. 2.5x or —)
const formatROAS = (value) => {
    if (value == null || value <= 0) return '—';
    return `${Number(value).toFixed(2)}x`;
};

// Default date range: same as Ads Analytics Dashboard (last 7 complete days, excluding today)
const getDefaultDates = () => {
    const today = new Date();
    const endDate = new Date(today);
    endDate.setDate(endDate.getDate() - 1); // Yesterday (exclude today, matching Meta)
    const startDate = new Date(endDate);
    startDate.setDate(startDate.getDate() - 6); // 7 days before yesterday
    return {
        startDate: startDate.toISOString().slice(0, 10),
        endDate: endDate.toISOString().slice(0, 10)
    };
};

// Fetch ad accounts from Meta API (same as Dashboards)
// forceRefresh: when true, asks server to re-fetch from Meta (pagination, all accounts)
const fetchAdAccounts = async (forceRefresh = false) => {
    try {
        const token = getAuthToken();
        const headers = { "Content-Type": "application/json" };
        if (token) {
            headers["Authorization"] = `Bearer ${token}`;
        }

        const url = `${API_BASE}/api/meta/ad-accounts${forceRefresh ? '?refresh=true' : ''}`;
        const res = await fetch(url, { headers });
        if (!res.ok) {
            const errorData = await res.json().catch(() => ({}));
            console.error("[fetchAdAccounts] API error:", errorData);
            return [];
        }

        const data = await res.json();
        if (Array.isArray(data)) return data;
        if (data && Array.isArray(data.data)) return data.data;
        return [];
    } catch (e) {
        console.error("[fetchAdAccounts] Exception:", e);
        return [];
    }
};

// Fetch insights from Meta API (same params as Ads Analytics Dashboard for same data)
// live: true = fetch from Meta API (slower, freshest); false = use DB cache (faster)
const fetchInsightsData = async ({ campaignId = '', adId = '', startDate = '', endDate = '', adAccountId = null, live = false }) => {
    try {
        const token = getAuthToken();
        const headers = { "Content-Type": "application/json" };
        if (token) {
            headers["Authorization"] = `Bearer ${token}`;
        }

        // Build URL like Dashboard: from/to for exact date range so values match Ads Analytics Dashboard
        let url = `${API_BASE}/api/meta/insights?time_increment=1`;
        if (startDate && endDate) {
            url += `&from=${encodeURIComponent(startDate)}&to=${encodeURIComponent(endDate)}`;
        } else {
            // No date range selected: use days so backend can default (e.g. last 7 days)
            const days = 7;
            url += `&days=${days}`;
        }

        if (adAccountId) {
            url += `&ad_account_id=${encodeURIComponent(adAccountId)}`;
        }
        // Same as Dashboard when "All Campaigns" / "All Ads": one aggregated call, same card values
        url += '&is_all_campaigns=1&is_all_ads=1';
        if (live) {
            url += '&live=1';
        }

        const res = await fetch(url, { headers });

        if (!res.ok) {
            const errorData = await res.json().catch(() => ({}));
            console.error("API error:", errorData);
            throw new Error(errorData.details || errorData.error || res.statusText || "Failed to fetch insights");
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

        // Normalize data (conversions same logic as Dashboard + extra action_type fallbacks)
        return data.map((d) => {
            const aggs = transformActions(d.actions || []);
            const values = transformActions(d.action_values || []);
            const leadCount = aggs['lead'] || aggs['on_facebook_lead'] || aggs['onsite_conversion.lead_grouped'] || 0;
            const conversions = getConversionsFromAggs(aggs);
            
            const impressions = num(d.impressions);
            const clicks = num(d.clicks);
            const spend = num(d.spend);
            const revenue = getRevenueFromActionValues(values);
            const ctr = impressions > 0 ? (clicks / impressions) * 100 : 0;
            const cpl = leadCount > 0 ? spend / leadCount : 0;
            const cpm = impressions > 0 ? (spend / impressions) * 1000 : 0;
            const conversionRate = leadCount > 0 ? (conversions / leadCount) * 100 : 0;

            return {
                campaign_id: d.campaign_id,
                campaign: d.campaign_name || "Unknown Campaign",
                ad_id: d.ad_id || null,
                ad_name: d.ad_name || "Unnamed Ad",
                date: d.date_start || d.date,
                ad_account_id: d.ad_account_id || null,
                ad_account_name: d.ad_account_name || '',
                spend: spend,
                revenue: revenue,
                impressions: impressions,
                clicks: clicks,
                leads: leadCount,
                conversions: conversions,
                ctr: ctr,
                cpl: cpl,
                cpm: cpm,
                conversionRate: conversionRate,
                actions: aggs,
                action_values: values,
                // Video metrics for hook/hold: Hold Rate = video_p100_watched_actions / video_play × 100
                video_play: aggs['video_play'] || aggs['video_view'] || 0,
                video_p100_watched: values['video_p100_watched_actions'] || aggs['video_p100_watched_actions'] || values['video_p100_watched'] || aggs['video_p100_watched'] || 0,
                campaign_status: d.campaign_status || d.status || null,
                ad_status: d.ad_status || d.effective_status || null
            };
        });
    } catch (e) {
        console.error("Failed to fetch insights data", e);
        return [];
    }
};

// Fetch Wix analytics (same as Dashboard). Returns { rows: [...] }. Rows have platform: 'wix'.
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
            return { rows: data.rows || [], error: data.error || data.details || `Request failed (${res.status})` };
        }
        if (Array.isArray(data)) return { rows: data };
        return { rows: data.rows || [], error: data.error || null };
    } catch (e) {
        console.error("Failed to fetch Wix analytics", e);
        return { rows: [], error: e.message || 'Failed to fetch Wix analytics' };
    }
};

// Filter to only ACTIVE campaign and ad (same as Dashboard). Keep rows with null status (e.g. Wix).
const filterByActiveStatus = (rows) => {
    if (!Array.isArray(rows)) return [];
    return rows.filter((r) => {
        const campaignStatus = r.campaign_status || r.status;
        const adStatus = r.ad_status || r.effective_status;
        if (campaignStatus && campaignStatus !== 'ACTIVE') return false;
        if (adStatus && adStatus !== 'ACTIVE') return false;
        return true;
    });
};

// Fetch insights from multiple ad accounts (one request per account) and combine. Same pattern as Dashboard fetchAllAccountsDashboardData.
const fetchAllAccountsInsightsData = async ({ startDate, endDate, accounts, live = false }) => {
    if (!accounts || accounts.length === 0) return [];
    const promises = accounts.map((account) =>
        fetchInsightsData({
            startDate,
            endDate,
            adAccountId: (account.account_id || account.id || '').toString().replace(/^act_/, ''),
            live
        })
    );
    const settled = await Promise.allSettled(promises);
    const results = settled.map((s, i) => {
        if (s.status === 'fulfilled') return s.value || [];
        const acc = accounts[i];
        const name = acc?.account_name || acc?.name || acc?.account_id || acc?.id || 'unknown';
        console.warn(`[BestPerformingAd] Ad account "${name}" failed:`, s.reason?.message || s.reason);
        return [];
    });
    return results.flat();
};

export default function BestPerformingAd() {

    // Helper for table heatmap styles (values in INR)
    const getBgClass = (val, type) => {
        if (type === 'spend' && val > 20000) return 'cell-heatmap-mid';
        if (type === 'leadGenerated' && val > 300) return 'cell-heatmap-high';
        if (type === 'conversionCount' && val > 800) return 'cell-heatmap-high';
        if (type === 'conversionRate' && val > 3.0) return 'cell-heatmap-high';
        if (type === 'cpl' && val > 5000) return 'cell-heatmap-low';
        return '';
    };

    // --- FILTER STATE & LOGIC (default same as Ads Analytics Dashboard: last 7 days) ---
    const [filters, setFilters] = useState(() => getDefaultDates());
    const [showDateRangeFilter, setShowDateRangeFilter] = useState(false);
    const [dateRangeFilterValue, setDateRangeFilterValue] = useState(null);
    const [selectedProject, setSelectedProject] = useState('');
    const [projectsDropdownOpen, setProjectsDropdownOpen] = useState(false);
    const [hoveredProject, setHoveredProject] = useState(null);
    const projectsDropdownRef = useRef(null);
    const [adAccounts, setAdAccounts] = useState([]);
    const [adAccountsLoading, setAdAccountsLoading] = useState(true);
    const [insightsData, setInsightsData] = useState([]);
    const [dataLoading, setDataLoading] = useState(false);
    const [error, setError] = useState(null);
    const [manualConversionByCampaign, setManualConversionByCampaign] = useState({});
    const [selectedAdAccounts, setSelectedAdAccounts] = useState([]);

    // Load ad accounts on mount
    useEffect(() => {
        let cancelled = false;
        setAdAccountsLoading(true);
        fetchAdAccounts().then((accounts) => {
            if (!cancelled) {
                setAdAccounts(accounts || []);
            }
        }).finally(() => {
            if (!cancelled) setAdAccountsLoading(false);
        });
        return () => { cancelled = true; };
    }, []);

    // Close projects dropdown when clicking outside
    useEffect(() => {
        const handleClickOutside = (e) => {
            if (projectsDropdownRef.current && !projectsDropdownRef.current.contains(e.target)) {
                setProjectsDropdownOpen(false);
            }
        };
        if (projectsDropdownOpen) {
            document.addEventListener('mousedown', handleClickOutside);
        }
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [projectsDropdownOpen]);

    const adAccountsByProject = useMemo(() => buildAdAccountsByProject(adAccounts), [adAccounts]);
    // Same as Dashboard: only accounts that are in our project list AND returned by the API (token can access).
    const specifiedAccountIdSet = useMemo(() => new Set(ALL_SPECIFIED_ACCOUNT_IDS.map((id) => normalizeAccountId(id))), []);
    const specifiedAdAccounts = useMemo(
        () => adAccounts.filter((acc) => specifiedAccountIdSet.has(normalizeAccountId(acc.account_id || acc.id))),
        [adAccounts, specifiedAccountIdSet]
    );
    // Account IDs for the selected project (for comma-separated fallback).
    const selectedProjectAdAccountIds = useMemo(() => {
        if (!selectedProject) return null;
        const accounts = adAccountsByProject[selectedProject] || [];
        const ids = accounts.map((a) => normalizeAccountId(a.value)).filter(Boolean);
        return ids.length > 0 ? ids.join(',') : null;
    }, [selectedProject, adAccountsByProject]);
    // Account objects for the selected project (same as Dashboard accountsForProject).
    const accountsForProject = useMemo(() => {
        if (!selectedProjectAdAccountIds) return [];
        const idSet = new Set(selectedProjectAdAccountIds.split(',').map((s) => s.trim()).filter(Boolean));
        return adAccounts.filter((acc) => idSet.has(normalizeAccountId(acc.account_id || acc.id)));
    }, [adAccounts, selectedProjectAdAccountIds]);
    // Array of account IDs for the selected project (for project-restrict effect).
    const selectedProjectAccountIds = useMemo(() => {
        if (!selectedProject) return [];
        const list = adAccountsByProject[selectedProject] || [];
        return list.map((a) => normalizeAccountId(a.value)).filter(Boolean);
    }, [selectedProject, adAccountsByProject]);
    // When specific ad accounts are selected, the account objects (same as Dashboard accountsForSelectedAdAccounts).
    const accountsForSelectedAdAccounts = useMemo(() => {
        if (selectedAdAccounts.length === 0) return [];
        const baseList = selectedProject ? accountsForProject : specifiedAdAccounts;
        const idSet = new Set(selectedAdAccounts.map((id) => normalizeAccountId(id)));
        return baseList.filter((acc) => idSet.has(normalizeAccountId(acc.account_id || acc.id)));
    }, [selectedAdAccounts, selectedProject, accountsForProject, specifiedAdAccounts]);
    // Which accounts to fetch: specific selection or "all" for current project (same as Dashboard accountsForFetch).
    const accountsForFetch = useMemo(() => {
        if (selectedAdAccounts.length > 0) return accountsForSelectedAdAccounts;
        return selectedProject ? accountsForProject : specifiedAdAccounts;
    }, [selectedAdAccounts, selectedProject, accountsForSelectedAdAccounts, accountsForProject, specifiedAdAccounts]);

    // When project changes, restrict Ad Accounts to those in the selected project (same as Dashboard).
    useEffect(() => {
        if (selectedAdAccounts.length === 0) return;
        if (!selectedProject || selectedProjectAccountIds.length === 0) return;
        const projectIdSet = new Set(selectedProjectAccountIds.map((id) => normalizeAccountId(id)));
        const filtered = selectedAdAccounts.filter((id) => projectIdSet.has(normalizeAccountId(id)));
        if (filtered.length !== selectedAdAccounts.length) setSelectedAdAccounts(filtered);
    }, [selectedProject, selectedProjectAccountIds, selectedAdAccounts]);

    // Fetch insights: same logic as Dashboard — Date Range + Project + Ad Account; one request per account when multiple accounts.
    useEffect(() => {
        let cancelled = false;
        setDataLoading(true);
        setError(null);

        const loadInsights = async () => {
            try {
                const opts = {
                    startDate: filters.startDate,
                    endDate: filters.endDate,
                    live: true
                };
                let metaRows = [];
                if (accountsForFetch.length > 0) {
                    metaRows = await fetchAllAccountsInsightsData({
                        ...opts,
                        accounts: accountsForFetch
                    });
                    if (cancelled) return;
                } else if (selectedProject === '' && specifiedAdAccounts.length === 0) {
                    metaRows = await fetchInsightsData({
                        ...opts,
                        adAccountId: undefined
                    });
                    if (cancelled) return;
                } else if (selectedProject && selectedProjectAdAccountIds) {
                    metaRows = await fetchInsightsData({
                        ...opts,
                        adAccountId: selectedProjectAdAccountIds
                    });
                    if (cancelled) return;
                }
                // Merge Wix analytics (same as Dashboard) so card values match
                const fromDate = filters.startDate || null;
                const toDate = filters.endDate || null;
                if (fromDate && toDate) {
                    const wixResult = await fetchWixAnalytics({ from: fromDate, to: toDate });
                    const wixRows = wixResult.rows || [];
                    if (wixRows.length > 0) metaRows = [...(metaRows || []), ...wixRows];
                    if (cancelled) return;
                }
                // Filter to ACTIVE campaign/ad only (same as Dashboard)
                const filtered = filterByActiveStatus(metaRows || []);
                setInsightsData(filtered);
                setDataLoading(false);
            } catch (e) {
                if (!cancelled) {
                    console.error("Failed to load insights:", e);
                    setError(e.message || "Failed to load insights data.");
                    setDataLoading(false);
                }
            }
        };
        loadInsights();
        return () => { cancelled = true; };
    }, [filters.startDate, filters.endDate, selectedProject, selectedProjectAdAccountIds, specifiedAdAccounts, accountsForFetch]);

    // Calculate totals from insights data
    const totals = useMemo(() => {
        const t = {
            spend: 0,
            impressions: 0,
            clicks: 0,
            leads: 0,
            conversions: 0
        };
        
        insightsData.forEach((r) => {
            t.spend += r.spend || 0;
            t.impressions += r.impressions || 0;
            t.clicks += r.clicks || 0;
            t.leads += r.leads || 0;
            t.conversions += r.conversions || 0;
        });

        // Calculate derived metrics
        t.cpm = t.impressions > 0 ? (t.spend / t.impressions) * 1000 : 0;
        t.cpl = t.leads > 0 ? t.spend / t.leads : 0;
        t.conversionRate = t.leads > 0 ? (t.conversions / t.leads) * 100 : 0;

        // Meta account is INR; no conversion
        t.spendINR = t.spend;
        t.cpmINR = t.cpm;
        t.cplINR = t.cpl;

        return t;
    }, [insightsData]);

    // Funnel data from live insights
    const funnelData = useMemo(() => [
        { value: totals.impressions, name: 'Impressions', fill: '#4338ca' },
        { value: totals.clicks, name: 'Clicks', fill: '#0ea5e9' },
        { value: totals.leads, name: 'Leads', fill: '#06b6d4' }
    ], [totals]);

    // Aggregate data by ad for charts (top 20 by spend; X-axis = Ad Name)
    const TOP_ADS_LIMIT = 20;
    const aggregateByAd = useMemo(() => {
        const adMap = {};
        insightsData.forEach((r) => {
            const key = String(r.ad_id || r.ad_name || 'unknown').trim() || 'unknown';
            const adName = (r.ad_name && String(r.ad_name).trim()) ? r.ad_name.trim() : (r.ad_id ? `Ad ${r.ad_id}` : 'Unknown');
            if (!adMap[key]) {
                adMap[key] = {
                    ad_id: r.ad_id,
                    adName,
                    spend: 0,
                    impressions: 0,
                    clicks: 0,
                    leads: 0,
                    conversions: 0
                };
            }
            adMap[key].spend += r.spend || 0;
            adMap[key].impressions += r.impressions || 0;
            adMap[key].clicks += r.clicks || 0;
            adMap[key].leads += r.leads || 0;
            adMap[key].conversions += r.conversions || 0;
        });
        return Object.values(adMap)
            .sort((a, b) => (b.spend || 0) - (a.spend || 0))
            .slice(0, TOP_ADS_LIMIT)
            .map((d) => {
                const adNameShort = d.adName.length > 18 ? d.adName.slice(0, 15) + '…' : d.adName;
                const cpm = d.impressions > 0 ? (d.spend / d.impressions) * 1000 : 0;
                const cpl = d.leads > 0 ? d.spend / d.leads : 0;
                const conversionRate = d.leads > 0 ? (d.conversions / d.leads) * 100 : 0;
                return {
                    ...d,
                    adNameShort,
                    cpm,
                    cpl,
                    conversionRate
                };
            });
    }, [insightsData]);

    // Dynamics Data (Amount Spend vs Lead Generated from Ad) - by Ad Name
    const dynamicsData = useMemo(() => {
        return aggregateByAd.map((d) => ({
            adName: d.adName,
            adNameShort: d.adNameShort,
            spend: d.spend,
            leadGenerated: d.leads
        }));
    }, [aggregateByAd]);

    // Impressions & CPM Data - by Ad Name
    const impressionsData = useMemo(() => {
        return aggregateByAd.map((d) => ({
            adName: d.adName,
            adNameShort: d.adNameShort,
            imp: d.impressions,
            cpm: d.cpm
        }));
    }, [aggregateByAd]);

    // Link clicks & Conversion Rate Data - by Ad Name
    const clicksData = useMemo(() => {
        return aggregateByAd.map((d) => ({
            adName: d.adName,
            adNameShort: d.adNameShort,
            clicks: d.clicks,
            conversionRate: d.conversionRate
        }));
    }, [aggregateByAd]);

    // Leads & CPL Data - by Ad Name
    const leadsData = useMemo(() => {
        return aggregateByAd.map((d) => ({
            adName: d.adName,
            adNameShort: d.adNameShort,
            leads: d.leads,
            cpl: d.cpl
        }));
    }, [aggregateByAd]);

    // Resolve ad account display name from id or API-provided name
    const getAdAccountDisplay = (adAccountId, adAccountNameFromApi) => {
        if (adAccountNameFromApi && String(adAccountNameFromApi).trim()) return String(adAccountNameFromApi).trim();
        if (!adAccountId) return 'All Ad Accounts';
        const acc = adAccounts.find((a) => (a.account_id || a.id) === String(adAccountId).replace(/^act_/, ''));
        return acc ? (acc.account_name || acc.name || adAccountId) : adAccountId;
    };

    // Aggregate data by campaign for table (campaign-level; live Meta API data)
    const campaignData = useMemo(() => {
        const campaignMap = {};

        insightsData.forEach((r) => {
            const key = String(r.campaign_id || r.campaign || 'unknown');

            if (!campaignMap[key]) {
                const firstAdName = (r.ad_name && String(r.ad_name).trim()) ? r.ad_name.trim() : '—';
                campaignMap[key] = {
                    id: key,
                    campaign_id: r.campaign_id,
                    name: r.campaign || 'Unknown Campaign',
                    ad_name: firstAdName,
                    ad_account_id: r.ad_account_id || null,
                    ad_account_name: r.ad_account_name || '',
                    spend: 0,
                    revenue: 0,
                    impressions: 0,
                    clicks: 0,
                    leads: 0,
                    conversions: 0,
                    video_play: 0,
                    video_p100_watched: 0
                };
            }

            campaignMap[key].spend += r.spend || 0;
            campaignMap[key].revenue += r.revenue || 0;
            campaignMap[key].impressions += r.impressions || 0;
            campaignMap[key].clicks += r.clicks || 0;
            campaignMap[key].leads += r.leads || 0;
            campaignMap[key].conversions += r.conversions || 0;
            campaignMap[key].video_play += r.video_play || 0;
            campaignMap[key].video_p100_watched += r.video_p100_watched || 0;
        });

        const result = Object.values(campaignMap)
            .map((item) => {
                const ctr = item.impressions > 0 ? (item.clicks / item.impressions) * 100 : 0;
                const cpm = item.impressions > 0 ? (item.spend / item.impressions) * 1000 : 0;
                const cpl = item.leads > 0 ? item.spend / item.leads : 0;
                const conversionRate = item.leads > 0 ? (item.conversions / item.leads) * 100 : 0;
                const roas = item.spend > 0 ? (item.conversions * REVENUE_PER_CONVERSION) / item.spend : null;
                const ad_account_display = getAdAccountDisplay(item.ad_account_id, item.ad_account_name);
                const plays = item.video_play || 0;
                const hookRate = item.impressions > 0 && plays > 0 ? Math.round((plays / item.impressions) * 10000) / 100 : null;
                // Hold Rate = video_p100_watched_actions / video_play × 100; show 0% when plays > 0 but no 100% watches
                const holdRate = plays > 0 ? Math.round(((item.video_p100_watched || 0) / plays) * 10000) / 100 : null;
                return {
                    ...item,
                    ad_account_display,
                    ctr,
                    cpm,
                    cpl,
                    conversionRate,
                    roas,
                    hookRate,
                    holdRate
                };
            })
            .sort((a, b) => {
                const leadDiff = (b.leads || 0) - (a.leads || 0);
                if (leadDiff !== 0) return leadDiff;
                return (b.spend || 0) - (a.spend || 0);
            });
        return result;
    }, [insightsData, adAccounts, getAdAccountDisplay]);

    // When user has entered any manual Conversion Count, sort table by ROAS (desc); otherwise keep sort by leads (desc)
    const hasManualConversion = Object.keys(manualConversionByCampaign).length > 0;
    const campaignDataForTable = useMemo(() => {
        if (!hasManualConversion) return campaignData;
        return [...campaignData].sort((a, b) => {
            const convA = manualConversionByCampaign[a.id] !== undefined ? manualConversionByCampaign[a.id] : a.conversions;
            const convB = manualConversionByCampaign[b.id] !== undefined ? manualConversionByCampaign[b.id] : b.conversions;
            const roasA = a.spend > 0 ? (Number(convA) || 0) * REVENUE_PER_CONVERSION / a.spend : 0;
            const roasB = b.spend > 0 ? (Number(convB) || 0) * REVENUE_PER_CONVERSION / b.spend : 0;
            return roasB - roasA;
        });
    }, [campaignData, manualConversionByCampaign]);

    // Total conversion count for KPI: sum of manual overrides (when set) or API conversions per campaign
    const totalConversionCount = useMemo(() => {
        return campaignData.reduce((sum, row) => {
            const effective = manualConversionByCampaign[row.id] !== undefined
                ? manualConversionByCampaign[row.id]
                : row.conversions;
            return sum + (Number(effective) || 0);
        }, 0);
    }, [campaignData, manualConversionByCampaign]);

    // Date range filter handler (same as Ads Analytics Dashboard)
    const handleDateRangeApply = (payload) => {
        if (!payload.start_date || !payload.end_date) {
            console.error('[DateRangeFilter] Invalid dates received:', payload);
            alert('Invalid date range selected. Please try again.');
            return;
        }
        const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
        if (!dateRegex.test(payload.start_date) || !dateRegex.test(payload.end_date)) {
            console.error('[DateRangeFilter] Invalid date format:', payload);
            alert('Invalid date format. Please try again.');
            return;
        }
        setDateRangeFilterValue(payload);
        setFilters({
            startDate: payload.start_date,
            endDate: payload.end_date
        });
        setShowDateRangeFilter(false);
    };

    const getDateRangeDisplay = () => {
        if (!dateRangeFilterValue) return 'Last 7 days';
        if (dateRangeFilterValue.range_type === 'custom') {
            const start = new Date(dateRangeFilterValue.start_date);
            const end = new Date(dateRangeFilterValue.end_date);
            const startDisplay = start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
            const endDisplay = end.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
            return `${startDisplay} - ${endDisplay}`;
        }
        const presetLabels = {
            today: 'Today',
            yesterday: 'Yesterday',
            today_yesterday: 'Today & Yesterday',
            last_7_days: 'Last 7 days',
            last_14_days: 'Last 14 days',
            last_28_days: 'Last 28 days',
            last_30_days: 'Last 30 days',
            this_week: 'This week',
            last_week: 'Last week',
            this_month: 'This month',
            last_month: 'Last month',
            maximum: 'Maximum'
        };
        return presetLabels[dateRangeFilterValue.range_type] || dateRangeFilterValue.range_type;
    };

    return (
        <div className="best-ad-container">
            {/* Error Message */}
            {error && (
                <div className="alert alert-warning alert-dismissible fade show mb-3" role="alert">
                    <strong>⚠️ {error}</strong>
                    <br />
                    <small>
                        Please configure your Meta API credentials (META_ACCESS_TOKEN, META_AD_ACCOUNT_ID) in server/.env file to view your ad data.
                    </small>
                    <button
                        type="button"
                        className="btn-close"
                        onClick={() => setError(null)}
                        aria-label="Close"
                    ></button>
                </div>
            )}

            {/* --- FILTERS ROW: 1. Time Range, 2. All Projects --- */}
            <div className="filters-bar">
                {/* 1. Time Range (same as Ads Analytics Dashboard) */}
                <div className="filter-block">
                    <label className="filter-label"><span className="filter-emoji">📅</span> Time Range</label>
                    <button
                        type="button"
                        className="filter-time-range-btn d-flex align-items-center gap-2 px-3 py-2 border shadow-sm cursor-pointer"
                        onClick={() => setShowDateRangeFilter(true)}
                        style={{
                            borderRadius: '5px',
                            color: 'var(--text, #64748b)',
                            borderColor: 'rgba(0, 0, 0, 0.1)',
                            minWidth: '180px',
                            border: '1px solid rgba(0, 0, 0, 0.1)',
                            background: 'var(--card, #ffffff)',
                            width: '100%'
                        }}
                    >
                        <i className="far fa-calendar-alt text-secondary opacity-75"></i>
                        <span className="fw-medium small text-dark flex-grow-1 text-center filter-time-range-text" style={{ fontSize: '0.8rem' }}>
                            {getDateRangeDisplay()}
                        </span>
                        <i className="fas fa-chevron-down text-secondary opacity-50 small"></i>
                    </button>
                </div>

                {/* 2. All Projects - custom dropdown with hover split view */}
                <div className="filter-block projects-dropdown-wrapper">
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

                {/* 3. Ad Account - same as Ads Analytics Dashboard */}
                <div className="filter-block filter-block-ad-account">
                    <MultiSelectFilter
                        label="Ad Account"
                        emoji="🏢"
                        options={selectedProject ? accountsForProject : (specifiedAdAccounts || [])}
                        selectedValues={selectedAdAccounts}
                        onChange={(values) => setSelectedAdAccounts(values)}
                        placeholder="All Ad Accounts"
                        getOptionLabel={(opt) => opt.account_name || opt.name || `Account ${opt.account_id || opt.id}`}
                        getOptionValue={(opt) => normalizeAccountId(opt.account_id || opt.id)}
                        disabled={adAccountsLoading}
                        loading={adAccountsLoading}
                    />
                </div>
            </div>

            {/* --- KPI CARDS ROW (same structure as Ads Analytics Dashboard) --- */}
            <div className="row g-3 mb-4">
                {/* 1. Ad Spend */}
                <div className="col-6 col-md-4 col-lg-2">
                    <div className="kpi-card kpi-card-primary">
                        <div className="kpi-card-body">
                            <div className="kpi-icon">💰</div>
                            <small className="kpi-label">Ad Spend</small>
                            <div className="kpi-value">{dataLoading ? 'Loading...' : formatMoney(totals.spend)}</div>
                        </div>
                    </div>
                </div>

                {/* 2. Total Leads */}
                <div className="col-6 col-md-4 col-lg-2">
                    <div className="kpi-card kpi-card-success">
                        <div className="kpi-card-body">
                            <div className="kpi-icon">👥</div>
                            <small className="kpi-label">Total Leads</small>
                            <div className="kpi-value">{dataLoading ? 'Loading...' : formatNum(totals.leads)}</div>
                            <small className="kpi-subtitle">Volume</small>
                        </div>
                    </div>
                </div>

                {/* 3. CPL */}
                <div className="col-6 col-md-4 col-lg-2">
                    <div className="kpi-card kpi-card-warning">
                        <div className="kpi-card-body">
                            <div className="kpi-icon">💵</div>
                            <small className="kpi-label">Cost Per Lead</small>
                            <div className="kpi-value">{dataLoading ? 'Loading...' : formatMoney(totals.cpl)}</div>
                        </div>
                    </div>
                </div>

                {/* 4. Conversion Rate */}
                <div className="col-6 col-md-4 col-lg-2">
                    <div className="kpi-card kpi-card-purple">
                        <div className="kpi-card-body">
                            <div className="kpi-icon">📊</div>
                            <small className="kpi-label">Conversion Rate</small>
                            <div className="kpi-value">{dataLoading ? 'Loading...' : formatPerc(totals.leads > 0 ? (totals.conversions / totals.leads) * 100 : 0)}</div>
                            <small className="kpi-subtitle">Clicks to Conversions</small>
                        </div>
                    </div>
                </div>

                {/* 5. CPM */}
                <div className="col-6 col-md-4 col-lg-2">
                    <div className="kpi-card kpi-card-info">
                        <div className="kpi-card-body">
                            <div className="kpi-icon">👁️</div>
                            <small className="kpi-label">CPM</small>
                            <div className="kpi-value">{dataLoading ? 'Loading...' : formatMoney(totals.cpm)}</div>
                        </div>
                    </div>
                </div>

                {/* 6. Conversion Count */}
                <div className="col-6 col-md-4 col-lg-2">
                    <div className="kpi-card kpi-card-teal">
                        <div className="kpi-card-body">
                            <div className="kpi-icon">✅</div>
                            <small className="kpi-label">Conversion Count</small>
                            <div className="kpi-value">{dataLoading ? 'Loading...' : formatNum(totalConversionCount)}</div>
                            <small className="kpi-subtitle">Total Conversions</small>
                        </div>
                    </div>
                </div>
            </div>

            {/* --- MIDDLE SECTION: FUNNEL & LINE CHART --- */}
            <div className="middle-section">

                {/* PERFORMANCE FUNNEL - custom layout (no overlapping, clear shape) */}
                <div className="chart-box">
                    <div className="chart-header">
                        <div className="chart-title-text">Performance Funnel</div>
                        <i className="fas fa-ellipsis-v text-muted" style={{ cursor: 'pointer' }}></i>
                    </div>
                    <div className="performance-funnel">
                        {funnelData.map((step, index) => (
                            <div key={step.name} className="funnel-row" style={{ animationDelay: `${index * 0.08}s` }}>
                                <div className="funnel-segment-wrap">
                                    <div
                                        className="funnel-segment"
                                        style={{
                                            '--funnel-fill': step.fill,
                                            '--funnel-width': index === 0 ? '92%' : index === 1 ? '68%' : '44%'
                                        }}
                                    />
                                </div>
                                <div className="funnel-label-block">
                                    <span className="funnel-label-name">{step.name}</span>
                                    <span className="funnel-label-value">{formatNum(step.value)}</span>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                {/* DYNAMICS CHART */}
                <div className="chart-box">
                    <div className="chart-header">
                        <div className="chart-title-text">Amount spend & Lead Generated from Ad dynamics</div>
                        <div className="d-flex text-muted gap-3">
                            <i className="fas fa-arrow-up"></i>
                            <i className="fas fa-arrow-down"></i>
                            <i className="fas fa-filter"></i>
                            <i className="fas fa-ellipsis-v"></i>
                        </div>
                    </div>
                    <div style={{ width: '100%', height: 300 }}>
                        <ResponsiveContainer width="100%" height="100%">
                            <ComposedChart data={dynamicsData} margin={{ top: 5, right: 10, left: 0, bottom: 30 }}>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                                <XAxis dataKey="adNameShort" tick={{ fontSize: 9, fill: '#64748b' }} axisLine={false} tickLine={false} angle={-35} textAnchor="end" height={50} />
                                <YAxis yAxisId="left" tick={{ fontSize: 10, fill: '#64748b' }} axisLine={false} tickLine={false} />
                                <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10, fill: '#64748b' }} axisLine={false} tickLine={false} />
                                <Tooltip 
                                    contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 2px 10px rgba(0,0,0,0.1)' }}
                                    content={({ active, payload }) => {
                                        if (!active || !payload?.length) return null;
                                        const p = payload[0].payload;
                                        return (
                                            <div className="chart-tooltip-custom p-2">
                                                <div className="fw-semibold text-dark mb-2">{p.adName}</div>
                                                <div>Amount spend : {formatINR(p.spend)}</div>
                                                <div>Lead Generated from Ad : {formatNum(p.leadGenerated)}</div>
                                            </div>
                                        );
                                    }}
                                />
                                <Legend wrapperStyle={{ fontSize: '12px', paddingTop: '10px' }} />
                                <Line yAxisId="left" type="monotone" dataKey="spend" name="Amount spend" stroke="#0ea5e9" strokeWidth={2} dot={{ r: 3 }} />
                                <Line yAxisId="right" type="monotone" dataKey="leadGenerated" name="Lead Generated from Ad" stroke="#94a3b8" strokeWidth={2} dot={{ r: 3 }} />
                            </ComposedChart>
                        </ResponsiveContainer>
                    </div>
                </div>
            </div>

            {/* --- BOTTOM CHARTS ROW (3 Charts) --- */}
            <div className="bottom-charts-grid">
                {/* 1. Impressions & CPM */}
                <div className="chart-box">
                    <div className="chart-header"><div className="chart-title-text">Impressions & CPM</div></div>
                    <div style={{ height: 200 }}>
                        <ResponsiveContainer width="100%" height="100%">
                            <ComposedChart data={impressionsData} margin={{ bottom: 30 }}>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                                <XAxis dataKey="adNameShort" tick={{ fontSize: 9 }} angle={-35} textAnchor="end" height={50} />
                                <YAxis yAxisId="left" hide />
                                <YAxis yAxisId="right" orientation="right" hide />
                                <Tooltip 
                                    content={({ active, payload }) => {
                                        if (!active || !payload?.length) return null;
                                        const p = payload[0].payload;
                                        return (
                                            <div className="chart-tooltip-custom p-2">
                                                <div className="fw-semibold text-dark mb-2">{p.adName}</div>
                                                <div>Impressions : {formatNum(p.imp)}</div>
                                                <div>CPM : {formatINR(p.cpm)}</div>
                                            </div>
                                        );
                                    }}
                                />
                                <Legend iconType="circle" wrapperStyle={{ fontSize: '10px' }} />
                                <Bar yAxisId="left" dataKey="imp" name="Impressions" fill="#60a5fa" radius={[2, 2, 0, 0]} barSize={10} />
                                <Line yAxisId="right" type="monotone" dataKey="cpm" name="CPM" stroke="#f43f5e" strokeWidth={2} dot={false} />
                            </ComposedChart>
                        </ResponsiveContainer>
                    </div>
                </div>

                {/* 2. Link clicks & Conversion Rate */}
                <div className="chart-box">
                    <div className="chart-header"><div className="chart-title-text">Link clicks & Conversion Rate</div></div>
                    <div style={{ height: 200 }}>
                        <ResponsiveContainer width="100%" height="100%">
                            <ComposedChart data={clicksData} margin={{ bottom: 30 }}>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                                <XAxis dataKey="adNameShort" tick={{ fontSize: 9 }} angle={-35} textAnchor="end" height={50} />
                                <YAxis yAxisId="left" hide />
                                <YAxis yAxisId="right" orientation="right" hide />
                                <Tooltip 
                                    content={({ active, payload }) => {
                                        if (!active || !payload?.length) return null;
                                        const p = payload[0].payload;
                                        return (
                                            <div className="chart-tooltip-custom p-2">
                                                <div className="fw-semibold text-dark mb-2">{p.adName}</div>
                                                <div>Link clicks : {formatNum(p.clicks)}</div>
                                                <div>Conversion Rate : {formatPerc(p.conversionRate)}</div>
                                            </div>
                                        );
                                    }}
                                />
                                <Legend iconType="circle" wrapperStyle={{ fontSize: '10px' }} />
                                <Bar yAxisId="left" dataKey="clicks" name="Link clicks" fill="#4ade80" radius={[2, 2, 0, 0]} barSize={10} />
                                <Line yAxisId="right" type="monotone" dataKey="conversionRate" name="Conversion Rate" stroke="#8b5cf6" strokeWidth={2} dot={false} />
                            </ComposedChart>
                        </ResponsiveContainer>
                    </div>
                </div>

                {/* 3. Leads & CPL */}
                <div className="chart-box">
                    <div className="chart-header"><div className="chart-title-text">Leads & CPL</div></div>
                    <div style={{ height: 200 }}>
                        <ResponsiveContainer width="100%" height="100%">
                            <ComposedChart data={leadsData} margin={{ bottom: 30 }}>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                                <XAxis dataKey="adNameShort" tick={{ fontSize: 9 }} angle={-35} textAnchor="end" height={50} />
                                <YAxis yAxisId="left" hide />
                                <YAxis yAxisId="right" orientation="right" hide />
                                <Tooltip 
                                    content={({ active, payload }) => {
                                        if (!active || !payload?.length) return null;
                                        const p = payload[0].payload;
                                        return (
                                            <div className="chart-tooltip-custom p-2">
                                                <div className="fw-semibold text-dark mb-2">{p.adName}</div>
                                                <div>Leads : {formatNum(p.leads)}</div>
                                                <div>CPL : {formatINR(p.cpl)}</div>
                                            </div>
                                        );
                                    }}
                                />
                                <Legend iconType="circle" wrapperStyle={{ fontSize: '10px' }} />
                                <Bar yAxisId="left" dataKey="leads" name="Leads" fill="#5b45b0" radius={[2, 2, 0, 0]} barSize={10} />
                                <Line yAxisId="right" type="monotone" dataKey="cpl" name="CPL" stroke="#10b981" strokeWidth={2} dot={false} />
                            </ComposedChart>
                        </ResponsiveContainer>
                    </div>
                </div>
            </div>

            {/* --- TABLE SECTION --- */}
            <div className="table-container">
                <div className="chart-header mb-3">
                    <div className="chart-title-text">Campaign performance</div>
                </div>
                <div className="campaign-table-scroll">
                <table className="performance-table">
                    <thead style={{ position: 'sticky', top: 0, zIndex: 10, backgroundColor: '#f8fafc' }}>
                        <tr>
                            <th>Ad account</th>
                            <th>Campaign name</th>
                            <th>Ad name</th>
                            <th>Amount spend</th>
                            <th>Lead Generated from Ad</th>
                            <th>Conversion Count</th>
                            <th>Conversion Rate</th>
                            <th>CTR</th>
                            <th>CPL</th>
                            <th>CPM</th>
                            <th>Hook Rate</th>
                            <th>Hold Rate</th>
                            <th>ROAS</th>
                        </tr>
                    </thead>
                    <tbody>
                        {dataLoading ? (
                            <tr>
                                <td colSpan="13" className="text-center py-4">
                                    <div className="spinner-border spinner-border-sm text-primary" role="status">
                                        <span className="visually-hidden">Loading...</span>
                                    </div>
                                    <span className="ms-2">Loading campaign data...</span>
                                </td>
                            </tr>
                        ) : campaignDataForTable.length === 0 ? (
                            <tr>
                                <td colSpan="13" className="text-center py-4 text-muted">
                                    No campaign data available. Please select filters or check your Meta API connection.
                                </td>
                            </tr>
                        ) : (
                            campaignDataForTable.map((row) => {
                                const effectiveConversions = manualConversionByCampaign[row.id] !== undefined
                                    ? manualConversionByCampaign[row.id]
                                    : row.conversions;
                                const effectiveConversionRate = row.leads > 0
                                    ? (effectiveConversions / row.leads) * 100
                                    : 0;
                                const effectiveRoas = row.spend > 0 ? (effectiveConversions * REVENUE_PER_CONVERSION) / row.spend : null;
                                return (
                                <tr key={row.id}>
                                    <td>{row.ad_account_display}</td>
                                    <td>{row.name}</td>
                                    <td>{row.ad_name}</td>
                                    <td className={getBgClass(row.spend, 'spend')}>
                                        {formatINR(row.spend)}
                                    </td>
                                    <td className={getBgClass(row.leads, 'leadGenerated')}>
                                        {formatNum(row.leads)}
                                    </td>
                                    <td className={getBgClass(effectiveConversions, 'conversionCount')}>
                                        <input
                                            type="number"
                                            min={0}
                                            step={1}
                                            className="conversion-count-input"
                                            value={manualConversionByCampaign[row.id] !== undefined ? manualConversionByCampaign[row.id] : row.conversions}
                                            onChange={(e) => {
                                                const v = e.target.value;
                                                if (v === '') {
                                                    setManualConversionByCampaign((prev) => {
                                                        const next = { ...prev };
                                                        delete next[row.id];
                                                        return next;
                                                    });
                                                } else {
                                                    const n = parseInt(v, 10);
                                                    if (!Number.isNaN(n) && n >= 0) {
                                                        setManualConversionByCampaign((prev) => ({ ...prev, [row.id]: n }));
                                                    }
                                                }
                                            }}
                                            aria-label={`Conversion count for ${row.name}`}
                                        />
                                    </td>
                                    <td className={getBgClass(effectiveConversionRate, 'conversionRate')}>
                                        {formatPerc(effectiveConversionRate)}
                                    </td>
                                    <td>{formatPerc(row.ctr)}</td>
                                    <td className={getBgClass(row.cpl, 'cpl')}>
                                        {formatINR(row.cpl)}
                                    </td>
                                    <td>{formatINR(row.cpm)}</td>
                                    <td>{row.hookRate != null ? formatPerc(row.hookRate) : '—'}</td>
                                    <td>{row.holdRate != null ? formatPerc(row.holdRate) : '—'}</td>
                                    <td>{formatROAS(effectiveRoas)}</td>
                                </tr>
                                );
                            })
                        )}
                    </tbody>
                </table>
                </div>
                <div className="d-flex justify-content-end mt-3 text-muted small">
                    {campaignDataForTable.length > 0 ? (
                        <>
                            1 - {campaignDataForTable.length} campaigns · Sorted by ROAS (descending)
                            <i className="fas fa-chevron-left ms-3 me-2"></i> <i className="fas fa-chevron-right"></i>
                        </>
                    ) : null}
                </div>
            </div>

            {/* Date Range Filter Modal (same as Ads Analytics Dashboard) */}
            <DateRangeFilter
                isOpen={showDateRangeFilter}
                onClose={() => setShowDateRangeFilter(false)}
                onApply={handleDateRangeApply}
                initialValue={dateRangeFilterValue || {
                    range_type: 'last_7_days',
                    start_date: filters.startDate || null,
                    end_date: filters.endDate || null,
                    timezone: 'Asia/Kolkata',
                    compare: { enabled: false }
                }}
            />
        </div>
    );
}
