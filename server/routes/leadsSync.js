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
const SYNC_INTERVAL = 5 * 60 * 1000; // 5 minutes

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

function metaLeadToRow(lead, formId) {
  const meta  = FORM_META[formId] || {};
  const fields = parseFields(lead.field_data || []);

  const createdTime = lead.created_time || '';
  const date = createdTime ? createdTime.split('T')[0] : '';
  const timePart = createdTime.split('T')[1] || '';
  const time = timePart.replace('Z', '').split('+')[0].split('.')[0];

  return [
    date,
    time,
    String(lead.id || lead.lead_id || ''),
    fields.full_name  || findField(fields, /full.?name/i)  || 'N/A',
    fields.phone      || findField(fields, /phone/i)       || 'N/A',
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

async function runSync(fullBackfill = false) {
  if (_syncRunning) { console.log('[LeadsSync] Already running, skipping'); return { skipped: true }; }
  _syncRunning = true;

  try {
    const state = readState();

    // Read existing Lead IDs from sheet (column C) once — used for all 3 forms
    await ensureHeaders();
    const existingCol = await readRange(SHEET_ID, `${SHEET_TAB}!C:C`);
    const existingIds = new Set(
      existingCol.flat().map(v => String(v || '').trim()).filter(Boolean)
    );
    existingIds.delete('Lead ID');

    let totalPushed = 0;

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

      // Build rows, deduplicate, oldest-first for sheet ordering
      const newRows = leads
        .map(l => metaLeadToRow(l, formId))
        .filter(r => r[2] && !existingIds.has(r[2]))
        .reverse();

      // Add newly pushed IDs to set to avoid cross-form duplicates in same run
      newRows.forEach(r => existingIds.add(r[2]));

      if (newRows.length === 0) {
        console.log(`[LeadsSync] Form ${formId} — all already in sheet`);
        state[formId] = { ...state[formId], lastRun: new Date().toISOString() };
        continue;
      }

      // Append in chunks
      const CHUNK = 500;
      for (let i = 0; i < newRows.length; i += CHUNK) {
        await appendRows(SHEET_ID, SHEET_TAB, newRows.slice(i, i + CHUNK));
      }

      // Update checkpoint to the most recent lead's created_time
      const mostRecent = leads.reduce(
        (max, l) => new Date(l.created_time) > new Date(max) ? l.created_time : max,
        leads[0].created_time
      );
      state[formId] = {
        lastSyncTime: mostRecent,
        lastRun: new Date().toISOString(),
        totalPushed: (state[formId]?.totalPushed || 0) + newRows.length,
      };

      console.log(`[LeadsSync] Form ${formId} — pushed ${newRows.length} new rows ✓`);
      totalPushed += newRows.length;
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
  // Then every 5 minutes
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
          await appendRows(SHEET_ID, SHEET_TAB, [metaLeadToRow(data, formId)]);
          console.log(`[LeadsSync] Webhook lead ${leadgenId} written ✓`);
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
