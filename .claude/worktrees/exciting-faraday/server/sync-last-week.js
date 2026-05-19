// server/sync-last-week.js
// Script to manually fetch and store last week's leads from Meta API

require('dotenv').config();
const { fetchLeadsFromMeta } = require('./jobs/leadsSync');
const { saveLeads } = require('./repositories/leadsRepository');
const { setJobState } = require('./repositories/jobStateRepository');

const JOBSTATE_LAST_LEADS_SYNC_KEY = 'lastSuccessfulLeadsSyncUtc';

async function syncLastWeek() {
  const pageId = process.env.META_PAGE_ID;
  
  if (!pageId) {
    console.error('[SyncLastWeek] ❌ META_PAGE_ID not configured in .env file');
    console.error('[SyncLastWeek] Please add META_PAGE_ID to server/.env');
    process.exit(1);
  }

  try {
    console.log('[SyncLastWeek] ========================================');
    console.log('[SyncLastWeek] Starting last week leads sync...');
    console.log('[SyncLastWeek] ========================================');
    
    // Calculate last week date range (7 days ago to now)
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 7);
    
    // Set to start of day for startDate
    startDate.setHours(0, 0, 0, 0);
    // Keep endDate at current time to get all leads up to now
    
    console.log(`[SyncLastWeek] Date range: ${startDate.toISOString()} to ${endDate.toISOString()}`);
    const daysInRange = (endDate - startDate) / (1000 * 60 * 60 * 24);
    console.log(`[SyncLastWeek] Fetching leads from the last ${daysInRange.toFixed(1)} days`);
    
    // Reset JobState cursor to allow fresh sync
    console.log('[SyncLastWeek] Resetting JobState cursor...');
    await setJobState(JOBSTATE_LAST_LEADS_SYNC_KEY, '');
    
    // Fetch leads from Meta API
    console.log('[SyncLastWeek] Fetching leads from Meta API...');
    console.time('[SyncLastWeek] Fetch time');
    const leads = await fetchLeadsFromMeta(pageId, startDate, endDate);
    console.timeEnd('[SyncLastWeek] Fetch time');
    
    console.log(`[SyncLastWeek] Fetched ${leads.length} leads from Meta API`);
    
    if (leads.length === 0) {
      console.log('[SyncLastWeek] ⚠️  No leads found for last week. Possible reasons:');
      console.log('[SyncLastWeek]   - No leads were generated during this period');
      console.log('[SyncLastWeek]   - Leads are missing ad_id or campaign_id (required for storage)');
      console.log('[SyncLastWeek]   - API access token may have insufficient permissions');
      return;
    }
    
    // Save to database
    console.log('[SyncLastWeek] Saving leads to database...');
    console.time('[SyncLastWeek] Save time');
    const result = await saveLeads(leads);
    console.timeEnd('[SyncLastWeek] Save time');
    
    console.log('[SyncLastWeek] ========================================');
    console.log(`[SyncLastWeek] ✅ Sync completed successfully!`);
    console.log(`[SyncLastWeek]   - Inserted: ${result.inserted} new leads`);
    console.log(`[SyncLastWeek]   - Updated: ${result.updated} existing leads`);
    console.log(`[SyncLastWeek]   - Total processed: ${leads.length} leads`);
    console.log('[SyncLastWeek] ========================================');
    
    // Update JobState cursor to current time so future syncs continue from here
    await setJobState(JOBSTATE_LAST_LEADS_SYNC_KEY, endDate.toISOString());
    console.log(`[SyncLastWeek] Updated JobState cursor to ${endDate.toISOString()}`);
    
  } catch (error) {
    console.error('[SyncLastWeek] ❌ Error syncing leads:', error.message);
    if (error.response?.data) {
      console.error('[SyncLastWeek] API Error Details:', JSON.stringify(error.response.data, null, 2));
    }
    console.error('[SyncLastWeek] Stack trace:', error.stack);
    process.exit(1);
  }
}

// Run the sync
syncLastWeek()
  .then(() => {
    console.log('[SyncLastWeek] Script completed');
    process.exit(0);
  })
  .catch((error) => {
    console.error('[SyncLastWeek] Fatal error:', error);
    process.exit(1);
  });

