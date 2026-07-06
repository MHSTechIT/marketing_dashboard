/**
 * PM2 process configuration.
 *
 * Keeps the backend — and therefore the lead-sync schedulers (DW → Google Sheet,
 * leads → DB, token refresh, etc.) — running 24/7 on an always-on server,
 * independent of any local machine, browser session, or the app being open.
 *
 * The schedulers run on a PERSISTENT process only. They CANNOT run on Vercel
 * (serverless, stateless per request), which is why production sync stops when
 * the local `node server.js` is closed. Run this on your always-on server
 * (e.g. the EC2 that hosts the database) and the sync continues forever.
 *
 * ── First-time setup (on the server) ──────────────────────────────────────────
 *   npm install -g pm2
 *   cd <repo>                       # this folder (contains ecosystem.config.js)
 *   npm run build                   # installs client+server deps & builds the UI
 *   #  └─ ensure server/.env exists, and the Google service-account credentials
 *   #     (server/credentials/google-service-account.json OR the env key) are present
 *   pm2 start ecosystem.config.js
 *   pm2 save                        # remember this process across reboots
 *   pm2 startup                     # prints a command — run it (with sudo) once,
 *                                   # so PM2 auto-starts on server boot
 *
 * ── Day-to-day ────────────────────────────────────────────────────────────────
 *   pm2 status                      # is it running?
 *   pm2 logs mhs-backend            # live logs — look for [DWSync] / [LeadsSync]
 *   pm2 restart mhs-backend         # after a code/.env change
 *   pm2 stop mhs-backend
 */
module.exports = {
  apps: [
    {
      name: 'mhs-backend',
      script: 'server/server.js',
      cwd: __dirname,

      // Single instance ONLY. The schedulers must never be duplicated, or every
      // lead would be processed by multiple workers (the code dedupes, but one
      // worker is correct and cheapest).
      instances: 1,
      exec_mode: 'fork',

      // Resilience: restart on crash and on memory bloat; survive reboots (with
      // `pm2 save` + `pm2 startup`). A single background-job error can never take
      // the sync down permanently.
      autorestart: true,
      max_restarts: 20,
      min_uptime: '15s',
      max_memory_restart: '700M',
      watch: false,

      env: {
        NODE_ENV: 'production',
        PORT: 4000,
        // Belt-and-suspenders: force the schedulers on even if a future deploy
        // imports the app instead of running it directly.
        ENABLE_SCHEDULERS: 'true',
        // Explicitly opt this always-on server into the background sync schedulers.
        // Local/dev machines leave RUN_SCHEDULERS unset, so `node server.js` there
        // never pushes leads to the live Google Sheet.
        RUN_SCHEDULERS: 'true',
      },

      // Timestamped logs under <repo>/logs
      out_file: './logs/pm2-out.log',
      error_file: './logs/pm2-error.log',
      merge_logs: true,
      time: true,
    },
  ],
};
