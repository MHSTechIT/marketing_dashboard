# Zoho-Style Meta Leads Handling Refactor Plan

## Executive Summary

This document outlines the refactoring of Meta Lead Ads handling to follow **Zoho CRM's enterprise-safe approach**. The core principle: **Never fake attribution**. Meta Graph API does not provide per-lead campaign/ad attribution - we must respect this limitation and design the system accordingly.

---

## Core Principles (Modeled After Zoho CRM)

### 1. **Source of Truth: Meta Leads API Only**
- Fetch leads exclusively from `GET /{FORM_ID}/leads?fields=created_time,field_data`
- Store leads as **raw form submissions**
- **DO NOT** attach `ad_id`, `adset_id`, or `campaign_id` to individual leads

### 2. **Data Separation**
- **Leads Data**: Individual form submissions (no attribution)
- **Performance Data**: Aggregated metrics from Insights API (campaign/ad level)
- **Never join** these at the lead level

### 3. **Filter Behavior**
- Campaign/Ad filters **DO NOT filter individual leads**
- Filters only:
  - Change performance metrics (cards, charts)
  - Set CONTEXT for the leads list display

### 4. **UI Transparency**
- Always show attribution limitations clearly
- Tooltips explain why campaign/ad columns show "Multiple / Not Attributed"
- Export files include attribution method notes

### 5. **Export Behavior**
- **Raw Leads Export**: Exact form submissions, no campaign/ad columns
- **Leads with Context Export**: Include selected campaign/ad as CONTEXT ONLY with attribution disclaimer

---

## Implementation Plan

### Phase 1: Backend Data Model

#### 1.1 Leads Table Schema

**File**: `server/schema.sql` or database migration

```sql
-- Zoho-style leads table - stores ONLY what Meta provides
CREATE TABLE meta_leads (
    lead_id VARCHAR(100) PRIMARY KEY,
    form_id VARCHAR(100) NOT NULL,
    created_time DATETIME2 NOT NULL,
    name NVARCHAR(255),
    phone NVARCHAR(50),
    email NVARCHAR(255),
    city NVARCHAR(100),
    street NVARCHAR(500),
    custom_fields NVARCHAR(MAX), -- JSON string of all field_data
    source VARCHAR(50) DEFAULT 'Meta Lead Ads',
    created_at DATETIME2 DEFAULT GETDATE(),
    
    -- Indexes for performance
    INDEX idx_form_id (form_id),
    INDEX idx_created_time (created_time),
    INDEX idx_form_created (form_id, created_time)
);

-- DO NOT CREATE: campaign_id, ad_id, adset_id columns
-- These do NOT exist in Meta Leads API response
```

#### 1.2 Insights Aggregated Metrics Table

**File**: `server/schema.sql` or database migration

```sql
-- Separate table for campaign/ad performance (Insights API data)
CREATE TABLE meta_insights_aggregated (
    id BIGINT IDENTITY(1,1) PRIMARY KEY,
    date DATE NOT NULL,
    ad_account_id VARCHAR(100) NOT NULL,
    campaign_id VARCHAR(100),
    campaign_name NVARCHAR(255),
    ad_id VARCHAR(100),
    ad_name NVARCHAR(255),
    leads INT DEFAULT 0, -- Aggregated count, not individual leads
    spend DECIMAL(10,2) DEFAULT 0,
    impressions INT DEFAULT 0,
    clicks INT DEFAULT 0,
    created_at DATETIME2 DEFAULT GETDATE(),
    
    UNIQUE(date, ad_account_id, campaign_id, ad_id),
    INDEX idx_date (date),
    INDEX idx_ad_account (ad_account_id),
    INDEX idx_campaign (campaign_id)
);
```

#### 1.3 Optional: UTM Parameters Table (If UTMs Available)

