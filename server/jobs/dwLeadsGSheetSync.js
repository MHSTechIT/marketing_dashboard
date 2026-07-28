/**
 * DW Leads → Google Sheet Sync
 *
 * Fetches leads DIRECTLY from Meta (page-based) so we always get today's data
 * regardless of Supabase sync state.  Also fills Sugar Poll, City, Street, Form Name
 * from Meta field_data.
 *
 * Flow:
 *  1. Load DW campaign IDs from both ad accounts (cached 6 h).
 *  2. Get page access token for the DW page (113830624877941).
 *  3. Enumerate lead-gen forms on that page.
 *  4. For each form fetch all leads (with field_data).
 *  5. Keep only leads whose campaign_id is in the DW set
 *     (fallback: campaign_name contains "walk" or "direct walk").
 *  6. Append only NEW leads to the Google Sheet.
 *
 * Columns: Date & Time | Campaign | Ad Name | Lead Name | Phone Number |
 *          Sugar Poll  | City     | Street  | Form Name
 */

const axios = require('axios');
const fs    = require('fs');
const path  = require('path');
const { appendRows } = require('../services/googleSheetsService');

// ── Config ────────────────────────────────────────────────────────────────────
const DW_AD_ACCOUNTS   = ['384231607347196', '1795178471390515'];
const DW_PAGE_ID       = '113830624877941';
const SPREADSHEET_ID   = '1RWOgyXVLZQvHJpSzRk1Vd02CipCL2KLEjrJNQT6pZMU';
const SHEET_NAME       = 'DW LEADS FROM MKT SW';
const META_API_VER     = 'v24.0';
// Push to the DW Google Sheet every 2 minutes (safety-net poll; the Meta webhook
// still delivers each lead instantly). The 2-min floor keeps Meta API load well
// below the old 1-min cadence that tripped rate limits. Override with DW_SHEET_SYNC_MS.
const SYNC_INTERVAL_MS       = Math.max(2 * 60 * 1000, parseInt(process.env.DW_SHEET_SYNC_MS, 10) || 2 * 60 * 1000);
const CAMPAIGN_CACHE_MS      = 6 * 60 * 60 * 1000;

const STATE_FILE = path.resolve(__dirname, '../data/dwSheetSyncState.json');

// ── State ─────────────────────────────────────────────────────────────────────
function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const r = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
      return {
        syncedIds:          new Set(r.syncedIds || []),
        campaignIds:        r.campaignIds || [],
        campaignIdsFetchedAt: r.campaignIdsFetchedAt || 0
      };
    }
  } catch { /* fresh */ }
  return { syncedIds: new Set(), campaignIds: [], campaignIdsFetchedAt: 0 };
}

function saveState(s) {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify({
      syncedIds: [...s.syncedIds],
      campaignIds: s.campaignIds,
      campaignIdsFetchedAt: s.campaignIdsFetchedAt
    }), 'utf8');
  } catch (e) { console.warn('[DWSync] save state failed:', e.message); }
}

