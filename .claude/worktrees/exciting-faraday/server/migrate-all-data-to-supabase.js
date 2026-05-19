// server/migrate-all-data-to-supabase.js
// Migrate all data from SQL Server to Supabase
// This script exports data from SQL Server and imports it into Supabase

require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const { supabase, verifyTableExists } = require('./supabase');

// Optional: Try to connect to SQL Server if credentials exist
// Note: This requires the old MSSQL setup, which may not be available
let mssqlPool = null;
async function getMSSQLPool() {
  if (!process.env.DB_SERVER) {
    return null;
  }
  
  try {
    // Try to use mssql directly if available (optional dependency)
    const mssql = require('mssql');
    const sql = require('mssql');
    
    const config = {
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      server: process.env.DB_SERVER,
      database: process.env.DB_NAME,
      options: {
        encrypt: String(process.env.DB_ENCRYPT || 'false').toLowerCase() === 'true',
        trustServerCertificate: String(process.env.DB_TRUST_SERVER_CERTIFICATE || 'true').toLowerCase() === 'true',
        enableArithAbort: true,
      }
    };
    
    const pool = await sql.connect(config);
    return pool;
  } catch (err) {
    // MSSQL not available or connection failed - this is OK
    return null;
  }
}

async function migrateAds() {
  console.log('\n📊 Migrating Ads...');
  
  if (!supabase) {
    throw new Error('Supabase not configured');
  }

  // Check if ads table exists
  const tableCheck = await verifyTableExists('ads');
  if (!tableCheck.exists && !tableCheck.isCacheIssue) {
    throw new Error('Ads table does not exist in Supabase. Please run supabase-complete-schema.sql first.');
  }

  // Try to export from SQL Server
  let sqlServerAds = [];
  const mssqlPool = await getMSSQLPool();
  if (mssqlPool) {
    try {
      const result = await mssqlPool.request().query('SELECT Id, Campaign, DateChar, Leads, Spend, ActionsJson FROM Ads');
      sqlServerAds = result.recordset || [];
      console.log(`   Found ${sqlServerAds.length} ads in SQL Server`);
      await mssqlPool.close();
    } catch (err) {
      console.log('   ⚠️  Could not query SQL Server - skipping Ads export');
      console.log('   Error:', err.message);
      if (mssqlPool.close) await mssqlPool.close().catch(() => {});
    }
  } else {
    console.log('   ⚠️  SQL Server not configured or mssql package not available');
    console.log('   To migrate data, install mssql package and configure DB_SERVER in .env');
  }

  if (sqlServerAds.length === 0) {
    console.log('   ℹ️  No ads to migrate from SQL Server');
    return { migrated: 0, skipped: 0, errors: [] };
  }

  // Transform and insert into Supabase
  // Note: Ads table uses capitalized column names: Campaign, DateChar, Leads, Spend, ActionsJson
  const transformedAds = sqlServerAds.map(ad => ({
    Campaign: ad.Campaign,
    DateChar: ad.DateChar,
    Leads: ad.Leads || 0,
    Spend: ad.Spend ? parseFloat(ad.Spend) : 0,
    ActionsJson: typeof ad.ActionsJson === 'string' ? JSON.parse(ad.ActionsJson || '{}') : (ad.ActionsJson || {})
  }));

  // Use upsert to handle duplicates (based on date_char + campaign combination)
  // Note: Since Supabase generates IDs, we'll use upsert without specifying id
  const batchSize = 100;
  let migrated = 0;
  let skipped = 0;
  const errors = [];

  for (let i = 0; i < transformedAds.length; i += batchSize) {
    const batch = transformedAds.slice(i, i + batchSize);
    try {
      // Note: Table name is 'Ads' (capitalized) with capitalized column names
      const { error } = await supabase
        .from('Ads')
        .upsert(batch, {
          onConflict: 'Campaign,DateChar' // Assuming unique constraint on Campaign + DateChar
        });

      if (error) {
        // Try without conflict resolution (insert only)
        const { error: insertError } = await supabase
          .from('Ads')
          .insert(batch);

        if (insertError) {
          console.error(`   ❌ Error inserting batch ${Math.floor(i / batchSize) + 1}:`, insertError.message);
          errors.push({ batch: Math.floor(i / batchSize) + 1, error: insertError.message });
        } else {
          migrated += batch.length;
        }
      } else {
        migrated += batch.length;
      }
    } catch (err) {
      console.error(`   ❌ Error processing batch ${Math.floor(i / batchSize) + 1}:`, err.message);
      errors.push({ batch: Math.floor(i / batchSize) + 1, error: err.message });
    }
  }

  console.log(`   ✅ Migrated: ${migrated}`);
  console.log(`   ⏭️  Skipped: ${skipped}`);
  console.log(`   ❌ Errors: ${errors.length}`);
  return { migrated, skipped, errors };
}

