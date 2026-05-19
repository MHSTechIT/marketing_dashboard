# Leads + Insights Contextual Join Strategy

## Overview

This document explains the **contextual join strategy** for combining Meta Leads API data with Insights API data. This join is **statistical**, not relational - it does NOT provide per-lead attribution.

---

## Meta Graph API Limitations

### What Meta Leads API Provides ✅
- `created_time`: Lead submission timestamp
- `id`: Lead ID
- `field_data`: Form fields (name, phone, city, street, etc.)

### What Meta Leads API Does NOT Provide ❌
- `ad_id`: Ad that generated the lead
- `ad_name`: Ad name
- `campaign_id`: Campaign that generated the lead
- `campaign_name`: Campaign name
- **Any attribution data linking leads to specific ads/campaigns**

### Why This Limitation Exists
Meta's Lead Ads system is form-based. A single form can be used by multiple ads across multiple campaigns. Meta does not provide per-lead attribution because:
1. Attribution windows vary (1-day, 7-day, 28-day click/view)
2. Attribution can be complex (last-touch, multi-touch, etc.)
3. Privacy regulations limit data granularity

---

## Data Sources

### A. Leads API
```
Endpoint: GET /{FORM_ID}/leads
Fields: created_time, field_data
Returns: Individual lead records (NO attribution)
```

### B. Insights API
```
Endpoint: GET /act_{AD_ACCOUNT_ID}/insights
Level: ad (or campaign)
Fields: campaign_id, campaign_name, ad_id, ad_name, actions, spend
Returns: Aggregated metrics (lead counts, spend, etc.)
```

---

## Join Strategy (Pseudocode)

```
FUNCTION joinLeadsWithInsightsContext(
    form_id,
    date_range {from, to},
    filters {ad_account_id?, campaign_id?, ad_id?}
):
    
    // STEP 1: Fetch Leads (from Meta Leads API)
    leads = fetchLeadsFromMeta(form_id)
    
    // Filter leads by date range
    filteredLeads = filterByDateRange(leads, date_range)
    
    // Process leads - extract field_data
    processedLeads = processLeads(filteredLeads)
    // NOTE: processedLeads does NOT contain ad_id/campaign_id
    
    // STEP 2: Fetch Insights (from Meta Insights API)
    insights = fetchInsightsFromMeta(
        ad_account_id,
        date_range,
        filters {campaign_id?, ad_id?}
    )
    
    // Aggregate insights to extract context
    context = {
        campaign_name: extractCampaignNames(insights, filters),
        ad_name: extractAdNames(insights, filters),
        total_leads_from_insights: sum(insights.leads),
        total_spend: sum(insights.spend),
        filters_applied: filters
    }
    
    // STEP 3: Return leads with context (NOT joined per-lead)
    RETURN {
        leads: processedLeads,           // Array of leads (NO attribution)
        context: context,                 // Aggregated insights context
        meta: {
            leads_count: processedLeads.length,
            date_range: date_range,
            attribution_note: "Context is statistical, not per-lead"
        }
    }
    
END FUNCTION
```

---

## Join Logic Details

### Matching Keys (Contextual, NOT Relational)

The join uses **contextual matching**, not relational keys:

1. **Date Window Overlap**
   - Leads: Filter by `created_time` within date range
   - Insights: Filter by `date` within same date range
   - Match: Both cover the same time period

2. **Campaign Filter Context**
   - If `campaign_id` filter applied: Extract campaign name from insights
   - Show campaign name in UI as **context**, not per-lead attribution

3. **Ad Filter Context**
   - If `ad_id` filter applied: Extract ad name from insights
   - Show ad name in UI as **context**, not per-lead attribution

### What We Do NOT Do ❌

