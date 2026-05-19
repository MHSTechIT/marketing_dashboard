/**
 * Process Instagram online_followers API response into analytics output.
 * API: GET /{IG_USER_ID}/insights?metric=online_followers&period=lifetime
 * Input: raw API response. No API calls inside this module.
 */

/**
 * Convert hour (0-23) to readable label.
 * @param {number} hour - 0-23
 * @returns {string} e.g. "12 AM", "1 PM", "6 PM"
 */
function hourToLabel(hour) {
  if (hour === 0) return "12 AM";
  if (hour === 12) return "12 PM";
  if (hour < 12) return `${hour} AM`;
  return `${hour - 12} PM`;
}

/**
 * Extract hourly value object from metric. Tries multiple response shapes from Meta.
 * @param {object} metric - One insight object (e.g. name: "online_followers")
 * @returns {object|null} Object with keys "0".."23" or null
 */
function extractHourlyValueObject(metric) {
  if (!metric || typeof metric !== "object") return null;
  const valuesArr = metric.values || [];
  // Shape 1: values[0].value = { "0": n, "1": n, ... }
  const fromFirstValue = valuesArr[0]?.value;
  if (fromFirstValue && typeof fromFirstValue === "object" && !Array.isArray(fromFirstValue)) return fromFirstValue;
  // Shape 2: total_value = { value: { "0": n, ... } } or total_value = { "0": n, ... }
  const tv = metric.total_value;
  if (tv && typeof tv === "object") {
    if (typeof tv.value === "object" && tv.value !== null && !Array.isArray(tv.value)) return tv.value;
    const keys = Object.keys(tv);
    if (keys.some((k) => /^\d{1,2}$/.test(k))) return tv;
  }
  // Shape 3: metric.value = { "0": n, ... }
  if (metric.value && typeof metric.value === "object" && !Array.isArray(metric.value)) return metric.value;
  // Shape 4: values array with value per period - aggregate by hour
  if (valuesArr.length > 0 && valuesArr.some((v) => v.value != null)) {
    const byHour = {};
    for (let h = 0; h < 24; h++) byHour[h] = 0;
    valuesArr.forEach((v) => {
      const val = v.value;
      if (typeof val === "object" && val !== null && !Array.isArray(val)) {
        for (let h = 0; h < 24; h++) {
          const key = String(h);
          if (val[key] != null) byHour[h] += Number(val[key]) || 0;
        }
      }
    });
    return byHour;
  }
  return null;
}

/**
 * Parse raw online_followers API response into hourly array.
 * @param {object} apiResponse - Raw response from Meta (e.g. { data: [...] })
 * @returns {{ hour: number, followers_online: number }[]}
 */
function parseHourlyData(apiResponse) {
  const items = Array.isArray(apiResponse?.data) ? apiResponse.data : [];
  const metric = items.find((m) => m.name === "online_followers");
  const valueObj = metric ? extractHourlyValueObject(metric) : null;
  if (!valueObj || typeof valueObj !== "object") return [];

  const hourly = [];
  for (let h = 0; h < 24; h++) {
    const key = String(h);
    const val = valueObj[key] != null ? Number(valueObj[key]) : 0;
    hourly.push({ hour: h, followers_online: val });
  }
  return hourly;
}

/**
 * Generate sample hourly data (evening peak, afternoon secondary) when API returns no/zero data.
 */
function getSampleHourlyData() {
  const hourly = [];
  for (let h = 0; h < 24; h++) {
    let v = 20 + Math.round(30 * Math.random());
    if (h >= 18 && h <= 22) v += 180;
    else if (h >= 12 && h <= 15) v += 80;
    else if (h >= 9 && h <= 11) v += 50;
    hourly.push({ hour: h, followers_online: Math.max(0, v) });
  }
  return hourly;
}

/**
 * Get activity label from value vs max.
 * > 80% max = Peak Time, 50-80% = Good Time, else = Low Activity
 */
function getActivityLabel(value, max) {
  if (!max || max <= 0) return "⚠️ Low Activity";
  const pct = (value / max) * 100;
  if (pct > 80) return "🔥 Peak Time";
  if (pct >= 50) return "✅ Good Time";
  return "⚠️ Low Activity";
}

/**
 * Generate recommendation text from top hours.
 */
function getRecommendationText(bestTimes) {
  if (!bestTimes || bestTimes.length === 0) return "Post when your followers are most active.";
  const hours = bestTimes.map((t) => t.hour);
  const evening = hours.filter((h) => h >= 17 || h <= 2).length;
  const morning = hours.filter((h) => h >= 6 && h <= 11).length;
  const afternoon = hours.filter((h) => h >= 12 && h <= 16).length;
  if (evening >= 2) return "Post during evening hours when most followers are online.";
  if (morning >= 2) return "Post in the morning for highest engagement.";
  if (afternoon >= 2) return "Post in the afternoon when your audience is active.";
  return "Post during your top engagement hours for best reach.";
}

/**
 * Process raw online_followers API response into full analytics output.
 * When API returns no data or all zeros, uses sample data and sets is_sample_data: true.
 * @param {object} apiResponse - Raw response from GET .../insights?metric=online_followers&period=lifetime
 * @returns {object} { best_times, peak_hours, heatmap_data, recommendation_text, hourly_with_labels, is_sample_data? }
 */
