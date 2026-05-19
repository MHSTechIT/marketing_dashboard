const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
require('dotenv').config();

const JWT_SECRET = process.env.JWT_SECRET || 'please_change_this';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';
const SALT_ROUNDS = 10;

function signToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

async function hashPassword(plain) {
  return bcrypt.hash(plain, SALT_ROUNDS);
}

async function comparePassword(plain, hash) {
  return bcrypt.compare(plain, hash);
}

function authMiddleware(req, res, next) {
  // #region agent log
  const fs = require('fs');
  const path = require('path');
  const logPath = path.join(__dirname, '..', '.cursor', 'debug.log');
  try {
    const logDir = path.dirname(logPath);
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
    const logEntry = JSON.stringify({ location: 'auth.js:21', message: 'authMiddleware called', data: { method: req.method, url: req.url, hasAuthHeader: !!req.headers.authorization, authHeaderLength: req.headers.authorization?.length }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run1', hypothesisId: 'C' }) + '\n';
    fs.appendFileSync(logPath, logEntry, 'utf8');
  } catch (e) {
    console.error('Log write failed:', e.message);
  }
  // #endregion

  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;

  // #region agent log
  try {
    const logEntry = JSON.stringify({ location: 'auth.js:30', message: 'Token extracted', data: { hasToken: !!token, tokenLength: token?.length }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run1', hypothesisId: 'C' }) + '\n';
    fs.appendFileSync(logPath, logEntry, 'utf8');
  } catch (e) { }
  // #endregion

  if (!token) {
    // #region agent log
    try {
      const logEntry = JSON.stringify({ location: 'auth.js:36', message: 'No token - returning 401', data: {}, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run1', hypothesisId: 'C' }) + '\n';
      fs.appendFileSync(logPath, logEntry, 'utf8');
    } catch (e) { }
    // #endregion
    return res.status(401).json({ error: 'Missing token' });
  }
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload;
    // #region agent log
    try {
      const logEntry = JSON.stringify({ location: 'auth.js:45', message: 'Token verified successfully', data: { userId: payload.id, email: payload.email }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run1', hypothesisId: 'C' }) + '\n';
      fs.appendFileSync(logPath, logEntry, 'utf8');
    } catch (e) { }
    // #endregion
    next();
  } catch (e) {
    // #region agent log
    try {
      const logEntry = JSON.stringify({ location: 'auth.js:52', message: 'Token verification failed', data: { errorName: e.name, errorMessage: e.message }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run1', hypothesisId: 'C' }) + '\n';
      fs.appendFileSync(logPath, logEntry, 'utf8');
    } catch (e) { }
    // #endregion
    const message = e.name === 'TokenExpiredError'
      ? 'Token expired. Please log in again.'
      : 'Invalid token';
    return res.status(401).json({ error: message });
  }
}

const optionalAuthMiddleware = (req, res, next) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    return next();
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload;
  } catch (e) {
    // Ignore invalid tokens in optional auth
  }
  next();
};

module.exports = { signToken, hashPassword, comparePassword, authMiddleware, optionalAuthMiddleware };
