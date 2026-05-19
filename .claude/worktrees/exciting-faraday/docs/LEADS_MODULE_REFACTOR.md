# Leads Module Refactor - Meta Graph API Integration

## Overview

This document explains the refactored Leads module architecture that correctly handles Meta Graph API limitations.

**Key Principle**: Meta Graph API Leads endpoint does NOT provide per-lead ad/campaign attribution. We separate leads data from insights data.

---

## Data Flow Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        FRONTEND DASHBOARD                        │
│                                                                   │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐            │
│  │ Date Range  │  │ Ad Account  │  │  Campaign   │            │
│  │   Filter    │  │   Filter    │  │   Filter    │            │
│  └─────────────┘  └─────────────┘  └─────────────┘            │
│         │                │                │                      │
│         └────────────────┴────────────────┘                      │
│                            │                                      │
│         ┌──────────────────┴──────────────────┐                 │
│         │                                      │                 │
│    ┌────▼────┐                          ┌─────▼─────┐          │
│    │ LEADS   │                          │ INSIGHTS  │          │
│    │  API    │                          │   API     │          │
│    └────┬────┘                          └─────┬─────┘          │
└─────────┼──────────────────────────────────────┼───────────────┘
          │                                      │
          │                                      │
┌─────────▼──────────────────────────────────────▼───────────────┐
│                      BACKEND API LAYER                          │
│                                                                  │
│  GET /api/meta/leads           GET /api/meta/insights           │
│  • form_id (required)          • ad_account_id                  │
│  • from, to (date filter)      • campaign_id (optional)         │
│  Returns:                      • ad_id (optional)               │
│  • lead_id                     • from, to (date filter)         │
│  • created_time                Returns:                         │
│  • name, phone, city, street   • campaign_id, campaign_name     │
│  • field_data (raw)            • ad_id, ad_name                 │
│  ❌ NO ad_id/campaign_id       • leads (count)                  │
│                                • spend, impressions, clicks     │
└─────────┬──────────────────────────────────────┬───────────────┘
          │                                      │
          │                                      │
┌─────────▼──────────────────────────────────────▼───────────────┐
│                    META GRAPH API                               │
│                                                                  │
│  GET /{form_id}/leads           GET /act_{id}/insights          │
│  Fields: created_time,          Level: ad or campaign           │
│          field_data             Fields: campaign_id,            │
│  ❌ Does NOT return:              campaign_name, ad_id,         │
│     ad_id, campaign_id            ad_name, leads, spend         │
└─────────────────────────────────────────────────────────────────┘
```

---

## Data Models

### Leads Table Schema (SQL Server)

```sql
CREATE TABLE leads (
    lead_id VARCHAR(100) PRIMARY KEY,
    form_id VARCHAR(100) NOT NULL,
    created_time DATETIME2 NOT NULL,
    name NVARCHAR(255),
    phone NVARCHAR(50),
    email NVARCHAR(255),
    city NVARCHAR(100),
    street NVARCHAR(500),
    raw_field_data NVARCHAR(MAX), -- JSON string of all field_data
    created_at DATETIME2 DEFAULT GETDATE(),
    
    INDEX idx_form_id (form_id),
    INDEX idx_created_time (created_time),
    INDEX idx_form_created (form_id, created_time)
);

-- Sample query to get leads for a form with date filter
SELECT 
    lead_id,
    form_id,
    created_time,
    name,
    phone,
    city,
    street,
    raw_field_data
FROM leads
WHERE form_id = @form_id
  AND created_time >= @from_date
  AND created_time <= @to_date
ORDER BY created_time DESC;
```

### Insights Ads Table Schema (SQL Server)

```sql
CREATE TABLE insights_ads (
    id BIGINT IDENTITY(1,1) PRIMARY KEY,
    date DATE NOT NULL,
    ad_account_id VARCHAR(100) NOT NULL,
    campaign_id VARCHAR(100) NOT NULL,
    campaign_name NVARCHAR(255),
    ad_id VARCHAR(100) NOT NULL,
    ad_name NVARCHAR(255),
    leads INT DEFAULT 0,
    spend DECIMAL(10,2) DEFAULT 0,
    impressions INT DEFAULT 0,
    clicks INT DEFAULT 0,
    created_at DATETIME2 DEFAULT GETDATE(),
    
    UNIQUE(date, ad_account_id, campaign_id, ad_id),
    INDEX idx_date (date),
    INDEX idx_ad_account (ad_account_id),
    INDEX idx_campaign (campaign_id),
    INDEX idx_ad (ad_id),
    INDEX idx_date_campaign (date, campaign_id)
);

