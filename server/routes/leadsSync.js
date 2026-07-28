/**
 * Leads → Google Sheets real-time sync (5 DW forms → "DW-live data").
 *
 * Target forms:
 *   2449233332261397  NSI - Direct Walkin - Conditional Logic (v1) (Integfarms My Health School)
 *   1029626479628890  NSI - Direct Walkin - Conditional Logic      (Integfarms My Health School)
 *   818636004640541   NSI - Direct Walkin Form - Condition Logic (My Health School)
 *   968880282530796   NSI - Direct Walkin Form - Condition Logic (Doctor Farmer)
 *   1325107116305272  NSI - Direct Walkin Form                  (My Health School)
 *
 * Strategy:
 *   - Every 5 min: fetch new leads from Meta for each form since last checkpoint
 *   - Backfill: fetch ALL leads from Meta for each form, skip IDs already in sheet
 *   - Webhook: instant delivery when Meta fires a leadgen event
 *
 * Endpoints:
 *   GET  /api/leads-sync/webhook    Meta webhook verification
 *   POST /api/leads-sync/webhook    Real-time Meta lead delivery
 *   POST /api/leads-sync/backfill   Push ALL historical leads for all 3 forms
 *   POST /api/leads-sync/sync       Manual incremental sync trigger
 *   GET  /api/leads-sync/status     Health / config check
 */

const express = require('express');
const router = express.Router();
const axios = require('axios');
const path = require('path');
const fs = require('fs');
const os = require('os');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { appendRows, readRange } = require('../services/googleSheetsService');
const { supabase } = require('../supabase');

// ── Configuration ─────────────────────────────────────────────────────────────

const TARGET_FORMS = [
  {
    formId:   '2449233332261397',
    // Renamed on Meta to "... (v1)" when the form below replaced it.
    formName: 'NSI - Direct Walkin - Conditional Logic (v1)',
    pageId:   '919735281228628',
    pageName: 'Integfarms My Health School',
  },
  {
    // Successor to 2449233332261397 (v1) — same name, same page. Created
    // 2026-06-11; leads were dropped until this entry was added because the
    // poll and the webhook both filter on TARGET_FORM_IDS.
    formId:   '1029626479628890',
    formName: 'NSI - Direct Walkin - Conditional Logic',
    pageId:   '919735281228628',
    pageName: 'Integfarms My Health School',
  },
  {
    formId:   '818636004640541',
    formName: 'NSI - Direct Walkin Form - Condition Logic',
    pageId:   '355327027658692',
    pageName: 'My Health School',
  },
  {
    formId:   '968880282530796',
    formName: 'NSI - Direct Walkin Form - Condition Logic',
    pageId:   '113830624877941',
    pageName: 'Doctor Farmer',
  },
  {
    formId:   '1325107116305272',
    formName: 'NSI - Direct Walkin Form',
    pageId:   '355327027658692',
    pageName: 'My Health School',
  },
];

const TARGET_FORM_IDS = new Set(TARGET_FORMS.map(f => f.formId));
const FORM_META = Object.fromEntries(TARGET_FORMS.map(f => [f.formId, f]));

/**
 * Lead-gen forms Meta has pushed to us that are NOT in TARGET_FORMS.
 *
 * The webhook used to `continue` past these silently. That is exactly how form
 * 1029626479628890 ("NSI - Direct Walkin - Conditional Logic", the successor to
 * 2449233332261397 after it was renamed "(v1)") delivered 227 leads over 6.5
 * weeks that never reached the sheet — with no error, no warning, nothing to
 * notice. Tracked here and reported by GET /api/leads-sync/reconcile.
 *
 *   formId -> { count, firstSeen, lastSeen, lastLogged }
 */
const unknownWebhookForms = new Map();
const UNKNOWN_FORM_LOG_THROTTLE_MS = 60 * 60 * 1000; // at most one log/hour/form

function noteUnknownForm(formId) {
  const now = Date.now();
  const rec = unknownWebhookForms.get(formId) ||
    { count: 0, firstSeen: new Date(now).toISOString(), lastSeen: null, lastLogged: 0 };
  rec.count += 1;
  rec.lastSeen = new Date(now).toISOString();
  if (now - rec.lastLogged > UNKNOWN_FORM_LOG_THROTTLE_MS) {
    rec.lastLogged = now;
    console.warn(
      `[LeadsSync] ⚠️  Webhook lead from UNCONFIGURED form ${formId} — ` +
      `${rec.count} lead(s) dropped since ${rec.firstSeen}. If this form should ` +
      `feed "DW-live data", add it to TARGET_FORMS in server/routes/leadsSync.js.`
    );
  }
  unknownWebhookForms.set(formId, rec);
}

