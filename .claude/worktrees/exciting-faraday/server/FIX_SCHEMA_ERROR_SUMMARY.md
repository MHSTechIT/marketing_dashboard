# 🔧 Quick Fix Summary: Schema Cache Error

## Error You're Seeing
```
Database error: Could not find the table 'public.users' in the schema cache
```

## ✅ What I've Done (Automated)

1. ✅ Created diagnostic script: `check-users-table.js` - Run `npm run check-users-table` to verify setup
2. ✅ Created SQL script: `ensure-users-table.sql` - Run this in Supabase SQL Editor to create/verify table
3. ✅ Improved error messages: Better error handling in `server.js` with specific guidance
4. ✅ Created step-by-step guide: `STEP_BY_STEP_FIX.md` - Detailed instructions

## 🚀 What You Need To Do (Manual Steps)

### Quick Fix (30 seconds - Try This First!)

1. **Open Supabase Dashboard** → https://supabase.com/dashboard
2. **Go to Settings → API**
3. **Scroll down to "Schema" section**
4. **Click "Reload schema" button**
5. **Wait 10-30 seconds**
6. **Try signing up again**

### If That Doesn't Work

#### Option A: Use the SQL Script (Recommended)

1. **Open Supabase Dashboard → SQL Editor**
2. **Click "New Query"**
3. **Open `server/ensure-users-table.sql`** in your code editor
4. **Copy entire contents** and paste into Supabase SQL Editor
5. **Click "Run"**
6. **Wait 10-30 seconds** for schema cache to refresh
7. **Try signing up again**

#### Option B: Verify Setup

1. **Run diagnostic script:**
   ```bash
   cd server
   npm run check-users-table
   ```
2. **Follow the instructions** in the output
3. **Try signing up again**

## 📋 Detailed Instructions

See `server/STEP_BY_STEP_FIX.md` for complete step-by-step instructions with troubleshooting.

## ✅ Success Indicators

You'll know it's fixed when:
- ✅ `npm run check-users-table` shows all green checkmarks
- ✅ Signup form submits without schema cache error
- ✅ You receive a success response with JWT token

## 🆘 Still Having Issues?

1. **Check environment variables** in `server/.env`:
   ```env
   SUPABASE_URL=https://your-project-id.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=your-service-role-key-here
   ```
   Get these from: **Supabase Dashboard → Settings → API**

2. **Verify table exists:**
   - Go to **Table Editor** in Supabase Dashboard
   - Look for `users` table in the list
   - If missing, run `ensure-users-table.sql`

3. **Check RLS settings:**
   - Go to **Database → Tables → users**
   - Ensure **RLS is disabled** (we handle auth at application level)

4. **Review detailed guide:**
   - Open `server/STEP_BY_STEP_FIX.md` for complete troubleshooting

