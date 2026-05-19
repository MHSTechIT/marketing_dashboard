// server/db.js
// Supabase database module (replaces MSSQL)
const { supabase } = require('./supabase');

// For backward compatibility, export getPool as an async function that returns supabase client
// This allows existing code that calls await getPool() to continue working
async function getPool() {
  if (!supabase) {
    throw new Error('Supabase not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in server/.env');
  }
  return supabase;
}

// Export sql object for backward compatibility (though we won't use it)
// This prevents breaking existing imports
const sql = {
  // These are placeholders - actual queries will use Supabase client directly
  NVarChar: (length) => ({ type: 'text', length }),
  Char: (length) => ({ type: 'char', length }),
  Int: () => ({ type: 'integer' }),
  DateTime2: () => ({ type: 'timestamptz' }),
  Decimal: (precision, scale) => ({ type: 'numeric', precision, scale }),
  MAX: 'text'
};

module.exports = { supabase, getPool, sql };
