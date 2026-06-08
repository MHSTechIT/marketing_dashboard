# Permanent Lead-Sync Deployment (PM2 on an always-on server)

## Why this is needed
The lead-sync schedulers (DW → Google Sheet, leads → DB, Meta token refresh, etc.)
run inside the backend process using `setInterval`. That loop only runs while the
process is **alive**.

- **Locally:** when you run `node server.js`, the sync runs. Close it → sync stops.
- **On Vercel:** functions are *serverless / stateless* — they only execute per HTTP
  request and cannot keep a background loop running. So production sync never runs there.

**Fix:** run the backend on an always-on server under **PM2**, a process manager that
keeps it running 24/7, restarts it on crash, and auto-starts it on server reboot.
The EC2 that already hosts your database (`13.202.225.50`) is the natural place —
the DB connection becomes local and there's nothing new to firewall (the schedulers
*pull* from Meta, so no inbound port is required).

---

## One-time setup (run on the server, e.g. via SSH)

### 1. Install Node.js 18+ and PM2
```bash
node -v            # need v18 or newer; install via nvm or your distro if missing
npm install -g pm2
```

### 2. Get the code onto the server
Clone the repo (or copy this project folder) to a stable path, e.g. `/opt/mhs-dashboard`.
```bash
cd /opt/mhs-dashboard          # the folder that contains ecosystem.config.js
```

### 3. Provide secrets (NOT committed to git)
- Create **`server/.env`** with the same keys you use locally
  (`DB_HOST`, `DB_NAME`, `DB_PASSWORD`, `META_*`, `GOOGLE_GEMINI_API_KEY`, the
  `GOOGLE_SHEET_ID` / `GOOGLE_SHEET_TAB`, etc.).
- Provide the **Google service-account credentials** one of these ways:
  - put the JSON at `server/credentials/google-service-account.json`, **or**
  - set `GOOGLE_SERVICE_ACCOUNT_KEY` (full JSON string) in `server/.env`, **or**
  - set `GOOGLE_SERVICE_ACCOUNT_FILE` to its path.
  The target sheet must be shared (Editor) with the service-account email.

### 4. Install dependencies (and build the UI if you also want to serve it here)
```bash
npm run build        # installs client+server deps and builds the dashboard
# (sync-only? `cd server && npm install` is enough — the schedulers don't need the UI build)
```

### 5. Start it under PM2 and make it permanent
```bash
pm2 start ecosystem.config.js
pm2 save             # remember this process list
pm2 startup          # prints a command — copy/paste & run it (usually with sudo)
                     # so PM2 relaunches automatically after a reboot
```

---

## Verify it's working
```bash
pm2 status                       # mhs-backend should be "online"
pm2 logs mhs-backend --lines 50  # look for these lines:
#   Server listening on port 4000
#   [Schedulers] Starting background lead-sync schedulers…
#   [LeadsSync] Scheduler started — 3 forms, every 5 min
#   [DWSync] Scheduler started — every 2 min.
```
Then create a test lead in Meta (or wait a cycle) and confirm a new row appears in the
**DW-live data** sheet — with no local app running.

To force an immediate sync (no waiting):
```bash
curl -X POST http://localhost:4000/api/leads-sync/sync
```

---

## Day-to-day management
| Action | Command |
|---|---|
| Check status | `pm2 status` |
| Live logs | `pm2 logs mhs-backend` |
| Restart after a code/.env change | `pm2 restart mhs-backend` |
| Stop | `pm2 stop mhs-backend` |
| Resource usage | `pm2 monit` |

---

## Important notes
- **Run ONE instance.** Don't also run `node server.js` locally at the same time as the
  PM2 instance, or both will poll Meta. (The code dedupes by lead-id + a cross-process
  file lock, so you won't get duplicate sheet rows, but one instance is correct and
  cheapest.) The PM2 config is `instances: 1, exec_mode: fork` by design.
- **Vercel stays as-is** for the frontend + on-demand dashboard API. It does not (and
  cannot) run the schedulers — that's now this PM2 server's job. Both share the same DB
  and the same Google Sheet.
- **Real-time option (optional):** the Meta Leadgen *webhook* (`POST /api/leads-sync/webhook`)
  delivers each lead instantly. If you make this server publicly reachable (HTTPS) and
  point the webhook at it in the Meta App Dashboard (verify token = `META_WEBHOOK_VERIFY_TOKEN`),
  leads sync the moment they're submitted; the 5-minute poll then just backs it up.
- **Security:** keep `server/.env` and the Google credentials out of git. They contain
  live tokens, the DB password, and API keys.