function processOnlineFollowersResponse(apiResponse) {
  let hourly = parseHourlyData(apiResponse);
  const allZeros = hourly.length > 0 && hourly.every((h) => h.followers_online === 0);
  const useSample = hourly.length === 0 || allZeros;
  if (useSample) {
    hourly = getSampleHourlyData();
  }

  if (hourly.length === 0) {
    return {
      best_times: [],
      peak_hours: [],
      heatmap_data: [],
      recommendation_text: "No online followers data available.",
      hourly_with_labels: [],
      max_followers: 0,
      is_sample_data: false,
    };
  }

  const maxFollowers = Math.max(...hourly.map((h) => h.followers_online), 1);
  const sorted = [...hourly].sort((a, b) => b.followers_online - a.followers_online);

  const best_times = sorted.slice(0, 3).map(({ hour, followers_online }) => ({
    hour,
    label: hourToLabel(hour),
    followers: followers_online,
    activity_label: getActivityLabel(followers_online, maxFollowers),
  }));

  const peak_hours = sorted.slice(0, 5).map(({ hour, followers_online }) => ({
    hour,
    label: hourToLabel(hour),
    followers: followers_online,
    activity_label: getActivityLabel(followers_online, maxFollowers),
  }));

  const heatmap_data = hourly.map(({ hour, followers_online }) => ({
    day: "All Days",
    hour,
    value: followers_online,
    label: hourToLabel(hour),
    activity_label: getActivityLabel(followers_online, maxFollowers),
  }));

  const recommendation_text = getRecommendationText(best_times);

  const hourly_with_labels = hourly.map(({ hour, followers_online }) => ({
    hour,
    followers_online,
    label: hourToLabel(hour),
    activity_label: getActivityLabel(followers_online, maxFollowers),
  }));

  return {
    best_times,
    peak_hours,
    heatmap_data,
    recommendation_text,
    hourly_with_labels,
    max_followers: maxFollowers,
    is_sample_data: useSample,
  };
}

/**
 * Build best posting times and heatmap from last N days media (timestamp + views).
 * Used when Meta online_followers returns no data. Aggregates views by hour (and optionally day) from post timestamps.
 * @param {Array<{ timestamp?: string, views?: number, video_views?: number }>} mediaList - Media items with timestamp and views
 * @param {{ timezone?: string }} [options] - Optional timezone (e.g. 'Asia/Kolkata') for hour extraction; default UTC
 * @returns {{ best_times, peak_hours, heatmap_data, recommendation_text, hourly_with_labels, max_followers, source, message } | null }
 *   Same shape as processOnlineFollowersResponse; null if no usable data.
 */
function buildBestTimesFromMediaViews(mediaList, options = {}) {
  const timezone = options.timezone || "UTC";
  const byHour = {};
  for (let h = 0; h < 24; h++) byHour[h] = 0;

  if (!Array.isArray(mediaList) || mediaList.length === 0) return null;

  for (const m of mediaList) {
    const ts = m.timestamp;
    if (!ts) continue;
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) continue;
    let hour;
    if (timezone !== "UTC") {
      try {
        hour = parseInt(
          new Intl.DateTimeFormat("en-CA", { timeZone: timezone, hour: "numeric", hour12: false }).format(d),
          10
        );
      } catch (_) {
        hour = d.getUTCHours();
      }
    } else {
      hour = d.getUTCHours();
    }
    if (hour < 0 || hour > 23) continue;
    const views = Number(m.views) || Number(m.video_views) || 0;
    byHour[hour] = (byHour[hour] || 0) + views;
  }

  const hourly = [];
  for (let h = 0; h < 24; h++) {
    hourly.push({ hour: h, followers_online: byHour[h] || 0 });
  }

  const totalViews = hourly.reduce((s, x) => s + x.followers_online, 0);
  if (totalViews === 0) return null;

  const maxFollowers = Math.max(...hourly.map((h) => h.followers_online), 1);
  const sorted = [...hourly].sort((a, b) => b.followers_online - a.followers_online);

  const best_times = sorted.slice(0, 3).map(({ hour, followers_online }) => ({
    hour,
    label: hourToLabel(hour),
    followers: followers_online,
    activity_label: getActivityLabel(followers_online, maxFollowers),
  }));

  const peak_hours = sorted.slice(0, 5).map(({ hour, followers_online }) => ({
    hour,
    label: hourToLabel(hour),
    followers: followers_online,
    activity_label: getActivityLabel(followers_online, maxFollowers),
  }));

  const heatmap_data = hourly.map(({ hour, followers_online }) => ({
    day: "All Days",
    hour,
    value: followers_online,
    label: hourToLabel(hour),
    activity_label: getActivityLabel(followers_online, maxFollowers),
  }));

  const recommendation_text = getRecommendationText(best_times);

  const hourly_with_labels = hourly.map(({ hour, followers_online }) => ({
    hour,
    followers_online,
    label: hourToLabel(hour),
    activity_label: getActivityLabel(followers_online, maxFollowers),
  }));

  return {
    best_times,
    peak_hours,
    heatmap_data,
    recommendation_text,
    hourly_with_labels,
    max_followers: maxFollowers,
    source: "media_views_7d",
    message: "Based on when your content got the most views in the last 7 days.",
  };
}

module.exports = {
  processOnlineFollowersResponse,
  buildBestTimesFromMediaViews,
  parseHourlyData,
  extractHourlyValueObject,
  getSampleHourlyData,
  hourToLabel,
  getActivityLabel,
  getRecommendationText,
};