const SHEET_ID      = process.env.GOOGLE_SHEET_ID  || '1RWOgyXVLZQvHJpSzRk1Vd02CipCL2KLEjrJNQT6pZMU';
const SHEET_TAB     = process.env.GOOGLE_SHEET_TAB || 'DW-live data';
const VERIFY_TOKEN  = process.env.META_WEBHOOK_VERIFY_TOKEN || 'mhs_dw_sync_2025';
const META_VERSION  = process.env.META_API_VERSION || 'v21.0';
// Safety-net poll; the Meta webhook delivers leads instantly, so this can run
// infrequently. Default 5 min (was 1 min, which — combined with the other two
// pollers — kept tripping Meta's app rate limit). Override with LEADS_SHEET_SYNC_MS.
const SYNC_INTERVAL = Math.max(60 * 1000, parseInt(process.env.LEADS_SHEET_SYNC_MS, 10) || 5 * 60 * 1000);

const STATE_FILE = path.join(__dirname, '..', 'data', 'leads-sync-state.json');

const HEADERS = [
  'Date', 'Time', 'Lead ID', 'Name', 'Phone',
  'City', 'Post Code', 'Sugar Poll', 'Visit Availability',
  'Campaign', 'Ad Name', 'Form Name', 'Page Name',
  'Ad ID', 'Campaign ID', 'Form ID',
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function getAccessToken() {
  return (
    process.env.META_ACCESS_TOKEN ||
    process.env.META_SYSTEM_ACCESS_TOKEN ||
    process.env.META_SYSTEM_ACCESS_TOKEN_1 ||
    ''
  ).trim();
}

function readState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); }
  catch { return {}; }
}

function writeState(state) {
  try {
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  } catch (e) { console.warn('[LeadsSync] Could not write state:', e.message); }
}

function parseFields(fieldDataArray) {
  const out = {};
  if (!Array.isArray(fieldDataArray)) return out;
  for (const item of fieldDataArray) {
    if (!item || !item.name) continue;
    const key = String(item.name).trim().toLowerCase();
    const val = Array.isArray(item.values) && item.values.length > 0
      ? String(item.values[0]).trim() : '';
    out[key] = val;
    out[String(item.name).trim()] = val;
  }
  return out;
}

function findField(fields, pattern) {
  for (const [k, v] of Object.entries(fields)) {
    if (pattern.test(k) && v) return v;
  }
  return '';
}

/**
 * Convert Meta's UTC `created_time` (e.g. "2026-05-19T02:38:02+0000")
 * to IST (Asia/Kolkata, UTC+5:30) and return { date, time } as the
 * lead actually occurred locally — matching what Meta's Leads Center shows.
 */
function toIST(createdTime) {
  if (!createdTime) return { date: '', time: '' };
  const d = new Date(createdTime);
  if (isNaN(d.getTime())) return { date: '', time: '' };
  // en-CA → "YYYY-MM-DD"; en-GB + hour12:false → "HH:MM:SS"
  const date = d.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  const time = d.toLocaleTimeString('en-GB', {
    timeZone: 'Asia/Kolkata',
    hour12: false,
  });
  return { date, time };
}

function metaLeadToRow(lead, formId) {
  const meta  = FORM_META[formId] || {};
  const fields = parseFields(lead.field_data || []);

  const { date, time } = toIST(lead.created_time || '');

  // Resolve name: full_name → first+last → any generic name field
  const fullName  = fields.full_name  || findField(fields, /full.?name/i)  || '';
  const firstName = fields.first_name || findField(fields, /first.?name/i) || '';
  const lastName  = fields.last_name  || findField(fields, /last.?name/i)  || '';
  const resolvedName = fullName
    || (firstName || lastName ? `${firstName} ${lastName}`.trim() : '')
    || findField(fields, /\bname\b/i)
    || 'N/A';

  // Resolve phone: Meta standard key is phone_number, also try phone
  const resolvedPhone = fields.phone_number || fields.phone
    || findField(fields, /phone/i) || 'N/A';

  // Lead ID: prepend "'" so USER_ENTERED stores as text. Without this, big
  // integers get coerced to numbers and display as "1.4E+15", which breaks
  // string-based dedup on subsequent reads (caused 134 duplicate rows).
  const leadIdStr = String(lead.id || lead.lead_id || '');
  const leadIdCell = leadIdStr ? "'" + leadIdStr : '';

  return [
    date,
    time,
    leadIdCell,
    resolvedName,
    resolvedPhone,
    fields.city       || findField(fields, /city/i)        || '',
    fields.post_code  || findField(fields, /post.?code|zip/i) || '',
    findField(fields, /sugar/i),
    findField(fields, /visit|poonamallee|walkin|walk.in/i),
    lead.campaign_name || '',
    lead.ad_name       || '',
    meta.formName      || `Form ${formId}`,
    meta.pageName      || '',
    String(lead.ad_id      || ''),
    String(lead.campaign_id || ''),
    formId,
  ];
}

