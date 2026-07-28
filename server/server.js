const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

// ── Process-level crash guards ──────────────────────────────────────────────
// The server runs several background schedulers (leads sync, insights sync,
// token refresh, story snapshots, auto-delete, DW Google-Sheets sync). If any
// of them throws an error that isn't caught — or a promise rejects without a
// .catch — Node's default behaviour is to terminate the WHOLE process. Under
// nodemon that means the API on :4000 goes down and does NOT come back until a
// file is edited, so every dashboard section starts showing "Failed to fetch
// leads from database" (it's really "backend unreachable").
//
// These guards log the failure and keep the process alive, so a single
// background-job hiccup can never take the API offline. They do not change any
// request/response behaviour — they only prevent silent process death.
process.on('unhandledRejection', (reason, promise) => {
  console.error('[FATAL-GUARD] Unhandled promise rejection (server kept alive):', reason);
});
process.on('uncaughtException', (err) => {
  console.error('[FATAL-GUARD] Uncaught exception (server kept alive):', err && err.stack ? err.stack : err);
});

const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { supabase, verifyTableExists } = require('./supabase');
// Resolve the leads table/columns the same way the write path does, so these
// endpoints can never drift onto a different physical table again.
const { leadsTableName, leadsCol, resolveLeadsDbShape } = require('./repositories/leadsRepository');
const { signToken, hashPassword, comparePassword, authMiddleware } = require('./auth');

const app = express();
app.use(cors({
  origin: [
    /^http:\/\/localhost:\d+$/,
    /^http:\/\/127\.0\.0\.1:\d+$/,
    'https://final-dashboard-gxau.vercel.app',
    /https:\/\/.*\.vercel\.app$/,
    /https:\/\/.*\.onrender\.com$/
  ],
  credentials: true
}));
app.use(express.json({ limit: '20mb' }));

// Import Meta routes
const metaRoutes = require("./meta/meta.jsx");
app.use("/api/meta", metaRoutes);

// Import Wix routes
const wixRoutes = require("./routes/wix");
app.use("/api/wix", wixRoutes);

// Import Permissions routes
const permissionsRoutes = require("./routes/permissions");
app.use("/api/permissions", permissionsRoutes);

// Import AI Insights routes (Gemini)
const aiInsightsRoutes = require("./routes/aiInsights");
app.use("/api/ai", aiInsightsRoutes);

// Import Plan page routes (teams, targets, aggregates)
const planRoutes = require("./routes/plan");
app.use("/api/plan", planRoutes);

// Unique Leads Extraction (import/export, deduplication)
const uniqueLeadsRoutes = require("./routes/uniqueLeads");
app.use("/api/unique-leads", uniqueLeadsRoutes);

// YouTube Ads / Google Ads insights (dashboard metrics and charts)
const youtubeInsightsRoutes = require("./routes/youtubeInsights");
app.use("/api/youtube", youtubeInsightsRoutes);

// Conversion Count — phone-match ad leads against the "Paid leads" sheet
const conversionsRoutes = require("./routes/conversions");
app.use("/api/conversions", conversionsRoutes);

// Page Visit / User Activity Tracking (records visits + sessions; admin analytics)
const activityRoutes = require("./routes/activityTracking");
app.use("/api/activity", activityRoutes);

// Leads → Google Sheets real-time sync (webhook + scheduler + backfill)
const leadsSyncRoutes = require("./routes/leadsSync");
app.use("/api/leads-sync", leadsSyncRoutes);

const aiFeaturesRoutes = require("./routes/aiFeatures");
app.use("/api/ai/features", aiFeaturesRoutes);
// NOTE: the DW-live-data sheet scheduler used to start here behind only
// `!process.env.VERCEL`, which meant a developer running the server locally
// pushed straight to the LIVE Google Sheet. It now starts from
// startSchedulers() so it obeys the same schedulersEnabled() gate as every
// other background job (production sets NODE_ENV=production + RUN_SCHEDULERS).

app.get("/", (req, res) => {
  res.send("Backend is running...");
});

// Health check endpoint
app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    port: process.env.PORT || 4000
  });
});

// Deep health check — surfaces the failure modes that previously failed silently:
// missing DB columns/tables, and a stale leads-sync cursor. Hit /api/health/deep.
app.get("/api/health/deep", async (req, res) => {
  const checks = [];
  const add = (name, ok, detail) => checks.push({ name, ok, ...(detail ? { detail } : {}) });
  try {
    if (!supabase) {
      return res.status(500).json({ status: "error", error: "Supabase not configured" });
    }

    // Required tables / columns (select the specific columns so a missing column errors).
    const required = [
      ["leads", "city, street, form_name"],
      ["lead_scores", "id, score, tier"],
      ["campaign_saturation_log", "id, status"],
      ["creative_fatigue_log", "id, status"],
      ["unique_leads", "id, phone"],
      ["meta_insights", "id"],
    ];
    for (const [tbl, cols] of required) {
      const { error } = await supabase.from(tbl).select(cols, { head: true, count: "exact" });
      add(`table:${tbl}`, !error, error ? error.message : undefined);
    }

    // Leads-sync cursor freshness (should advance roughly every 15 min).
    try {
      const { data } = await supabase.from("JobState").select("JobValue, UpdatedAt").eq("JobKey", "lastSuccessfulLeadsSyncUtc").maybeSingle();
      const last = data?.JobValue ? new Date(data.JobValue) : null;
      const ageMin = last ? Math.round((Date.now() - last.getTime()) / 60000) : null;
      add("leadsSyncCursor", ageMin != null && ageMin < 60, last ? `last success ${ageMin} min ago` : "no cursor yet");
    } catch (e) {
      add("leadsSyncCursor", false, e.message);
    }

    const allOk = checks.every((c) => c.ok);
    res.status(allOk ? 200 : 503).json({ status: allOk ? "ok" : "degraded", timestamp: new Date().toISOString(), checks });
  } catch (err) {
    res.status(500).json({ status: "error", error: err.message, checks });
  }
});

