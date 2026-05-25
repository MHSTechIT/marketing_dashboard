// Read-only diagnostic: for every page in META_PAGE_IDS, report exactly where the
// Meta Page Access Token / leads flow succeeds or fails — so we know precisely
// what access each page still needs. Does NOT write anything. Run from server/:
//   node diagnose-page-tokens.js
require('dotenv').config();
const axios = require('axios');

const META_API_VERSION = 'v24.0';
const SYSTEM_TOKEN = (process.env.META_SYSTEM_ACCESS_TOKEN || process.env.META_ACCESS_TOKEN || '').trim();
const USER_TOKEN = (process.env.META_ACCESS_TOKEN || '').trim();

function getPageIds() {
  const multi = (process.env.META_PAGE_IDS || '').trim();
  if (multi) return multi.split(',').map(s => s.trim()).filter(Boolean);
  const single = (process.env.META_PAGE_ID || '').trim();
  return single ? [single] : [];
}

async function get(url, params) {
  try {
    const { data } = await axios.get(url, { params, timeout: 30000 });
    return { ok: true, data };
  } catch (e) {
    const err = e.response?.data?.error;
    return { ok: false, code: err?.code, msg: err?.message || e.message };
  }
}

async function diagnosePage(pageId) {
  const base = `https://graph.facebook.com/${META_API_VERSION}/${pageId}`;
  const row = { pageId, name: '?', tokenSource: 'none', formsReadable: false, formCount: 0, leadsReadable: false, notes: [] };

  // 1) Page name (via system token) — confirms the token can even see the page
  const nameRes = await get(base, { fields: 'name', access_token: SYSTEM_TOKEN });
  if (nameRes.ok) row.name = nameRes.data.name || '(unnamed)';
  else row.notes.push(`name lookup failed (code ${nameRes.code}): ${nameRes.msg}`);

  // 2) Mint a Page Access Token — system token first, then user token
  let pageToken = '';
  const sysTok = await get(base, { fields: 'access_token', access_token: SYSTEM_TOKEN });
  if (sysTok.ok && sysTok.data.access_token) {
    pageToken = sysTok.data.access_token;
    row.tokenSource = 'system';
  } else {
    row.notes.push(`system-token exchange failed (code ${sysTok.code}): ${sysTok.msg}`);
    if (USER_TOKEN && USER_TOKEN !== SYSTEM_TOKEN) {
      const usrTok = await get(base, { fields: 'access_token', access_token: USER_TOKEN });
      if (usrTok.ok && usrTok.data.access_token) {
        pageToken = usrTok.data.access_token;
        row.tokenSource = 'user';
      } else {
        row.notes.push(`user-token exchange failed (code ${usrTok.code}): ${usrTok.msg}`);
      }
    }
  }

  if (!pageToken) return row; // can't proceed without a page token

  // 3) Read leadgen_forms (proves forms-list access)
  const forms = await get(`${base}/leadgen_forms`, { fields: 'id,name', limit: 100, access_token: pageToken });
  if (forms.ok) {
    row.formsReadable = true;
    row.formCount = (forms.data.data || []).length;
    // 4) Read 1 lead from the first form (proves leads_retrieval scope + page role)
    const firstForm = (forms.data.data || [])[0];
    if (firstForm) {
      const leads = await get(`https://graph.facebook.com/${META_API_VERSION}/${firstForm.id}/leads`, { limit: 1, access_token: pageToken });
      if (leads.ok) row.leadsReadable = true;
      else row.notes.push(`leads read failed for form ${firstForm.id} (code ${leads.code}): ${leads.msg}`);
    } else {
      row.notes.push('no forms returned — nothing to read leads from');
    }
  } else {
    row.notes.push(`leadgen_forms read failed (code ${forms.code}): ${forms.msg}`);
  }

  return row;
}

(async () => {
  const pageIds = getPageIds();
  console.log(`\n=== Meta Page Token Diagnostic ===`);
  console.log(`System token: ${SYSTEM_TOKEN ? 'set' : 'MISSING'} | User token: ${USER_TOKEN ? 'set' : 'MISSING'}`);
  console.log(`Pages to check: ${pageIds.length}\n`);

  for (const pid of pageIds) {
    const r = await diagnosePage(pid);
    const status = r.leadsReadable ? '✅ WORKING (leads readable)'
      : r.formsReadable ? '⚠️  forms OK but LEADS blocked'
      : r.tokenSource !== 'none' ? '⚠️  page token OK but forms blocked'
      : '❌ NO page token (no access)';
    console.log(`Page ${pid}  "${r.name}"`);
    console.log(`   ${status}`);
    console.log(`   token source: ${r.tokenSource} | forms: ${r.formCount} | leads readable: ${r.leadsReadable}`);
    if (r.notes.length) r.notes.forEach(n => console.log(`     - ${n}`));
    console.log('');
  }

  console.log('Interpretation:');
  console.log('  ❌ NO page token  → System User must be added to this page in Business Manager (or supply META_PAGE_TOKEN_<pageId>).');
  console.log('  ⚠️  LEADS blocked → token lacks leads_retrieval / page role for lead data.');
  console.log('  ✅ WORKING        → leads sync will populate this page on its next run.\n');
  process.exit(0);
})();
