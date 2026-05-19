/**
 * Ads cache for Meta /api/meta/ads. Redis when REDIS_URL is set, in-memory fallback otherwise.
 * TTL 24h+ so we never call Meta if cache exists. Used to avoid "Ad account has too many API calls."
 * Set REDIS_URL in env and install "redis" for Redis; otherwise in-memory is used.
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const TTL_SEC = Number(process.env.ADS_CACHE_TTL_SEC) || 90000; // 25h default
const PREFIX = 'meta:ads:';

let redisClient = null; // null = not tried, client = ready, false = disabled/failed
async function getRedis() {
  if (redisClient === false) return null;
  if (redisClient) return redisClient;
  const url = (process.env.REDIS_URL || '').trim();
  if (!url) return null;
  try {
    const { createClient } = require('redis');
    const client = createClient({ url });
    client.on('error', () => {});
    await client.connect();
    redisClient = client;
    return client;
  } catch (e) {
    redisClient = false;
    if (url) console.warn('[adsCache] Redis disabled:', e.code === 'MODULE_NOT_FOUND' ? 'install "redis" for Redis caching' : e.message);
    return null;
  }
}

function key(adAccountId, cacheKey) {
  const acc = (adAccountId || '').toString().replace(/^act_/, '');
  const k = cacheKey === 'all' || cacheKey === '' ? 'all' : String(cacheKey);
  return `${PREFIX}${acc}:${k}`;
}

const memory = new Map();

async function get(adAccountId, cacheKey) {
  const k = key(adAccountId, cacheKey || 'all');
  const r = await getRedis();
  if (r) {
    try {
      const raw = await r.get(k);
      if (raw) return { data: JSON.parse(raw), cached: true };
    } catch (_) {}
  }
  const entry = memory.get(k);
  if (entry && entry.expires > Date.now()) return { data: entry.data, cached: true };
  return null;
}

async function set(adAccountId, cacheKey, data, ttlSec = TTL_SEC) {
  const k = key(adAccountId, cacheKey || 'all');
  const pay = Array.isArray(data) ? data : (data && data.data != null ? data.data : data);
  const r = await getRedis();
  if (r) {
    try {
      await r.setEx(k, ttlSec, JSON.stringify(pay));
    } catch (_) {}
  }
  memory.set(k, { data: pay, expires: Date.now() + ttlSec * 1000 });
}

async function getAnyCached(adAccountId) {
  const acc = (adAccountId || '').toString().replace(/^act_/, '');
  const r = await getRedis();
  if (r) {
    try {
      const keys = await r.keys(`${PREFIX}${acc}:*`);
      for (const k of keys) {
        const raw = await r.get(k);
        if (raw) return { data: JSON.parse(raw), cached: true };
      }
    } catch (_) {}
  }
  const now = Date.now();
  for (const [mk, entry] of memory) {
    if (mk.startsWith(`${PREFIX}${acc}:`) && entry.expires > now)
      return { data: entry.data, cached: true };
  }
  return null;
}

module.exports = { get, set, getAnyCached, TTL_SEC };
