# How to Start the Servers

## Important: Always run npm commands from the correct directory!

The root directory (`D:\React\App backup\Marketing Dashboard v1`) does NOT have a package.json file.
You must navigate to either `client` or `server` directory first.

## Option 1: Using PowerShell (with bypass)

### Start the Server (Backend):
```powershell
cd "D:\React\App backup\Marketing Dashboard v1\server"
powershell -ExecutionPolicy Bypass -Command "npm start"
```

### Start the Client (Frontend) - in a NEW terminal window:
```powershell
cd "D:\React\App backup\Marketing Dashboard v1\client"
powershell -ExecutionPolicy Bypass -Command "npm start"
```

## Option 2: Using Command Prompt (Easier - No execution policy issues)

### Start the Server (Backend):
```cmd
cd "D:\React\App backup\Marketing Dashboard v1\server"
npm start
```

### Start the Client (Frontend) - in a NEW terminal window:
```cmd
cd "D:\React\App backup\Marketing Dashboard v1\client"
npm start
```

## Quick Reference:
- ❌ WRONG: Running `npm start` from root directory
- ✅ CORRECT: `cd server` then `npm start`
- ✅ CORRECT: `cd client` then `npm start`

## What to expect:
- Server will start on: http://localhost:4000
- Client will start on: http://localhost:3000 (and open automatically in browser)

