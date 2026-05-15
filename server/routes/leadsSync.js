/**
 * Leads → Google Sheets real-time sync.
 *
 * Architecture:
 *  - Fetches leads directly from Meta API (form 2449233332261397)
 *  - Runs automatically every 5 minutes via startScheduler()
 *  - Also handles Meta webhook for instant delivery
 *  - Backfill fetches all historical leads from Meta (not DB)
 *
 * Endpoints:
 *  GET  /api/leads-sync/webhook   Meta webhook verification
 *  POST /api/leads-sync/webhook   Real-time Meta lead delivery
 *  POST /api/leads-sync/backfill  Push ALL historical Meta leads to sheet
 *  POST /api/leads-sync/sync      Manual trigger for incremental sync
 *  GET  /api/leads-sync/status    Health / config check
 */

const express = require('express');
const router = express.Router();
const axios = require('axios');
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { appendRows, readRange } = require('../services/googleSheetsService');

const TARGET_FORM_ID   = '2449233332261397';
const TARGET_FORM_NAME = 'NSI - Direct Walkin Form - Condition Logic';
const SHEET_ID         = process.env.GOOGLE_SHEET_ID  || '1RWOgyXVLZQvHJpSzRk1Vd02CipCL2KLEjrJNQT6pZMU';
const SHEET_TAB        = process.env.GOOGLE_SHEET_TAB || 'DW-live data';
const VERIFY_TOKEN     = process.env.META_WEBHOOK_VERIFY_TOKEN || 'mhs_dw_sync_2025';
const META_VERSION     = process.env.META_API_VERSION || 'v21.0';
const SYNC_INTERVAL_MS = 5 * 60 * 1000; // every 5 minutes

const STATE_FILE = path.join(__dirname, '..', 'data', 'leads-sync-state.json');

const HEADERS = [
  'Date', 'Time', 'Lead ID', 'Name', 'Phone',
  'City', 'Post Code', 'Sugar Poll', 'Visit Availability',
  'Campaign', 'Ad Name', 'Form Name', 'Ad ID', 'Campaign ID', 'Form ID',
];

// ── Helpers ──────────────────────────────────────────────────────────────────

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
  catch { return { lastSyncTime: null }; }
}

function writeState(state) {
  try {
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  } catch (e) {
    console.warn('[LeadsSync] Could not write state file:', e.message);
  }
}

/** Parse field_data array from Meta API into a plain key→value object. */
function parseFields(fieldDataArray) {
  const out = {};
  if (!Array.isArray(fieldDataArray)) return out;
  for (const item of fieldDataArray) {
    if (!item || !item.name) continue;
    const key = String(item.name).trim().toLowerCase();
    const val = Array.isArray(item.values) && item.values.length > 0
      ? String(item.values[0]).trim() : '';
    out[key] = val;
    // also store raw name
    out[String(item.name).trim()] = val;
  }
  return out;
}

/** Find first field value whose key matches a pattern. */
function findField(fields, pattern) {
  for (const [k, v] of Object.entries(fields)) {
    if (pattern.test(k) && v) return v;
  }
  return '';
}

/** Convert a Meta API lead object into a 15-column sheet row. */
function metaLeadToRow(lead) {
  const fields = parseFields(lead.field_data || []);

  const createdTime = lead.created_time || '';
  const date = createdTime ? createdTime.split('T')[0] : '';
  const timePart = createdTime.split('T')[1] || '';
  const time = timePart.replace('Z', '').split('+')[0].split('.')[0];

  const name     = fields.full_name || findField(fields, /full.?name/i) || 'N/A';
  const phone    = fields.phone || findField(fields, /phone/i) || 'N/A';
  const city     = fields.city  || findField(fields, /city/i)  || '';
  const postCode = fields.post_code || findField(fields, /post.?code|zip/i) || '';
  const sugar    = findField(fields, /sugar/i) || '';
  const visit    = findField(fields, /visit|poonamallee|walkin|walk.in/i) || '';
  const campaign = lead.campaign_name || '';
  const adName   = lead.ad_name || '';

  return [
    date, time, String(lead.id || ''), name, phone,
    city, postCode, sugar, visit,
    campaign, adName, TARGET_FORM_NAME,
    String(lead.ad_id || ''), String(lead.campaign_id || ''), TARGET_FORM_ID,
  ];
}

