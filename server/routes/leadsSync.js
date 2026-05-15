/**
 * Leads → Google Sheets sync.
 *
 * GET  /api/leads-sync/webhook        Meta webhook verification challenge
 * POST /api/leads-sync/webhook        Real-time lead notifications from Meta
 * POST /api/leads-sync/backfill       Push all historical DB leads for the target form
 * GET  /api/leads-sync/status         Quick health/config check
 */

const express = require('express');
const router = express.Router();
const axios = require('axios');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { appendRows, readRange } = require('../services/googleSheetsService');
const { getLeadsByCampaignAndAd } = require('../repositories/leadsRepository');
const { parseFieldData, findFirstValueByKeyPattern } = require('../constants/leadFieldLabels');

const TARGET_FORM_ID  = '2449233332261397';
const TARGET_FORM_NAME = 'NSI - Direct Walkin Form - Condition Logic';
const SHEET_ID        = process.env.GOOGLE_SHEET_ID  || '1RWOgyXVLZQvHJpSzRk1Vd02CipCL2KLEjrJNQT6pZMU';
const SHEET_TAB       = process.env.GOOGLE_SHEET_TAB || 'DW-live data';
const VERIFY_TOKEN    = process.env.META_WEBHOOK_VERIFY_TOKEN || 'mhs_dw_sync_2025';
const META_VERSION    = process.env.META_API_VERSION || 'v21.0';

const HEADERS = [
  'Date', 'Time', 'Lead ID', 'Name', 'Phone', 'Email',
  'Campaign', 'Ad Name', 'City', 'Sugar Poll', 'Form Name',
  'Ad ID', 'Campaign ID', 'Form ID', 'Page ID',
];

function getAccessToken() {
  return (
    process.env.META_ACCESS_TOKEN ||
    process.env.META_SYSTEM_ACCESS_TOKEN ||
    process.env.META_SYSTEM_ACCESS_TOKEN_1 ||
    ''
  ).trim();
}

/** Convert a stored lead (DB row or Meta API response) into a sheet row array. */
function leadToRow(lead) {
  const fieldData = Array.isArray(lead.field_data)
    ? parseFieldData(lead.field_data)
    : {};

  const createdTime = lead.created_time || lead.TimeUtc || lead.time_utc || '';
  let date = lead.date_char || lead.DateChar || lead.date || '';
  let time = '';
  if (!date && createdTime) date = String(createdTime).split('T')[0];
  if (createdTime) {
    const after = String(createdTime).split('T')[1] || '';
    time = after.replace('Z', '').split('+')[0].split('.')[0];
  }

  const name     = lead.Name || lead.name || fieldData.full_name || fieldData['Full Name'] || 'N/A';
  const phone    = lead.Phone || lead.phone || fieldData.phone_number || fieldData['Phone Number'] || 'N/A';
  const email    = lead.email || fieldData.email || fieldData['Email'] || '';
  const city     = lead.city  || fieldData.city  || findFirstValueByKeyPattern(fieldData, /city/i) || '';
  const sugar    = lead.SugarPoll || lead.sugar_poll || fieldData['Sugar Poll'] || '';
  const campaign = lead.Campaign || lead.campaign || lead.campaign_name || '';
  const adName   = lead.ad_name || '';
  const leadId   = String(lead.lead_id || lead.Id || lead.id || '');

  return [
    date, time, leadId, name, phone, email,
    campaign, adName, city, sugar, TARGET_FORM_NAME,
    String(lead.ad_id || ''), String(lead.campaign_id || ''),
    String(lead.form_id || TARGET_FORM_ID), String(lead.page_id || ''),
  ];
}

/** Ensure row 1 is the header row. */
async function ensureHeaders() {
  const existing = await readRange(SHEET_ID, `${SHEET_TAB}!A1:O1`);
  const first = (existing[0] || []);
  if (first.length === 0 || first[0] !== 'Date') {
    await appendRows(SHEET_ID, SHEET_TAB, [HEADERS]);
  }
}

// ── GET /api/leads-sync/webhook ── Meta verification ──────────────────────────
router.get('/webhook', (req, res) => {
  const mode      = req.query['hub.mode'];
  const token     = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('[LeadsSync] Webhook verified ✓');
    return res.status(200).send(challenge);
  }
  console.warn('[LeadsSync] Webhook verification failed — wrong token?', { mode, receivedToken: token });
  return res.sendStatus(403);
});