```sql
-- Only if UTM parameters exist in landing URLs
CREATE TABLE meta_leads_utm (
    lead_id VARCHAR(100) PRIMARY KEY REFERENCES meta_leads(lead_id),
    utm_source NVARCHAR(255),
    utm_medium NVARCHAR(255),
    utm_campaign NVARCHAR(255),
    utm_content NVARCHAR(255),
    utm_term NVARCHAR(255),
    landing_url NVARCHAR(1000),
    created_at DATETIME2 DEFAULT GETDATE()
);
```

---

### Phase 2: Backend API Refactoring

#### 2.1 Update `/api/meta/leads-with-context` Endpoint

**File**: `server/meta/meta.jsx` (Lines ~1145-1505)

**Changes Required**:

1. **Add comprehensive comments explaining Zoho-style approach**
2. **Ensure leads array NEVER contains campaign_id/ad_id**
3. **Improve context extraction for UI display**
4. **Add clear attribution notes in response**

**Key Code Changes**:

```javascript
// ============================================================================
// ZOHO-STYLE LEAD INGESTION: Meta Leads API Only
// ============================================================================
// PRINCIPLE: Fetch leads ONLY from Meta Leads API
// DO NOT attempt to attach ad_id/campaign_id per lead
// Meta Graph API does NOT provide per-lead attribution
//
// Reference: Zoho CRM handles Meta Lead Ads the same way:
// - Fetch raw form submissions
// - Store without attribution
// - Use Insights API separately for aggregated metrics
// ============================================================================

router.get("/leads-with-context", optionalAuthMiddleware, async (req, res) => {
  try {
    const {
      form_id,           // Required: form to fetch leads from
      from,              // Optional: start date (YYYY-MM-DD)
      to,                // Optional: end date (YYYY-MM-DD)
      ad_account_id,     // Optional: filter insights by ad account
      campaign_id,       // Optional: filter insights by campaign (context only)
      ad_id,             // Optional: filter insights by ad (context only)
      limit              // Optional: max leads to return
    } = req.query;

    // ... existing validation ...

    // ========================================================================
    // STEP 1: FETCH LEADS (ZOHO-STYLE: Raw Form Submissions Only)
    // ========================================================================
    // This returns ONLY what Meta provides:
    // - created_time
    // - id (lead_id)
    // - field_data (form fields)
    //
    // DOES NOT return:
    // - ad_id
    // - campaign_id
    // - ad_name
    // - campaign_name
    // ========================================================================
    
    const accessToken = getSystemToken();
    const formLeadsUrl = `https://graph.facebook.com/${META_API_VERSION}/${form_id}/leads`;
    
    // ... existing pagination code ...
    
    // Process leads - extract ONLY form field data
    const processedLeads = rawLeads
      .filter(lead => {
        // Date filtering only
        if (!lead.created_time) return false;
        const leadDate = new Date(lead.created_time);
        return leadDate >= startDate && leadDate <= endDate;
      })
      .map(lead => {
        // Extract field_data
        const fieldData = {};
        if (Array.isArray(lead.field_data)) {
          lead.field_data.forEach(field => {
            const fieldName = field.name || '';
            const fieldValue = field.values ? (Array.isArray(field.values) ? field.values[0] : field.values) : '';
            fieldData[fieldName.toLowerCase()] = fieldValue;
            fieldData[fieldName] = fieldValue;
          });
        }

        // Extract standard fields
        const leadName = extractName(fieldData);
        const phone = extractPhone(fieldData);
        
        // CRITICAL: Return ONLY what Meta provides
        return {
          lead_id: lead.id,
          form_id: form_id,
          created_time: lead.created_time,
          name: leadName,
          phone: phone,
          email: fieldData.email || null,
          city: fieldData.city || 'N/A',
          street: fieldData.street_address || fieldData.address || fieldData.street || 'N/A',
          custom_fields: lead.field_data || [], // Store all fields as JSON
          source: 'Meta Lead Ads',
          // Legacy fields for backward compatibility
          Date: lead.created_time ? lead.created_time.split('T')[0] : '',
          Time: lead.created_time || '',
          TimeUtc: lead.created_time || '',
          DateChar: lead.created_time ? lead.created_time.split('T')[0] : '',
          Name: leadName,
          Phone: phone,
          // ZOHO PRINCIPLE: DO NOT add campaign_id, ad_id, campaign_name, ad_name
          // These fields do NOT exist in Meta Leads API response
          // Attribution must be handled separately via Insights API
        };
      })
      .sort((a, b) => new Date(b.created_time) - new Date(a.created_time));

    // Apply limit only if explicitly requested
    const leadsData = (limit && parseInt(limit, 10) > 0) 
      ? processedLeads.slice(0, Math.min(parseInt(limit, 10), 50000))
      : processedLeads;

    // ========================================================================
    // STEP 2: FETCH INSIGHTS (For Context Only, Not Per-Lead Attribution)
    // ========================================================================
    // Insights API provides aggregated metrics at campaign/ad level
    // Used for:
    // - Performance cards/charts
    // - Contextual display in leads table
    // NOT for: Per-lead attribution
    // ========================================================================
    
    let insightsContext = {
      campaign_name: null,
      ad_name: null,
      total_leads_from_insights: 0,
      total_spend: 0,
      date_range: { from: dateFrom, to: dateTo },
      filters_applied: {
        ad_account_id: ad_account_id || null,
        campaign_id: campaign_id || null,
        ad_id: ad_id || null
      },
      attribution_note: "Meta does not provide per-lead campaign attribution via API. Campaign/Ad shown is contextual based on selected filters and aggregated insights data."
    };

    // ... existing insights fetching code ...

    // ========================================================================
    // STEP 3: RETURN LEADS WITH CONTEXT (ZOHO-STYLE)
    // ========================================================================
    // IMPORTANT: Leads array does NOT contain ad_id/campaign_id
    // Context is provided separately for UI display only
    // ========================================================================
    
    res.json({
      leads: leadsData,
      context: insightsContext,
      meta: {
        leads_count: leadsData.length,
        date_range: { from: dateFrom, to: dateTo },
        form_id: form_id,
        attribution_note: "Meta Graph API does not provide per-lead ad/campaign attribution. For accurate per-lead attribution, use Meta Ads Manager UI to download leads per campaign. Campaign/Ad information shown here is contextual based on filter selections and aggregated insights, not individual lead attribution.",
        attribution_method: "Meta Ads Manager uses internal attribution (7-day click, 1-day view). This API endpoint cannot replicate that attribution."
      }
    });
  } catch (err) {
    // ... existing error handling ...
  }
});
```

#### 2.2 Create Export Endpoints

**New Endpoints**:

1. **GET `/api/meta/leads/export/raw`** - Raw leads export (no campaign/ad columns)
2. **GET `/api/meta/leads/export/with-context`** - Leads with context (campaign/ad as context only)

**File**: `server/meta/meta.jsx` (Add after leads-with-context endpoint)

```javascript
// ============================================================================
// EXPORT ENDPOINTS (ZOHO-STYLE)
// ============================================================================

