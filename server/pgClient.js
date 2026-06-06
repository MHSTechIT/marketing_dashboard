// server/pgClient.js
// Supabase-compatible query builder running on a raw PostgreSQL connection (node-postgres).
// This lets all existing repository code (which uses the supabase-js chainable API:
//   supabase.from(table).select().eq().in().order()... and .insert/.update/.upsert/.delete)
// keep working unchanged against a self-hosted Postgres database.
//
// Supported chain methods:
//   .from(table)
//   .select(cols, { count, head })  .insert(rows,{count})  .update(values,{count})
//   .upsert(rows,{ onConflict, ignoreDuplicates, count })  .delete({count})
//   filters: .eq .neq .gt .gte .lt .lte .in .like .ilike .is .not(col,op,val)
//            .filter(col,op,val) .match(obj) .or(strExpr)
//   modifiers: .order(col,{ascending,nullsFirst}) .limit(n) .range(from,to)
//              .single() .maybeSingle()
//   awaiting the builder resolves to { data, error, count } (Supabase shape).

const { Pool } = require('pg');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const DB_HOST = process.env.DB_HOST;
const DB_PORT = process.env.DB_PORT ? parseInt(process.env.DB_PORT, 10) : 5432;
const DB_NAME = process.env.DB_NAME;
const DB_USER = process.env.DB_USER;
const DB_PASSWORD = process.env.DB_PASSWORD;

let pool = null;
if (DB_HOST && DB_NAME && DB_USER) {
  pool = new Pool({
    host: DB_HOST,
    port: DB_PORT,
    database: DB_NAME,
    user: DB_USER,
    password: DB_PASSWORD,
    max: parseInt(process.env.DB_POOL_MAX || '10', 10),
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
    // Most self-hosted Postgres on a raw IP has no TLS. Enable via DB_SSL=true if needed.
    ssl: String(process.env.DB_SSL || '').toLowerCase() === 'true'
      ? { rejectUnauthorized: false }
      : false,
  });
  pool.on('error', (err) => {
    console.error('[pgClient] Idle client error:', err.message);
  });
} else {
  console.error('❌ Postgres credentials not found! Set DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD in server/.env');
}

