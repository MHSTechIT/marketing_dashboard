import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
} from 'recharts';
import './PageVisitTracking.css';

const API_BASE = process.env.REACT_APP_API_BASE || 'http://localhost:4000';

const getToken = () => {
  try {
    const keys = [process.env.REACT_APP_STORAGE_KEY || 'app_auth',
      '59ca69f53c01829c41b079fb15fb5b9bc7ed726f15afdc9da7e57f83543fca15a06130d30bbf6744243d936c7b19d494353d7a55e742b0404ebd6c4704efd50c',
      'ads_dashboard_auth'];
    for (const k of keys) {
      const raw = localStorage.getItem(k);
      if (raw) { const p = JSON.parse(raw); if (p && p.token) return p.token; }
    }
  } catch (_) {}
  return null;
};

const api = async (path) => {
  const token = getToken();
  const res = await fetch(`${API_BASE}${path}`, { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } });
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || `Request failed (${res.status})`); }
  return res.json();
};

const ymd = (d) => d.toISOString().slice(0, 10);
const fmtDuration = (s) => {
  s = Math.round(Number(s) || 0);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60), sec = s % 60;
  if (m < 60) return `${m}m ${sec}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
};
const fmtDateTime = (iso) => {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleString('en-GB', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }); }
  catch { return iso; }
};

export default function PageVisitTracking() {
  const today = new Date();
  const monthAgo = new Date(); monthAgo.setDate(monthAgo.getDate() - 29);
  const [from, setFrom] = useState(ymd(monthAgo));
  const [to, setTo] = useState(ymd(today));

  const [summary, setSummary] = useState(null);
  const [daily, setDaily] = useState([]);
  const [mostVisited, setMostVisited] = useState([]);
  const [engagement, setEngagement] = useState([]);

  const [logs, setLogs] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(25);
  const [search, setSearch] = useState('');
  const [userId, setUserId] = useState('');
  const [sortBy, setSortBy] = useState('visited_at');
  const [sortDir, setSortDir] = useState('desc');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('activity'); // activity | engagement

  const rangeQ = `from=${from}&to=${to}`;

  const loadOverview = useCallback(async () => {
    setError('');
    try {
      const [s, d, mv, eng] = await Promise.all([
        api(`/api/activity/summary?${rangeQ}`),
        api(`/api/activity/daily?${rangeQ}`),
        api(`/api/activity/most-visited?${rangeQ}`),
        api(`/api/activity/user-engagement`),
      ]);
      setSummary(s);
      setDaily((d.days || []).map(x => ({ day: String(x.day).slice(0, 10), views: x.views, visitors: x.visitors })));
      setMostVisited(mv.pages || []);
      setEngagement(eng.users || []);
    } catch (e) { setError(e.message); }
  }, [rangeQ]);

  const loadLogs = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const q = `${rangeQ}&page=${page}&pageSize=${pageSize}&search=${encodeURIComponent(search)}&userId=${encodeURIComponent(userId)}&sortBy=${sortBy}&sortDir=${sortDir}`;
      const r = await api(`/api/activity/logs?${q}`);
      setLogs(r.rows || []); setTotal(r.total || 0);
    } catch (e) { setError(e.message); } finally { setLoading(false); }
  }, [rangeQ, page, pageSize, search, userId, sortBy, sortDir]);

  useEffect(() => { loadOverview(); }, [loadOverview]);
  useEffect(() => { const t = setTimeout(loadLogs, 250); return () => clearTimeout(t); }, [loadLogs]);

  const userOptions = useMemo(() => {
    const seen = new Map();
    engagement.forEach(u => { if (u.user_id && !seen.has(u.user_id)) seen.set(u.user_id, u.user_name || u.user_email || u.user_id); });
    return [...seen.entries()];
  }, [engagement]);

  const toggleSort = (col) => {
    if (sortBy === col) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortBy(col); setSortDir('desc'); }
    setPage(1);
  };

  const exportCSV = async () => {
    try {
      const r = await api(`/api/activity/logs?${rangeQ}&page=1&pageSize=200&search=${encodeURIComponent(search)}&userId=${encodeURIComponent(userId)}&sortBy=${sortBy}&sortDir=${sortDir}`);
      const rows = r.rows || [];
      const headers = ['User Name', 'Email', 'Role', 'Page', 'URL', 'Visit Time', 'Duration (s)', 'Device', 'Browser', 'IP'];
      const esc = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
      const lines = [headers.join(',')].concat(rows.map(x => [x.user_name, x.user_email, x.user_role, x.page_name, x.page_url, fmtDateTime(x.visited_at), x.duration_seconds, x.device_type, x.browser, x.ip_address].map(esc).join(',')));
      const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `page-visits_${from}_to_${to}.csv`;
      a.click(); URL.revokeObjectURL(a.href);
    } catch (e) { setError(e.message); }
  };

  const exportExcel = async () => {
    try {
      const ExcelJS = (await import('exceljs')).default || (await import('exceljs'));
      const r = await api(`/api/activity/logs?${rangeQ}&page=1&pageSize=200&search=${encodeURIComponent(search)}&userId=${encodeURIComponent(userId)}&sortBy=${sortBy}&sortDir=${sortDir}`);
      const rows = r.rows || [];
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('Page Visits');
      ws.columns = [
        { header: 'User Name', key: 'n', width: 22 }, { header: 'Email', key: 'e', width: 28 },
        { header: 'Role', key: 'r', width: 10 }, { header: 'Page', key: 'p', width: 22 },
        { header: 'URL', key: 'u', width: 24 }, { header: 'Visit Time', key: 't', width: 22 },
        { header: 'Duration', key: 'd', width: 12 }, { header: 'Device', key: 'dev', width: 10 },
        { header: 'Browser', key: 'b', width: 12 }, { header: 'IP', key: 'ip', width: 16 },
      ];
      ws.getRow(1).font = { bold: true };
      rows.forEach(x => ws.addRow({ n: x.user_name, e: x.user_email, r: x.user_role, p: x.page_name, u: x.page_url, t: fmtDateTime(x.visited_at), d: fmtDuration(x.duration_seconds), dev: x.device_type, b: x.browser, ip: x.ip_address }));
      const buf = await wb.xlsx.writeBuffer();
      const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = `page-visits_${from}_to_${to}.xlsx`; a.click(); URL.revokeObjectURL(a.href);
    } catch (e) { setError('Excel export failed: ' + e.message); }
  };

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const maxVisits = Math.max(1, ...mostVisited.map(p => p.visits));

  const cards = summary ? [
    { label: 'Total Page Views', value: summary.totalPageViews.toLocaleString(), icon: '👁️', cls: 'pv-card-blue' },
    { label: 'Unique Visitors', value: summary.uniqueVisitors.toLocaleString(), icon: '🧑', cls: 'pv-card-violet' },
    { label: 'Active Today', value: summary.activeUsersToday.toLocaleString(), icon: '🟢', cls: 'pv-card-green' },
    { label: 'Total Users', value: summary.totalUsers.toLocaleString(), icon: '👥', cls: 'pv-card-teal' },
    { label: 'Avg Session', value: fmtDuration(summary.avgSessionSeconds), icon: '⏱️', cls: 'pv-card-amber' },
    { label: 'Most Visited', value: summary.mostVisitedPage, sub: `${summary.mostVisitedPageCount} views`, icon: '⭐', cls: 'pv-card-pink' },
  ] : [];

  return (
    <div className="pv-container">
      <div className="pv-header">
        <div>
          <h2 className="pv-title">Page Visit Tracking</h2>
          <p className="pv-subtitle">User navigation history &amp; usage analytics</p>
        </div>
        <div className="pv-toolbar">
          <label className="pv-date">From <input type="date" value={from} max={to} onChange={e => { setFrom(e.target.value); setPage(1); }} /></label>
          <label className="pv-date">To <input type="date" value={to} min={from} onChange={e => { setTo(e.target.value); setPage(1); }} /></label>
          <button className="pv-btn" onClick={() => { loadOverview(); loadLogs(); }}>🔄 Refresh</button>
          <button className="pv-btn pv-btn-ghost" onClick={exportCSV}>⬇ CSV</button>
          <button className="pv-btn pv-btn-ghost" onClick={exportExcel}>⬇ Excel</button>
        </div>
      </div>

      {error && <div className="pv-error">⚠️ {error}</div>}

      <div className="pv-cards">
        {cards.map((c, i) => (
          <div key={i} className={`pv-card ${c.cls}`}>
            <div className="pv-card-icon">{c.icon}</div>
            <div className="pv-card-body">
              <div className="pv-card-label">{c.label}</div>
              <div className="pv-card-value" title={c.value}>{c.value}</div>
              {c.sub && <div className="pv-card-sub">{c.sub}</div>}
            </div>
          </div>
        ))}
        {!summary && <div className="pv-muted">Loading summary…</div>}
      </div>

      <div className="pv-grid">
        <div className="pv-panel">
          <div className="pv-panel-title">Daily Page Views</div>
          <div style={{ width: '100%', height: 260 }}>
            <ResponsiveContainer>
              <AreaChart data={daily} margin={{ top: 10, right: 12, left: -10, bottom: 0 }}>
                <defs>
                  <linearGradient id="pvViews" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#6366f1" stopOpacity={0.35} />
                    <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#eef0f4" />
                <XAxis dataKey="day" tick={{ fontSize: 10, fill: '#64748b' }} tickFormatter={(d) => d.slice(5)} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: '#64748b' }} axisLine={false} tickLine={false} allowDecimals={false} />
                <Tooltip />
                <Area type="monotone" dataKey="views" name="Page Views" stroke="#6366f1" strokeWidth={2} fill="url(#pvViews)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="pv-panel">
          <div className="pv-panel-title">Most Visited Pages</div>
          <div className="pv-mostvisited">
            {mostVisited.length === 0 && <div className="pv-muted">No data yet</div>}
            {mostVisited.slice(0, 8).map((p, i) => (
              <div key={p.page_name} className="pv-mv-row">
                <span className="pv-mv-rank">{i + 1}</span>
                <div className="pv-mv-main">
                  <div className="pv-mv-head"><span className="pv-mv-name" title={p.page_name}>{p.page_name}</span><span className="pv-mv-count">{p.visits.toLocaleString()}</span></div>
                  <div className="pv-mv-bar"><div className="pv-mv-fill" style={{ width: `${(p.visits / maxVisits) * 100}%` }} /></div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="pv-tabs">
        <button className={`pv-tab ${tab === 'activity' ? 'active' : ''}`} onClick={() => setTab('activity')}>User Activity</button>
        <button className={`pv-tab ${tab === 'engagement' ? 'active' : ''}`} onClick={() => setTab('engagement')}>User Engagement</button>
      </div>

      {tab === 'activity' && (
        <div className="pv-panel pv-table-panel">
          <div className="pv-filters">
            <input className="pv-search" placeholder="🔍 Search user, email, page, URL…" value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} />
            <select className="pv-select" value={userId} onChange={e => { setUserId(e.target.value); setPage(1); }}>
              <option value="">All users</option>
              {userOptions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
            </select>
            <span className="pv-count">{total.toLocaleString()} visits</span>
          </div>
          <div className="pv-table-scroll">
            <table className="pv-table">
              <thead>
                <tr>
                  <th className="pv-sortable" onClick={() => toggleSort('user_name')}>User {sortBy === 'user_name' ? (sortDir === 'asc' ? '▲' : '▼') : ''}</th>
                  <th>Email</th>
                  <th className="pv-sortable" onClick={() => toggleSort('page_name')}>Page {sortBy === 'page_name' ? (sortDir === 'asc' ? '▲' : '▼') : ''}</th>
                  <th>URL</th>
                  <th className="pv-sortable" onClick={() => toggleSort('visited_at')}>Visit Time {sortBy === 'visited_at' ? (sortDir === 'asc' ? '▲' : '▼') : ''}</th>
                  <th className="pv-sortable" onClick={() => toggleSort('duration')}>Duration {sortBy === 'duration' ? (sortDir === 'asc' ? '▲' : '▼') : ''}</th>
                  <th>Device</th>
                  <th>Browser</th>
                  <th>IP</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan="9" className="pv-center">Loading…</td></tr>
                ) : logs.length === 0 ? (
                  <tr><td colSpan="9" className="pv-center pv-muted">No page visits found for these filters.</td></tr>
                ) : logs.map(r => (
                  <tr key={r.id}>
                    <td className="pv-strong">{r.user_name || '—'}</td>
                    <td className="pv-dim">{r.user_email || '—'}</td>
                    <td>{r.page_name || '—'}</td>
                    <td className="pv-dim pv-mono">{r.page_url || '—'}</td>
                    <td>{fmtDateTime(r.visited_at)}</td>
                    <td>{fmtDuration(r.duration_seconds)}</td>
                    <td><span className={`pv-pill pv-pill-${(r.device_type || '').toLowerCase()}`}>{r.device_type || '—'}</span></td>
                    <td>{r.browser || '—'}</td>
                    <td className="pv-dim pv-mono">{r.ip_address || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="pv-pager">
            <span>Page {page} of {totalPages}</span>
            <div className="pv-pager-btns">
              <button disabled={page <= 1} onClick={() => setPage(p => Math.max(1, p - 1))}>‹ Prev</button>
              <button disabled={page >= totalPages} onClick={() => setPage(p => Math.min(totalPages, p + 1))}>Next ›</button>
            </div>
          </div>
        </div>
      )}

      {tab === 'engagement' && (
        <div className="pv-panel pv-table-panel">
          <div className="pv-table-scroll">
            <table className="pv-table">
              <thead>
                <tr><th>User</th><th>Email</th><th>Sessions</th><th>Page Views</th><th>Avg Session</th><th>Last Login</th><th>Most Visited</th></tr>
              </thead>
              <tbody>
                {engagement.length === 0 ? (
                  <tr><td colSpan="7" className="pv-center pv-muted">No engagement data yet.</td></tr>
                ) : engagement.map(u => (
                  <tr key={u.user_id}>
                    <td className="pv-strong">{u.user_name || '—'}</td>
                    <td className="pv-dim">{u.user_email || '—'}</td>
                    <td>{u.sessions ?? 0}</td>
                    <td>{(u.page_views ?? 0).toLocaleString()}</td>
                    <td>{fmtDuration(u.avg_dur)}</td>
                    <td>{u.last_login ? fmtDateTime(u.last_login) : '—'}</td>
                    <td>{u.top_page || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
