# Supabase Setup Guide

This guide will help you set up Supabase for user authentication in the Marketing Dashboard.

## Step 1: Create a Supabase Project

1. Go to [https://supabase.com](https://supabase.com)
2. Sign up or log in
3. Click "New Project"
4. Fill in your project details:
   - Project name: `marketing-dashboard` (or any name you prefer)
   - Database password: Choose a strong password
   - Region: Select the closest region to your users
5. Click "Create new project" and wait for it to be ready (about 2 minutes)

## Step 2: Get Your Supabase Credentials

1. In your Supabase project dashboard, go to **Settings** → **API**
2. Copy the following:
   - **Project URL** (looks like: `https://xxxxxxxxxxxxx.supabase.co`)
   - **anon/public key** (the `anon` key, not the `service_role` key for security)

## Step 3: Create the Users Table

1. In your Supabase dashboard, go to **SQL Editor**
2. Click "New Query"
3. Copy and paste the contents of `supabase-schema.sql` file
4. Click "Run" to execute the SQL
5. Verify the table was created by going to **Table Editor** → you should see a `users` table

## Step 4: Configure Environment Variables

Create or update `server/.env` file with the following:

```env
# Supabase Configuration
SUPABASE_URL=https://your-project-id.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key-here

# Alternative: You can use anon key, but service_role is recommended for backend
# SUPABASE_ANON_KEY=your-anon-key-here

# JWT Secret (keep existing or generate a new one)
JWT_SECRET=your-jwt-secret-here
JWT_EXPIRES_IN=7d

# Other existing environment variables...
META_ACCESS_TOKEN=your_meta_token
META_AD_ACCOUNT_ID=your_ad_account_id
# ... etc
```

### Getting Your Supabase Keys:

1. **SUPABASE_URL**: Found in Settings → API → Project URL
2. **SUPABASE_SERVICE_ROLE_KEY** (Recommended for backend):
   - Found in Settings → API → Project API keys → `service_role` `secret` key
   - ⚠️ **KEEP THIS SECRET** - Never expose this in frontend code!
   - This key bypasses Row Level Security and is perfect for server-side operations

3. **SUPABASE_ANON_KEY** (Alternative):
   - Found in Settings → API → Project API keys → `anon` `public` key
   - Can be used if service_role is not available, but may have RLS restrictions

⚠️ **For Backend/Server Operations**: Use `SUPABASE_SERVICE_ROLE_KEY` - it has full database access and bypasses RLS, which is what you need for authentication operations.

## Step 5: Test the Setup

1. Start your server:
   ```bash
   cd server
   npm start
   ```

2. Test signup:
   ```bash
   curl -X POST http://localhost:4000/api/auth/signup \
     -H "Content-Type: application/json" \
     -d '{"email":"test@example.com","password":"test123","fullName":"Test User"}'
   ```

3. Test login:
   ```bash
   curl -X POST http://localhost:4000/api/auth/login \
     -H "Content-Type: application/json" \
     -d '{"email":"test@example.com","password":"test123"}'
   ```

## Troubleshooting

### Error: "Supabase not configured"
- Make sure `SUPABASE_URL` and `SUPABASE_ANON_KEY` are set in your `.env` file
- Check that the `.env` file is in the `server/` directory
- Restart your server after adding environment variables

### Error: "relation 'users' does not exist"
- Make sure you ran the SQL schema from `supabase-schema.sql` in the Supabase SQL Editor
- Verify the table exists in Supabase dashboard → Table Editor

### Error: "Failed to create user"
- Check your Supabase project is active (not paused)
- Verify your Supabase URL and key are correct
- Check Supabase logs in the dashboard for more details

### Error: 401 Unauthorized
- Verify your Supabase `anon` key is correct
- Check if Row Level Security (RLS) policies are blocking access
- You may need to adjust RLS policies in Supabase dashboard

## Row Level Security (RLS)

The schema includes basic RLS policies. If you need to adjust them:

1. Go to Supabase dashboard → Authentication → Policies
2. Find the `users` table policies
3. Adjust as needed for your security requirements

For development, you can temporarily disable RLS by running:
```sql
ALTER TABLE users DISABLE ROW LEVEL SECURITY;
```

⚠️ **Warning**: Only disable RLS in development, never in production!

## Migration from SQL Server

If you were previously using SQL Server for authentication:

1. Export existing users from SQL Server (if any)
2. Import them into Supabase using the Supabase dashboard or SQL Editor
3. Make sure passwords are hashed with bcrypt (same as before)

## Support

For Supabase-specific issues, check:
- [Supabase Documentation](https://supabase.com/docs)
- [Supabase Discord](https://discord.supabase.com)

