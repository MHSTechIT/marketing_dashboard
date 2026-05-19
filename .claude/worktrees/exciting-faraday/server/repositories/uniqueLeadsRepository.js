// server/repositories/uniqueLeadsRepository.js
const { supabase } = require('../supabase');

const SOURCE_LABELS = {
  paid: 'Paid',
  youtube: 'YouTube',
  free: 'Free',
  direct_walk_in: 'Direct Walk-In'
};

const SOURCE_PRIORITY = ['Paid', 'YouTube', 'Free', 'Direct Walk-In'];

function expandScientific(val) {
  let str = String(val).trim();
  if (/[eE]/.test(str)) {
    const num = Number(str);
    if (!isNaN(num) && isFinite(num)) return num.toFixed(0);
  }
  return str;
}

function normalizePhone(phone) {
  if (phone == null || phone === '') return '';
  return expandScientific(phone).replace(/\s/g, '');
}

function extractLast10Digits(phone) {
  const digitsOnly = expandScientific(phone).replace(/[^0-9]/g, '');
  if (digitsOnly.length < 10) return null;
  return digitsOnly.slice(-10);
}

const PRIORITY_RANK = { 'Paid': 1, 'YouTube': 2, 'Free': 3, 'Direct Walk-In': 4 };

function getEffectivePriority(sourceType) {
  if (!sourceType) return 99;
  const sources = sourceType.split(',').map(s => s.trim());
  let best = 99;
  for (const s of sources) {
    const p = PRIORITY_RANK[s];
    if (p !== undefined && p < best) best = p;
  }
  return best;
}

function getEffectiveSource(sourceType) {
  if (!sourceType) return null;
  const sources = sourceType.split(',').map(s => s.trim());
  let best = null;
  let bestRank = 99;
  for (const s of sources) {
    const p = PRIORITY_RANK[s];
    if (p !== undefined && p < bestRank) { bestRank = p; best = s; }
  }
  return best;
}

function toRow(lead, sourceLabel) {
  const phone = normalizePhone(lead.phoneNumber ?? lead.phone ?? '');
  const userId = extractLast10Digits(phone);
  return {
    date_time: lead.dateTime ?? lead.date_time ?? '',
    batch_code: lead.batchCode ?? lead.batch_code ?? '',
    phone,
    user_id: userId,
    sugar_poll: lead.sugarPoll ?? lead.sugar_poll ?? '',
    email: lead.email ?? '',
    lead_source_type: sourceLabel
  };
}

async function getExistingByUserIds(userIds) {
  if (!supabase) throw new Error('Supabase not configured');
  const map = new Map();
  const batchSize = 500;
  for (let i = 0; i < userIds.length; i += batchSize) {
    const batch = userIds.slice(i, i + batchSize);
    const { data, error } = await supabase
      .from('unique_leads')
      .select('user_id, lead_source_type')
      .in('user_id', batch);
    if (error) throw error;
    (data || []).forEach(r => map.set(r.user_id, r.lead_source_type));
  }
  return map;
}

async function importLeads(sourceType, rows) {
  if (!supabase) throw new Error('Supabase not configured');

  const allowed = ['paid', 'youtube', 'free', 'direct_walk_in'];
  const src = sourceType && allowed.includes(String(sourceType).toLowerCase())
    ? String(sourceType).toLowerCase()
    : null;
  if (!src) throw new Error('Invalid source type. Use: paid, youtube, free, or direct_walk_in');

  const sourceLabel = SOURCE_LABELS[src];
  const newPriority = PRIORITY_RANK[sourceLabel];
  const processed = rows.map(r => toRow(r, sourceLabel));

  const validRows = [];
  const errorRows = [];
  for (const row of processed) {
    if (!row.user_id) {
      errorRows.push({
        phone: row.phone,
        batchCode: row.batch_code,
        error: 'Phone number has fewer than 10 digits'
      });
    } else {
      validRows.push(row);
    }
  }

  if (validRows.length === 0) {
    return {
      imported: 0,
      upgraded: 0,
      duplicatesFound: 0,
      errors: errorRows.length,
      previewRows: [],
      errorRows: errorRows.slice(0, 100)
    };
  }

  const seen = new Set();
  const deduped = [];
  for (const row of validRows) {
    if (!seen.has(row.user_id)) {
      seen.add(row.user_id);
      deduped.push(row);
    }
  }

  const uniqueUserIds = deduped.map(r => r.user_id);
  const existingMap = await getExistingByUserIds(uniqueUserIds);

  const toInsert = [];
  const toUpgradeIds = [];
  const duplicateRows = [];
  let upgradedCount = 0;

  if (src === 'paid') {
    // Rule 1: Paid always overrides. No conflicts. Insert all + upgrade lower sources.
    for (const row of deduped) {
      const existingSource = existingMap.get(row.user_id);
      toInsert.push(row);
      if (existingSource && getEffectiveSource(existingSource) !== 'Paid') {
        upgradedCount++;
      }
    }
  } else {
    // Rules 2-4: Check against higher-priority sources
    for (const row of deduped) {
      const existingSource = existingMap.get(row.user_id);

      if (!existingSource) {
        toInsert.push(row);
        continue;
      }

      const existingPri = getEffectivePriority(existingSource);

      if (newPriority < existingPri) {
        // Uploading higher priority than existing → upgrade
        toUpgradeIds.push(row.user_id);
        upgradedCount++;
      } else if (newPriority > existingPri) {
        // Existing has higher priority → conflict (do NOT insert)
        duplicateRows.push({
          date_time: row.date_time,
          batch_code: row.batch_code,
          phone: row.phone,
          user_id: row.user_id,
          sugar_poll: row.sugar_poll,
          email: row.email,
          uploaded_as: sourceLabel,
          existing_sources: getEffectiveSource(existingSource) || existingSource
        });
      }
      // Same priority (same source) → skip silently
    }
  }

  // Insert new leads (for Paid this upserts all, upgrading lower sources automatically)
  if (toInsert.length > 0) {
    const batchSize = 500;
    for (let i = 0; i < toInsert.length; i += batchSize) {
      const batch = toInsert.slice(i, i + batchSize);
      const { error } = await supabase
        .from('unique_leads')
        .upsert(batch, { onConflict: 'user_id' });
      if (error) throw error;
    }
  }

  // Batch-upgrade existing leads to the new higher-priority source
  if (toUpgradeIds.length > 0) {
    const batchSize = 500;
    for (let i = 0; i < toUpgradeIds.length; i += batchSize) {
      const batch = toUpgradeIds.slice(i, i + batchSize);
      const { error } = await supabase
        .from('unique_leads')
        .update({ lead_source_type: sourceLabel })
        .in('user_id', batch);
      if (error) throw error;
    }
  }

  // Store conflicts in duplicate_leads table
  if (duplicateRows.length > 0) {
    const batchSize = 500;
    for (let i = 0; i < duplicateRows.length; i += batchSize) {
      const batch = duplicateRows.slice(i, i + batchSize);
      const { error } = await supabase.from('duplicate_leads').insert(batch);
      if (error) throw error;
    }
  }

  const newInserts = src === 'paid'
    ? deduped.filter(r => !existingMap.has(r.user_id)).length
    : toInsert.length;

  const previewRows = rows.slice(0, 500).map(r => {
    const phone = normalizePhone(r.phoneNumber ?? r.phone ?? '');
    const userId = extractLast10Digits(phone);
    return {
      dateTime: r.dateTime ?? r.date_time,
      batchCode: r.batchCode ?? r.batch_code,
      phoneNumber: r.phoneNumber ?? r.phone,
      userId: userId || '',
      sugarPoll: r.sugarPoll ?? r.sugar_poll,
      email: r.email,
      leadSourceType: sourceLabel
    };
  });

  return {
    imported: newInserts,
    upgraded: upgradedCount,
    duplicatesFound: duplicateRows.length,
    errors: errorRows.length,
    previewRows,
    errorRows: errorRows.slice(0, 100)
  };
}

