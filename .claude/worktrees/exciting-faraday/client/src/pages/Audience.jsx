import React, { useState, useEffect } from 'react';
import {
    BarChart,
    Bar,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
    AreaChart,
    Area,
    Legend
} from 'recharts';
import { motion, AnimatePresence } from 'framer-motion';
import MultiSelectFilter from '../components/MultiSelectFilter';
import DateRangeFilter from '../components/DateRangeFilter';
import './Audience.css';

const getAuthToken = () => {
    try {
        const STORAGE_KEY = process.env.REACT_APP_STORAGE_KEY || 'app_auth';
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored) {
            const data = JSON.parse(stored);
            return data.token;
        }
    } catch (e) {
        console.error('Error getting token:', e);
    }
    return null;
};

const API_BASE = process.env.REACT_APP_API_BASE || 'http://localhost:4000';

const fetchPages = async () => {
    try {
        const token = getAuthToken();
        const headers = { 'Content-Type': 'application/json' };
        if (token) headers['Authorization'] = `Bearer ${token}`;
        const res = await fetch(`${API_BASE}/api/meta/pages`, { headers });
        if (!res.ok) {
            const errorData = await res.json().catch(() => ({}));
            console.error('API error fetching pages:', errorData);
            return [];
        }
        const data = await res.json();
        return data.data || [];
    } catch (e) {
        console.error('Error fetching pages:', e);
        return [];
    }
};

const fetchPageInsights = async (pageId, from, to) => {
    const token = getAuthToken();
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    // Use server default metrics (page_follows, page_media_view, page_fan_removes) to avoid Meta #100 invalid metric
    const res = await fetch(`${API_BASE}/api/meta/pages/${pageId}/insights?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, { headers });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.details || err.error || res.statusText);
    }
    const json = await res.json();
    return json.data || null;
};

const fetchDemographicInsights = async (from, to, pageId) => {
    const token = getAuthToken();
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    let url = `${API_BASE}/api/meta/insights/demographics?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&breakdowns=age,gender,country`;
    if (pageId) url += `&page_id=${encodeURIComponent(pageId)}`;
    const res = await fetch(url, { headers });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.details || err.error || res.statusText);
    }
    return await res.json();
};

const fetchDailyInsights = async (from, to) => {
    const token = getAuthToken();
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const res = await fetch(`${API_BASE}/api/meta/insights/daily?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, { headers });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.details || err.error || res.statusText);
    }
    const json = await res.json();
    return json.data || null;
};

const fetchInstagramAudienceDemographics = async (pageId, timeframe) => {
    const token = getAuthToken();
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const res = await fetch(`${API_BASE}/api/meta/instagram-audience-demographics?page_id=${encodeURIComponent(pageId)}&timeframe=${encodeURIComponent(timeframe)}`, { headers });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.details || err.error || res.statusText);
    }
    const json = await res.json();
    return json.data || null;
};

// Instagram reach by follow_type (Meta: metric=reach, period=day, metric_type=total_value, breakdown=follow_type)
const fetchInstagramReachByFollowType = async (pageId, from, to) => {
    const token = getAuthToken();
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const res = await fetch(
        `${API_BASE}/api/meta/instagram/reach-by-follow-type?page_id=${encodeURIComponent(pageId)}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
        { headers }
    );
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.details || err.error || res.statusText);
    }
    const json = await res.json();
    return { data: json.data || null, message: json.message || null };
};

// Instagram online_followers — best posting times (heatmap, peak hours, recommendation)
const fetchInstagramOnlineFollowers = async (pageId) => {
    const token = getAuthToken();
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const tz = typeof Intl !== 'undefined' && Intl.DateTimeFormat?.().resolvedOptions?.().timeZone;
    const params = new URLSearchParams({ page_id: pageId });
    if (tz) params.set('timezone', tz);
    const res = await fetch(
        `${API_BASE}/api/meta/instagram/online-followers?${params.toString()}`,
        { headers }
    );
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.details || err.error || res.statusText);
    }
    return await res.json();
};

// Facebook Page audience — followers, age/gender, cities, countries (for Audience page when platform=Facebook)
const fetchFacebookPageAudience = async (pageId, from, to) => {
    const token = getAuthToken();
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const res = await fetch(
        `${API_BASE}/api/meta/facebook-page-audience?page_id=${encodeURIComponent(pageId)}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
        { headers }
    );
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.details || err.error || res.statusText);
    }
    const json = await res.json();
    return json.data || null;
};

const getContentDefaultDates = () => {
    const today = new Date();
    const endDate = new Date(today);
    endDate.setDate(endDate.getDate() - 1);
    const startDate = new Date(endDate);
    startDate.setDate(startDate.getDate() - 6);
    return {
        startDate: startDate.toISOString().slice(0, 10),
        endDate: endDate.toISOString().slice(0, 10)
    };
};

