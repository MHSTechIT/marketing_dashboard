import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import MultiSelectFilter from '../components/MultiSelectFilter';
import DateRangeFilter from '../components/DateRangeFilter';
import './BestPerformingReel.css';
import {
    ComposedChart, Bar, BarChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, LabelList
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

const fetchInstagramInsights = async (pageId, from, to) => {
    const token = getAuthToken();
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const res = await fetch(
        `${API_BASE}/api/meta/instagram/insights?pageIds=${encodeURIComponent(pageId)}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
        { headers }
    );
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || err.details || res.statusText);
    }
    return res.json();
};

const fetchInstagramMediaInsights = async (pageId, opts = {}) => {
    const token = getAuthToken();
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const params = new URLSearchParams();
    params.append('pageIds', pageId);
    if (opts.contentType) params.append('contentType', opts.contentType);
    if (opts.from) params.append('from', opts.from);
    if (opts.to) params.append('to', opts.to);
    const res = await fetch(
        `${API_BASE}/api/meta/instagram/media-insights?${params.toString()}`,
        { headers }
    );
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || err.details || res.statusText);
    }
    return res.json();
};

const fetchInstagramAudienceDemographics = async (pageId, timeframe) => {
    const token = getAuthToken();
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const res = await fetch(
        `${API_BASE}/api/meta/instagram-audience-demographics?page_id=${encodeURIComponent(pageId)}&timeframe=${encodeURIComponent(timeframe)}`,
        { headers }
    );
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.details || err.error || res.statusText);
    }
    const json = await res.json();
    return json.data || null;
};

const fetchDemographicInsights = async (from, to) => {
    const token = getAuthToken();
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const res = await fetch(
        `${API_BASE}/api/meta/insights/demographics?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&breakdowns=age,gender,country`,
        { headers }
    );
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.details || err.error || res.statusText);
    }
    return await res.json();
};

// Facebook Page audience — age/gender, cities, countries (for Age & Gender chart when Platform=Facebook and a page is selected)
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

const fetchFacebookContentInsights = async (pageId, from, to) => {
    const token = getAuthToken();
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const res = await fetch(
        `${API_BASE}/api/meta/facebook/content-insights?pageId=${encodeURIComponent(pageId)}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
        { headers }
    );
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || err.details || res.statusText);
    }
    return res.json();
};

const fetchFacebookMediaInsights = async (pageId) => {
    const token = getAuthToken();
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const res = await fetch(
        `${API_BASE}/api/meta/facebook/media-insights?pageId=${encodeURIComponent(pageId)}`,
        { headers }
    );
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || err.details || res.statusText);
    }
    return res.json();
};

// Media insights fetched without date filter so Top Content by Views is populated (all media, ranked by views).

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

