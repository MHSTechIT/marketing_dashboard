// server/repositories/leadsRepository.js
const { supabase } = require('../supabase');

/** Cached: which physical Leads table/column naming PostgREST exposes. */
let _leadsDbShape = null;

/**
 * Force table shape: snake = public.leads (date_char, time_utc), mixed = "Leads" (DateChar, TimeUtc).
 * Set in server/.env when auto-detection picks the wrong table.
 */
function getForcedLeadsDbShape() {
  const v = String(process.env.LEADS_DB_SHAPE || '').trim().toLowerCase();
  if (v === 'snake' || v === 'lowercase' || v === 'leads') return 'snake';
  if (v === 'mixed' || v === 'capital' || v === 'quoted') return 'mixed';
  return null;
}

/**
 * Prefer lowercase public.leads (date_char, time_utc) from supabase-complete-schema.sql;
 * fall back to quoted "Leads" (DateChar, TimeUtc) if that is what exists.
 */
async function resolveLeadsDbShape() {
  const forced = getForcedLeadsDbShape();
  if (forced) return forced;
  if (_leadsDbShape) return _leadsDbShape;
  if (!supabase) {
    _leadsDbShape = 'snake';
    return _leadsDbShape;
  }
  const [snakeHead, mixedHead] = await Promise.all([
    supabase.from('leads').select('id', { count: 'exact', head: true }),
    supabase.from('Leads').select('Id', { count: 'exact', head: true }),
  ]);
  const snakeOk = !snakeHead.error;
  const mixedOk = !mixedHead.error;
  const snakeN = snakeHead.count ?? 0;
  const mixedN = mixedHead.count ?? 0;

  if (mixedOk && mixedN > 0) {
    _leadsDbShape = 'mixed';
    return _leadsDbShape;
  }
  if (snakeOk && snakeN > 0) {
    _leadsDbShape = 'snake';
    return _leadsDbShape;
  }
  if (mixedOk) {
    _leadsDbShape = 'mixed';
    return _leadsDbShape;
  }
  if (snakeOk) {
    _leadsDbShape = 'snake';
    return _leadsDbShape;
  }
  console.warn(
    '[LeadsRepository] Neither public.leads nor public.Leads is readable; defaulting to snake_case.',
    snakeHead.error?.message || mixedHead.error?.message
  );
  _leadsDbShape = 'snake';
  return _leadsDbShape;
}

function leadsTableName(shape) {
  return shape === 'mixed' ? 'Leads' : 'leads';
}

function leadsCol(shape) {
  if (shape === 'mixed') {
    return {
      id: 'Id',
      date: 'DateChar',
      time: 'TimeUtc',
      name: 'Name',
      phone: 'Phone',
      campaign: 'Campaign',
    };
  }
  return {
    id: 'id',
    date: 'date_char',
    time: 'time_utc',
    name: 'name',
    phone: 'phone',
    campaign: 'campaign',
  };
}

/**
 * Check if timestamp contains timezone offset (e.g., +05:30)
 * Meta API returns timestamps with timezone offset, and we should preserve them as-is
 * @param {string} timestamp - Timestamp string to check
 * @returns {boolean} - True if timestamp contains timezone offset
 */
function hasTimezoneOffset(timestamp) {
  if (!timestamp || typeof timestamp !== 'string') return false;
  return timestamp.includes('+05:30') || 
         timestamp.includes('+0530') || 
         timestamp.includes('+05:30:00') ||
         timestamp.includes('-05:30') ||
         timestamp.match(/[+-]\d{2}:?\d{2}/); // Generic timezone pattern
}

/**
 * Save or update leads in bulk
 * Uses Supabase upsert to handle duplicates based on lead_id
 */