export default function Audience() {
    const [activeTab, setActiveTab] = useState('Demographics');
    const [genderFilter, setGenderFilter] = useState('All');

    // Platform View States
    const [platformMetric1, setPlatformMetric1] = useState('Reach');
    const [platformMetric2, setPlatformMetric2] = useState('Results');

    // Time Range filter (Content Marketing style)
    const [contentFilters, setContentFilters] = useState(() => getContentDefaultDates());
    const [contentDateRange, setContentDateRange] = useState('last_7_days');
    const [showContentDateRangeFilter, setShowContentDateRangeFilter] = useState(false);
    const [contentDateRangeFilterValue, setContentDateRangeFilterValue] = useState(null);

    // Platform filter (between Time Range and PAGE)
    const platformFilterOptions = [
        { id: 'all', name: 'All Platforms' },
        { id: 'facebook', name: 'Facebook' },
        { id: 'instagram', name: 'Instagram' },
        { id: 'audience_network', name: 'Audience Network' },
        { id: 'messenger', name: 'Messenger' },
        { id: 'threads', name: 'Threads' },
        { id: 'whatsapp', name: 'WhatsApp' },
    ];
    const [platformFilters, setPlatformFilters] = useState([]);

    // PAGE filter (Content Marketing style)
    const [pages, setPages] = useState([]);
    const [audiencePage, setAudiencePage] = useState(null);

    // PAGE filter shown when Facebook or Instagram is selected
    const isInstagramSelected = platformFilters && platformFilters.some((p) => (p?.id || p) === 'instagram');
    const isFacebookSelected = platformFilters && platformFilters.some((p) => (p?.id || p) === 'facebook');
    const showPageFilter = isInstagramSelected || isFacebookSelected;

    // Live data from Meta (Page Insights + Daily Ad Insights + Demographics)
    const [pageInsightsData, setPageInsightsData] = useState(null);
    const [pageInsightsLoading, setPageInsightsLoading] = useState(false);
    const [pageInsightsError, setPageInsightsError] = useState(null);
    const [dailyInsightsData, setDailyInsightsData] = useState(null);
    const [dailyInsightsLoading, setDailyInsightsLoading] = useState(false);
    const [dailyInsightsError, setDailyInsightsError] = useState(null);
    const [demographicsData, setDemographicsData] = useState(null);
    const [demographicsLoading, setDemographicsLoading] = useState(false);
    const [demographicsError, setDemographicsError] = useState(null);
    const [igAudienceData, setIgAudienceData] = useState(null);
    const [igAudienceLoading, setIgAudienceLoading] = useState(false);
    const [igAudienceError, setIgAudienceError] = useState(null);
    const [reachByFollowTypeData, setReachByFollowTypeData] = useState(null);
    const [reachByFollowTypeMessage, setReachByFollowTypeMessage] = useState(null);
    const [reachByFollowTypeLoading, setReachByFollowTypeLoading] = useState(false);
    const [reachByFollowTypeError, setReachByFollowTypeError] = useState(null);
    const [onlineFollowersInsight, setOnlineFollowersInsight] = useState(null);
    const [onlineFollowersMessage, setOnlineFollowersMessage] = useState(null); // backend message when sample/empty
    const [onlineFollowersLoading, setOnlineFollowersLoading] = useState(false);
    const [onlineFollowersError, setOnlineFollowersError] = useState(null);
    const [heatmapTooltip, setHeatmapTooltip] = useState(null); // { dayIndex, hour, x, y }
    const [fbAudienceData, setFbAudienceData] = useState(null);
    const [fbAudienceLoading, setFbAudienceLoading] = useState(false);
    const [fbAudienceError, setFbAudienceError] = useState(null);

    useEffect(() => {
        const loadPages = async () => {
            const pagesData = await fetchPages();
            setPages(pagesData || []);
        };
        loadPages();
    }, []);

    // When neither Facebook nor Instagram is selected, clear PAGE so next time they see "Select a Page"
    useEffect(() => {
        if (!showPageFilter) {
            setAudiencePage(null);
        }
    }, [showPageFilter]);

    // Fetch page insights when PAGE and time range are set (Facebook or Instagram selected)
    useEffect(() => {
        if (!showPageFilter) {
            setPageInsightsData(null);
            setPageInsightsError(null);
            return;
        }
        const pageId = audiencePage?.id ?? audiencePage;
        if (!pageId || !contentFilters.startDate || !contentFilters.endDate) {
            setPageInsightsData(null);
            setPageInsightsError(null);
            return;
        }
        let cancelled = false;
        setPageInsightsLoading(true);
        setPageInsightsError(null);
        fetchPageInsights(pageId, contentFilters.startDate, contentFilters.endDate)
            .then((data) => {
                if (!cancelled) setPageInsightsData(data);
            })
            .catch((err) => {
                if (!cancelled) setPageInsightsError(err?.message || 'Failed to load page insights');
            })
            .finally(() => {
                if (!cancelled) setPageInsightsLoading(false);
            });
        return () => { cancelled = true; };
    }, [showPageFilter, audiencePage, contentFilters.startDate, contentFilters.endDate]);

    // Fetch Facebook Page audience (followers, demographics) when Facebook + PAGE selected
    useEffect(() => {
        if (!isFacebookSelected || !audiencePage || !contentFilters.startDate || !contentFilters.endDate) {
            setFbAudienceData(null);
            setFbAudienceError(null);
            return;
        }
        const pageId = audiencePage?.id ?? audiencePage;
        let cancelled = false;
        setFbAudienceLoading(true);
        setFbAudienceError(null);
        fetchFacebookPageAudience(pageId, contentFilters.startDate, contentFilters.endDate)
            .then((data) => { if (!cancelled) setFbAudienceData(data); })
            .catch((err) => {
                if (!cancelled) setFbAudienceError(err?.message || 'Failed to load Facebook audience');
            })
            .finally(() => {
                if (!cancelled) setFbAudienceLoading(false);
            });
        return () => { cancelled = true; };
    }, [isFacebookSelected, audiencePage, contentFilters.startDate, contentFilters.endDate]);

    // Fetch daily ad account insights (impressions, reach, clicks) for Page performance chart
    useEffect(() => {
        if (!contentFilters.startDate || !contentFilters.endDate) {
            setDailyInsightsData(null);
            setDailyInsightsError(null);
            return;
        }
        let cancelled = false;
        setDailyInsightsLoading(true);
        setDailyInsightsError(null);
        fetchDailyInsights(contentFilters.startDate, contentFilters.endDate)
            .then((data) => { if (!cancelled) setDailyInsightsData(data); })
            .catch((err) => {
                if (!cancelled) setDailyInsightsError(err?.message || 'Failed to load daily insights');
            })
            .finally(() => {
                if (!cancelled) setDailyInsightsLoading(false);
            });
        return () => { cancelled = true; };
    }, [contentFilters.startDate, contentFilters.endDate]);

    // Fetch Instagram audience demographics when a PAGE is selected (works for both Instagram and Facebook pages since each FB page has a linked IG account)
    useEffect(() => {
        if (!isInstagramSelected && !isFacebookSelected) {
            setIgAudienceData(null);
            setIgAudienceError(null);
            return;
        }
        const pageId = audiencePage?.id ?? audiencePage;
        if (!pageId || !contentFilters.startDate || !contentFilters.endDate) {
            setIgAudienceData(null);
            setIgAudienceError(null);
            return;
        }
        const start = new Date(contentFilters.startDate);
        const end = new Date(contentFilters.endDate);
        const days = Math.round((end - start) / (1000 * 60 * 60 * 24));
        const timeframe = days <= 8 ? 'this_week' : 'this_month';
        let cancelled = false;
        setIgAudienceLoading(true);
        setIgAudienceError(null);
        fetchInstagramAudienceDemographics(pageId, timeframe)
            .then((data) => { if (!cancelled) setIgAudienceData(data); })
            .catch((err) => {
                if (!cancelled) setIgAudienceError(err?.message || 'Failed to load Instagram audience');
            })
            .finally(() => {
                if (!cancelled) setIgAudienceLoading(false);
            });
        return () => { cancelled = true; };
    }, [isInstagramSelected, isFacebookSelected, audiencePage, contentFilters.startDate, contentFilters.endDate]);

    // Fetch Instagram reach by follow_type (Followers vs Non-Followers) for the right-side card (only when Instagram selected)
    useEffect(() => {
        if (!isInstagramSelected) {
            setReachByFollowTypeData(null);
            setReachByFollowTypeMessage(null);
            setReachByFollowTypeError(null);
            return;
        }
        if (!audiencePage || !contentFilters.startDate || !contentFilters.endDate) {
            setReachByFollowTypeData(null);
            setReachByFollowTypeMessage(null);
            setReachByFollowTypeError(null);
            return;
        }
        let cancelled = false;
        setReachByFollowTypeLoading(true);
        setReachByFollowTypeError(null);
        setReachByFollowTypeMessage(null);
        fetchInstagramReachByFollowType(audiencePage?.id ?? audiencePage, contentFilters.startDate, contentFilters.endDate)
            .then((res) => {
                if (cancelled) return;
                setReachByFollowTypeData(res?.data ?? null);
                setReachByFollowTypeMessage(res?.message ?? null);
            })
            .catch((err) => {
                if (!cancelled) setReachByFollowTypeError(err?.message || 'Failed to load reach by follow type');
            })
            .finally(() => {
                if (!cancelled) setReachByFollowTypeLoading(false);
            });
        return () => { cancelled = true; };
    }, [isInstagramSelected, audiencePage, contentFilters.startDate, contentFilters.endDate]);

    // Fetch Instagram online_followers (best posting times, heatmap) when PAGE is selected
    useEffect(() => {
        if (!audiencePage) {
            setOnlineFollowersInsight(null);
            setOnlineFollowersMessage(null);
            setOnlineFollowersError(null);
            return;
        }
        let cancelled = false;
        setOnlineFollowersLoading(true);
        setOnlineFollowersError(null);
        setOnlineFollowersMessage(null);
        fetchInstagramOnlineFollowers(audiencePage?.id ?? audiencePage)
            .then((data) => {
                if (!cancelled) {
                    setOnlineFollowersInsight(data);
                    setOnlineFollowersMessage(data?.message ?? null);
                }
            })
            .catch((err) => {
                if (!cancelled) setOnlineFollowersError(err?.message || 'Failed to load best posting times');
            })
            .finally(() => {
                if (!cancelled) setOnlineFollowersLoading(false);
            });
        return () => { cancelled = true; };
    }, [isInstagramSelected, audiencePage]);

    // Fetch demographic insights (age/gender, country) when time range is set — pass page_id when Facebook page selected
    useEffect(() => {
        if (!contentFilters.startDate || !contentFilters.endDate) {
            setDemographicsData(null);
            setDemographicsError(null);
            return;
        }
        let cancelled = false;
        setDemographicsLoading(true);
        setDemographicsError(null);
        fetchDemographicInsights(contentFilters.startDate, contentFilters.endDate, null)
            .then((payload) => {
                if (!cancelled) {
                    setDemographicsData({
                        age_gender_breakdown: payload.age_gender_breakdown || [],
                        country_breakdown: payload.country_breakdown || [],
                        region_breakdown: payload.region_breakdown || [],
                    });
                }
            })
            .catch((err) => {
                if (!cancelled) setDemographicsError(err?.message || 'Failed to load demographics');
            })
            .finally(() => {
                if (!cancelled) setDemographicsLoading(false);
            });
        return () => { cancelled = true; };
    }, [contentFilters.startDate, contentFilters.endDate, isFacebookSelected, audiencePage]);

    // --- MOCK DATA (fallbacks when API has no data) ---
    const _initialData = [
        { age: '18-24', men: 9, women: 4 },
        { age: '25-34', men: 31, women: 18 },
        { age: '35-44', men: 17, women: 9 },
        { age: '45-54', men: 5, women: 3 },
        { age: '55-64', men: 2, women: 1 },
        { age: '65+', men: 1, women: 0 },
    ];

    const citiesData = [
        { name: "Chennai, Tamil Nadu", val: 26.0, flag: "🇮🇳" },
        { name: "Coimbatore, Tamil Nadu", val: 4.7, flag: "🇮🇳" },
        { name: "Bangalore, Karnataka", val: 4.5, flag: "🇮🇳" },
        { name: "Madurai, Tamil Nadu", val: 2.7, flag: "🇮🇳" },
        { name: "Salem, Tamil Nadu", val: 1.8, flag: "🇮🇳" },
        { name: "Tiruchirappalli, Tamil Nadu", val: 1.7, flag: "🇮🇳" },
        { name: "Tirupur, Tamil Nadu", val: 1.4, flag: "🇮🇳" },
        { name: "Palladam, Tamil Nadu", val: 1.2, flag: "🇮🇳" },
        { name: "Pondicherry", val: 1.1, flag: "🇮🇳" },
        { name: "Colombo, Sri Lanka", val: 0.9, flag: "🇱🇰" },
    ];

    const countriesData = [
        { name: "India", val: 88.4, flag: "🇮🇳" },
        { name: "Sri Lanka", val: 2.7, flag: "🇱🇰" },
        { name: "Malaysia", val: 2.0, flag: "🇲🇾" },
        { name: "United Arab Emirates", val: 1.7, flag: "🇦🇪" },
        { name: "Singapore", val: 0.8, flag: "🇸🇬" },
        { name: "Saudi Arabia", val: 0.7, flag: "🇸🇦" },
        { name: "United Kingdom", val: 0.5, flag: "🇬🇧" },
        { name: "United States", val: 0.5, flag: "🇺🇸" },
        { name: "Qatar", val: 0.4, flag: "🇶🇦" },
        { name: "Kuwait", val: 0.4, flag: "🇰🇼" },
    ];

    // Followers and Non-Followers: Instagram = reach by follow_type; Facebook = page fans (non-followers N/A)
    const followersNonFollowersData = (() => {
        const source = isFacebookSelected && (fbAudienceData || fbAudienceLoading) ? 'facebook' : 'instagram';
        const total = source === 'facebook'
            ? (fbAudienceData?.total_value ?? 0)
            : (reachByFollowTypeData?.total_value ?? 0);
        const followerVal = source === 'facebook'
            ? (fbAudienceData?.follower_value ?? 0)
            : (reachByFollowTypeData?.follower_value ?? 0);
        const nonFollowerVal = source === 'facebook'
            ? (fbAudienceData?.non_follower_value ?? 0)
            : (reachByFollowTypeData?.non_follower_value ?? 0);
        const followersPct = total > 0 ? (followerVal / total) * 100 : (followerVal > 0 ? 100 : 0);
        const nonFollowersPct = total > 0 ? (nonFollowerVal / total) * 100 : 0;
        return {
            follower_value: followerVal,
            non_follower_value: nonFollowerVal,
            total_value: total,
            followersPct,
            nonFollowersPct,
        };
    })();
    const formatReachNum = (n) => (typeof n === 'number' ? n.toLocaleString('en-IN') : '0');

    const platformData = [
        { name: 'Facebook', reach: 480, results: 0 },
        { name: 'Instagram', reach: 30, results: 0 },
        { name: 'Audience Net', reach: 5, results: 0 },
        { name: 'Messenger', reach: 2, results: 0 },
        { name: 'Oculus', reach: 0, results: 0 },
        { name: 'Threads', reach: 0, results: 0 },
        { name: 'WhatsApp', reach: 0, results: 0 },
        { name: 'WhatsApp Bus', reach: 0, results: 0 },
    ];

    // Selected page display name for "When your viewers are on Instagram" title
    const selectedPageName = audiencePage && pages?.length ? (pages.find((p) => p.id === audiencePage)?.name ?? null) : null;

    // When your viewers are on Instagram — use online_followers API data or fallback mock 7×24 grid
    const HEATMAP_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const heatmapGrid = React.useMemo(() => {
        const heatmap = onlineFollowersInsight?.heatmap_data || [];
        const maxVal = onlineFollowersInsight?.max_followers || 1;
        if (heatmap.length >= 24) {
            const byHour = {};
            heatmap.forEach(({ hour, value }) => { byHour[hour] = value; });
            const grid = [];
            for (let d = 0; d < 7; d++) {
                const row = [];
                for (let h = 0; h < 24; h++) {
                    const raw = byHour[h] ?? 0;
                    row.push(maxVal > 0 ? Math.min(1, raw / maxVal) : 0);
                }
                grid.push(row);
            }
            return grid;
        }
        const grid = [];
        for (let d = 0; d < 7; d++) {
            const row = [];
            for (let h = 0; h < 24; h++) {
                let v = 0.2 + 0.3 * Math.random();
                if (h >= 16 && h <= 22) v += 0.35;
                else if (h >= 10 && h <= 14) v += 0.15;
                if (d === 5 || d === 6) v += 0.2;
                row.push(Math.min(1, v));
            }
            grid.push(row);
        }
        return grid;
    }, [onlineFollowersInsight]);

    const heatmapHourMeta = React.useMemo(() => {
        const heatmap = onlineFollowersInsight?.heatmap_data || [];
        const out = {};
        heatmap.forEach(({ hour, value, activity_label }) => {
            out[hour] = { value, activity_label };
        });
        return out;
    }, [onlineFollowersInsight]);

    const getHeatmapTooltipLabel = (value, hour) => {
        const meta = heatmapHourMeta[hour];
        if (meta?.activity_label) return meta.activity_label;
        return value >= 0.6 ? 'Many' : value >= 0.35 ? 'Some' : 'Few';
    };
    const getLocalTimezoneLabel = () => {
        const offset = -new Date().getTimezoneOffset();
        const sign = offset >= 0 ? '+' : '-';
        const abs = Math.abs(offset);
        const h = Math.floor(abs / 60);
        const m = abs % 60;
        return `GMT ${sign}${String(h).padStart(2, '0')}${m ? String(m).padStart(2, '0') : ''}`;
    };

    // Page performance chart: when a page is selected, use page-specific reach/impressions; for clicks use page when available, else fall back to ad account (so Clicks line shows values when page_consumptions is 0)
    const pagePerformanceChartData = (() => {
        const pageSource = audiencePage ? pageInsightsData : null;
        const dailySource = dailyInsightsData;
        const reachArr = (pageSource?.reach || dailySource?.reach) || [];
        const impressionsArr = (pageSource?.impressions || dailySource?.impressions) || [];
        const pageClicks = pageSource?.clicks || [];
        const hasPageClicks = pageClicks.length > 0 && pageClicks.some((c) => Number(c?.value) > 0);
        const clicksArr = (audiencePage && hasPageClicks) ? pageClicks : (dailySource?.clicks || []);
        if (!reachArr.length && !impressionsArr.length && !clicksArr.length) return null;
        const byDate = new Map();
        const add = (arr, key) => {
            (arr || []).forEach(({ date, value }) => {
                if (!date) return;
                if (!byDate.has(date)) byDate.set(date, { date, reach: 0, impressions: 0, clicks: 0 });
                const v = byDate.get(date);
                if (key === 'reach') v.reach += Number(value) || 0;
                else if (key === 'impressions') v.impressions += Number(value) || 0;
                else if (key === 'clicks') v.clicks += Number(value) || 0;
            });
        };
        add(reachArr, 'reach');
        add(impressionsArr, 'impressions');
        add(clicksArr, 'clicks');
        const sorted = [...byDate.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([, row]) => ({
            date: row.date ? new Date(row.date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }).replace(/ /g, ' ') : '',
            reach: row.reach,
            impressions: row.impressions,
            clicks: row.clicks,
        }));
        return sorted.length ? sorted : null;
    })();

    // Age & Gender chart: when a page is selected, use Instagram or Facebook page audience; else use Ads demographics.
    const AGE_BUCKETS = ['18-24', '25-34', '35-44', '45-54', '55-64', '65+'];
    const buildAgeGenderFromBreakdowns = (ageRows, genderRows) => {
        if (!ageRows?.length || !genderRows?.length) return null;
        let totalMale = 0;
        let totalFemale = 0;
        genderRows.forEach((r) => {
            const v = Number(r.value) || 0;
            const g = (r.gender || '').toString().toLowerCase();
            if (g === 'm' || g === 'male') totalMale += v;
            else if (g === 'f' || g === 'female') totalFemale += v;
        });
        const totalGender = totalMale + totalFemale;
        const maleRatio = totalGender > 0 ? totalMale / totalGender : 0.5;
        const femaleRatio = totalGender > 0 ? totalFemale / totalGender : 0.5;
        const out = [];
        ageRows.forEach((r) => {
            const age = (r.age || '').toString().trim();
            if (!age) return;
            const val = Number(r.value) || 0;
            out.push({ age, gender: 'male', reach: Math.round(val * maleRatio) });
            out.push({ age, gender: 'female', reach: Math.round(val * femaleRatio) });
        });
        return out.length ? out : null;
    };
    const ageGenderBreakdownForChart = (() => {
        if (audiencePage && isFacebookSelected && fbAudienceData?.age_breakdown?.length && fbAudienceData?.gender_breakdown?.length) {
            return buildAgeGenderFromBreakdowns(fbAudienceData.age_breakdown, fbAudienceData.gender_breakdown);
        }
        if (audiencePage && igAudienceData?.age_breakdown?.length && igAudienceData?.gender_breakdown?.length) {
            return buildAgeGenderFromBreakdowns(igAudienceData.age_breakdown, igAudienceData.gender_breakdown);
        }
        return demographicsData?.age_gender_breakdown || null;
    })();
    const ageGenderChartData = (() => {
        const rows = ageGenderBreakdownForChart || [];
        if (!rows.length) return null;
        const byAge = {};
        AGE_BUCKETS.forEach((b) => { byAge[b] = { age: b, men: 0, women: 0 }; });
        rows.forEach((r) => {
            const age = (r.age || '').trim() || 'unknown';
            const bucket = AGE_BUCKETS.find((b) => b === age) || (AGE_BUCKETS.includes(age) ? age : null);
            if (!bucket) return;
            const val = Number(r.reach) || Number(r.impressions) || 0;
            const g = (r.gender || '').toLowerCase();
            if (g === 'male' || g === 'm') byAge[bucket].men += val;
            else if (g === 'female' || g === 'f') byAge[bucket].women += val;
        });
        return AGE_BUCKETS.map((b) => byAge[b]);
    })();

    // Age & Gender chart data with "All Ages" total as last column (one chart: 18-24 … 65+ then All Ages)
    const ageGenderChartDataWithTotal = (() => {
        if (!ageGenderChartData || !ageGenderChartData.length) return null;
        const totalMen = ageGenderChartData.reduce((s, row) => s + (Number(row.men) || 0), 0);
        const totalWomen = ageGenderChartData.reduce((s, row) => s + (Number(row.women) || 0), 0);
        return [...ageGenderChartData, { age: 'All Ages', men: totalMen, women: totalWomen }];
    })();

    // Top towns/cities from Instagram or Facebook page audience (city-level) when available
    const topCitiesFromIg = (() => {
        const rows = (isFacebookSelected ? fbAudienceData?.city_breakdown : null) || igAudienceData?.city_breakdown || [];
        if (!rows.length) return null;
        const total = rows.reduce((s, r) => s + (Number(r.value) || 0), 0);
        if (total === 0) return null;
        return rows
            .map((r) => ({
                name: r.city || r.name || 'Unknown',
                val: Math.round(((Number(r.value) || 0) / total) * 1000) / 10,
            }))
            .sort((a, b) => b.val - a.val)
            .slice(0, 10);
    })();

    // Top Regions (towns/cities): build from demographics region_breakdown (percentage of reach) — region-level from Meta Ads Insights (fallback)
    const topRegionsChartData = (() => {
        const rows = demographicsData?.region_breakdown || [];
        if (!rows.length) return null;
        const total = rows.reduce((s, r) => s + (Number(r.reach) || Number(r.impressions) || 0), 0);
        if (total === 0) return null;
        return rows
            .map((r) => ({
                name: r.region || 'Unknown',
                val: Math.round(((Number(r.reach) || Number(r.impressions) || 0) / total) * 1000) / 10,
            }))
            .sort((a, b) => b.val - a.val)
            .slice(0, 10);
    })();

    // Top Countries: build from demographics country_breakdown (percentage of reach); optional code-to-name for display
    const countryFlagMap = {
        IN: '\uD83C\uDDEE\uD83C\uDDF3', LK: '\uD83C\uDDF1\uD83C\uDDF0', MY: '\uD83C\uDDF2\uD83C\uDDFE',
        AE: '\uD83C\uDDE6\uD83C\uDDEA', SG: '\uD83C\uDDF8\uD83C\uDDEC', SA: '\uD83C\uDDF8\uD83C\uDDE6',
        GB: '\uD83C\uDDEC\uD83C\uDDE7', US: '\uD83C\uDDFA\uD83C\uDDF8', QA: '\uD83C\uDDF6\uD83C\uDDE6',
        KW: '\uD83C\uDDF0\uD83C\uDDFC',
    };
    const countryCodeToName = {
        IN: 'India', LK: 'Sri Lanka', MY: 'Malaysia', AE: 'United Arab Emirates', SG: 'Singapore',
        SA: 'Saudi Arabia', GB: 'United Kingdom', US: 'United States', QA: 'Qatar', KW: 'Kuwait',
    };
    const globe = '\uD83C\uDF0D';
    const formatCountryRow = (raw, val) => {
        const code = (raw || '').trim().length === 2 ? (raw || '').trim().toUpperCase() : null;
        const name = code && countryCodeToName[code] ? countryCodeToName[code] : ((raw || '').trim() || 'Unknown');
        return {
            name,
            val,
            flag: countryFlagMap[code || (raw || '').slice(0, 2).toUpperCase()] || globe,
        };
    };
    // Top countries from Instagram or Facebook page audience when available
    const topCountriesFromIg = (() => {
        const rows = (isFacebookSelected ? fbAudienceData?.country_breakdown : null) || igAudienceData?.country_breakdown || [];
        if (!rows.length) return null;
        const total = rows.reduce((s, r) => s + (Number(r.value) || 0), 0);
        if (total === 0) return null;
        return rows
            .map((r) => formatCountryRow(r.country, Math.round(((Number(r.value) || 0) / total) * 1000) / 10))
            .sort((a, b) => b.val - a.val)
            .slice(0, 10);
    })();
    const topCountriesChartData = (() => {
        const rows = demographicsData?.country_breakdown || [];
        if (!rows.length) return null;
        const total = rows.reduce((s, r) => s + (Number(r.reach) || Number(r.impressions) || 0), 0);
        if (total === 0) return null;
        return rows
            .map((r) => formatCountryRow(r.country, Math.round(((Number(r.reach) || Number(r.impressions) || 0) / total) * 1000) / 10))
            .sort((a, b) => b.val - a.val)
            .slice(0, 10);
    })();

    // Always show up to 10 rows: merge API data with fallback when API returns fewer than 10
    const TOP_N = 10;
    const citiesFallback = citiesData.map((c) => ({ name: c.name, val: c.val }));
    const topTownsCitiesDisplay = (() => {
        const base = (topCitiesFromIg || topRegionsChartData) || [];
        if (base.length >= TOP_N) return base.slice(0, TOP_N);
        const byName = new Map(base.map((r) => [r.name, r]));
        for (const c of citiesFallback) {
            if (byName.size >= TOP_N) break;
            if (!byName.has(c.name)) byName.set(c.name, { name: c.name, val: c.val });
        }
        return [...byName.values()].sort((a, b) => b.val - a.val).slice(0, TOP_N);
    })();

    const topCountriesDisplay = (() => {
        const base = (topCountriesFromIg || topCountriesChartData) || [];
        const fallback = countriesData;
        if (base.length >= TOP_N) return base.slice(0, TOP_N);
        const byName = new Map(base.map((r) => [r.name, r]));
        for (const c of fallback) {
            if (byName.size >= TOP_N) break;
            if (!byName.has(c.name)) byName.set(c.name, { name: c.name, val: c.val, flag: c.flag });
        }
        return [...byName.values()].sort((a, b) => b.val - a.val).slice(0, TOP_N);
    })();

    const handleContentDateRangeApply = (payload) => {
        if (!payload.start_date || !payload.end_date) {
            console.error('[Audience DateRangeFilter] Invalid dates received:', payload);
            return;
        }
        const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
        if (!dateRegex.test(payload.start_date) || !dateRegex.test(payload.end_date)) {
            console.error('[Audience DateRangeFilter] Invalid date format:', payload);
            return;
        }
        setContentDateRangeFilterValue(payload);
        setContentDateRange(payload.range_type || 'custom');
        setContentFilters({ startDate: payload.start_date, endDate: payload.end_date });
        setShowContentDateRangeFilter(false);
    };

    const getContentDateRangeDisplay = () => {
        if (contentDateRangeFilterValue) {
            if (contentDateRangeFilterValue.range_type === 'custom') {
                const start = new Date(contentDateRangeFilterValue.start_date);
                const end = new Date(contentDateRangeFilterValue.end_date);
                return `${start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${end.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
            }
            const presetLabels = {
                today: 'Today', yesterday: 'Yesterday', today_yesterday: 'Today & Yesterday',
                last_7_days: 'Last 7 days', last_14_days: 'Last 14 days', last_28_days: 'Last 28 days',
                last_30_days: 'Last 30 days', this_week: 'This week', last_week: 'Last week',
                this_month: 'This month', last_month: 'Last month', maximum: 'Maximum'
            };
            return presetLabels[contentDateRangeFilterValue.range_type] || contentDateRange;
        }
        const presetLabels = {
            last_7_days: 'Last 7 days', last_14_days: 'Last 14 days', last_30_days: 'Last 30 days',
            this_week: 'This week', last_week: 'Last week', this_month: 'This month', last_month: 'Last month'
        };
        return presetLabels[contentDateRange] || 'Last 7 days';
    };

    // --- ANIMATION VARIANTS ---
    const containerVariants = {
        hidden: { opacity: 0 },
        visible: {
            opacity: 1,
            transition: { staggerChildren: 0.1, duration: 0.5 }
        },
        exit: { opacity: 0, transition: { duration: 0.2 } }
    };

    const itemVariants = {
        hidden: { opacity: 0, y: 20 },
        visible: { opacity: 1, y: 0, transition: { type: "spring", stiffness: 50 } }
    };

    // Reusable Filters Component (Time Range + PAGE, same as Content Marketing)
    const FiltersRow = () => (
        <motion.div
            className="filter-card mb-4"
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
        >
            <div className="filter-card-body">
                <div className="row g-3 align-items-center">
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
                    <div className="col-12 col-md-auto">
                        <MultiSelectFilter
                            label="Platform"
                            emoji="🌐"
                            options={platformFilterOptions}
                            selectedValues={platformFilters}
                            onChange={(values) => setPlatformFilters(values || [])}
                            placeholder="Select platform"
                            getOptionLabel={(opt) => opt.name}
                            getOptionValue={(opt) => opt.id}
                        />
                    </div>
                    {showPageFilter && (
                        <div className="col-12 col-md-auto">
                            <MultiSelectFilter
                                label="PAGE"
                                emoji="📄"
                                options={pages}
                                selectedValues={audiencePage ? [audiencePage] : []}
                                onChange={(values) => setAudiencePage(values?.length ? values[0] : null)}
                                placeholder="Select a Page"
                                getOptionLabel={(opt) => opt.name}
                                getOptionValue={(opt) => opt.id}
                                singleSelect
                            />
                        </div>
                    )}
                </div>
            </div>
        </motion.div>
    );

    return (
        <div className="container-fluid py-4">
            {/* Header Tabs with Icons - Using Explicit Custom Classes from Audience.css */}
            <motion.div
                className="d-flex align-items-center mb-4 gap-3"
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.5, delay: 0.2 }}
            >
                <motion.button
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    className={`btn audience-tab-btn ${activeTab === 'Demographics' ? 'active' : 'inactive'}`}
                    onClick={() => setActiveTab('Demographics')}
                >
                    <span className="fs-5">👥</span> Demographics
                </motion.button>
                <motion.button
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    className={`btn audience-tab-btn ${activeTab === 'Platform' ? 'active' : 'inactive'}`}
                    onClick={() => setActiveTab('Platform')}
                >
                    <span className="fs-5">📲</span> Platform
                </motion.button>
            </motion.div>

            {/* Filters (left) + Followers and Non-Followers (right) — same row, uniform padding */}
            <div className="row g-3 align-items-stretch audience-top-row">
                <div className="col-12 col-lg-6">
                    <FiltersRow />
                </div>
                <div className="col-12 col-lg-6">
                    <motion.div
                        className="filter-card audience-followers-card h-100"
                        initial={{ opacity: 0, y: -10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.5, delay: 0.1 }}
                    >
                        <div className="filter-card-body">
                            <label className="filter-label d-block audience-followers-label">
                                <span className="filter-emoji">👥</span> Followers and Non-Followers
                                {(reachByFollowTypeLoading || (isFacebookSelected && fbAudienceLoading)) && <span className="ms-2 text-muted small">Loading...</span>}
                                {reachByFollowTypeError && !reachByFollowTypeLoading && !isFacebookSelected && (
                                    <span className="ms-2 text-danger small" title={reachByFollowTypeError}>Error</span>
                                )}
                                {isFacebookSelected && fbAudienceError && !fbAudienceLoading && (
                                    <span className="ms-2 text-danger small" title={fbAudienceError}>Error</span>
                                )}
                            </label>
                            <div className="audience-followers-chart">
                                <div className="audience-followers-row">
                                    <span className="audience-followers-label">From followers</span>
                                    <div className="audience-followers-bar-wrap">
                                        <motion.div
                                            className="audience-followers-bar"
                                            initial={{ width: 0 }}
                                            animate={{ width: `${followersNonFollowersData.followersPct}%` }}
                                            transition={{ duration: 0.6, ease: 'easeOut' }}
                                        />
                                    </div>
                                    <span className="audience-followers-pct">{formatReachNum(followersNonFollowersData.follower_value)}</span>
                                </div>
                                <div className="audience-followers-row">
                                    <span className="audience-followers-label">From non-followers</span>
                                    <div className="audience-followers-bar-wrap">
                                        <motion.div
                                            className="audience-followers-bar"
                                            initial={{ width: 0 }}
                                            animate={{ width: `${followersNonFollowersData.nonFollowersPct}%` }}
                                            transition={{ duration: 0.6, delay: 0.1, ease: 'easeOut' }}
                                        />
                                    </div>
                                    <span className="audience-followers-pct">{formatReachNum(followersNonFollowersData.non_follower_value)}</span>
                                </div>
                            </div>
                            {!reachByFollowTypeLoading && !fbAudienceLoading && followersNonFollowersData.total_value === 0 && (reachByFollowTypeMessage || (isFacebookSelected && !fbAudienceData)) && (
                                <div className="mt-2">
                                    {isFacebookSelected ? (
                                        <>
                                            {fbAudienceError ? (
                                                <p className="small text-muted mb-0" title={fbAudienceError}>
                                                    {fbAudienceError}
                                                </p>
                                            ) : (
                                                <p className="small text-muted mb-0">
                                                    No follower data for this page. Ensure the page has at least 100 likes and is connected to your app in Meta Business Suite. Non-follower reach is not available for Facebook Pages.
                                                </p>
                                            )}
                                            {fbAudienceError && (fbAudienceError.includes('Page not accessible') || fbAudienceError.includes('token')) && (
                                                <p className="small text-muted mb-0 mt-1">
                                                    To fix: Add this page in Meta Business Suite (Business Settings → Accounts → Pages) and ensure your app has a valid Page access token with read_insights permission.
                                                </p>
                                            )}
                                        </>
                                    ) : (
                                        <>
                                            <p className="small text-muted mb-0" title={reachByFollowTypeMessage}>
                                                {reachByFollowTypeMessage}
                                            </p>
                                            {reachByFollowTypeMessage && reachByFollowTypeMessage.includes('Page not accessible') && (
                                                <p className="small text-muted mb-0 mt-1">
                                                    To fix: Add this page in Meta Business Suite (Business Settings → Accounts → Pages) and ensure your app has access. Use a Page that is connected to your app for full data.
                                                </p>
                                            )}
                                        </>
                                    )}
                                </div>
                            )}
                        </div>
                    </motion.div>
                </div>
            </div>

            {/* Page performance chart - driven by PAGE filter */}
            <motion.div
                className="card border-0 shadow-sm rounded-4 bg-white p-4 mb-4"
                initial={{ opacity: 0, y: 20, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1], type: 'spring', stiffness: 100, damping: 15 }}
                whileHover={{ scale: 1.01, y: -5, transition: { type: 'spring', stiffness: 300, damping: 20 } }}
            >
                <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.2, duration: 0.5 }}>
                    <h5 className="fw-bold mb-1 text-dark d-flex align-items-center gap-2">
                        📊 Page performance
                    </h5>
                    <small className="text-secondary text-muted">
                        {!showPageFilter ? 'Select Facebook or Instagram in the Platform filter to show the Page filter and view audience data' : audiencePage ? `Audience insights for selected page (${getContentDateRangeDisplay()})` : 'Select a page and time range to view performance'}
                    </small>
                </motion.div>
                <motion.div className="mt-4" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.3, duration: 0.6, ease: 'easeOut' }}>
                    <div style={{ width: '100%', height: 400 }}>
                        {(pageInsightsError || dailyInsightsError) && (
                            <div className="alert alert-warning mb-2 py-2 small" role="alert">
                                {pageInsightsError || dailyInsightsError}
                            </div>
                        )}
                        {audiencePage ? (
                            (pageInsightsLoading || dailyInsightsLoading) ? (
                                <div className="d-flex align-items-center justify-content-center h-100" style={{ minHeight: 320 }}>
                                    <div className="text-center text-muted">
                                        <div className="spinner-border mb-2" role="status"><span className="visually-hidden">Loading...</span></div>
                                        <p className="mb-0 small">Loading performance data...</p>
                                    </div>
                                </div>
                            ) : (pagePerformanceChartData && pagePerformanceChartData.length > 0) ? (
                            <ResponsiveContainer>
                                <AreaChart data={pagePerformanceChartData} margin={{ top: 20, right: 30, left: 0, bottom: 5 }}>
                                    <defs>
                                        <linearGradient id="colorReach-audience" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="5%" stopColor="#1877F2" stopOpacity={0.5} />
                                            <stop offset="95%" stopColor="#1877F2" stopOpacity={0} />
                                        </linearGradient>
                                        <linearGradient id="colorClicks-audience" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="5%" stopColor="#00bcd4" stopOpacity={0.5} />
                                            <stop offset="95%" stopColor="#00bcd4" stopOpacity={0} />
                                        </linearGradient>
                                        <linearGradient id="colorImpressions-audience" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="5%" stopColor="#10B981" stopOpacity={0.3} />
                                            <stop offset="95%" stopColor="#10B981" stopOpacity={0} />
                                        </linearGradient>
                                    </defs>
                                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                                    <XAxis dataKey="date" tick={{ fill: '#64748b', fontSize: 12, fontWeight: 500 }} axisLine={false} tickLine={false} />
                                    <YAxis yAxisId="left" tick={{ fill: '#64748b', fontSize: 12 }} axisLine={false} tickLine={false} />
                                    <YAxis yAxisId="right" orientation="right" tick={{ fill: '#64748b', fontSize: 12 }} axisLine={false} tickLine={false} />
                                    <Tooltip cursor={{ fill: 'rgba(0,0,0,0.02)' }} contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 8px 24px rgba(0,0,0,0.15)', padding: '12px', backgroundColor: 'white' }} animationDuration={200} />
                                    <Legend wrapperStyle={{ paddingTop: '20px' }} iconType="circle" />
                                    <Area yAxisId="left" type="monotone" dataKey="reach" stroke="#1877F2" strokeWidth={3} fill="url(#colorReach-audience)" name="Reach" animationBegin={0} animationDuration={1500} animationEasing="ease-out" dot={{ r: 5, fill: '#1877F2', strokeWidth: 2, stroke: '#fff' }} activeDot={{ r: 8, fill: '#1877F2', strokeWidth: 3, stroke: '#fff' }} />
                                    <Area yAxisId="left" type="monotone" dataKey="clicks" stroke="#00bcd4" strokeWidth={3} fill="url(#colorClicks-audience)" name="Clicks" animationBegin={200} animationDuration={1500} animationEasing="ease-out" dot={{ r: 5, fill: '#00bcd4', strokeWidth: 2, stroke: '#fff' }} activeDot={{ r: 8, fill: '#00bcd4', strokeWidth: 3, stroke: '#fff' }} />
                                    <Area yAxisId="right" type="monotone" dataKey="impressions" stroke="#10B981" strokeWidth={3} fill="url(#colorImpressions-audience)" name="Impressions" animationBegin={400} animationDuration={1500} animationEasing="ease-out" dot={{ r: 5, fill: '#10B981', strokeWidth: 2, stroke: '#fff' }} activeDot={{ r: 8, fill: '#10B981', strokeWidth: 3, stroke: '#fff' }} />
                                </AreaChart>
                            </ResponsiveContainer>
                            ) : (
                                <div className="d-flex align-items-center justify-content-center h-100 text-muted" style={{ minHeight: 320 }}>
                                    <div className="text-center">
                                        <span className="d-block mb-2" style={{ fontSize: '2.5rem' }}>📊</span>
                                        <p className="fw-medium mb-0">No data for this period</p>
                                        <small>Try another time range or check page permissions</small>
                                    </div>
                                </div>
                            )
                        ) : !showPageFilter ? (
                            <div className="d-flex align-items-center justify-content-center h-100 text-muted" style={{ minHeight: 320 }}>
                                <div className="text-center">
                                    <span className="d-block mb-2" style={{ fontSize: '2.5rem' }}>🌐</span>
                                    <p className="fw-medium mb-0">Select Facebook or Instagram to view audience and performance</p>
                                    <small>Select <strong>Facebook</strong> or <strong>Instagram</strong> in the Platform filter to show the Page filter and load data</small>
                                </div>
                            </div>
                        ) : (
                            <div className="d-flex align-items-center justify-content-center h-100 text-muted" style={{ minHeight: 320 }}>
                                <div className="text-center">
                                    <span className="d-block mb-2" style={{ fontSize: '2.5rem' }}>📄</span>
                                    <p className="fw-medium mb-0">Select a page to view performance</p>
                                    <small>Use the PAGE filter above to choose a page</small>
                                </div>
                            </div>
                        )}
                    </div>
                </motion.div>
            </motion.div>

            {/* Main Content Card */}
            <AnimatePresence mode="wait">
                <motion.div
                    key={activeTab}
                    className="card border-0 shadow-sm rounded-4 bg-white p-4"
                    variants={containerVariants}
                    initial="hidden"
                    animate="visible"
                    exit="exit"
                >
                    {activeTab === 'Demographics' ? (
                        /* ================= DEMOGRAPHICS VIEW ================= */
                        <>
                            {/* 1. Demographics Chart Section (TOP) */}
                            <motion.div variants={itemVariants} className="mb-5">
                                <div className="d-flex justify-content-between align-items-center mb-4 flex-wrap gap-3">
                                    <div>
                                        <h5 className="fw-bold mb-1 text-dark d-flex align-items-center gap-2">
                                            📊 Age & Gender Distribution
                                        </h5>
                                        <small className="text-secondary text-muted">Audience breakdown by demographics (Meta Ads Insights)</small>
                                    </div>

                                    <div className="d-flex gap-2">
                                        <div className="dropdown">
                                            <button
                                                className="btn audience-dropdown-btn dropdown-toggle"
                                                type="button"
                                                data-bs-toggle="dropdown"
                                            >
                                                <span>
                                                    {genderFilter === 'All' ? '👫 All Genders' : genderFilter === 'Men' ? '👨 Men Only' : '👩 Women Only'}
                                                </span>
                                            </button>
                                            <ul className="dropdown-menu shadow-lg border-0 rounded-3 p-2">
                                                <li><button className="dropdown-item rounded-2 fw-medium" onClick={() => setGenderFilter('All')}>👫 All</button></li>
                                                <li><button className="dropdown-item rounded-2 fw-medium" onClick={() => setGenderFilter('Men')}>👨 Men</button></li>
                                                <li><button className="dropdown-item rounded-2 fw-medium" onClick={() => setGenderFilter('Women')}>👩 Women</button></li>
                                            </ul>
                                        </div>
                                    </div>
                                </div>

                                {(demographicsError || (isFacebookSelected && audiencePage && fbAudienceError)) && (
                                    <div className="alert alert-warning py-2 small mb-3" role="alert">{isFacebookSelected && fbAudienceError ? fbAudienceError : demographicsError}</div>
                                )}
                                {(demographicsLoading || (isFacebookSelected && audiencePage && fbAudienceLoading)) && (
                                    <div className="d-flex align-items-center gap-2 text-muted small mb-3">
                                        <div className="spinner-border spinner-border-sm" role="status" /><span>Loading demographics...</span>
                                    </div>
                                )}
                                <div style={{ width: '100%', height: 350 }}>
                                    {ageGenderChartDataWithTotal && ageGenderChartDataWithTotal.length > 0 ? (
                                        <>
                                            <ResponsiveContainer>
                                                <BarChart data={ageGenderChartDataWithTotal} margin={{ top: 20, right: 30, left: 0, bottom: 5 }} barSize={32} barGap={8}>
                                                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                                                    <XAxis dataKey="age" tick={{ fill: '#64748b', fontSize: 13, fontWeight: 500 }} axisLine={false} tickLine={false} dy={10} />
                                                    <YAxis tick={{ fill: '#64748b', fontSize: 12 }} axisLine={false} tickLine={false} />
                                                    <Tooltip
                                                        cursor={{ fill: 'rgba(0,0,0,0.02)' }}
                                                        contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 8px 24px rgba(0,0,0,0.1)', padding: '12px' }}
                                                    />
                                                    {(genderFilter === 'All' || genderFilter === 'Men') && (
                                                        <Bar dataKey="men" name="Men" fill="#5b45b0" radius={[6, 6, 0, 0]} animationDuration={1500} />
                                                    )}
                                                    {(genderFilter === 'All' || genderFilter === 'Women') && (
                                                        <Bar dataKey="women" name="Women" fill="#00bcd4" radius={[6, 6, 0, 0]} animationDuration={1500} />
                                                    )}
                                                </BarChart>
                                            </ResponsiveContainer>
                                            <div className="d-flex justify-content-center gap-4 mt-4">
                                                <div className="d-flex align-items-center gap-2 px-3 py-2 bg-light rounded-pill">
                                                    <div className="rounded-circle" style={{ width: 12, height: 12, background: '#5b45b0' }}></div>
                                                    <span className="fw-bold text-dark small">Men</span>
                                                </div>
                                                <div className="d-flex align-items-center gap-2 px-3 py-2 bg-light rounded-pill">
                                                    <div className="rounded-circle" style={{ width: 12, height: 12, background: '#00bcd4' }}></div>
                                                    <span className="fw-bold text-dark small">Women</span>
                                                </div>
                                            </div>
                                        </>
                                    ) : (demographicsLoading || (audiencePage && (fbAudienceLoading || igAudienceLoading))) ? (
                                        <div className="d-flex align-items-center justify-content-center h-100 text-muted" style={{ minHeight: 320 }}>
                                            <div className="text-center">
                                                <div className="spinner-border mb-2" role="status"><span className="visually-hidden">Loading...</span></div>
                                                <p className="mb-0 small">Loading demographics...</p>
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="d-flex align-items-center justify-content-center h-100 text-muted" style={{ minHeight: 320 }}>
                                            <div className="text-center">
                                                <span className="d-block mb-2" style={{ fontSize: '2.5rem' }}>📊</span>
                                                {isFacebookSelected ? (
                                                    <>
                                                        <p className="fw-medium mb-0">No demographic data available for this Facebook Page</p>
                                                        <small>Facebook requires <strong>pages_read_engagement</strong> or <strong>read_insights</strong> permission to access age &amp; gender demographics. Ensure your app has these permissions approved and the page has at least 100 fans.</small>
                                                    </>
                                                ) : (
                                                    <>
                                                        <p className="fw-medium mb-0">No demographic data for this period</p>
                                                        <small>Ensure META_AD_ACCOUNT_ID and token are set in server/.env and the ad account has activity in the selected time range.</small>
                                                    </>
                                                )}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </motion.div>

                            <div className="border-bottom my-5"></div>

                            {/* 2. Top Listed Locations (BOTTOM) */}
                            <motion.div variants={itemVariants} className="row g-5">
                                {/* Top towns/cities — Instagram audience (city-level) when page has IG, else Ads API region-level */}
                                <div className="col-lg-6">
                                    <h6 className="fw-bold mb-4 text-dark d-flex align-items-center gap-2">
                                        🏙️ Top towns/cities
                                    </h6>
                                    <small className="text-muted d-block mb-2">
                                        {topCitiesFromIg ? (isFacebookSelected ? 'From Facebook Page audience (city-level)' : 'From Instagram audience (city-level)') : 'Region-level data from Meta Ads Insights'}
                                    </small>
                                    {(igAudienceLoading && audiencePage && isInstagramSelected) || (isFacebookSelected && fbAudienceLoading) || demographicsLoading ? (
                                        <div className="d-flex align-items-center gap-2 text-muted small mb-2"><div className="spinner-border spinner-border-sm" role="status" /><span>Loading...</span></div>
                                    ) : igAudienceError && audiencePage && isInstagramSelected ? (
                                        <div className="text-muted small mb-2">{igAudienceError}</div>
                                    ) : isFacebookSelected && fbAudienceError ? (
                                        <div className="text-muted small mb-2">{fbAudienceError}</div>
                                    ) : null}
                                    <div className="d-flex flex-column gap-4">
                                        {topTownsCitiesDisplay.length > 0 ? (
                                            topTownsCitiesDisplay.map((item, idx) => (
                                                <motion.div
                                                    key={idx}
                                                    initial={{ width: 0 }}
                                                    whileInView={{ width: '100%' }}
                                                    viewport={{ once: true }}
                                                >
                                                    <div className="d-flex justify-content-between mb-2">
                                                        <span className="text-dark fw-bold small d-flex align-items-center gap-2">{item.name}</span>
                                                        <span className="text-muted small fw-bold">{item.val}%</span>
                                                    </div>
                                                    <div className="progress" style={{ height: '8px', backgroundColor: '#f3f4f6', borderRadius: '10px', overflow: 'hidden' }}>
                                                        <motion.div
                                                            className="progress-bar"
                                                            role="progressbar"
                                                            style={{ backgroundColor: '#00bcd4', borderRadius: '10px' }}
                                                            initial={{ width: 0 }}
                                                            whileInView={{ width: `${item.val}%` }}
                                                            transition={{ duration: 1.5, delay: idx * 0.1, ease: "easeOut" }}
                                                        ></motion.div>
                                                    </div>
                                                </motion.div>
                                            ))
                                        ) : !igAudienceLoading && !demographicsLoading ? (
                                            <div className="text-muted small py-3">
                                                {audiencePage ? 'No city or region data for this period. Ensure the page has a linked Instagram account with 100+ engagements.' : 'Select a page to see city/region data.'}
                                            </div>
                                        ) : null}
                                    </div>
                                </div>

                                {/* Top Countries — Instagram audience when available, else Ads API demographics */}
                                <div className="col-lg-6">
                                    <h6 className="fw-bold mb-4 text-dark d-flex align-items-center gap-2">
                                        🌍 Top Countries
                                    </h6>
                                    {topCountriesFromIg ? (
                                        <small className="text-muted d-block mb-2">{isFacebookSelected ? 'From Facebook Page audience' : 'From Instagram audience'}</small>
                                    ) : null}
                                    {(igAudienceLoading && audiencePage && isInstagramSelected) || (isFacebookSelected && fbAudienceLoading) || demographicsLoading ? (
                                        <div className="d-flex align-items-center gap-2 text-muted small mb-2"><div className="spinner-border spinner-border-sm" role="status" /><span>Loading...</span></div>
                                    ) : null}
                                    <div className="d-flex flex-column gap-4">
                                        {topCountriesDisplay.map((country, idx) => (
                                            <motion.div
                                                key={idx}
                                                initial={{ width: 0 }}
                                                whileInView={{ width: '100%' }}
                                                viewport={{ once: true }}
                                            >
                                                <div className="d-flex justify-content-between mb-2">
                                                    <span className="text-dark fw-bold small d-flex align-items-center gap-2">{country.flag} {country.name}</span>
                                                    <span className="text-muted small fw-bold">{country.val}%</span>
                                                </div>
                                                <div className="progress" style={{ height: '8px', backgroundColor: '#f3f4f6', borderRadius: '10px', overflow: 'hidden' }}>
                                                    <motion.div
                                                        className="progress-bar"
                                                        role="progressbar"
                                                        style={{ backgroundColor: '#5b45b0', borderRadius: '10px' }}
                                                        initial={{ width: 0 }}
                                                        whileInView={{ width: `${country.val}%` }}
                                                        transition={{ duration: 1.5, delay: idx * 0.1, ease: "easeOut" }}
                                                    ></motion.div>
                                                </div>
                                            </motion.div>
                                        ))}
                                    </div>
                                </div>
                            </motion.div>

                            {/* 3. When your viewers are on Instagram — best times + heatmap (Instagram only) */}
                            {isInstagramSelected && (
                            <motion.div
                                variants={itemVariants}
                                className="mt-5 audience-heatmap-section"
                                initial={{ opacity: 0, y: 12 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
                            >
                                <motion.h6
                                    className="fw-bold mb-1 text-dark d-flex align-items-center gap-2 audience-heatmap-title"
                                    initial={{ opacity: 0, x: -8 }}
                                    animate={{ opacity: 1, x: 0 }}
                                    transition={{ duration: 0.35, delay: 0.05 }}
                                >
                                    When your viewers are on Instagram
                                    {selectedPageName && <span className="text-muted fw-normal"> — {selectedPageName}</span>}
                                    {onlineFollowersLoading && <span className="ms-2 text-muted small fw-normal">Loading...</span>}
                                    {onlineFollowersError && !onlineFollowersLoading && <span className="ms-2 text-danger small fw-normal" title={onlineFollowersError}>Error</span>}
                                </motion.h6>
                                <motion.small
                                    className="text-muted d-block mb-3 audience-heatmap-subtitle"
                                    initial={{ opacity: 0 }}
                                    animate={{ opacity: 1 }}
                                    transition={{ duration: 0.35, delay: 0.1 }}
                                >
                                    Your local time ({getLocalTimezoneLabel()}) · {getContentDateRangeDisplay()}
                                </motion.small>
                                {onlineFollowersInsight?.source === 'media_views_7d' && (
                                    <div className="alert alert-info py-2 px-3 mb-3 small">
                                        {onlineFollowersMessage || 'Based on when your content got the most views in the last 7 days.'}
                                    </div>
                                )}
                                {onlineFollowersInsight?.is_sample_data && !onlineFollowersInsight?.source && (
                                    <div className="alert alert-info py-2 px-3 mb-3 small">
                                        {onlineFollowersMessage ? (
                                            <>Sample pattern — {onlineFollowersMessage}</>
                                        ) : (
                                            'Sample pattern — connect Instagram or check permissions for real data.'
                                        )}
                                    </div>
                                )}
                                {onlineFollowersInsight?.best_times?.length > 0 && (
                                    <motion.div className="mb-3 p-3 rounded-3 border bg-light" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.1 }}>
                                        <div className="small fw-bold text-dark mb-2">Best posting times (top 3)</div>
                                        <div className="d-flex flex-wrap gap-2 mb-2">
                                            {onlineFollowersInsight.best_times.map((t, i) => (
                                                <span key={t.hour} className="badge bg-primary bg-opacity-10 text-primary border border-primary border-opacity-25 px-2 py-1">
                                                    {t.label} — {(t.followers || 0).toLocaleString('en-IN')} {onlineFollowersInsight?.source === 'media_views_7d' ? 'views' : 'online'} · {t.activity_label}
                                                </span>
                                            ))}
                                        </div>
                                        <div className="small text-muted">{onlineFollowersInsight.recommendation_text}</div>
                                    </motion.div>
                                )}
                                {onlineFollowersInsight?.heatmap_data?.length > 0 && (
                                <>
                                <motion.div
                                    className="audience-heatmap-wrapper"
                                    initial={{ opacity: 0 }}
                                    animate={{ opacity: 1 }}
                                    transition={{ duration: 0.45, delay: 0.15 }}
                                >
                                    <div className="audience-heatmap-y-labels">
                                        <span>00:00</span>
                                        <span>06:00</span>
                                        <span>12:00</span>
                                        <span>18:00</span>
                                    </div>
                                    <motion.div
                                        className="audience-heatmap-grid"
                                        initial="hidden"
                                        animate="visible"
                                        variants={{
                                            hidden: {},
                                            visible: {
                                                transition: { staggerChildren: 0.012, staggerDirection: 1 }
                                            }
                                        }}
                                    >
                                        {HEATMAP_DAYS.map((day, dayIndex) => (
                                            <motion.div
                                                key={day}
                                                className="audience-heatmap-day-col"
                                                variants={{ hidden: { opacity: 0 }, visible: { opacity: 1 } }}
                                            >
                                                <div className="audience-heatmap-day-label">{day}</div>
                                                <div className="audience-heatmap-cells">
                                                    {Array.from({ length: 24 }, (_, hour) => {
                                                        const value = heatmapGrid[dayIndex][hour];
                                                        return (
                                                            <motion.div
                                                                key={hour}
                                                                className="audience-heatmap-cell"
                                                                style={{ '--intensity': value }}
                                                                variants={{ hidden: { opacity: 0, scale: 0.92 }, visible: { opacity: 1, scale: 1 } }}
                                                                transition={{ duration: 0.25, ease: 'easeOut' }}
                                                                whileHover={{ scale: 1.08, transition: { duration: 0.2 } }}
                                                                onMouseEnter={(e) => {
                                                                    const rect = e.currentTarget.getBoundingClientRect();
                                                                    setHeatmapTooltip({
                                                                        dayIndex,
                                                                        hour,
                                                                        dayLabel: day,
                                                                        value,
                                                                        x: rect.left + rect.width / 2,
                                                                        y: rect.top,
                                                                    });
                                                                }}
                                                                onMouseLeave={() => setHeatmapTooltip(null)}
                                                            />
                                                        );
                                                    })}
                                                </div>
                                            </motion.div>
                                        ))}
                                    </motion.div>
                                </motion.div>
                                {heatmapTooltip && (
                                    <motion.div
                                        className="audience-heatmap-tooltip"
                                        initial={{ opacity: 0, scale: 0.96 }}
                                        animate={{ opacity: 1, scale: 1 }}
                                        exit={{ opacity: 0, scale: 0.96 }}
                                        transition={{ duration: 0.15 }}
                                        style={{
                                            left: heatmapTooltip.x,
                                            top: heatmapTooltip.y - 8,
                                            transform: 'translate(-50%, -100%)',
                                        }}
                                    >
                                        <strong>{heatmapTooltip.dayLabel} {String(heatmapTooltip.hour).padStart(2, '0')}:00</strong>
                                        <br />
                                        {getHeatmapTooltipLabel(heatmapTooltip.value, heatmapTooltip.hour)} of your viewers are on Instagram
                                    </motion.div>
                                )}
                                </>
                                )}
                            </motion.div>
                            )}
                        </>
                    ) : (
                        /* ================= PLATFORM VIEW ================= */
                        <motion.div variants={itemVariants}>
                            <div className="d-flex justify-content-between align-items-center mb-5 flex-wrap gap-3">
                                <div>
                                    <h4 className="fw-bold mb-1 text-dark d-flex align-items-center gap-2">
                                        Placement per platform
                                    </h4>
                                    <small className="text-secondary text-muted">Insights on where your ads are being seen</small>
                                </div>
                                <div className="d-flex gap-3">
                                    {/* Metric 1 Dropdown (Purple) */}
                                    <div className="dropdown">
                                        <button className="btn audience-dropdown-btn dropdown-toggle" type="button" data-bs-toggle="dropdown">
                                            <div className="d-flex align-items-center gap-2">
                                                <div className="rounded" style={{ width: 16, height: 16, background: '#5b45b0' }}></div>
                                                <span className="fw-bold">{platformMetric1}</span>
                                            </div>
                                        </button>
                                        <ul className="dropdown-menu shadow-sm border-0">
                                            <li><button className="dropdown-item" onClick={() => setPlatformMetric1('Reach')}>Reach</button></li>
                                            <li><button className="dropdown-item" onClick={() => setPlatformMetric1('Impressions')}>Impressions</button></li>
                                        </ul>
                                    </div>

                                    {/* Metric 2 Dropdown (Teal) */}
                                    <div className="dropdown">
                                        <button className="btn audience-dropdown-btn dropdown-toggle" type="button" data-bs-toggle="dropdown">
                                            <div className="d-flex align-items-center gap-2">
                                                <div className="rounded" style={{ width: 16, height: 16, background: '#00bcd4' }}></div>
                                                <span className="fw-bold">{platformMetric2}</span>
                                            </div>
                                        </button>
                                        <ul className="dropdown-menu shadow-sm border-0">
                                            <li><button className="dropdown-item" onClick={() => setPlatformMetric2('Results')}>Results</button></li>
                                            <li><button className="dropdown-item" onClick={() => setPlatformMetric2('Clicks')}>Clicks</button></li>
                                        </ul>
                                    </div>
                                </div>
                            </div>

                            <div style={{ width: '100%', height: 400 }}>
                                <ResponsiveContainer>
                                    <BarChart data={platformData} margin={{ top: 20, right: 30, left: 0, bottom: 5 }} barSize={40} barGap={0}>
                                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                                        <XAxis
                                            dataKey="name"
                                            tick={{ fill: '#334155', fontSize: 13, fontWeight: 500 }}
                                            axisLine={false}
                                            tickLine={false}
                                            dy={10}
                                        />
                                        <YAxis tick={{ fill: '#64748b', fontSize: 12 }} axisLine={false} tickLine={false} />
                                        <Tooltip
                                            cursor={{ fill: 'rgba(0,0,0,0.02)' }}
                                            contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 8px 24px rgba(0,0,0,0.1)', padding: '12px' }}
                                        />
                                        <Bar dataKey="reach" name={platformMetric1} fill="#5b45b0" radius={[4, 4, 0, 0]} animationDuration={1500} />
                                        <Bar dataKey="results" name={platformMetric2} fill="#00bcd4" radius={[4, 4, 0, 0]} animationDuration={1500} />
                                    </BarChart>
                                </ResponsiveContainer>
                            </div>

                            <p className="text-muted small mt-4 text-center">
                                * You may see low delivery of ads to certain placements until data is fully available.
                            </p>
                        </motion.div>
                    )}
                </motion.div>
            </AnimatePresence>

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
        </div>
    );
}