export default function BestPerformingReel() {
    // --- FILTER STATE (same as Audience: Time Range, Platform, Page) ---
    const [contentFilters, setContentFilters] = useState(() => getContentDefaultDates());
    const [contentDateRange, setContentDateRange] = useState('last_7_days');
    const [showContentDateRangeFilter, setShowContentDateRangeFilter] = useState(false);
    const [contentDateRangeFilterValue, setContentDateRangeFilterValue] = useState(null);

    const platformFilterOptions = [
        { id: 'facebook', name: 'Facebook' },
        { id: 'instagram', name: 'Instagram' },
    ];
    const [platformFilters, setPlatformFilters] = useState([]);
    const [pages, setPages] = useState([]);
    const [reelPage, setReelPage] = useState(null); // single page id (e.g. for "Doctor Farmer")

    // PAGE filter and content data when Instagram or Facebook is selected in PLATFORM
    const isInstagramSelected = platformFilters && platformFilters.some((p) => (p?.id || p) === 'instagram');
    const isFacebookSelected = platformFilters && platformFilters.some((p) => (p?.id || p) === 'facebook');
    const isEngagementPlatformSelected = isInstagramSelected || isFacebookSelected;

    const [activeTab, setActiveTab] = useState('all');
    const [error, setError] = useState(null);
    const [activeChart, setActiveChart] = useState(null);

    // Live Meta data: account-level (period) for Views/Reach/Interactions; media for Top Content, Hook Rate, tables
    const [igInsights, setIgInsights] = useState(null);
    const [mediaInsights, setMediaInsights] = useState(null);
    const [loadingInsights, setLoadingInsights] = useState(false);
    const [loadingMedia, setLoadingMedia] = useState(false);
    const [insightsError, setInsightsError] = useState(null);
    const [mediaError, setMediaError] = useState(null);

    // Audience demographics (Age, Gender, Location) from Instagram engaged_audience_demographics
    const [demographicsData, setDemographicsData] = useState(null);
    const [loadingDemographics, setLoadingDemographics] = useState(false);
    const [igDemographicsError, setIgDemographicsError] = useState(null); // Instagram-only error (no global banner)

    // Ads Insights demographics (Age & Gender grouped) for grouped bar chart like Audience page
    const [adsDemographicsData, setAdsDemographicsData] = useState(null);
    const [loadingAdsDemographics, setLoadingAdsDemographics] = useState(false);
    const [adsDemographicsError, setAdsDemographicsError] = useState(null);

    // Facebook Page audience (age/gender) for Age & Gender chart when Platform=Facebook and a page is selected
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

    // When neither Instagram nor Facebook is selected in PLATFORM, clear PAGE so next time they see "Select a Page"
    useEffect(() => {
        if (!isEngagementPlatformSelected) {
            setReelPage(null);
        }
    }, [isEngagementPlatformSelected]);

    // Fetch account-level insights (Views, Reach, Content interactions) — Instagram or Facebook per PLATFORM
    useEffect(() => {
        if (!isEngagementPlatformSelected) {
            setIgInsights(null);
            setInsightsError(null);
            return;
        }
        if (!reelPage || !contentFilters.startDate || !contentFilters.endDate) {
            setIgInsights(null);
            setInsightsError(null);
            return;
        }
        let cancelled = false;
        setLoadingInsights(true);
        setInsightsError(null);
        const fetchInsights = isFacebookSelected
            ? () => fetchFacebookContentInsights(reelPage, contentFilters.startDate, contentFilters.endDate)
            : () => fetchInstagramInsights(reelPage, contentFilters.startDate, contentFilters.endDate);
        fetchInsights()
            .then((data) => { if (!cancelled) setIgInsights(data); })
            .catch((err) => { if (!cancelled) setInsightsError(err?.message || 'Failed to load insights'); })
            .finally(() => { if (!cancelled) setLoadingInsights(false); });
        return () => { cancelled = true; };
    }, [isEngagementPlatformSelected, isFacebookSelected, reelPage, contentFilters.startDate, contentFilters.endDate]);

    // Fetch media insights (Top Content) — Instagram or Facebook per PLATFORM
    const MEDIA_FETCH_TIMEOUT_MS = 45000; // 45s
    useEffect(() => {
        if (!isEngagementPlatformSelected) {
            setMediaInsights(null);
            setMediaError(null);
            setLoadingMedia(false);
            return;
        }
        if (!reelPage) {
            setMediaInsights(null);
            setMediaError(null);
            setLoadingMedia(false);
            return;
        }
        let cancelled = false;
        setLoadingMedia(true);
        setMediaError(null);
        const fetchMedia = isFacebookSelected
            ? () => fetchFacebookMediaInsights(reelPage)
            : () => {
                const opts = { contentType: activeTab };
                if (contentFilters.startDate && contentFilters.endDate) {
                    opts.from = contentFilters.startDate;
                    opts.to = contentFilters.endDate;
                }
                return fetchInstagramMediaInsights(reelPage, opts);
            };
        const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error('Request timed out. Try again or check your connection.')), MEDIA_FETCH_TIMEOUT_MS);
        });
        Promise.race([fetchMedia(), timeoutPromise])
            .then((data) => {
                if (!cancelled) setMediaInsights(data);
            })
            .catch((err) => {
                if (!cancelled) setMediaError(err?.message || 'Failed to load media insights');
            })
            .finally(() => {
                if (!cancelled) setLoadingMedia(false);
            });
        return () => { cancelled = true; };
    }, [isEngagementPlatformSelected, isFacebookSelected, reelPage, activeTab, contentFilters.startDate, contentFilters.endDate]);

    // When Stories tab becomes active: set default date range to last 7 days (end = today, start = today - 7) and trigger fetch
    const prevActiveTabRef = useRef(activeTab);
    useEffect(() => {
        if (activeTab !== 'stories') {
            prevActiveTabRef.current = activeTab;
            return;
        }
        if (prevActiveTabRef.current === 'stories') return; // already on Stories, don't overwrite user's range
        prevActiveTabRef.current = 'stories';
        const end = new Date();
        const start = new Date(end);
        start.setDate(start.getDate() - 7);
        const endDate = end.toISOString().slice(0, 10);
        const startDate = start.toISOString().slice(0, 10);
        setContentFilters({ startDate, endDate });
        setContentDateRange('last_7_days');
        setContentDateRangeFilterValue({
            range_type: 'last_7_days',
            start_date: startDate,
            end_date: endDate,
            timezone: 'Asia/Kolkata',
            compare: { enabled: false }
        });
    }, [activeTab]);

    // Map time range to demographics API timeframe (this_week | this_month | last_90_days)
    const demographicsTimeframe = contentDateRange === 'last_7_days' || contentDateRange === 'this_week'
        ? 'this_week'
        : contentDateRange === 'last_90_days'
            ? 'last_90_days'
            : 'this_month';

    // Fetch Instagram audience demographics (Age, Gender, Location) for cards and charts
    useEffect(() => {
        if (!isInstagramSelected) {
            setDemographicsData(null);
            setIgDemographicsError(null);
            return;
        }
        if (!reelPage) {
            setDemographicsData(null);
            setIgDemographicsError(null);
            return;
        }
        let cancelled = false;
        setDemographicsData(null); // clear previous page's data so UI doesn't show stale Age/Gender/Location
        setLoadingDemographics(true);
        setIgDemographicsError(null);
        fetchInstagramAudienceDemographics(reelPage, demographicsTimeframe)
            .then((data) => {
                if (!cancelled) {
                    setDemographicsData(data);
                    setIgDemographicsError(null);
                }
            })
            .catch((err) => {
                if (!cancelled) setIgDemographicsError(err?.message || 'Failed to load Instagram demographics');
            })
            .finally(() => { if (!cancelled) setLoadingDemographics(false); });
        return () => { cancelled = true; };
    }, [isInstagramSelected, reelPage, demographicsTimeframe]);

    // Fetch Ads Insights demographics (age_gender_breakdown) for Age & Gender Distribution chart (same as Audience page)
    useEffect(() => {
        if (!contentFilters.startDate || !contentFilters.endDate) {
            setAdsDemographicsData(null);
            setAdsDemographicsError(null);
            return;
        }
        let cancelled = false;
        setLoadingAdsDemographics(true);
        setAdsDemographicsError(null);
        fetchDemographicInsights(contentFilters.startDate, contentFilters.endDate)
            .then((payload) => { if (!cancelled) setAdsDemographicsData(payload); })
            .catch((err) => { if (!cancelled) setAdsDemographicsError(err?.message || 'Failed to load Ads demographics'); })
            .finally(() => { if (!cancelled) setLoadingAdsDemographics(false); });
        return () => { cancelled = true; };
    }, [contentFilters.startDate, contentFilters.endDate]);

    // Fetch Facebook Page audience (age/gender) when Platform=Facebook and a page is selected — so Age & Gender chart updates per page
    useEffect(() => {
        if (!isFacebookSelected || !reelPage || !contentFilters.startDate || !contentFilters.endDate) {
            setFbAudienceData(null);
            setFbAudienceError(null);
            return;
        }
        const pageId = reelPage != null && typeof reelPage === 'object' && reelPage.id != null
            ? String(reelPage.id)
            : String(reelPage ?? '');
        if (!pageId) {
            setFbAudienceData(null);
            setFbAudienceError(null);
            return;
        }
        let cancelled = false;
        setFbAudienceData(null); // clear previous page's data so chart doesn't show stale data when switching pages
        setFbAudienceLoading(true);
        setFbAudienceError(null);
        fetchFacebookPageAudience(pageId, contentFilters.startDate, contentFilters.endDate)
            .then((data) => { if (!cancelled) setFbAudienceData(data); })
            .catch((err) => { if (!cancelled) setFbAudienceError(err?.message || 'Failed to load Facebook Page audience'); })
            .finally(() => { if (!cancelled) setFbAudienceLoading(false); });
        return () => { cancelled = true; };
    }, [isFacebookSelected, reelPage, contentFilters.startDate, contentFilters.endDate]);

    const handleContentDateRangeApply = (payload) => {
        if (!payload.start_date || !payload.end_date) return;
        const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
        if (!dateRegex.test(payload.start_date) || !dateRegex.test(payload.end_date)) return;
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

    // --- DERIVED METRICS FROM LIVE META DATA ---
    const byContentType = mediaInsights?.byContentType || {};
    const aggForTab = byContentType[activeTab] || {};
    const mediaForTab = (mediaInsights?.media || []).filter((m) => {
        const pt = m.product_type || (m.media_type === 'VIDEO' && (m.permalink || '').includes('/reel/') ? 'REELS' : 'FEED');
        if (activeTab === 'all') return true;
        if (activeTab === 'posts') return pt === 'FEED';
        if (activeTab === 'stories') return pt === 'STORY';
        if (activeTab === 'reels') {
            if (pt === 'REELS') return true;
            if (isFacebookSelected && pt === 'FEED' && (m.media_type || '').toUpperCase() === 'VIDEO') return true;
            return false;
        }
        return true;
    });
    const reelsFromMedia = mediaForTab.filter(
        (m) => (m.product_type === 'REELS' || (m.media_type === 'VIDEO' && (m.permalink || '').includes('/reel/'))) && (m.availability === 'available' || m.views > 0) && ((m.video_views ?? m.views ?? 0) >= 0)
    );
    // Prefer period-based totals from account-level insights (matches Meta Content overview)
    const totalViewsLive = (igInsights?.totalViews ?? igInsights?.total_views) != null ? (igInsights.totalViews ?? igInsights.total_views) : (aggForTab.views ?? 0);
    const totalReachLive = (igInsights?.totalReached ?? igInsights?.total_reached) != null ? (igInsights.totalReached ?? igInsights.total_reached) : (aggForTab.reach ?? 0);
    const totalInteractionsLive = (igInsights?.totalInteractions ?? igInsights?.total_interactions) != null ? (igInsights.totalInteractions ?? igInsights.total_interactions) : (aggForTab.total_interactions ?? 0);
    const engagementRateLive = totalReachLive > 0
        ? Math.round((totalInteractionsLive / totalReachLive) * 10000) / 100
        : 0;
    const totalWatchTimeSeconds = reelsFromMedia.reduce(
        (sum, m) => sum + (Number(m.video_avg_time_watched || 0) * Number(m.video_views || m.views || 0)),
        0
    );
    const hours = totalWatchTimeSeconds / 3600;
    const watchTimeDisplay = hours >= 1e6
        ? `${(hours / 1e6).toFixed(1)}M h`
        : hours >= 1000
            ? `${(hours / 1000).toFixed(1)}K h`
            : hours >= 1
                ? `${hours.toFixed(1)} h`
                : totalWatchTimeSeconds >= 60
                    ? `${(totalWatchTimeSeconds / 60).toFixed(0)} m`
                    : `${Math.round(totalWatchTimeSeconds)} s`;
    const avgHookRateLive = aggForTab.hook_rate != null ? aggForTab.hook_rate : (reelsFromMedia.length > 0
        ? Math.round((reelsFromMedia.map((m) => m.hook_rate).filter((r) => r != null && !Number.isNaN(r)).reduce((a, b) => a + b, 0) / reelsFromMedia.filter((m) => m.hook_rate != null).length) * 100) / 100
        : null);
    const contentWinRateLive = aggForTab.content_win_rate ?? 0;

    // Demographics: prefer Instagram; fall back to Ads Insights (age_gender, region, country) when no Instagram
    const ageBreakdown = demographicsData?.age_breakdown ?? [];
    const genderBreakdown = demographicsData?.gender_breakdown ?? [];
    const countryBreakdown = demographicsData?.country_breakdown ?? [];
    const cityBreakdown = demographicsData?.city_breakdown ?? [];
    // Location card: prefer city count (city-level) when available, else country count, else Ads region/country
    const locationBreakdown = cityBreakdown.length > 0 ? cityBreakdown : countryBreakdown;

    // Fallback counts from Ads Insights when Instagram demographics missing (e.g. page has no IG linked)
    const adsAgeGender = adsDemographicsData?.age_gender_breakdown ?? [];
    const adsRegionBreakdown = adsDemographicsData?.region_breakdown ?? [];
    const adsCountryBreakdown = adsDemographicsData?.country_breakdown ?? [];
    const ageGroupsCountFromAds = adsAgeGender.length > 0
        ? new Set(adsAgeGender.map((r) => r.age).filter(Boolean)).size
        : 0;
    const genderGroupsCountFromAds = adsAgeGender.length > 0
        ? new Set(adsAgeGender.map((r) => (r.gender || '').toLowerCase()).filter(Boolean)).size
        : 0;
    const locationCountFromAds = adsRegionBreakdown.length > 0 ? adsRegionBreakdown.length : adsCountryBreakdown.length;

    const mediaToTableRow = (m, idx, typeLabel) => ({
        id: m.media_id || idx,
        url: m.permalink || '#',
        title: (m.caption && m.caption.slice(0, 50)) || `${typeLabel} ${idx + 1}`,
        type: typeLabel,
        views: m.views || m.video_views || m.reach || 0,
        watch: Math.round((Number(m.video_avg_time_watched || 0) * Number(m.video_views || m.views || 0))),
        likes: m.likes || 0,
        shares: m.shares ?? 0,
        comments: m.comments || 0,
        saved: m.saved ?? 0,
        follows: m.follows ?? 0,
        rate: m.hook_rate != null ? `${m.hook_rate}%` : 'N/A',
        avgView: m.video_avg_time_watched != null ? m.video_avg_time_watched.toFixed(2) : 'N/A',
        subChange: 0,
        imgColor: ['#fb923c', '#fdba74', '#fca5a5', '#86efac', '#fde047'][idx % 5],
        permalink: m.permalink,
        thumbnail_url: m.thumbnail_url || m.media_url || null,
        timestamp: m.timestamp,
    });
    const livePostsList = mediaForTab.filter((m) => (m.product_type || 'FEED') === 'FEED').map((m, idx) => mediaToTableRow(m, idx, 'Post'));
    const liveStoriesList = mediaForTab.filter((m) => (m.product_type || '') === 'STORY').map((m, idx) => mediaToTableRow(m, idx, 'Story'));
    const liveReelsList = reelsFromMedia.map((m, idx) => mediaToTableRow(m, idx, 'Reel'));
    const liveAllList = mediaForTab.map((m, idx) => {
        const typeLabel = (m.product_type || 'FEED') === 'REELS' ? 'Reel' : (m.product_type || '') === 'STORY' ? 'Story' : 'Post';
        return mediaToTableRow(m, idx, typeLabel);
    });
    const topContentByViews = [...mediaForTab]
        .sort((a, b) => (b.views || b.video_views || b.reach || 0) - (a.views || a.video_views || a.reach || 0))
        .slice(0, 20)
        .map((m, idx) => ({
            id: m.media_id || idx,
            title: (m.caption && m.caption.slice(0, 50)) || `Content ${idx + 1}`,
            timestamp: m.timestamp,
            thumbnail_url: m.thumbnail_url || m.media_url || null,
            // For Reels: views = 3s plays; for Posts/Stories: fall back to reach (unique accounts that saw the post)
            views: m.views || m.video_views || m.reach || 0,
            likes: m.likes || 0,
            comments: m.comments || 0,
            shares: m.shares ?? 0,
            saved: m.saved ?? 0,
            follows: m.follows ?? 0,
            permalink: m.permalink,
        }));

    const _loadingAny = loadingInsights || loadingMedia;
    const hasLiveData = reelPage && (igInsights || mediaInsights);
    const displayError = insightsError || mediaError || error;

    // Helper: format YYYY-MM-DD to chart label "DD Mon"
    const formatChartDate = (isoDate) => {
        if (!isoDate) return '';
        const d = new Date(isoDate + 'T00:00:00Z');
        const day = d.getUTCDate();
        const mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()];
        return `${String(day).padStart(2, '0')} ${mon}`;
    };

    // Build daily views/engagements from media list (by post date) when API daily series is empty
    const buildViewsDataFromMedia = (mediaList, startDate, endDate) => {
        if (!Array.isArray(mediaList) || !startDate || !endDate) return [];
        const start = new Date(startDate + 'T00:00:00Z').getTime();
        const end = new Date(endDate + 'T23:59:59Z').getTime();
        const byDate = {};
        mediaList.forEach((m) => {
            const ts = m.timestamp;
            if (!ts) return;
            const t = new Date(ts).getTime();
            if (t < start || t > end) return;
            const dateStr = ts.split('T')[0];
            if (!byDate[dateStr]) byDate[dateStr] = { date: formatChartDate(dateStr), views: 0, eng: 0 };
            byDate[dateStr].views += Number(m.views ?? m.video_views ?? m.reach ?? 0) || 0;
            byDate[dateStr].eng += Number(m.total_interactions ?? (m.likes || 0) + (m.comments || 0) + (m.saved || 0) + (m.shares || 0)) || 0;
        });
        return Object.keys(byDate).sort().map((k) => byDate[k]);
    };

    // 1. Chart Data (Views vs Engagements) – API first; fallback: derive from media by post date; then single-point from totals
    const dailyViewsEngagements = igInsights?.daily_views_engagements ?? igInsights?.data?.daily_views_engagements;
    const viewsDataFromApi = Array.isArray(dailyViewsEngagements) && dailyViewsEngagements.length > 0 ? dailyViewsEngagements : [];
    const viewsDataFromMedia = viewsDataFromApi.length === 0 && contentFilters?.startDate && contentFilters?.endDate
        ? buildViewsDataFromMedia(mediaInsights?.media ?? [], contentFilters.startDate, contentFilters.endDate)
        : [];
    const totalsFallback =
        viewsDataFromApi.length === 0 &&
        viewsDataFromMedia.length === 0 &&
        reelPage &&
        (igInsights?.totalViews != null || igInsights?.total_views != null || igInsights?.data?.total_views != null)
            ? (() => {
                const totalViews = Number(igInsights?.totalViews ?? igInsights?.total_views ?? igInsights?.data?.total_views ?? 0);
                const totalEng = Number(igInsights?.totalInteractions ?? igInsights?.total_interactions ?? igInsights?.data?.total_interactions ?? 0);
                if (totalViews === 0 && totalEng === 0) return [];
                const mid = contentFilters?.startDate && contentFilters?.endDate
                    ? formatChartDate(contentFilters.startDate)
                    : formatChartDate(new Date(Date.now() - 86400000 * 3).toISOString().slice(0, 10));
                return [{ date: mid, views: totalViews, eng: totalEng }];
            })()
            : [];
    const viewsData = viewsDataFromApi.length > 0 ? viewsDataFromApi : (viewsDataFromMedia.length > 0 ? viewsDataFromMedia : totalsFallback);

    // 2. Subscriber Change Data – Meta live data when available
    const SAMPLE_SUB_DATA = [
        { date: '02 Nov', val: 15 },
        { date: '04 Nov', val: 18 },
        { date: '06 Nov', val: 14 },
        { date: '08 Nov', val: 16 },
        { date: '10 Nov', val: 12 },
        { date: '12 Nov', val: 17 },
        { date: '14 Nov', val: 15 },
        { date: '16 Nov', val: 19 },
        { date: '18 Nov', val: 9 },
        { date: '20 Nov', val: 22 },
        { date: '22 Nov', val: 10 },
        { date: '24 Nov', val: 11 },
        { date: '26 Nov', val: 8 },
        { date: '28 Nov', val: 15 },
        { date: '30 Nov', val: 14 },
        { date: '01 Dec', val: 12 },
        { date: '02 Dec', val: 13 },
        { date: '03 Dec', val: 15 },
        { date: '04 Dec', val: 14 },
        { date: '05 Dec', val: 6 },
        { date: '06 Dec', val: 10 },
    ];
    const subData =
        Array.isArray(igInsights?.data?.daily_subscriber_change) && igInsights.data.daily_subscriber_change.length > 0
            ? igInsights.data.daily_subscriber_change
            : SAMPLE_SUB_DATA;

    // Chart Data for new KPIs
    const watchTimeData = [
        { time: '0-30s', value: 1200 },
        { time: '30-60s', value: 2800 },
        { time: '1-2min', value: 3500 },
        { time: '2-5min', value: 2100 },
        { time: '5-10min', value: 1500 },
        { time: '10+ min', value: 900 },
    ];

    const ageData = [
        { age: '18-24', value: 25, color: '#fb923c' },
        { age: '25-34', value: 35, color: '#fdba74' },
        { age: '35-44', value: 20, color: '#fca5a5' },
        { age: '45-54', value: 12, color: '#86efac' },
        { age: '55+', value: 8, color: '#fde047' },
    ];

    const _genderData = [
        { name: 'Male', value: 55, color: '#0369a1' },
        { name: 'Female', value: 42, color: '#ec4899' },
        { name: 'Other', value: 3, color: '#8b5cf6' },
    ];

    const locationData = [
        { location: 'United States', value: 35, color: '#0369a1' },
        { location: 'United Kingdom', value: 18, color: '#38bdf8' },
        { location: 'Canada', value: 12, color: '#0ea5e9' },
        { location: 'Australia', value: 10, color: '#60a5fa' },
        { location: 'Germany', value: 8, color: '#3b82f6' },
        { location: 'Other', value: 17, color: '#94a3b8' },
    ];

    const COLORS = ['#0369a1', '#38bdf8', '#0ea5e9', '#60a5fa', '#3b82f6', '#8b5cf6', '#ec4899', '#fb923c'];

    const watchTimeChartData = hasLiveData && reelsFromMedia.length > 0
        ? [{ time: 'Total (min)', value: Math.round(totalWatchTimeSeconds / 60) }]
        : watchTimeData;
    const ageChartData = hasLiveData && ageBreakdown.length > 0
        ? ageBreakdown.map((r, i) => ({ age: r.age || r.age_range || 'N/A', value: r.value, color: COLORS[i % COLORS.length] }))
        : ageData;
    const genderChartData = hasLiveData && genderBreakdown.length > 0
        ? genderBreakdown.map((r, i) => ({ name: r.gender || String(r.name || 'N/A'), value: r.value, color: COLORS[i % COLORS.length] }))
        : [];
    const _locationChartData = hasLiveData && countryBreakdown.length > 0
        ? countryBreakdown.map((r, i) => ({ location: r.country || r.location || 'N/A', value: r.value, color: COLORS[i % COLORS.length] }))
        : locationData;

    // Top towns/cities (city-level) from Instagram audience for Location Distribution — percentages, sorted, top 10
    const topTownsCitiesDisplay = (() => {
        const rows = cityBreakdown || [];
        if (!rows.length) return [];
        const total = rows.reduce((s, r) => s + (Number(r.value) || 0), 0);
        if (total === 0) return [];
        return rows
            .map((r) => ({
                name: r.city || 'Unknown',
                val: Math.round(((Number(r.value) || 0) / total) * 1000) / 10,
            }))
            .sort((a, b) => b.val - a.val)
            .slice(0, 10);
    })();

    // Top regions or countries from Ads Insights (fallback when no Instagram city data)
    const topRegionsOrCountriesFromAds = (() => {
        const rows = adsRegionBreakdown.length > 0 ? adsRegionBreakdown : adsCountryBreakdown;
        if (!rows.length) return { list: [], label: null, subtitle: null };
        const total = rows.reduce((s, r) => s + (Number(r.reach) || Number(r.impressions) || 0), 0);
        if (total === 0) return { list: [], label: null, subtitle: null };
        const key = adsRegionBreakdown.length > 0 ? 'region' : 'country';
        const list = rows
            .map((r) => ({
                name: r[key] || 'Unknown',
                val: Math.round(((Number(r.reach) || Number(r.impressions) || 0) / total) * 1000) / 10,
            }))
            .sort((a, b) => b.val - a.val)
            .slice(0, 10);
        const label = adsRegionBreakdown.length > 0 ? 'Top regions' : 'Top countries';
        const subtitle = 'From Meta Ads Insights (region/country-level)';
        return { list, label, subtitle };
    })();

    // Age & Gender Distribution: when a page is selected, use Instagram or Facebook page audience (per-page); else use Ads demographics (single ad account).
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
            const age = (r.age || r.age_range || '').toString().trim();
            if (!age) return;
            const val = Number(r.value) || 0;
            out.push({ age, gender: 'male', reach: Math.round(val * maleRatio) });
            out.push({ age, gender: 'female', reach: Math.round(val * femaleRatio) });
        });
        return out.length ? out : null;
    };
    // Facebook API returns age_breakdown as [{ age, gender, value }]; build chart rows directly. Instagram/Ads use other shapes.
    const buildAgeGenderFromFacebookBreakdown = (ageBreakdown) => {
        if (!ageBreakdown?.length) return null;
        const out = [];
        ageBreakdown.forEach((r) => {
            const age = (r.age || '').toString().trim();
            if (!age || !AGE_BUCKETS.includes(age)) return;
            const g = (r.gender || '').toString().toLowerCase();
            const gender = g === 'female' || g === 'f' ? 'female' : 'male';
            const reach = Math.round(Number(r.value) || 0);
            if (reach > 0) out.push({ age, gender, reach });
        });
        return out.length ? out : null;
    };
    const ageGenderBreakdownForChart = (() => {
        if (reelPage && isFacebookSelected && fbAudienceData?.age_breakdown?.length) {
            const fbRows = buildAgeGenderFromFacebookBreakdown(fbAudienceData.age_breakdown);
            if (fbRows && fbRows.length > 0) return fbRows;
        }
        if (reelPage && demographicsData?.age_breakdown?.length && demographicsData?.gender_breakdown?.length) {
            return buildAgeGenderFromBreakdowns(demographicsData.age_breakdown, demographicsData.gender_breakdown);
        }
        return adsDemographicsData?.age_gender_breakdown || null;
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
    const ageGenderChartDataWithTotal = (() => {
        if (!ageGenderChartData || !ageGenderChartData.length) return null;
        const totalMen = ageGenderChartData.reduce((s, row) => s + (Number(row.men) || 0), 0);
        const totalWomen = ageGenderChartData.reduce((s, row) => s + (Number(row.women) || 0), 0);
        return [...ageGenderChartData, { age: 'All Ages', men: totalMen, women: totalWomen }];
    })();
    const ageGenderChartFromInstagram = Boolean(reelPage && isInstagramSelected && demographicsData?.age_breakdown?.length && demographicsData?.gender_breakdown?.length);
    const ageGenderChartFromFacebook = Boolean(
        reelPage && isFacebookSelected && fbAudienceData?.age_breakdown?.length && buildAgeGenderFromFacebookBreakdown(fbAudienceData.age_breakdown)?.length > 0
    );

    // 3. CONTENT LIST FOR TABS — live data only; no sample/placeholder when no page or no media
    const emptyList = [];

    // Totals for the table footer (Dynamic based on selected data)
    const calculateTotals = (data) => {
        return data.reduce((acc, curr) => ({
            views: acc.views + curr.views,
            watch: acc.watch + curr.watch,
            likes: acc.likes + curr.likes,
            shares: acc.shares + curr.shares,
            comments: acc.comments + curr.comments,
            subChange: acc.subChange + curr.subChange,
            rate: 'N/A', // Simplified
            avgView: 'N/A'
        }), { views: 0, watch: 0, likes: 0, shares: 0, comments: 0, subChange: 0 });
    };

    // LOGIC TO SWITCH CONTENT — live data only when page selected and media available
    let currentList = emptyList;
    let _tableTitle = 'All Content Performance';
    let animClass = 'anim-fade-in';

    if (hasLiveData && mediaInsights?.media?.length > 0) {
        if (activeTab === 'posts') {
            currentList = livePostsList;
            _tableTitle = 'Posts Performance';
            animClass = 'anim-slide-in';
        } else if (activeTab === 'stories') {
            currentList = liveStoriesList;
            _tableTitle = 'Stories Performance';
            animClass = 'anim-zoom-in';
        } else if (activeTab === 'reels') {
            currentList = liveReelsList;
            _tableTitle = 'Reels Performance';
            animClass = 'anim-fade-in';
        } else {
            currentList = liveAllList;
            _tableTitle = 'All Content Performance';
            animClass = 'anim-fade-in';
        }
    } else {
        if (activeTab === 'posts') _tableTitle = 'Posts Performance';
        else if (activeTab === 'stories') _tableTitle = 'Stories Performance';
        else if (activeTab === 'reels') _tableTitle = 'Reels Performance';
        else _tableTitle = 'All Content Performance';
    }

    const totals = calculateTotals(currentList);

    // Format large numbers for card display (e.g. 606100 -> "606.1K", 7000 -> "7K")
    const formatCount = (n) => {
        if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
        if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
        return String(n);
    };

    const getPublishDate = (item) => {
        if (item.timestamp) {
            try {
                const d = new Date(item.timestamp);
                return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
            } catch (_) {
                return '';
            }
        }
        const day = (item.id % 28) || 1;
        const month = ['January', 'February', 'March', 'April', 'May', 'June'][item.id % 6];
        const hour = 17;
        const min = (item.id * 17) % 60;
        return `${day} ${month} ${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
    };

    const contentListForTopContent = hasLiveData && topContentByViews.length > 0
        ? topContentByViews
        : currentList;

    const isStories = activeTab === "stories";

    const topContentScrollRef = useRef(null);
    const scrollTopContent = () => {
        if (topContentScrollRef.current) {
            topContentScrollRef.current.scrollBy({ left: 280, behavior: 'smooth' });
        }
    };
    const scrollTopContentBack = () => {
        if (topContentScrollRef.current) {
            topContentScrollRef.current.scrollBy({ left: -280, behavior: 'smooth' });
        }
    };

    return (
        <div className="best-reel-container">
            {/* --- TOP FILTERS (Time Range, Platform, Page — same as Audience) --- */}
            <motion.div
                className="filter-card best-reel-filters mb-4"
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5 }}
            >
                <div className="filter-card-body">
                    <div className="row g-3 align-items-center">
                        <div className="col-12 col-md-auto">
                            <label className="filter-label">
                                <span className="filter-emoji">📅</span> TIME RANGE
                            </label>
                            <button
                                type="button"
                                className={`best-reel-filter-trigger ${showContentDateRangeFilter ? 'open' : ''}`}
                                onClick={() => setShowContentDateRangeFilter(true)}
                            >
                                <i className="far fa-calendar-alt text-secondary opacity-75"></i>
                                <span className="best-reel-filter-trigger-text">{getContentDateRangeDisplay()}</span>
                                <i className={`fas fa-chevron-down best-reel-filter-arrow ${showContentDateRangeFilter ? 'rotated' : ''}`}></i>
                            </button>
                        </div>
                        <div className="col-12 col-md-auto">
                            <MultiSelectFilter
                                label="PLATFORM"
                                emoji="🌐"
                                options={platformFilterOptions}
                                selectedValues={platformFilters.map((p) => p.id)}
                                onChange={(selectedIds) => setPlatformFilters(platformFilterOptions.filter((p) => selectedIds.includes(p.id)))}
                                placeholder="All Platforms"
                                getOptionLabel={(opt) => opt.name}
                                getOptionValue={(opt) => opt.id}
                            />
                        </div>
                        {isEngagementPlatformSelected && (
                            <div className="col-12 col-md-auto">
                                <MultiSelectFilter
                                    label="PAGE"
                                    emoji="📄"
                                    options={pages}
                                    selectedValues={reelPage ? [reelPage] : []}
                                    onChange={(selectedIds) => setReelPage(selectedIds.length ? selectedIds[0] : null)}
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

            {/* --- NAVIGATION TABS --- */}
            <div className="nav-tabs-custom">
                <button className={`nav-tab-btn ${activeTab === 'all' ? 'active' : ''}`} onClick={() => setActiveTab('all')}>All</button>
                <button className={`nav-tab-btn ${activeTab === 'posts' ? 'active' : ''}`} onClick={() => setActiveTab('posts')}>Posts</button>
                <button className={`nav-tab-btn ${activeTab === 'stories' ? 'active' : ''}`} onClick={() => setActiveTab('stories')}>Stories</button>
                <button className={`nav-tab-btn ${activeTab === 'reels' ? 'active' : ''}`} onClick={() => setActiveTab('reels')}>Reels</button>
            </div>

            {displayError && (
                <div className="alert alert-warning alert-dismissible fade show mb-3" role="alert">
                    <strong>{displayError}</strong>
                    <button type="button" className="btn-close" onClick={() => { setInsightsError(null); setMediaError(null); setError(null); }} aria-label="Close"></button>
                </div>
            )}

            {!isEngagementPlatformSelected && (
                <div className="alert alert-info mb-3">
                    Select <strong>Instagram</strong> or <strong>Facebook</strong> in the PLATFORM filter and choose a page to load reel and content metrics from Meta.
                </div>
            )}
            {isEngagementPlatformSelected && !reelPage && (
                <div className="alert alert-info mb-3">
                    Select a page (e.g. &quot;Doctor Farmer&quot;) from the PAGE filter above to load metrics and top content from Meta.
                </div>
            )}

            {reelPage && loadingInsights && (
                <div className="text-muted mb-3"><i className="fas fa-spinner fa-spin me-2"></i>Loading live Meta data…</div>
            )}
            {reelPage && !loadingInsights && loadingMedia && (
                <div className="text-muted mb-3 small"><i className="fas fa-spinner fa-spin me-2"></i>Loading top content…</div>
            )}

            {/* --- WRAPPER FOR ANIMATED CONTENT --- */}
            <div key={activeTab} className={animClass}>

                {/* --- SUMMARY METRICS (blank for Views/Reach/Content interactions/Content Win Rate when no page selected) --- */}
                <div className="summary-metrics-row">
                    <div className="summary-metric-item">
                        <div className="summary-label">Views <i className="fas fa-info-circle text-muted small"></i></div>
                        <div className="summary-value">
                            {!reelPage ? '—' : hasLiveData ? formatCount(totalViewsLive) : (totals.views / 1000).toFixed(1) + 'k'}
                            {reelPage && !hasLiveData && <span className="summary-trend trend-up"><i className="fas fa-arrow-up"></i> 4.3%</span>}
                        </div>
                    </div>
                    <div className="summary-metric-item">
                        <div className="summary-label">Reach <i className="fas fa-info-circle text-muted small"></i></div>
                        <div className="summary-value">
                            {!reelPage ? '—' : hasLiveData ? formatCount(totalReachLive) : '4M'}
                            {reelPage && !hasLiveData && <span className="summary-trend trend-up"><i className="fas fa-arrow-up"></i> 11.6%</span>}
                        </div>
                    </div>
                    <div className="summary-metric-item">
                        <div className="summary-label">Content interactions <i className="fas fa-info-circle text-muted small"></i></div>
                        <div className="summary-value">
                            {!reelPage ? '—' : hasLiveData ? formatCount(totalInteractionsLive) : (totals.shares + totals.likes + totals.comments)}
                            {reelPage && !hasLiveData && <span className="summary-trend trend-down"><i className="fas fa-arrow-down"></i> 29.2%</span>}
                        </div>
                    </div>
                    <div className="summary-metric-item">
                        <div className="summary-label">Hook Rate <i className="fas fa-info-circle text-muted small"></i></div>
                        <div className="summary-value">
                            {!reelPage ? '—' : hasLiveData && avgHookRateLive != null ? `${avgHookRateLive}%` : '—'}
                            {reelPage && hasLiveData && avgHookRateLive != null && <span className="summary-trend trend-up"><i className="fas fa-arrow-up"></i> 5.1%</span>}
                        </div>
                    </div>
                    <div className="summary-metric-item">
                        <div className="summary-label">Content Win Rate <i className="fas fa-info-circle text-muted small"></i></div>
                        <div className="summary-value">
                            {!reelPage ? '—' : hasLiveData ? `${contentWinRateLive}%` : '68%'}
                            {reelPage && !hasLiveData && <span className="summary-trend trend-up"><i className="fas fa-arrow-up"></i> 8.2%</span>}
                        </div>
                    </div>
                </div>

                {/* --- KPI CARDS ROW (live audience + watch time + engagement rate) --- */}
                <div className="kpi-row">
                    <motion.button
                        className={`kpi-card-reel bg-blue-dark ${activeChart === 'watchTime' ? 'active-chart' : ''}`}
                        onClick={() => setActiveChart(activeChart === 'watchTime' ? null : 'watchTime')}
                        whileHover={{ scale: 1.05, y: -5 }}
                        whileTap={{ scale: 0.95 }}
                        transition={{ type: "spring", stiffness: 300 }}
                    >
                        <div className="label">Watch Time</div>
                        <div className="value">{hasLiveData ? watchTimeDisplay : (totals.watch / 1000).toFixed(0)}<span className="val-suffix">{hasLiveData ? '' : 'K'}</span></div>
                    </motion.button>
                    <motion.button
                        className={`kpi-card-reel bg-purple-dark ${activeChart === 'age' ? 'active-chart' : ''}`}
                        onClick={() => setActiveChart(activeChart === 'age' ? null : 'age')}
                        whileHover={{ scale: 1.05, y: -5 }}
                        whileTap={{ scale: 0.95 }}
                        transition={{ type: "spring", stiffness: 300 }}
                    >
                        <div className="label">Age</div>
                        <div className="value">
                            {loadingDemographics && !adsDemographicsData ? '...' : (ageBreakdown.length || ageGroupsCountFromAds || (reelPage ? 0 : 5))}
                            <span className="val-suffix">Groups</span>
                        </div>
                    </motion.button>
                    <motion.button
                        className={`kpi-card-reel bg-pink ${activeChart === 'gender' ? 'active-chart' : ''}`}
                        onClick={() => setActiveChart(activeChart === 'gender' ? null : 'gender')}
                        whileHover={{ scale: 1.05, y: -5 }}
                        whileTap={{ scale: 0.95 }}
                        transition={{ type: "spring", stiffness: 300 }}
                    >
                        <div className="label">Gender</div>
                        <div className="value">
                            {loadingDemographics && !adsDemographicsData ? '...' : (genderBreakdown.length || genderGroupsCountFromAds || (reelPage ? 0 : 3))}
                            <span className="val-suffix">Groups</span>
                        </div>
                    </motion.button>
                    <motion.button
                        className={`kpi-card-reel bg-purple-light ${activeChart === 'location' ? 'active-chart' : ''}`}
                        onClick={() => setActiveChart(activeChart === 'location' ? null : 'location')}
                        whileHover={{ scale: 1.05, y: -5 }}
                        whileTap={{ scale: 0.95 }}
                        transition={{ type: "spring", stiffness: 300 }}
                    >
                        <div className="label">Location</div>
                        <div className="value">
                            {loadingDemographics && !adsDemographicsData ? '...' : (locationBreakdown.length || locationCountFromAds || (reelPage ? 0 : 6))}
                            <span className="val-suffix">{cityBreakdown.length > 0 ? 'Cities' : (adsRegionBreakdown.length > 0 ? 'Regions' : 'Countries')}</span>
                        </div>
                    </motion.button>
                    <div className="kpi-card-reel bg-teal">
                        <div className="label">Engagement rate</div>
                        <div className="value">{hasLiveData ? engagementRateLive.toFixed(2) : '1.62'}<span className="val-suffix">%</span></div>
                    </div>
                </div>

                {/* --- DYNAMIC CHARTS SECTION --- */}
                <AnimatePresence mode="wait">
                    {activeChart && (
                        <motion.div
                            initial={{ opacity: 0, y: 20, scale: 0.95 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: -20, scale: 0.95 }}
                            transition={{ 
                                type: "spring", 
                                stiffness: 300, 
                                damping: 25,
                                duration: 0.5
                            }}
                            className="chart-panel"
                            style={{ marginTop: '24px', marginBottom: '24px' }}
                        >
                            {activeChart === 'watchTime' && (
                                <motion.div
                                    initial={{ opacity: 0 }}
                                    animate={{ opacity: 1 }}
                                    transition={{ delay: 0.2 }}
                                >
                                    <div className="chart-header-row">
                                        <div className="chart-legend-custom">
                                            <div className="fw-bold">Watch Time Distribution</div>
                                        </div>
                                    </div>
                                    <div style={{ width: '100%', height: 300 }}>
                                        <ResponsiveContainer width="100%" height="100%">
                                            <ComposedChart data={watchTimeChartData}>
                                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                                                <XAxis dataKey="time" tick={{ fontSize: 10, fill: '#64748b' }} axisLine={false} tickLine={false} />
                                                <YAxis tick={{ fontSize: 10, fill: '#64748b' }} axisLine={false} tickLine={false} />
                                                <Tooltip />
                                                <Bar dataKey="value" radius={[8, 8, 0, 0]} animationBegin={0} animationDuration={800}>
                                                    {watchTimeChartData.map((entry, index) => (
                                                        <Cell key={`cell-${index}`} fill={entry.color || COLORS[index % COLORS.length]} />
                                                    ))}
                                                </Bar>
                                            </ComposedChart>
                                        </ResponsiveContainer>
                                    </div>
                                </motion.div>
                            )}

                            {activeChart === 'age' && (
                                <motion.div
                                    initial={{ opacity: 0 }}
                                    animate={{ opacity: 1 }}
                                    transition={{ delay: 0.2 }}
                                >
                                    {ageGenderChartDataWithTotal && ageGenderChartDataWithTotal.length > 0 ? (
                                        <>
                                            <div className="chart-header-row">
                                                <div className="chart-legend-custom">
                                                    <div className="fw-bold">Age & Gender Distribution</div>
                                                    <small className="text-secondary text-muted d-block">
                                                        {ageGenderChartFromInstagram
                                                            ? 'Audience breakdown by demographics (Instagram audience — selected page)'
                                                            : ageGenderChartFromFacebook
                                                                ? 'Audience breakdown by demographics (Facebook Page audience — selected page)'
                                                                : 'Audience breakdown by demographics (Meta Ads Insights)'}
                                                    </small>
                                                </div>
                                            </div>
                                            {!ageGenderChartFromInstagram && !ageGenderChartFromFacebook && adsDemographicsError && (
                                                <div className="text-muted small mb-2">{adsDemographicsError}</div>
                                            )}
                                            {isFacebookSelected && reelPage && fbAudienceError && !ageGenderChartFromFacebook && (
                                                <div className="text-muted small mb-2">{fbAudienceError}</div>
                                            )}
                                            <div style={{ width: '100%', height: 350 }}>
                                                <ResponsiveContainer width="100%" height="100%">
                                                    <BarChart data={ageGenderChartDataWithTotal} margin={{ top: 20, right: 30, left: 0, bottom: 5 }} barSize={32} barGap={8}>
                                                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                                                        <XAxis dataKey="age" tick={{ fill: '#64748b', fontSize: 13, fontWeight: 500 }} axisLine={false} tickLine={false} dy={10} />
                                                        <YAxis tick={{ fill: '#64748b', fontSize: 12 }} axisLine={false} tickLine={false} />
                                                        <Tooltip
                                                            cursor={{ fill: 'rgba(0,0,0,0.02)' }}
                                                            contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 8px 24px rgba(0,0,0,0.1)', padding: '12px' }}
                                                        />
                                                        <Bar dataKey="men" name="Men" fill="#5b45b0" radius={[6, 6, 0, 0]} animationDuration={1500}>
                                                            <LabelList dataKey="men" position="top" formatter={(v) => formatCount(v)} />
                                                        </Bar>
                                                        <Bar dataKey="women" name="Women" fill="#00bcd4" radius={[6, 6, 0, 0]} animationDuration={1500}>
                                                            <LabelList dataKey="women" position="top" formatter={(v) => formatCount(v)} />
                                                        </Bar>
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
                                            </div>
                                        </>
                                    ) : (loadingAdsDemographics || (reelPage && loadingDemographics) || (isFacebookSelected && reelPage && fbAudienceLoading)) ? (
                                        <div className="d-flex align-items-center justify-content-center text-muted" style={{ minHeight: 320 }}>
                                            <div className="text-center">
                                                <div className="spinner-border mb-2" role="status"><span className="visually-hidden">Loading...</span></div>
                                                <p className="mb-0 small">
                                                    {reelPage && loadingDemographics
                                                        ? 'Loading Instagram audience…'
                                                        : isFacebookSelected && reelPage && fbAudienceLoading
                                                            ? 'Loading Facebook Page audience…'
                                                            : 'Loading Age & Gender demographics…'}
                                                </p>
                                            </div>
                                        </div>
                                    ) : (
                                        <>
                                            <div className="chart-header-row">
                                                <div className="chart-legend-custom">
                                                    <div className="fw-bold">Age Distribution</div>
                                                </div>
                                            </div>
                                            <div style={{ width: '100%', height: 300 }}>
                                                <ResponsiveContainer width="100%" height="100%">
                                                    <ComposedChart data={ageChartData}>
                                                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                                                        <XAxis dataKey="age" tick={{ fontSize: 10, fill: '#64748b' }} axisLine={false} tickLine={false} />
                                                        <YAxis tick={{ fontSize: 10, fill: '#64748b' }} axisLine={false} tickLine={false} />
                                                        <Tooltip />
                                                        <Bar dataKey="value" radius={[8, 8, 0, 0]} animationBegin={0} animationDuration={800}>
                                                            {ageChartData.map((entry, index) => (
                                                                <Cell key={`cell-${index}`} fill={entry.color || COLORS[index % COLORS.length]} />
                                                            ))}
                                                        </Bar>
                                                    </ComposedChart>
                                                </ResponsiveContainer>
                                            </div>
                                        </>
                                    )}
                                </motion.div>
                            )}

                            {activeChart === 'gender' && (
                                <motion.div
                                    initial={{ opacity: 0 }}
                                    animate={{ opacity: 1 }}
                                    transition={{ delay: 0.2 }}
                                >
                                    <div className="chart-header-row">
                                        <div className="chart-legend-custom">
                                            <div className="fw-bold">Gender Distribution</div>
                                            {genderChartData.length > 0 && (
                                                <small className="text-muted d-block">From Instagram audience (selected page)</small>
                                            )}
                                        </div>
                                    </div>
                                    {loadingDemographics ? (
                                        <div className="d-flex align-items-center justify-content-center text-muted" style={{ minHeight: 280 }}>
                                            <div className="text-center">
                                                <div className="spinner-border mb-2" role="status" /><span className="small">Loading gender data…</span>
                                            </div>
                                        </div>
                                    ) : genderChartData.length > 0 ? (
                                        <div style={{ width: '100%', height: 300 }}>
                                            <ResponsiveContainer width="100%" height="100%">
                                                <PieChart>
                                                    <Pie
                                                        data={genderChartData}
                                                        cx="50%"
                                                        cy="50%"
                                                        labelLine={false}
                                                        label={({ name, value, percent }) => `${name} ${formatCount(value)} (${(percent * 100).toFixed(0)}%)`}
                                                        outerRadius={100}
                                                        fill="#8884d8"
                                                        dataKey="value"
                                                        animationBegin={0}
                                                        animationDuration={800}
                                                    >
                                                        {genderChartData.map((entry, index) => (
                                                            <Cell key={`cell-${index}`} fill={entry.color || COLORS[index % COLORS.length]} />
                                                        ))}
                                                    </Pie>
                                                    <Tooltip />
                                                </PieChart>
                                            </ResponsiveContainer>
                                        </div>
                                    ) : (
                                        <div className="text-muted small py-5 text-center">No Instagram gender data for this page. Select a page with Instagram linked to see gender distribution.</div>
                                    )}
                                </motion.div>
                            )}

                            {activeChart === 'location' && (
                                <motion.div
                                    initial={{ opacity: 0 }}
                                    animate={{ opacity: 1 }}
                                    transition={{ delay: 0.2 }}
                                >
                                    <div className="chart-header-row">
                                        <div className="chart-legend-custom">
                                            <div className="fw-bold">Top towns/cities</div>
                                        </div>
                                    </div>
                                    <small className="text-muted d-block mb-3">
                                        {topTownsCitiesDisplay.length > 0
                                            ? 'From Instagram audience (city-level)'
                                            : topRegionsOrCountriesFromAds.list.length > 0
                                                ? 'Country-level (city data not available for this page). From Meta Ads Insights.'
                                                : 'Select a page with Instagram linked for city-level data.'}
                                    </small>
                                    {igDemographicsError && topTownsCitiesDisplay.length === 0 && (
                                        <div className="alert alert-warning py-2 small mb-3" role="alert">
                                            {igDemographicsError} Showing region/country from Ads when available.
                                        </div>
                                    )}
                                    {loadingDemographics && !adsDemographicsData ? (
                                        <div className="d-flex align-items-center gap-2 text-muted small mb-2"><div className="spinner-border spinner-border-sm" role="status" /><span>Loading...</span></div>
                                    ) : topTownsCitiesDisplay.length > 0 ? (
                                        <div className="d-flex flex-column gap-4">
                                            {topTownsCitiesDisplay.map((item, idx) => (
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
                                                        />
                                                    </div>
                                                </motion.div>
                                            ))}
                                        </div>
                                    ) : topRegionsOrCountriesFromAds.list.length > 0 ? (
                                        <div className="d-flex flex-column gap-4">
                                            {topRegionsOrCountriesFromAds.list.map((item, idx) => (
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
                                                        />
                                                    </div>
                                                </motion.div>
                                            ))}
                                        </div>
                                    ) : (
                                        <div className="text-muted small py-3">No location data for this page/period. Select a page with Instagram linked for city-level data, or ensure Ads Insights has region/country data.</div>
                                    )}
                                </motion.div>
                            )}
                        </motion.div>
                    )}
                </AnimatePresence>

                {/* --- CHARTS ROW --- */}
                <div className="main-grid" style={{ marginBottom: '24px' }}>
                    <div className="chart-panel">
                        <div className="chart-header-row">
                            <div className="chart-legend-custom">
                                <div><span className="legend-dot" style={{ background: '#0369a1' }}></span> Views</div>
                                <div><span className="legend-dot" style={{ background: '#38bdf8' }}></span> Engagements</div>
                            </div>
                            <i className="fas fa-ellipsis-h text-muted"></i>
                        </div>
                        <div style={{ width: '100%', height: 250 }}>
                            {viewsData.length > 0 ? (
                                <ResponsiveContainer width="100%" height="100%">
                                    <ComposedChart data={viewsData} margin={{ top: 10, right: 10, left: 10, bottom: 28 }}>
                                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                                        <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#64748b' }} interval={0} axisLine={false} tickLine={false} />
                                        <YAxis yAxisId="left" tick={{ fontSize: 10, fill: '#64748b' }} axisLine={false} tickLine={false} domain={[0, 4000]} />
                                        <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10, fill: '#64748b' }} axisLine={false} tickLine={false} domain={[0, 100]} />
                                        <Tooltip />
                                        <Bar yAxisId="left" dataKey="views" fill="#0369a1" barSize={8} radius={[2, 2, 0, 0]} />
                                        <Line yAxisId="right" type="monotone" dataKey="eng" stroke="#38bdf8" strokeWidth={2} dot={false} />
                                    </ComposedChart>
                                </ResponsiveContainer>
                            ) : (
                                <div className="d-flex align-items-center justify-content-center h-100 text-muted small">No daily views &amp; engagements for this period. Select a page and time range with data.</div>
                            )}
                        </div>
                    </div>
                    <div className="chart-panel">
                        <div className="chart-header-row"><div className="chart-legend-custom"><div>Subscribers change</div></div></div>
                        <div style={{ width: '100%', height: 250 }}>
                            <ResponsiveContainer width="100%" height="100%">
                                <ComposedChart data={subData} margin={{ top: 10, right: 10, left: 10, bottom: 28 }}>
                                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                                    <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#64748b' }} interval={0} axisLine={false} tickLine={false} />
                                    <YAxis tick={{ fontSize: 10, fill: '#64748b' }} axisLine={false} tickLine={false} domain={[0, 25]} />
                                    <Tooltip />
                                    <Line type="monotone" dataKey="val" stroke="#0369a1" strokeWidth={2} dot={false} />
                                </ComposedChart>
                            </ResponsiveContainer>
                        </div>
                    </div>
                </div>

                {/* --- TOP CONTENT BY VIEWS (card carousel) --- */}
                <div className="top-content-by-views">
                    <div className="top-content-by-views-header">
                        <span className="top-content-by-views-icon">
                            <i className={`fab ${isFacebookSelected ? 'fa-facebook' : 'fa-instagram'}`} aria-hidden></i>
                        </span>
                        <h3 className="top-content-by-views-title">
                            {isStories ? "Top Stories by Views" : "Top Content by Views"}
                        </h3>
                    </div>
                    {isStories && mediaInsights?.storiesFallbackUsed && contentListForTopContent.length > 0 && (
                        <p className="text-muted small mb-2 px-2" style={{ fontSize: '0.85rem' }}>
                            No stories in selected period; showing stories from the last 7 days.
                        </p>
                    )}
                    <div className="top-content-by-views-carousel-wrap">
                        <button
                            type="button"
                            className="top-content-scroll-btn"
                            onClick={scrollTopContentBack}
                            aria-label="Scroll back"
                        >
                            <i className="fas fa-chevron-left"></i>
                        </button>
                        <div
                            className="top-content-cards-scroll"
                            ref={topContentScrollRef}
                            role="list"
                        >
                            {contentListForTopContent.length === 0 ? (
                                <div className="text-muted text-center py-5 px-3" style={{ minWidth: '100%' }}>
                                    {!reelPage
                                        ? 'Select a page to see top content by views.'
                                        : activeTab === 'stories'
                                            ? 'No active stories right now. Instagram only exposes stories for 24 hours via the API. Story snapshots are saved automatically when stories are live — check back when you have an active story posted, and it will be captured for future viewing here.'
                                            : isFacebookSelected
                                                ? (mediaInsights?.message || 'No video content for this Page. The Page may have no native videos or video posts, or insights may be unavailable.')
                                                : 'No content for this period. Try a different time range or tab.'}
                                </div>
                            ) : contentListForTopContent.map((item, idx) => (
                                <article key={item.id || idx} className={`top-content-card ${activeTab === 'stories' ? 'top-content-card--story' : ''}`} role="listitem">
                                    <div className="top-content-card-thumb" style={(item.thumbnail_url || item.media_url) ? undefined : { backgroundColor: item.imgColor || COLORS[idx % COLORS.length] }}>
                                        {(item.thumbnail_url || item.media_url) ? (
                                            <img src={item.thumbnail_url || item.media_url || ''} alt="" className="top-content-card-thumb-img" />
                                        ) : null}
                                        {activeTab !== 'stories' && (
                                            <span className="top-content-card-play" aria-hidden>
                                                <i className="fas fa-play"></i>
                                            </span>
                                        )}
                                    </div>
                                    <h4 className="top-content-card-title" title={item.title}>
                                        {activeTab === 'stories'
                                            ? (item.title || 'Story').slice(0, 35) + ((item.title || '').length > 35 ? '...' : '')
                                            : (item.title || '').length > 35 ? `${(item.title || '').slice(0, 35)}...` : (item.title || 'Reel')}
                                    </h4>
                                    <p className="top-content-card-date">{getPublishDate(item)}</p>
                                    <div className="top-content-card-metrics">
                                        <div className="top-content-metric">
                                            <i className="far fa-eye" aria-hidden></i>
                                            <span>{formatCount(item.views ?? item.video_views ?? 0)}</span>
                                        </div>
                                        {activeTab === 'stories' ? (
                                            <>
                                                <div className="top-content-metric">
                                                    <i className="far fa-heart" aria-hidden></i>
                                                    <span>{formatCount(item.likes || 0)}</span>
                                                </div>
                                                <div className="top-content-metric">
                                                    <i className="far fa-comment" aria-hidden></i>
                                                    <span>{formatCount(item.comments || 0)}</span>
                                                </div>
                                                <div className="top-content-metric">
                                                    <i className="fas fa-share-alt" aria-hidden></i>
                                                    <span>{formatCount(item.shares != null ? item.shares : 0)}</span>
                                                </div>
                                            </>
                                        ) : (
                                            <>
                                                <div className="top-content-metric">
                                                    <i className="far fa-comment" aria-hidden></i>
                                                    <span>{formatCount(item.comments || 0)}</span>
                                                </div>
                                                <div className="top-content-metric">
                                                    <i className="far fa-heart" aria-hidden></i>
                                                    <span>{formatCount(item.likes || 0)}</span>
                                                </div>
                                                <div className="top-content-metric">
                                                    <i className="fas fa-share-alt" aria-hidden></i>
                                                    <span>{formatCount(item.shares != null ? item.shares : 0)}</span>
                                                </div>
                                                <div className="top-content-metric">
                                                    <i className="far fa-bookmark" aria-hidden></i>
                                                    <span>{formatCount(item.saved != null ? item.saved : 0)}</span>
                                                </div>
                                                <div className="top-content-metric">
                                                    <i className="fas fa-user-plus" aria-hidden></i>
                                                    <span>{formatCount(item.follows != null ? item.follows : 0)}</span>
                                                </div>
                                            </>
                                        )}
                                    </div>
                                </article>
                            ))}
                        </div>
                        <button
                            type="button"
                            className="top-content-scroll-btn"
                            onClick={scrollTopContent}
                            aria-label="Scroll to see more content"
                        >
                            <i className="fas fa-chevron-right"></i>
                        </button>
                    </div>
                </div>

            </div>

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