async function ensureHeaders() {
  const existing = await readRange(SHEET_ID, `${SHEET_TAB}!A1:P1`);
  const first = (existing[0] || []);
  if (first.length === 0 || first[0] !== 'Date') {
    await appendRows(SHEET_ID, SHEET_TAB, [HEADERS]);
  }
}

/** Fetch all leads from Meta for a form, stopping once older than sinceTime. */
async function fetchFromMeta(formId, sinceTime = null) {
  const token = getAccessToken();
  const allLeads = [];
  let nextUrl = `https://graph.facebook.com/${META_VERSION}/${formId}/leads`;
  let params = {
    fields: 'id,created_time,field_data,ad_id,campaign_id,ad_name,campaign_name',
    limit: 100,
    access_token: token,
  };
  let page = 0;
  const maxPages = sinceTime ? 50 : 200;

  while (nextUrl && page < maxPages) {
    const { data } = await axios.get(nextUrl, {
      params: page === 0 ? params : undefined,
      timeout: 20000,
    });
    const batch = data.data || [];
    let stop = false;
    for (const lead of batch) {
      if (sinceTime && new Date(lead.created_time) <= new Date(sinceTime)) {
        stop = true; break;
      }
      allLeads.push(lead);
    }
    if (stop || !data.paging?.next) break;
    nextUrl = data.paging.next;
    page++;
  }
  return allLeads;
}

// ── Core sync ─────────────────────────────────────────────────────────────────

let _syncRunning = false;

const _sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ── Cross-process append lock ──────────────────────────────────────────────────
// The in-memory mutex below only serializes writers WITHIN one Node process. If
// more than one server instance of this codebase is running on the machine (e.g.
// a stray `node server.js` left alongside `nodemon`), each has its own in-memory
// mutex, so their pollers/webhooks can append the same fresh lead simultaneously
// → duplicate rows. This file lock (in the OS temp dir, keyed by sheet+tab)
// serializes the append critical section ACROSS processes too. In the normal
// single-instance case it is acquired instantly and adds no observable behaviour.
const SHEET_LOCK_FILE = path.join(
  os.tmpdir(),
  `mhs-leadssync-${SHEET_ID}-${SHEET_TAB}.lock`.replace(/[^a-zA-Z0-9._-]/g, '_')
);
const LOCK_STALE_MS = 60 * 1000;   // steal a lock whose holder looks dead
const LOCK_WAIT_MS  = 45 * 1000;   // max time to wait for the lock before failing open

async function withCrossProcessLock(fn) {
  const start = Date.now();
  let acquired = false;
  while (Date.now() - start < LOCK_WAIT_MS) {
    try {
      // 'wx' = create exclusively; throws if the file already exists (atomic across processes)
      const fd = fs.openSync(SHEET_LOCK_FILE, 'wx');
      fs.writeSync(fd, JSON.stringify({ pid: process.pid, ts: Date.now() }));
      fs.closeSync(fd);
      acquired = true;
      break;
    } catch (e) {
      // Lock is held — steal it if the holder is stale (crashed mid-write), else wait.
      try {
        const raw = JSON.parse(fs.readFileSync(SHEET_LOCK_FILE, 'utf8'));
        if (Date.now() - (raw.ts || 0) > LOCK_STALE_MS) {
          fs.unlinkSync(SHEET_LOCK_FILE);
          continue;
        }
      } catch { /* unreadable/just-removed — retry */ }
      await _sleep(200 + Math.floor(Math.random() * 150));
    }
  }
  if (!acquired) {
    // Fail open rather than risk dropping/delaying a lead. The in-memory mutex
    // and the column-C recheck still guard within this process.
    console.warn('[LeadsSync] Could not acquire cross-process sheet lock in time — proceeding with in-process lock only.');
    return fn();
  }
  try { return await fn(); }
  finally { try { fs.unlinkSync(SHEET_LOCK_FILE); } catch { /* already gone */ } }
}

