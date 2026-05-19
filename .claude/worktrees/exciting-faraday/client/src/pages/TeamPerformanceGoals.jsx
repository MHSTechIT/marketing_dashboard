import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts';
import './TeamPerformanceGoals.css';

const API_BASE = process.env.REACT_APP_API_BASE || 'http://localhost:4000';

function getAuthHeaders() {
  const token = localStorage.getItem('token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function getRange(type) {
  const today = new Date();
  const currentDay = today.getDay();
  const diffToMonday = currentDay === 0 ? -6 : 1 - currentDay;
  const weekStart = new Date(today);
  weekStart.setDate(today.getDate() + diffToMonday);
  weekStart.setHours(0, 0, 0, 0);
  let start = new Date(weekStart);
  if (type === 'last_week') start.setDate(weekStart.getDate() - 7);
  if (type === 'next_week') start.setDate(weekStart.getDate() + 7);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  const formatDate = (d) => d.toISOString().slice(0, 10);
  const formatLabel = (d) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return {
    displayRange: `${formatLabel(start)} - ${formatLabel(end)}`,
    startDate: formatDate(start),
    endDate: formatDate(end),
  };
}

function CircularProgress({ value, target, label, color }) {
  const pct = target > 0 ? Math.min(100, Math.round((value / target) * 100)) : 0;
  const r = 42;
  const circ = 2 * Math.PI * r;
  const strokeDash = (pct / 100) * circ;
  return (
    <div className="tpg-circular-progress" title={`${value} / ${target} (${pct}%)`}>
      <svg width="100" height="100" viewBox="0 0 100 100">
        <circle className="tpg-circle-bg" cx="50" cy="50" r={r} fill="none" strokeWidth="8" />
        <circle
          className="tpg-circle-fill"
          cx="50"
          cy="50"
          r={r}
          fill="none"
          strokeWidth="8"
          strokeDasharray={`${strokeDash} ${circ}`}
          stroke={color || '#1877f2'}
          transform="rotate(-90 50 50)"
        />
      </svg>
      <div className="tpg-circular-label">
        <span className="tpg-circular-value">{value}/{target}</span>
        <span className="tpg-circular-pct">{pct}%</span>
        <span className="tpg-circular-name">{label}</span>
      </div>
    </div>
  );
}

export default function TeamPerformanceGoals() {
  const [teams, setTeams] = useState([]);
  const [selectedTeamId, setSelectedTeamId] = useState(null);
  const [platform, setPlatform] = useState('instagram');
  const [weekPreset, setWeekPreset] = useState('this_week');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [aggregates, setAggregates] = useState({ data: [], budgetForecast: {} });
  const [dailySpend, setDailySpend] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showTargetsModal, setShowTargetsModal] = useState(false);
  const [targetsForm, setTargetsForm] = useState({});
  const [savingTargets, setSavingTargets] = useState(false);
  const [editingTeamId, setEditingTeamId] = useState(null);

  const weekRange = useMemo(() => {
    if (weekPreset === 'custom' && customStart && customEnd) {
      return { startDate: customStart, endDate: customEnd, displayRange: `Custom: ${customStart} - ${customEnd}` };
    }
    const r = getRange(weekPreset);
    return { ...r, startDate: r.startDate, endDate: r.endDate };
  }, [weekPreset, customStart, customEnd]);

  const weekStart = weekRange.startDate || null;

  const fetchTeams = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/plan/teams`, { headers: getAuthHeaders() });
      if (!res.ok) throw new Error('Failed to load teams');
      const json = await res.json();
      setTeams(json.data || []);
    } catch (e) {
      console.error(e);
      setTeams([]);
    }
  }, []);

  const fetchAggregates = useCallback(async () => {
    if (!weekStart || !/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) {
      setAggregates({ data: [], budgetForecast: {} });
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/plan/aggregates?week_start=${encodeURIComponent(weekStart)}`, { headers: getAuthHeaders() });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.statusText);
      const json = await res.json();
      setAggregates({ data: json.data || [], budgetForecast: json.budgetForecast || {} });
    } catch (e) {
      setError(e.message || 'Failed to load data');
      setAggregates({ data: [], budgetForecast: {} });
    } finally {
      setLoading(false);
    }
  }, [weekStart]);

  const fetchDailySpend = useCallback(async () => {
    if (!weekStart) {
      setDailySpend([]);
      return;
    }
    try {
      const params = new URLSearchParams({ week_start: weekStart });
      if (selectedTeamId) params.set('team_id', selectedTeamId);
      const res = await fetch(`${API_BASE}/api/plan/daily-spend?${params}`, { headers: getAuthHeaders() });
      if (!res.ok) return;
      const json = await res.json();
      setDailySpend(Array.isArray(json.data) ? json.data : []);
    } catch (e) {
      setDailySpend([]);
    }
  }, [weekStart, selectedTeamId]);

  useEffect(() => { fetchTeams(); }, [fetchTeams]);
  useEffect(() => { fetchAggregates(); }, [fetchAggregates]);
  useEffect(() => { fetchDailySpend(); }, [fetchDailySpend]);

  const filteredData = useMemo(() => {
    const list = aggregates.data || [];
    if (!selectedTeamId) return list;
    return list.filter((item) => item.team.id === selectedTeamId);
  }, [aggregates.data, selectedTeamId]);

  const activeItem = useMemo(() => {
    if (filteredData.length === 1) return filteredData[0];
    if (selectedTeamId && filteredData.length > 0) return filteredData[0];
    if (filteredData.length > 0) return filteredData[0];
    return null;
  }, [filteredData, selectedTeamId]);

  const summedForAll = useMemo(() => {
    if (filteredData.length <= 1) return activeItem;
    const zero = { followers: 0, ad_spend: 0, organic_leads: 0, organic_revenue: 0, stories: 0, reels: 0, posts: 0 };
    const acc = {
      team: { id: null, name: 'All teams' },
      targets: { ...zero },
      achieved: { ...zero },
      remaining: { ...zero },
      progressPct: {},
    };
    filteredData.forEach((item) => {
      acc.targets.followers += item.targets?.followers || 0;
      acc.targets.ad_spend += item.targets?.ad_spend || 0;
      acc.targets.organic_leads += item.targets?.organic_leads || 0;
      acc.targets.organic_revenue += item.targets?.organic_revenue || 0;
      acc.targets.stories += item.targets?.stories || 0;
      acc.targets.reels += item.targets?.reels || 0;
      acc.targets.posts += item.targets?.posts || 0;
      acc.achieved.followers += item.achieved?.followers || 0;
      acc.achieved.ad_spend += item.achieved?.ad_spend || 0;
      acc.achieved.organic_leads += item.achieved?.organic_leads || 0;
      acc.achieved.organic_revenue += item.achieved?.organic_revenue || 0;
      acc.achieved.stories += item.achieved?.stories || 0;
      acc.achieved.reels += item.achieved?.reels || 0;
      acc.achieved.posts += item.achieved?.posts || 0;
    });
    const pct = (a, t) => (t > 0 ? Math.min(100, Math.round((a / t) * 100)) : 0);
    acc.remaining.followers = Math.max(0, acc.targets.followers - acc.achieved.followers);
    acc.remaining.ad_spend = Math.max(0, acc.targets.ad_spend - acc.achieved.ad_spend);
    acc.remaining.organic_leads = Math.max(0, acc.targets.organic_leads - acc.achieved.organic_leads);
    acc.remaining.organic_revenue = Math.max(0, acc.targets.organic_revenue - acc.achieved.organic_revenue);
    acc.remaining.stories = Math.max(0, acc.targets.stories - acc.achieved.stories);
    acc.remaining.reels = Math.max(0, acc.targets.reels - acc.achieved.reels);
    acc.remaining.posts = Math.max(0, acc.targets.posts - acc.achieved.posts);
    acc.progressPct = {
      followers: pct(acc.achieved.followers, acc.targets.followers),
      ad_spend: pct(acc.achieved.ad_spend, acc.targets.ad_spend),
      organic_leads: pct(acc.achieved.organic_leads, acc.targets.organic_leads),
      organic_revenue: pct(acc.achieved.organic_revenue, acc.targets.organic_revenue),
      stories: pct(acc.achieved.stories, acc.targets.stories),
      reels: pct(acc.achieved.reels, acc.targets.reels),
      posts: pct(acc.achieved.posts, acc.targets.posts),
    };
    return acc;
  }, [filteredData, activeItem]);

  const displayItem = summedForAll || activeItem;

  const burnRatePct = useMemo(() => {
    const f = aggregates.budgetForecast || {};
    const target = Number(f.weekly_ad_spend_target) || 0;
    const actual = Number(f.actual_ad_spend) || 0;
    if (target <= 0) return 0;
    return Math.min(100, Math.round((actual / target) * 100));
  }, [aggregates.budgetForecast]);

  const chartDataFollowers = useMemo(() => {
    if (!displayItem) return [];
    const achieved = displayItem.achieved?.followers || 0;
    const target = displayItem.targets?.followers || 0;
    return [
      { name: 'Target', value: target, type: 'target' },
      { name: 'Achieved', value: achieved, type: 'achieved' },
    ];
  }, [displayItem]);

  const chartDataLeadsRevenue = useMemo(() => {
    if (!displayItem) return [];
    return [
      { name: 'Organic Leads', value: displayItem.achieved?.organic_leads || 0 },
      { name: 'Organic Revenue', value: displayItem.achieved?.organic_revenue || 0 },
    ];
  }, [displayItem]);

  const contentTrackerData = useMemo(() => {
    if (!displayItem) return [];
    return [
      { name: 'Stories', achieved: displayItem.achieved?.stories || 0, target: displayItem.targets?.stories || 0 },
      { name: 'Reels', achieved: displayItem.achieved?.reels || 0, target: displayItem.targets?.reels || 0 },
      { name: 'Posts', achieved: displayItem.achieved?.posts || 0, target: displayItem.targets?.posts || 0 },
    ];
  }, [displayItem]);

  const spendVsTargetData = useMemo(() => {
    const f = aggregates.budgetForecast || {};
    const target = Number(f.weekly_ad_spend_target) || 0;
    const actual = Number(f.actual_ad_spend) || 0;
    return [
      { name: 'Target', value: target },
      { name: 'Actual', value: actual },
    ];
  }, [aggregates.budgetForecast]);

  const formatNum = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'K' : String(Number(n)));
  const formatCurrency = (n) => (n == null || n === '' ? '0' : `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`);

  const openTargetsModal = (item) => {
    if (!item?.team?.id) return;
    const t = item.targets || {};
    setTargetsForm({
      target_followers: t.followers ?? '',
      target_ad_spend: t.ad_spend ?? '',
      target_organic_leads: t.organic_leads ?? '',
      target_organic_revenue: t.organic_revenue ?? '',
      target_stories: t.stories ?? '',
      target_reels: t.reels ?? '',
      target_posts: t.posts ?? '',
    });
    setEditingTeamId(item.team.id);
    setShowTargetsModal(true);
  };

  const saveTargets = async () => {
    if (!editingTeamId || !weekStart) return;
    setSavingTargets(true);
    try {
      const res = await fetch(`${API_BASE}/api/plan/targets`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({
          team_id: editingTeamId,
          week_start: weekStart,
          target_followers: Number(targetsForm.target_followers) || 0,
          target_ad_spend: Number(targetsForm.target_ad_spend) || 0,
          target_organic_leads: Number(targetsForm.target_organic_leads) || 0,
          target_organic_revenue: Number(targetsForm.target_organic_revenue) || 0,
          target_stories: Number(targetsForm.target_stories) || 0,
          target_reels: Number(targetsForm.target_reels) || 0,
          target_posts: Number(targetsForm.target_posts) || 0,
        }),
      });
      if (!res.ok) throw new Error('Failed to save');
      setShowTargetsModal(false);
      fetchAggregates();
    } catch (e) {
      console.error(e);
    } finally {
      setSavingTargets(false);
    }
  };

  return (
    <div className="container-fluid py-4 tpg-page">
      <h2 className="tpg-title mb-4">Team Performance & Effort & Goals</h2>

      {/* Sticky filters */}
      <div className="tpg-filters-sticky">
        <div className="tpg-filters-inner">
          <div className="tpg-filter-group">
            <label>Team</label>
            <select
              className="form-select form-select-sm"
              value={selectedTeamId ?? ''}
              onChange={(e) => setSelectedTeamId(e.target.value ? Number(e.target.value) : null)}
            >
              <option value="">All teams</option>
              {teams.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </div>
          <div className="tpg-filter-group">
            <label>Platform</label>
            <select className="form-select form-select-sm" value={platform} onChange={(e) => setPlatform(e.target.value)}>
              <option value="instagram">Instagram</option>
              <option value="facebook">Facebook</option>
              <option value="all">All</option>
            </select>
          </div>
          <div className="tpg-filter-group">
            <label>Week</label>
            <select className="form-select form-select-sm" value={weekPreset} onChange={(e) => setWeekPreset(e.target.value)}>
              <option value="this_week">Current week</option>
              <option value="last_week">Last week</option>
              <option value="next_week">Next week</option>
              <option value="custom">Custom range</option>
            </select>
          </div>
          {weekPreset === 'custom' && (
            <>
              <div className="tpg-filter-group">
                <label>From</label>
                <input type="date" className="form-control form-control-sm" value={customStart} onChange={(e) => setCustomStart(e.target.value)} />
              </div>
              <div className="tpg-filter-group">
                <label>To</label>
                <input type="date" className="form-control form-control-sm" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} />
              </div>
            </>
          )}
        </div>
      </div>

      {error && <div className="alert alert-warning py-2 small">{error}</div>}
      {loading && (
        <div className="text-center py-5">
          <div className="spinner-border text-primary" role="status" />
          <p className="text-muted small mt-2">Loading live data from Meta…</p>
        </div>
      )}

      {!loading && (
        <>
          {/* Section 1 – Team Performance KPI cards */}
          <section className="tpg-section">
            <h5 className="tpg-section-title">Team Performance</h5>
            {displayItem && (
              <div className="row g-3 mb-3">
                <div className="col-6 col-lg-3">
                  <div className="tpg-kpi-card">
                    <div className="tpg-kpi-header">
                      <span>Followers</span>
                      {displayItem.team?.id && (
                        <button type="button" className="btn btn-sm btn-link p-0 tpg-edit-target" onClick={() => openTargetsModal(displayItem)} title="Edit target (Admin)">Edit target</button>
                      )}
                    </div>
                    <div className="tpg-kpi-target">Target: {formatNum(displayItem.targets?.followers)}</div>
                    <div className="tpg-kpi-achieved">Achieved: {formatNum(displayItem.achieved?.followers)}</div>
                    <div className="tpg-kpi-remaining">Remaining: {formatNum(displayItem.remaining?.followers ?? Math.max(0, (displayItem.targets?.followers || 0) - (displayItem.achieved?.followers || 0)))}</div>
                    <div className="progress tpg-progress" title={`${displayItem.progressPct?.followers ?? 0}%`}>
                      <div className="progress-bar" style={{ width: `${displayItem.progressPct?.followers ?? 0}%` }} />
                    </div>
                    <div className="tpg-kpi-pct">{displayItem.progressPct?.followers ?? 0}%</div>
                  </div>
                </div>
                <div className="col-6 col-lg-3">
                  <div className="tpg-kpi-card">
                    <div className="tpg-kpi-header">
                      <span>Ad Spend</span>
                      {displayItem.team?.id && (
                        <button type="button" className="btn btn-sm btn-link p-0 tpg-edit-target" onClick={() => openTargetsModal(displayItem)}>Edit target</button>
                      )}
                    </div>
                    <div className="tpg-kpi-target">Target: {formatCurrency(displayItem.targets?.ad_spend)}</div>
                    <div className="tpg-kpi-achieved">Achieved: {formatCurrency(displayItem.achieved?.ad_spend)}</div>
                    <div className="tpg-kpi-remaining">Remaining: {formatCurrency(displayItem.remaining?.ad_spend ?? Math.max(0, (displayItem.targets?.ad_spend || 0) - (displayItem.achieved?.ad_spend || 0)))}</div>
                    <div className="progress tpg-progress">
                      <div className="progress-bar" style={{ width: `${displayItem.progressPct?.ad_spend ?? 0}%` }} />
                    </div>
                    <div className="tpg-kpi-pct">{displayItem.progressPct?.ad_spend ?? 0}%</div>
                  </div>
                </div>
                <div className="col-6 col-lg-3">
                  <div className="tpg-kpi-card">
                    <div className="tpg-kpi-header">
                      <span>Organic Leads</span>
                      {displayItem.team?.id && (
                        <button type="button" className="btn btn-sm btn-link p-0 tpg-edit-target" onClick={() => openTargetsModal(displayItem)}>Edit target</button>
                      )}
                    </div>
                    <div className="tpg-kpi-target">Target: {formatNum(displayItem.targets?.organic_leads)}</div>
                    <div className="tpg-kpi-achieved">Achieved: {formatNum(displayItem.achieved?.organic_leads)}</div>
                    <div className="tpg-kpi-remaining">Remaining: {formatNum(displayItem.remaining?.organic_leads ?? Math.max(0, (displayItem.targets?.organic_leads || 0) - (displayItem.achieved?.organic_leads || 0)))}</div>
                    <div className="progress tpg-progress">
                      <div className="progress-bar" style={{ width: `${displayItem.progressPct?.organic_leads ?? 0}%` }} />
                    </div>
                    <div className="tpg-kpi-pct">{displayItem.progressPct?.organic_leads ?? 0}%</div>
                  </div>
                </div>
                <div className="col-6 col-lg-3">
                  <div className="tpg-kpi-card">
                    <div className="tpg-kpi-header">
                      <span>Organic Revenue</span>
                      {displayItem.team?.id && (
                        <button type="button" className="btn btn-sm btn-link p-0 tpg-edit-target" onClick={() => openTargetsModal(displayItem)}>Edit target</button>
                      )}
                    </div>
                    <div className="tpg-kpi-target">Target: {formatCurrency(displayItem.targets?.organic_revenue)}</div>
                    <div className="tpg-kpi-achieved">Achieved: {formatCurrency(displayItem.achieved?.organic_revenue)}</div>
                    <div className="tpg-kpi-remaining">Remaining: {formatCurrency(displayItem.remaining?.organic_revenue ?? Math.max(0, (displayItem.targets?.organic_revenue || 0) - (displayItem.achieved?.organic_revenue || 0)))}</div>
                    <div className="progress tpg-progress">
                      <div className="progress-bar" style={{ width: `${displayItem.progressPct?.organic_revenue ?? 0}%` }} />
                    </div>
                    <div className="tpg-kpi-pct">{displayItem.progressPct?.organic_revenue ?? 0}%</div>
                  </div>
                </div>
              </div>
            )}
            {!displayItem && aggregates.data?.length === 0 && (
              <p className="text-muted">Add teams and set weekly targets on the Plan page to see performance here.</p>
            )}
          </section>

          {/* Section 2 – Effort & Weekly Goals (circular progress) */}
          <section className="tpg-section">
            <h5 className="tpg-section-title">Effort & Weekly Goals</h5>
            {displayItem && (
              <div className="tpg-effort-row">
                <CircularProgress
                  value={displayItem.achieved?.stories ?? 0}
                  target={displayItem.targets?.stories || 1}
                  label="Stories"
                  color="#f09433"
                />
                <CircularProgress
                  value={displayItem.achieved?.reels ?? 0}
                  target={displayItem.targets?.reels || 1}
                  label="Reels"
                  color="#833ab4"
                />
                <CircularProgress
                  value={displayItem.achieved?.posts ?? 0}
                  target={displayItem.targets?.posts || 1}
                  label="Posts"
                  color="#1877f2"
                />
              </div>
            )}
          </section>

          {/* Section 3 – Ad Spend Budget Forecast */}
          <section className="tpg-section">
            <h5 className="tpg-section-title">Ad Spend Budget Forecast</h5>
            <div className="row g-3">
              <div className="col-12 col-md-6 col-lg-3">
                <div className="tpg-forecast-card">
                  <div className="tpg-forecast-label">Weekly Budget Target</div>
                  <div className="tpg-forecast-value">{formatCurrency(aggregates.budgetForecast?.weekly_ad_spend_target)}</div>
                </div>
              </div>
              <div className="col-12 col-md-6 col-lg-3">
                <div className="tpg-forecast-card">
                  <div className="tpg-forecast-label">Actual Spend</div>
                  <div className="tpg-forecast-value text-primary">{formatCurrency(aggregates.budgetForecast?.actual_ad_spend)}</div>
                </div>
              </div>
              <div className="col-12 col-md-6 col-lg-3">
                <div className="tpg-forecast-card">
                  <div className="tpg-forecast-label">Remaining Budget</div>
                  <div className="tpg-forecast-value">{formatCurrency(aggregates.budgetForecast?.remaining_budget)}</div>
                </div>
              </div>
              <div className="col-12 col-md-6 col-lg-3">
                <div className="tpg-forecast-card">
                  <div className="tpg-forecast-label">Burn Rate %</div>
                  <div className="tpg-forecast-value">{burnRatePct}%</div>
                </div>
              </div>
            </div>
            <div className="row mt-3">
              <div className="col-12 col-lg-8">
                <div className="tpg-chart-card">
                  <h6 className="tpg-chart-title">Daily spend</h6>
                  <ResponsiveContainer width="100%" height={220}>
                    <LineChart data={dailySpend.map((d) => ({ ...d, spend: Number(d.spend) || 0 }))} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                      <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `$${v}`} />
                      <Tooltip formatter={(v) => [`$${Number(v).toFixed(2)}`, 'Spend']} labelFormatter={(l) => `Date: ${l}`} />
                      <Line type="monotone" dataKey="spend" stroke="#1877f2" strokeWidth={2} dot={{ r: 3 }} name="Spend" />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
              <div className="col-12 col-lg-4">
                <div className="tpg-chart-card">
                  <h6 className="tpg-chart-title">Spend vs Target</h6>
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={spendVsTargetData} layout="vertical" margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                      <XAxis type="number" tickFormatter={(v) => `$${v}`} />
                      <YAxis type="category" dataKey="name" width={60} tick={{ fontSize: 11 }} />
                      <Tooltip formatter={(v) => [`$${Number(v).toLocaleString()}`, '']} />
                      <Bar dataKey="value" fill="#1877f2" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          </section>

          {/* Section 4 – Charts */}
          <section className="tpg-section">
            <h5 className="tpg-section-title">Charts</h5>
            <div className="row g-3">
              <div className="col-12 col-lg-4">
                <div className="tpg-chart-card">
                  <h6 className="tpg-chart-title">Followers Growth vs Target</h6>
                  <ResponsiveContainer width="100%" height={200}>
                    <BarChart data={chartDataFollowers} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                      <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} />
                      <Tooltip />
                      <Bar dataKey="value" fill="#31a24c" name="Followers" radius={[4, 4, 0, 0]} />
                      <ReferenceLine y={displayItem?.targets?.followers || 0} stroke="#e2e8f0" strokeDasharray="4 2" label="Target" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
              <div className="col-12 col-lg-4">
                <div className="tpg-chart-card">
                  <h6 className="tpg-chart-title">Organic Leads vs Revenue</h6>
                  <ResponsiveContainer width="100%" height={200}>
                    <BarChart data={chartDataLeadsRevenue} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                      <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} />
                      <Tooltip />
                      <Bar dataKey="value" fill="#1877f2" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
              <div className="col-12 col-lg-4">
                <div className="tpg-chart-card">
                  <h6 className="tpg-chart-title">Weekly Content Posting Tracker</h6>
                  <ResponsiveContainer width="100%" height={200}>
                    <BarChart data={contentTrackerData} margin={{ top: 8, right: 8, left: 8, bottom: 8 }} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                      <XAxis type="number" allowDuplicatedCategory={false} />
                      <YAxis type="category" dataKey="name" width={60} tick={{ fontSize: 11 }} />
                      <Tooltip formatter={(v, name, props) => [`${v} / ${props.payload.target}`, props.payload.name]} />
                      <Bar dataKey="achieved" name="Achieved" fill="#833ab4" radius={[0, 4, 4, 0]} />
                      <ReferenceLine x={0} stroke="#ccc" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          </section>
        </>
      )}

      {/* Edit targets modal */}
      {showTargetsModal && (
        <div className="modal show d-block tpg-modal-backdrop" tabIndex="-1">
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content rounded-3">
              <div className="modal-header">
                <h5 className="modal-title">Edit weekly targets (Admin)</h5>
                <button type="button" className="btn-close" onClick={() => setShowTargetsModal(false)} />
              </div>
              <div className="modal-body">
                <p className="text-muted small mb-3">Week: {weekStart}</p>
                <div className="row g-2">
                  <div className="col-6"><label className="form-label small">Followers</label><input type="number" className="form-control form-control-sm" min="0" value={targetsForm.target_followers} onChange={(e) => setTargetsForm((p) => ({ ...p, target_followers: e.target.value }))} /></div>
                  <div className="col-6"><label className="form-label small">Ad Spend</label><input type="number" className="form-control form-control-sm" min="0" step="0.01" value={targetsForm.target_ad_spend} onChange={(e) => setTargetsForm((p) => ({ ...p, target_ad_spend: e.target.value }))} /></div>
                  <div className="col-6"><label className="form-label small">Organic Leads</label><input type="number" className="form-control form-control-sm" min="0" value={targetsForm.target_organic_leads} onChange={(e) => setTargetsForm((p) => ({ ...p, target_organic_leads: e.target.value }))} /></div>
                  <div className="col-6"><label className="form-label small">Organic Revenue</label><input type="number" className="form-control form-control-sm" min="0" step="0.01" value={targetsForm.target_organic_revenue} onChange={(e) => setTargetsForm((p) => ({ ...p, target_organic_revenue: e.target.value }))} /></div>
                  <div className="col-4"><label className="form-label small">Stories</label><input type="number" className="form-control form-control-sm" min="0" value={targetsForm.target_stories} onChange={(e) => setTargetsForm((p) => ({ ...p, target_stories: e.target.value }))} /></div>
                  <div className="col-4"><label className="form-label small">Reels</label><input type="number" className="form-control form-control-sm" min="0" value={targetsForm.target_reels} onChange={(e) => setTargetsForm((p) => ({ ...p, target_reels: e.target.value }))} /></div>
                  <div className="col-4"><label className="form-label small">Posts</label><input type="number" className="form-control form-control-sm" min="0" value={targetsForm.target_posts} onChange={(e) => setTargetsForm((p) => ({ ...p, target_posts: e.target.value }))} /></div>
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
  );
}
