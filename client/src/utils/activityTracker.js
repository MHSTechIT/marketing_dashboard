/**
 * Client-side activity tracker.
 *
 * Automatically records page visits, time-spent-per-page, and login/logout
 * sessions for the logged-in user. Best-effort: every call is wrapped so it can
 * NEVER break navigation or throw into the app.
 *
 * Wired in via <ActivityTracker/> (mounted in the protected layout).
 */

const API_BASE = process.env.REACT_APP_API_BASE || 'http://localhost:4000';

// Map known routes → friendly page names (falls back to a title-cased path).
const PAGE_NAMES = {
  '/': 'Dashboard',
  '/best-ad': 'Best Performing Ad',
  '/best-reel': 'Best Performing Reel',
  '/plan': 'Plan',
  '/audience': 'Audience',
  '/ai-insights': 'AI Insights',
  '/unique-leads': 'Unique Leads',
  '/team-management': 'Team Management',
  '/page-visit-tracking': 'Page Visit Tracking',
  '/operation/task': 'Task',
  '/report/daily': 'Daily Report',
  '/high-five': 'High Five',
};

export function pageNameFromPath(pathname) {
  if (PAGE_NAMES[pathname]) return PAGE_NAMES[pathname];
  const base = '/' + (pathname || '').split('/').filter(Boolean)[0] || '';
  if (PAGE_NAMES[base]) return PAGE_NAMES[base];
  const seg = (pathname || '/').split('/').filter(Boolean);
  if (seg.length === 0) return 'Dashboard';
  return seg.map(s => s.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())).join(' / ');
}

function getToken() {
  try {
    const keys = [
      process.env.REACT_APP_STORAGE_KEY || 'app_auth',
      '59ca69f53c01829c41b079fb15fb5b9bc7ed726f15afdc9da7e57f83543fca15a06130d30bbf6744243d936c7b19d494353d7a55e742b0404ebd6c4704efd50c',
      'ads_dashboard_auth',
    ];
    for (const k of keys) {
      const raw = localStorage.getItem(k);
      if (raw) {
        const p = JSON.parse(raw);
        if (p && p.token) return p.token;
      }
    }
  } catch (_) { /* ignore */ }
  return null;
}

function detectDevice() {
  const ua = navigator.userAgent || '';
  if (/Tablet|iPad|PlayBook|Silk/i.test(ua)) return 'Tablet';
  if (/Mobi|Android.*Mobile|iPhone|iPod|Windows Phone|BlackBerry/i.test(ua)) return 'Mobile';
  return 'Desktop';
}
function detectBrowser() {
  const ua = navigator.userAgent || '';
  if (/Edg\//i.test(ua)) return 'Edge';
  if (/OPR\/|Opera/i.test(ua)) return 'Opera';
  if (/Chrome\//i.test(ua) && !/Chromium/i.test(ua)) return 'Chrome';
  if (/Firefox\//i.test(ua)) return 'Firefox';
  if (/Safari\//i.test(ua) && /Version\//i.test(ua)) return 'Safari';
  if (/MSIE|Trident/i.test(ua)) return 'Internet Explorer';
  return 'Unknown';
}

// Per-tab session id (stable across route changes within a tab).
export function getSessionId() {
  try {
    let sid = sessionStorage.getItem('mhs_activity_sid');
    if (!sid) {
      sid = 's_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
      sessionStorage.setItem('mhs_activity_sid', sid);
    }
    return sid;
  } catch (_) {
    return 's_fallback';
  }
}

function post(pathname, body, opts = {}) {
  const token = getToken();
  if (!token) return Promise.resolve();
  try {
    return fetch(`${API_BASE}${pathname}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
      keepalive: !!opts.keepalive, // lets the request survive page unload
    }).catch(() => {});
  } catch (_) {
    return Promise.resolve();
  }
}

const common = () => ({ sessionId: getSessionId(), deviceType: detectDevice(), browser: detectBrowser() });

export function startSession() {
  return post('/api/activity/session/start', common());
}
export function endSession(keepalive = true) {
  return post('/api/activity/session/end', { sessionId: getSessionId() }, { keepalive });
}
export function heartbeat() {
  return post('/api/activity/heartbeat', { sessionId: getSessionId() });
}
export function trackVisit(pageName, pageUrl, durationSeconds, keepalive = false) {
  return post('/api/activity/track', {
    ...common(),
    pageName,
    pageUrl,
    durationSeconds: Math.max(0, Math.round(durationSeconds || 0)),
  }, { keepalive });
}
