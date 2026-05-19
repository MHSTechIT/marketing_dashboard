import React, { useState, useEffect, useCallback } from 'react';
import { motion, Reorder, AnimatePresence } from 'framer-motion';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import './Plan.css';

const API_BASE = process.env.REACT_APP_API_BASE || 'http://localhost:4000';

function getAuthHeaders() {
    const token = localStorage.getItem('token');
    return token ? { Authorization: `Bearer ${token}` } : {};
}

export default function Plan() {
    // --- STATE ---
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
    const [filters, setFilters] = useState({
        startDate: '',
        endDate: ''
    });

    // Team Performance & Effort & Goals state
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

    // Free Webiner hero: 3 duplicated sections, each with Budget, Leads, Unique Leads
    const defaultSectionMetrics = () => ({
        freeWebinerBudget: { target: '', current: '' },
        freeWebinerLeads: { target: '', current: '' },
        uniqueLeads: { target: '', current: '' },
    });
    const [webinerSections, setWebinerSections] = useState([
        defaultSectionMetrics(),
        defaultSectionMetrics(),
        defaultSectionMetrics(),
        defaultSectionMetrics(),
    ]);

    // Helper: Calculate Date Range (Mon-Sun)
    const getRange = (type) => {
        const today = new Date();
        const currentDay = today.getDay(); // 0(Sun) - 6(Sat)
        // Calculate days to subtract to get to Monday (1)
        // If Sunday(0), subtract 6. If Mon(1), subtract 0. If Tue(2), subtract 1.
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
        end.setDate(start.getDate() + 6); // +6 days for Mon->Sun

        const formatDate = (d) => {
            const yyyy = d.getFullYear();
            const mm = String(d.getMonth() + 1).padStart(2, '0');
            const dd = String(d.getDate()).padStart(2, '0');
            return `${yyyy}-${mm}-${dd}`;
        };

        const formatLabel = (d) => {
            return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        };

        return {
            label: type === 'this_week' ? 'This Week' : type === 'last_week' ? 'Last Week' : 'Next Week',
            displayRange: `${formatLabel(start)} - ${formatLabel(end)}`,
            startDate: formatDate(start),
            endDate: formatDate(end)
        };
    };

    // Initialize with This Week
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
        setFilters(prev => ({
            ...prev,
            [name]: value
        }));
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

    useEffect(() => {
        fetchTeams();
    }, [fetchTeams]);

    useEffect(() => {
        fetchPages();
    }, [fetchPages]);

    useEffect(() => {
        fetchAggregates();
    }, [fetchAggregates]);

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
        setTargetsForm({
            target_followers: '', target_ad_spend: '', target_organic_leads: '', target_organic_revenue: '',
            target_stories: '', target_reels: '', target_posts: ''
        });
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
                body: JSON.stringify({
                    name,
                    page_id: newTeam.page_id || null
                })
            });
            const json = await res.json().catch(() => ({}));
            if (!res.ok) {
                throw new Error(json.error || res.statusText || 'Failed to add team');
            }
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
    const formatCurrency = (n) => (n == null || n === '' ? '0' : `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`);

    // Animation Variants (micro-animations for task list)
    const itemVariants = {
        hidden: { opacity: 0, y: 20 },
        visible: (i) => ({
            opacity: 1,
            y: 0,
            transition: { delay: i * 0.06, duration: 0.35, ease: [0.25, 0.46, 0.45, 0.94] }
        })
    };
    const progressBarTransition = { type: 'spring', stiffness: 50, damping: 20 };

    const isSchemaError = aggregatesError && (aggregatesError.includes('plan_teams') || aggregatesError.includes('schema cache') || aggregatesError.includes('Could not find'));

    return (
        <div className="plan-page">

            {/* --- STICKY HEADER: Plan title (image-style card) + Date range --- */}
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

                {/* --- HERO: Free Webiner manual targets + goal bars (duplicated 4 times) --- */}
                {(() => {
                    const heroTitles = [
                        'Free Webiner Budget',
                        'Paid Webiner Budget',
                        'YT Webiner Budget',
                        'Direact-Walking Webiner Budget',
                    ];
                    return [0, 1, 2, 3].map((sectionIndex) => {
                        const sectionTitle = heroTitles[sectionIndex];
                        const budgetLabel = sectionTitle;
                        const leadsLabel = sectionTitle.replace(/ Budget$/, ' Leads');
                        const metricConfig = [
                            { key: 'freeWebinerBudget', label: budgetLabel },
                            { key: 'freeWebinerLeads', label: leadsLabel },
                            { key: 'uniqueLeads', label: 'Unique Leads' },
                        ];
                        return (
                    <section key={sectionIndex} className="plan-hero plan-card">
                        <h2 className="plan-hero-title">{sectionIndex + 1}. {sectionTitle}</h2>
                        <p className="plan-hero-tagline">Maximize your audience reach by hitting your targets!</p>
                        <div className="plan-hero-metrics">
                            {metricConfig.map(({ key, label }) => {
                                const webinerMetrics = webinerSections[sectionIndex];
                                const m = webinerMetrics[key];
                                const target = Number(m.target) || 0;
                                const current = Number(m.current) || 0;
                                const pct = target > 0 ? Math.min(100, (current / target) * 100) : 0;
                                const inputId = `plan-target-${sectionIndex}-${key}`;
                                return (
                                    <div key={key} className="plan-hero-metric-row">
                                        <h3 className="plan-hero-metric-label">{label}</h3>
                                        <div className="plan-hero-metric-inputs">
                                            <div className="plan-hero-metric-field" onClick={(e) => e.target.closest('.plan-hero-metric-field')?.querySelector('input')?.focus()}>
                                                <label className="plan-hero-metric-field-label" htmlFor={inputId}>Set weekly target</label>
                                                <input
                                                    id={inputId}
                                                    type="number"
                                                    className="form-control form-control-sm"
                                                    min="0"
                                                    placeholder="Target"
                                                    value={m.target}
                                                    onChange={(e) => setWebinerSections(prev => {
                                                        const next = prev.map((sec, i) => i === sectionIndex ? { ...sec, [key]: { ...sec[key], target: e.target.value } } : sec);
                                                        return next;
                                                    })}
                                                    autoComplete="off"
                                                />
                                            </div>
                                        </div>
                                        <div className="plan-hero-progress-wrap plan-hero-metric-bar">
                                            <div className="plan-hero-progress-track">
                                                <motion.div className="plan-hero-progress-fill" initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ duration: 0.5, ease: 'easeOut' }} />
                                            </div>
                                        </div>
                                        <div className="plan-hero-metric-stat">{current} of {target || 0}</div>
                                    </div>
                                );
                            })}
                        </div>
                    </section>
                        );
                    });
                })()}

                {/* --- Webiner Budget graphs in 2x2 grid (above Team Performance) --- */}
                <div className="plan-webiner-graphs-grid">
                {(() => {
                    const webinerGraphTitles = [
                        'Free Webiner Budget',
                        'Paid Webiner Budget',
                        'YT Webiner Budget',
                        'Direact-Walking Webiner Budget',
                    ];
                    const weekLabels = ['Week 1', 'Week 2', 'Week 3', 'Week 4'];
                    return webinerGraphTitles.map((title, sectionIndex) => {
                        const sec = webinerSections[sectionIndex] || defaultSectionMetrics();
                        const budgetCurrent = Number(sec.freeWebinerBudget?.current) || 0;
                        const leadsCurrent = Number(sec.uniqueLeads?.current) || 0;
                        const budgetTarget = Number(sec.freeWebinerBudget?.target) || 0;
                        const leadsTarget = Number(sec.uniqueLeads?.target) || 0;
                        const chartData = weekLabels.map((week, i) => {
                            const ratio = i < 3 ? (i + 1) / 4 : 1;
                            return {
                                week,
                                webinerBudget: Math.round(budgetCurrent * ratio),
                                uniqueLeads: Math.round(leadsCurrent * ratio),
                                targetBudget: budgetTarget,
                                targetLeads: leadsTarget,
                            };
                        });
                        const yMax = Math.max(budgetCurrent, leadsCurrent, budgetTarget, leadsTarget, 1);
                        return (
                            <section key={sectionIndex} className="plan-card plan-webiner-graph-section">
                                <h3 className="plan-subsection-title"><i className="fas fa-chart-line" /> {title}</h3>
                                <div className="plan-weekly-trend-chart">
                                    <ResponsiveContainer width="100%" height={260}>
                                        <LineChart data={chartData} margin={{ top: 10, right: 20, left: 0, bottom: 50 }}>
                                            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                                            <XAxis dataKey="week" tick={{ fontSize: 12 }} stroke="#64748b" />
                                            <YAxis tick={{ fontSize: 12 }} stroke="#64748b" domain={[0, yMax]} />
                                            <Tooltip labelFormatter={(label) => label} />
                                            <Legend verticalAlign="bottom" height={36} />
                                            <Line type="monotone" dataKey="webinerBudget" name="Webiner Budget" stroke="#1877f2" strokeWidth={2} dot={{ r: 3 }} />
                                            <Line type="monotone" dataKey="uniqueLeads" name="Unique Leads" stroke="#22c55e" strokeWidth={2} dot={{ r: 3 }} />
                                            <Line type="monotone" dataKey="targetBudget" name="Budget target" stroke="#1877f2" strokeWidth={1.5} strokeDasharray="5 5" strokeOpacity={0.8} dot={false} />
                                            <Line type="monotone" dataKey="targetLeads" name="Leads target" stroke="#22c55e" strokeWidth={1.5} strokeDasharray="5 5" strokeOpacity={0.8} dot={false} />
                                        </LineChart>
                                    </ResponsiveContainer>
                                </div>
                            </section>
                        );
                    });
                })()}
                </div>

                {/* --- PRIORITIZE YOUR TASKS --- */}
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
                                                <motion.div
                                                    className="plan-task-progress-fill"
                                                    initial={{ width: 0 }}
                                                    animate={{ width: `${pct}%` }}
                                                    transition={progressBarTransition}
                                                />
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

                {/* --- STICKY HEADER: Plan title (image-style card) + Date range --- */}
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

                {/* --- TEAM PERFORMANCE & EFFORT & GOALS (table unchanged) --- */}
                <section className="plan-team-section plan-card plan-section-2">
                    <div className="plan-team-section-head">
                        <h2 className="plan-team-section-title">Team Performance & Effort & Goals</h2>
                        <button type="button" className="plan-btn-add-team" onClick={() => setShowAddTeamModal(true)}><i className="fas fa-plus" /> Add team</button>
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
                    {!aggregatesError && (aggregates.data.length > 0 || teams.length > 0 || aggregatesLoading) && (
                        <>
                            {aggregatesLoading && (
                                <div className="plan-loading-inline">
                                    <span className="spinner-border spinner-border-sm text-primary me-2" role="status" />
                                    <span className="text-muted small">Loading live data from Meta…</span>
                                </div>
                            )}
                            <h3 className="plan-subsection-title"><i className="fas fa-users" /> Team list</h3>
                            <div className="plan-team-list-table-wrap">
                                <table className="plan-team-list-table">
                                    <thead>
                                        <tr>
                                            <th>Team name</th>
                                            <th>Page</th>
                                            <th className="plan-table-actions-col">Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {teams.map((t) => {
                                            const pageName = (pages.find((p) => p.id === t.page_id) || {}).name || t.page_id || '—';
                                            const aggItem = (aggregates.data || []).find((a) => a.team.id === t.id);
                                            return (
                                                <tr key={t.id}>
                                                    <td><strong>{t.name}</strong></td>
                                                    <td>{pageName}</td>
                                                    <td className="plan-table-actions-col">
                                                        <button type="button" className="plan-team-card-btn plan-team-card-btn-edit" onClick={() => aggItem ? openTargetsModal(aggItem) : openTargetsForTeam(t)} title="Set targets">Set targets</button>
                                                        <button type="button" className="plan-team-card-btn plan-team-card-btn-del" onClick={() => deleteTeam(t.id)} title="Remove team">Delete</button>
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>

                            <h3 className="plan-subsection-title"><i className="fas fa-chart-line" /> Weekly Progress Trends</h3>
                            {(() => {
                                const data = aggregates.data || [];
                                if (data.length === 0) return <p className="text-muted small">Set targets for teams to see progress trends.</p>;
                                const colors = ['#ef4444', '#eab308', '#22c55e', '#2563eb', '#8b5cf6'];
                                const weeks = ['W1', 'W2', 'W3', 'W4', 'W5', 'W6', 'W7'];
                                const teamProgress = data.map((item) => {
                                    const p = item.progressPct || {};
                                    const avg = (p.followers + p.ad_spend + p.organic_leads + p.organic_revenue + p.stories + p.reels + p.posts) / 7;
                                    return { name: item.team.name, current: Math.min(100, Math.round(avg)) };
                                });
                                const chartData = weeks.map((w, i) => {
                                    const point = { week: w };
                                    const ratio = (i + 1) / 7;
                                    teamProgress.forEach((t) => {
                                        point[t.name] = i === 6 ? t.current : Math.min(100, Math.max(0, Math.round(ratio * t.current)));
                                    });
                                    return point;
                                });
                                return (
                                    <div className="plan-weekly-trend-chart">
                                        <ResponsiveContainer width="100%" height={280}>
                                            <LineChart data={chartData} margin={{ top: 10, right: 20, left: 0, bottom: 50 }}>
                                                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                                                <XAxis dataKey="week" tick={{ fontSize: 12 }} stroke="#64748b" />
                                                <YAxis domain={[0, 100]} tick={{ fontSize: 12 }} stroke="#64748b" tickFormatter={(v) => `${v}%`} />
                                                <Tooltip formatter={(value) => [`${value}%`, 'Progress']} labelFormatter={(label) => `Week ${label}`} />
                                                <Legend verticalAlign="bottom" height={36} />
                                                {teamProgress.map((t, i) => (
                                                    <Line key={t.name} type="monotone" dataKey={t.name} stroke={colors[i % colors.length]} strokeWidth={2} dot={{ r: 3 }} name={t.name} />
                                                ))}
                                            </LineChart>
                                        </ResponsiveContainer>
                                    </div>
                                );
                            })()}

                            <h3 className="plan-subsection-title"><i className="fas fa-table" /> Team Performance & Effort (table)</h3>
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
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {(aggregates.data || []).map((item) => (
                                            <tr key={item.team.id}>
                                                <td><strong>{item.team.name}</strong></td>
                                                <td>{formatNum(item.achieved.followers)} / {formatNum(item.targets.followers)} <span className="text-muted">({item.progressPct.followers}%)</span></td>
                                                <td>{formatCurrency(item.achieved.ad_spend)} / {formatCurrency(item.targets.ad_spend)} <span className="text-muted">({item.progressPct.ad_spend}%)</span></td>
                                                <td>{item.achieved.organic_leads} / {item.targets.organic_leads} <span className="text-muted">({item.progressPct.organic_leads}%)</span></td>
                                                <td>{formatCurrency(item.achieved.organic_revenue)} / {formatCurrency(item.targets.organic_revenue)} <span className="text-muted">({item.progressPct.organic_revenue}%)</span></td>
                                                <td>{item.achieved.stories} / {item.targets.stories} <span className="text-muted">({item.progressPct.stories}%)</span></td>
                                                <td>{item.achieved.reels} / {item.targets.reels} <span className="text-muted">({item.progressPct.reels}%)</span></td>
                                                <td>{item.achieved.posts} / {item.targets.posts} <span className="text-muted">({item.progressPct.posts}%)</span></td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                                {(!aggregates.data || aggregates.data.length === 0) && (
                                    <p className="text-muted small mb-0">Set weekly targets for teams to see performance data here.</p>
                                )}
                            </div>

                            <h3 className="plan-subsection-title"><i className="fas fa-wallet" /> Ad Spend Budget Forecast</h3>
                            <div className="plan-forecast-row">
                                <div className="plan-forecast-item">
                                    <span className="plan-forecast-label">Weekly Ad Spend Target</span>
                                    <span className="plan-forecast-value">{formatCurrency(aggregates.budgetForecast.weekly_ad_spend_target)}</span>
                                </div>
                                <div className="plan-forecast-item">
                                    <span className="plan-forecast-label">Actual Ad Spend</span>
                                    <span className="plan-forecast-value plan-forecast-value-primary">{formatCurrency(aggregates.budgetForecast.actual_ad_spend)}</span>
                                </div>
                                <div className="plan-forecast-item">
                                    <span className="plan-forecast-label">Remaining Budget</span>
                                    <span className="plan-forecast-value">{formatCurrency(aggregates.budgetForecast.remaining_budget)}</span>
                                </div>
                                <div className="plan-forecast-item">
                                    <span className="plan-forecast-label">Budget Forecast</span>
                                    <span className="plan-forecast-value">{formatCurrency(aggregates.budgetForecast.forecast_ad_spend)}</span>
                                </div>
                            </div>
                        </>
                    )}
                </section>

            {/* Add Team Modal */}
            {showAddTeamModal && (
                <div className="modal show d-block plan-modal-backdrop" tabIndex="-1" onClick={() => { setShowAddTeamModal(false); setAddTeamError(null); }}>
                    <div className="modal-dialog modal-dialog-centered" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-content rounded-3">
                            <form onSubmit={saveNewTeam}>
                                <div className="modal-header">
                                    <h5 className="modal-title">Add team</h5>
                                    <button type="button" className="btn-close" onClick={() => { setShowAddTeamModal(false); setAddTeamError(null); }} aria-label="Close"></button>
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
                                                        <li>Copy all of <code>server/migrations/plan-tables.sql</code> from this project, paste, and click <strong>Run</strong>.</li>
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
                                        <input type="text" className="form-control" placeholder="e.g. Team 1" value={newTeam.name} onChange={(e) => setNewTeam(prev => ({ ...prev, name: e.target.value }))} autoFocus />
                                    </div>
                                    <div className="mb-3">
                                        <label className="form-label">Page (optional – for followers & content counts)</label>
                                        <select className="form-select" value={newTeam.page_id} onChange={(e) => setNewTeam(prev => ({ ...prev, page_id: e.target.value }))}>
                                            <option value="">— Select page —</option>
                                            {pages.map((p) => (
                                                <option key={p.id} value={p.id}>{p.name || p.id}</option>
                                            ))}
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
                                <button type="button" className="btn-close" onClick={() => setShowTargetsModal(false)}></button>
                            </div>
                            <div className="modal-body">
                                <p className="text-muted small mb-3">Week starting {weekStart}. Enter targets for this team.</p>
                                <div className="row g-2">
                                    <div className="col-6">
                                        <label className="form-label small">Followers</label>
                                        <input type="number" className="form-control form-control-sm" min="0" value={targetsForm.target_followers} onChange={(e) => setTargetsForm(prev => ({ ...prev, target_followers: e.target.value }))} />
                                    </div>
                                    <div className="col-6">
                                        <label className="form-label small">Ad Spend</label>
                                        <input type="number" className="form-control form-control-sm" min="0" step="0.01" value={targetsForm.target_ad_spend} onChange={(e) => setTargetsForm(prev => ({ ...prev, target_ad_spend: e.target.value }))} />
                                    </div>
                                    <div className="col-6">
                                        <label className="form-label small">Organic Leads</label>
                                        <input type="number" className="form-control form-control-sm" min="0" value={targetsForm.target_organic_leads} onChange={(e) => setTargetsForm(prev => ({ ...prev, target_organic_leads: e.target.value }))} />
                                    </div>
                                    <div className="col-6">
                                        <label className="form-label small">Organic Revenue</label>
                                        <input type="number" className="form-control form-control-sm" min="0" step="0.01" value={targetsForm.target_organic_revenue} onChange={(e) => setTargetsForm(prev => ({ ...prev, target_organic_revenue: e.target.value }))} />
                                    </div>
                                    <div className="col-4">
                                        <label className="form-label small">Stories</label>
                                        <input type="number" className="form-control form-control-sm" min="0" value={targetsForm.target_stories} onChange={(e) => setTargetsForm(prev => ({ ...prev, target_stories: e.target.value }))} />
                                    </div>
                                    <div className="col-4">
                                        <label className="form-label small">Reels</label>
                                        <input type="number" className="form-control form-control-sm" min="0" value={targetsForm.target_reels} onChange={(e) => setTargetsForm(prev => ({ ...prev, target_reels: e.target.value }))} />
                                    </div>
                                    <div className="col-4">
                                        <label className="form-label small">Posts</label>
                                        <input type="number" className="form-control form-control-sm" min="0" value={targetsForm.target_posts} onChange={(e) => setTargetsForm(prev => ({ ...prev, target_posts: e.target.value }))} />
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
