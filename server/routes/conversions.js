/**
 * Conversion Count — automated phone-match between ad-generated leads and the
 * "Paid leads" sheet (customers who actually paid / converted).
 *
 * For the Best Performing Ad page: each campaign shows "Lead Generated from Ad"
 * (total leads). The Conversion Count is the subset of those leads whose phone
 * number (or the lead's number appearing as an alternate number) is present in
 * the Paid leads sheet — i.e. leads that became paying customers.
 *
 * Matching:
 *   - Leads come from the `leads` table (synced from Meta lead-gen forms): they
 *     carry phone, campaign_id, campaign (name) and created_time.
 *   - A lead "converted" when normalizePhone(lead.phone) ∈ paid-phone Set.
 *   - Counts are grouped by campaign_id (primary) and by normalized campaign
 *     name (fallback, for rows whose campaign_id doesn't line up).
 *
 * Endpoints:
 *   GET /api/conversions/by-campaign?from=YYYY-MM-DD&to=YYYY-MM-DD
 *       → { byCampaignId, byCampaignName, totalMatched, totalLeads, paidSetSize, ... }
 *   POST /api/conversions/refresh-paid   → force re-read of the Paid leads sheet
 */

const express = require('express');
const router = express.Router();

const { supabase } = require('../supabase');
const { getPaidPhoneSet, getPaidRowsMap, normalizePhone } = require('../services/paidLeadsService');

// A lead only counts as a conversion if a paid record exists within this many
// days AFTER the lead was generated. Prevents matching a recent lead against a
// paid record from months/years earlier (same phone, unrelated older payment).
// Override with CONVERSION_WINDOW_DAYS in server/.env.
const CONVERSION_WINDOW_DAYS = Math.max(1, parseInt(process.env.CONVERSION_WINDOW_DAYS, 10) || 30);

// Normalize a campaign name for fallback keying (trim + collapse spaces + lower).
function normCampaignName(name) {
  return String(name || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

// UTC-midnight ms of a lead's IST calendar day (so it compares with paidDateMs).
function leadDateMs(row) {
  const t = row.created_time || row.time_utc || row.TimeUtc;
  if (t) {
    const d = new Date(t);
    if (!isNaN(d.getTime())) {
      const ist = d.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }); // YYYY-MM-DD
      const m = ist.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (m) return Date.UTC(+m[1], +m[2] - 1, +m[3]);
    }
  }
  const dc = String(row.date_char || row.DateChar || '');
  const m2 = dc.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m2) return Date.UTC(+m2[1], +m2[2] - 1, +m2[3]);
  return null;
}

/**
 * Find the paid record (for this lead's phone) that the lead converts to, within
 * the 30-day window. Returns the earliest qualifying paid row (the actual
 * conversion), or null if none of the phone's paid records fall in
 * [leadDay, leadDay + CONVERSION_WINDOW_DAYS]. Paid records dated BEFORE the lead,
 * or with no/unparseable date, never qualify.
 */
function findPaidMatch(phoneNorm, leadMs, rowsByPhone) {
  if (!phoneNorm || leadMs == null) return null;
  const arr = rowsByPhone && rowsByPhone.get(phoneNorm);
  if (!arr || !arr.length) return null;
  let best = null;
  for (const r of arr) {
    if (r.paidDateMs == null) continue;
    const diffDays = (r.paidDateMs - leadMs) / 86400000;
    if (diffDays >= 0 && diffDays <= CONVERSION_WINDOW_DAYS) {
      if (!best || r.paidDateMs < best.paidDateMs) best = r;
    }
  }
  return best;
}

/**
 * Last-touch attribution. For every phone that converted (has an in-period lead
 * with a paid record within 30 days), keep only the MOST RECENT in-period lead —
 * so the conversion is credited to exactly one campaign/ad. This prevents a single
 * payment from being counted under multiple campaigns when the same person was a
 * lead in more than one campaign, and also collapses duplicate leads of the same
 * phone within one campaign.
 * @returns {{ byPhone: Map<string,{leadMs:number,lead:object,paidRow:object}>, scanned: number }}
 */
function resolveLastTouchByPhone(leads, rowsByPhone, from, to) {
  const byPhone = new Map();
  let scanned = 0;
  for (const lead of leads) {
    if (from && to) {
      const d = istDate(lead);
      if (d && (d < from || d > to)) continue;
    }
    scanned++;
    const phone = normalizePhone(lead.phone);
    if (!phone) continue;
    const leadMs = leadDateMs(lead);
    const paidRow = findPaidMatch(phone, leadMs, rowsByPhone);
    if (!paidRow) continue;
    const prev = byPhone.get(phone);
    // Keep the lead with the latest creation date (closest to / last before the payment).
    if (!prev || (leadMs != null && (prev.leadMs == null || leadMs > prev.leadMs))) {
      byPhone.set(phone, { leadMs, lead, paidRow });
    }
  }
  return { byPhone, scanned };
}

// IST date (YYYY-MM-DD) for a lead, matching how the dashboard filters leads.
function istDate(row) {
  const t = row.created_time || row.time_utc || row.TimeUtc;
  if (t) {
    const d = new Date(t);
    if (!isNaN(d.getTime())) return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  }
  const dc = row.date_char || row.DateChar;
  return dc ? String(dc).slice(0, 10) : '';
}

/**
 * Page through the `leads` table for a created_time window and return minimal
 * rows. We widen the UTC window by ±1 day around the requested IST range so an
 * IST-day lead stored at a UTC boundary isn't missed, then filter by IST date.
 */