// Raw Leads Export - Exact form submissions, no attribution
router.get("/leads/export/raw", optionalAuthMiddleware, async (req, res) => {
  try {
    const { form_id, from, to } = req.query;
    
    // Fetch leads using same logic as leads-with-context
    // But return CSV format with ONLY lead data
    
    const response = await fetchLeadsFromMeta(form_id, from, to);
    const csv = generateCSV(response.leads, {
      columns: ['lead_id', 'form_id', 'created_time', 'name', 'phone', 'email', 'city', 'street'],
      includeAttribution: false
    });
    
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="meta_leads_raw_${form_id}_${from}_${to}.csv"`);
    res.send(csv);
  } catch (err) {
    // ... error handling ...
  }
});

// Leads with Campaign Context Export - Includes context with disclaimer
router.get("/leads/export/with-context", optionalAuthMiddleware, async (req, res) => {
  try {
    const { form_id, from, to, campaign_id, ad_id, ad_account_id } = req.query;
    
    // Fetch leads with context
    const response = await fetchLeadsWithContext({
      form_id, from, to, campaign_id, ad_id, ad_account_id
    });
    
    // Add context columns with disclaimer
    const csv = generateCSV(response.leads, {
      columns: ['lead_id', 'form_id', 'created_time', 'name', 'phone', 'email', 'city', 'street', 
                'campaign_name', 'ad_name', 'attribution_method'],
      includeAttribution: true,
      context: response.context,
      attributionMethod: "Meta Ads Manager (7-day click, 1-day view) - Context only, not per-lead attribution"
    });
    
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="meta_leads_with_context_${form_id}_${from}_${to}.csv"`);
    res.send(csv);
  } catch (err) {
    // ... error handling ...
  }
});
```

---

### Phase 3: Frontend UI Refactoring

#### 3.1 Update Leads Table Display

**File**: `client/src/pages/Dashboards.jsx`

**Changes Required**:

1. **Add tooltip to Campaign/Ad columns**
2. **Ensure filters don't filter leads array**
3. **Display attribution disclaimer**

**Key Code Changes**:

```jsx
// ============================================================================
// LEADS TABLE HEADER (ZOHO-STYLE)
// ============================================================================

