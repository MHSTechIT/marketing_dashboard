const { supabase } = require('../supabase');
const { authMiddleware } = require('../auth');

/**
 * Middleware to verify that the authenticated user is an admin
 * Must be used after authMiddleware to ensure req.user is set
 */
async function adminMiddleware(req, res, next) {
  try {
    // Ensure user is authenticated (should be set by authMiddleware)
    if (!req.user || !req.user.id) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    // Get user from Supabase to check role
    const { data: user, error } = await supabase
      .from('users')
      .select('id, email, role')
      .eq('id', req.user.id)
      .maybeSingle();

    if (error) {
      console.error('Error fetching user for admin check:', error);
      return res.status(500).json({ error: 'Database error' });
    }

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Check if user is admin (role should be 'admin' or 'Admin')
    const isAdmin = user.role && (user.role.toLowerCase() === 'admin');
    
    if (!isAdmin) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    // Attach full user object to request for use in route handlers
    req.adminUser = user;
    next();
  } catch (err) {
    console.error('Admin middleware error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
}

/**
 * Combined middleware: authenticate then check admin
 * Use this for routes that require admin access
 */
function requireAdmin(req, res, next) {
  // First authenticate
  authMiddleware(req, res, () => {
    // Then check admin
    adminMiddleware(req, res, next);
  });
}

module.exports = { adminMiddleware, requireAdmin };