// Single-writer mutex: webhook deliveries and poll appends share this lock so
// that "read existingIds → check → appendRows" runs atomically. Without it, a
// webhook can append a lead between the poll's pre-append recheck and its own
// appendRows call (or two webhooks for the same leadgen_id can both pass dedup).
// In-process serialization is wrapped in the cross-process lock so concurrent
// server instances on the same machine cannot double-write either.
let _writerLock = Promise.resolve();
function withWriterLock(fn) {
  const prev = _writerLock;
  let release;
  const next = new Promise(r => { release = r; });
  _writerLock = prev.then(() => next);
  return prev.then(async () => {
    try { return await withCrossProcessLock(fn); }
    finally { release(); }
  });
}

async function runSync(fullBackfill = false) {
  if (_syncRunning) { console.log('[LeadsSync] Already running, skipping'); return { skipped: true }; }
  _syncRunning = true;

  try {
    const state = readState();

    // Read existing Lead IDs from sheet (column C). UNFORMATTED_VALUE so big
    // integers come back as digits — without this, numbers display as
    // scientific notation ("1.4327E+15") in the default mode and dedup fails.
    await ensureHeaders();
    const existingCol = await readRange(SHEET_ID, `${SHEET_TAB}!C:C`, 'UNFORMATTED_VALUE');
    const existingIds = new Set(
      existingCol.flat().map(v => String(v == null ? '' : v).trim()).filter(Boolean)
    );
    existingIds.delete('Lead ID');

    // Phase 1: fetch from all forms into one buffer so we can globally sort
    // before appending. Without this, Form A's batch is appended above Form B's
    // even when Form B has older leads in the same cycle.
    const buffered = []; // { lead, formId, row }
    const perFormMostRecent = {};

    for (const form of TARGET_FORMS) {
      const { formId, formName } = form;
      const sinceTime = fullBackfill ? null : (state[formId]?.lastSyncTime || null);

      console.log(`[LeadsSync] Form ${formId} (${formName}) — fetching since: ${sinceTime || 'beginning'}`);

      let leads = [];
      try {
        leads = await fetchFromMeta(formId, sinceTime);
      } catch (e) {
        console.error(`[LeadsSync] Meta fetch failed for ${formId}:`, e.message);
        continue;
      }

      if (leads.length === 0) {
        console.log(`[LeadsSync] Form ${formId} — no new leads`);
        state[formId] = { ...state[formId], lastRun: new Date().toISOString() };
        continue;
      }

      console.log(`[LeadsSync] Form ${formId} — fetched ${leads.length} leads`);

      for (const lead of leads) {
        // Raw lead ID for dedup (matches the unformatted value the sheet returns).
        // row[2] now has a leading apostrophe to force text storage — don't dedup on it.
        const leadId = String(lead.id || lead.lead_id || '').trim();
        if (!leadId || existingIds.has(leadId)) continue;
        existingIds.add(leadId); // also blocks intra-cycle dupes across forms
        const row = metaLeadToRow(lead, formId);
        buffered.push({ lead, formId, row });
      }

      // Track most-recent created_time per form for checkpoint advancement
      const mostRecent = leads.reduce(
        (max, l) => new Date(l.created_time) > new Date(max) ? l.created_time : max,
        leads[0].created_time
      );
      perFormMostRecent[formId] = mostRecent;
    }

    // Phase 2: globally sort by created_time (oldest first) so the sheet
    // appends in true chronological order regardless of which form produced
    // the lead.
    buffered.sort((a, b) =>
      new Date(a.lead.created_time).getTime() - new Date(b.lead.created_time).getTime()
    );

    // Re-read column C and append under the writer mutex so concurrent
    // webhook calls cannot squeeze a duplicate between our check and write.
    let finalBuffered = buffered;
    let totalPushed = 0;
    const pushedByForm = {};

    if (buffered.length > 0) {
      await withWriterLock(async () => {
        const freshCol = await readRange(SHEET_ID, `${SHEET_TAB}!C:C`, 'UNFORMATTED_VALUE');
        const freshIds = new Set(
          freshCol.flat().map(v => String(v == null ? '' : v).trim()).filter(Boolean)
        );
        freshIds.delete('Lead ID');
        finalBuffered = buffered.filter(b => {
          const lid = String(b.lead.id || b.lead.lead_id || '').trim();
          return lid && !freshIds.has(lid);
        });
        const dropped = buffered.length - finalBuffered.length;
        if (dropped > 0) {
          console.log(`[LeadsSync] Pre-append recheck dropped ${dropped} lead(s) already written (webhook race)`);
        }

        const sortedRows = finalBuffered.map(b => b.row);
        for (const b of finalBuffered) pushedByForm[b.formId] = (pushedByForm[b.formId] || 0) + 1;
        totalPushed = sortedRows.length;

        if (sortedRows.length > 0) {
          const CHUNK = 500;
          for (let i = 0; i < sortedRows.length; i += CHUNK) {
            await appendRows(SHEET_ID, SHEET_TAB, sortedRows.slice(i, i + CHUNK));
          }
          for (const [formId, count] of Object.entries(pushedByForm)) {
            console.log(`[LeadsSync] Form ${formId} — pushed ${count} new rows ✓`);
          }
        }
      });
    }

    // Advance per-form checkpoints (only forms that actually returned leads)
    const nowIso = new Date().toISOString();
    for (const form of TARGET_FORMS) {
      const formId = form.formId;
      if (perFormMostRecent[formId]) {
        state[formId] = {
          lastSyncTime: perFormMostRecent[formId],
          lastRun: nowIso,
          totalPushed: (state[formId]?.totalPushed || 0) + (pushedByForm[formId] || 0),
        };
      }
    }

    writeState(state);
    console.log(`[LeadsSync] Sync complete — total pushed this run: ${totalPushed}`);
    return { pushed: totalPushed };

  } catch (err) {
    console.error('[LeadsSync] Sync error:', err.message);
    throw err;
  } finally {
    _syncRunning = false;
  }
}

