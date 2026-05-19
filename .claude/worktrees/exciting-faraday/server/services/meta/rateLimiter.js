/**
 * Shared rate limiter for all Meta Marketing API calls.
 * Max 2 concurrent, min 2s between starts to avoid "too many API calls" (613 / 17 / 80004).
 * Cache fallback: callers should return cached data when limit hit.
 */

const QUEUE = [];
let running = 0;
let lastStart = 0;
const MAX_CONCURRENT = 2;
const MIN_MS_BETWEEN = 2000;

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

/**
 * Run a Meta API call through the rate limiter.
 * @param {() => Promise<T>} fn - Async function that performs the API call
 * @returns {Promise<T>}
 */
function schedule(fn) {
  return new Promise((resolve, reject) => {
    QUEUE.push({ fn, resolve, reject });
    dequeue();
  });
}

function isMetaRateLimitError(err) {
  const c = err?.response?.data?.error?.code;
  const sub = err?.response?.data?.error?.error_subcode;
  const msg = (err?.response?.data?.error?.message || '').toLowerCase();
  return (
    c === 4 ||
    c === 17 ||
    c === 613 ||
    c === 80004 ||
    sub === 2446079 ||
    msg.includes('too many') ||
    msg.includes('rate limit') ||
    msg.includes('api call')
  );
}

module.exports = {
  schedule,
  isMetaRateLimitError,
};
