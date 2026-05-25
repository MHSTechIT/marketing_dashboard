# Git Setup Script for Marketing Dashboard
# Run this script in PowerShell after installing Git

Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "Git Setup for Marketing Dashboard" -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host ""

# Check if Git is installed
Write-Host "Checking Git installation..." -ForegroundColor Yellow
try {
    $gitVersion = git --version
    Write-Host "✓ Git is installed: $gitVersion" -ForegroundColor Green
} catch {
    Write-Host "✗ Git is not installed or not in PATH" -ForegroundColor Red
    Write-Host "Please install Git from: https://git-scm.com/download/win" -ForegroundColor Yellow
    Write-Host "Then restart PowerShell and run this script again." -ForegroundColor Yellow
    exit 1
}

Write-Host ""

# Navigate to project directory
$projectPath = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $projectPath

Write-Host "Project directory: $projectPath" -ForegroundColor Cyan
Write-Host ""

# Check if Git is already initialized
if (Test-Path .git) {
    Write-Host "✓ Git repository already initialized" -ForegroundColor Green
} else {
    Write-Host "Initializing Git repository..." -ForegroundColor Yellow
    git init
    if ($LASTEXITCODE -eq 0) {
        Write-Host "✓ Git repository initialized" -ForegroundColor Green
    } else {
        Write-Host "✗ Failed to initialize Git repository" -ForegroundColor Red
        exit 1
    }
}

Write-Host ""

# Check if remote exists
Write-Host "Checking remote repository..." -ForegroundColor Yellow
$remoteUrl = git remote get-url origin 2>$null

if ($remoteUrl) {
    Write-Host "✓ Remote already configured: $remoteUrl" -ForegroundColor Green
    Write-Host "Do you want to update it? (Y/N)" -ForegroundColor Yellow
    $response = Read-Host
    if ($response -eq 'Y' -or $response -eq 'y') {
        git remote set-url origin https://github.com/yuvarajamhs-creator/Marketing-Dashboard.git
        Write-Host "✓ Remote URL updated" -ForegroundColor Green
    }
} else {
    Write-Host "Adding remote repository..." -ForegroundColor Yellow
    git remote add origin https://github.com/yuvarajamhs-creator/Marketing-Dashboard.git
    if ($LASTEXITCODE -eq 0) {
        Write-Host "✓ Remote repository added" -ForegroundColor Green
    } else {
        Write-Host "✗ Failed to add remote repository" -ForegroundColor Red
    }
}

Write-Host ""

# Check Git config
Write-Host "Checking Git configuration..." -ForegroundColor Yellow
$userName = git config user.name
$userEmail = git config user.email

if ($userName -and $userEmail) {
    Write-Host "✓ Git configured:" -ForegroundColor Green
    Write-Host "  Name: $userName" -ForegroundColor Gray
    Write-Host "  Email: $userEmail" -ForegroundColor Gray
} else {
    Write-Host "⚠ Git user configuration missing" -ForegroundColor Yellow
    Write-Host "Please configure your Git user:" -ForegroundColor Yellow
    $configName = Read-Host "Enter your name"
    $configEmail = Read-Host "Enter your email"
    
    git config user.name $configName
    git config user.email $configEmail
    
    Write-Host "✓ Git configuration updated" -ForegroundColor Green
}

Write-Host ""

# Show current status
Write-Host "Current Git status:" -ForegroundColor Cyan
git status

Write-Host ""
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "Setup Complete!" -ForegroundColor Green
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Yellow
Write-Host "1. Review the files to commit (git status)" -ForegroundColor White
Write-Host "2. Add files: git add ." -ForegroundColor White
Write-Host "3. Commit: git commit -m 'Initial commit'" -ForegroundColor White
Write-Host "4. Push: git push -u origin main" -ForegroundColor White
Write-Host ""
Write-Host "For detailed instructions, see GIT_SETUP.md" -ForegroundColor Cyan

