// server/migrate-supabase-to-postgres.js
// One-time migration: copy schema + data from Supabase's Postgres to the self-hosted Postgres.
// Uses the `pg` driver directly against BOTH databases (no pg_dump needed).
//
// Usage:  node migrate-supabase-to-postgres.js
//
// Source (Supabase) and target (self-hosted) connection params are set below.
// It introspects every table in the public schema of the source, recreates it
// on the target (columns, types, NOT NULL, defaults, primary key, unique
// constraints), then copies all rows in batches and resets identity sequences.

const { Client } = require('pg');

// ---- SOURCE: Supabase Postgres (direct connection) ----
const SOURCE = {
  host: 'db.vloeouosnhryscqugyhw.supabase.co',
  port: 5432,
  user: 'postgres',
  password: 'Yuvirat18@vk',
  database: 'postgres',
  ssl: { rejectUnauthorized: false },
  // Supabase can be slow to connect from some networks
  connectionTimeoutMillis: 30000,
  statement_timeout: 0,
};

// ---- TARGET: self-hosted Postgres ----
const TARGET = {
  host: process.env.DB_HOST || '13.234.115.104',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || '$erver2026',
  database: process.env.DB_NAME || 'marketing_dashboard',
  ssl: String(process.env.DB_SSL || '').toLowerCase() === 'true' ? { rejectUnauthorized: false } : false,
  connectionTimeoutMillis: 30000,
  statement_timeout: 0,
};

require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const BATCH = 500;

function q(id) { return '"' + String(id).replace(/"/g, '""') + '"'; }

async function getTables(src) {
  const r = await src.query(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    ORDER BY table_name
  `);
  return r.rows.map((x) => x.table_name);
}

async function getColumns(src, table) {
  // Use pg_catalog for exact type strings (format_type) + defaults + notnull
  const r = await src.query(`
    SELECT
      a.attname AS name,
      pg_catalog.format_type(a.atttypid, a.atttypmod) AS type,
      a.attnotnull AS notnull,
      pg_get_expr(ad.adbin, ad.adrelid) AS default_expr,
      a.attnum AS ord
    FROM pg_attribute a
    LEFT JOIN pg_attrdef ad ON ad.adrelid = a.attrelid AND ad.adnum = a.attnum
    WHERE a.attrelid = format('public.%I', $1::text)::regclass
      AND a.attnum > 0
      AND NOT a.attisdropped
    ORDER BY a.attnum
  `, [table]);
  return r.rows;
}

async function getPrimaryKey(src, table) {
  const r = await src.query(`
    SELECT a.attname AS col
    FROM pg_index i
    JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
    WHERE i.indrelid = format('public.%I', $1::text)::regclass AND i.indisprimary
    ORDER BY array_position(i.indkey, a.attnum)
  `, [table]);
  return r.rows.map((x) => x.col);
}

async function getUniqueIndexDefs(src, table) {
  // Get full CREATE statements for all UNIQUE indexes that are NOT the primary key.
  // Using pg_get_indexdef guarantees correct column lists, expressions, and ordering.
  // These indexes are what ON CONFLICT (upsert) relies on.
  const r = await src.query(`
    SELECT i.relname AS index_name,
           pg_get_indexdef(ix.indexrelid) AS indexdef
    FROM pg_index ix
    JOIN pg_class i ON i.oid = ix.indexrelid
    WHERE ix.indrelid = format('public.%I', $1::text)::regclass
      AND ix.indisunique
      AND NOT ix.indisprimary
  `, [table]);
  return r.rows;
}

function buildCreateTable(table, cols, pk) {
  const lines = cols.map((c) => {
    let def = `  ${q(c.name)} ${c.type}`;
    // Skip nextval defaults (identity/serial) — we copy explicit values and reset sequence later
    const isSerial = c.default_expr && /nextval\(/i.test(c.default_expr);
    if (c.default_expr && !isSerial) def += ` DEFAULT ${c.default_expr}`;
    if (c.notnull) def += ' NOT NULL';
    return def;
  });
  if (pk.length) {
    lines.push(`  PRIMARY KEY (${pk.map(q).join(', ')})`);
  }
  return `CREATE TABLE ${q(table)} (\n${lines.join(',\n')}\n)`;
}

async function copyData(src, tgt, table, cols) {
  const colNames = cols.map((c) => c.name);
  const colList = colNames.map(q).join(', ');

  // total count
  const cres = await src.query(`SELECT COUNT(*)::bigint AS n FROM ${q(table)}`);
  const total = parseInt(cres.rows[0].n, 10);
  if (total === 0) return 0;

  let copied = 0;
  let offset = 0;
  // order by ctid for stable pagination (works on any table)
  while (offset < total) {
    const sel = await src.query(`SELECT ${colList} FROM ${q(table)} ORDER BY ctid LIMIT ${BATCH} OFFSET ${offset}`);
    const rows = sel.rows;
    if (rows.length === 0) break;

    // Build multi-row insert
    const params = [];
    const valuesSql = rows.map((row) => {
      const ph = colNames.map((cn) => {
        params.push(row[cn] === undefined ? null : row[cn]);
        return `$${params.length}`;
      });
      return '(' + ph.join(', ') + ')';
    }).join(', ');

    const insertSql = `INSERT INTO ${q(table)} (${colList}) VALUES ${valuesSql} ON CONFLICT DO NOTHING`;
    await tgt.query(insertSql, params);

    copied += rows.length;
    offset += rows.length;
    process.stdout.write(`\r    ${table}: ${copied}/${total} rows`);
  }
  process.stdout.write('\n');
  return copied;
}

async function resetSequences(src, tgt, table, cols) {
  // For columns with nextval default, set the sequence to max(col)
  for (const c of cols) {
    if (c.default_expr && /nextval\(/i.test(c.default_expr)) {
      try {
        // create a sequence and attach, or reuse existing identity
        const seqName = `${table}_${c.name}_seq`;
        await tgt.query(`CREATE SEQUENCE IF NOT EXISTS ${q(seqName)}`);
        await tgt.query(`ALTER TABLE ${q(table)} ALTER COLUMN ${q(c.name)} SET DEFAULT nextval('${seqName.replace(/'/g, "''")}')`);
        await tgt.query(`ALTER SEQUENCE ${q(seqName)} OWNED BY ${q(table)}.${q(c.name)}`);
        const mx = await tgt.query(`SELECT COALESCE(MAX(${q(c.name)}), 0)::bigint AS m FROM ${q(table)}`);
        const next = parseInt(mx.rows[0].m, 10) + 1;
        await tgt.query(`SELECT setval('${seqName.replace(/'/g, "''")}', ${next}, false)`);
      } catch (e) {
        console.warn(`    [seq] ${table}.${c.name}: ${e.message}`);
      }
    }
  }
}