// Manual trigger for DW leads → Google Sheet sync
app.post("/api/dw-sync/trigger", async (req, res) => {
  res.json({ status: "started", message: "DW sync triggered — check server logs." });
  runDwLeadsSync().catch(e => console.error("[DWSync] Manual trigger error:", e.message));
});

// Reset syncedIds and re-push everything from Meta
app.post("/api/dw-sync/reset-and-repush", async (req, res) => {
  const fs   = require('fs');
  const path = require('path');
  const STATE_FILE = path.resolve(__dirname, 'data/dwSheetSyncState.json');
  try {
    const existing = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    fs.writeFileSync(STATE_FILE, JSON.stringify({ syncedIds: [], campaignIds: existing.campaignIds, campaignIdsFetchedAt: existing.campaignIdsFetchedAt }), 'utf8');
    res.json({ status: "started", message: "State reset. Full re-sync in progress — check server logs." });
    runDwLeadsSync().catch(e => console.error("[DWSync] Repush error:", e.message));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// //const PORT = process.env.PORT || 5000;
// app.listen(PORT, () => {
//   console.log(`Server listening on port ${PORT}`);
// });

// --- AUTH: signup
app.post('/api/auth/signup', async (req, res) => {
  const { email, password, fullName } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'email and password required' });

  try {
    if (!supabase) {
      return res.status(500).json({ 
        error: 'Supabase not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in server/.env' 
      });
    }

    // Verify table exists (but don't block on schema cache issues)
    const tableCheck = await verifyTableExists('users');
    if (!tableCheck.exists && !tableCheck.error?.includes('schema cache')) {
      console.error('Table check failed:', tableCheck.error);
      return res.status(500).json({ 
        error: 'Database table not found. Please create the users table in Supabase.',
        details: 'Run the SQL from server/supabase-complete-schema.sql in your Supabase SQL Editor',
        help: 'Go to Supabase Dashboard → SQL Editor → New Query → Paste SQL from supabase-complete-schema.sql → Run'
      });
    }

    // Check if user already exists (using lowercase table and column names)
    const { data: existingUser, error: checkError } = await supabase
      .from('users')
      .select('id, email')
      .eq('email', email)
      .maybeSingle();

    // Handle check error (but allow "not found" errors to continue)
    if (checkError) {
      console.error('Error checking existing user:', checkError);
      
      // Provide specific guidance for schema cache errors
      if (checkError.code === 'PGRST116' || checkError.message?.includes('schema cache') || checkError.message?.includes('Could not find the table')) {
        return res.status(500).json({ 
          error: 'Schema cache error: Could not find the table \'public.users\' in the schema cache',
          details: 'The users table exists but PostgREST schema cache needs to be refreshed',
          solution: {
            step1: 'Go to Supabase Dashboard → Settings → API',
            step2: 'Scroll to "Schema" section and click "Reload schema"',
            step3: 'Wait 10-30 seconds, then try again',
            alternative: 'OR run this SQL in SQL Editor: SELECT pg_notify(\'pgrst\', \'reload schema\');',
            verify: 'Run: npm run check-users-table to verify table access'
          },
          help: 'See server/STEP_BY_STEP_FIX.md for detailed instructions'
        });
      }
      
      return res.status(500).json({ error: 'Database error: ' + checkError.message });
    }

    // If user exists
    if (existingUser) {
      return res.status(409).json({ error: 'Email already exists' });
    }

    // Hash password
    const hashed = await hashPassword(password);

    // Insert user into Supabase (using lowercase table and column names)
    const { data: newUser, error: insertError } = await supabase
      .from('users')
      .insert([
        {
          email: email,
          password_hash: hashed,
          full_name: fullName || null,
          role: 'user'
        }
      ])
      .select('id, email, full_name')
      .single();

    if (insertError) {
      console.error('Supabase signup error:', insertError);
      
      // Provide helpful error messages
      if (insertError.code === 'PGRST116' || insertError.message?.includes('schema cache')) {
        return res.status(500).json({ 
          error: 'Schema cache issue. The table exists but PostgREST cache needs refresh.',
          details: 'PostgREST schema cache needs to be refreshed',
          help: [
            '1. Go to Supabase Dashboard → Settings → API',
            '2. Click "Reload schema" or wait 30-60 seconds',
            '3. OR run: SELECT pg_notify(\'pgrst\', \'reload schema\'); in SQL Editor',
            '4. OR check if table is exposed: Database → Tables → users → API Settings'
          ]
        });
      }
      
      return res.status(500).json({ 
        error: 'Failed to create user: ' + insertError.message,
        code: insertError.code,
        details: insertError.details || 'Check server logs for more details'
      });
    }

    const token = signToken({ id: newUser.id, email: newUser.email });
    res.json({ 
      token, 
      user: { 
        id: newUser.id, 
        email: newUser.email, 
        fullName: newUser.full_name 
      } 
    });
  } catch (err) {
    console.error('Signup error:', err);
    res.status(500).json({ error: 'Server error: ' + err.message });
  }
});

// --- AUTH: login
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'email and password required' });

  const fs = require('fs');
  const DEV_USERS_FILE = path.join(__dirname, 'data', 'dev-users.json');

  async function tryDevFallback() {
    if (!fs.existsSync(DEV_USERS_FILE)) return null;
    try {
      const devUsers = JSON.parse(fs.readFileSync(DEV_USERS_FILE, 'utf8'));
      const devUser = devUsers.find(u => u.email === email);
      if (!devUser) return null;
      const ok = await comparePassword(password, devUser.password_hash);
      if (!ok) return false;
      return devUser;
    } catch { return null; }
  }

  try {
    if (!supabase) {
      const devUser = await tryDevFallback();
      if (devUser === false) return res.status(401).json({ error: 'Invalid credentials' });
      if (devUser) {
        const token = signToken({ id: devUser.id, email: devUser.email });
        return res.json({ token, user: { id: devUser.id, email: devUser.email, fullName: devUser.full_name } });
      }
      return res.status(500).json({
        error: 'Supabase not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in server/.env'
      });
    }

    // Get user from database
    const { data: user, error: fetchError } = await supabase
      .from('users')
      .select('id, email, password_hash, full_name')
      .eq('email', email)
      .maybeSingle();

    if (fetchError) {
      console.error('Login error:', fetchError);
      if (fetchError.code === 'PGRST116') {
        return res.status(500).json({
          error: 'Table not found. Please create the users table in Supabase.',
          details: 'Run the SQL from server/supabase-complete-schema.sql in your Supabase SQL Editor'
        });
      }
      // DB unreachable — try local dev fallback
      const devUser = await tryDevFallback();
      if (devUser === false) return res.status(401).json({ error: 'Invalid credentials' });
      if (devUser) {
        const token = signToken({ id: devUser.id, email: devUser.email });
        return res.json({ token, user: { id: devUser.id, email: devUser.email, fullName: devUser.full_name } });
      }
      return res.status(500).json({ error: 'Database error: ' + fetchError.message });
    }

    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Compare password
    const ok = await comparePassword(password, user.password_hash);
    if (!ok) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = signToken({ id: user.id, email: user.email });
    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.full_name
      }
    });
  } catch (err) {
    console.error('Login error:', err);
    // DB timeout — try local dev fallback before returning error
    const devUser = await tryDevFallback().catch(() => null);
    if (devUser === false) return res.status(401).json({ error: 'Invalid credentials' });
    if (devUser) {
      const token = signToken({ id: devUser.id, email: devUser.email });
      return res.json({ token, user: { id: devUser.id, email: devUser.email, fullName: devUser.full_name } });
    }
    res.status(500).json({ error: 'Server error: ' + err.message });
  }
});

