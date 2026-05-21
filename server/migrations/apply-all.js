#!/usr/bin/env node
/**
 * Apply all database migrations in a safe, idempotent order.
 *
 * Every migration uses CREATE TABLE / ADD COLUMN ... IF NOT EXISTS and
 * ON CONFLICT, so this script is safe to re-run. Use it to bring a fresh
 * Supabase/Postgres database (or one that drifted) up to the schema the app
 * expects — this prevents the "table/column never created" class of runtime
 * errors (e.g. lead_scores missing, leads.city missing).
 *
 * Usage:
 *   DATABASE_URL="postgresql://postgres:PASSWORD@db.<ref>.supabase.co:5432/postgres" \
 *     node migrations/apply-all.js
 *
 * Or set PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE. Get the connection string
 * from Supabase: Project Settings -> Database -> Connection string (URI).
 */
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

// Ordered so table-creation runs before data consolidation.
const FILES = [
  '../supabase-migration-leads-city-street.sql', // leads.city/street/form_name
  'lead-scores.sql',
  'lead-scores-mhs-intelligence.sql',
  'campaign-saturation-log.sql',
  'creative-fatigue-log.sql',
  'plan-tables.sql',
  'instagram-story-snapshots.sql',
  'unique-leads-tables.sql',
  'unique-leads-add-direct-walk-in.sql',
  'unique-leads-v2-unified.sql',
];

function buildClient() {
  const url = (process.env.DATABASE_URL || '').trim();
  if (url) {
    return new Client({ connectionString: url, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 20000 });
  }
  if (process.env.PGHOST && process.env.PGPASSWORD) {
    return new Client({
      host: process.env.PGHOST,
      port: parseInt(process.env.PGPORT, 10) || 5432,
      user: process.env.PGUSER || 'postgres',
      password: process.env.PGPASSWORD,
      database: process.env.PGDATABASE || 'postgres',
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 20000,
    });
  }
  throw new Error('Set DATABASE_URL (postgresql://...) or PGHOST/PGPASSWORD env vars. See Supabase -> Settings -> Database.');
}

(async () => {
  const client = buildClient();
  await client.connect();
  console.log('[migrations] connected');
  let ok = 0, failed = 0;
  for (const rel of FILES) {
    const file = path.resolve(__dirname, rel);
    if (!fs.existsSync(file)) { console.warn('[migrations] SKIP (not found):', rel); continue; }
    try {
      await client.query(fs.readFileSync(file, 'utf8'));
      console.log('[migrations] applied:', rel);
      ok++;
    } catch (e) {
      console.error('[migrations] FAILED:', rel, '-', e.message);
      failed++;
    }
  }
  await client.end();
  console.log(`[migrations] done — ${ok} applied, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('[migrations] fatal:', e.message); process.exit(1); });