// ── Meta helpers ──────────────────────────────────────────────────────────────
function getToken() {
  const t = (process.env.META_ACCESS_TOKEN || '').trim();
  if (!t) throw new Error('[DWSync] META_ACCESS_TOKEN not set.');
  return t;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function metaGet(url, params, attempt = 0) {
  try {
    const r = await axios.get(url, {
      params,
      timeout: 45000,
      httpsAgent: new (require('https').Agent)({ keepAlive: false })
    });
    return r.data;
  } catch (err) {
    const code = err.response?.data?.error?.code;
    const msg  = err.response?.data?.error?.message || err.message;
    const isRateLimit = code === 613 || code === 4 || code === 17 || code === 32 ||
                        /too many calls|rate limit|request limit/i.test(msg);
    const isNetwork = /ENOTFOUND|ECONNRESET|ETIMEDOUT|ECONNREFUSED|timeout/i.test(msg);
    if ((isRateLimit || isNetwork) && attempt < 6) {
      const wait = isRateLimit ? 30000 * (attempt + 1) : Math.min(5000 * (attempt + 1), 20000);
      console.warn(`[DWSync] ${isRateLimit ? 'Rate limit' : 'Network error'} — waiting ${wait / 1000}s (attempt ${attempt + 1}/6)…`);
      await sleep(wait);
      return metaGet(url, params, attempt + 1);
    }
    throw new Error(msg);
  }
}

// ── Step 1: DW campaign IDs ───────────────────────────────────────────────────
async function refreshCampaignIds(state, token) {
  const now = Date.now();
  if (state.campaignIds.length > 0 && (now - state.campaignIdsFetchedAt) < CAMPAIGN_CACHE_MS) {
    return new Set(state.campaignIds);
  }
  console.log('[DWSync] Fetching DW campaign IDs from Meta…');
  const all = [];
  for (const accId of DW_AD_ACCOUNTS) {
    let url    = `https://graph.facebook.com/${META_API_VER}/act_${accId}/campaigns`;
    let params = { fields: 'id', limit: 200, access_token: token };
    let pages  = 0;
    while (url && pages < 20) {
      try {
        const data = await metaGet(url, params);
        (data.data || []).forEach(c => all.push(c.id));
        url    = data.paging?.next || null;
        params = {};
        pages++;
        if (url) await sleep(500);
      } catch (e) {
        console.error(`[DWSync] campaigns for ${accId}: ${e.message}`);
        break;
      }
    }
    console.log(`[DWSync] Account ${accId}: ${all.length} campaign IDs so far`);
    await sleep(2000);
  }
  if (all.length > 0) {
    state.campaignIds        = all;
    state.campaignIdsFetchedAt = now;
  }
  return new Set(all);
}

// ── Step 2: page token ────────────────────────────────────────────────────────
async function getPageToken(token) {
  const data = await metaGet(
    `https://graph.facebook.com/${META_API_VER}/${DW_PAGE_ID}`,
    { fields: 'access_token', access_token: token }
  );
  if (!data.access_token) throw new Error('[DWSync] Could not get page access token.');
  return data.access_token;
}

// ── Step 3: lead-gen forms ────────────────────────────────────────────────────
async function getLeadGenForms(pageToken) {
  const forms = [];
  let url    = `https://graph.facebook.com/${META_API_VER}/${DW_PAGE_ID}/leadgen_forms`;
  let params = { fields: 'id,name,leads_count', limit: 100, access_token: pageToken };
  while (url) {
    const data = await metaGet(url, params);
    (data.data || []).forEach(f => forms.push(f));
    url    = data.paging?.next || null;
    params = {};
    if (url) await sleep(300);
  }
  return forms;
}

// ── Step 4: fetch leads from a form ──────────────────────────────────────────
const LEAD_FIELDS = 'id,ad_id,campaign_id,campaign_name,ad_name,created_time,field_data,form_id';

async function fetchLeadsFromForm(formId, pageToken) {
  const leads = [];
  let url    = `https://graph.facebook.com/${META_API_VER}/${formId}/leads`;
  let params = { fields: LEAD_FIELDS, limit: 200, access_token: pageToken };
  let pages  = 0;
  while (url && pages < 200) {
    const data = await metaGet(url, params);
    (data.data || []).forEach(l => leads.push(l));
    url    = data.paging?.next || null;
    params = {};
    pages++;
    if (url) await sleep(200);
  }
  return leads;
}

// ── Step 5: field_data helpers ────────────────────────────────────────────────
function extractField(fieldData, keys) {
  if (!Array.isArray(fieldData)) return '';
  for (const item of fieldData) {
    const name = (item.name || '').toLowerCase().replace(/\s+/g, '_');
    if (keys.some(k => name.includes(k))) {
      return (item.values || [])[0] || '';
    }
  }
  return '';
}

function parseFields(fieldData) {
  return {
    name:      extractField(fieldData, ['full_name', 'name']),
    phone:     extractField(fieldData, ['phone', 'mobile']),
    sugarPoll: extractField(fieldData, ['sugar', 'சர்க்கரை']),
    city:      extractField(fieldData, ['city', 'town', 'நகரம்']),
    street:    extractField(fieldData, ['street', 'address', 'முகவரி'])
  };
}

// Check if a form is a DW lead-gen form based on its name.
// Primary filter: all leads from matching forms are DW leads regardless of campaign name.
function isDwForm(formName) {
  const n = formName || '';
  // Exclude HR, dental, webinar, and other clearly non-DW forms
  if (/dental|sales.execut|video.editor|content.writer|digital.market|performance.market|technical.support|lead form to web|physio|diabetes|mhs.sales/i.test(n)) {
    return false;
  }
  // Include DW form naming series: AS\d, DFW\d, NSI, D\d\d, S\d[A-E], or contains walk/direct
  return /walk|dfw|nsi|direct/i.test(n) || /^(?:AS|DFW|NSI|D\d|S\d)\d/i.test(n);
}

function isDwLead(lead, campaignIds, formName) {
  // Primary: form-name based check (most reliable)
  if (isDwForm(formName)) return true;
  // Fallback: campaign_id in DW accounts set
  if (campaignIds.size > 0 && lead.campaign_id && campaignIds.has(lead.campaign_id)) return true;
  // Fallback: campaign name pattern
  const name = (lead.campaign_name || '').toLowerCase();
  return /direct.?walk|walk.?in|dw\b/.test(name);
}

function formatDateIST(iso) {
  if (!iso) return '';
  try {
    const ist = new Date(new Date(iso).getTime() + 5.5 * 60 * 60 * 1000);
    return [
      String(ist.getUTCDate()).padStart(2,'0'),
      String(ist.getUTCMonth()+1).padStart(2,'0'),
      ist.getUTCFullYear()
    ].join('/') + ' ' + [
      String(ist.getUTCHours()).padStart(2,'0'),
      String(ist.getUTCMinutes()).padStart(2,'0')
    ].join(':');
  } catch { return iso; }
}

// ── Main sync ─────────────────────────────────────────────────────────────────
let _running = false;

async function runDwLeadsSync() {
  if (_running) { console.log('[DWSync] Already running — skipping.'); return; }
  _running = true;
  console.log('[DWSync] Starting sync…');

  try {
    const state      = loadState();
    const token      = getToken();
    const campaignIds = await refreshCampaignIds(state, token);
    console.log(`[DWSync] DW campaign IDs: ${campaignIds.size}`);

    const pageToken = await getPageToken(token);
    const forms     = await getLeadGenForms(pageToken);
    console.log(`[DWSync] Lead-gen forms on page: ${forms.length}`);

    const newRows = [];
    let totalLeads = 0;

    for (const form of forms) {
      let leads;
      try {
        leads = await fetchLeadsFromForm(form.id, pageToken);
      } catch (e) {
        console.warn(`[DWSync] Form ${form.name}: ${e.message} — skipping`);
        continue;
      }

      for (const lead of leads) {
        totalLeads++;
        if (!isDwLead(lead, campaignIds, form.name)) continue;

        const id = String(lead.id || '');
        if (!id || state.syncedIds.has(id)) continue;

        const f = parseFields(lead.field_data || []);
        newRows.push([
          formatDateIST(lead.created_time),
          lead.campaign_name || '',
          lead.ad_name       || '',
          f.name,
          f.phone,
          f.sugarPoll,
          f.city,
          f.street,
          form.name          || ''
        ]);
        state.syncedIds.add(id);
      }
      await sleep(300);
    }

    console.log(`[DWSync] Scanned ${totalLeads} total leads — ${newRows.length} new DW leads to push.`);

    if (newRows.length > 0) {
      // Sort by date ascending (parse DD/MM/YYYY HH:MM for correct chronological order)
      const parseDate = s => {
        const m = (s || '').match(/^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2})/);
        if (!m) return 0;
        return new Date(+m[3], +m[2] - 1, +m[1], +m[4], +m[5]).getTime();
      };
      newRows.sort((a, b) => parseDate(a[0]) - parseDate(b[0]));
      await appendRows(SPREADSHEET_ID, SHEET_NAME, newRows);
      console.log(`[DWSync] ✓ Pushed ${newRows.length} rows to Google Sheet.`);
    } else {
      console.log('[DWSync] No new leads — sheet is up to date.');
    }

    state.lastSyncAt = new Date().toISOString();
    saveState(state);

  } catch (err) {
    console.error('[DWSync] Sync error:', err.message);
  }

  _running = false;
}