// --- Protected example: get current user
app.get('/api/auth/me', authMiddleware, async (req, res) => {
  const fs = require('fs');
  const DEV_USERS_FILE = path.join(__dirname, 'data', 'dev-users.json');

  function devUserById(id) {
    if (!fs.existsSync(DEV_USERS_FILE)) return null;
    try {
      const devUsers = JSON.parse(fs.readFileSync(DEV_USERS_FILE, 'utf8'));
      return devUsers.find(u => u.id === id) || null;
    } catch { return null; }
  }

  try {
    if (!supabase) {
      const devUser = devUserById(req.user.id);
      if (devUser) return res.json({ id: devUser.id, email: devUser.email, FullName: devUser.full_name, fullName: devUser.full_name, role: devUser.role || 'admin' });
      return res.status(500).json({ error: 'Supabase not configured' });
    }

    const { data: user, error } = await supabase
      .from('users')
      .select('id, email, full_name, role')
      .eq('id', req.user.id)
      .single();

    if (error || !user) {
      const devUser = devUserById(req.user.id);
      if (devUser) return res.json({ id: devUser.id, email: devUser.email, FullName: devUser.full_name, fullName: devUser.full_name, role: devUser.role || 'admin' });
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({
      id: user.id,
      email: user.email,
      FullName: user.full_name,
      fullName: user.full_name,
      role: user.role || 'user'
    });
  } catch (e) {
    console.error('Get user error:', e);
    const devUser = devUserById(req.user.id);
    if (devUser) return res.json({ id: devUser.id, email: devUser.email, FullName: devUser.full_name, fullName: devUser.full_name, role: devUser.role || 'admin' });
    res.status(500).json({ error: 'Server error: ' + e.message });
  }
});

// --- USER MANAGEMENT ENDPOINTS

// GET /api/users - Fetch all users
app.get('/api/users', authMiddleware, async (req, res) => {
  try {
    if (!supabase) {
      return res.status(500).json({ error: 'Supabase not configured' });
    }

    const { data: users, error } = await supabase
      .from('users')
      .select('id, email, full_name, role, created_at')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching users:', error);
      return res.status(500).json({ error: 'Database error: ' + error.message });
    }

    // Format users to match UI expectations
    const formattedUsers = (users || []).map(user => {
      // Format created_at to "DD MMM, YYYY"
      const createdOn = user.created_at 
        ? new Date(user.created_at).toLocaleDateString('en-GB', { 
            day: 'numeric', 
            month: 'short', 
            year: 'numeric' 
          })
        : '';

      // Map role to type: "admin" -> "Admin", "user" or "restricted" -> "Restricted"
      const type = user.role === 'admin' ? 'Admin' : 'Restricted';

      return {
        id: user.id,
        name: user.full_name || '',
        email: user.email,
        type: type,
        createdOn: createdOn,
        country: '', // Not stored in DB
        phone: '', // Not stored in DB
        profilePicture: null // Not stored in DB
      };
    });

    res.json(formattedUsers);
  } catch (err) {
    console.error('Get users error:', err);
    res.status(500).json({ error: 'Server error: ' + err.message });
  }
});

// POST /api/users - Create new user
app.post('/api/users', authMiddleware, async (req, res) => {
  const { email, password, fullName, role } = req.body;
  
  if (!email || !password) {
    return res.status(400).json({ error: 'email and password required' });
  }

  try {
    if (!supabase) {
      return res.status(500).json({ 
        error: 'Supabase not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in server/.env' 
      });
    }

    // Check if user already exists
    const { data: existingUser, error: checkError } = await supabase
      .from('users')
      .select('id, email')
      .eq('email', email)
      .maybeSingle();

    if (checkError && checkError.code !== 'PGRST116') {
      console.error('Error checking existing user:', checkError);
      return res.status(500).json({ error: 'Database error: ' + checkError.message });
    }

    if (existingUser) {
      return res.status(409).json({ error: 'Email already exists' });
    }

    // Hash password
    const hashed = await hashPassword(password);

    // Map role: "Admin" -> "admin", "Restricted" -> "user"
    const dbRole = role === 'Admin' ? 'admin' : 'user';

    // Insert user into Supabase
    const { data: newUser, error: insertError } = await supabase
      .from('users')
      .insert([
        {
          email: email,
          password_hash: hashed,
          full_name: fullName || null,
          role: dbRole
        }
      ])
      .select('id, email, full_name, role, created_at')
      .single();

    if (insertError) {
      console.error('Supabase create user error:', insertError);
      return res.status(500).json({ 
        error: 'Failed to create user: ' + insertError.message,
        code: insertError.code
      });
    }

    // Format response to match UI expectations
    const createdOn = newUser.created_at 
      ? new Date(newUser.created_at).toLocaleDateString('en-GB', { 
          day: 'numeric', 
          month: 'short', 
          year: 'numeric' 
        })
      : '';

    const type = newUser.role === 'admin' ? 'Admin' : 'Restricted';

    res.json({
      id: newUser.id,
      name: newUser.full_name || '',
      email: newUser.email,
      type: type,
      createdOn: createdOn,
      country: '',
      phone: '',
      profilePicture: null
    });
  } catch (err) {
    console.error('Create user error:', err);
    res.status(500).json({ error: 'Server error: ' + err.message });
  }
});