```javascript
// ❌ WRONG: Don't do this
leads.forEach(lead => {
    lead.campaign_id = findCampaignForLead(lead);  // NO! Meta doesn't provide this
    lead.ad_id = findAdForLead(lead);              // NO! Meta doesn't provide this
});

// ❌ WRONG: Don't do this
const joined = leads.map(lead => {
    const insight = insights.find(i => i.lead_id === lead.id);  // NO! No such relationship
    return { ...lead, ...insight };
});

// ✅ CORRECT: Do this
const result = {
    leads: processedLeads,                    // Pure lead data, no attribution
    context: {
        campaign_name: insightsContext.campaign_name,  // From filter context
        total_leads_from_insights: insightsContext.total_leads
    }
};
```

---

## JSON Response Contract

### Request
```
GET /api/meta/leads-with-context?form_id=123&from=2025-01-01&to=2025-01-31&campaign_id=456&ad_account_id=789
```

### Response
```json
{
  "leads": [
    {
      "lead_id": "2645689532460524",
      "form_id": "890176017289133",
      "created_time": "2025-01-15T08:43:47+0000",
      "name": "Sathish Kumar",
      "phone": "+919943994382",
      "email": "sathish@example.com",
      "city": "Pondicherry",
      "street": "123 Main St",
      "raw_field_data": [
        { "name": "city", "values": ["Pondicherry"] },
        { "name": "name", "values": ["Sathish Kumar"] },
        { "name": "phone_number", "values": ["+919943994382"] }
      ]
      // NOTE: NO ad_id, campaign_id, ad_name, campaign_name
    }
  ],
  "context": {
    "campaign_name": "Summer Sale Campaign",
    "ad_name": "Summer Sale Ad",
    "total_leads_from_insights": 125,
    "total_spend": 1250.50,
    "date_range": {
      "from": "2025-01-01",
      "to": "2025-01-31"
    },
    "filters_applied": {
      "ad_account_id": "789",
      "campaign_id": "456",
      "ad_id": null
    }
  },
  "meta": {
    "leads_count": 125,
    "date_range": {
      "from": "2025-01-01",
      "to": "2025-01-31"
    },
    "form_id": "890176017289133",
    "attribution_note": "Meta Graph API does not provide per-lead ad/campaign attribution. Campaign/Ad information shown is based on filter context and aggregated insights, not individual lead attribution."
  }
}
```

---

## Filter Logic

### Date Filter
- **Leads**: Filter by `created_time` within date range
- **Insights**: Filter by `date` within same date range
- Both APIs receive the same date range

