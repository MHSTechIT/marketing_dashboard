/**
 * Leads → Google Sheets real-time sync (3 DW forms → "DW-live data").
 *
 * Target forms:
 *   2449233332261397  NSI - Direct Walkin - Conditional Logic   (Integfarms My Health School)
 *   818636004640541   NSI - Direct Walkin Form - Condition Logic (My Health School)
 *   968880282530796   NSI - Direct Walkin Form - Condition Logic (Doctor Farmer)
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

// ── Configuration ─────────────────────────────────────────────────────────────

const TARGET_FORMS = [
  {
    formId:   '2449233332261397',
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
];

const TARGET_FORM_IDS = new Set(TARGET_FORMS.map(f => f.formId));
const FORM_META = Object.fromEntries(TARGET_FORMS.map(f => [f.formId, f]));

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
  console.log(`[LeadsSync] Scheduler started — 3 forms, every ${SYNC_INTERVAL / 60000} min`);
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
        if (!TARGET_FORM_IDS.has(formId)) continue;
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

module.exports = router;
module.exports.startScheduler = startScheduler;