async function saveLeads(leads) {
  if (!leads || leads.length === 0) {
    return { inserted: 0, updated: 0 };
  }

  if (!supabase) {
    throw new Error('Supabase not configured');
  }

  try {
    const shape = await resolveLeadsDbShape();
    const tableName = leadsTableName(shape);
    let inserted = 0;
    let updated = 0;
    
    // Process leads in batches of 100 for better performance
    const batchSize = 100;
    for (let i = 0; i < leads.length; i += batchSize) {
      const batch = leads.slice(i, i + batchSize);
      
      const transformedBatch = batch.map(lead => {
        const leadId = lead.lead_id || lead.Id || lead.id || null;
        const formId = lead.form_id || null;
        const pageId = lead.page_id || null;
        const campaignId = lead.campaign_id || null;
        const adId = lead.ad_id || null;
        const name = lead.Name || lead.name || 'N/A';
        const phone = lead.Phone || lead.phone || 'N/A';
        const createdTime = lead.created_time || lead.TimeUtc || lead.Time || null;
        const campaign = lead.Campaign || lead.campaign_name || null;
        const adName = lead.ad_name || null;
        const sugarPoll = lead.SugarPoll ?? lead.sugar_poll ?? null;
        const leadIntel = lead.lead_intel ?? lead.LeadIntel ?? null;
        
        // Validate: Skip conversion if timestamp already has timezone offset (+05:30)
        const hasOffset = hasTimezoneOffset(createdTime);
        
        // Extract DateChar without timezone conversion if timezone offset is present
        let dateChar = lead.DateChar || lead.Date || null;
        if (!dateChar && createdTime) {
          if (hasOffset) {
            // Extract date directly from string (preserves timezone)
            dateChar = createdTime.split('T')[0];
          } else {
            // Fallback for timestamps without timezone
            dateChar = new Date(createdTime).toISOString().split('T')[0];
          }
        }
        
        // Store timestamp exactly as received if it has timezone offset, otherwise convert to ISO
        let createdTimeValue = null;
        if (createdTime) {
          try {
            if (hasOffset) {
              // Store exactly as received (with timezone offset)
              createdTimeValue = createdTime;
            } else {
              // Convert to ISO for timestamps without timezone
              const date = new Date(createdTime);
              if (!isNaN(date.getTime())) {
                createdTimeValue = date.toISOString();
              }
            }
          } catch (e) {
            console.warn(`[LeadsRepository] Invalid date format for lead ${leadId}:`, createdTime);
          }
        }
        
        const baseMixed = {
          Name: name,
          Phone: phone,
          TimeUtc: createdTimeValue,
          DateChar: dateChar,
          Campaign: campaign,
          ad_id: adId,
          campaign_id: campaignId,
          lead_id: leadId,
          form_id: formId,
          page_id: pageId,
          created_time: createdTimeValue,
          ad_name: adName,
          SugarPoll: sugarPoll,
          sugar_poll: sugarPoll,
          ...(leadIntel != null ? { lead_intel: leadIntel } : {}),
        };
        if (shape === 'mixed') return baseMixed;
        return {
          name,
          phone,
          time_utc: createdTimeValue,
          date_char: dateChar,
          campaign,
          ad_id: adId,
          campaign_id: campaignId,
          lead_id: leadId,
          form_id: formId,
          page_id: pageId,
          created_time: createdTimeValue,
          ad_name: adName,
          sugar_poll: sugarPoll,
          ...(leadIntel != null ? { lead_intel: leadIntel } : {}),
        };
      });

      const selectCols =
        shape === 'mixed'
          ? 'Id, lead_id, Name, Phone, TimeUtc, DateChar, Campaign'
          : 'id, lead_id, name, phone, time_utc, date_char, campaign';

      const { data, error } = await supabase
        .from(tableName)
        .upsert(transformedBatch, {
          onConflict: 'lead_id',
          ignoreDuplicates: false
        })
        .select(selectCols);

      if (error) {
        console.error('[LeadsRepository] Error upserting leads batch:', error);
        throw error;
      }

      // Count inserted vs updated by checking if rows already existed
      // Since upsert doesn't tell us which were inserted vs updated,
      // we'll estimate based on the response
      // All rows in batch were processed
      for (const lead of batch) {
        // Check if lead_id existed before (we can't tell for sure, so we'll assume new)
        // In practice, you might want to query first to determine this
        const existing = transformedBatch.find(l => l.lead_id === (lead.lead_id || lead.Id || lead.id));
        if (existing) {
          // Assume it was updated (could be improved with a before/after query)
          updated++;
        } else {
          inserted++;
        }
      }
      
      // Simple approach: count all as inserted, Supabase handles updates automatically
      inserted += transformedBatch.length;
    }
    
    console.log(`[LeadsRepository] Saved ${inserted} leads (upserted - includes updates)`);
    return { inserted, updated: 0 }; // Supabase upsert doesn't differentiate
  } catch (error) {
    console.error('[LeadsRepository] Error saving leads:', error);
    throw error;
  }
}