// PUT /api/users/:id - Update user
app.put('/api/users/:id', authMiddleware, async (req, res) => {
  const { id } = req.params;
  const { email, fullName, role, password } = req.body;

  if (!email) {
    return res.status(400).json({ error: 'email required' });
  }

  try {
    if (!supabase) {
      return res.status(500).json({ error: 'Supabase not configured' });
    }

    // Check if user exists
    const { data: existingUser, error: fetchError } = await supabase
      .from('users')
      .select('id, email')
      .eq('id', id)
      .single();

    if (fetchError || !existingUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Check if email is being changed and if new email already exists
    if (email !== existingUser.email) {
      const { data: emailUser, error: emailCheckError } = await supabase
        .from('users')
        .select('id')
        .eq('email', email)
        .maybeSingle();

      if (emailCheckError) {
        console.error('Error checking email:', emailCheckError);
        return res.status(500).json({ error: 'Database error: ' + emailCheckError.message });
      }

      if (emailUser) {
        return res.status(409).json({ error: 'Email already exists' });
      }
    }

    // Prepare update object
    const updateData = {
      email: email,
      full_name: fullName || null
    };

    // Map role: "Admin" -> "admin", "Restricted" -> "user"
    if (role) {
      updateData.role = role === 'Admin' ? 'admin' : 'user';
    }

    // Update password if provided
    if (password) {
      updateData.password_hash = await hashPassword(password);
    }

    // Update user in Supabase
    const { data: updatedUser, error: updateError } = await supabase
      .from('users')
      .update(updateData)
      .eq('id', id)
      .select('id, email, full_name, role, created_at')
      .single();

    if (updateError) {
      console.error('Supabase update user error:', updateError);
      return res.status(500).json({ 
        error: 'Failed to update user: ' + updateError.message
      });
    }

    // Format response to match UI expectations
    const createdOn = updatedUser.created_at 
      ? new Date(updatedUser.created_at).toLocaleDateString('en-GB', { 
          day: 'numeric', 
          month: 'short', 
          year: 'numeric' 
        })
      : '';

    const type = updatedUser.role === 'admin' ? 'Admin' : 'Restricted';

    res.json({
      id: updatedUser.id,
      name: updatedUser.full_name || '',
      email: updatedUser.email,
      type: type,
      createdOn: createdOn,
      country: '',
      phone: '',
      profilePicture: null
    });
  } catch (err) {
    console.error('Update user error:', err);
    res.status(500).json({ error: 'Server error: ' + err.message });
  }
});

// DELETE /api/users/:id - Delete user
app.delete('/api/users/:id', authMiddleware, async (req, res) => {
  const { id } = req.params;

  try {
    if (!supabase) {
      return res.status(500).json({ error: 'Supabase not configured' });
    }

    // Check if user exists
    const { data: existingUser, error: fetchError } = await supabase
      .from('users')
      .select('id')
      .eq('id', id)
      .single();

    if (fetchError || !existingUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Delete user from Supabase
    const { error: deleteError } = await supabase
      .from('users')
      .delete()
      .eq('id', id);

    if (deleteError) {
      console.error('Supabase delete user error:', deleteError);
      return res.status(500).json({ 
        error: 'Failed to delete user: ' + deleteError.message
      });
    }

    res.json({ message: 'User deleted successfully' });
  } catch (err) {
    console.error('Delete user error:', err);
    res.status(500).json({ error: 'Server error: ' + err.message });
  }
});

// --- Ads endpoints (public read; require auth if you want)
app.get('/api/ads', async (req, res) => {
  try {
    if (!supabase) {
      return res.status(500).json({ error: 'Supabase not configured' });
    }

    const days = Number(req.query.days) || 30;
    const includeLeads = req.query.includeLeads === '1' || req.query.includeLeads === 'true';
    const since = (() => {
      const d = new Date();
      d.setDate(d.getDate() - (days - 1));
      return d.toISOString().slice(0,10);
    })();

    // Query ads from Supabase
    // Note: Table name is 'Ads' (capitalized) with capitalized column names
    const { data: rows, error: adsError } = await supabase
      .from('Ads')
      .select('Id, Campaign, DateChar, Leads, Spend, ActionsJson')
      .gte('DateChar', since)
      .order('DateChar', { ascending: true });

    if (adsError) {
      console.error('Error fetching ads:', adsError);
      return res.status(500).json({ error: 'Database error: ' + adsError.message });
    }

    // Transform to match expected format (camelCase for compatibility)
    // Note: Supabase returns capitalized column names
    const ads = (rows || []).map(r => ({
      Id: r.Id,
      id: r.Id,
      Campaign: r.Campaign,
      campaign: r.Campaign,
      date: r.DateChar,
      DateChar: r.DateChar,
      Leads: r.Leads,
      leads: r.Leads,
      Spend: r.Spend,
      spend: r.Spend,
      actions: typeof r.ActionsJson === 'string' ? JSON.parse(r.ActionsJson || '{}') : (r.ActionsJson || {}),
      ActionsJson: undefined
    }));

    // Include lead details if requested
    if (includeLeads) {
      // Same fix as /api/leads below: resolve the table/columns instead of
      // hardcoding the mixed-case legacy names.
      const shape = resolveLeadsDbShape ? await resolveLeadsDbShape() : 'snake';
      const tbl = leadsTableName(shape);
      const C = leadsCol(shape);

      for (const a of ads) {
        const { data: leadRows, error: leadsError } = await supabase
          .from(tbl)
          .select([C.id, C.name, C.phone, C.time, C.date, C.campaign].join(', '))
          .eq(C.date, a.date)
          .eq(C.campaign, a.campaign)
          .order(C.time, { ascending: false });

        if (!leadsError && leadRows) {
          a.lead_details = leadRows.map(l => {
            const id = l[C.id], name = l[C.name], phone = l[C.phone];
            const time = l[C.time], date = l[C.date], campaign = l[C.campaign];
            return {
              Id: id, id,
              Name: name, name,
              Phone: phone, phone,
              Time: time, TimeUtc: time,
              Date: date, DateChar: date,
              Campaign: campaign, campaign,
            };
          });
        }
      }
    }

    res.json(ads);
  } catch (err) {
    console.error('Error fetching ads:', err);
    res.status(500).json({ error: 'Server error: ' + err.message });
  }
});

// /api/leads?page=1&perPage=10&campaign=Alpha (paginated)
app.get('/api/leads', async (req, res) => {
  try {
    if (!supabase) {
      return res.status(500).json({ error: 'Supabase not configured' });
    }

    const page = Math.max(1, Number(req.query.page) || 1);
    const perPage = Math.max(1, Number(req.query.perPage) || 10);
    const campaign = req.query.campaign || null;
    const offset = (page - 1) * perPage;

    // Resolve the leads table the same way the WRITE path does. This used to
    // hardcode 'Leads' (mixed case), which under the case-sensitive pgClient
    // shim is a physically different table from the lowercase `leads` that
    // every sync job writes to — so this endpoint served a legacy snapshot
    // frozen since 2026-01-20 while the real table kept growing.
    const shape = resolveLeadsDbShape ? await resolveLeadsDbShape() : 'snake';
    const tbl = leadsTableName(shape);
    const C = leadsCol(shape);

    let countQuery = supabase.from(tbl).select('*', { count: 'exact', head: true });
    let rowsQuery = supabase
      .from(tbl)
      .select([C.id, C.name, C.phone, C.time, C.date, C.campaign].join(', '))
      // .order(C.id) breaks ties so range() paging stays stable.
      .order(C.time, { ascending: false })
      .order(C.id, { ascending: false })
      .range(offset, offset + perPage - 1);

    // Apply campaign filter if provided
    if (campaign) {
      countQuery = countQuery.eq(C.campaign, campaign);
      rowsQuery = rowsQuery.eq(C.campaign, campaign);
    }

    // Execute queries
    const [countResult, rowsResult] = await Promise.all([
      countQuery,
      rowsQuery
    ]);

    if (countResult.error) {
      console.error('Error counting leads:', countResult.error);
      return res.status(500).json({ error: 'Database error: ' + countResult.error.message });
    }

    if (rowsResult.error) {
      console.error('Error fetching leads:', rowsResult.error);
      return res.status(500).json({ error: 'Database error: ' + rowsResult.error.message });
    }

    const total = countResult.count || 0;

    // Transform to the dual-case shape existing consumers expect. Source column
    // names come from C so this works against either DB shape — reading r.Id
    // directly would yield undefined now that the snake-case table is used.
    const rows = (rowsResult.data || []).map(r => {
      const id = r[C.id], name = r[C.name], phone = r[C.phone];
      const time = r[C.time], date = r[C.date], campaign = r[C.campaign];
      return {
        Id: id, id,
        Name: name, name,
        Phone: phone, phone,
        Time: time, TimeUtc: time,
        Date: date, DateChar: date,
        Campaign: campaign, campaign,
      };
    });

    res.json({ total, page, perPage, rows });
  } catch (err) {
    console.error('Error fetching leads:', err);
    res.status(500).json({ error: 'Server error: ' + err.message });
  }
});

// campaigns list
app.get('/api/campaigns', async (req, res) => {
  try {
    if (!supabase) {
      return res.status(500).json({ error: 'Supabase not configured' });
    }

    // Distinct campaign names from the live meta_campaigns cache (the legacy
    // 'Ads' table is no longer populated — Meta data now lives in meta_campaigns/
    // meta_ads/meta_insights).
    const { data, error } = await supabase
      .from('meta_campaigns')
      .select('name');

    if (error) {
      console.error('Error fetching campaigns:', error);
      return res.status(500).json({ error: 'Database error: ' + error.message });
    }

    const campaigns = [...new Set((data || []).map(x => x.name).filter(Boolean))].sort();
    res.json(campaigns);
  } catch (err) {
    console.error('Error fetching campaigns:', err);
    res.status(500).json({ error: 'Server error: ' + err.message });
  }
});

// actions list
app.get('/api/actions', async (req, res) => {
  try {
    if (!supabase) {
      return res.status(500).json({ error: 'Supabase not configured' });
    }

    // Get all actions_json from ads table
    // Note: Table name is 'Ads' (capitalized) in Supabase
    const { data, error } = await supabase
      .from('Ads')
      .select('ActionsJson');

    if (error) {
      console.error('Error fetching actions:', error);
      return res.status(500).json({ error: 'Database error: ' + error.message });
    }

    // Extract unique action keys from JSONB
    // Note: Column name is 'ActionsJson' (capitalized)
    const set = new Set();
    (data || []).forEach(row => {
      try {
        const obj = typeof row.ActionsJson === 'string' 
          ? JSON.parse(row.ActionsJson || '{}') 
          : (row.ActionsJson || {});
        Object.keys(obj).forEach(k => set.add(k));
      } catch (e) {
        // Ignore parse errors
      }
    });
    
    res.json(Array.from(set));
  } catch (err) {
    console.error('Error fetching actions:', err);
    res.status(500).json({ error: 'Server error: ' + err.message });
  }
});

// Google Sheets revenue metrics endpoint
app.get('/api/google-sheets/revenue-metrics', async (req, res) => {
  try {
    // Google Sheets ID for Ads Analytics Dashboard
    // Sheet: https://docs.google.com/spreadsheets/d/1Mk0CMlGqp-iR8KDvWqIwf1Z__TYjjJs6E0Q0pOHnWv4/edit?gid=0#gid=0
    const SHEET_ID = process.env.GOOGLE_SHEET_ID || '1Mk0CMlGqp-iR8KDvWqIwf1Z__TYjjJs6E0Q0pOHnWv4';
    const GID = '0'; // Default sheet
    
    // Try multiple URL formats for Google Sheets export
    const urlFormats = [
      // Standard export format (works with published sheets)
      `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${GID}`,
      // Alternative format (sometimes works with shared sheets)
      `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&gid=${GID}`,
      // Simple export format
      `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv`
    ];
    
    let response = null;
    let lastError = null;
    
    // Try each URL format until one works
    for (const csvUrl of urlFormats) {
      try {
        response = await axios.get(csvUrl, {
          timeout: 10000, // 10 second timeout
          headers: {
            'Accept': 'text/csv,text/plain,*/*',
            'User-Agent': 'Mozilla/5.0'
          },
          maxRedirects: 5
        });
        
        // If we got a response (even if 401), break and use it
        if (response.status === 200 && response.data) {
          break;
        }
      } catch (err) {
        lastError = err;
        // Continue to next URL format
        continue;
      }
    }
    
    // If all formats failed, throw error with helpful message
    if (!response || response.status !== 200) {
      throw new Error(
        'Unable to access Google Sheet. Please ensure the sheet is "Published to the web": ' +
        '1. Open your Google Sheet\n' +
        '2. Click File > Share > Publish to web\n' +
        '3. Select "Web page" and click "Publish"\n' +
        '4. Alternatively, share the sheet with "Anyone with the link can view"'
      );
    }
    
    // Parse CSV data
    const lines = response.data.split('\n').filter(line => line.trim());
    
    // Skip header row (row 1), get data row (row 2)
    if (lines.length < 2) {
      throw new Error('Insufficient data in spreadsheet');
    }
    
    // Parse CSV row (handle quoted values and commas)
    const parseCsvRow = (line) => {
      const result = [];
      let current = '';
      let inQuotes = false;
      
      for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (char === '"') {
          inQuotes = !inQuotes;
        } else if (char === ',' && !inQuotes) {
          result.push(current.trim());
          current = '';
        } else {
          current += char;
        }
      }
      result.push(current.trim());
      return result;
    };
    
    // Find header row and data row
    // Headers are typically in the first row, data in subsequent rows
    const headerRow = parseCsvRow(lines[0] || '');
    let dataRow = null;
    let dataRowIndex = 1;
    
    // Try to find the data row (skip empty rows)
    for (let i = 1; i < lines.length; i++) {
      const row = parseCsvRow(lines[i]);
      if (row.some(cell => cell && cell.trim() !== '')) {
        dataRow = row;
        dataRowIndex = i;
        break;
      }
    }
    
    if (!dataRow || dataRow.length === 0) {
      throw new Error('No data found in spreadsheet');
    }
    
    // Remove commas and convert to numbers
    const parseNumber = (value) => {
      if (!value || value === '') return 0;
      // Remove commas, currency symbols, and whitespace
      const cleaned = value.toString().replace(/[₹,\s]/g, '');
      const parsed = parseFloat(cleaned);
      return isNaN(parsed) ? 0 : parsed;
    };
    
    // Find column indices by header names (case-insensitive)
    const findColumnIndex = (headerName) => {
      const lowerHeader = headerName.toLowerCase();
      for (let i = 0; i < headerRow.length; i++) {
        if (headerRow[i] && headerRow[i].toLowerCase().includes(lowerHeader)) {
          return i;
        }
      }
      return -1;
    };
    
    // Try to find columns by common names
    // Ads Analytics Sheet structure: A=Online Conversion, B=Offline Conversion, C=L1 Revenue, D=L2 Revenue, E=Total Revenue
    const onlineConvIdx = findColumnIndex('online') >= 0 ? findColumnIndex('online') : 0;
    const offlineConvIdx = findColumnIndex('offline') >= 0 ? findColumnIndex('offline') : 1;
    const l1RevIdx = findColumnIndex('l1') >= 0 ? findColumnIndex('l1') : 2;
    const l2RevIdx = findColumnIndex('l2') >= 0 ? findColumnIndex('l2') : 3;
    const totalRevIdx = findColumnIndex('total') >= 0 ? findColumnIndex('total') : 4;
    
    // Extract values - use column indices if found, otherwise fall back to positional
    // Note: Organic Leads and Organic Revenue are not in Ads Analytics sheet, return 0
    const metrics = {
      onlineConversion: parseNumber(dataRow[onlineConvIdx] || dataRow[0] || '0'),
      offlineConversion: parseNumber(dataRow[offlineConvIdx] || dataRow[1] || '0'),
      l1Revenue: parseNumber(dataRow[l1RevIdx] || dataRow[2] || '0'),
      l2Revenue: parseNumber(dataRow[l2RevIdx] || dataRow[3] || '0'),
      totalRevenue: parseNumber(dataRow[totalRevIdx] || dataRow[4] || '0'),
      organicLeads: 0, // Not in Ads Analytics sheet
      organicRevenue: 0 // Not in Ads Analytics sheet
    };
    
    res.json(metrics);
  } catch (err) {
    console.error('Error fetching Google Sheets data:', err.message);
    console.error('Full error:', err.response?.data || err.response?.status || err);
    
    // Provide helpful error message
    let errorMessage = err.message;
    if (err.response?.status === 401) {
      errorMessage = 'Google Sheet is not publicly accessible. Please: 1) Open the sheet, 2) Click File > Share > Publish to web, 3) Click Publish, 4) Ensure "Web page" is selected';
    } else if (err.response?.status === 403) {
      errorMessage = 'Access denied. Please share the sheet with "Anyone with the link can view" or publish it to web.';
    }
    
    // Return zeros as fallback values with error message
    res.json({
      onlineConversion: 0,
      offlineConversion: 0,
      l1Revenue: 0,
      l2Revenue: 0,
      totalRevenue: 0,
      organicLeads: 0,
      organicRevenue: 0,
      error: errorMessage
    });
  }
});

// Google Sheets Content Marketing revenue endpoint
// Reads summary row (row 2) with pre-calculated totals
app.get('/api/google-sheets/content-marketing-revenue', async (req, res) => {
  try {
    const SHEET_ID = process.env.CONTENT_MARKETING_SHEET_ID || '1fUdW8r0125GXQayXsEgD4Bt2nzaqBN8_vPuGWOIpONw';
    const GID = '1908867041'; // Sheet GID from the URL
    
    // Try multiple URL formats for Google Sheets export
    const urlFormats = [
      `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${GID}`,
      `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&gid=${GID}`,
      `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv`
    ];
    
    let response = null;
    
    // Try each URL format until one works
    for (const csvUrl of urlFormats) {
      try {
        response = await axios.get(csvUrl, {
          timeout: 10000,
          headers: {
            'Accept': 'text/csv,text/plain,*/*',
            'User-Agent': 'Mozilla/5.0'
          },
          maxRedirects: 5
        });
        
        if (response.status === 200 && response.data) {
          break;
        }
      } catch (err) {
        continue;
      }
    }
    
    if (!response || response.status !== 200) {
      throw new Error(
        'Unable to access Google Sheet. Please ensure the sheet is "Published to the web"'
      );
    }
    
    // Parse CSV data
    const lines = response.data.split('\n').filter(line => line.trim());
    
    // Need at least header row (row 1) and summary row (row 2)
    if (lines.length < 2) {
      throw new Error('Insufficient data in spreadsheet. Expected at least header row and summary row.');
    }
    
    // Parse CSV row (handle quoted values and commas)
    const parseCsvRow = (line) => {
      const result = [];
      let current = '';
      let inQuotes = false;
      
      for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (char === '"') {
          inQuotes = !inQuotes;
        } else if (char === ',' && !inQuotes) {
          result.push(current.trim());
          current = '';
        } else {
          current += char;
        }
      }
      result.push(current.trim());
      return result;
    };
    
    // Parse number helper - handles commas, currency symbols, and percentages
    const parseNumber = (value) => {
      if (!value || value === '') return 0;
      // Remove currency symbols, commas, whitespace, and percentage signs
      let cleaned = value.toString().replace(/[₹$,\s%]/g, '');
      // If it was a percentage, we might want to handle it differently
      // For now, just parse as number
      const parsed = parseFloat(cleaned);
      return isNaN(parsed) ? 0 : parsed;
    };
    
    // Parse header row (row 1)
    const headerRow = parseCsvRow(lines[0] || '');
    
    // Parse summary row (row 2)
    const summaryRow = parseCsvRow(lines[1] || '');
    
    // Find column indices dynamically by matching header names (case-insensitive)
    const findColumnIndex = (headerName) => {
      const lowerHeader = headerName.toLowerCase();
      for (let i = 0; i < headerRow.length; i++) {
        const cell = (headerRow[i] || '').toLowerCase();
        if (cell.includes(lowerHeader)) {
          return i;
        }
      }
      return -1;
    };
    
    // Find column indices
    const organicLeadsIdx = findColumnIndex('Organic Leads');
    const conversionsLeadsIdx = findColumnIndex('Conversions Leads');
    const organicConversionIdx = findColumnIndex('Organic Conversion');
    const l1RevenueIdx = findColumnIndex('L1 Revenue Organic');
    const l2RevenueIdx = findColumnIndex('L2 Revenue Organic');
    const totalRevenueIdx = findColumnIndex('Total Organic Revenue');
    
    // Extract values from summary row
    const organicLeads = organicLeadsIdx >= 0 ? parseNumber(summaryRow[organicLeadsIdx] || '0') : 0;
    
    // For Organic Conversion, prefer "Organic Conversion" column, fallback to "Conversions Leads"
    let organicConversion = 0;
    if (organicConversionIdx >= 0 && summaryRow[organicConversionIdx]) {
      organicConversion = parseNumber(summaryRow[organicConversionIdx]);
    } else if (conversionsLeadsIdx >= 0) {
      organicConversion = parseNumber(summaryRow[conversionsLeadsIdx] || '0');
    }
    
    const l1Revenue = l1RevenueIdx >= 0 ? parseNumber(summaryRow[l1RevenueIdx] || '0') : 0;
    const l2Revenue = l2RevenueIdx >= 0 ? parseNumber(summaryRow[l2RevenueIdx] || '0') : 0;
    
    // For Total Revenue, prefer the column value, otherwise calculate from L1 + L2
    let totalRevenue = 0;
    if (totalRevenueIdx >= 0 && summaryRow[totalRevenueIdx]) {
      const totalValue = summaryRow[totalRevenueIdx];
      // Check if it's a percentage (e.g., "12.65%")
      if (totalValue.toString().includes('%')) {
        // If it's a percentage, calculate from L1 + L2 instead
        totalRevenue = l1Revenue + l2Revenue;
      } else {
        totalRevenue = parseNumber(totalValue);
        // If parsed value is 0 but we have revenue, use sum instead
        if (totalRevenue === 0 && (l1Revenue > 0 || l2Revenue > 0)) {
          totalRevenue = l1Revenue + l2Revenue;
        }
      }
    } else {
      // Calculate from L1 + L2 if column not found
      totalRevenue = l1Revenue + l2Revenue;
    }
    
    res.json({
      organicLeads,
      organicConversion,
      l1Revenue,
      l2Revenue,
      totalRevenue
    });
  } catch (err) {
    console.error('Error fetching Content Marketing revenue:', err.message);
    console.error('Full error:', err.response?.data || err.response?.status || err);
    
    let errorMessage = err.message;
    if (err.response?.status === 401) {
      errorMessage = 'Google Sheet is not publicly accessible. Please publish it to web.';
    } else if (err.response?.status === 403) {
      errorMessage = 'Access denied. Please share the sheet with "Anyone with the link can view".';
    }
    
    // Return zeros with error message
    res.json({
      organicLeads: 0,
      organicConversion: 0,
      l1Revenue: 0,
      l2Revenue: 0,
      totalRevenue: 0,
      error: errorMessage
    });
  }
});