// ── POST /api/leads-sync/webhook ── Real-time Meta leads ──────────────────────
router.post('/webhook', async (req, res) => {
  // Respond immediately so Meta does not retry the delivery.
  res.sendStatus(200);

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

        console.log(`[LeadsSync] New lead ${leadgenId} from form ${formId}`);

        try {
          const { data } = await axios.get(
            `https://graph.facebook.com/${META_VERSION}/${leadgenId}`,
            {
              params: {
                fields: 'field_data,created_time,ad_id,campaign_id,form_id,page_id,ad_name,campaign_name',
                access_token: getAccessToken(),
              },
              timeout: 10000,
            }
          );

          const lead = {
            lead_id:      leadgenId,
            form_id:      formId,
            page_id:      String(entry.id || val.page_id || ''),
            ad_id:        String(val.ad_id        || data.ad_id        || ''),
            campaign_id:  String(val.campaign_id  || data.campaign_id  || ''),
            ad_name:      data.ad_name      || val.ad_name      || '',
            campaign:     data.campaign_name || val.campaign_name || '',
            created_time: data.created_time || '',
            field_data:   data.field_data   || [],
          };

          await ensureHeaders();
          await appendRows(SHEET_ID, SHEET_TAB, [leadToRow(lead)]);
          console.log(`[LeadsSync] Lead ${leadgenId} written to sheet ✓`);
        } catch (e) {
          console.error(`[LeadsSync] Failed to write lead ${leadgenId}:`, e.message || e);
        }
      }
    }
  } catch (err) {
    console.error('[LeadsSync] Webhook handler error:', err.message || err);
  }
});

// ── POST /api/leads-sync/backfill ── Push historical DB leads to sheet ─────────
router.post('/backfill', async (req, res) => {
  try {
    console.log(`[LeadsSync] Backfill started for form ${TARGET_FORM_ID}`);

    const leads = await getLeadsByCampaignAndAd([], [], null, null, [TARGET_FORM_ID]);
    if (!leads || leads.length === 0) {
      return res.json({ ok: true, pushed: 0, skipped: 0, message: 'No leads found in DB for this form.' });
    }

    console.log(`[LeadsSync] Found ${leads.length} DB leads`);

    // Read existing Lead IDs from column C to avoid duplicates.
    await ensureHeaders();
    const existingCol = await readRange(SHEET_ID, `${SHEET_TAB}!C:C`);
    const existingIds = new Set(
      existingCol.flat().map(v => String(v || '').trim()).filter(Boolean)
    );
    existingIds.delete('Lead ID'); // remove header

    const newRows = leads
      .map(leadToRow)
      .filter(row => !existingIds.has(row[2])); // col index 2 = Lead ID

    if (newRows.length === 0) {
      return res.json({ ok: true, pushed: 0, skipped: leads.length, message: 'All leads already in sheet.' });
    }

    // Write in chunks of 500 to respect Sheets API rate limits.
    const CHUNK = 500;
    for (let i = 0; i < newRows.length; i += CHUNK) {
      await appendRows(SHEET_ID, SHEET_TAB, newRows.slice(i, i + CHUNK));
      console.log(`[LeadsSync] Backfill progress: ${Math.min(i + CHUNK, newRows.length)}/${newRows.length}`);
    }

    console.log(`[LeadsSync] Backfill complete — pushed ${newRows.length}, skipped ${leads.length - newRows.length}`);
    return res.json({
      ok: true,
      pushed: newRows.length,
      skipped: leads.length - newRows.length,
      message: `Pushed ${newRows.length} leads to "${SHEET_TAB}".`,
    });
  } catch (err) {
    console.error('[LeadsSync] Backfill error:', err.message || err);
    return res.status(500).json({ ok: false, error: err.message || String(err) });
  }
});

// ── GET /api/leads-sync/status ── Health check ────────────────────────────────
router.get('/status', (req, res) => {
  res.json({
    ok: true,
    targetFormId:  TARGET_FORM_ID,
    targetFormName: TARGET_FORM_NAME,
    sheetId:       SHEET_ID,
    sheetTab:      SHEET_TAB,
    webhookUrl:    `${process.env.RENDER_EXTERNAL_URL || 'https://marketing-dashboard-brjf.onrender.com'}/api/leads-sync/webhook`,
    verifyToken:   VERIFY_TOKEN,
  });
});

module.exports = router;