/**
 * Get leads filtered by campaign and/or ad
 */
// Normalize single value or comma-separated string or array into array of strings
function normalizeIds(ids) {
  if (!ids) return [];
  if (Array.isArray(ids)) return ids.filter(Boolean).map(id => String(id));
  if (typeof ids === 'string') {
    return ids
      .split(',')
      .map(id => id.trim())
      .filter(Boolean)
      .map(id => String(id));
  }
  return [String(ids)];
}

/** PostgREST may return `id` vs `Id` depending on schema — normalize before merge/scoring. */
function normalizeRawLeadRow(row) {
  if (!row || typeof row !== 'object') return row;
  return {
    ...row,
    Id: row.Id ?? row.id,
    Name: row.Name ?? row.name,
    Phone: row.Phone ?? row.phone,
    TimeUtc: row.TimeUtc ?? row.time_utc ?? row.created_time ?? row.createdTime,
    DateChar: row.DateChar ?? row.date_char ?? row.Date ?? row.date,
    Campaign: row.Campaign ?? row.campaign,
  };
}

function mergeRowKey(row) {
  if (row == null) return '__null';
  if (row.Id != null && row.Id !== '') return `id:${row.Id}`;
  if (row.lead_id != null && row.lead_id !== '') return `lid:${row.lead_id}`;
  const ph = String(row.Phone || '').trim();
  const dc = String(row.DateChar || '').slice(0, 24);
  const t = String(row.TimeUtc || row.created_time || '').slice(0, 40);
  return `fb:${ph}|${dc}|${t}`;
}

function toYMDLocalFromDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** In-memory range check when SQL DateChar/TimeUtc filters miss legacy formats. */
function leadRowInDateRange(row, dateFrom, dateTo) {
  if (!dateFrom || !dateTo) return true;
  const dc = row.DateChar;
  if (dc != null && String(dc).trim() !== '') {
    const s = String(dc).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s >= dateFrom && s <= dateTo;
    const m1 = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
    if (m1) {
      const iso = `${m1[3]}-${m1[2].padStart(2, '0')}-${m1[1].padStart(2, '0')}`;
      return iso >= dateFrom && iso <= dateTo;
    }
  }
  const tu = row.TimeUtc ?? row.created_time;
  if (tu) {
    const d = new Date(tu);
    if (!isNaN(d.getTime())) {
      const ymd = toYMDLocalFromDate(d);
      return ymd >= dateFrom && ymd <= dateTo;
    }
  }
  return false;
}

/**
 * Fetch normalized raw lead rows for one DB shape (merge DateChar + time + created_time paths).
 */