// Quote an identifier (table/column) to preserve case and avoid keyword clashes.
function qIdent(name) {
  return '"' + String(name).replace(/"/g, '""') + '"';
}

// Map a column reference that may include schema/table prefixes; we only quote the column.
function qCol(col) {
  // Allow already-simple identifiers. Quote each dotted part.
  return String(col)
    .split('.')
    .map((p) => qIdent(p))
    .join('.');
}

// PostgREST operator name -> SQL operator
const OP_MAP = {
  eq: '=',
  neq: '<>',
  gt: '>',
  gte: '>=',
  lt: '<',
  lte: '<=',
  like: 'LIKE',
  ilike: 'ILIKE',
};

class PgQueryBuilder {
  constructor(table) {
    this.table = table;
    this._mutation = null; // null|'insert'|'update'|'upsert'|'delete'
    this._columns = '*';
    this._values = null;
    this._filters = []; // { type, col, op, val }
    this._orGroups = []; // array of raw PostgREST or-expressions
    this._order = [];
    this._limit = null;
    this._offset = null;
    this._single = false;
    this._maybeSingle = false;
    this._count = null; // 'exact' | 'planned' | 'estimated'
    this._head = false;
    this._onConflict = null;
    this._ignoreDuplicates = false;
    this._returning = null;
  }

  // ---- primary operations ----
  select(columns = '*', opts = {}) {
    if (this._mutation) {
      // .select() after a mutation = RETURNING clause
      this._returning = columns || '*';
    } else {
      this._columns = columns || '*';
      if (opts && opts.count) this._count = opts.count;
      if (opts && opts.head) this._head = true;
    }
    return this;
  }

  insert(values, opts = {}) {
    this._mutation = 'insert';
    this._values = Array.isArray(values) ? values : [values];
    if (opts && opts.count) this._count = opts.count;
    return this;
  }

  update(values, opts = {}) {
    this._mutation = 'update';
    this._values = values;
    if (opts && opts.count) this._count = opts.count;
    return this;
  }

  upsert(values, opts = {}) {
    this._mutation = 'upsert';
    this._values = Array.isArray(values) ? values : [values];
    this._onConflict = opts && opts.onConflict ? opts.onConflict : null;
    this._ignoreDuplicates = !!(opts && opts.ignoreDuplicates);
    if (opts && opts.count) this._count = opts.count;
    return this;
  }

  delete(opts = {}) {
    this._mutation = 'delete';
    if (opts && opts.count) this._count = opts.count;
    return this;
  }

  // ---- filters ----
  eq(col, val) { this._filters.push({ col, op: '=', val }); return this; }
  neq(col, val) { this._filters.push({ col, op: '<>', val }); return this; }
  gt(col, val) { this._filters.push({ col, op: '>', val }); return this; }
  gte(col, val) { this._filters.push({ col, op: '>=', val }); return this; }
  lt(col, val) { this._filters.push({ col, op: '<', val }); return this; }
  lte(col, val) { this._filters.push({ col, op: '<=', val }); return this; }
  like(col, pattern) { this._filters.push({ col, op: 'LIKE', val: pattern }); return this; }
  ilike(col, pattern) { this._filters.push({ col, op: 'ILIKE', val: pattern }); return this; }
  in(col, arr) { this._filters.push({ col, op: 'IN', val: Array.isArray(arr) ? arr : [arr] }); return this; }

  is(col, val) {
    // val is typically null, true, false
    this._filters.push({ col, op: 'IS', val });
    return this;
  }

  not(col, op, val) {
    this._filters.push({ col, op: 'NOT', notOp: op, val });
    return this;
  }

  filter(col, op, val) {
    // PostgREST-style operator string
    this._filters.push({ col, op: 'PGRST', pgrstOp: op, val });
    return this;
  }

  match(obj) {
    for (const k of Object.keys(obj || {})) {
      this._filters.push({ col: k, op: '=', val: obj[k] });
    }
    return this;
  }

  or(expr) {
    this._orGroups.push(expr);
    return this;
  }

  // ---- modifiers ----
  order(col, opts = {}) {
    this._order.push({
      col,
      ascending: opts.ascending !== false,
      nullsFirst: opts.nullsFirst,
    });
    return this;
  }

  limit(n) { this._limit = n; return this; }

  range(from, to) {
    this._offset = from;
    this._limit = to - from + 1;
    return this;
  }

  single() { this._single = true; return this; }
  maybeSingle() { this._maybeSingle = true; return this; }

  // ---- SQL building ----
  _filterToSql(f, params) {
    const colSql = qCol(f.col);
    if (f.op === 'IN') {
      params.push(f.val);
      return `${colSql} = ANY($${params.length})`;
    }
    if (f.op === 'IS') {
      if (f.val === null) return `${colSql} IS NULL`;
      if (f.val === true) return `${colSql} IS TRUE`;
      if (f.val === false) return `${colSql} IS FALSE`;
      params.push(f.val);
      return `${colSql} IS NOT DISTINCT FROM $${params.length}`;
    }
    if (f.op === 'NOT') {
      // .not(col, op, val) e.g. .not('x','like','%,%') or .not('x','is',null)
      const inner = this._buildOperatorClause(colSql, f.notOp, f.val, params);
      return `NOT (${inner})`;
    }
    if (f.op === 'PGRST') {
      return this._buildOperatorClause(colSql, f.pgrstOp, f.val, params);
    }
    // simple SQL operators (=,<>,>,>=,<,<=,LIKE,ILIKE)
    params.push(f.val);
    return `${colSql} ${f.op} $${params.length}`;
  }

  // Build a clause from a PostgREST operator name (used by .not and .filter)
  _buildOperatorClause(colSql, op, val, params) {
    const o = String(op).toLowerCase();
    if (o === 'is') {
      if (val === null || val === 'null') return `${colSql} IS NULL`;
      if (val === true || val === 'true') return `${colSql} IS TRUE`;
      if (val === false || val === 'false') return `${colSql} IS FALSE`;
      params.push(val);
      return `${colSql} IS NOT DISTINCT FROM $${params.length}`;
    }
    if (o === 'in') {
      // val may be array or "(a,b,c)" string
      let arr = val;
      if (typeof val === 'string') {
        arr = val.replace(/^\(/, '').replace(/\)$/, '').split(',').map((s) => s.trim().replace(/^"(.*)"$/, '$1'));
      }
      params.push(arr);
      return `${colSql} = ANY($${params.length})`;
    }
    const sqlOp = OP_MAP[o] || o;
    params.push(val);
    return `${colSql} ${sqlOp} $${params.length}`;
  }

  // Parse a PostgREST .or() expression: "col.op.val,col2.op2.(a,b)"
  // Split on top-level commas (depth 0), then each token is col.op.value
  _orToSql(expr, params) {
    const tokens = [];
    let depth = 0;
    let cur = '';
    for (const ch of String(expr)) {
      if (ch === '(') depth++;
      if (ch === ')') depth--;
      if (ch === ',' && depth === 0) {
        tokens.push(cur);
        cur = '';
      } else {
        cur += ch;
      }
    }
    if (cur) tokens.push(cur);

    const clauses = tokens.map((tok) => {
      // tok = col.op.value  (value may contain dots / parens)
      const firstDot = tok.indexOf('.');
      const secondDot = tok.indexOf('.', firstDot + 1);
      const col = tok.slice(0, firstDot);
      const op = tok.slice(firstDot + 1, secondDot);
      const val = tok.slice(secondDot + 1);
      return this._buildOperatorClause(qCol(col), op, val, params);
    });
    return clauses.join(' OR ');
  }

  _buildWhere(params) {
    const clauses = [];
    for (const f of this._filters) {
      clauses.push(this._filterToSql(f, params));
    }
    for (const orExpr of this._orGroups) {
      clauses.push('(' + this._orToSql(orExpr, params) + ')');
    }
    return clauses.length ? ' WHERE ' + clauses.join(' AND ') : '';
  }

  _buildOrderLimit() {
    let sql = '';
    if (this._order.length) {
      const parts = this._order.map((o) => {
        const dir = o.ascending ? 'ASC' : 'DESC';
        let nulls = '';
        if (o.nullsFirst === true) nulls = ' NULLS FIRST';
        else if (o.nullsFirst === false) nulls = ' NULLS LAST';
        return `${qCol(o.col)} ${dir}${nulls}`;
      });
      sql += ' ORDER BY ' + parts.join(', ');
    }
    if (this._limit != null) sql += ` LIMIT ${parseInt(this._limit, 10)}`;
    if (this._offset != null) sql += ` OFFSET ${parseInt(this._offset, 10)}`;
    return sql;
  }

  _selectColsSql() {
    if (!this._columns || this._columns === '*') return '*';
    // comma-separated list -> quote each, support "col" and table.col
    return String(this._columns)
      .split(',')
      .map((c) => c.trim())
      .filter(Boolean)
      .map((c) => qCol(c))
      .join(', ');
  }

  _returningSql() {
    if (!this._returning) return '';
    if (this._returning === '*') return ' RETURNING *';
    const cols = String(this._returning)
      .split(',')
      .map((c) => c.trim())
      .filter(Boolean)
      .map((c) => qCol(c))
      .join(', ');
    return ' RETURNING ' + cols;
  }

  _buildSql() {
    const params = [];
    const tbl = qIdent(this.table);

    if (!this._mutation) {
      // SELECT
      const cols = this._head && this._count ? 'COUNT(*)::bigint AS count' : this._selectColsSql();
      let sql = `SELECT ${cols} FROM ${tbl}`;
      sql += this._buildWhere(params);
      if (!(this._head && this._count)) {
        sql += this._buildOrderLimit();
      }
      return { sql, params };
    }

    if (this._mutation === 'insert' || this._mutation === 'upsert') {
      const rows = this._values || [];
      if (rows.length === 0) {
        return { sql: null, params, empty: true };
      }
      // Union of all keys across rows for consistent column list
      const colSet = new Set();
      rows.forEach((r) => Object.keys(r).forEach((k) => colSet.add(k)));
      const cols = [...colSet];
      const colSql = cols.map((c) => qIdent(c)).join(', ');
      const valuesSql = rows
        .map((row) => {
          const placeholders = cols.map((c) => {
            params.push(row[c] === undefined ? null : row[c]);
            return `$${params.length}`;
          });
          return '(' + placeholders.join(', ') + ')';
        })
        .join(', ');
      let sql = `INSERT INTO ${tbl} (${colSql}) VALUES ${valuesSql}`;

      if (this._mutation === 'upsert') {
        const conflictCols = this._onConflict
          ? String(this._onConflict).split(',').map((c) => qIdent(c.trim())).join(', ')
          : null;
        if (conflictCols) {
          if (this._ignoreDuplicates) {
            sql += ` ON CONFLICT (${conflictCols}) DO NOTHING`;
          } else {
            const updates = cols
              .filter((c) => !String(this._onConflict).split(',').map((x) => x.trim()).includes(c))
              .map((c) => `${qIdent(c)} = EXCLUDED.${qIdent(c)}`)
              .join(', ');
            sql += updates
              ? ` ON CONFLICT (${conflictCols}) DO UPDATE SET ${updates}`
              : ` ON CONFLICT (${conflictCols}) DO NOTHING`;
          }
        } else {
          // No conflict target specified; default to DO NOTHING to avoid hard errors
          sql += ' ON CONFLICT DO NOTHING';
        }
      }
      sql += this._returningSql();
      return { sql, params };
    }

    if (this._mutation === 'update') {
      const vals = this._values || {};
      const setCols = Object.keys(vals);
      const setSql = setCols
        .map((c) => {
          params.push(vals[c] === undefined ? null : vals[c]);
          return `${qIdent(c)} = $${params.length}`;
        })
        .join(', ');
      let sql = `UPDATE ${tbl} SET ${setSql}`;
      sql += this._buildWhere(params);
      sql += this._returningSql();
      return { sql, params };
    }

    if (this._mutation === 'delete') {
      let sql = `DELETE FROM ${tbl}`;
      sql += this._buildWhere(params);
      sql += this._returningSql();
      return { sql, params };
    }

    return { sql: null, params, empty: true };
  }

  async _execute() {
    if (!pool) {
      return { data: null, error: { message: 'Postgres not configured (DB_HOST/DB_NAME/DB_USER missing)' }, count: null };
    }
    try {
      const built = this._buildSql();
      if (built.empty) {
        // Nothing to insert/upsert
        return { data: this._returning ? [] : null, error: null, count: 0 };
      }

      // HEAD + count: return count only
      if (this._head && this._count && !this._mutation) {
        const res = await pool.query(built.sql, built.params);
        const count = res.rows && res.rows[0] ? parseInt(res.rows[0].count, 10) : 0;
        return { data: null, error: null, count };
      }

      const res = await pool.query(built.sql, built.params);
      let count = null;

      // count:'exact' (non-head) for SELECT -> run a separate count query
      if (this._count && !this._head && !this._mutation) {
        const cparams = [];
        let csql = `SELECT COUNT(*)::bigint AS count FROM ${qIdent(this.table)}`;
        csql += this._buildWhere(cparams);
        const cres = await pool.query(csql, cparams);
        count = cres.rows && cres.rows[0] ? parseInt(cres.rows[0].count, 10) : 0;
      }

      // For mutations with count requested, use rowCount
      if (this._mutation && this._count) {
        count = res.rowCount;
      }

      let data;
      if (this._mutation && !this._returning) {
        // Supabase returns null data for mutations without .select()
        data = null;
      } else {
        data = res.rows || [];
      }

      // single / maybeSingle
      if (data && Array.isArray(data)) {
        if (this._single) {
          if (data.length !== 1) {
            return {
              data: null,
              error: {
                message: data.length === 0
                  ? 'JSON object requested, multiple (or no) rows returned'
                  : 'Multiple rows returned for single()',
                code: 'PGRST116',
              },
              count,
            };
          }
          data = data[0];
        } else if (this._maybeSingle) {
          data = data.length > 0 ? data[0] : null;
        }
      }

      return { data, error: null, count };
    } catch (e) {
      return {
        data: null,
        error: {
          message: e.message,
          code: e.code,
          details: e.detail || e.hint || null,
        },
        count: null,
      };
    }
  }

  // Make the builder awaitable (thenable), like supabase-js.
  then(onFulfilled, onRejected) {
    return this._execute().then(onFulfilled, onRejected);
  }

  catch(onRejected) {
    return this._execute().catch(onRejected);
  }

  finally(onFinally) {
    return this._execute().finally(onFinally);
  }
}

// The supabase-compatible client surface
const pgSupabase = pool
  ? {
      from(table) {
        return new PgQueryBuilder(table);
      },
      // Expose pool for direct raw queries if ever needed
      _pool: pool,
      async _rawQuery(sql, params) {
        return pool.query(sql, params);
      },
    }
  : null;

async function verifyTableExists(tableName = 'users') {
  if (!pgSupabase) {
    return { exists: false, error: 'Postgres not configured' };
  }
  try {
    const { error } = await pgSupabase.from(tableName).select('*').limit(1);
    if (error) {
      if (/relation .* does not exist/i.test(error.message || '')) {
        return { exists: false, error: `Table '${tableName}' does not exist` };
      }
      return { exists: false, error: error.message || 'Unknown error' };
    }
    return { exists: true };
  } catch (err) {
    return { exists: false, error: err.message };
  }
}

module.exports = { supabase: pgSupabase, verifyTableExists, pool };