<th>
  CAMPAIGN
  <i 
    className="fas fa-info-circle ms-1" 
    style={{ cursor: 'help', color: '#6b7280' }}
    title="Meta does not provide per-lead campaign attribution via API. This column shows the selected campaign filter as context only. For accurate per-lead attribution, download leads from Meta Ads Manager UI."
    data-bs-toggle="tooltip"
    data-bs-placement="top"
  />
</th>
<th>
  AD NAME
  <i 
    className="fas fa-info-circle ms-1" 
    style={{ cursor: 'help', color: '#6b7280' }}
    title="Meta does not provide per-lead ad attribution via API. This column shows the selected ad filter as context only. For accurate per-lead attribution, download leads from Meta Ads Manager UI."
    data-bs-toggle="tooltip"
    data-bs-placement="top"
  />
</th>

// ============================================================================
// LEADS TABLE BODY (ZOHO-STYLE)
// ============================================================================
// CRITICAL: Filters DO NOT filter the leads array
// All leads from date range are shown
// Campaign/Ad columns show context from filters

{currentLeads.map((lead, index) => (
  <tr key={lead.lead_id || index}>
    <td>{lead.name || 'N/A'}</td>
    <td>{lead.phone || 'N/A'}</td>
    <td>{formatDateTime(lead.created_time || lead.TimeUtc || lead.Time)}</td>
    <td>{lead.street || 'N/A'}</td>
    <td>{lead.city || 'N/A'}</td>
    {/* Campaign column: Show context, NOT lead attribution */}
    <td>
      {getCampaignContext || 'Multiple / Not Attributed'}
    </td>
    {/* Ad column: Show context, NOT lead attribution */}
    <td>
      {getAdContext || 'Multiple / Not Attributed'}
    </td>
  </tr>
))}
```

#### 3.2 Update Filter Behavior Logic

**File**: `client/src/pages/Dashboards.jsx`

**Changes Required**:

```javascript
// ============================================================================
// FILTER BEHAVIOR (ZOHO-STYLE)
// ============================================================================
// PRINCIPLE: Campaign/Ad filters DO NOT filter individual leads
// Filters only:
// 1. Change performance metrics (cards, charts)
// 2. Set CONTEXT for leads table display