async function fetchLeadsRawForShape(shape, campaignIdList, adIdList, formIdList, pageIdList, dateFrom, dateTo) {
  const tbl = leadsTableName(shape);
  const C = leadsCol(shape);

  const buildFiltered = () => {
    let q = supabase.from(tbl).select('*');
    if (campaignIdList.length > 0) q = q.in('campaign_id', campaignIdList);
    if (adIdList.length > 0) q = q.in('ad_id', adIdList);
    if (formIdList.length > 0) q = q.in('form_id', formIdList);
    if (pageIdList.length > 0) q = q.in('page_id', pageIdList);
    return q;
  };

  let data = [];

  if (dateFrom && dateTo) {
    const dateFromISO = new Date(`${dateFrom}T00:00:00`).toISOString();
    const dateToISO = new Date(`${dateTo}T23:59:59.999`).toISOString();
    const qChar = buildFiltered()
      .gte(C.date, dateFrom)
      .lte(C.date, dateTo)
      .order(C.date, { ascending: false })
      .limit(10000);
    const qUtc = buildFiltered()
      .gte(C.time, dateFromISO)
      .lte(C.time, dateToISO)
      .order(C.time, { ascending: false })
      .limit(10000);
    const qCreated = buildFiltered()
      .gte('created_time', dateFromISO)
      .lte('created_time', dateToISO)
      .order('created_time', { ascending: false })
      .limit(10000);
    const [rChar, rUtc, rCr] = await Promise.all([qChar, qUtc, qCreated]);
    if (rChar.error) {
      const msg = rChar.error.message || String(rChar.error);
      if (/column|does not exist|schema cache/i.test(msg)) {
        throw new Error(`Leads ${shape} date column ${C.date}: ${msg}`);
      }
      console.error('[LeadsRepository] Error fetching leads (date column):', rChar.error);
      throw rChar.error;
    }
    if (rUtc.error) {
      console.error('[LeadsRepository] Error fetching leads (time column):', rUtc.error);
    }
    if (rCr.error) {
      console.warn('[LeadsRepository] created_time range query skipped:', rCr.error.message || rCr.error);
    }
    const merged = new Map();
    for (const row of rChar.data || []) {
      const n = normalizeRawLeadRow(row);
      merged.set(mergeRowKey(n), n);
    }
    for (const row of rUtc.data || []) {
      const n = normalizeRawLeadRow(row);
      const k = mergeRowKey(n);
      if (!merged.has(k)) merged.set(k, n);
    }
    if (!rCr.error && rCr.data?.length) {
      for (const row of rCr.data) {
        const n = normalizeRawLeadRow(row);
        const k = mergeRowKey(n);
        if (!merged.has(k)) merged.set(k, n);
      }
    }
    data = [...merged.values()];
    data.sort((a, b) => {
      const da = a.DateChar || '';
      const db = b.DateChar || '';
      if (da !== db) return db.localeCompare(da);
      const ta = a.TimeUtc || '';
      const tb = b.TimeUtc || '';
      return String(tb).localeCompare(String(ta));
    });

    const noIdFilters =
      campaignIdList.length === 0 &&
      adIdList.length === 0 &&
      formIdList.length === 0 &&
      pageIdList.length === 0;
    if (data.length === 0 && noIdFilters) {
      const rWide = await supabase.from(tbl).select('*').order(C.time, { ascending: false }).limit(15000);
      if (rWide.error) {
        console.error('[LeadsRepository] Fallback wide fetch error:', rWide.error);
      } else {
        const filtered = (rWide.data || [])
          .map(normalizeRawLeadRow)
          .filter((r) => leadRowInDateRange(r, dateFrom, dateTo));
        if (filtered.length) {
          console.warn(
            `[LeadsRepository] [${shape}] SQL date filters returned 0 rows; in-memory filter matched ${filtered.length} lead(s) for ${dateFrom}…${dateTo}.`
          );
          data = filtered;
        }
      }
    }
  } else {
    let qn = supabase.from(tbl).select('*');
    if (campaignIdList.length > 0) qn = qn.in('campaign_id', campaignIdList);
    if (adIdList.length > 0) qn = qn.in('ad_id', adIdList);
    if (formIdList.length > 0) qn = qn.in('form_id', formIdList);
    if (pageIdList.length > 0) qn = qn.in('page_id', pageIdList);
    if (dateFrom) qn = qn.gte(C.date, dateFrom);
    if (dateTo) qn = qn.lte(C.date, dateTo);
    qn = qn.order(C.time, { ascending: false });
    const { data: d2, error } = await qn;
    if (error) {
      console.error('[LeadsRepository] Error fetching leads:', error);
      throw error;
    }
    data = d2 || [];
  }

  return data;
}

function mapLeadRowToApi(row) {
  const r = normalizeRawLeadRow(row);
  const idVal = r.Id;
  return {
    Id: idVal,
    id: idVal,
    Name: r.Name,
    name: r.Name,
    Phone: r.Phone,
    phone: r.Phone,
    Time: r.TimeUtc,
    TimeUtc: r.TimeUtc,
    time_utc: r.TimeUtc,
    Date: r.DateChar,
    DateChar: r.DateChar,
    date_char: r.DateChar,
    Campaign: r.Campaign,
    campaign: r.Campaign,
    ad_id: r.ad_id,
    campaign_id: r.campaign_id,
    lead_id:
      r.lead_id != null && r.lead_id !== ''
        ? String(r.lead_id)
        : idVal != null && idVal !== ''
          ? String(idVal)
          : null,
    form_id: r.form_id,
    page_id: r.page_id,
    created_time: r.created_time,
    ad_name: r.ad_name,
    SugarPoll: r.SugarPoll,
    sugar_poll: r.sugar_poll ?? r.SugarPoll,
    lead_intel: r.lead_intel,
    time: r.TimeUtc,
    date: r.DateChar
  };
}

