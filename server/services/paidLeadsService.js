/**
 * Paid Leads service.
 *
 * Reads the "Paid leads" Google Sheet (the list of customers who actually
 * paid / converted) and builds a normalized Set of their phone numbers so we
 * can decide, for any ad-generated lead, whether that lead later converted.
 *
 * The sheet has columns:
 *   S.No | Paid Date | Paid Name | Phone Number | Alternate number
 *
 * Both "Phone Number" and "Alternate number" are matched. Values like "NIL"
 * (and blanks) are ignored.
 *
 * The set is cached in memory with a TTL so we don't re-read ~35k rows on every
 * Conversion-Count request. Override the source via env:
 *   PAID_LEADS_SHEET_ID   (default: the shared "Paid leads" sheet)
 *   PAID_LEADS_SHEET_TAB  (default: "Paid leads- L1")
 *   PAID_LEADS_CACHE_MS   (default: 10 min)
 */

const { readRange, getSheetsClient } = require('./googleSheetsService');

const PAID_SHEET_ID  = (process.env.PAID_LEADS_SHEET_ID  || '17pctKsTlWq93poCMVwnMzL7cPYuIfGN7coFieop2xdM').trim();
// Preferred tab name. The actual tab can differ if it's renamed in the sheet
// (e.g. "Paid leads- L1" → "Paid leads"), so resolvePaidTab() below tolerates that.
const PAID_SHEET_TAB = (process.env.PAID_LEADS_SHEET_TAB || 'Paid leads').trim();
const CACHE_MS       = Math.max(60 * 1000, parseInt(process.env.PAID_LEADS_CACHE_MS, 10) || 10 * 60 * 1000);

/**
 * Normalize a phone number to its last 10 digits.
 * Handles "+919790845094" (lead table) and "9790845094" (paid sheet) alike.
 * Returns '' for anything that isn't a usable 10-digit number (e.g. "NIL", "").
 */
function normalizePhone(raw) {
  if (raw == null) return '';
  let digits = String(raw).replace(/\D/g, '');
  if (digits.length > 10) digits = digits.slice(-10); // drop country code / leading 0s
  return digits.length === 10 ? digits : '';
}

/**
 * Parse a "Paid Date" cell (DD/MM/YYYY, also D/M/YY with - or . separators) to a
 * UTC-midnight millisecond timestamp for date-window comparison.
 * Returns null for empty or non-date values (e.g. "", "old batch joining").
 */
function parsePaidDateMs(raw) {
  const m = String(raw || '').trim().match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/);
  if (!m) return null;
  let dd = parseInt(m[1], 10), mm = parseInt(m[2], 10), yy = parseInt(m[3], 10);
  if (yy < 100) yy += 2000;
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
  return Date.UTC(yy, mm - 1, dd);
}

let _cache = null; // { set: Set<string>, rowsByPhone: Map, loadedAt: number, rowsRead: number }
let _inflight = null;

/**
 * Resolve the actual paid-leads tab title, tolerant of renames. Order of preference:
 *   1. the configured PAID_SHEET_TAB if it exists,
 *   2. else a tab whose title contains "paid" (case-insensitive),
 *   3. else the first tab in the spreadsheet.
 * Falls back to the configured name if the metadata lookup fails. This means a
 * harmless tab rename in the sheet (e.g. "Paid leads- L1" → "Paid leads") no longer
 * breaks the Conversion Count.
 */
async function resolvePaidTab() {
  try {
    const sheets = await getSheetsClient();
    const meta = await sheets.spreadsheets.get({ spreadsheetId: PAID_SHEET_ID });
    const titles = (meta.data.sheets || []).map((s) => s.properties && s.properties.title).filter(Boolean);
    if (titles.length === 0) return PAID_SHEET_TAB;
    if (titles.includes(PAID_SHEET_TAB)) return PAID_SHEET_TAB;
    const paidMatch = titles.find((t) => /paid/i.test(t));
    return paidMatch || titles[0];
  } catch (e) {
    return PAID_SHEET_TAB;
  }
}