// Initialize leads sync scheduler
const { startLeadsSyncScheduler, startLeadsReconcileScheduler } = require('./jobs/leadsSync');
let leadsSyncIntervalId = null;
let leadsReconcileIntervalId = null;

// Initialize insights sync scheduler (hourly, last 1.5h → DB)
const { startInsightsSyncScheduler } = require('./jobs/insightsSync');
let insightsSyncIntervalId = null;

// Initialize token refresh scheduler
const { startTokenRefreshScheduler } = require('./jobs/metaTokenRefresh');
let tokenRefreshIntervalId = null;

// Initialize story snapshots scheduler (captures stories into DB so "Top Stories by Views" has data after 24h)
const { startStorySnapshotsScheduler } = require('./jobs/storySnapshotsSync');
let storySnapshotsIntervalId = null;

// Auto-delete unique leads older than 30 days
const { startAutoDeleteScheduler } = require('./jobs/autoDeleteLeads');
let autoDeleteLeadsIntervalId = null;

// DW Leads → Google Sheet sync (every 5 min, runs on startup to push historical leads)
const { startDwLeadsGSheetSyncScheduler, runDwLeadsSync } = require('./jobs/dwLeadsGSheetSync');
let dwLeadsGSheetSyncIntervalId = null;

const PORT = process.env.PORT || 4000;