/** Ensure header row exists in the sheet. */
async function ensureHeaders() {
  const existing = await readRange(SHEET_ID, `${SHEET_TAB}!A1:O1`);
  const first = (existing[0] || []);
  if (first.length === 0 || first[0] !== 'Date') {
    await appendRows(SHEET_ID, SHEET_TAB, [HEADERS]);
  }
}

/**
 * Fetch leads from Meta API for TARGET_FORM_ID.
 * If sinceTime is set, stops pagination once leads are older than sinceTime.
 * Meta returns leads newest-first, so we can stop early.
 */
async function fetchLeadsFromMeta(sinceTime = null) {
  const token = getAccessToken();
  const allLeads = [];
  let nextUrl = `https://graph.facebook.com/${META_VERSION}/${TARGET_FORM_ID}/leads`;
  let params = {
    fields: 'id,created_time,field_data,ad_id,campaign_id,ad_name,campaign_name',
    limit: 100,
    access_token: token,
  };
  let pageCount = 0;
  const maxPages = sinceTime ? 50 : 200; // cap pages for safety

  while (nextUrl && pageCount < maxPages) {
    const { data } = await axios.get(nextUrl, {
      params: pageCount === 0 ? params : undefined,
      timeout: 20000,
    });

    const batch = data.data || [];
    let stopEarly = false;

    for (const lead of batch) {
      if (sinceTime && new Date(lead.created_time) <= new Date(sinceTime)) {
        stopEarly = true;
        break;
      }
      allLeads.push(lead);
    }

    if (stopEarly || !data.paging?.next) break;
    nextUrl = data.paging.next;
    pageCount++;
  }

  return allLeads;
}

// ── Core sync function ────────────────────────────────────────────────────────

let _syncRunning = false;

async function runSync(fullBackfill = false) {
  if (_syncRunning) {
    console.log('[LeadsSync] Sync already running, skipping');
    return { skipped: true };
  }
  _syncRunning = true;

  try {
    const state = readState();
    const sinceTime = fullBackfill ? null : state.lastSyncTime;

    console.log(`[LeadsSync] Fetching leads from Meta${sinceTime ? ' since ' + sinceTime : ' (all time)'}`);
    const leads = await fetchLeadsFromMeta(sinceTime);

    if (leads.length === 0) {
      console.log('[LeadsSync] No new leads from Meta');
      writeState({ ...state, lastRun: new Date().toISOString() });
      return { pushed: 0, total: 0 };
    }

    console.log(`[LeadsSync] Fetched ${leads.length} leads from Meta`);

    // Read existing Lead IDs from sheet column C to skip duplicates
    await ensureHeaders();
    const existingCol = await readRange(SHEET_ID, `${SHEET_TAB}!C:C`);
    const existingIds = new Set(
      existingCol.flat().map(v => String(v || '').trim()).filter(Boolean)
    );
    existingIds.delete('Lead ID');

    // Convert and deduplicate; Meta returns newest-first so reverse for oldest-first append
    const newRows = leads
      .map(metaLeadToRow)
      .filter(row => !existingIds.has(row[2]))
      .reverse(); // oldest first in sheet

    if (newRows.length === 0) {
      console.log('[LeadsSync] All leads already in sheet');
      writeState({ ...state, lastRun: new Date().toISOString() });
      return { pushed: 0, total: leads.length };
    }

    // Append in batches of 500
    const CHUNK = 500;
    for (let i = 0; i < newRows.length; i += CHUNK) {
      await appendRows(SHEET_ID, SHEET_TAB, newRows.slice(i, i + CHUNK));
      console.log(`[LeadsSync] Progress: ${Math.min(i + CHUNK, newRows.length)}/${newRows.length}`);
    }

    // Save the most recent lead's time as the new checkpoint
    const mostRecent = leads.reduce(
      (max, l) => new Date(l.created_time) > new Date(max) ? l.created_time : max,
      leads[0].created_time
    );
    writeState({ lastSyncTime: mostRecent, lastRun: new Date().toISOString(), totalPushed: (state.totalPushed || 0) + newRows.length });

    console.log(`[LeadsSync] Done — pushed ${newRows.length} new leads ✓`);
    return { pushed: newRows.length, total: leads.length };
  } catch (err) {
    console.error('[LeadsSync] Sync error:', err.message || err);
    throw err;
  } finally {
    _syncRunning = false;
  }
}

