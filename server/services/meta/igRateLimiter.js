/**
 * Dedicated rate limiter for Instagram Graph API calls (media insights, stories, etc.).
 * Higher concurrency than the shared Ads API limiter — Instagram rate limits are per-app/user
 * and are separate from the Ads API rate limit pool (error codes 613/17/80004 on ads side).
 *
 * Config: 15 concurrent, 200ms between starts → ~5 calls/sec throughput.
 * This allows 25 reels × 4 accounts = 100 calls to complete in ~20 seconds (well within the
 * 45-second backend timeout). The shared Ads limiter (2 concurrent / 2s) is left unchanged.
 */

const QUEUE = [];
let running = 0;
let lastStart = 0;
const MAX_CONCURRENT = 15;
const MIN_MS_BETWEEN = 200;

function dequeue() {
  if (running >= MAX_CONCURRENT || QUEUE.length === 0) return;
  const now = Date.now();
  if (now - lastStart < MIN_MS_BETWEEN && running > 0) {
    setTimeout(dequeue, MIN_MS_BETWEEN - (now - lastStart));
    return;
  }
  const { fn, resolve, reject } = QUEUE.shift();
  running++;
  lastStart = Date.now();
  Promise.resolve(fn()).then(resolve, reject).finally(() => {
    running--;
    dequeue();
  });
}

function schedule(fn) {
  return new Promise((resolve, reject) => {
    QUEUE.push({ fn, resolve, reject });
    dequeue();
  });
}

module.exports = { schedule };
