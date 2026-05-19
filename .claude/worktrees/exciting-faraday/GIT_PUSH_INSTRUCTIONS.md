# Run these commands locally to finish the push

The plan was partially applied from Cursor. These steps must be run **on your machine** (PowerShell or CMD) because of environment limits.

## 1. Remove proxy (fix "127.0.0.1" / connection error)

Run:

```powershell
git config --global --unset http.proxy
git config --global --unset https.proxy
```

(If you see "no such section or key", that's fine – it means no proxy was set.)

## 2. Remove index.lock (if it appears again)

If Git says "index.lock exists", close Cursor, then run:

```powershell
Remove-Item "D:\React\App backup\1.live_Source Code\Marketing-Dashboard-main\.git\index.lock" -Force -ErrorAction SilentlyContinue
```

Then reopen the project.

## 3. Commit and push

In PowerShell or CMD:

```powershell
cd "D:\React\App backup\1.live_Source Code\Marketing-Dashboard-main"
git add -A
git commit -m "Add permissions, Meta insights sync, and dashboard updates"
git push origin main
```

---

**What was already done from Cursor:**  
- `.git/index.lock` was removed (so Git can run until something recreates it).  
- Proxy could not be changed from here (global config is outside the workspace).  
- Commit/push could not run from here (Git got "Permission denied" writing to `.git/objects`).

After you run the commands above locally, your code should commit and push. You can delete this file afterward if you want.
