// server/routes/uniqueLeads.js
const express = require('express');
const { authMiddleware } = require('../auth');
const {
  importLeads,
  getLeads,
  getDuplicates,
  deleteDuplicate,
  bulkDeleteDuplicates
} = require('../repositories/uniqueLeadsRepository');

const router = express.Router();

const MAX_ROWS = 50000;
function validateRows(rows) {
  if (!Array.isArray(rows)) return { valid: false, error: 'rows must be an array' };
  if (rows.length === 0) return { valid: false, error: 'File is empty' };
  if (rows.length > MAX_ROWS) return { valid: false, error: `Maximum ${MAX_ROWS} rows allowed` };
  const first = rows[0] || {};
  const phone = first.phoneNumber ?? first.phone;
  if (phone === undefined && first.phoneNumber === undefined && first.phone === undefined) {
    return { valid: false, error: 'Expected columns include: Date with Time, Batch Code, Phone Number, Sugar Poll, Email.' };
  }
  return { valid: true };
}

/**
 * POST /api/unique-leads/import
 * Body: { sourceType: 'paid' | 'youtube' | 'free' | 'direct_walk_in', rows: Array<Lead> }
 */
router.post('/import', authMiddleware, async (req, res) => {
  try {
    const { sourceType, rows } = req.body || {};
    if (!sourceType || !rows) {
      return res.status(400).json({ error: 'sourceType and rows are required' });
    }
    const validation = validateRows(rows);
    if (!validation.valid) {
      return res.status(400).json({ error: validation.error });
    }
    const result = await importLeads(sourceType, rows);
    return res.json(result);
  } catch (err) {
    console.error('[uniqueLeads] import error:', err);
    return res.status(500).json({ error: err.message || 'Import failed' });
  }
});

/**
 * GET /api/unique-leads/export?category=all|paid|youtube|free|direct_walk_in
 */
router.get('/export', authMiddleware, async (req, res) => {
  try {
    const category = (req.query.category || 'all').toLowerCase();
    const validCategories = ['all', 'paid', 'youtube', 'free', 'direct_walk_in', 'duplicates'];
    if (!validCategories.includes(category)) {
      return res.status(400).json({ error: 'category must be all, paid, youtube, free, or direct_walk_in' });
    }
    const data = await getLeads(category);
    return res.json(data);
  } catch (err) {
    console.error('[uniqueLeads] export error:', err);
    return res.status(500).json({ error: err.message || 'Export failed' });
  }
});

/**
 * GET /api/unique-leads/duplicates
 */
router.get('/duplicates', authMiddleware, async (req, res) => {
  try {
    const data = await getDuplicates();
    return res.json(data);
  } catch (err) {
    console.error('[uniqueLeads] duplicates error:', err);
    return res.status(500).json({ error: err.message || 'Failed to fetch duplicates' });
  }
});

/**
 * DELETE /api/unique-leads/duplicates/bulk
 * Body: { ids: number[] }
 * Must be defined BEFORE the :id route so Express doesn't match "bulk" as an id.
 */
router.delete('/duplicates/bulk', authMiddleware, async (req, res) => {
  try {
    const { ids } = req.body || {};
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'ids array is required' });
    }
    const result = await bulkDeleteDuplicates(ids.map(Number));
    return res.json(result);
  } catch (err) {
    console.error('[uniqueLeads] bulk delete error:', err);
    return res.status(500).json({ error: err.message || 'Bulk delete failed' });
  }
});

/**
 * DELETE /api/unique-leads/duplicates/:id
 */
router.delete('/duplicates/:id', authMiddleware, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid ID' });
    const result = await deleteDuplicate(id);
    return res.json(result);
  } catch (err) {
    console.error('[uniqueLeads] delete duplicate error:', err);
    return res.status(500).json({ error: err.message || 'Delete failed' });
  }
});

module.exports = router;
