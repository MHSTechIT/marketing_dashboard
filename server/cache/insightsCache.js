/**
 * In-memory cache for Meta insights and Instagram media insights.
 * Enables 10–100 ms responses when data was recently fetched; Meta is only called on cache miss or TTL expiry.
 *
 * Usage: get(key) → value or null; set(key, value, ttlSeconds).
 */

const store = new Map(); // key -> { value, expires, staleExpires }

const DEFAULT_TTL_SECONDS = 5 * 60; // 5 minutes
// How long a value remains available as a STALE fallback after its fresh TTL expires.
// Used to keep pages working when Meta is rate-limited or temporarily failing.
const STALE_RETENTION_SECONDS = 24 * 60 * 60; // 24 hours

function get(key) {
  const entry = store.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expires) {
    // Past fresh TTL — keep the entry for stale fallback (getStale), but report a miss here.
    return null;
  }
  return entry.value;
}

// Returns the last cached value even if its fresh TTL has expired, as long as it's
// within the stale-retention window. Used as a graceful fallback when a live fetch fails.
function getStale(key) {
  const entry = store.get(key);
  if (!entry) return null;
  if (entry.staleExpires && Date.now() > entry.staleExpires) {
    store.delete(key);
    return null;
  }
  return entry.value;
}

function set(key, value, ttlSeconds = DEFAULT_TTL_SECONDS) {
  store.set(key, {
    value,
    expires: Date.now() + ttlSeconds * 1000,
    staleExpires: Date.now() + STALE_RETENTION_SECONDS * 1000,
  });
}

function buildMediaInsightsKey(opts) {
  const a = (opts.accountIds || []).slice().sort();
  const p = (opts.pageIds || []).slice().sort();
  return `media_insights:${a.join(",")}:${p.join(",")}:${opts.from || ""}:${opts.to || ""}:${opts.period || ""}:${opts.contentType || "all"}`;
}

function buildInsightsKey(opts) {
  const accounts = (opts.ad_account_id || "").toString();
  const from = opts.from || "";
  const to = opts.to || "";
  const campaign = (opts.campaign_id || "").toString();
  const ad = (opts.ad_id || "").toString();
  const live = opts.live ? "1" : "0";
  return `insights:${accounts}:${from}:${to}:${campaign}:${ad}:${live}`;
}

function clear() {
  store.clear();
}

module.exports = {
  get,
  getStale,
  set,
  clear,
  buildMediaInsightsKey,
  buildInsightsKey,
  DEFAULT_TTL_SECONDS,
};