// ── Scheduler ─────────────────────────────────────────────────────────────────

function startScheduler() {
  // Run immediately on startup
  runSync(false).catch(e => console.error('[LeadsSync] Startup sync error:', e.message));
  setInterval(() => {
    runSync(false).catch(e => console.error('[LeadsSync] Scheduled sync error:', e.message));
  }, SYNC_INTERVAL);
  // Count comes from TARGET_FORMS — the old hardcoded "3" was already wrong.
  console.log(`[LeadsSync] Scheduler started — ${TARGET_FORMS.length} forms, every ${SYNC_INTERVAL / 60000} min`);
}

// ── Routes ────────────────────────────────────────────────────────────────────

// GET /api/leads-sync/webhook — Meta verification
router.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'], token = req.query['hub.verify_token'], challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('[LeadsSync] Webhook verified ✓');
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

// POST /api/leads-sync/webhook — Instant lead from Meta
router.post('/webhook', async (req, res) => {
  res.sendStatus(200);
  try {
    const body = req.body;
    if (!body || body.object !== 'page') return;
    for (const entry of (body.entry || [])) {
      for (const change of (entry.changes || [])) {
        if (change.field !== 'leadgen') continue;
        const val = change.value || {};
        const formId = String(val.form_id || '');
        if (!TARGET_FORM_IDS.has(formId)) {
          noteUnknownForm(formId);
          continue;
        }
        const leadgenId = String(val.leadgen_id || '');
        if (!leadgenId) continue;
        console.log(`[LeadsSync] Webhook: lead ${leadgenId} from form ${formId}`);
        try {
          const { data } = await axios.get(
            `https://graph.facebook.com/${META_VERSION}/${leadgenId}`,
            { params: { fields: 'id,created_time,field_data,ad_id,campaign_id,ad_name,campaign_name', access_token: getAccessToken() }, timeout: 10000 }
          );
          data.id = leadgenId;
          await ensureHeaders();
          // Dedup + write under the shared writer mutex so we can't race with
          // (a) the poll's append step, or (b) a second webhook delivery for
          // the same leadgen_id arriving concurrently.
          await withWriterLock(async () => {
            const existing = await readRange(SHEET_ID, `${SHEET_TAB}!C:C`, 'UNFORMATTED_VALUE');
            const existingIds = new Set(
              existing.flat().map(v => String(v == null ? '' : v).trim()).filter(Boolean)
            );
            if (existingIds.has(leadgenId)) {
              console.log(`[LeadsSync] Webhook lead ${leadgenId} already in sheet, skipping`);
              return;
            }
            await appendRows(SHEET_ID, SHEET_TAB, [metaLeadToRow(data, formId)]);
            console.log(`[LeadsSync] Webhook lead ${leadgenId} written ✓`);
          });
        } catch (e) { console.error(`[LeadsSync] Webhook lead ${leadgenId} failed:`, e.message); }
      }
    }
  } catch (e) { console.error('[LeadsSync] Webhook error:', e.message); }
});

