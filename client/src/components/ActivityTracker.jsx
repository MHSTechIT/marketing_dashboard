import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { startSession, endSession, heartbeat, trackVisit, pageNameFromPath } from '../utils/activityTracker';

/**
 * Invisible component mounted inside the protected layout. It:
 *  - starts a session when the app loads (logged in),
 *  - records a page visit (with time-spent) every time the route changes,
 *  - sends a heartbeat so "active users" / session duration stay accurate,
 *  - flushes the final page + ends the session on tab close.
 * Renders nothing.
 */
export default function ActivityTracker() {
  const location = useLocation();
  const entryRef = useRef(null); // { name, url, time }

  // Session lifecycle (once).
  useEffect(() => {
    startSession();
    const hb = setInterval(() => heartbeat(), 60 * 1000);

    const flush = (keepalive) => {
      const e = entryRef.current;
      if (e) {
        trackVisit(e.name, e.url, (Date.now() - e.time) / 1000, keepalive);
      }
    };
    const onUnload = () => { flush(true); endSession(true); };
    window.addEventListener('beforeunload', onUnload);

    return () => {
      clearInterval(hb);
      window.removeEventListener('beforeunload', onUnload);
      flush(false);
      endSession(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // On every route change: record the page we just left (with its duration),
  // then start timing the new page.
  useEffect(() => {
    const name = pageNameFromPath(location.pathname);
    const url = location.pathname + (location.search || '');
    const prev = entryRef.current;
    if (prev && (prev.url !== url)) {
      trackVisit(prev.name, prev.url, (Date.now() - prev.time) / 1000);
    }
    entryRef.current = { name, url, time: Date.now() };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname, location.search]);

  return null;
}
