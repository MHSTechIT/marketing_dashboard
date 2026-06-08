/**
 * Google Sheets write service.
 * Authenticates via a Service Account JSON key (file or env-inlined).
 * Required env vars (one of):
 *   GOOGLE_SERVICE_ACCOUNT_KEY  – full JSON string of the service account key
 *   GOOGLE_SERVICE_ACCOUNT_FILE – path to the JSON key file (relative to this file)
 *
 * The Google Sheet must be shared (Editor) with the service account email.
 */

const { google } = require('googleapis');
const path = require('path');
const fs = require('fs');

const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];

function loadCredentials() {
  // Option 1: JSON string in env
  const keyJson = (process.env.GOOGLE_SERVICE_ACCOUNT_KEY || '').trim();
  if (keyJson) {
    try {
      return JSON.parse(keyJson);
    } catch (e) {
      throw new Error('[GSheets] GOOGLE_SERVICE_ACCOUNT_KEY is set but is not valid JSON.');
    }
  }

  // Option 2: email + private key as SEPARATE env vars.
  // This is how the deployed/live host supplies credentials (see render.yaml:
  // GOOGLE_SERVICE_ACCOUNT_EMAIL + GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY), because a
  // full multi-line JSON file is awkward to store in an env-var dashboard. The
  // local machine uses the JSON file below, so this path is inert locally — it
  // only activates when BOTH vars are present (i.e. in production).
  const saEmail = (process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || '').trim();
  let saPrivateKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY || process.env.GOOGLE_PRIVATE_KEY || '';
  if (saEmail && saPrivateKey) {
    saPrivateKey = saPrivateKey.trim();
    // Dashboards often wrap the value in surrounding quotes — strip them.
    if ((saPrivateKey.startsWith('"') && saPrivateKey.endsWith('"')) ||
        (saPrivateKey.startsWith("'") && saPrivateKey.endsWith("'"))) {
      saPrivateKey = saPrivateKey.slice(1, -1);
    }
    // Env-stored private keys keep literal "\n" sequences — restore real newlines,
    // otherwise googleapis rejects the key.
    saPrivateKey = saPrivateKey.replace(/\\n/g, '\n').trim();
    return { client_email: saEmail, private_key: saPrivateKey };
  }

  // Option 3: path to key file
  const keyFile = (process.env.GOOGLE_SERVICE_ACCOUNT_FILE || '').trim();
  if (keyFile) {
    const resolved = path.resolve(__dirname, '..', keyFile);
    if (!fs.existsSync(resolved)) {
      throw new Error(`[GSheets] Key file not found: ${resolved}`);
    }
    return JSON.parse(fs.readFileSync(resolved, 'utf8'));
  }

  // Option 4: default file location
  const defaultPath = path.resolve(__dirname, '../credentials/google-service-account.json');
  if (fs.existsSync(defaultPath)) {
    return JSON.parse(fs.readFileSync(defaultPath, 'utf8'));
  }

  throw new Error(
    '[GSheets] No Google credentials found. Provide GOOGLE_SERVICE_ACCOUNT_KEY (JSON string) ' +
    'or GOOGLE_SERVICE_ACCOUNT_FILE (path), or place the key at server/credentials/google-service-account.json'
  );
}

let _sheetsClient = null;

async function getSheetsClient() {
  if (_sheetsClient) return _sheetsClient;
  const credentials = loadCredentials();
  const auth = new google.auth.GoogleAuth({ credentials, scopes: SCOPES });
  _sheetsClient = google.sheets({ version: 'v4', auth });
  return _sheetsClient;
}

/** Convert 1-based column index to spreadsheet letter (1→A, 15→O, 26→Z, 27→AA). */
function colLetter(n) {
  let result = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    result = String.fromCharCode(65 + rem) + result;
    n = Math.floor((n - 1) / 26);
  }
  return result;
}

/**
 * Append rows to a sheet — uses values.append so the sheet auto-expands
 * beyond its default 1000-row limit.
 * @param {string} spreadsheetId
 * @param {string} sheetName  e.g. "DW-live data"
 * @param {Array<Array<string>>} rows  2-D array of cell values
 */
async function appendRows(spreadsheetId, sheetName, rows) {
  if (!rows || rows.length === 0) return;
  const sheets = await getSheetsClient();

  const BATCH = 1000;
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH);
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `${sheetName}!A1`,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: chunk },
    });
  }
}

/**
 * Read all values from a range (used to fetch existing lead IDs for dedup).
 * Pass valueRenderOption='UNFORMATTED_VALUE' to read raw cell values — required
 * for Lead ID dedup because big integers display as scientific notation
 * ("1.4327E+15") in the default FORMATTED_VALUE mode.
 * @param {string} spreadsheetId
 * @param {string} range  e.g. "DW-live data!C:C"
 * @param {string} [valueRenderOption]
 * @returns {Array<Array<string|number>>}
 */
async function readRange(spreadsheetId, range, valueRenderOption) {
  const sheets = await getSheetsClient();
  const req = { spreadsheetId, range };
  if (valueRenderOption) req.valueRenderOption = valueRenderOption;
  const res = await sheets.spreadsheets.values.get(req);
  return res.data.values || [];
}

module.exports = { appendRows, readRange, colLetter, getSheetsClient };
