import React, { useState, useEffect, useCallback } from 'react';
import { motion, Reorder, AnimatePresence } from 'framer-motion';
import { LineChart, Line, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell, RadialBarChart, RadialBar } from 'recharts';
import './Plan.css';

const API_BASE = process.env.REACT_APP_API_BASE || 'http://localhost:4000';

function getAuthToken() {
    try {
        const STORAGE_KEY = process.env.REACT_APP_STORAGE_KEY || 'app_auth';
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored) return JSON.parse(stored).token || null;
    } catch (e) {
        console.error('Error getting token:', e);
    }
    return null;
}

function getAuthHeaders() {
    const token = getAuthToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
}

export default function Plan() {
    const [tasks, setTasks] = useState([
        { id: '1', title: "Video To Darshak", subtitle: "Video reach to target audience", current: 0, target: 15, unit: "", icon: "fas fa-video", iconColor: "#6366f1", isCompleted: false },
        { id: '2', title: "CTR", subtitle: "Click-through rate", current: 0, target: 2, unit: "%", icon: "fas fa-mouse-pointer", iconColor: "#0ea5e9", isCompleted: false },
        { id: '3', title: "Hook Rate", subtitle: "Engagement hook performance", current: 0, target: 30, unit: "%", icon: "fas fa-fish", iconColor: "#f59e0b", isCompleted: false },
        { id: '4', title: "Hold Rate", subtitle: "Audience retention hold rate", current: 0, target: 40, unit: "%", icon: "fas fa-hand-holding", iconColor: "#8b5cf6", isCompleted: false },
        { id: '5', title: "Whats App Efficiency", subtitle: "WhatsApp conversion efficiency", current: 0, target: 60, unit: "%", icon: "fab fa-whatsapp", iconColor: "#25D366", isCompleted: false },
        { id: '6', title: "Diabetes Ratio", subtitle: "Diabetes segment ratio", current: 0, target: 60, unit: "%", icon: "fas fa-chart-pie", iconColor: "#ec4899", isCompleted: false },
        { id: '7', title: "Working Professionals", subtitle: "Working professionals segment", current: 0, target: 30, unit: "%", icon: "fas fa-briefcase", iconColor: "#0f766e", isCompleted: false },
        { id: '8', title: "Optin Rate for Paid", subtitle: "Paid campaign opt-in rate", current: 0, target: 5, unit: "%", icon: "fas fa-ad", iconColor: "#dc2626", isCompleted: false },
        { id: '9', title: "Optin Rate for YT", subtitle: "YouTube opt-in rate", current: 0, target: 25, unit: "%", icon: "fab fa-youtube", iconColor: "#FF0000", isCompleted: false },
    ]);

    const [selectedDateRange, setSelectedDateRange] = useState('This Week');
    const [filters, setFilters] = useState({ startDate: '', endDate: '' });

    const [teams, setTeams] = useState([]);
    const [aggregates, setAggregates] = useState({ data: [], budgetForecast: { weekly_ad_spend_target: 0, actual_ad_spend: 0, remaining_budget: 0, forecast_ad_spend: 0 } });
    const [aggregatesLoading, setAggregatesLoading] = useState(false);
    const [aggregatesError, setAggregatesError] = useState(null);
    const [pages, setPages] = useState([]);
    const [showAddTeamModal, setShowAddTeamModal] = useState(false);
    const [showTargetsModal, setShowTargetsModal] = useState(false);
    const [editingTargetsTeamId, setEditingTargetsTeamId] = useState(null);
    const [targetsForm, setTargetsForm] = useState({ target_followers: '', target_ad_spend: '', target_organic_leads: '', target_organic_revenue: '', target_stories: '', target_reels: '', target_posts: '' });
    const [savingTargets, setSavingTargets] = useState(false);
    const [newTeam, setNewTeam] = useState({ name: '', page_id: '' });
    const [savingTeam, setSavingTeam] = useState(false);
    const [addTeamError, setAddTeamError] = useState(null);
    const [_effortPlatform, _setEffortPlatform] = useState('instagram');

    const defaultSectionMetrics = () => ({
        freeWebinerBudget: { target: '', current: '' },
        freeWebinerLeads: { target: '', current: '' },
        uniqueLeads: { target: '', current: '' },
    });
    const defaultSaved = () => Array(4).fill(null).map(() => ({ freeWebinerBudget: false, freeWebinerLeads: false, uniqueLeads: false }));

    const [webinerSections, setWebinerSections] = useState(() => {
        try {
            const stored = localStorage.getItem('plan_webinerSections');
            if (stored) return JSON.parse(stored);
        } catch (_) {}
        return [defaultSectionMetrics(), defaultSectionMetrics(), defaultSectionMetrics(), defaultSectionMetrics()];
    });
    // tracks which metrics are in "saved/collapsed" state: [sectionIndex][metricKey] = bool
    const [webinerSaved, setWebinerSaved] = useState(() => {
        try {
            const stored = localStorage.getItem('plan_webinerSaved');
            if (stored) return JSON.parse(stored);
        } catch (_) {}
        return defaultSaved();
    });

    // Persist to localStorage whenever values change
    useEffect(() => {
        try { localStorage.setItem('plan_webinerSections', JSON.stringify(webinerSections)); } catch (_) {}
    }, [webinerSections]);
    useEffect(() => {
        try { localStorage.setItem('plan_webinerSaved', JSON.stringify(webinerSaved)); } catch (_) {}
    }, [webinerSaved]);

    const saveMetric = (sectionIndex, key) => setWebinerSaved(prev => prev.map((s, i) => i === sectionIndex ? { ...s, [key]: true } : s));
    const editMetric = (sectionIndex, key) => setWebinerSaved(prev => prev.map((s, i) => i === sectionIndex ? { ...s, [key]: false } : s));

    const getRange = (type) => {
        const today = new Date();
        const currentDay = today.getDay();
        const diffToMonday = currentDay === 0 ? -6 : 1 - currentDay;
        const weekStart = new Date(today);
        weekStart.setDate(today.getDate() + diffToMonday);
        weekStart.setHours(0, 0, 0, 0);
        let start = new Date(weekStart);
        let offset = 0;
        if (type === 'last_week') offset = -7;
        if (type === 'next_week') offset = 7;
        start.setDate(weekStart.getDate() + offset);
        const end = new Date(start);
        end.setDate(start.getDate() + 6);
        const formatDate = (d) => {
            const yyyy = d.getFullYear();
            const mm = String(d.getMonth() + 1).padStart(2, '0');
            const dd = String(d.getDate()).padStart(2, '0');
            return `${yyyy}-${mm}-${dd}`;
        };
        const formatLabel = (d) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        return {
            label: type === 'this_week' ? 'This Week' : type === 'last_week' ? 'Last Week' : 'Next Week',
            displayRange: `${formatLabel(start)} - ${formatLabel(end)}`,
            startDate: formatDate(start),
            endDate: formatDate(end)
        };
    };

    useEffect(() => {
        const range = getRange('this_week');
        setFilters({ startDate: range.startDate, endDate: range.endDate });
        setSelectedDateRange(range.displayRange);
    }, []);

    const applyPreset = (type) => {
        const range = getRange(type);
        setFilters({ startDate: range.startDate, endDate: range.endDate });
        setSelectedDateRange(range.displayRange);
    };

    const handleFilterChange = (e) => {
        const { name, value } = e.target;
        setFilters(prev => ({ ...prev, [name]: value }));
    };

    const weekStart = filters.startDate || null;

    const fetchTeams = useCallback(async () => {
        try {
            const res = await fetch(`${API_BASE}/api/plan/teams`, { headers: getAuthHeaders() });
            if (!res.ok) throw new Error('Failed to load teams');
            const json = await res.json();
            setTeams(json.data || []);
        } catch (e) {
            console.error('Plan fetchTeams', e);
            setTeams([]);
        }
    }, []);

    const fetchPages = useCallback(async () => {
        try {
            const res = await fetch(`${API_BASE}/api/meta/pages`, { headers: getAuthHeaders() });
            if (!res.ok) return;
            const json = await res.json();
            setPages(Array.isArray(json.data) ? json.data : (json.data?.data ? json.data.data : []));
        } catch (e) {
            console.warn('Plan fetchPages', e);
        }
    }, []);

    const fetchAggregates = useCallback(async () => {
        if (!weekStart || !/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) {
            setAggregates({ data: [], budgetForecast: { weekly_ad_spend_target: 0, actual_ad_spend: 0, remaining_budget: 0, forecast_ad_spend: 0 } });
            return;
        }
        setAggregatesLoading(true);
        setAggregatesError(null);
        try {
            const res = await fetch(`${API_BASE}/api/plan/aggregates?week_start=${encodeURIComponent(weekStart)}`, { headers: getAuthHeaders() });
            if (!res.ok) {
                const errData = await res.json().catch(() => ({}));
                throw new Error(errData.error || res.statusText);
            }
            const json = await res.json();
            setAggregates({ data: json.data || [], budgetForecast: json.budgetForecast || {} });
        } catch (e) {
            setAggregatesError(e.message || 'Failed to load aggregates');
            setAggregates({ data: [], budgetForecast: {} });
        } finally {
            setAggregatesLoading(false);
        }
    }, [weekStart]);

    useEffect(() => { fetchTeams(); }, [fetchTeams]);
    useEffect(() => { fetchPages(); }, [fetchPages]);
    useEffect(() => { fetchAggregates(); }, [fetchAggregates]);

    const openTargetsModal = (item) => {
        const t = item?.targets || {};
        setTargetsForm({
            target_followers: t.followers ?? '',
            target_ad_spend: t.ad_spend ?? '',
            target_organic_leads: t.organic_leads ?? '',
            target_organic_revenue: t.organic_revenue ?? '',
            target_stories: t.stories ?? '',
            target_reels: t.reels ?? '',
            target_posts: t.posts ?? ''
        });
        setEditingTargetsTeamId(item?.team?.id ?? null);
        setShowTargetsModal(true);
    };

    const openTargetsForTeam = (team) => {
        setTargetsForm({ target_followers: '', target_ad_spend: '', target_organic_leads: '', target_organic_revenue: '', target_stories: '', target_reels: '', target_posts: '' });
        setEditingTargetsTeamId(team?.id ?? null);
        setShowTargetsModal(true);
    };

    const saveTargets = async () => {
        if (!editingTargetsTeamId || !weekStart) return;
        setSavingTargets(true);
        try {
            const res = await fetch(`${API_BASE}/api/plan/targets`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
                body: JSON.stringify({
                    team_id: editingTargetsTeamId,
                    week_start: weekStart,
                    target_followers: Number(targetsForm.target_followers) || 0,
                    target_ad_spend: Number(targetsForm.target_ad_spend) || 0,
                    target_organic_leads: Number(targetsForm.target_organic_leads) || 0,
                    target_organic_revenue: Number(targetsForm.target_organic_revenue) || 0,
                    target_stories: Number(targetsForm.target_stories) || 0,
                    target_reels: Number(targetsForm.target_reels) || 0,
                    target_posts: Number(targetsForm.target_posts) || 0
                })
            });
            if (!res.ok) throw new Error('Failed to save targets');
            setShowTargetsModal(false);
            fetchAggregates();
            fetchTeams();
        } catch (e) {
            console.error('saveTargets', e);
        } finally {
            setSavingTargets(false);
        }
    };

    const saveNewTeam = async (e) => {
        if (e && e.preventDefault) e.preventDefault();
        const name = (newTeam.name || '').trim();
        if (!name) return;
        setSavingTeam(true);
        setAddTeamError(null);
        try {
            const res = await fetch(`${API_BASE}/api/plan/teams`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
                body: JSON.stringify({ name, page_id: newTeam.page_id || null })
            });
            const json = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(json.error || res.statusText || 'Failed to add team');
            setShowAddTeamModal(false);
            setNewTeam({ name: '', page_id: '' });
            setAddTeamError(null);
            fetchTeams();
            fetchAggregates();
        } catch (e) {
            console.error('saveNewTeam', e);
            setAddTeamError(e.message || 'Failed to add team');
        } finally {
            setSavingTeam(false);
        }
    };

    const deleteTeam = async (teamId) => {
        if (!window.confirm('Remove this team? Targets for this team will be deleted.')) return;
        try {
            const res = await fetch(`${API_BASE}/api/plan/teams/${teamId}`, { method: 'DELETE', headers: getAuthHeaders() });
            if (!res.ok) throw new Error('Failed to delete team');
            fetchTeams();
            fetchAggregates();
        } catch (e) {
            console.error('deleteTeam', e);
        }
    };

    const formatNum = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'K' : String(Number(n)));
    const formatCurrency = (n) => (n == null || n === '' ? '$0' : `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`);

    const itemVariants = {
        hidden: { opacity: 0, y: 20 },
        visible: (i) => ({ opacity: 1, y: 0, transition: { delay: i * 0.06, duration: 0.35, ease: [0.25, 0.46, 0.45, 0.94] } })
    };
    const progressBarTransition = { type: 'spring', stiffness: 50, damping: 20 };

    const isSchemaError = aggregatesError && (aggregatesError.includes('plan_teams') || aggregatesError.includes('schema cache') || aggregatesError.includes('Could not find'));

    return (
        <div className="plan-page">

            {/* --- HEADER --- */}
            <header className="plan-header">
                <div className="plan-header-inner">
                    <div className="plan-header-title-card">
                        <div className="plan-header-title-icon">
                            <i className="fas fa-chart-bar" />
                        </div>
                        <div className="plan-header-title-text">
                            <h1 className="plan-page-title">Team Performance & Effort & Goals</h1>
                            <p className="plan-page-subtitle">Track individual team performance in real-time</p>
                        </div>
                    </div>
                </div>
            </header>

            <div className="plan-content">

                {/* --- WEBINER BUDGET SECTIONS (1x4 grid, collapsible metrics) --- */}
                {(() => {
                    const webinerConfig = [
                        { title: 'Free Webiner Budget',            icon: 'fas fa-bullhorn',    color: '#1877f2', gradFrom: '#1877f2', gradTo: '#60a5fa', colorLight: '#eff6ff' },
                        { title: 'Paid Webiner Budget',            icon: 'fas fa-credit-card', color: '#8b5cf6', gradFrom: '#8b5cf6', gradTo: '#c4b5fd', colorLight: '#f5f3ff' },
                        { title: 'YT Webiner Budget',              icon: 'fab fa-youtube',     color: '#ef4444', gradFrom: '#ef4444', gradTo: '#fca5a5', colorLight: '#fef2f2' },
                        { title: 'Direact-Walking Webiner Budget', icon: 'fas fa-walking',     color: '#22c55e', gradFrom: '#22c55e', gradTo: '#86efac', colorLight: '#f0fdf4' },
                    ];
                    return (
                        <div className="plan-webiner-cards-grid">
                            {webinerConfig.map((cfg, sectionIndex) => {
                                const metricKeys = [
                                    { key: 'freeWebinerBudget', label: cfg.title },
                                    { key: 'freeWebinerLeads',  label: cfg.title.replace(/ Budget$/, ' Leads') },
                                    { key: 'uniqueLeads',       label: 'Unique Leads' },
                                ];
                                const allSaved = webinerSaved[sectionIndex];
                                const allPcts = metricKeys.map(({ key }) => {
                                    const m = webinerSections[sectionIndex][key];
                                    const t = Number(m.target) || 0;
                                    const c = Number(m.current) || 0;
                                    return t > 0 ? Math.min(100, (c / t) * 100) : 0;
                                });
                                const cardAvg = Math.round(allPcts.reduce((a, b) => a + b, 0) / allPcts.length);
                                const allMetricsSaved = metricKeys.every(({ key }) => allSaved[key]);
                                return (
                                    <motion.section
                                        key={sectionIndex}
                                        className="plan-wc-card"
                                        style={{ '--wc-color': cfg.color, '--wc-light': cfg.colorLight }}
                                        initial={{ opacity: 0, y: 28 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        transition={{ delay: sectionIndex * 0.08, duration: 0.42, ease: [0.25, 0.46, 0.45, 0.94] }}
                                        whileHover={{ y: -3, boxShadow: `0 14px 36px ${cfg.color}22` }}
                                    >
                                        {/* Card header */}
                                        <div className="plan-wc-header" style={{ background: `linear-gradient(135deg, ${cfg.gradFrom}15, ${cfg.gradTo}25)`, borderBottom: `2px solid ${cfg.color}1a` }}>
                                            <div className="plan-wc-icon" style={{ background: `linear-gradient(135deg, ${cfg.gradFrom}, ${cfg.gradTo})` }}>
                                                <i className={cfg.icon} />
                                            </div>
                                            <div className="plan-wc-header-text">
                                                <h3 className="plan-wc-title">{sectionIndex + 1}. {cfg.title}</h3>
                                                <p className="plan-wc-tagline">Weekly targets & progress</p>
                                            </div>
                                            <div className="plan-wc-header-right">
                                                <div className="plan-wc-avg-badge" style={{ background: cfg.color }}>{cardAvg}%</div>
                                                {allMetricsSaved && (
                                                    <motion.button
                                                        type="button"
                                                        className="plan-wc-edit-all-btn"
                                                        style={{ color: cfg.color, borderColor: `${cfg.color}44`, background: `${cfg.color}10` }}
                                                        onClick={() => {
                                                            metricKeys.forEach(({ key }) => editMetric(sectionIndex, key));
                                                        }}
                                                        initial={{ opacity: 0, scale: 0.8 }}
                                                        animate={{ opacity: 1, scale: 1 }}
                                                        whileHover={{ scale: 1.06 }}
                                                        whileTap={{ scale: 0.95 }}
                                                        title="Edit all targets"
                                                    >
                                                        <i className="fas fa-pen" /> Edit
                                                    </motion.button>
                                                )}
                                            </div>
                                        </div>

                                        {/* Metrics */}
                                        <div className="plan-wc-metrics">
                                            {metricKeys.map(({ key, label }, mIdx) => {
                                                const m = webinerSections[sectionIndex][key];
                                                const target = Number(m.target) || 0;
                                                const current = Number(m.current) || 0;
                                                const pct = target > 0 ? Math.min(100, (current / target) * 100) : 0;
                                                const isSaved = allSaved[key];
                                                const inputId = `wc-${sectionIndex}-${key}`;
                                                return (
                                                    <motion.div
                                                        key={key}
                                                        className="plan-wc-metric"
                                                        initial={{ opacity: 0, x: -10 }}
                                                        animate={{ opacity: 1, x: 0 }}
                                                        transition={{ delay: sectionIndex * 0.07 + mIdx * 0.05 + 0.15, duration: 0.3 }}
                                                    >
                                                        <div className="plan-wc-metric-top">
                                                            <label className="plan-wc-metric-label" htmlFor={inputId}>{label}</label>
                                                            <span className="plan-wc-metric-stat" style={{ color: cfg.color }}>{current} / {target || 0}</span>
                                                        </div>

                                                        <AnimatePresence mode="wait">
                                                            {isSaved ? (
                                                                /* ── Saved / collapsed view ── */
                                                                <motion.div
                                                                    key="saved"
                                                                    className="plan-wc-saved-row"
                                                                    initial={{ opacity: 0, height: 0 }}
                                                                    animate={{ opacity: 1, height: 'auto' }}
                                                                    exit={{ opacity: 0, height: 0 }}
                                                                    transition={{ duration: 0.25 }}
                                                                >
                                                                    <div className="plan-wc-saved-value" style={{ borderColor: `${cfg.color}33`, background: `${cfg.color}08` }}>
                                                                        <i className="fas fa-check-circle" style={{ color: cfg.color }} />
                                                                        <span style={{ color: cfg.color, fontWeight: 700 }}>{target || '—'}</span>
                                                                        <span className="plan-wc-saved-label">target set</span>
                                                                    </div>
                                                                    <motion.button
                                                                        type="button"
                                                                        className="plan-wc-edit-btn"
                                                                        style={{ color: cfg.color, borderColor: `${cfg.color}33`, background: `${cfg.color}0d` }}
                                                                        onClick={() => editMetric(sectionIndex, key)}
                                                                        whileHover={{ scale: 1.07, background: `${cfg.color}22` }}
                                                                        whileTap={{ scale: 0.93 }}
                                                                    >
                                                                        <i className="fas fa-pen" /> Edit
                                                                    </motion.button>
                                                                </motion.div>
                                                            ) : (
                                                                /* ── Input / editing view ── */
                                                                <motion.div
                                                                    key="editing"
                                                                    className="plan-wc-metric-row"
                                                                    initial={{ opacity: 0, height: 0 }}
                                                                    animate={{ opacity: 1, height: 'auto' }}
                                                                    exit={{ opacity: 0, height: 0 }}
                                                                    transition={{ duration: 0.25 }}
                                                                >
                                                                    <input
                                                                        id={inputId}
                                                                        type="number"
                                                                        className="plan-wc-input"
                                                                        min="0"
                                                                        placeholder="Set target…"
                                                                        value={m.target}
                                                                        onChange={(e) => setWebinerSections(prev => prev.map((sec, i) => i === sectionIndex ? { ...sec, [key]: { ...sec[key], target: e.target.value } } : sec))}
                                                                        onKeyDown={(e) => { if (e.key === 'Enter' && m.target !== '') saveMetric(sectionIndex, key); }}
                                                                        autoComplete="off"
                                                                        style={{ '--wc-focus-color': cfg.color }}
                                                                    />
                                                                    <motion.button
                                                                        type="button"
                                                                        className="plan-wc-set-btn"
                                                                        style={{ background: `linear-gradient(135deg, ${cfg.gradFrom}, ${cfg.gradTo})` }}
                                                                        onClick={() => { if (m.target !== '') saveMetric(sectionIndex, key); }}
                                                                        whileHover={{ scale: 1.07 }}
                                                                        whileTap={{ scale: 0.93 }}
                                                                        title="Save target"
                                                                    >
                                                                        <i className="fas fa-check" />
                                                                    </motion.button>
                                                                    <span className="plan-wc-pct-badge" style={{ color: cfg.color, background: `${cfg.color}14` }}>{Math.round(pct)}%</span>
                                                                </motion.div>
                                                            )}
                                                        </AnimatePresence>

                                                        <div className="plan-wc-bar-track">
                                                            <motion.div
                                                                className="plan-wc-bar-fill"
                                                                style={{ background: `linear-gradient(90deg, ${cfg.gradFrom}, ${cfg.gradTo})` }}
                                                                initial={{ width: 0 }}
                                                                animate={{ width: `${pct}%` }}
                                                                transition={{ delay: sectionIndex * 0.08 + mIdx * 0.06 + 0.2, duration: 0.7, ease: [0.34, 1.56, 0.64, 1] }}
                                                            />
                                                        </div>
                                                    </motion.div>
                                                );
                                            })}
                                        </div>
                                    </motion.section>
                                );
                            })}
                        </div>
                    );
                })()}

                {/* --- WEBINER GRAPHS 2x2 (colorful area charts) --- */}
                <div className="plan-webiner-graphs-grid">
                    {(() => {
                        const chartConfigs = [
                            { title: 'Free Webiner Budget',            icon: 'fas fa-bullhorn',    budgetColor: '#1877f2', leadsColor: '#60a5fa', targetColor: '#93c5fd', bg: '#eff6ff' },
                            { title: 'Paid Webiner Budget',            icon: 'fas fa-credit-card', budgetColor: '#8b5cf6', leadsColor: '#a78bfa', targetColor: '#c4b5fd', bg: '#f5f3ff' },
                            { title: 'YT Webiner Budget',              icon: 'fab fa-youtube',     budgetColor: '#ef4444', leadsColor: '#f87171', targetColor: '#fca5a5', bg: '#fef2f2' },
                            { title: 'Direact-Walking Webiner Budget', icon: 'fas fa-walking',     budgetColor: '#22c55e', leadsColor: '#4ade80', targetColor: '#86efac', bg: '#f0fdf4' },
                        ];
                        const weekLabels = ['Week 1', 'Week 2', 'Week 3', 'Week 4'];
                        return chartConfigs.map((cfg, sectionIndex) => {
                            const sec = webinerSections[sectionIndex] || defaultSectionMetrics();
                            const budgetCurrent = Number(sec.freeWebinerBudget?.current) || 0;
                            const leadsCurrent = Number(sec.uniqueLeads?.current) || 0;
                            const budgetTarget = Number(sec.freeWebinerBudget?.target) || 0;
                            const leadsTarget = Number(sec.uniqueLeads?.target) || 0;
                            const chartData = weekLabels.map((week, i) => {
                                const ratio = i < 3 ? (i + 1) / 4 : 1;
                                return { week, budget: Math.round(budgetCurrent * ratio), leads: Math.round(leadsCurrent * ratio), targetBudget: budgetTarget, targetLeads: leadsTarget };
                            });
                            const yMax = Math.max(budgetCurrent, leadsCurrent, budgetTarget, leadsTarget, 1);
                            const gradId1 = `grad-budget-${sectionIndex}`;
                            const gradId2 = `grad-leads-${sectionIndex}`;
                            return (
                                <motion.section
                                    key={sectionIndex}
                                    className="plan-wg-card"
                                    style={{ '--wg-color': cfg.budgetColor, '--wg-bg': cfg.bg }}
                                    initial={{ opacity: 0, scale: 0.97 }}
                                    animate={{ opacity: 1, scale: 1 }}
                                    transition={{ delay: sectionIndex * 0.09, duration: 0.4, ease: 'easeOut' }}
                                    whileHover={{ y: -2, boxShadow: `0 10px 28px ${cfg.budgetColor}22` }}
                                >
                                    <div className="plan-wg-header">
                                        <span className="plan-wg-icon" style={{ color: cfg.budgetColor, background: `${cfg.budgetColor}14` }}>
                                            <i className={cfg.icon} />
                                        </span>
                                        <h3 className="plan-wg-title">{cfg.title}</h3>
                                    </div>
                                    <div className="plan-wg-legend">
                                        <span style={{ color: cfg.budgetColor }}><i className="fas fa-circle" style={{ fontSize: '7px', marginRight: '4px' }} />Budget</span>
                                        <span style={{ color: cfg.leadsColor }}><i className="fas fa-circle" style={{ fontSize: '7px', marginRight: '4px' }} />Leads</span>
                                        <span style={{ color: cfg.targetColor }}><i className="fas fa-minus" style={{ marginRight: '4px' }} />Targets</span>
                                    </div>
                                    <ResponsiveContainer width="100%" height={200}>
                                        <AreaChart data={chartData} margin={{ top: 8, right: 12, left: -10, bottom: 0 }}>
                                            <defs>
                                                <linearGradient id={gradId1} x1="0" y1="0" x2="0" y2="1">
                                                    <stop offset="5%" stopColor={cfg.budgetColor} stopOpacity={0.35} />
                                                    <stop offset="95%" stopColor={cfg.budgetColor} stopOpacity={0.03} />
                                                </linearGradient>
                                                <linearGradient id={gradId2} x1="0" y1="0" x2="0" y2="1">
                                                    <stop offset="5%" stopColor={cfg.leadsColor} stopOpacity={0.35} />
                                                    <stop offset="95%" stopColor={cfg.leadsColor} stopOpacity={0.03} />
                                                </linearGradient>
                                            </defs>
                                            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                                            <XAxis dataKey="week" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
                                            <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} domain={[0, yMax]} />
                                            <Tooltip
                                                contentStyle={{ background: '#fff', border: `1px solid ${cfg.budgetColor}33`, borderRadius: 10, fontSize: 12, boxShadow: `0 4px 16px ${cfg.budgetColor}18` }}
                                                labelStyle={{ color: '#334155', fontWeight: 600 }}
                                            />
                                            <Area type="monotone" dataKey="budget" name="Budget" stroke={cfg.budgetColor} strokeWidth={2.5} fill={`url(#${gradId1})`} dot={{ r: 4, fill: cfg.budgetColor, strokeWidth: 0 }} activeDot={{ r: 6 }} />
                                            <Area type="monotone" dataKey="leads" name="Leads" stroke={cfg.leadsColor} strokeWidth={2.5} fill={`url(#${gradId2})`} dot={{ r: 4, fill: cfg.leadsColor, strokeWidth: 0 }} activeDot={{ r: 6 }} />
                                            <Line type="monotone" dataKey="targetBudget" name="Budget Target" stroke={cfg.budgetColor} strokeWidth={1.5} strokeDasharray="5 4" strokeOpacity={0.55} dot={false} />
                                            <Line type="monotone" dataKey="targetLeads" name="Leads Target" stroke={cfg.leadsColor} strokeWidth={1.5} strokeDasharray="5 4" strokeOpacity={0.55} dot={false} />
                                        </AreaChart>
                                    </ResponsiveContainer>
                                </motion.section>
                            );
                        });
                    })()}
                </div>

                {/* --- TASKS --- */}
                <section className="plan-tasks-section plan-card">
                    <div className="plan-team-section-head">
                        <h2 className="plan-team-section-title">Team Performance & Effort & Goals</h2>
                    </div>
                    <Reorder.Group axis="y" values={tasks} onReorder={setTasks} className="plan-task-list">
                        <AnimatePresence>
                            {tasks.map((task, index) => {
                                const targetVal = Number(task.target) || 100;
                                const currentVal = Number(task.current) || 0;
                                const pct = targetVal > 0 ? Math.min(100, (currentVal / targetVal) * 100) : 0;
                                return (
                                    <Reorder.Item key={task.id} value={task} className="plan-task-item">
                                        <motion.div
                                            custom={index}
                                            variants={itemVariants}
                                            initial="hidden"
                                            animate="visible"
                                            layout
                                            layoutId={task.id}
                                            whileHover={{ scale: 1.01, boxShadow: '0 8px 24px rgba(0,0,0,0.08)' }}
                                            whileTap={{ scale: 0.99 }}
                                            transition={{ duration: 0.2 }}
                                            className="plan-task-card"
                                        >
                                            <div className="plan-task-card-inner">
                                                <div className="plan-task-left">
                                                    <div className="plan-task-drag d-none d-md-flex"><i className="fas fa-grip-lines" /></div>
                                                    <div className="plan-task-icon-wrap" style={{ '--task-icon-color': task.iconColor || '#1877f2' }}>
                                                        <div className="plan-task-icon plan-task-icon--reel" style={{ background: `${task.iconColor || '#1877f2'}18`, color: task.iconColor || '#1877f2' }}><i className={task.icon} /></div>
                                                    </div>
                                                    <div className="plan-task-info">
                                                        <h5 className="plan-task-title">{task.title}</h5>
                                                        <p className="plan-task-subtitle">{task.subtitle || ''}</p>
                                                    </div>
                                                </div>
                                                <div className="plan-task-right">
                                                    <div className="plan-task-progress-wrap">
                                                        <span className="plan-task-progress-text">{currentVal}/{targetVal} {task.unit}</span>
                                                        <div className="plan-task-progress-bar">
                                                            <motion.div className="plan-task-progress-fill" initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={progressBarTransition} />
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        </motion.div>
                                    </Reorder.Item>
                                );
                            })}
                        </AnimatePresence>
                    </Reorder.Group>
                    <p className="plan-footer-text">Keep going! You're doing great.</p>
                </section>

                {/* === TEAM PERFORMANCE DASHBOARD (reference image redesign) === */}
                <section className="plan-team-section plan-card plan-section-2">
                    <div className="plan-team-section-head">
                        <h2 className="plan-team-section-title">Team Performance & Effort & Goals</h2>
                        <button type="button" className="plan-btn-add-team" onClick={() => setShowAddTeamModal(true)}>
                            <i className="fas fa-plus" /> Add team
                        </button>
                    </div>

                    {isSchemaError && (
                        <div className="plan-setup-message plan-setup-message-warning">
                            <p className="plan-setup-message-text">Team goals need database setup. Run the Plan tables migration in Supabase (<code>server/migrations/plan-tables.sql</code>) or ask your admin to reload the schema cache.</p>
                            <button type="button" className="btn btn-primary btn-sm rounded-pill" onClick={() => setShowAddTeamModal(true)}>Add team</button>
                        </div>
                    )}
                    {aggregatesError && !isSchemaError && (
                        <div className="plan-setup-message plan-setup-message-warning">
                            <p className="plan-setup-message-text">{aggregatesError}</p>
                            <button type="button" className="btn btn-outline-primary btn-sm rounded-pill" onClick={() => fetchAggregates()}>Retry</button>
                        </div>
                    )}
                    {!aggregatesError && aggregates.data.length === 0 && teams.length === 0 && !aggregatesLoading && (
                        <div className="plan-setup-message">
                            <p className="plan-setup-message-text">No teams yet. Add a team and set weekly targets to see performance and effort goals.</p>
                            <button type="button" className="plan-btn-add-team-large" onClick={() => setShowAddTeamModal(true)}>Add team</button>
                        </div>
                    )}

                    {!aggregatesError && (aggregates.data.length > 0 || teams.length > 0 || aggregatesLoading) && (() => {
                        const allTeamData = aggregates.data || [];

                        // Per-team performance scores
                        const teamScores = allTeamData.map(item => {
                            const p = item.progressPct || {};
                            const vals = [p.followers || 0, p.ad_spend || 0, p.organic_leads || 0, p.organic_revenue || 0, p.stories || 0, p.reels || 0, p.posts || 0];
                            const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
                            return { name: item.team.name, score: Math.min(100, Math.round(avg)), item };
                        }).sort((a, b) => b.score - a.score);

                        const overallAvg = teamScores.length > 0 ? Math.round(teamScores.reduce((a, b) => a + b.score, 0) / teamScores.length) : 0;
                        const total = teamScores.length || 1;
                        const topCount = teamScores.filter(t => t.score >= 75).length;
                        const avgCount = teamScores.filter(t => t.score >= 50 && t.score < 75).length;
                        const behindCount = teamScores.filter(t => t.score < 50).length;

                        const rawDonut = [
                            { name: 'Top Performers', value: topCount, color: '#22c55e' },
                            { name: 'Average', value: avgCount, color: '#f59e0b' },
                            { name: 'Behind', value: behindCount, color: '#ef4444' },
                        ].filter(d => d.value > 0);
                        const donutData = rawDonut.length > 0 ? rawDonut : [{ name: 'No Data', value: 1, color: '#e2e8f0' }];

                        const metricAvg = (key) => {
                            if (!allTeamData.length) return 0;
                            return Math.round(allTeamData.reduce((s, item) => s + (item.progressPct[key] || 0), 0) / allTeamData.length);
                        };

                        const bf = aggregates.budgetForecast || {};
                        const budgetPct = bf.weekly_ad_spend_target > 0 ? Math.min(100, Math.round((bf.actual_ad_spend / bf.weekly_ad_spend_target) * 100)) : 0;
                        const targetsSet = allTeamData.filter(item => Object.values(item.targets || {}).some(v => v > 0)).length;
                        const goalsHit = teamScores.filter(t => t.score >= 100).length;
                        const goalsMissed = teamScores.filter(t => t.score > 0 && t.score < 100).length;

                        const metricBars = [
                            { key: 'followers', label: 'Followers', color: '#3b82f6' },
                            { key: 'ad_spend', label: 'Ad Spend', color: '#8b5cf6' },
                            { key: 'organic_leads', label: 'Organic Leads', color: '#22c55e' },
                            { key: 'organic_revenue', label: 'Organic Revenue', color: '#f59e0b' },
                            { key: 'reels', label: 'Reels', color: '#ec4899' },
                        ];

                        const radialData = [{ name: 'Achievement', value: overallAvg, fill: '#3b82f6' }];
                        const budgetColor = budgetPct > 90 ? '#ef4444' : budgetPct > 70 ? '#f59e0b' : '#22c55e';
                        const budgetGaugeData = [{ name: 'Used', value: budgetPct || 1, fill: budgetColor }];

                        // Teams without aggregate data
                        const teamsWithoutData = teams.filter(t => !allTeamData.find(a => a.team.id === t.id));

                        return (
                            <>
                                {aggregatesLoading && (
                                    <div className="plan-loading-inline">
                                        <span className="spinner-border spinner-border-sm text-primary me-2" role="status" />
                                        <span className="text-muted small">Loading live data from Meta…</span>
                                    </div>
                                )}

                                {/* ── ROW 1: 3 columns ── */}
                                <div className="plan-perf-row">

                                    {/* 1. Performance Score (donut) */}
                                    <div className="plan-perf-card plan-perf-nps">
                                        <div className="plan-perf-card-header">
                                            <h4 className="plan-perf-card-title">Performance Score</h4>
                                        </div>
                                        <div className="plan-perf-donut-outer">
                                            <PieChart width={170} height={170}>
                                                <Pie data={donutData} cx={80} cy={80} innerRadius={52} outerRadius={76} dataKey="value" startAngle={90} endAngle={-270} strokeWidth={0}>
                                                    {donutData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                                                </Pie>
                                            </PieChart>
                                            <div className="plan-perf-donut-center-label">
                                                <span className="plan-perf-donut-pct">{overallAvg}%</span>
                                                <span className="plan-perf-donut-sub">Overall</span>
                                            </div>
                                        </div>
                                        <div className="plan-perf-nps-legend">
                                            <div className="plan-perf-nps-item" style={{ background: '#22c55e18' }}>
                                                <span className="plan-perf-nps-dot" style={{ background: '#22c55e' }} />
                                                <span className="plan-perf-nps-pct">{Math.round(topCount / total * 100)}%</span>
                                                <span className="plan-perf-nps-name">Top Performers</span>
                                            </div>
                                            <div className="plan-perf-nps-item" style={{ background: '#f59e0b18' }}>
                                                <span className="plan-perf-nps-dot" style={{ background: '#f59e0b' }} />
                                                <span className="plan-perf-nps-pct">{Math.round(avgCount / total * 100)}%</span>
                                                <span className="plan-perf-nps-name">Average</span>
                                            </div>
                                            <div className="plan-perf-nps-item" style={{ background: '#ef444418' }}>
                                                <span className="plan-perf-nps-dot" style={{ background: '#ef4444' }} />
                                                <span className="plan-perf-nps-pct">{Math.round(behindCount / total * 100)}%</span>
                                                <span className="plan-perf-nps-name">Behind</span>
                                            </div>
                                        </div>
                                    </div>

                                    {/* 2. Avg Goal Achievement Rate */}
                                    <div className="plan-perf-card plan-perf-rate">
                                        <div className="plan-perf-card-header">
                                            <h4 className="plan-perf-card-title">Avg Goal Achievement Rate</h4>
                                        </div>
                                        <div className="plan-perf-radial-outer">
                                            <RadialBarChart width={140} height={140} cx={70} cy={70} innerRadius={38} outerRadius={62} data={radialData} startAngle={90} endAngle={-270} barSize={16}>
                                                <RadialBar dataKey="value" cornerRadius={8} background={{ fill: '#e2e8f0' }} />
                                            </RadialBarChart>
                                            <div className="plan-perf-radial-center-label">
                                                <span className="plan-perf-radial-pct">{overallAvg}%</span>
                                            </div>
                                        </div>
                                        <div className="plan-perf-metric-bars">
                                            {metricBars.map(m => {
                                                const pct = metricAvg(m.key);
                                                return (
                                                    <div key={m.key} className="plan-perf-metric-bar-row">
                                                        <div className="plan-perf-metric-bar-top">
                                                            <span className="plan-perf-metric-bar-label">{m.label}</span>
                                                            <span className="plan-perf-metric-bar-pct">{pct}%</span>
                                                        </div>
                                                        <div className="plan-perf-metric-bar-track">
                                                            <div className="plan-perf-metric-bar-fill" style={{ width: `${pct}%`, background: m.color }} />
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>

                                    {/* 3. Top Performing Teams */}
                                    <div className="plan-perf-card plan-perf-top-teams">
                                        <div className="plan-perf-card-header">
                                            <h4 className="plan-perf-card-title">Top Performing Teams</h4>
                                        </div>
                                        <div className="plan-perf-teams-list">
                                            {teamScores.length === 0 && teamsWithoutData.length === 0 && (
                                                <p className="text-muted small">Set targets to see team rankings.</p>
                                            )}
                                            {teamScores.map((t, i) => (
                                                <div key={t.name} className="plan-perf-team-row">
                                                    <div className="plan-perf-team-ring-wrap">
                                                        <svg width="46" height="46" viewBox="0 0 46 46">
                                                            <circle cx="23" cy="23" r="19" fill="none" stroke="#e2e8f0" strokeWidth="4" />
                                                            <circle cx="23" cy="23" r="19" fill="none"
                                                                stroke={t.score >= 75 ? '#22c55e' : t.score >= 50 ? '#f59e0b' : '#ef4444'}
                                                                strokeWidth="4"
                                                                strokeDasharray={`${(t.score / 100) * 119.4} 119.4`}
                                                                strokeLinecap="round"
                                                                transform="rotate(-90 23 23)" />
                                                        </svg>
                                                        <span className="plan-perf-team-ring-pct">{t.score}%</span>
                                                    </div>
                                                    <div className="plan-perf-team-info">
                                                        <strong className="plan-perf-team-name">{t.name}</strong>
                                                        <span className="plan-perf-team-detail">
                                                            Open: {(t.item.targets.followers || 0) + (t.item.targets.reels || 0)}&nbsp;&nbsp;
                                                            Solved: {(t.item.achieved.followers || 0) + (t.item.achieved.reels || 0)}
                                                        </span>
                                                    </div>
                                                    <div className="plan-perf-team-actions">
                                                        {i === 0 && <span className="plan-perf-team-star">★</span>}
                                                        <button type="button" className="plan-perf-icon-btn" onClick={() => openTargetsModal(t.item)} title="Set targets">
                                                            <i className="fas fa-sliders-h" />
                                                        </button>
                                                        <button type="button" className="plan-perf-icon-btn plan-perf-icon-btn--del" onClick={() => deleteTeam(t.item.team.id)} title="Delete">
                                                            <i className="fas fa-trash" />
                                                        </button>
                                                    </div>
                                                </div>
                                            ))}
                                            {teamsWithoutData.map(t => (
                                                <div key={t.id} className="plan-perf-team-row plan-perf-team-row--dim">
                                                    <div className="plan-perf-team-ring-wrap">
                                                        <svg width="46" height="46" viewBox="0 0 46 46">
                                                            <circle cx="23" cy="23" r="19" fill="none" stroke="#e2e8f0" strokeWidth="4" />
                                                        </svg>
                                                        <span className="plan-perf-team-ring-pct">—</span>
                                                    </div>
                                                    <div className="plan-perf-team-info">
                                                        <strong className="plan-perf-team-name">{t.name}</strong>
                                                        <span className="plan-perf-team-detail plan-perf-team-detail--dim">No targets set</span>
                                                    </div>
                                                    <div className="plan-perf-team-actions">
                                                        <button type="button" className="plan-perf-icon-btn" onClick={() => openTargetsForTeam(t)} title="Set targets">
                                                            <i className="fas fa-sliders-h" />
                                                        </button>
                                                        <button type="button" className="plan-perf-icon-btn plan-perf-icon-btn--del" onClick={() => deleteTeam(t.id)} title="Delete">
                                                            <i className="fas fa-trash" />
                                                        </button>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                </div>

                                {/* ── ROW 2: Budget gauge + Stats + Trend ── */}
                                <div className="plan-perf-row plan-perf-row-2">

                                    {/* 4. Budget Utilization gauge */}
                                    <div className="plan-perf-card plan-perf-budget-card">
                                        <div className="plan-perf-card-header">
                                            <h4 className="plan-perf-card-title">Budget Utilization</h4>
                                        </div>
                                        <div className="plan-perf-radial-outer">
                                            <RadialBarChart width={140} height={140} cx={70} cy={70} innerRadius={38} outerRadius={62} data={budgetGaugeData} startAngle={90} endAngle={-270} barSize={16}>
                                                <RadialBar dataKey="value" cornerRadius={8} background={{ fill: '#e2e8f0' }} />
                                            </RadialBarChart>
                                            <div className="plan-perf-radial-center-label">
                                                <span className="plan-perf-radial-pct" style={{ color: budgetColor }}>{budgetPct}%</span>
                                            </div>
                                        </div>
                                        <p className="plan-perf-budget-range">
                                            Target Range: $0 – {formatCurrency(bf.weekly_ad_spend_target)}
                                        </p>
                                        <div className="plan-forecast-row plan-forecast-compact">
                                            <div className="plan-forecast-item">
                                                <span className="plan-forecast-label">Weekly Target</span>
                                                <span className="plan-forecast-value">{formatCurrency(bf.weekly_ad_spend_target)}</span>
                                            </div>
                                            <div className="plan-forecast-item">
                                                <span className="plan-forecast-label">Actual Spend</span>
                                                <span className="plan-forecast-value plan-forecast-value-primary">{formatCurrency(bf.actual_ad_spend)}</span>
                                            </div>
                                            <div className="plan-forecast-item">
                                                <span className="plan-forecast-label">Remaining</span>
                                                <span className="plan-forecast-value">{formatCurrency(bf.remaining_budget)}</span>
                                            </div>
                                            <div className="plan-forecast-item">
                                                <span className="plan-forecast-label">Forecast</span>
                                                <span className="plan-forecast-value">{formatCurrency(bf.forecast_ad_spend)}</span>
                                            </div>
                                        </div>
                                    </div>

                                    {/* 5. Stats cards + Weekly trend */}
                                    <div className="plan-perf-card plan-perf-stats-card">
                                        <div className="plan-perf-card-header">
                                            <h4 className="plan-perf-card-title">Team Overview</h4>
                                        </div>
                                        <div className="plan-perf-stats-grid">
                                            <div className="plan-perf-stat-box" style={{ '--stat-color': '#3b82f6' }}>
                                                <span className="plan-perf-stat-val">{teams.length}</span>
                                                <span className="plan-perf-stat-lbl">Active Teams</span>
                                            </div>
                                            <div className="plan-perf-stat-box" style={{ '--stat-color': '#22c55e' }}>
                                                <span className="plan-perf-stat-val">{targetsSet}</span>
                                                <span className="plan-perf-stat-lbl">Targets Set</span>
                                            </div>
                                            <div className="plan-perf-stat-box" style={{ '--stat-color': '#f59e0b' }}>
                                                <span className="plan-perf-stat-val">{goalsHit}</span>
                                                <span className="plan-perf-stat-lbl">Goals Hit</span>
                                            </div>
                                            <div className="plan-perf-stat-box" style={{ '--stat-color': '#ef4444' }}>
                                                <span className="plan-perf-stat-val">{goalsMissed}</span>
                                                <span className="plan-perf-stat-lbl">Goals Missed</span>
                                            </div>
                                        </div>

                                        <h5 className="plan-subsection-title plan-subsection-title--sm">
                                            <i className="fas fa-chart-line" /> Weekly Progress Trends
                                        </h5>
                                        {allTeamData.length === 0 ? (
                                            <p className="text-muted small">Set targets for teams to see progress trends.</p>
                                        ) : (() => {
                                            const colors = ['#ef4444', '#eab308', '#22c55e', '#2563eb', '#8b5cf6'];
                                            const weeks = ['W1', 'W2', 'W3', 'W4', 'W5', 'W6', 'W7'];
                                            const teamProgress = allTeamData.map(item => {
                                                const p = item.progressPct || {};
                                                const avg = ((p.followers || 0) + (p.ad_spend || 0) + (p.organic_leads || 0) + (p.organic_revenue || 0) + (p.stories || 0) + (p.reels || 0) + (p.posts || 0)) / 7;
                                                return { name: item.team.name, current: Math.min(100, Math.round(avg)) };
                                            });
                                            const chartData = weeks.map((w, i) => {
                                                const point = { week: w };
                                                const ratio = (i + 1) / 7;
                                                teamProgress.forEach(t => {
                                                    point[t.name] = i === 6 ? t.current : Math.min(100, Math.max(0, Math.round(ratio * t.current)));
                                                });
                                                return point;
                                            });
                                            return (
                                                <div className="plan-weekly-trend-chart">
                                                    <ResponsiveContainer width="100%" height={190}>
                                                        <LineChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 28 }}>
                                                            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                                                            <XAxis dataKey="week" tick={{ fontSize: 11 }} stroke="#64748b" />
                                                            <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} stroke="#64748b" tickFormatter={v => `${v}%`} />
                                                            <Tooltip formatter={value => [`${value}%`, 'Progress']} />
                                                            <Legend verticalAlign="bottom" height={28} wrapperStyle={{ fontSize: 11 }} />
                                                            {teamProgress.map((t, i) => (
                                                                <Line key={t.name} type="monotone" dataKey={t.name} stroke={colors[i % colors.length]} strokeWidth={2} dot={{ r: 2 }} />
                                                            ))}
                                                        </LineChart>
                                                    </ResponsiveContainer>
                                                </div>
                                            );
                                        })()}
                                    </div>
                                </div>

                                {/* ── Performance Details Table ── */}
                                <h3 className="plan-subsection-title plan-subsection-title--table">
                                    <i className="fas fa-table" /> Team Performance Details
                                </h3>
                                <div className="plan-performance-table-wrap">
                                    <table className="plan-performance-table">
                                        <thead>
                                            <tr>
                                                <th>Team</th>
                                                <th>Followers</th>
                                                <th>Ad Spend</th>
                                                <th>Organic Leads</th>
                                                <th>Organic Revenue</th>
                                                <th>Stories</th>
                                                <th>Reels</th>
                                                <th>Posts</th>
                                                <th>Actions</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {allTeamData.map(item => (
                                                <tr key={item.team.id}>
                                                    <td><strong>{item.team.name}</strong></td>
                                                    <td>{formatNum(item.achieved.followers)} / {formatNum(item.targets.followers)} <span className="text-muted">({item.progressPct.followers}%)</span></td>
                                                    <td>{formatCurrency(item.achieved.ad_spend)} / {formatCurrency(item.targets.ad_spend)} <span className="text-muted">({item.progressPct.ad_spend}%)</span></td>
                                                    <td>{item.achieved.organic_leads} / {item.targets.organic_leads} <span className="text-muted">({item.progressPct.organic_leads}%)</span></td>
                                                    <td>{formatCurrency(item.achieved.organic_revenue)} / {formatCurrency(item.targets.organic_revenue)} <span className="text-muted">({item.progressPct.organic_revenue}%)</span></td>
                                                    <td>{item.achieved.stories} / {item.targets.stories} <span className="text-muted">({item.progressPct.stories}%)</span></td>
                                                    <td>{item.achieved.reels} / {item.targets.reels} <span className="text-muted">({item.progressPct.reels}%)</span></td>
                                                    <td>{item.achieved.posts} / {item.targets.posts} <span className="text-muted">({item.progressPct.posts}%)</span></td>
                                                    <td className="plan-table-actions-col">
                                                        <button type="button" className="plan-team-card-btn plan-team-card-btn-edit" onClick={() => openTargetsModal(item)}>Set targets</button>
                                                        <button type="button" className="plan-team-card-btn plan-team-card-btn-del" onClick={() => deleteTeam(item.team.id)}>Delete</button>
                                                    </td>
                                                </tr>
                                            ))}
                                            {teamsWithoutData.map(t => (
                                                <tr key={t.id}>
                                                    <td><strong>{t.name}</strong></td>
                                                    <td colSpan={7} className="text-muted small">No targets set for this week</td>
                                                    <td className="plan-table-actions-col">
                                                        <button type="button" className="plan-team-card-btn plan-team-card-btn-edit" onClick={() => openTargetsForTeam(t)}>Set targets</button>
                                                        <button type="button" className="plan-team-card-btn plan-team-card-btn-del" onClick={() => deleteTeam(t.id)}>Delete</button>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                    {allTeamData.length === 0 && teams.length === 0 && (
                                        <p className="text-muted small mb-0">Set weekly targets for teams to see performance data here.</p>
                                    )}
                                </div>
                            </>
                        );
                    })()}
                </section>

                {/* Add Team Modal */}
                {showAddTeamModal && (
                    <div className="modal show d-block plan-modal-backdrop" tabIndex="-1" onClick={() => { setShowAddTeamModal(false); setAddTeamError(null); }}>
                        <div className="modal-dialog modal-dialog-centered" onClick={e => e.stopPropagation()}>
                            <div className="modal-content rounded-3">
                                <form onSubmit={saveNewTeam}>
                                    <div className="modal-header">
                                        <h5 className="modal-title">Add team</h5>
                                        <button type="button" className="btn-close" onClick={() => { setShowAddTeamModal(false); setAddTeamError(null); }} />
                                    </div>
                                    <div className="modal-body">
                                        {addTeamError && (
                                            <div className="alert alert-danger py-2 mb-3" role="alert">
                                                <strong>Couldn&apos;t add team</strong>
                                                <p className="mb-1 mt-1 small">{addTeamError}</p>
                                                {(addTeamError.includes('plan_teams') || addTeamError.includes('schema cache')) && (
                                                    <div className="mt-2 pt-2 border-top border-danger border-opacity-25">
                                                        <strong className="small">How to fix:</strong>
                                                        <ol className="small mb-0 ps-3 mt-1">
                                                            <li>Open Supabase Dashboard → <strong>SQL Editor</strong> → New query.</li>
                                                            <li>Copy all of <code>server/migrations/plan-tables.sql</code>, paste, and click <strong>Run</strong>.</li>
                                                            <li>Go to <strong>Settings → API</strong>, scroll to Schema, click <strong>Reload schema</strong>.</li>
                                                            <li>Wait 30 seconds, then click <strong>Try again</strong> below.</li>
                                                        </ol>
                                                        <button type="button" className="btn btn-sm btn-outline-danger mt-2" onClick={() => { setAddTeamError(null); saveNewTeam(); }} disabled={savingTeam || !(newTeam.name || '').trim()}>
                                                            {savingTeam ? 'Saving…' : 'Try again'}
                                                        </button>
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                        <div className="mb-3">
                                            <label className="form-label">Team name</label>
                                            <input type="text" className="form-control" placeholder="e.g. Team 1" value={newTeam.name} onChange={e => setNewTeam(prev => ({ ...prev, name: e.target.value }))} autoFocus />
                                        </div>
                                        <div className="mb-3">
                                            <label className="form-label">Page (optional – for followers & content counts)</label>
                                            <select className="form-select" value={newTeam.page_id} onChange={e => setNewTeam(prev => ({ ...prev, page_id: e.target.value }))}>
                                                <option value="">— Select page —</option>
                                                {pages.map(p => <option key={p.id} value={p.id}>{p.name || p.id}</option>)}
                                            </select>
                                        </div>
                                    </div>
                                    <div className="modal-footer">
                                        <button type="button" className="btn btn-secondary" onClick={() => { setShowAddTeamModal(false); setAddTeamError(null); }}>Cancel</button>
                                        <button type="submit" className="btn btn-primary" disabled={savingTeam || !(newTeam.name || '').trim()}>
                                            {savingTeam ? 'Saving…' : 'Add team'}
                                        </button>
                                    </div>
                                </form>
                            </div>
                        </div>
                    </div>
                )}

                {/* Set Targets Modal */}
                {showTargetsModal && (
                    <div className="modal show d-block plan-modal-backdrop" tabIndex="-1">
                        <div className="modal-dialog modal-dialog-centered">
                            <div className="modal-content rounded-3">
                                <div className="modal-header">
                                    <h5 className="modal-title">Set weekly targets</h5>
                                    <button type="button" className="btn-close" onClick={() => setShowTargetsModal(false)} />
                                </div>
                                <div className="modal-body">
                                    <p className="text-muted small mb-3">Week starting {weekStart}. Enter targets for this team.</p>
                                    <div className="row g-2">
                                        <div className="col-6">
                                            <label className="form-label small">Followers</label>
                                            <input type="number" className="form-control form-control-sm" min="0" value={targetsForm.target_followers} onChange={e => setTargetsForm(prev => ({ ...prev, target_followers: e.target.value }))} />
                                        </div>
                                        <div className="col-6">
                                            <label className="form-label small">Ad Spend</label>
                                            <input type="number" className="form-control form-control-sm" min="0" step="0.01" value={targetsForm.target_ad_spend} onChange={e => setTargetsForm(prev => ({ ...prev, target_ad_spend: e.target.value }))} />
                                        </div>
                                        <div className="col-6">
                                            <label className="form-label small">Organic Leads</label>
                                            <input type="number" className="form-control form-control-sm" min="0" value={targetsForm.target_organic_leads} onChange={e => setTargetsForm(prev => ({ ...prev, target_organic_leads: e.target.value }))} />
                                        </div>
                                        <div className="col-6">
                                            <label className="form-label small">Organic Revenue</label>
                                            <input type="number" className="form-control form-control-sm" min="0" step="0.01" value={targetsForm.target_organic_revenue} onChange={e => setTargetsForm(prev => ({ ...prev, target_organic_revenue: e.target.value }))} />
                                        </div>
                                        <div className="col-4">
                                            <label className="form-label small">Stories</label>
                                            <input type="number" className="form-control form-control-sm" min="0" value={targetsForm.target_stories} onChange={e => setTargetsForm(prev => ({ ...prev, target_stories: e.target.value }))} />
                                        </div>
                                        <div className="col-4">
                                            <label className="form-label small">Reels</label>
                                            <input type="number" className="form-control form-control-sm" min="0" value={targetsForm.target_reels} onChange={e => setTargetsForm(prev => ({ ...prev, target_reels: e.target.value }))} />
                                        </div>
                                        <div className="col-4">
                                            <label className="form-label small">Posts</label>
                                            <input type="number" className="form-control form-control-sm" min="0" value={targetsForm.target_posts} onChange={e => setTargetsForm(prev => ({ ...prev, target_posts: e.target.value }))} />
                                        </div>
                                    </div>
                                </div>
                                <div className="modal-footer">
                                    <button type="button" className="btn btn-secondary" onClick={() => setShowTargetsModal(false)}>Cancel</button>
                                    <button type="button" className="btn btn-primary" onClick={saveTargets} disabled={savingTargets}>{savingTargets ? 'Saving…' : 'Save targets'}</button>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

            </div>
        </div>
    );
}