let _schedulersStarted = false;
function startSchedulers() {
  // Idempotent: never start the background intervals twice in one process
  // (would double-poll Meta and double-push leads).
  if (_schedulersStarted) {
    console.log('[Schedulers] Already started in this process — skipping.');
    return;
  }
  _schedulersStarted = true;
  console.log('[Schedulers] Starting background lead-sync schedulers…');
  try { leadsSyncIntervalId = startLeadsSyncScheduler(); } catch (e) { console.error('Error starting leads sync scheduler:', e.message); }
  // Permanent safety net: trailing-window reconcile heals any leads the incremental sync missed.
  try { leadsReconcileIntervalId = startLeadsReconcileScheduler(); } catch (e) { console.error('Error starting leads reconcile scheduler:', e.message); }
  try { insightsSyncIntervalId = startInsightsSyncScheduler(); } catch (e) { console.error('Error starting insights sync scheduler:', e.message); }
  try { tokenRefreshIntervalId = startTokenRefreshScheduler(); } catch (e) { console.error('Error starting token refresh scheduler:', e.message); }
  try { storySnapshotsIntervalId = startStorySnapshotsScheduler(); } catch (e) { console.error('Error starting story snapshots scheduler:', e.message); }
  try { autoDeleteLeadsIntervalId = startAutoDeleteScheduler(); } catch (e) { console.error('Error starting auto-delete leads scheduler:', e.message); }
  try { dwLeadsGSheetSyncIntervalId = startDwLeadsGSheetSyncScheduler(); } catch (e) { console.error('Error starting DW leads Google Sheet sync:', e.message); }
  // DW-live data sheet sync (routes/leadsSync.js). Started here rather than at
  // route-registration time so it cannot push to the live sheet from a local run.
  try { leadsSyncRoutes.startScheduler(); } catch (e) { console.error('Error starting DW-live sheet scheduler:', e.message); }
  // Cross-system drift checker: Meta vs `leads` table vs DW-live data sheet.
  try { leadsSyncRoutes.startReconcileScheduler(); } catch (e) { console.error('Error starting leads reconcile drift checker:', e.message); }
}

