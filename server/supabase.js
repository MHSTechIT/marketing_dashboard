// server/supabase.js
// MIGRATED: This module now points at a self-hosted PostgreSQL database via a
// Supabase-compatible query builder (see pgClient.js). All existing code that
// does `const { supabase } = require('../supabase')` and uses the chainable
// `.from(table).select().eq()...` API keeps working unchanged — it just runs
// against Postgres now instead of Supabase's hosted API.
//
// Connection is configured in server/.env:
//   DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD  (+ optional DB_SSL=true)
//
// To temporarily revert to the hosted Supabase client, set USE_SUPABASE_HOSTED=true
// in server/.env (requires SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY).

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const useHosted = String(process.env.USE_SUPABASE_HOSTED || '').toLowerCase() === 'true';

let supabase;
let verifyTableExists;

if (useHosted) {
  // ---- Legacy hosted Supabase client (opt-in fallback) ----
  const { createClient } = require('@supabase/supabase-js');
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error('❌ USE_SUPABASE_HOSTED=true but SUPABASE_URL / key not set in server/.env');
  }

  supabase = supabaseUrl && supabaseKey
    ? createClient(supabaseUrl, supabaseKey, {
        auth: { autoRefreshToken: false, persistSession: false },
        db: { schema: 'public' },
      })
    : null;

  verifyTableExists = async function (tableName = 'users') {
    if (!supabase) return { exists: false, error: 'Supabase not configured' };
    try {
      const { error } = await supabase.from(tableName).select('id').limit(1);
      if (error) {
        if (error.message?.includes('schema cache')) return { exists: true, error: 'Schema cache needs refresh', isCacheIssue: true };
        if (error.code === 'PGRST116') return { exists: false, error: `Table '${tableName}' does not exist` };
        return { exists: false, error: error.message || 'Unknown error' };
      }
      return { exists: true };
    } catch (err) {
      return { exists: false, error: err.message };
    }
  };

  console.log('[DB] Using HOSTED Supabase client (USE_SUPABASE_HOSTED=true)');
} else {
  // ---- Self-hosted Postgres via compatibility layer (default) ----
  const pg = require('./pgClient');
  supabase = pg.supabase;
  verifyTableExists = pg.verifyTableExists;
  if (supabase) {
    console.log('[DB] Using self-hosted PostgreSQL (' + (process.env.DB_HOST || 'unconfigured') + ':' + (process.env.DB_PORT || '5432') + '/' + (process.env.DB_NAME || '') + ')');
  }
}

module.exports = { supabase, verifyTableExists };