// ── Preflight ─────────────────────────────────────────────────────────────────
/**
 * Verify the target tab actually exists before scheduling anything.
 *
 * `appendRows` uses spreadsheets.values.append, which does NOT create a missing
 * tab — it returns a 400. SHEET_NAME ('DW LEADS FROM MKT SW') is no longer a tab
 * in this spreadsheet: it was renamed (the current 'Over All Leads' tab holds
 * this job's exact 9 columns with a new leading 'Ad Account Name' column). So
 * every run since the rename has re-scanned Meta and then thrown on append —
 * every 2 minutes, indefinitely, with only a generic error line.
 *
 * Rather than guess at the new layout and write to a 51k-row sheet unattended,
 * refuse to schedule and say exactly what is wrong.
 */
async function preflightSheetTab() {
  const { getSheetsClient } = require('../services/googleSheetsService');
  const sheets = await getSheetsClient();
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  const tabs = (meta.data.sheets || []).map(s => s.properties.title);
  if (tabs.includes(SHEET_NAME)) return { ok: true, tabs };
  return { ok: false, tabs };
}

// ── Scheduler ─────────────────────────────────────────────────────────────────
function startDwLeadsGSheetSyncScheduler() {
  if (String(process.env.DW_SHEET_SYNC_ENABLED).toLowerCase() === 'false') {
    console.log('[DWSync] Disabled via DW_SHEET_SYNC_ENABLED=false — not scheduling.');
    return null;
  }

  let intervalId = null;
  preflightSheetTab()
    .then(({ ok, tabs }) => {
      if (!ok) {
        console.error(
          `[DWSync] NOT STARTED — target tab "${SHEET_NAME}" does not exist in ` +
          `spreadsheet ${SPREADSHEET_ID}. Existing tabs: ${tabs.map(t => `"${t}"`).join(', ')}. ` +
          `This job has been failing on every append since the tab was renamed. ` +
          `Fix SHEET_NAME in server/jobs/dwLeadsGSheetSync.js (note: "Over All Leads" ` +
          `carries an extra leading "Ad Account Name" column this job does not write), ` +
          `or set DW_SHEET_SYNC_ENABLED=false to silence this.`
        );
        return;
      }
      console.log(`[DWSync] Scheduler started — every ${SYNC_INTERVAL_MS / 60000} min.`);
      runDwLeadsSync().catch(e => console.error('[DWSync] Initial run error:', e.message));
      intervalId = setInterval(() => {
        runDwLeadsSync().catch(e => console.error('[DWSync] Interval run error:', e.message));
      }, SYNC_INTERVAL_MS);
    })
    .catch(e => console.error('[DWSync] Preflight failed — not scheduling:', e.message));

  return { get id() { return intervalId; } };
}

module.exports = { startDwLeadsGSheetSyncScheduler, runDwLeadsSync };