async function getLeadsByCampaignAndAd(campaignIds, adIds, dateFrom, dateTo, formIds = null, pageIds = null) {
  if (!supabase) {
    throw new Error('Supabase not configured');
  }

  try {
    const campaignIdList = normalizeIds(campaignIds);
    const adIdList = normalizeIds(adIds);
    const formIdList = normalizeIds(formIds);
    const pageIdList = normalizeIds(pageIds);

    let shape = await resolveLeadsDbShape();
    let data = await fetchLeadsRawForShape(shape, campaignIdList, adIdList, formIdList, pageIdList, dateFrom, dateTo);

    if (data.length === 0 && !getForcedLeadsDbShape() && dateFrom && dateTo) {
      const alt = shape === 'mixed' ? 'snake' : 'mixed';
      try {
        const altData = await fetchLeadsRawForShape(alt, campaignIdList, adIdList, formIdList, pageIdList, dateFrom, dateTo);
        if (altData.length > 0) {
          console.warn(
            `[LeadsRepository] Primary shape "${shape}" returned 0 rows; alternate "${alt}" returned ${altData.length}. Caching "${alt}" for this process. Set LEADS_DB_SHAPE=${alt} in server/.env to skip probing.`
          );
          _leadsDbShape = alt;
          data = altData;
        }
      } catch (e) {
        console.warn('[LeadsRepository] Alternate Leads schema fetch skipped:', e.message || e);
      }
    }

    return (data || []).map(mapLeadRowToApi);
  } catch (error) {
    console.error('[LeadsRepository] Error fetching leads:', error);
    throw error;
  }
}

/**
 * Get all leads in a date range
 */
async function getLeadsByDateRange(dateFrom, dateTo) {
  return getLeadsByCampaignAndAd(null, null, dateFrom, dateTo);
}

/**
 * Normalize phone for duplicate detection (same as uniqueLeadsRepository)
 */
function normalizePhone(phone) {
  if (phone == null || phone === '') return '';
  return String(phone).trim().replace(/\s/g, '');
}

/**
 * Get duplicate lead rate by campaign for a date range.
 * Duplicate = same phone appearing more than once in Leads for that campaign+period.
 * Returns: Array<{ campaign_id, campaign_name, total, unique_phones, duplicate_rate }>
 */
async function getDuplicateRateByCampaign(dateFrom, dateTo) {
  if (!supabase) {
    throw new Error('Supabase not configured');
  }

  const shape = await resolveLeadsDbShape();
  const tbl = leadsTableName(shape);
  const C = leadsCol(shape);

  const dateFromISO = dateFrom ? new Date(dateFrom + 'T00:00:00').toISOString() : null;
  const dateToISO = dateTo ? new Date(dateTo + 'T23:59:59').toISOString() : null;

  let query = supabase.from(tbl).select(`campaign_id, ${C.campaign}, ${C.phone}`);

  if (dateFromISO) query = query.gte(C.time, dateFromISO);
  if (dateToISO) query = query.lte(C.time, dateToISO);

  const { data, error } = await query;
  if (error) {
    console.error('[LeadsRepository] Error getDuplicateRateByCampaign:', error);
    throw error;
  }

  const rows = data || [];
  const byCampaign = new Map();

  for (const row of rows) {
    const cid = row.campaign_id || '';
    const name = row[C.campaign] || row.campaign_name || row.Campaign || '';
    const phone = normalizePhone(row[C.phone] ?? row.Phone ?? row.phone);

    if (!byCampaign.has(cid)) {
      byCampaign.set(cid, { campaign_id: cid, campaign_name: name, phones: [], total: 0 });
    }
    const rec = byCampaign.get(cid);
    rec.total++;
    rec.phones.push(phone);
  }

  const result = [];
  for (const [cid, rec] of byCampaign) {
    const uniquePhones = new Set(rec.phones.filter(Boolean));
    const uniqueCount = uniquePhones.size;
    const duplicateRate = rec.total > 0 ? (rec.total - uniqueCount) / rec.total : 0;
    result.push({
      campaign_id: cid,
      campaign_name: rec.campaign_name,
      total: rec.total,
      unique_phones: uniqueCount,
      duplicate_rate: Math.round(duplicateRate * 10000) / 10000,
    });
  }
  return result;
}

/**
 * Upsert a single lead
 */
async function upsertLead(lead) {
  return saveLeads([lead]);
}

module.exports = {
  saveLeads,
  getLeadsByCampaignAndAd,
  getLeadsByDateRange,
  upsertLead,
  getDuplicateRateByCampaign,
};
