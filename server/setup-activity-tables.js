// One-time setup: create the page-visit / activity tracking tables.
// Safe to run repeatedly (CREATE TABLE IF NOT EXISTS).
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const { Client } = require('pg');

(async () => {
  const cfg = {
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT || '5432', 10),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    ssl: String(process.env.DB_SSL).toLowerCase() === 'true' ? { rejectUnauthorized: false } : false,
    connectionTimeoutMillis: 15000,
  };
  const c = new Client(cfg);
  try {
    await c.connect();
    const sql = fs.readFileSync(path.join(__dirname, 'migrations', 'page-visit-tracking.sql'), 'utf8');
    await c.query(sql);
    console.log('✓ Tables created/verified: user_activity_logs, user_sessions');
    const t = await c.query("SELECT table_name FROM information_schema.tables WHERE table_name IN ('user_activity_logs','user_sessions') ORDER BY table_name");
    console.log('  present:', t.rows.map(r => r.table_name).join(', '));
    const idType = await c.query("SELECT data_type FROM information_schema.columns WHERE table_name='users' AND column_name='id'");
    console.log('  users.id type:', idType.rows[0] && idType.rows[0].data_type);
    await c.end();
  } catch (e) {
    console.error('ERROR:', e.message);
    try { await c.end(); } catch {}
    process.exit(1);
  }
})();