// POST /api/leads-sync/backfill — Push ALL historical leads for all 3 forms
router.post('/backfill', async (req, res) => {
  try {
    const result = await runSync(true);
    return res.json({ ok: true, ...result });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /api/leads-sync/sync — Manual incremental sync
router.post('/sync', async (req, res) => {
  try {
    const result = await runSync(false);
    return res.json({ ok: true, ...result });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /api/leads-sync/status
router.get('/status', (req, res) => {
  const state = readState();
  res.json({
    ok: true,
    forms: TARGET_FORMS.map(f => ({
      formId: f.formId, formName: f.formName, pageName: f.pageName,
      lastSyncTime: state[f.formId]?.lastSyncTime || 'never',
      lastRun:      state[f.formId]?.lastRun      || 'never',
      totalPushed:  state[f.formId]?.totalPushed  || 0,
    })),
    sheetId: SHEET_ID, sheetTab: SHEET_TAB,
    syncIntervalMin: SYNC_INTERVAL / 60000,
  });
});

// ── Reconciliation ────────────────────────────────────────────────────────────
//
// The guard that turns "counts should match" into something checkable. For each
// configured form it compares three independent sources over the same window —
// Meta (source of truth), the `leads` table, and the DW-live data sheet — and
// reports any drift. It also enumerates every lead-gen form on the configured
// pages so a NEW form that nobody added to TARGET_FORMS shows up as
// `unconfiguredFormsWithLeads` instead of silently dropping leads for weeks.
//
//   GET /api/leads-sync/reconcile           last 7 days
//   GET /api/leads-sync/reconcile?days=30   wider window
//   GET /api/leads-sync/reconcile?full=1    all history (slow)

/**
 * "DW-live data" is the Direct-Walk-in sheet, NOT every lead-gen form on the
 * page — high-intent / dental / DF forms are deliberately excluded. So only a
 * form whose NAME reads like a Direct Walk-in form is worth alerting on when it
 * is missing from TARGET_FORMS. Without this narrowing the drift check flags
 * ~20 intentionally-excluded forms on every run and the signal becomes noise.
 *
 * Matches: "NSI - Direct Walkin - Conditional Logic", "NSI - Direct Walk in",
 *          "AS88 - Direct Walk in", "... DW ...". Does not match "AS216 - High
 *          Intent", "DF 101 - Lead Form With Logic", "New dental ad form".
 */
const DW_FORM_PATTERN = /direct\s*walk|walk\s*-?\s*in|\bdw\b|\bdwp\b/i;

/** IST calendar date for an instant — the sheet's and date_char's definition of "day". */
function istDay(t) {
  const d = new Date(t);
  return isNaN(d.getTime()) ? null : d.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
}

/** Every lead id currently in the DW-live data sheet (raw values — big ints). */
async function sheetLeadIds() {
  const rows = await readRange(SHEET_ID, `${SHEET_TAB}!C2:C100000`, 'UNFORMATTED_VALUE');
  return new Set((rows || []).map(r => String(r[0] || '').trim()).filter(Boolean));
}

/** Every lead id in the `leads` table for these forms (paged — never truncated). */
async function dbLeadIds(formIds) {
  const ids = new Set();
  const PAGE = 1000;
  for (const formId of formIds) {
    for (let offset = 0; ; offset += PAGE) {
      // .order() is REQUIRED: OFFSET paging without a total ordering lets
      // Postgres return rows in a different order per page, which skips rows
      // across page boundaries and reports leads as missing when they are not.
      const { data, error } = await supabase
        .from('leads').select('lead_id').eq('form_id', formId)
        .order('lead_id', { ascending: true })
        .range(offset, offset + PAGE - 1);
      if (error) throw new Error(`db read failed for form ${formId}: ${error.message}`);
      const batch = data || [];
      for (const r of batch) if (r.lead_id) ids.add(String(r.lead_id));
      if (batch.length < PAGE) break;
    }
  }
  return ids;
}

/** All lead-gen forms on the configured pages, so new ones can't hide. */
async function discoverFormsOnPages() {
  const token = getAccessToken();
  const pages = [...new Set(TARGET_FORMS.map(f => f.pageId))];
  const out = [];
  for (const pageId of pages) {
    let pageToken = token;
    try {
      const { data } = await axios.get(`https://graph.facebook.com/${META_VERSION}/${pageId}`,
        { params: { fields: 'access_token', access_token: token }, timeout: 20000 });
      if (data.access_token) pageToken = data.access_token;
    } catch { /* fall back to the caller token */ }

    let url = `https://graph.facebook.com/${META_VERSION}/${pageId}/leadgen_forms`;
    let params = { fields: 'id,name,status,leads_count', limit: 100, access_token: pageToken };
    for (let guard = 0; url && guard < 10; guard++) {
      const { data } = await axios.get(url, { params, timeout: 30000 });
      for (const f of data.data || []) {
        out.push({
          formId: String(f.id), formName: f.name, status: f.status,
          leadsCount: Number(f.leads_count || 0), pageId,
          configured: TARGET_FORM_IDS.has(String(f.id)),
        });
      }
      url = data.paging && data.paging.next; params = undefined;
    }
  }
  return out;
}

/**
 * Leads younger than this are still legitimately in flight: the sheet sync runs
 * every 5 min and the leads→DB sync every 15 min, so a lead created 2 minutes
 * ago being absent from the DB is correct behaviour, not drift. Without this
 * grace window the drift check would fire on every run during business hours
 * and the alert would be worthless.
 */
const SYNC_GRACE_MS = Math.max(
  5 * 60 * 1000,
  parseInt(process.env.LEADS_SYNC_GRACE_MS, 10) || 30 * 60 * 1000
);

async function reconcile({ days = 7, full = false } = {}) {
  const sinceMs = full ? null : Date.now() - days * 24 * 60 * 60 * 1000;
  const inWindow = t => sinceMs === null || new Date(t).getTime() >= sinceMs;
  const settledCutoff = Date.now() - SYNC_GRACE_MS;
  const isSettled = t => new Date(t).getTime() <= settledCutoff;

  const [inSheet, inDb] = await Promise.all([
    sheetLeadIds(),
    dbLeadIds(TARGET_FORMS.map(f => f.formId)),
  ]);

  const forms = [];
  for (const f of TARGET_FORMS) {
    let metaLeads = [];
    let error = null;
    try {
      metaLeads = (await fetchFromMeta(f.formId, null)).filter(l => inWindow(l.created_time));
    } catch (e) {
      error = e.response?.data?.error?.message || e.message;
    }
    const ids = metaLeads.map(l => String(l.id));
    // Only leads past the grace window count toward drift; the rest are in flight.
    const settledIds = metaLeads.filter(l => isSettled(l.created_time)).map(l => String(l.id));
    const missingFromSheet = settledIds.filter(i => !inSheet.has(i));
    const missingFromDb = settledIds.filter(i => !inDb.has(i));
    const inFlight = ids.length - settledIds.length;
    const byDay = {};
    for (const l of metaLeads) {
      const d = istDay(l.created_time);
      if (d) byDay[d] = (byDay[d] || 0) + 1;
    }
    forms.push({
      formId: f.formId, formName: f.formName, pageName: f.pageName,
      meta: ids.length,
      sheet: ids.filter(i => inSheet.has(i)).length,
      db: ids.filter(i => inDb.has(i)).length,
      settled: settledIds.length,
      inFlight,
      missingFromSheet: missingFromSheet.length, missingFromDb: missingFromDb.length,
      sampleMissingFromSheet: missingFromSheet.slice(0, 10),
      sampleMissingFromDb: missingFromDb.slice(0, 10),
      leadsByIstDay: byDay,
      error,
    });
  }

  let discovered = [];
  let discoveryError = null;
  try { discovered = await discoverFormsOnPages(); }
  catch (e) { discoveryError = e.response?.data?.error?.message || e.message; }

  // Actionable: looks like a Direct Walk-in form, has leads, but isn't configured.
  const unconfiguredWithLeads = discovered
    .filter(f => !f.configured && f.leadsCount > 0 && DW_FORM_PATTERN.test(f.formName || ''))
    .sort((a, b) => b.leadsCount - a.leadsCount);

  // Informational only — deliberately excluded (high-intent, dental, DF…).
  const otherFormsWithLeads = discovered
    .filter(f => !f.configured && f.leadsCount > 0 && !DW_FORM_PATTERN.test(f.formName || ''))
    .sort((a, b) => b.leadsCount - a.leadsCount)
    .map(f => ({ formId: f.formId, formName: f.formName, leadsCount: f.leadsCount }));

  const drift =
    forms.some(f => f.missingFromSheet > 0 || f.missingFromDb > 0 || f.error) ||
    unconfiguredWithLeads.length > 0 ||
    unknownWebhookForms.size > 0;

  return {
    ok: !drift,
    drift,
    window: full ? 'all history' : `last ${days} day(s)`,
    graceMinutes: SYNC_GRACE_MS / 60000,
    checkedAt: new Date().toISOString(),
    totals: {
      meta:  forms.reduce((a, f) => a + f.meta, 0),
      sheet: forms.reduce((a, f) => a + f.sheet, 0),
      db:    forms.reduce((a, f) => a + f.db, 0),
      inFlight: forms.reduce((a, f) => a + (f.inFlight || 0), 0),
      missingFromSheet: forms.reduce((a, f) => a + f.missingFromSheet, 0),
      missingFromDb: forms.reduce((a, f) => a + f.missingFromDb, 0),
    },
    forms,
    unconfiguredFormsWithLeads: unconfiguredWithLeads,
    otherFormsWithLeads,
    unknownWebhookForms: [...unknownWebhookForms.entries()].map(([formId, r]) => ({ formId, ...r })),
    discoveryError,
  };
}

// GET /api/leads-sync/reconcile
router.get('/reconcile', async (req, res) => {
  try {
    const days = Math.max(1, parseInt(req.query.days, 10) || 7);
    const full = String(req.query.full) === '1' || String(req.query.full).toLowerCase() === 'true';
    const result = await reconcile({ days, full });
    if (result.drift) {
      console.warn(
        `[LeadsReconcile] DRIFT over ${result.window}: ` +
        `meta=${result.totals.meta} sheet=${result.totals.sheet} db=${result.totals.db}; ` +
        `${result.unconfiguredFormsWithLeads.length} unconfigured form(s) with leads.`
      );
    }
    return res.json(result);
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * Scheduled drift check. Logs loudly when the three systems disagree so a gap
 * surfaces the same day instead of weeks later.
 */
const RECONCILE_CHECK_MS = Math.max(
  60 * 60 * 1000,
  parseInt(process.env.LEADS_RECONCILE_CHECK_MS, 10) || 6 * 60 * 60 * 1000
);

function startReconcileScheduler() {
  const run = async () => {
    try {
      const r = await reconcile({ days: 7 });
      if (!r.drift) {
        console.log(`[LeadsReconcile] ✓ In sync — ${r.totals.meta} lead(s) over ${r.window}, Meta = sheet = DB.`);
        return;
      }
      console.error(
        `[LeadsReconcile] ⚠️  DRIFT DETECTED over ${r.window}: ` +
        `Meta=${r.totals.meta} Sheet=${r.totals.sheet} DB=${r.totals.db}`
      );
      for (const f of r.forms) {
        if (f.missingFromSheet || f.missingFromDb || f.error) {
          console.error(
            `[LeadsReconcile]   form ${f.formId} (${f.formName}): ` +
            `meta=${f.meta} sheet=${f.sheet} db=${f.db}` +
            (f.missingFromSheet ? ` — ${f.missingFromSheet} missing from sheet` : '') +
            (f.missingFromDb ? ` — ${f.missingFromDb} missing from DB` : '') +
            (f.error ? ` — ERROR: ${f.error}` : '')
          );
        }
      }
      for (const f of r.unconfiguredFormsWithLeads) {
        console.error(
          `[LeadsReconcile]   UNCONFIGURED form ${f.formId} "${f.formName}" ` +
          `has ${f.leadsCount} lead(s) on page ${f.pageId} but is not in TARGET_FORMS.`
        );
      }
    } catch (e) {
      console.error('[LeadsReconcile] Drift check failed:', e.message);
    }
  };
  run();
  const id = setInterval(run, RECONCILE_CHECK_MS);
  console.log(`[LeadsReconcile] Drift checker started — every ${RECONCILE_CHECK_MS / 3600000}h`);
  return id;
}

module.exports = router;
module.exports.startScheduler = startScheduler;
module.exports.startReconcileScheduler = startReconcileScheduler;
module.exports.reconcile = reconcile;
