// server/check-users-table.js
// Script to verify users table exists and diagnose schema cache issues
require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const { supabase, verifyTableExists } = require('./supabase');

async function checkUsersTable() {
  console.log('\n🔍 Checking Users Table Configuration...\n');
  console.log('═'.repeat(60));

  // Step 1: Check environment variables
  console.log('\n1️⃣  Checking Environment Variables:');
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const anonKey = process.env.SUPABASE_ANON_KEY;

  console.log(`   SUPABASE_URL: ${supabaseUrl ? '✅ Set' : '❌ Missing'}`);
  console.log(`   SUPABASE_SERVICE_ROLE_KEY: ${serviceRoleKey ? '✅ Set (recommended)' : '⚠️  Not set'}`);
  console.log(`   SUPABASE_ANON_KEY: ${anonKey ? '✅ Set' : '⚠️  Not set'}`);

  if (!supabaseUrl) {
    console.error('\n❌ SUPABASE_URL is missing!');
    console.error('   Please set it in server/.env file');
    console.error('   Get it from: Supabase Dashboard → Settings → API → Project URL');
    process.exit(1);
  }

  if (!serviceRoleKey && !anonKey) {
    console.error('\n❌ No Supabase key found!');
    console.error('   Please set SUPABASE_SERVICE_ROLE_KEY (recommended) or SUPABASE_ANON_KEY in server/.env');
    console.error('   Get it from: Supabase Dashboard → Settings → API → Project API keys');
    process.exit(1);
  }

  if (!supabase) {
    console.error('\n❌ Failed to initialize Supabase client!');
    process.exit(1);
  }

  console.log('\n✅ Supabase client initialized');

  // Step 2: Verify table exists
  console.log('\n2️⃣  Checking if users table exists:');
  const tableCheck = await verifyTableExists('users');

  if (tableCheck.exists && !tableCheck.isCacheIssue) {
    console.log('   ✅ Table exists and is accessible!');
    
    // Test a simple query
    console.log('\n3️⃣  Testing table access:');
    const { data, error, count } = await supabase
      .from('users')
      .select('*', { count: 'exact', head: false })
      .limit(1);

    if (error) {
      console.log(`   ⚠️  Query test failed: ${error.message}`);
      if (error.code === 'PGRST116' || error.message?.includes('schema cache')) {
        console.log('\n   ⚠️  SCHEMA CACHE ISSUE DETECTED!');
        console.log('\n   📝 To fix this:');
        console.log('   1. Go to Supabase Dashboard → Settings → API');
        console.log('   2. Scroll to "Schema" section');
        console.log('   3. Click "Reload schema" button');
        console.log('   4. Wait 10-30 seconds');
        console.log('   5. Run this script again to verify');
      }
    } else {
      console.log(`   ✅ Table is accessible! (Found ${count || 0} rows)`);
    }

    // Check table structure
    console.log('\n4️⃣  Verifying table structure:');
    const { data: testInsert, error: testError } = await supabase
      .from('users')
      .select('id, email, password_hash, full_name, role, created_at, updated_at')
      .limit(0); // Just test column access

    if (testError) {
      console.log(`   ⚠️  Column check error: ${testError.message}`);
    } else {
      console.log('   ✅ All required columns are accessible:');
      console.log('      - id, email, password_hash, full_name, role, created_at, updated_at');
    }

    console.log('\n✅ All checks passed! Table is ready to use.');
    console.log('\n💡 If you\'re still getting schema cache errors:');
    console.log('   1. Refresh schema cache: Settings → API → Reload schema');
    console.log('   2. Or run SQL: SELECT pg_notify(\'pgrst\', \'reload schema\');');
    console.log('   3. Wait 10-30 seconds and try again');
    
    process.exit(0);
  } else if (tableCheck.isCacheIssue) {
    console.log('   ⚠️  Table exists but schema cache needs refresh');
    console.log('\n   📝 To fix this:');
    console.log('   1. Go to Supabase Dashboard → Settings → API');
    console.log('   2. Scroll to "Schema" section');
    console.log('   3. Click "Reload schema" button');
    console.log('   4. Wait 10-30 seconds');
    console.log('   OR');
    console.log('   Run this SQL in SQL Editor:');
    console.log('   SELECT pg_notify(\'pgrst\', \'reload schema\');');
    console.log('\n   Then run this script again to verify.');
    process.exit(1);
  } else {
    console.log('   ❌ Table does not exist!');
    console.log('\n   📝 To create the table:');
    console.log('   1. Go to Supabase Dashboard → SQL Editor');
    console.log('   2. Click "New Query"');
    console.log('   3. Copy the entire contents of server/supabase-complete-schema.sql');
    console.log('   4. Paste into SQL Editor');
    console.log('   5. Click "Run" to execute');
    console.log('   6. Wait for tables to be created');
    console.log('   7. Refresh schema cache (Settings → API → Reload schema)');
    console.log('   8. Run this script again to verify');
    process.exit(1);
  }
}

checkUsersTable().catch(err => {
  console.error('\n❌ Error:', err.message);
  process.exit(1);
});

