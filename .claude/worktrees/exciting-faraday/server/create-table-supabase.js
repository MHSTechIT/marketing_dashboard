// server/create-table-supabase.js
// Attempts to create the users table in Supabase programmatically
// If this fails, you'll need to run the SQL manually in Supabase SQL Editor

require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_ANON_KEY) are required');
  process.exit(1);
}

async function createTable() {
  console.log('🔨 Attempting to create users table in Supabase...\n');

  // Note: Supabase JS client cannot execute DDL (CREATE TABLE) statements
  // We need to use Supabase's SQL editor or REST API
  // Let's check if table already exists first
  
  const supabase = createClient(supabaseUrl, supabaseKey, {
    db: { schema: 'public' },
    auth: { persistSession: false }
  });

  // Check if table already exists (using correct table and column names)
  console.log('1. Checking if table already exists...');
  const { data, error } = await supabase
    .from('Users')
    .select('Id')
    .limit(1);

  if (!error) {
    console.log('✅ Table already exists! No need to create it.');
    console.log('   You can proceed with verification: npm run verify-supabase\n');
    return true;
  }

  if (error.code === 'PGRST116' || error.message?.includes('schema cache')) {
    console.log('⚠️  Cannot execute CREATE TABLE via Supabase JS client.');
    console.log('   PostgREST API does not support DDL (CREATE TABLE) statements.\n');
    console.log('📝 You need to run the SQL manually:\n');
    console.log('─'.repeat(60));
    
    const schemaSQL = fs.readFileSync(path.join(__dirname, 'supabase-schema.sql'), 'utf8');
    console.log(schemaSQL);
    
    console.log('─'.repeat(60));
    console.log('\n📋 Steps to execute:');
    console.log('   1. Go to: https://supabase.com/dashboard');
    console.log('   2. Select your project');
    console.log('   3. Go to: SQL Editor');
    console.log('   4. Click: "New Query"');
    console.log('   5. Copy the SQL above and paste it');
    console.log('   6. Click: "Run" (or press Ctrl+Enter)');
    console.log('   7. Wait 30-60 seconds for schema cache refresh');
    console.log('   8. Run: npm run verify-supabase\n');
    return false;
  }

  console.error('❌ Unexpected error:', error.message);
  return false;
}

createTable().catch(err => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});

