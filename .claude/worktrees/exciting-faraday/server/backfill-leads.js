// Script to manually trigger leads backfill
require('dotenv').config();
const axios = require('axios');

const API_BASE = process.env.API_BASE || 'http://localhost:4000';
const PAGE_ID = process.env.META_PAGE_ID || '113830624877941';
const DAYS = process.argv[2] || 30; // Get days from command line, default to 30

async function backfillLeads() {
  try {
    console.log(`Starting backfill for page ${PAGE_ID} - last ${DAYS} days...`);
    
    const url = `${API_BASE}/api/meta/leads/backfill?pageId=${PAGE_ID}&days=${DAYS}`;
    console.log(`Calling: ${url}`);
    
    const response = await axios.get(url, {
      timeout: 600000 // 10 minutes timeout for large backfills
    });
    
    console.log('\n✅ Backfill completed successfully!');
    console.log(JSON.stringify(response.data, null, 2));
    
    if (response.data.data) {
      const stats = response.data.data.stats;
      console.log(`\n📊 Summary:`);
      console.log(`   - Leads fetched: ${stats.leadsFetched}`);
      console.log(`   - Leads inserted: ${stats.leadsInserted}`);
      console.log(`   - Leads updated: ${stats.leadsUpdated}`);
      console.log(`   - Date range: ${response.data.data.dateRange.start} to ${response.data.data.dateRange.end}`);
    }
  } catch (error) {
    console.error('\n❌ Backfill failed:');
    if (error.response) {
      console.error(`Status: ${error.response.status}`);
      console.error(`Error:`, error.response.data);
    } else if (error.request) {
      console.error('No response received. Is the server running?');
      console.error('Error:', error.message);
    } else {
      console.error('Error:', error.message);
    }
    process.exit(1);
  }
}

backfillLeads();