async function getLeads(filter) {
  if (!supabase) throw new Error('Supabase not configured');

  let query = supabase.from('unique_leads').select('*').order('id', { ascending: true });

  if (filter === 'duplicates') {
    query = query.like('lead_source_type', '%,%');
  } else if (filter && filter !== 'all') {
    const sourceLabel = SOURCE_LABELS[filter];
    if (sourceLabel) {
      query = query.eq('lead_source_type', sourceLabel);
    }
  } else {
    query = query.not('lead_source_type', 'like', '%,%');
  }

  const { data, error } = await query;
  if (error) throw error;

  return (data || []).map(row => ({
    dateTime: row.date_time,
    batchCode: row.batch_code,
    phoneNumber: row.phone,
    userId: row.user_id,
    sugarPoll: row.sugar_poll,
    email: row.email,
    leadSourceType: row.lead_source_type
  }));
}

const SOURCE_SHORT = { 'Paid': 'P', 'YouTube': 'Y', 'Free': 'F', 'Direct Walk-In': 'D' };

function buildRepeatString(counts) {
  return SOURCE_PRIORITY
    .filter(s => counts[s])
    .map(s => `${SOURCE_SHORT[s] || s}-${counts[s]}`)
    .join(', ');
}

async function getDuplicates() {
  if (!supabase) throw new Error('Supabase not configured');

  const { data, error } = await supabase
    .from('duplicate_leads')
    .select('*')
    .order('detected_at', { ascending: false });
  if (error) throw error;

  const rows = data || [];

  const repeatMap = {};
  for (const row of rows) {
    const uid = row.user_id;
    if (!repeatMap[uid]) repeatMap[uid] = {};
    const src = row.uploaded_as || '';
    if (src) repeatMap[uid][src] = (repeatMap[uid][src] || 0) + 1;
    const existing = row.existing_sources || '';
    if (existing) {
      existing.split(',').map(s => s.trim()).filter(Boolean).forEach(s => {
        if (!repeatMap[uid][s]) repeatMap[uid][s] = 1;
      });
    }
  }

  return rows.map(row => ({
    id: row.id,
    dateTime: row.date_time,
    batchCode: row.batch_code,
    phoneNumber: row.phone,
    userId: row.user_id,
    sugarPoll: row.sugar_poll,
    email: row.email,
    uploadedAs: row.uploaded_as,
    existingSources: row.existing_sources,
    repeatLeads: buildRepeatString(repeatMap[row.user_id] || {}),
    detectedAt: row.detected_at
  }));
}

async function deleteDuplicate(id) {
  if (!supabase) throw new Error('Supabase not configured');
  const { error } = await supabase.from('duplicate_leads').delete().eq('id', id);
  if (error) throw error;
  return { deleted: 1 };
}

async function bulkDeleteDuplicates(ids) {
  if (!supabase) throw new Error('Supabase not configured');
  const { error } = await supabase.from('duplicate_leads').delete().in('id', ids);
  if (error) throw error;
  return { deleted: ids.length };
}

module.exports = {
  importLeads,
  getLeads,
  getDuplicates,
  deleteDuplicate,
  bulkDeleteDuplicates,
  SOURCE_LABELS
};