async function fetchLeadsForRange(from, to, full = false) {
  if (!supabase) throw new Error('Database not configured');

  let fromISO = null, toISO = null;
  if (from) fromISO = new Date(`${from}T00:00:00+05:30`).toISOString();
  if (to)   toISO   = new Date(`${to}T23:59:59.999+05:30`).toISOString();

  // full=true also pulls id/ad_name/name for the drill-down detail view.
  const cols = full
    ? 'id, phone, campaign_id, campaign, ad_id, ad_name, name, created_time, date_char'
    : 'phone, campaign_id, campaign, created_time, date_char';

  const PAGE = 1000;
  const MAX_ROWS = 200000; // safety ceiling
  const rows = [];
  for (let offset = 0; offset < MAX_ROWS; offset += PAGE) {
    let q = supabase
      .from('leads')
      .select(cols)
      .order('created_time', { ascending: false })
      .range(offset, offset + PAGE - 1);
    if (fromISO) q = q.gte('created_time', fromISO);
    if (toISO)   q = q.lte('created_time', toISO);

    const { data, error } = await q;
    if (error) throw error;
    const batch = data || [];
    rows.push(...batch);
    if (batch.length < PAGE) break;
  }
  return rows;
}

// GET /api/conversions/by-campaign
router.get('/by-campaign', async (req, res) => {
  const from = (req.query.from || '').trim() || null;
  const to   = (req.query.to   || '').trim() || null;
  const forceRefresh = String(req.query.refresh || '').trim() === '1';

  try {
    const [paid, leads] = await Promise.all([
      getPaidPhoneSet(forceRefresh),
      fetchLeadsForRange(from, to),
    ]);
    const rowsByPhone = paid.rowsByPhone || new Map();

    // Last-touch: each converted phone is credited to exactly one campaign — the
    // one whose lead is most recent before the payment. (Phone+Alternate match,
    // selected period, 30-day window, and strict campaign_id all applied inside.)
    const { byPhone, scanned } = resolveLastTouchByPhone(leads, rowsByPhone, from, to);

    const byCampaignId = {};
    const byCampaignName = {};
    for (const { lead } of byPhone.values()) {
      const cid = lead.campaign_id ? String(lead.campaign_id) : '';
      const cnameKey = normCampaignName(lead.campaign);
      if (cid) byCampaignId[cid] = (byCampaignId[cid] || 0) + 1;
      if (cnameKey) byCampaignName[cnameKey] = (byCampaignName[cnameKey] || 0) + 1;
    }

    res.json({
      ok: true,
      from, to,
      byCampaignId,
      byCampaignName,
      totalMatched: byPhone.size,
      totalLeads: leads.length,
      scanned,
      paidSetSize: paid.size,
      paidLoadedAt: new Date(paid.loadedAt).toISOString(),
      paidStale: paid.stale || false,
    });
  } catch (err) {
    console.error('[Conversions] by-campaign error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /api/conversions/drill-down?from=YYYY-MM-DD&to=YYYY-MM-DD&campaign_id=XXX
// Returns the individual paid leads that make up the conversion count for a
// campaign. Uses the SAME last-touch attribution as /by-campaign — it fetches all
// in-period leads so cross-campaign last-touch is resolved correctly, then keeps
// only the conversions credited to this campaign. This guarantees the popup's row
// count always equals the campaign's displayed Conversion Count.
router.get('/drill-down', async (req, res) => {
  const from       = (req.query.from        || '').trim() || null;
  const to         = (req.query.to          || '').trim() || null;
  const campaignId = (req.query.campaign_id || '').trim();

  if (!campaignId) {
    return res.status(400).json({ ok: false, error: 'campaign_id is required' });
  }

  try {
    const [paid, leads] = await Promise.all([
      getPaidPhoneSet(),
      fetchLeadsForRange(from, to, true),
    ]);
    const rowsByPhone = paid.rowsByPhone || new Map();

    const { byPhone } = resolveLastTouchByPhone(leads, rowsByPhone, from, to);

    const matchedLeads = [];
    for (const { lead, paidRow } of byPhone.values()) {
      if (String(lead.campaign_id || '') !== String(campaignId)) continue;
      matchedLeads.push({
        leadId:          lead.id        || '',
        adName:          lead.ad_name   || '',
        leadName:        lead.name      || '',
        leadPhone:       lead.phone     || '',
        createdTime:     lead.created_time || '',
        sNo:             paidRow.sNo            || '',
        accessBatch:     paidRow.accessBatch    || '',
        paidDate:        paidRow.paidDate       || '',
        paidName:        paidRow.paidName       || '',
        paidPhone:       paidRow.phone          || '',
        alternateNumber: paidRow.alternateNumber || '',
        conversionMode:  paidRow.conversionMode || '',
      });
    }

    res.json({ ok: true, campaignId, from, to, matchedCount: matchedLeads.length, leads: matchedLeads });
  } catch (err) {
    console.error('[Conversions] drill-down error:', err.message);
    const isDbConnErr = /timeout|ETIMEDOUT|ECONNREFUSED|ECONNRESET|connection terminated|connection refused/i.test(err.message || '');
    if (isDbConnErr) {
      return res.json({ ok: true, campaignId, from, to, matchedCount: 0, leads: [], dbUnavailable: true });
    }
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /api/conversions/refresh-paid — force re-read of the Paid leads sheet
router.post('/refresh-paid', async (req, res) => {
  try {
    const paid = await getPaidPhoneSet(true);
    res.json({ ok: true, paidSetSize: paid.size, loadedAt: new Date(paid.loadedAt).toISOString() });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