// ── Scheduler ─────────────────────────────────────────────────────────────────

function startScheduler() {
  // Run immediately on startup
  runSync(false).catch(e => console.error('[LeadsSync] Startup sync failed:', e.message));

  // Then every 5 minutes
  setInterval(() => {
    runSync(false).catch(e => console.error('[LeadsSync] Scheduled sync failed:', e.message));
  }, SYNC_INTERVAL_MS);

  console.log(`[LeadsSync] Scheduler started — syncing every ${SYNC_INTERVAL_MS / 60000} minutes`);
}

// ── Routes ────────────────────────────────────────────────────────────────────

// GET /api/leads-sync/webhook — Meta webhook verification
router.get('/webhook', (req, res) => {
  const mode      = req.query['hub.mode'];
  const token     = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('[LeadsSync] Webhook verified ✓');
    return res.status(200).send(challenge);
  }
  console.warn('[LeadsSync] Webhook verification failed', { mode, receivedToken: token });
  return res.sendStatus(403);
});

// POST /api/leads-sync/webhook — Real-time Meta lead (instant, no polling delay)
router.post('/webhook', async (req, res) => {
  res.sendStatus(200); // respond immediately so Meta doesn't retry

  try {
    const body = req.body;
    if (!body || body.object !== 'page') return;

    for (const entry of (body.entry || [])) {
      for (const change of (entry.changes || [])) {
        if (change.field !== 'leadgen') continue;
        const val    = change.value || {};
        const formId = String(val.form_id || '');
        if (formId !== TARGET_FORM_ID) continue;

        const leadgenId = String(val.leadgen_id || '');
        if (!leadgenId) continue;

        console.log(`[LeadsSync] Webhook: new lead ${leadgenId}`);
        try {
          const { data } = await axios.get(
            `https://graph.facebook.com/${META_VERSION}/${leadgenId}`,
            {
              params: {
                fields: 'id,created_time,field_data,ad_id,campaign_id,ad_name,campaign_name',
                access_token: getAccessToken(),
              },
              timeout: 10000,
            }
          );
          data.id = leadgenId;
          await ensureHeaders();
          await appendRows(SHEET_ID, SHEET_TAB, [metaLeadToRow(data)]);
          console.log(`[LeadsSync] Webhook lead ${leadgenId} written ✓`);
        } catch (e) {
          console.error(`[LeadsSync] Webhook lead ${leadgenId} failed:`, e.message);
        }
      }
    }
  } catch (err) {
    console.error('[LeadsSync] Webhook error:', err.message);
  }
});

// POST /api/leads-sync/backfill — Fetch ALL historical leads from Meta and push
router.post('/backfill', async (req, res) => {
  try {
    console.log('[LeadsSync] Full backfill started');
    const result = await runSync(true);
    return res.json({ ok: true, ...result });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message || String(err) });
  }
});

// POST /api/leads-sync/sync — Manual incremental sync trigger
router.post('/sync', async (req, res) => {
  try {
    const result = await runSync(false);
    return res.json({ ok: true, ...result });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message || String(err) });
  }
});

// GET /api/leads-sync/status — Health check
router.get('/status', (req, res) => {
  const state = readState();
  res.json({
    ok: true,
    targetFormId:   TARGET_FORM_ID,
    targetFormName: TARGET_FORM_NAME,
    sheetId:        SHEET_ID,
    sheetTab:       SHEET_TAB,
    lastSyncTime:   state.lastSyncTime || 'never',
    lastRun:        state.lastRun || 'never',
    totalPushed:    state.totalPushed || 0,
    syncIntervalMin: SYNC_INTERVAL_MS / 60000,
    webhookUrl: `https://marketing-dashboard-brjf.onrender.com/api/leads-sync/webhook`,
    verifyToken: VERIFY_TOKEN,
  });
});

module.exports = router;
module.exports.startScheduler = startScheduler;
