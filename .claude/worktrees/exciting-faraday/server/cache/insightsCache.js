/**
 * In-memory cache for Meta insights and Instagram media insights.
 * Enables 10–100 ms responses when data was recently fetched; Meta is only called on cache miss or TTL expiry.
 *
 * Usage: get(key) → value or null; set(key, value, ttlSeconds).
 */

const store = new Map(); // key -> { value, expires }

const DEFAULT_TTL_SECONDS = 5 * 60; // 5 minutes

function get(key) {
  const entry = store.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expires) {
    store.delete(key);
    return null;
  }
  return entry.value;
}

function set(key, value, ttlSeconds = DEFAULT_TTL_SECONDS) {
  store.set(key, {
    value,
    expires: Date.now() + ttlSeconds * 1000,
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

module.exports = {
  get,
  set,
  buildMediaInsightsKey,
  buildInsightsKey,
  DEFAULT_TTL_SECONDS,
};