/**
 * Background schedulers (Meta → Google Sheet, leads → DB, insights, token refresh…)
 * must run ONLY on the always-on production server — NEVER on a developer's local
 * machine. A local `node server.js` shares the same META_ACCESS_TOKEN, Google
 * service-account key and live SPREADSHEET_ID, so if the schedulers ran locally
 * they would double-push leads into the SAME production Google Sheet and double
 * the Meta API load (this is exactly the "local start keeps syncing to the sheet"
 * problem).
 *
 * Enabled when NODE_ENV=production (Render + PM2 both set this) or when a developer
 * explicitly opts in with RUN_SCHEDULERS=true. Force-off with DISABLE_SCHEDULERS=true.
 */
function schedulersEnabled() {
  if (String(process.env.DISABLE_SCHEDULERS).toLowerCase() === 'true') return false;
  if (String(process.env.RUN_SCHEDULERS).toLowerCase() === 'true') return true;
  return process.env.NODE_ENV === 'production';
}

function startServer(retries = 3) {
  const server = app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
    if (schedulersEnabled()) {
      startSchedulers();
    } else {
      console.log(
        '[Schedulers] Skipped on this host — background syncs (Meta → Google Sheet, ' +
        'leads → DB, insights, token refresh) run only on the production server. ' +
        'This is a local/dev run, so nothing will be pushed to the live Google Sheet. ' +
        'Set RUN_SCHEDULERS=true in server/.env if you deliberately want to run them here.'
      );
    }
  });
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE' && retries > 0) {
      console.warn(`Port ${PORT} in use — retrying in 2s... (${retries} attempts left)`);
      setTimeout(() => startServer(retries - 1), 2000);
    } else {
      console.error('Server failed to start:', err.message);
      process.exit(1);
    }
  });
}

// Serve React build in production (Render / any non-Vercel host)
if (process.env.NODE_ENV === 'production') {
  const clientBuild = path.join(__dirname, '..', 'client', 'build');
  app.use(express.static(clientBuild));
  app.get('*', (req, res) => {
    res.sendFile(path.join(clientBuild, 'index.html'));
  });
}

if (require.main === module) {
  // Run directly (e.g. `node server.js`, `npm start`, or PM2): bind the port and
  // start the schedulers — this is the always-on / persistent-host path.
  startServer();
} else if (String(process.env.ENABLE_SCHEDULERS).toLowerCase() === 'true' && !process.env.VERCEL && schedulersEnabled()) {
  // App was imported by a custom server/process wrapper on a PERSISTENT host
  // (not Vercel serverless). Start the background schedulers without binding a
  // second HTTP port, so lead sync still runs continuously. Vercel is excluded
  // because setInterval cannot survive between stateless function invocations.
  // schedulersEnabled() adds the same local-machine guard as the direct-run path
  // so DISABLE_SCHEDULERS=true is always respected.
  console.log('[Schedulers] ENABLE_SCHEDULERS=true and not Vercel — starting schedulers in imported mode.');
  startSchedulers();
}
module.exports = app;
