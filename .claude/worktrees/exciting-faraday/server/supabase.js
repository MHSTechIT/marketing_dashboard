// server/supabase.js
const { createClient } = require('@supabase/supabase-js');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const supabaseUrl = process.env.SUPABASE_URL;
// Prefer service_role key for backend operations (bypasses RLS)
// Fallback to anon key if service_role is not available
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Supabase credentials not found!');
  console.error('   Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (recommended) or SUPABASE_ANON_KEY in server/.env');
  console.error('   Get your keys from: Supabase Dashboard → Settings → API');
}

// Create Supabase client with proper configuration
const supabase = supabaseUrl && supabaseKey 
  ? createClient(supabaseUrl, supabaseKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      },
      db: {
        schema: 'public'
      }
    })
  : null;

// Helper function to verify table exists
async function verifyTableExists(tableName = 'users') {
  if (!supabase) {
    return { exists: false, error: 'Supabase not configured' };
  }

  try {
    // All tables now use lowercase column names
    const { error } = await supabase
      .from(tableName)
      .select('id')
      .limit(1);

    if (error) {
      // Check for schema cache error
      if (error.message?.includes('schema cache') || error.details?.includes('schema cache')) {
        return { exists: true, error: 'Schema cache needs refresh', isCacheIssue: true };
      }
      
      // Table does not exist
      if (error.code === 'PGRST116') {
        return { exists: false, error: `Table '${tableName}' does not exist` };
      }
      
      return { exists: false, error: error.message || 'Unknown error' };
    }
    
    return { exists: true };
  } catch (err) {
    return { exists: false, error: err.message };
  }
}

module.exports = { supabase, verifyTableExists };