async function main() {
  const src = new Client(SOURCE);
  const tgt = new Client(TARGET);

  console.log('Connecting to Supabase (source)...');
  await src.connect();
  console.log('Connecting to self-hosted Postgres (target)...');
  await tgt.connect();

  const tables = await getTables(src);
  console.log(`\nFound ${tables.length} tables in Supabase public schema:\n  ${tables.join(', ')}\n`);

  const summary = [];

  for (const table of tables) {
    console.log(`\n=== ${table} ===`);
    const cols = await getColumns(src, table);
    const pk = await getPrimaryKey(src, table);
    const uniqueDefs = await getUniqueIndexDefs(src, table);

    // 1) Recreate table (drop if exists to allow clean re-runs)
    await tgt.query(`DROP TABLE IF EXISTS ${q(table)} CASCADE`);
    const ddl = buildCreateTable(table, cols, pk);
    await tgt.query(ddl);
    console.log(`  created (${cols.length} cols${pk.length ? ', PK: ' + pk.join(',') : ''})`);

    // 2) Unique indexes (needed for app upserts with onConflict).
    //    Created before data copy so the indexes exist and the migration's own
    //    ON CONFLICT DO NOTHING can dedupe if needed.
    for (const u of uniqueDefs) {
      try {
        // pg_get_indexdef gives "CREATE UNIQUE INDEX name ON public.table USING ..."
        // Make it idempotent.
        const def = u.indexdef.replace(/^CREATE UNIQUE INDEX /i, 'CREATE UNIQUE INDEX IF NOT EXISTS ');
        await tgt.query(def);
        console.log(`  + unique index ${u.index_name}`);
      } catch (e) {
        console.warn(`  ! unique index ${u.index_name}: ${e.message}`);
      }
    }

    // 3) Copy data
    const copied = await copyData(src, tgt, table, cols);

    // 4) Reset sequences
    await resetSequences(src, tgt, table, cols);

    summary.push({ table, rows: copied });
  }

  console.log('\n\n========== MIGRATION SUMMARY ==========');
  summary.forEach((s) => console.log(`  ${s.table.padEnd(35)} ${s.rows} rows`));
  console.log('=======================================');

  await src.end();
  await tgt.end();
  console.log('\nDone. Next: set USE_SUPABASE_HOSTED=false in server/.env and restart the server.');
}

main().catch((e) => {
  console.error('\nMIGRATION FAILED:', e.message);
  process.exit(1);
});