async function loadPaidSet() {
  // Read full rows A:G in one call. The "Paid leads" sheet columns are:
  //   A = S.No
  //   B = Access Batch
  //   C = Paid Date
  //   D = Paid Name
  //   E = Phone Number
  //   F = Alternate Number
  //   G = Conversion Mode (Online / Offline)
  const tab = await resolvePaidTab();
  const rows = await readRange(PAID_SHEET_ID, `${tab}!A2:G`);

  const set = new Set();
  // Maps normalizedPhone → Array<{ sNo, accessBatch, paidDate, paidName, phone,
  // alternateNumber, conversionMode, paidDateMs }>. A phone can pay more than once /
  // appear in multiple batches, so we keep ALL paid rows for it — the date-window
  // match (in conversions.js) needs every paid date, not just the first.
  const rowsByPhone = new Map();
  let rowsRead = 0;

  for (const row of rows || []) {
    rowsRead++;
    const sNo            = String(row[0] || '').trim();
    const accessBatch    = String(row[1] || '').trim();
    const paidDate       = String(row[2] || '').trim();
    const paidName       = String(row[3] || '').trim();
    const phoneRaw       = String(row[4] || '').trim();
    const altRaw         = String(row[5] || '').trim();
    const conversionMode = String(row[6] || '').trim();

    const phone = normalizePhone(phoneRaw);
    const alt   = normalizePhone(altRaw);

    const rowData = {
      sNo, accessBatch, paidDate, paidName,
      phone: phoneRaw, alternateNumber: altRaw, conversionMode,
      paidDateMs: parsePaidDateMs(paidDate),
    };

    const addRow = (p) => {
      set.add(p);
      let arr = rowsByPhone.get(p);
      if (!arr) { arr = []; rowsByPhone.set(p, arr); }
      arr.push(rowData);
    };
    if (phone) addRow(phone);
    if (alt && alt !== phone) addRow(alt);
  }

  return { set, rowsByPhone, loadedAt: Date.now(), rowsRead };
}

/**
 * Get the normalized paid-phone Set, using the in-memory cache when fresh.
 * @param {boolean} forceRefresh  bypass the TTL and re-read the sheet.
 * @returns {Promise<{ set: Set<string>, loadedAt: number, rowsRead: number, size: number }>}
 */
async function getPaidPhoneSet(forceRefresh = false) {
  const fresh = _cache && (Date.now() - _cache.loadedAt) < CACHE_MS;
  if (fresh && !forceRefresh) {
    return { ..._cache, size: _cache.set.size };
  }
  // Collapse concurrent refreshes into one sheet read.
  if (!_inflight) {
    _inflight = loadPaidSet()
      .then((c) => { _cache = c; return c; })
      .finally(() => { _inflight = null; });
  }
  try {
    const c = await _inflight;
    return { ...c, size: c.set.size };
  } catch (e) {
    // On failure, fall back to a stale cache if we have one rather than 0.
    if (_cache) return { ..._cache, size: _cache.set.size, stale: true, error: e.message };
    throw e;
  }
}

/**
 * Get the Map of normalizedPhone → paid row data, using the same cache as getPaidPhoneSet.
 * @param {boolean} forceRefresh
 * @returns {Promise<Map<string, {sNo, paidDate, paidName, phone, alternateNumber}>>}
 */
async function getPaidRowsMap(forceRefresh = false) {
  const fresh = _cache && (Date.now() - _cache.loadedAt) < CACHE_MS;
  if (fresh && !forceRefresh) return _cache.rowsByPhone || new Map();
  if (!_inflight) {
    _inflight = loadPaidSet()
      .then((c) => { _cache = c; return c; })
      .finally(() => { _inflight = null; });
  }
  try {
    const c = await _inflight;
    return c.rowsByPhone || new Map();
  } catch (e) {
    if (_cache) return _cache.rowsByPhone || new Map();
    throw e;
  }
}

module.exports = {
  getPaidPhoneSet,
  getPaidRowsMap,
  normalizePhone,
  PAID_SHEET_ID,
  PAID_SHEET_TAB,
};
