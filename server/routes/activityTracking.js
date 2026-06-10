/**
 * Page Visit / User Activity Tracking.
 *
 * Records every page a logged-in user visits, plus login/logout sessions, and
 * serves analytics for the admin "Page Visit Tracking" dashboard.
 *
 * Write endpoints (any logged-in user — records their OWN activity):
 *   POST /api/activity/track          one page visit
 *   POST /api/activity/session/start  begin a session (on login / app load)
 *   POST /api/activity/session/end    end a session (on logout / tab close)
 *   POST /api/activity/heartbeat      keep session alive + bump last_activity
 *
 * Read endpoints (admin dashboard):
 *   GET  /api/activity/summary        summary cards
 *   GET  /api/activity/logs           filterable, paginated activity table
 *   GET  /api/activity/most-visited   page-wise visit counts (ranked)
 *   GET  /api/activity/daily          daily/weekly/monthly visit stats
 *   GET  /api/activity/user-engagement per-user engagement report
 *
 * Tables: user_activity_logs, user_sessions (see migrations/page-visit-tracking.sql).
 * Tracking is best-effort: a failure here NEVER breaks the user's navigation.
 */

const express = require('express');
const router = express.Router();
const { pool } = require('../pgClient');
const { authMiddleware } = require('../auth');

// ── helpers ───────────────────────────────────────────────────────────────────