const loadLeads = async () => {
  setLeadsLoading(true);
  setLeadsError(null);
  
  try {
    if (!selectedForm) {
      setLeadsError({
        type: 'error',
        message: "Please select a form to fetch leads"
      });
      return;
    }

    const from = dateFilters.startDate || null;
    const to = dateFilters.endDate || null;
    
    // Extract filter IDs for contextual insights ONLY
    // These do NOT filter the leads array
    const adAccountId = selectedAdAccount || null;
    const campaignId = selectedCampaigns.length > 0 ? selectedCampaigns[0] : null;
    const adId = selectedAds.length > 0 ? selectedAds[0] : null;
    
    // Fetch leads with context
    // NOTE: campaignId/adId are for context only, not for filtering leads
    const response = await fetchLeads({
      formId: selectedForm,
      from,
      to,
      adAccountId,
      campaignId, // Used for insights context only
      adId        // Used for insights context only
    });
    
    // All leads from date range are displayed
    setLeads(response.leads);
    setLeadsContext(response.context);
    
    // Performance metrics are updated based on filters
    // But leads array is NOT filtered
  } catch (error) {
    // ... error handling ...
  } finally {
    setLeadsLoading(false);
  }
};
```

#### 3.3 Add Export Buttons

**File**: `client/src/pages/Dashboards.jsx`

**Changes Required**:

```jsx
// ============================================================================
// EXPORT BUTTONS (ZOHO-STYLE)
// ============================================================================

<div className="d-flex gap-2 mb-3">
  <button
    className="btn btn-outline-primary"
    onClick={() => exportRawLeads()}
    disabled={leadsLoading || leadDetails.length === 0}
  >
    <i className="fas fa-download me-2"></i>
    Export Raw Leads
  </button>
  <button
    className="btn btn-outline-secondary"
    onClick={() => exportLeadsWithContext()}
    disabled={leadsLoading || leadDetails.length === 0}
  >
    <i className="fas fa-file-csv me-2"></i>
    Export with Campaign Context
  </button>
</div>

// Export functions
const exportRawLeads = async () => {
  try {
    const params = new URLSearchParams({
      form_id: selectedForm,
      from: dateFilters.startDate || '',
      to: dateFilters.endDate || ''
    });
    
    const response = await fetch(`${API_BASE}/api/meta/leads/export/raw?${params}`, {
      headers: {
        'Authorization': `Bearer ${getAuthToken()}`
      }
    });
    
    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `meta_leads_raw_${selectedForm}_${dateFilters.startDate}_${dateFilters.endDate}.csv`;
    a.click();
  } catch (error) {
    console.error('Export error:', error);
    alert('Failed to export leads');
  }
};

const exportLeadsWithContext = async () => {
  try {
    const params = new URLSearchParams({
      form_id: selectedForm,
      from: dateFilters.startDate || '',
      to: dateFilters.endDate || '',
      campaign_id: selectedCampaigns[0] || '',
      ad_id: selectedAds[0] || '',
      ad_account_id: selectedAdAccount || ''
    });
    
    const response = await fetch(`${API_BASE}/api/meta/leads/export/with-context?${params}`, {
      headers: {
        'Authorization': `Bearer ${getAuthToken()}`
      }
    });
    
    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `meta_leads_with_context_${selectedForm}_${dateFilters.startDate}_${dateFilters.endDate}.csv`;
    a.click();
  } catch (error) {
    console.error('Export error:', error);
    alert('Failed to export leads');
  }
};
```

---

### Phase 4: Documentation & Comments

#### 4.1 Add Comprehensive Comments

**Files**: All modified files

**Key Comment Areas**:

1. **Backend endpoint headers**: Explain Zoho-style approach
2. **Lead processing logic**: Explain why attribution is not added
3. **Filter handling**: Explain why filters don't filter leads
4. **Context extraction**: Explain why context is separate from leads
5. **Export functions**: Explain attribution disclaimers

#### 4.2 Create User-Facing Documentation

**File**: `docs/USER_GUIDE_META_LEADS.md`

Content:
- Explanation of Meta API limitations
- How Zoho-style approach works
- How to interpret "Multiple / Not Attributed"
- When to use Meta Ads Manager UI for accurate attribution
- Export file format explanations

---

### Phase 5: Optional UTM Enhancement

#### 5.1 Extract UTM Parameters (If Available)

**File**: `server/meta/meta.jsx`

**If landing URLs contain UTM parameters**:

```javascript
// Optional: Extract UTM parameters from landing URLs (if available)
function extractUTMParameters(landingUrl) {
  if (!landingUrl) return null;
  
  try {
    const url = new URL(landingUrl);
    const utmParams = {
      utm_source: url.searchParams.get('utm_source'),
      utm_medium: url.searchParams.get('utm_medium'),
      utm_campaign: url.searchParams.get('utm_campaign'),
      utm_content: url.searchParams.get('utm_content'),
      utm_term: url.searchParams.get('utm_term'),
      landing_url: landingUrl
    };
    
    // Only return if at least one UTM parameter exists
    if (Object.values(utmParams).some(v => v !== null)) {
      return utmParams;
    }
    return null;
  } catch (err) {
    return null;
  }
}