-- Sample query to get campaign metrics
SELECT 
    campaign_id,
    campaign_name,
    SUM(leads) as total_leads,
    SUM(spend) as total_spend,
    SUM(impressions) as total_impressions,
    SUM(clicks) as total_clicks
FROM insights_ads
WHERE ad_account_id = @ad_account_id
  AND date >= @from_date
  AND date <= @to_date
  AND campaign_id IN (@campaign_ids) -- if filtered
GROUP BY campaign_id, campaign_name
ORDER BY total_leads DESC;
```

---

## API Endpoints

### GET /api/meta/leads

**Purpose**: Fetch individual lead records from Meta Lead Ads.

**Query Parameters**:
- `form_id` (required): Meta form ID
- `from` (optional): Start date (YYYY-MM-DD)
- `to` (optional): End date (YYYY-MM-DD)
- `days` (optional): Number of days to look back (default: 30)
- `limit` (optional): Max leads to return (default: 500, max: 1000)

**Response Format**:
```json
{
  "data": [
    {
      "lead_id": "2645689532460524",
      "form_id": "890176017289133",
      "created_time": "2025-12-24T08:43:47+0000",
      "name": "Sathish Kumar",
      "phone": "+919943994382",
      "email": null,
      "city": "Pondicherry",
      "street": "123 Main St",
      "raw_field_data": [
        { "name": "city", "values": ["Pondicherry"] },
        { "name": "name", "values": ["Sathish Kumar"] },
        { "name": "phone_number", "values": ["+919943994382"] }
      ],
      // Legacy format fields (backward compatibility)
      "Id": "2645689532460524",
      "Name": "Sathish Kumar",
      "Phone": "+919943994382",
      "City": "Pondicherry",
      "Street": "123 Main St"
    }
  ],
  "meta": {
    "total_leads": 1,
    "date_range": {
      "from": "2025-12-01",
      "to": "2025-12-24"
    },
    "form_id": "890176017289133",
    "attribution_note": "Meta Graph API Leads endpoint does not provide ad_id, ad_name, campaign_id, or campaign_name per lead. For campaign/ad performance metrics, use /api/meta/insights endpoint."
  }
}
```

**Important**: This endpoint does NOT return `ad_id`, `ad_name`, `campaign_id`, or `campaign_name`. These fields are NOT available in Meta's Leads API.

---

### GET /api/meta/insights

**Purpose**: Fetch ad/campaign performance metrics including lead counts.

**Query Parameters**:
- `ad_account_id` (optional): Filter by ad account (default: from env)
- `campaign_id` (optional): Filter by specific campaign
- `ad_id` (optional): Filter by specific ad
- `from` (required): Start date (YYYY-MM-DD)
- `to` (required): End date (YYYY-MM-DD)
- `days` (optional): Alternative to from/to
- `time_increment` (optional): "1" for daily breakdown

**Response Format**:
```json
[
  {
    "campaign_id": "123456789",
    "campaign": "Summer Sale Campaign",
    "campaign_name": "Summer Sale Campaign",
    "ad_id": "987654321",
    "ad_name": "Summer Sale Ad",
    "date": "2025-12-24",
    "spend": 1250.50,
    "impressions": 50000,
    "clicks": 2500,
    "leads": 125,
    "conversions": 10,
    "ctr": 5.0,
    "cpl": 10.00,
    "actions": {
      "lead": 125,
      "link_click": 2500
    }
  }
]
```

---

## Filter Logic

### Date Filter
- **Leads API**: Filters `leads.created_time` by `from` and `to` dates
- **Insights API**: Filters `insights.date` by `from` and `to` dates
- Both APIs receive the same date range from frontend filters

### Campaign Filter
- **Applies to**: Insights API only (campaign performance metrics)
- **Does NOT apply to**: Leads API (leads don't have campaign attribution)
- **UI Behavior**: Leads table shows campaign context from selected filter, not from lead data

### Ad Filter
- **Applies to**: Insights API only (ad performance metrics)
- **Does NOT apply to**: Leads API (leads don't have ad attribution)

### Ad Account Filter
- **Applies to**: Both APIs
- **Leads API**: Not directly filtered (leads are form-based, not account-based)
- **Insights API**: Filters by `ad_account_id`

---

## Frontend Implementation

### Leads Table Display

**Campaign Column Logic**:
```javascript
// Campaign context is derived from FILTERS, not from lead data
const getCampaignContext = useMemo(() => {
  // If "All Campaigns" selected or none selected
  if (selectedCampaigns.length === 0 || 
      (campaigns.length > 0 && selectedCampaigns.length === campaigns.length)) {
    return "Multiple / Not Attributed";
  }
  // If single campaign selected
  if (selectedCampaigns.length === 1) {
    const campaign = campaigns.find(c => c.id === selectedCampaigns[0]);
    return campaign ? campaign.name : "Multiple / Not Attributed";
  }
  // Multiple campaigns selected
  return `${selectedCampaigns.length} Campaigns Selected`;
}, [selectedCampaigns, campaigns]);
```

**Tooltip**:
```jsx
<th>
  Campaign
  <i 
    className="fas fa-info-circle ms-1" 
    title="Meta does not provide per-lead campaign attribution. This shows the selected campaign filter context."
  />