async function migrateLeads() {
  console.log('\n📋 Migrating Leads...');
  
  if (!supabase) {
    throw new Error('Supabase not configured');
  }

  // Check if leads table exists
  const tableCheck = await verifyTableExists('leads');
  if (!tableCheck.exists && !tableCheck.isCacheIssue) {
    throw new Error('Leads table does not exist in Supabase. Please run supabase-complete-schema.sql first.');
  }

  // Try to export from SQL Server
  let sqlServerLeads = [];
  const mssqlPool = await getMSSQLPool();
  if (mssqlPool) {
    try {
      const result = await mssqlPool.request().query(`
        SELECT Id, Name, Phone, TimeUtc, DateChar, Campaign, ad_id, campaign_id, lead_id, form_id, page_id, created_time, ad_name
        FROM Leads
      `);
      sqlServerLeads = result.recordset || [];
      console.log(`   Found ${sqlServerLeads.length} leads in SQL Server`);
      await mssqlPool.close();
    } catch (err) {
      console.log('   ⚠️  Could not query SQL Server - skipping Leads export');
      console.log('   Error:', err.message);
      if (mssqlPool.close) await mssqlPool.close().catch(() => {});
    }
  } else {
    console.log('   ⚠️  SQL Server not configured or mssql package not available');
  }

  if (sqlServerLeads.length === 0) {
    console.log('   ℹ️  No leads to migrate from SQL Server');
    return { migrated: 0, skipped: 0, errors: [] };
  }

  // Transform and insert into Supabase
  // Table uses mixed case: Name, Phone, TimeUtc, DateChar, Campaign (capitalized)
  // and lowercase with underscores: ad_id, campaign_id, lead_id, etc.
  const transformedLeads = sqlServerLeads.map(lead => ({
    Name: lead.Name || 'N/A',
    Phone: lead.Phone || 'N/A',
    TimeUtc: lead.TimeUtc ? new Date(lead.TimeUtc).toISOString() : null,
    DateChar: lead.DateChar || null,
    Campaign: lead.Campaign || null,
    ad_id: lead.ad_id || null,
    campaign_id: lead.campaign_id || null,
    lead_id: lead.lead_id || null,
    form_id: lead.form_id || null,
    page_id: lead.page_id || null,
    created_time: lead.created_time ? new Date(lead.created_time).toISOString() : null,
    ad_name: lead.ad_name || null
  }));

  // Use upsert based on lead_id for duplicate handling
  const batchSize = 100;
  let migrated = 0;
  let skipped = 0;
  const errors = [];

  for (let i = 0; i < transformedLeads.length; i += batchSize) {
    const batch = transformedLeads.slice(i, i + batchSize);
    try {
      const { error } = await supabase
        .from('Leads')
        .upsert(batch, {
          onConflict: 'lead_id',
          ignoreDuplicates: false
        });

      if (error) {
        console.error(`   ❌ Error upserting batch ${Math.floor(i / batchSize) + 1}:`, error.message);
        errors.push({ batch: Math.floor(i / batchSize) + 1, error: error.message });
      } else {
        migrated += batch.length;
      }
    } catch (err) {
      console.error(`   ❌ Error processing batch ${Math.floor(i / batchSize) + 1}:`, err.message);
      errors.push({ batch: Math.floor(i / batchSize) + 1, error: err.message });
    }
  }

  console.log(`   ✅ Migrated: ${migrated}`);
  console.log(`   ⏭️  Skipped: ${skipped}`);
  console.log(`   ❌ Errors: ${errors.length}`);
  return { migrated, skipped, errors };
}

