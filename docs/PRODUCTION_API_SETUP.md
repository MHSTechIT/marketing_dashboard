# Fix "Network error" on Login/Signup (Production)

The Vercel deployment only serves the **React frontend** (static files). Login and signup call your **Express backend** (in `server/`). If the backend is not deployed or the frontend doesn’t know its URL, you get **"Network error — please try again"**.

## What you need

1. **Backend deployed** somewhere (Railway, Render, Fly.io, etc.).
2. **Frontend** told the backend URL via `REACT_APP_API_BASE` and **rebuilt/redeployed**.

---

## 1. Deploy the backend (Node/Express)

Deploy the `server/` folder to a host that runs Node:

- **Railway:** https://railway.app — connect repo, set root to `server`, add env vars (e.g. Supabase), deploy. Copy the public URL (e.g. `https://your-app.railway.app`).
- **Render:** https://render.com — New Web Service, connect repo, Root Directory: `server`, Build: `npm install`, Start: `node server.js`. Copy the service URL.
- **Fly.io:** https://fly.io — use a Dockerfile or `fly launch` from `server/`. Copy the app URL.

Set any env vars your server needs (e.g. Supabase URL/key, JWT secret) in that host’s dashboard.

**Important:** Use **HTTPS** for the backend URL (e.g. `https://your-api.railway.app`). No trailing slash.

---

## 2. Set `REACT_APP_API_BASE` in Vercel

1. Open **Vercel** → your project → **Settings** → **Environment Variables**.
2. Add:
   - **Name:** `REACT_APP_API_BASE`
   - **Value:** your backend URL (e.g. `https://your-app.railway.app`)
   - **Environment:** Production (and Preview if you want).
3. Save.

Create React App bakes `REACT_APP_*` in at **build time**, so you must **redeploy** the frontend after adding this variable (new deployment from Git or **Redeploy** in Vercel).

**Alternative:** Edit `client/.env.production` and set `REACT_APP_API_BASE=https://your-backend-url.com` (replace the placeholder). Commit, push, and redeploy so the build picks it up.

---

## 3. CORS on the backend

Your Express server must allow requests from the Vercel frontend origin. In `server/server.js` (or wherever CORS is set), allow your Vercel domain, for example:

```js
const cors = require("cors");
app.use(cors({
  origin: [
    "http://localhost:3000",
    "https://final-dashboard-gxau.vercel.app",
    "https://*.vercel.app"
  ],
  credentials: true
}));
```

Or for development, you can allow all origins (less secure):

```js
app.use(cors({ origin: true, credentials: true }));
```

Restart the backend after changing CORS.

---

## 4. Redeploy the frontend

- Push a new commit, or  
- In Vercel → **Deployments** → latest → **⋯** → **Redeploy**.

After the new build, the app will use `REACT_APP_API_BASE` and login/signup should work.

---

## Quick checklist

| Step | Action |
|------|--------|
| 1 | Deploy `server/` to Railway, Render, or Fly.io and copy the HTTPS URL. |
| 2 | In Vercel → Settings → Environment Variables, add `REACT_APP_API_BASE` = that URL. |
| 3 | In the backend, allow your Vercel domain in CORS. |
| 4 | Redeploy the Vercel project (new build so the env var is used). |

After that, "Network error" on login/signup should be resolved.
