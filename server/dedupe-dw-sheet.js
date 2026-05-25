/**
 * One-time cleanup: remove duplicate rows from the "DW-live data" tab.
 *
 * A duplicate = a row whose Lead ID (column C) already appeared in an EARLIER
 * row. The first occurrence is kept; later duplicates are deleted. Rows with an
 * empty Lead ID are left untouched (can't be deduped safely).
 *
 * SAFE BY DEFAULT: runs as a dry-run and only reports what it would delete.
 * Add --apply to actually delete the duplicate rows.
 *
 * Usage (from server/):
 *   node dedupe-dw-sheet.js           # dry-run, shows duplicates
 *   node dedupe-dw-sheet.js --apply   # performs the deletion
 */
require('dotenv').config();
const { getSheetsClient } = require('./services/googleSheetsService');

const SHEET_ID  = process.env.GOOGLE_SHEET_ID  || '1RWOgyXVLZQvHJpSzRk1Vd02CipCL2KLEjrJNQT6pZMU';
const SHEET_TAB = process.env.GOOGLE_SHEET_TAB || 'DW-live data';
const LEAD_ID_COL_INDEX = 2; // column C (0-based)
const APPLY = process.argv.includes('--apply');

function normId(v) {
  return String(v == null ? '' : v).trim().replace(/^'/, '');
}

(async () => {
  const sheets = await getSheetsClient();

  // 1) Resolve the numeric sheetId (gid) for the tab
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID });
  const tab = (meta.data.sheets || []).find(s => s.properties.title === SHEET_TAB);
  if (!tab) {
    console.error(`Tab "${SHEET_TAB}" not found in spreadsheet ${SHEET_ID}.`);
    process.exit(1);
  }
  const sheetId = tab.properties.sheetId;

  // 2) Read all rows (unformatted so big Lead IDs come back as digits, not 1.4E+15)
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${SHEET_TAB}!A:P`,
    valueRenderOption: 'UNFORMATTED_VALUE',
  });
  const rows = res.data.values || [];
  if (rows.length === 0) { console.log('Sheet is empty — nothing to do.'); process.exit(0); }

  // 3) Detect header row (row 1 if it starts with "Date"/"Lead ID")
  const firstRow = rows[0] || [];
  const hasHeader = String(firstRow[0]).trim() === 'Date' || String(firstRow[LEAD_ID_COL_INDEX]).trim() === 'Lead ID';
  const dataStart = hasHeader ? 1 : 0;

  // 4) Walk rows; collect later duplicates (keep first occurrence)
  const seen = new Set();
  const dupRows = []; // { rowNumber1Based, sheetRowIndex0Based, id, name }
  for (let i = dataStart; i < rows.length; i++) {
    const id = normId((rows[i] || [])[LEAD_ID_COL_INDEX]);
    if (!id) continue; // can't dedupe blank IDs — leave them
    if (seen.has(id)) {
      dupRows.push({
        rowNumber: i + 1,            // human-readable (1-based) sheet row
        sheetRowIndex: i,            // 0-based index used by the API
        id,
        name: String((rows[i] || [])[3] || ''),
      });
    } else {
      seen.add(id);
    }
  }

  console.log(`Tab "${SHEET_TAB}" — ${rows.length} rows, ${seen.size} unique Lead IDs, ${dupRows.length} duplicate row(s).`);
  if (dupRows.length === 0) { console.log('No duplicates found. Nothing to delete.'); process.exit(0); }

  dupRows.forEach(d => console.log(`   row ${d.rowNumber}: id=${d.id} name="${d.name}"`));

  if (!APPLY) {
    console.log('\nDRY-RUN. No rows were deleted. Re-run with --apply to delete the rows listed above.');
    process.exit(0);
  }

  // 5) Delete rows bottom-up so earlier indices stay valid as we remove
  const requests = dupRows
    .sort((a, b) => b.sheetRowIndex - a.sheetRowIndex)
    .map(d => ({
      deleteDimension: {
        range: { sheetId, dimension: 'ROWS', startIndex: d.sheetRowIndex, endIndex: d.sheetRowIndex + 1 },
      },
    }));

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SHEET_ID,
    requestBody: { requests },
  });

  console.log(`\n✓ Deleted ${dupRows.length} duplicate row(s) from "${SHEET_TAB}".`);
  process.exit(0);
})().catch(e => { console.error('Dedupe failed:', e.message); process.exit(1); });