async function migrateJobState() {
  console.log('\n⚙️  Migrating Job State...');
  
  if (!supabase) {
    throw new Error('Supabase not configured');
  }

  // Check if JobState table exists (capitalized table name in Supabase)
  const tableCheck = await verifyTableExists('JobState');
  if (!tableCheck.exists && !tableCheck.isCacheIssue) {
    throw new Error('JobState table does not exist in Supabase. Please run supabase-complete-schema.sql first.');
  }

  // Try to export from SQL Server
  let sqlServerJobState = [];
  const mssqlPool = await getMSSQLPool();
  if (mssqlPool) {
    try {
      const result = await mssqlPool.request().query('SELECT JobKey, JobValue, UpdatedAt FROM JobState');
      sqlServerJobState = result.recordset || [];
      console.log(`   Found ${sqlServerJobState.length} job state entries in SQL Server`);
      await mssqlPool.close();
    } catch (err) {
      console.log('   ⚠️  Could not query SQL Server - skipping JobState export');
      console.log('   Error:', err.message);
      if (mssqlPool.close) await mssqlPool.close().catch(() => {});
    }
  } else {
    console.log('   ⚠️  SQL Server not configured or mssql package not available');
  }

  if (sqlServerJobState.length === 0) {
    console.log('   ℹ️  No job state to migrate from SQL Server');
    return { migrated: 0, skipped: 0, errors: [] };
  }

  // Transform and insert into Supabase
  // Note: JobState table uses capitalized column names: JobKey, JobValue, UpdatedAt
  const transformedJobState = sqlServerJobState.map(js => ({
    JobKey: js.JobKey,
    JobValue: js.JobValue || null,
    UpdatedAt: js.UpdatedAt ? new Date(js.UpdatedAt).toISOString() : new Date().toISOString()
  }));

  // Use upsert based on JobKey
  let migrated = 0;
  const errors = [];

  for (const js of transformedJobState) {
    try {
      const { error } = await supabase
        .from('JobState')
        .upsert(js, {
          onConflict: 'JobKey'
        });

      if (error) {
        console.error(`   ❌ Error upserting job state ${js.JobKey}:`, error.message);
        errors.push({ key: js.JobKey, error: error.message });
      } else {
        migrated++;
      }
    } catch (err) {
      console.error(`   ❌ Error processing job state ${js.JobKey}:`, err.message);
      errors.push({ key: js.JobKey, error: err.message });
    }
  }

  console.log(`   ✅ Migrated: ${migrated}`);
  console.log(`   ❌ Errors: ${errors.length}`);
  return { migrated, skipped: 0, errors };
}


async function main() {
  console.log('🚀 Starting Data Migration from SQL Server to Supabase...\n');
  console.log('═'.repeat(60));

  try {
    if (!supabase) {
      console.error('❌ Supabase not configured!');
      console.error('   Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in server/.env');
      process.exit(1);
    }

    // Verify all tables exist
    // Note: Actual table names in Supabase are: users (lowercase), Ads, Leads, JobState (capitalized)
    console.log('\n📋 Step 1: Verifying tables exist...');
    const tables = ['users', 'Ads', 'Leads', 'JobState'];
    for (const table of tables) {
      const check = await verifyTableExists(table);
      if (!check.exists && !check.isCacheIssue) {
        console.error(`❌ Table '${table}' does not exist!`);
        console.error(`   Please run supabase-complete-schema.sql in Supabase SQL Editor first`);
        process.exit(1);
      }
    }
    console.log('✅ All tables verified');
    console.log('   ℹ️  Note: Meta credentials are stored in .env file only, not in database\n');

    // Migrate data
    const results = {
      ads: { migrated: 0, skipped: 0, errors: [] },
      leads: { migrated: 0, skipped: 0, errors: [] },
      jobState: { migrated: 0, skipped: 0, errors: [] }
    };

    results.ads = await migrateAds();
    results.leads = await migrateLeads();
    results.jobState = await migrateJobState();

    // Summary
    console.log('\n═'.repeat(60));
    console.log('📊 Migration Summary:');
    console.log('═'.repeat(60));
    console.log(`Ads: ${results.ads.migrated} migrated, ${results.ads.skipped} skipped, ${results.ads.errors.length} errors`);
    console.log(`Leads: ${results.leads.migrated} migrated, ${results.leads.skipped} skipped, ${results.leads.errors.length} errors`);
    console.log(`Job State: ${results.jobState.migrated} migrated, ${results.jobState.skipped} skipped, ${results.jobState.errors.length} errors`);
    console.log(`Meta Credentials: Stored in .env file only (not migrated)`);

    const totalErrors = results.ads.errors.length + results.leads.errors.length + results.jobState.errors.length;
    if (totalErrors > 0) {
      console.log('\n⚠️  Some errors occurred during migration. Check logs above for details.');
    } else {
      console.log('\n✅ Migration completed successfully!');
    }

    console.log('\n📋 Next Steps:');
    console.log('   1. Refresh schema cache in Supabase Dashboard → Settings → API → Reload schema');
    console.log('   2. Verify data: npm run verify-supabase');
    console.log('   3. Test endpoints: npm start');
    console.log('');

  } catch (err) {
    console.error('\n❌ Migration failed:', err.message);
    console.error(err);
    process.exit(1);
  }
}

main();

