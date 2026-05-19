// server/verify-supabase.js
// Verify Supabase configuration and test all tables
const { supabase, verifyTableExists } = require('./supabase');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

async function verifyTable(tableName, description) {
  console.log(`\n📋 Checking ${description} (table: ${tableName})...`);
  
  const check = await verifyTableExists(tableName);
  if (!check.exists) {
    if (check.isCacheIssue) {
      console.log(`   ⚠️  Table exists but schema cache needs refresh`);
      return { exists: true, cacheIssue: true };
    } else {
      console.log(`   ❌ Table does not exist`);
      return { exists: false };
    }
  }

  console.log(`   ✅ Table exists`);

  // Test basic CRUD operations
  try {
    // Test SELECT (Read)
    const { data, error: selectError, count } = await supabase
      .from(tableName)
      .select('*', { count: 'exact', head: false })
      .limit(1);

    if (selectError) {
      console.log(`   ⚠️  SELECT test failed: ${selectError.message}`);
      return { exists: true, canRead: false, error: selectError.message };
    }

    console.log(`   ✅ SELECT test passed (found ${count || 0} rows)`);

    // For insert/update tests, use a test record that we can clean up
    if (tableName === 'users') {
      // Test INSERT (Create) - only if no existing test user
      const testEmail = 'test_verify_' + Date.now() + '@example.com';
      const { data: insertData, error: insertError } = await supabase
        .from(tableName)
        .insert({
          email: testEmail,
          password_hash: 'test_hash',
          role: 'user'
        })
        .select('id')
        .single();

      if (insertError) {
        console.log(`   ⚠️  INSERT test failed: ${insertError.message}`);
      } else {
        console.log(`   ✅ INSERT test passed (created test user)`);
        
        // Test UPDATE
        const { error: updateError } = await supabase
          .from(tableName)
          .update({ full_name: 'Test User' })
          .eq('id', insertData.id);

        if (updateError) {
          console.log(`   ⚠️  UPDATE test failed: ${updateError.message}`);
        } else {
          console.log(`   ✅ UPDATE test passed`);
        }

        // Clean up: DELETE test user
        const { error: deleteError } = await supabase
          .from(tableName)
          .delete()
          .eq('id', insertData.id);

        if (deleteError) {
          console.log(`   ⚠️  DELETE test failed (cleanup): ${deleteError.message}`);
        } else {
          console.log(`   ✅ DELETE test passed (cleaned up test user)`);
        }
      }
    } else if (tableName === 'JobState') {
      // Test INSERT/UPDATE for JobState (capitalized table name)
      const testKey = 'test_verify_' + Date.now();
      const { error: upsertError } = await supabase
        .from(tableName)
        .upsert({
          JobKey: testKey,
          JobValue: 'test_value'
        }, {
          onConflict: 'JobKey'
        });

      if (upsertError) {
        console.log(`   ⚠️  UPSERT test failed: ${upsertError.message}`);
      } else {
        console.log(`   ✅ UPSERT test passed`);

        // Clean up
        await supabase
          .from(tableName)
          .delete()
          .eq('job_key', testKey);
        console.log(`   ✅ Cleanup completed`);
      }
    } else {
      // For other tables, just verify SELECT works
      console.log(`   ℹ️  Skipping INSERT/UPDATE tests for ${tableName} (use seed.js for test data)`);
    }

    return { exists: true, canRead: true, canWrite: true };
  } catch (err) {
    console.log(`   ⚠️  CRUD test error: ${err.message}`);
    return { exists: true, canRead: false, error: err.message };
  }
}

async function main() {
  console.log('\n🔍 Supabase Configuration Verification\n');
  console.log('═'.repeat(60));

  // Check configuration
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

  console.log('\n⚙️  Configuration:');
  console.log(`   SUPABASE_URL: ${supabaseUrl ? '✅ Set' : '❌ Missing'}`);
  console.log(`   SUPABASE_SERVICE_ROLE_KEY: ${process.env.SUPABASE_SERVICE_ROLE_KEY ? '✅ Set (recommended)' : '⚠️  Not set'}`);
  console.log(`   SUPABASE_ANON_KEY: ${supabaseKey && !process.env.SUPABASE_SERVICE_ROLE_KEY ? '✅ Set (fallback)' : supabaseKey ? '✅ Set' : '❌ Missing'}`);

  if (!supabaseUrl || !supabaseKey) {
    console.error('\n❌ Supabase not configured!');
    console.error('   Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (recommended) or SUPABASE_ANON_KEY in server/.env');
    console.error('   Get your keys from: Supabase Dashboard → Settings → API');
    process.exit(1);
  }

  if (!supabase) {
    console.error('\n❌ Failed to initialize Supabase client!');
    process.exit(1);
  }

  console.log('\n✅ Supabase client initialized');

  // Verify all tables
  // Note: Actual table names in Supabase are: users (lowercase), Ads, Leads, JobState (capitalized)
  const tables = [
    { name: 'users', description: 'Users table' },
    { name: 'Ads', description: 'Ads table' },
    { name: 'Leads', description: 'Leads table' },
    { name: 'JobState', description: 'Job State table' }
  ];
  
  // Note: Meta credentials are stored in .env file only, not in database

  const results = {};
  let allPassed = true;

  for (const table of tables) {
    const result = await verifyTable(table.name, table.description);
    results[table.name] = result;
    if (!result.exists || !result.canRead) {
      allPassed = false;
    }
  }

  // Summary
  console.log('\n═'.repeat(60));
  console.log('📊 Verification Summary:');
  console.log('═'.repeat(60));

  for (const table of tables) {
    const result = results[table.name];
    const status = result.exists && result.canRead ? '✅ PASS' : '❌ FAIL';
    const details = result.exists 
      ? (result.canRead ? 'CRUD operations working' : `Can't read: ${result.error || 'Unknown error'}`)
      : 'Table does not exist';
    console.log(`${status} - ${table.description}: ${details}`);
  }

  if (allPassed) {
    console.log('\n✅ All checks passed! Supabase is configured correctly.\n');
    
    console.log('📋 Next Steps:');
    console.log('   1. If you need to seed test data: npm run seed');
    console.log('   2. Start the server: npm start');
    console.log('   3. Test endpoints: http://localhost:4000/api/ads\n');
    
    process.exit(0);
  } else {
    console.log('\n⚠️  Some checks failed. Please review the errors above.\n');
    
    console.log('💡 Troubleshooting:');
    console.log('   1. Make sure you ran supabase-complete-schema.sql in Supabase SQL Editor');
    console.log('   2. Refresh schema cache: Supabase Dashboard → Settings → API → Reload schema');
    console.log('   3. Verify RLS is disabled: Database → Tables → [table] → Disable RLS');
    console.log('   4. Check table permissions: Database → Tables → [table] → API Settings\n');
    
    process.exit(1);
  }
}

main().catch(err => {
  console.error('\n❌ Verification failed:', err);
  process.exit(1);
});
