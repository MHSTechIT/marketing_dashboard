# Run this script from PowerShell OUTSIDE Cursor (e.g. right-click project folder -> Open in Terminal, or close Cursor first).
# Fixes index.lock and runs commit.

$ErrorActionPreference = "Stop"
$repoRoot = $PSScriptRoot

Set-Location $repoRoot

# Remove stale lock so Git can run
Remove-Item "$repoRoot\.git\index.lock" -Force -ErrorAction SilentlyContinue
Remove-Item "$repoRoot\.git\index.commit.lock" -Force -ErrorAction SilentlyContinue

# Stage and commit
git add -A
git commit -m "Update Dashboards, HighFiveLanding, and ManagePermissions pages"

Write-Host "Commit completed. Pushing to origin main..."
git push origin main
Write-Host "Done."