### Campaign Filter
- **Applies to**: Insights API only
- **Effect**: Extracts campaign name from filtered insights
- **Leads**: NOT filtered (leads don't have campaign_id)
- **UI Display**: Show campaign name as context label

### Ad Filter
- **Applies to**: Insights API only
- **Effect**: Extracts ad name from filtered insights
- **Leads**: NOT filtered (leads don't have ad_id)
- **UI Display**: Show ad name as context label

### Ad Account Filter
- **Applies to**: Insights API only
- **Effect**: Filters insights by ad account
- **Leads**: Not directly affected (leads are form-based)

---

## Edge Cases

### 1. Insights Leads > Actual Leads Count
```
Scenario: insights.total_leads_from_insights = 125, but leads.length = 100
Reason: Meta delay, attribution windows, form changes
Handling: Allow - this is normal Meta behavior
```

### 2. Leads Exist But Insights Empty
```
Scenario: Leads API returns 50 leads, but Insights API returns 0 rows
Reason: No ads/campaigns active in date range, or permissions issue
Handling: Return leads array with context.campaign_name = null
```

### 3. Filters Result in Zero Insights
```
Scenario: Campaign filter applied, but no insights match
Handling: Return empty leads array (contextually filtered out)
```

### 4. Missing Field Data
```
Scenario: Lead has empty field_data or missing name/phone
Handling: Use 'N/A' or null for missing fields, don't crash
```

---

## Frontend Implementation

### Displaying Campaign Context

```javascript
// ✅ CORRECT: Use context from API response
const { leads, context } = response;

leads.forEach(lead => {
    displayLead({
        name: lead.name,
        phone: lead.phone,
        // Campaign shown from context, NOT from lead data
        campaign: context.campaign_name || "Multiple / Not Attributed"
    });
});

// ❌ WRONG: Don't try to get campaign from lead
leads.forEach(lead => {
    displayLead({
        campaign: lead.campaign_id,  // NO! This doesn't exist
        campaign: lead.campaign_name // NO! This doesn't exist
    });
});
```

### Handling Filter Changes

```javascript
// When campaign filter changes:
// 1. Fetch new insights context with campaign filter
// 2. Display campaign name from context
// 3. Leads remain unchanged (no per-lead filtering)

const handleCampaignFilter = async (campaignId) => {
    const response = await fetchLeadsWithContext({
        form_id: selectedForm,
        from: dateRange.from,
        to: dateRange.to,
        campaign_id: campaignId  // Filter insights, not leads
    });
    
    // Update UI with context.campaign_name
    setCampaignContext(response.context.campaign_name);
    
    // Leads array remains the same (no per-lead filtering)
    setLeads(response.leads);
};
```

---

## Backend Implementation (Node.js/Express)

### Complete Endpoint Code

```javascript
router.get("/leads-with-context", optionalAuthMiddleware, async (req, res) => {
  try {
    const { form_id, from, to, ad_account_id, campaign_id, ad_id, limit = 500 } = req.query;

    // Validate required params
    if (!form_id || !from || !to) {
      return res.status(400).json({ error: "form_id, from, to are required" });
    }

    // STEP 1: Fetch leads (NO attribution)
    const accessToken = getSystemToken();
    const leadsResponse = await axios.get(
      `https://graph.facebook.com/v21.0/${form_id}/leads`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    
    const rawLeads = leadsResponse.data.data || [];
    
    // Filter by date
    const startDate = new Date(from);
    startDate.setHours(0, 0, 0, 0);
    const endDate = new Date(to);
    endDate.setHours(23, 59, 59, 999);
    
    const processedLeads = rawLeads
      .filter(lead => {
        const leadDate = new Date(lead.created_time);
        return leadDate >= startDate && leadDate <= endDate;
      })
      .map(lead => ({
        lead_id: lead.id,
        form_id: form_id,
        created_time: lead.created_time,
        name: extractName(lead.field_data),
        phone: extractPhone(lead.field_data),
        city: extractField(lead.field_data, 'city'),
        street: extractField(lead.field_data, 'street_address'),
        raw_field_data: lead.field_data
        // NO ad_id, campaign_id, ad_name, campaign_name
      }))
      .sort((a, b) => new Date(b.created_time) - new Date(a.created_time))
      .slice(0, parseInt(limit, 10));

    // STEP 2: Fetch insights (for context)
    const credentials = getCredentials();
    let adAccountId = ad_account_id || credentials.adAccountId;
    if (adAccountId && adAccountId.startsWith('act_')) {
      adAccountId = adAccountId.substring(4);
    }

    const insightsParams = {
      access_token: credentials.accessToken,
      level: "ad",
      fields: "campaign_id,campaign_name,ad_id,ad_name,actions,spend",
      time_range: JSON.stringify({ since: from, until: to }),
      limit: 1000
    };

    // Apply filters to insights
    const filtering = [];
    if (campaign_id) filtering.push({ field: "campaign.id", operator: "IN", value: [campaign_id] });
    if (ad_id) filtering.push({ field: "ad.id", operator: "IN", value: [ad_id] });
    if (filtering.length > 0) {
      insightsParams.filtering = JSON.stringify(filtering);
    }

    const insightsResponse = await axios.get(
      `https://graph.facebook.com/v21.0/act_${adAccountId}/insights`,
      { params: insightsParams }
    );

    const insightsRows = insightsResponse.data.data || [];
    
    // Aggregate insights for context
    let totalLeads = 0;
    let totalSpend = 0;
    const campaignNames = new Set();
    const adNames = new Set();

    insightsRows.forEach(row => {
      if (Array.isArray(row.actions)) {
        row.actions.forEach(action => {
          if (action.action_type === 'lead' || action.action_type === 'leads') {
            totalLeads += parseFloat(action.value || 0) || 0;
          }
        });
      }
      totalSpend += parseFloat(row.spend || 0) || 0;
      if (row.campaign_name) campaignNames.add(row.campaign_name);
      if (row.ad_name) adNames.add(row.ad_name);
    });

    // STEP 3: Return leads with context
    res.json({
      leads: processedLeads,
      context: {
        campaign_name: campaignNames.size === 1 ? Array.from(campaignNames)[0] : 
                       campaignNames.size > 1 ? `${campaignNames.size} Campaigns` : null,
        ad_name: adNames.size === 1 ? Array.from(adNames)[0] : 
                 adNames.size > 1 ? `${adNames.size} Ads` : null,
        total_leads_from_insights: totalLeads,
        total_spend: totalSpend,
        date_range: { from, to },
        filters_applied: { ad_account_id, campaign_id, ad_id }
      },
      meta: {
        leads_count: processedLeads.length,
        date_range: { from, to },
        form_id: form_id,
        attribution_note: "Meta Graph API does not provide per-lead ad/campaign attribution."
      }
    });
  } catch (err) {
    console.error("[Leads-With-Context] Error:", err);
    res.status(500).json({ error: "Failed to fetch leads with context" });
  }
});
```

---

## Why This Join is Statistical, Not Per-Lead

### The Fundamental Problem

**Meta's Lead Ads System:**
- Form-based: One form can be used by multiple ads
- Attribution windows: 1-day, 7-day, 28-day click/view
- Privacy: Per-lead attribution is not exposed via API

**What We CAN Do:**
- Get all leads from a form (within date range)
- Get aggregated metrics from insights (campaign/ad level)
- Show campaign/ad names as **context** based on filters

**What We CANNOT Do:**
- Link individual leads to specific ads/campaigns
- Attribute each lead to a particular ad
- Join leads to insights at the row level

### Statistical Join Example

```
Date Range: 2025-01-01 to 2025-01-31
Campaign Filter: "Summer Sale Campaign"