function clientIp(req) {
  const xff = (req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return xff || (req.socket && req.socket.remoteAddress) || req.ip || '';
}

// Minimal User-Agent parser (no external dependency).
function parseUA(ua = '') {
  const s = String(ua);
  let device = 'Desktop';
  if (/Tablet|iPad|PlayBook|Silk/i.test(s)) device = 'Tablet';
  else if (/Mobi|Android.*Mobile|iPhone|iPod|Windows Phone|BlackBerry/i.test(s)) device = 'Mobile';
  let browser = 'Unknown';
  if (/Edg\//i.test(s)) browser = 'Edge';
  else if (/OPR\/|Opera/i.test(s)) browser = 'Opera';
  else if (/Chrome\//i.test(s) && !/Chromium/i.test(s)) browser = 'Chrome';
  else if (/Firefox\//i.test(s)) browser = 'Firefox';
  else if (/Safari\//i.test(s) && /Version\//i.test(s)) browser = 'Safari';
  else if (/MSIE|Trident/i.test(s)) browser = 'Internet Explorer';
  return { device, browser };
}

// Cache user_id → { name, role } so we don't hit the users table on every visit.
const _userCache = new Map(); // id -> { name, role, at }
const USER_CACHE_MS = 5 * 60 * 1000;
async function getUserMeta(userId, fallbackEmail) {
  const key = String(userId);
  const cached = _userCache.get(key);
  if (cached && Date.now() - cached.at < USER_CACHE_MS) return cached;
  let name = fallbackEmail || '';
  let role = 'user';
  try {
    const r = await pool.query('SELECT full_name, email, role FROM users WHERE id = $1 LIMIT 1', [userId]);
    if (r.rows[0]) {
      name = r.rows[0].full_name || r.rows[0].email || fallbackEmail || '';
      role = r.rows[0].role || 'user';
    }
  } catch (_) { /* fall back to email */ }
  const meta = { name, role, at: Date.now() };
  _userCache.set(key, meta);
  return meta;
}

// ── write: track a page visit ──────────────────────────────────────────────────
router.post('/track', authMiddleware, async (req, res) => {
  // Respond immediately; never let tracking block the UI.
  res.json({ ok: true });
  try {
    const b = req.body || {};
    const userId = req.user.id;
    const email = req.user.email || b.userEmail || '';
    const meta = await getUserMeta(userId, email);
    const ua = parseUA(req.headers['user-agent']);
    const device = b.deviceType || ua.device;
    const browser = b.browser || ua.browser;
    const duration = Math.max(0, Math.min(86400, parseInt(b.durationSeconds, 10) || 0));

    await pool.query(
      `INSERT INTO user_activity_logs
         (user_id, user_name, user_email, user_role, page_name, page_url,
          session_id, device_type, browser, ip_address, duration_seconds, visited_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, now())`,
      [String(userId), meta.name, email, meta.role,
       (b.pageName || '').slice(0, 200), (b.pageUrl || '').slice(0, 500),
       b.sessionId || null, device, browser, clientIp(req), duration]
    );

    // keep the session's last_activity fresh
    if (b.sessionId) {
      await pool.query('UPDATE user_sessions SET last_activity = now() WHERE session_id = $1', [b.sessionId]);
    }
  } catch (e) {
    console.error('[Activity] track error:', e.message);
  }
});

// ── write: session start ────────────────────────────────────────────────────────
router.post('/session/start', authMiddleware, async (req, res) => {
  res.json({ ok: true });
  try {
    const b = req.body || {};
    if (!b.sessionId) return;
    const userId = req.user.id;
    const email = req.user.email || '';
    const meta = await getUserMeta(userId, email);
    const ua = parseUA(req.headers['user-agent']);
    await pool.query(
      `INSERT INTO user_sessions
         (user_id, user_name, user_email, session_id, login_time, last_activity, ip_address, device_type, browser)
       VALUES ($1,$2,$3,$4, now(), now(), $5,$6,$7)
       ON CONFLICT (session_id) DO UPDATE SET last_activity = now()`,
      [String(userId), meta.name, email, b.sessionId, clientIp(req),
       b.deviceType || ua.device, b.browser || ua.browser]
    );
  } catch (e) {
    console.error('[Activity] session/start error:', e.message);
  }
});

// ── write: session end ──────────────────────────────────────────────────────────
router.post('/session/end', authMiddleware, async (req, res) => {
  res.json({ ok: true });
  try {
    const b = req.body || {};
    if (!b.sessionId) return;
    await pool.query(
      `UPDATE user_sessions
          SET logout_time = now(),
              session_duration = GREATEST(0, EXTRACT(EPOCH FROM (now() - login_time))::int)
        WHERE session_id = $1 AND logout_time IS NULL`,
      [b.sessionId]
    );
  } catch (e) {
    console.error('[Activity] session/end error:', e.message);
  }
});

// ── write: heartbeat ────────────────────────────────────────────────────────────
router.post('/heartbeat', authMiddleware, async (req, res) => {
  res.json({ ok: true });
  try {
    const b = req.body || {};
    if (!b.sessionId) return;
    await pool.query(
      `UPDATE user_sessions
          SET last_activity = now(),
              session_duration = GREATEST(0, EXTRACT(EPOCH FROM (now() - login_time))::int)
        WHERE session_id = $1`,
      [b.sessionId]
    );
  } catch (e) {
    console.error('[Activity] heartbeat error:', e.message);
  }
});

// ── read helpers: date range (defaults to last 30 days) ─────────────────────────
function rangeFrom(req) {
  const from = (req.query.from || '').trim();
  const to = (req.query.to || '').trim();
  const fromIso = from ? `${from} 00:00:00+05:30` : null;
  const toIso = to ? `${to} 23:59:59+05:30` : null;
  return { fromIso, toIso };
}

// ── read: summary cards ─────────────────────────────────────────────────────────
router.get('/summary', authMiddleware, async (req, res) => {
  try {
    const { fromIso, toIso } = rangeFrom(req);
    const where = [];
    const params = [];
    if (fromIso) { params.push(fromIso); where.push(`visited_at >= $${params.length}`); }
    if (toIso) { params.push(toIso); where.push(`visited_at <= $${params.length}`); }
    const wsql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const [views, users, activeToday, mostPage, avgDur, totalUsers] = await Promise.all([
      pool.query(`SELECT COUNT(*)::int AS c FROM user_activity_logs ${wsql}`, params),
      pool.query(`SELECT COUNT(DISTINCT user_id)::int AS c FROM user_activity_logs ${wsql}`, params),
      pool.query(`SELECT COUNT(DISTINCT user_id)::int AS c FROM user_activity_logs
                  WHERE visited_at::date = (now() AT TIME ZONE 'Asia/Kolkata')::date`),
      pool.query(`SELECT page_name, COUNT(*)::int AS c FROM user_activity_logs ${wsql}
                  ${wsql ? 'AND' : 'WHERE'} page_name <> '' GROUP BY page_name ORDER BY c DESC LIMIT 1`, params),
      pool.query(`SELECT COALESCE(AVG(session_duration),0)::int AS s FROM user_sessions WHERE session_duration IS NOT NULL`),
      pool.query(`SELECT COUNT(*)::int AS c FROM users`),
    ]);

    res.json({
      ok: true,
      totalPageViews: views.rows[0].c,
      uniqueVisitors: users.rows[0].c,
      activeUsersToday: activeToday.rows[0].c,
      totalUsers: totalUsers.rows[0].c,
      avgSessionSeconds: avgDur.rows[0].s,
      mostVisitedPage: mostPage.rows[0] ? mostPage.rows[0].page_name : '—',
      mostVisitedPageCount: mostPage.rows[0] ? mostPage.rows[0].c : 0,
    });
  } catch (e) {
    console.error('[Activity] summary error:', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── read: activity logs (filter + sort + paginate) ──────────────────────────────
router.get('/logs', authMiddleware, async (req, res) => {
  try {
    const { fromIso, toIso } = rangeFrom(req);
    const search = (req.query.search || '').trim();
    const userId = (req.query.userId || '').trim();
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const pageSize = Math.min(200, Math.max(1, parseInt(req.query.pageSize, 10) || 25));
    const sortMap = { visited_at: 'visited_at', user_name: 'user_name', page_name: 'page_name', duration: 'duration_seconds' };
    const sortBy = sortMap[req.query.sortBy] || 'visited_at';
    const sortDir = (req.query.sortDir || 'desc').toLowerCase() === 'asc' ? 'ASC' : 'DESC';

    const where = [];
    const params = [];
    if (fromIso) { params.push(fromIso); where.push(`visited_at >= $${params.length}`); }
    if (toIso) { params.push(toIso); where.push(`visited_at <= $${params.length}`); }
    if (userId) { params.push(userId); where.push(`user_id = $${params.length}`); }
    if (search) {
      params.push(`%${search}%`);
      const i = params.length;
      where.push(`(user_name ILIKE $${i} OR user_email ILIKE $${i} OR page_name ILIKE $${i} OR page_url ILIKE $${i})`);
    }
    const wsql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const countRes = await pool.query(`SELECT COUNT(*)::int AS c FROM user_activity_logs ${wsql}`, params);
    const total = countRes.rows[0].c;

    const offset = (page - 1) * pageSize;
    const rowsRes = await pool.query(
      `SELECT id, user_id, user_name, user_email, user_role, page_name, page_url,
              session_id, device_type, browser, ip_address, duration_seconds, visited_at
         FROM user_activity_logs ${wsql}
         ORDER BY ${sortBy} ${sortDir}
         LIMIT ${pageSize} OFFSET ${offset}`,
      params
    );

    res.json({ ok: true, total, page, pageSize, rows: rowsRes.rows });
  } catch (e) {
    console.error('[Activity] logs error:', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── read: most-visited pages ────────────────────────────────────────────────────
router.get('/most-visited', authMiddleware, async (req, res) => {
  try {
    const { fromIso, toIso } = rangeFrom(req);
    const where = [`page_name <> ''`];
    const params = [];
    if (fromIso) { params.push(fromIso); where.push(`visited_at >= $${params.length}`); }
    if (toIso) { params.push(toIso); where.push(`visited_at <= $${params.length}`); }
    const r = await pool.query(
      `SELECT page_name, COUNT(*)::int AS visits, COUNT(DISTINCT user_id)::int AS unique_visitors
         FROM user_activity_logs WHERE ${where.join(' AND ')}
        GROUP BY page_name ORDER BY visits DESC LIMIT 50`,
      params
    );
    res.json({ ok: true, pages: r.rows });
  } catch (e) {
    console.error('[Activity] most-visited error:', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── read: daily visit stats (for the chart) ─────────────────────────────────────
router.get('/daily', authMiddleware, async (req, res) => {
  try {
    const { fromIso, toIso } = rangeFrom(req);
    const where = [];
    const params = [];
    if (fromIso) { params.push(fromIso); where.push(`visited_at >= $${params.length}`); }
    if (toIso) { params.push(toIso); where.push(`visited_at <= $${params.length}`); }
    const wsql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const r = await pool.query(
      `SELECT (visited_at AT TIME ZONE 'Asia/Kolkata')::date AS day,
              COUNT(*)::int AS views,
              COUNT(DISTINCT user_id)::int AS visitors
         FROM user_activity_logs ${wsql}
        GROUP BY day ORDER BY day ASC`,
      params
    );
    res.json({ ok: true, days: r.rows.map(x => ({ day: x.day, views: x.views, visitors: x.visitors })) });
  } catch (e) {
    console.error('[Activity] daily error:', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── read: per-user engagement ───────────────────────────────────────────────────
router.get('/user-engagement', authMiddleware, async (req, res) => {
  try {
    const r = await pool.query(
      `WITH agg AS (
         SELECT user_id,
                MAX(user_name)  AS user_name,
                MAX(user_email) AS user_email,
                COUNT(*)::int   AS page_views,
                COUNT(DISTINCT session_id)::int AS sessions,
                MAX(visited_at) AS last_active
           FROM user_activity_logs GROUP BY user_id
       ),
       top AS (
         SELECT DISTINCT ON (user_id) user_id, page_name AS top_page
           FROM (SELECT user_id, page_name, COUNT(*) c FROM user_activity_logs
                  WHERE page_name <> '' GROUP BY user_id, page_name) q
          ORDER BY user_id, c DESC
       ),
       dur AS (
         SELECT user_id, COALESCE(AVG(session_duration),0)::int AS avg_dur,
                MAX(login_time) AS last_login
           FROM user_sessions GROUP BY user_id
       )
       SELECT agg.*, top.top_page, dur.avg_dur, dur.last_login
         FROM agg
         LEFT JOIN top ON top.user_id = agg.user_id
         LEFT JOIN dur ON dur.user_id = agg.user_id
        ORDER BY agg.page_views DESC LIMIT 200`
    );
    res.json({ ok: true, users: r.rows });
  } catch (e) {
    console.error('[Activity] user-engagement error:', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

module.exports = router;