// Use UTMs for attribution ONLY if they exist
// Never mix UTMs with Meta attribution logic
if (utmParams) {
  lead.utm_campaign = utmParams.utm_campaign;
  lead.utm_source = utmParams.utm_source;
  // Store in separate table if using database
}
```

---

## Implementation Checklist

### Backend Changes
- [ ] Update leads table schema (remove campaign_id/ad_id if exists)
- [ ] Add comprehensive comments to `/leads-with-context` endpoint
- [ ] Ensure leads array NEVER contains campaign_id/ad_id
- [ ] Create `/leads/export/raw` endpoint
- [ ] Create `/leads/export/with-context` endpoint
- [ ] Add attribution notes to all API responses
- [ ] (Optional) Add UTM parameter extraction if available

### Frontend Changes
- [ ] Add tooltips to Campaign/Ad columns
- [ ] Ensure filters don't filter leads array
- [ ] Update filter behavior comments
- [ ] Add export buttons (Raw and With Context)
- [ ] Implement export functions
- [ ] Add attribution disclaimer in UI
- [ ] Update help text/documentation links

### Documentation
- [ ] Add comprehensive inline comments
- [ ] Create user guide explaining limitations
- [ ] Update API documentation
- [ ] Add code review notes explaining Zoho-style approach

### Testing
- [ ] Verify leads array has no campaign_id/ad_id
- [ ] Verify filters don't filter leads
- [ ] Verify context displays correctly
- [ ] Test raw export
- [ ] Test context export
- [ ] Verify tooltips display
- [ ] Test with multiple campaigns selected
- [ ] Test with no filters selected

---

## Key Differences from Current Implementation

### Current (Before)
- ❌ May attempt to attach campaign/ad to leads
- ❌ Filters might filter leads array
- ❌ Attribution not clearly explained
- ❌ Single export format

### Zoho-Style (After)
- ✅ Leads are pure form submissions
- ✅ Filters only change context, not lead data
- ✅ Clear attribution disclaimers
- ✅ Two export formats (raw and with context)
- ✅ Tooltips explain limitations
- ✅ Comments explain approach

---

## Why This Approach is Correct

### Meta API Reality
- Meta Leads API does NOT provide per-lead attribution
- Meta Ads Manager UI uses internal attribution not available via API
- Attempting to recreate attribution is inaccurate

### Enterprise Safety
- Never fake or guess attribution
- Clear communication of limitations
- Audit-safe (no fabricated data)
- Matches industry-standard CRM behavior (Zoho)

### User Transparency
- Users understand what they're seeing
- Users know when to use Meta UI for accurate attribution
- Export files include disclaimers

---

## References

- [Meta Graph API - Leads](https://developers.facebook.com/docs/marketing-api/reference/lead)
- [Meta Graph API - Insights](https://developers.facebook.com/docs/marketing-api/insights)
- [Zoho CRM Lead Ads Integration](https://help.zoho.com/portal/en/kb/crm/articles/lead-ads-integration)
- [Meta Lead Ads Documentation](https://www.facebook.com/business/help/167890705207376)

---

**Last Updated**: 2025-01-XX  
**Version**: 1.0.0  
**Status**: Planning Phase