Leads API Returns:
- 125 leads from form_123 in date range

Insights API Returns:
- Campaign "Summer Sale Campaign": 125 leads, ₹12,500 spend

Contextual Join Result:
- leads: [125 lead objects] (NO campaign_id per lead)
- context.campaign_name: "Summer Sale Campaign" (from filter)
- context.total_leads_from_insights: 125 (matches!)

UI Display:
- Show "Summer Sale Campaign" as context label
- Display all 125 leads
- Note: Each lead is NOT individually attributed to campaign
```

---

## Testing Checklist

- [ ] Leads API returns only lead data (no attribution)
- [ ] Insights API returns aggregated metrics
- [ ] Date filter applied to both APIs
- [ ] Campaign filter extracts campaign name from insights
- [ ] Ad filter extracts ad name from insights
- [ ] Response does NOT contain ad_id/campaign_id in leads array
- [ ] Context is provided separately for UI display
- [ ] Handles empty leads gracefully
- [ ] Handles empty insights gracefully
- [ ] Handles missing field_data gracefully
- [ ] Attribution note included in response

---

## References

- [Meta Graph API - Leads](https://developers.facebook.com/docs/marketing-api/reference/lead)
- [Meta Graph API - Insights](https://developers.facebook.com/docs/marketing-api/insights)
- [Meta Lead Ads Documentation](https://www.facebook.com/business/help/167890705207376)

---

**Last Updated**: 2025-01-XX  
**Version**: 1.0.0  
**Author**: Senior Backend Engineer

