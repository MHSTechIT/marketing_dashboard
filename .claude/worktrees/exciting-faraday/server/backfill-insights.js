// Script to manually trigger insights backfill (refreshes meta_insights with latest from Meta API).
// Use this to populate Hook Rate / Hold Rate after ensuring server requests actions (see plan).
// Run from server dir: node backfill-insights.js [days]
// Example: node backfill-insights.js 7   (last 7 days)
require('dotenv').config();
const axios = require('axios');

const API_BASE = process.env.API_BASE || 'http://localhost:4000';
const DAYS = parseInt(process.argv[2], 10) || 7;

function getDateRange(days) {
  const end = new Date();
  end.setDate(end.getDate() - 1); // yesterday
  const start = new Date(end);
  start.setDate(start.getDate() - (days - 1));
  return {
    from: start.toISOString().slice(0, 10),
    to: end.toISOString().slice(0, 10),
  };
}

async function backfillInsights() {
  const { from, to } = getDateRange(DAYS);
  try {
    console.log(`Starting insights backfill for ${from} to ${to} (${DAYS} days)...`);
    const url = `${API_BASE}/api/meta/insights/backfill`;
    const response = await axios.post(url, { from, to }, { timeout: 600000 });
    console.log('\nBackfill completed.');
    console.log(JSON.stringify(response.data, null, 2));
    if (response.data.totalCount != null) {
      console.log(`\nTotal insights rows synced: ${response.data.totalCount}`);
    }
  } catch (error) {
    console.error('\nBackfill failed:');
    if (error.response) {
      console.error(`Status: ${error.response.status}`);
      console.error('Error:', error.response.data);
    } else {
      console.error('Error:', error.message);
    }
    process.exit(1);
  }
}

backfillInsights();