</th>
```

---

## Meta API Limitations (CRITICAL)

### What Meta Leads API Returns ✅
- `created_time`: Lead submission timestamp
- `id`: Lead ID
- `field_data`: Array of form fields (name, phone, city, street, etc.)

### What Meta Leads API Does NOT Return ❌
- `ad_id`: Ad that generated the lead
- `ad_name`: Ad name
- `campaign_id`: Campaign that generated the lead
- `campaign_name`: Campaign name
- Any attribution linking leads to specific ads/campaigns

### Why This Limitation Exists
Meta's Lead Ads system is designed around **forms**, not individual ads. A single form can be used by multiple ads across multiple campaigns. Meta does not provide per-lead attribution because:
1. Attribution windows vary (1-day, 7-day, 28-day click/view)
2. Attribution can be complex (last-touch, multi-touch, etc.)
3. Privacy regulations limit data granularity

### How to Get Campaign/Ad Performance
Use the **Insights API** which provides aggregated metrics:
- Total leads per campaign/ad (count, not individual records)
- Spend, impressions, clicks per campaign/ad
- Date-level breakdowns

**DO NOT** attempt to:
- ❌ Backfill `ad_id` for leads
- ❌ Scrape Meta UI for attribution
- ❌ Fabricate attribution logic
- ❌ Call Meta API from frontend directly

---

## Error Handling

### Permission Errors (403)
```json
{
  "error": "Permission Error",
  "details": "Invalid permission",
  "isPermissionError": true,
  "errorCode": 200,
  "instruction": "Your Meta Access Token needs 'leads_retrieval' permission. Please update your token in Meta Settings."
}
```

### Authentication Errors (401)
```json
{
  "error": "Meta Access Token expired or invalid",
  "details": "Error message from Meta",
  "isAuthError": true,
  "instruction": "Please update META_SYSTEM_ACCESS_TOKEN in server/.env"
}
```

### Missing Field Data
- Gracefully handle missing `field_data` fields
- Use `'N/A'` or `null` for missing values
- Log warnings but don't crash

---

## Best Practices

1. **Always separate leads from insights**: Never try to join them at the lead level
2. **Use filter context for UI**: Show campaign context from filters, not from lead data
3. **Clear communication**: Always inform users about Meta API limitations
4. **Date filtering**: Apply consistently to both APIs using the same date range
5. **Error handling**: Gracefully handle empty leads, missing fields, token expiry
6. **Future-proof**: Design for Meta API changes, don't assume future features

---

## Migration Notes

### Backward Compatibility
The refactored API maintains backward compatibility by including legacy field names:
- `Id` (from `lead_id`)
- `Name` (from `name`)
- `Phone` (from `phone`)
- `City` (from `city`)
- `Street` (from `street`)

### Breaking Changes
- Removed `Campaign` field from lead data (was always `'N/A'`)
- Campaign column now shows filter context instead of lead data
- Lead response structure changed (added `meta` object)

---

## References

- [Meta Graph API - Leads](https://developers.facebook.com/docs/marketing-api/reference/lead)
- [Meta Graph API - Insights](https://developers.facebook.com/docs/marketing-api/insights)
- [Meta Lead Ads Documentation](https://www.facebook.com/business/help/167890705207376)

---

**Last Updated**: 2025-01-XX
**Version**: 2.0.0

