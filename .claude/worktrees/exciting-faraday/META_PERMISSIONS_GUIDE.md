# Meta API Permissions Guide

## Required Permissions for Marketing Dashboard

To fetch lead data from Meta Lead Ads, your Access Token needs the following permissions:

### Critical Permissions:
1. **`leads_retrieval`** - Required to fetch individual lead data (Name, Phone, Address, etc.)
2. **`ads_read`** - Required to read ad account data
3. **`ads_management`** - Required for campaign and ad management
4. **`pages_show_list`** - Required to list pages
5. **`pages_read_engagement`** - Required to read page engagement data

## How to Grant Permissions

### Step 1: Go to Meta App Dashboard
1. Visit [Meta for Developers](https://developers.facebook.com/)
2. Select your app
3. Go to **Settings** > **Basic**

### Step 2: Add Permissions
1. Go to **App Review** > **Permissions and Features**
2. Find the permissions listed above
3. Click **Request** for each permission you need
4. Complete the App Review process if required

### Step 3: Generate Access Token with Permissions
1. Go to **Tools** > **Graph API Explorer**
2. Select your app
3. Click **Generate Access Token**
4. In the token generator, select all required permissions:
   - `leads_retrieval`
   - `ads_read`
   - `ads_management`
   - `pages_show_list`
   - `pages_read_engagement`
5. Generate the token
6. Copy the token and paste it in **Meta Settings** page of this dashboard

### Step 4: Verify Permissions
After updating your token, the dashboard will:
- Show permission errors if any permission is missing
- Display lead data if all permissions are granted

## Troubleshooting

### Error: "Insufficient permissions to fetch leads"
- **Solution**: Ensure your Access Token has the `leads_retrieval` permission
- Regenerate your token with all required permissions
- Update the token in Meta Settings

### Error: "Meta Access Token expired or invalid"
- **Solution**: Generate a new Access Token
- Long-lived tokens expire after 60 days
- Consider using a System User Token for production

### No Leads Showing
- Check if you have active Lead Ads campaigns
- Verify the date range filters
- Ensure campaigns are selected in the dashboard filters

## Quick Check
To verify your token has the required permissions, you can:
1. Use the [Access Token Debugger](https://developers.facebook.com/tools/debug/accesstoken/)
2. Check the "Scopes" section to see granted permissions
3. Ensure `leads_retrieval` is listed

## Notes
- Some permissions require App Review approval
- Business verification may be required for certain permissions
- System User Tokens are recommended for production use

