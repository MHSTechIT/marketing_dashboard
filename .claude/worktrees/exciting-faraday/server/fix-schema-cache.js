// server/fix-schema-cache.js
// This script helps refresh the PostgREST schema cache
// Run this after creating tables in Supabase

require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_ANON_KEY) are required');
  process.exit(1);
}

async function refreshSchemaCache() {
  console.log('🔄 Attempting to refresh PostgREST schema cache...\n');

  try {
    // Create a client with service role key (has full access)
    const supabase = createClient(supabaseUrl, supabaseKey, {
      db: { schema: 'public' },
      auth: { persistSession: false }
    });

    // Method 1: Try to notify PostgREST to reload schema
    // Note: This requires direct database access, so we'll use a workaround
    console.log('1. Checking if table is accessible...');
    
    // Try a simple query to see if it works (using lowercase table and column names)
    const { data, error } = await supabase
      .from('users')
      .select('id')
      .limit(1);

    if (!error) {
      console.log('✅ Table is accessible! Schema cache seems to be working.');
      return;
    }

    if (error.code === 'PGRST116' || error.message?.includes('schema cache')) {
      console.log('⚠️  Schema cache issue detected.\n');
      console.log('📝 Manual steps to fix:');
      console.log('');
      console.log('Option 1 - Reload in Dashboard (Recommended):');
      console.log('  1. Go to your Supabase Dashboard');
      console.log('  2. Navigate to Settings → API');
      console.log('  3. Scroll to "Schema" section');
      console.log('  4. Click "Reload schema" button');
      console.log('  5. Wait 10-30 seconds');
      console.log('');
      console.log('Option 2 - Run SQL Command:');
      console.log('  1. Go to Supabase Dashboard → SQL Editor');
      console.log('  2. Click "New Query"');
      console.log('  3. Run this SQL:');
      console.log('     SELECT pg_notify(\'pgrst\', \'reload schema\');');
      console.log('  4. Wait 10-30 seconds');
      console.log('');
      console.log('Option 3 - Verify Table Exists:');
      console.log('  1. Go to Database → Tables');
      console.log('  2. Make sure "users" table is visible');
      console.log('  3. Click on the "users" table');
      console.log('  4. Click "..." menu → "API Settings"');
      console.log('  5. Ensure "Expose to API" is enabled');
      console.log('');
      console.log('Option 4 - Wait for Auto-Refresh:');
      console.log('  Sometimes PostgREST auto-refreshes after 30-60 seconds.');
      console.log('  Wait a minute and try again.');
      console.log('');
      console.log('After refreshing, run: npm run verify-supabase');
    } else {
      console.error('❌ Unexpected error:', error.message);
    }

  } catch (err) {
    console.error('❌ Error:', err.message);
  }
}

refreshSchemaCache();

