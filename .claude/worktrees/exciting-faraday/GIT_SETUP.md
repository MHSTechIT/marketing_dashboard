# GitHub Integration Setup Guide

This guide will help you set up Git version control and connect your repository to GitHub.

## Prerequisites

1. **Install Git** (if not already installed):
   - Download from: https://git-scm.com/download/win
   - During installation, choose "Git from the command line and also from 3rd-party software"
   - Restart your terminal/command prompt after installation

2. **Verify Git Installation**:
   ```bash
   git --version
   ```

## Setup Steps

### Step 1: Initialize Git Repository (if not already initialized)

Open PowerShell or Command Prompt in the project directory:

```bash
cd "D:\React\App backup\Marketing Dashboard"
git init
```

### Step 2: Add Remote Repository

```bash
git remote add origin https://github.com/yuvarajamhs-creator/Marketing-Dashboard.git
```

If the remote already exists, update it:
```bash
git remote set-url origin https://github.com/yuvarajamhs-creator/Marketing-Dashboard.git
```

Verify the remote:
```bash
git remote -v
```

### Step 3: Configure Git (if not already configured)

Set your name and email:
```bash
git config user.name "Your Name"
git config user.email "your.email@example.com"
```

### Step 4: Check Current Status

```bash
git status
```

### Step 5: Add Files to Git

Add all files (the .gitignore will exclude node_modules, .env, etc.):
```bash
git add .
```

Or add files selectively:
```bash
git add client/
git add server/
git add .gitignore
git add README.md
```

### Step 6: Make Your First Commit

```bash
git commit -m "Initial commit: Marketing Dashboard application"
```

### Step 7: Push to GitHub

If this is the first push:
```bash
git branch -M main
git push -u origin main
```

If the repository already has content:
```bash
git pull origin main --allow-unrelated-histories
git push -u origin main
```

## Common Git Commands

### Daily Workflow

**Check status:**
```bash
git status
```

**Add changes:**
```bash
git add .
# or specific files
git add client/src/pages/Dashboards.jsx
```

**Commit changes:**
```bash
git commit -m "Description of your changes"
```

**Push to GitHub:**
```bash
git push origin main
```

**Pull latest changes:**
```bash
git pull origin main
```

### Branching (Recommended for features)

**Create a new branch:**
```bash
git checkout -b feature/your-feature-name
```

**Switch branches:**
```bash
git checkout main
git checkout feature/your-feature-name
```

**Merge branch:**
```bash
git checkout main
git merge feature/your-feature-name
```

### Viewing History

**View commit history:**
```bash
git log
git log --oneline
```

**View file changes:**
```bash
git diff
git diff filename.js
```

## Troubleshooting

### If you get authentication errors:

1. **Use Personal Access Token** (GitHub no longer accepts passwords):
   - Go to GitHub → Settings → Developer settings → Personal access tokens
   - Generate a new token with `repo` permissions
   - Use the token as your password when pushing

2. **Or use SSH instead**:
   ```bash
   git remote set-url origin git@github.com:yuvarajamhs-creator/Marketing-Dashboard.git
   ```

### If remote already exists:
```bash
git remote remove origin
git remote add origin https://github.com/yuvarajamhs-creator/Marketing-Dashboard.git
```

### If you need to undo changes:

**Unstage files:**
```bash
git reset HEAD filename
```

**Discard local changes:**
```bash
git checkout -- filename
```

**Undo last commit (keep changes):**
```bash
git reset --soft HEAD~1
```

## Recommended Workflow

1. **Before starting work:**
   ```bash
   git pull origin main
   ```

2. **During development:**
   ```bash
   git add .
   git commit -m "Feature: Add new functionality"
   ```

3. **After completing a feature:**
   ```bash
   git push origin main
   ```

4. **For major changes, use branches:**
   ```bash
   git checkout -b feature/major-update
   # Make changes
   git add .
   git commit -m "Major update description"
   git push origin feature/major-update
   # Then create a Pull Request on GitHub
   ```

## Next Steps

1. Install Git if not already installed
2. Follow the setup steps above
3. Consider setting up:
   - GitHub Actions for CI/CD
   - Branch protection rules on GitHub
   - Issue templates
   - Pull request templates

## Need Help?

- Git documentation: https://git-scm.com/doc
- GitHub Guides: https://guides.github.com/
- GitHub Desktop (GUI alternative): https://desktop.github.com/

