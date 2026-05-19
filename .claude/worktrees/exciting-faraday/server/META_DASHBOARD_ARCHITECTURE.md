# Meta Dashboard Data Flow — Backend Architecture

Production-ready Meta Ads API integration per [Meta Marketing API](https://developers.facebook.com/docs/marketing-api) best practices.

---

## 1. Backend Service Architecture

```
server/
├── meta/
│   ├── meta.jsx              # Routes: ad-accounts, campaigns, active-campaigns, ads, insights
│   ├── insightsService.js    # Live /insights call: one per account, IN filter, rate-limited
│   └── adsCache.js           # Legacy in-memory/Redis; ads now prefer meta_ads DB
├── services/meta/
│   ├── rateLimiter.js        # Shared: max 2 concurrent, 2s between starts
│   ├── adAccountsService.js  # /me/adaccounts → meta_ad_accounts
│   ├── campaignsService.js   # /act_{id}/campaigns → meta_campaigns (24h)
│   ├── adsService.js         # /act_{id}/ads → meta_ads (once per account)
│   └── insightsQueryBuilder.js # filtering IN, Select All = no campaign.id/ad.id
└── repositories/
    ├── metaAdAccountsRepository.js
    ├── metaCampaignsRepository.js
    ├── metaAdsRepository.js
    └── insightsRepository.js   # existing meta_insights
```

---

## 2. Data Flow and Endpoints

| Requirement | Implementation |
|-------------|----------------|
| **Ad accounts** | `GET /me/adaccounts` → cache in `meta_ad_accounts`. UI reads from DB only (`GET /api/meta/ad-accounts`). If DB empty, fetch and cache then return. |
| **Campaigns** | `GET /act_{id}/campaigns` via `campaignsService.list(ad_account_id)`. Cached 24h+ in `meta_campaigns`. `GET /api/meta/campaigns?ad_account_id=` returns from DB; refresh from API if older than 24h. |
| **Ads** | `GET /act_{id}/ads` **once** per account via `adsService.fetchAndCache(ad_account_id)`. Stored in `meta_ads`. `GET /api/meta/ads` reads from DB only; never fetches on filter change. Populate on first `?all=true` when DB empty, or explicitly `POST /api/meta/ads/sync`. |
| **Insights** | **One** `/insights` request per selected ad account per dashboard refresh. Uses `filtering` IN for campaign.id / ad.id; Select All → no campaign/ad filters (status only). DB-first; live fallback when empty or `?live=1`. |

---

## 3. Insights Query Builder and Filter Handling

- **Select All campaigns/ads**: no `campaign.id` or `ad.id` in `filtering`; only status filters.
- **Single or multi select**: `filtering` includes `{ field: 'campaign.id', operator: 'IN', value: [id1, id2, ...] }` and/or `{ field: 'ad.id', operator: 'IN', value: [...] }`.
- **One request per account**: for multiple `ad_account_id`, the backend issues one `GET act_{id}/insights` per account, then merges rows. No loop over campaigns/ads; filtering is done in the single request via `filtering` param.
- **Fields**: `ad_id,ad_name,campaign_id,campaign_name,impressions,clicks,spend,ctr,cpc,actions,action_values,date_start,date_stop`. Level `ad`.

---

## 4. Rate Limiting and Cache Fallback

- **Rate limiter** (`services/meta/rateLimiter.js`): max 2 concurrent Meta API calls, minimum 2s between starts. All ad-account, campaign, and ads fetch paths use it via their services.
- **Cache fallback**: ad accounts and campaigns read from DB first; ads read from DB only (sync is explicit or on first empty for `?all=true`). Insights are DB-first; on empty or `?live=1`, one live request per account with fallback to existing DB data on error.
- **No direct Meta calls on filter change**: campaigns and ads dropdowns/filters use DB (and for campaigns, 24h-refreshed cache). Insights use a single /insights call per account with IN filter, not per-campaign or per-ad calls.

---

## 5. Filter Handling Logic (High Level)

1. **Ad account**: from query `ad_account_id` or env `META_AD_ACCOUNT_ID`. Multi-account: `ad_account_id=id1,id2` (insights only; one request per id).
2. **Campaigns**: `GET /api/meta/campaigns?ad_account_id=` or `GET /api/meta/active-campaigns?ad_account_id=`. Active-campaigns returns campaign list from DB and one /insights request for metrics.
3. **Ads**: `GET /api/meta/ads?ad_account_id=&all=true` or `?ad_account_id=&campaign_id=`. Always from DB; sync via `POST /api/meta/ads/sync` or first empty `?all=true`.
4. **Insights**: `from`, `to`, `ad_account_id` (single or comma-separated), `is_all_campaigns`, `is_all_ads`, `campaign_id`, `ad_id` (comma-separated). Select All → backend omits campaign_id/ad_id in DB query and does not add campaign.id/ad.id to live filtering.

---

## 6. DB Schema (Meta Cache Tables)

Run `server/meta-cache-schema.sql` after `supabase-complete-schema.sql`:

- **meta_ad_accounts**: `account_id` (unique), `name`, `currency`, `timezone_name`, `account_status`
- **meta_campaigns**: `ad_account_id`, `campaign_id`, `name`, `status`, `effective_status`, `objective`, `updated_at` (for 24h TTL)
- **meta_ads**: `ad_account_id`, `ad_id`, `campaign_id`, `name`, `status`, `effective_status`, `updated_at`

---

## 7. Support Matrix

| Feature | Supported |
|---------|-----------|
| Single & multi ad accounts | Yes (insights: `ad_account_id=id1,id2`) |
| Single & multi campaigns | Yes (IN filter; Select All = no filter) |
| Single & multi ads | Yes (IN filter; Select All = no filter) |
| Accurate aggregation in cards | Yes (one /insights per account, level=ad; client/server aggregates from returned rows) |

---

## 8. Production Checklist

- [ ] Run `meta-cache-schema.sql` in Supabase SQL Editor.
- [ ] Set `META_ACCESS_TOKEN` and `META_AD_ACCOUNT_ID` (or pass `ad_account_id` on requests).
- [ ] Ensure `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are set for cache tables.
- [ ] Optional: call `POST /api/meta/ads/sync` (or use `?all=true` once) to seed `meta_ads` before heavy filter use.
- [ ] Use `GET /api/meta/campaigns?ad_account_id=&refresh=1` to force 24h refresh when needed.
