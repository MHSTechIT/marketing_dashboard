const express = require('express');
const router = express.Router();
const { supabase } = require('../supabase');
const { authMiddleware } = require('../auth');
const { requireAdmin } = require('../middleware/adminMiddleware');

/**
 * GET /api/permissions/:userId
 * Get permissions for a specific user
 * Accessible to: Admin users or the user themselves
 */
router.get('/:userId', authMiddleware, async (req, res) => {
  try {
    const targetUserId = parseInt(req.params.userId);
    const currentUserId = req.user.id;

    if (isNaN(targetUserId)) {
      return res.status(400).json({ error: 'Invalid user ID' });
    }

    // Check if current user is admin or accessing their own permissions
    const { data: currentUser } = await supabase
      .from('users')
      .select('role')
      .eq('id', currentUserId)
      .maybeSingle();

    const isAdmin = currentUser?.role?.toLowerCase() === 'admin';
    const isOwnPermissions = currentUserId === targetUserId;

    if (!isAdmin && !isOwnPermissions) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Fetch permissions from database
    const { data: permissions, error } = await supabase
      .from('user_permissions')
      .select('*')
      .eq('user_id', targetUserId)
      .maybeSingle();

    if (error) {
      console.error('Error fetching permissions:', error);
      let errorMessage = 'Database error while fetching permissions';
      let hint = 'Please try again or contact support';
      
      if (error.code === 'PGRST116') {
        errorMessage = 'User permissions table not found in database';
        hint = 'Please create the user_permissions table. Run the SQL from server/supabase-complete-schema.sql in your Supabase SQL Editor';
      } else if (error.message?.includes('schema cache')) {
        errorMessage = 'Schema cache needs to be refreshed';
        hint = 'Go to Supabase Dashboard → Settings → API → Click "Reload schema" and wait 10-30 seconds';
      }
      
      return res.status(500).json({ 
        error: errorMessage,
        code: error.code,
        details: error.message,
        hint: hint
      });
    }

    // If no permissions exist, return default (all false)
    if (!permissions) {
      const defaultPermissions = {
        dashboard: false,
        dashboard_admin_leads: false,
        dashboard_content_marketing: false,
        best_ads: false,
        best_reels: false,
        plan_view: false,
        plan_edit: false,
        audience_view: false,
        audience_edit: false,
        audience_export: false,
        ai_insights: false,
        settings: false,
        meta_settings: false,
        team_management: false
      };
      return res.json(defaultPermissions);
    }

    // Remove internal fields before sending
    const { user_id, created_at, updated_at, ...permissionData } = permissions;
    res.json(permissionData);
  } catch (err) {
    console.error('Get permissions error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * POST /api/permissions/update
 * Update permissions for a user
 * Accessible to: Admin users only
 * Body: { userId: number, permissions: { ... } }
 */
router.post('/update', requireAdmin, async (req, res) => {
  try {
    const { userId, permissions } = req.body;

    if (!userId || !permissions) {
      return res.status(400).json({ error: 'userId and permissions are required' });
    }

    const targetUserId = parseInt(userId);
    if (isNaN(targetUserId)) {
      return res.status(400).json({ error: 'Invalid user ID' });
    }

    // Validate permission keys
    const validKeys = [
      'dashboard',
      'dashboard_admin_leads',
      'dashboard_content_marketing',
      'best_ads',
      'best_reels',
      'plan_view',
      'plan_edit',
      'audience_view',
      'audience_edit',
      'audience_export',
      'ai_insights',
      'settings',
      'meta_settings',
      'team_management'
    ];

    // Filter to only valid keys and ensure boolean values
    const sanitizedPermissions = {};
    for (const key of validKeys) {
      if (key in permissions) {
        sanitizedPermissions[key] = Boolean(permissions[key]);
      }
    }

    // Check if user exists
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('id, role')
      .eq('id', targetUserId)
      .maybeSingle();

    if (userError) {
      console.error('Error checking user:', userError);
      let errorMessage = 'Database error while checking user';
      let hint = 'Please try again or contact support';
      
      if (userError.code === 'PGRST116') {
        errorMessage = 'Users table not found in database';
        hint = 'Please create the users table. Run the SQL from server/supabase-complete-schema.sql in your Supabase SQL Editor';
      } else if (userError.message?.includes('schema cache')) {
        errorMessage = 'Schema cache needs to be refreshed';
        hint = 'Go to Supabase Dashboard → Settings → API → Click "Reload schema" and wait 10-30 seconds';
      }
      
      return res.status(500).json({ 
        error: errorMessage,
        code: userError.code,
        details: userError.message,
        hint: hint
      });
    }

    if (!user) {
      return res.status(404).json({ 
        error: 'User not found',
        hint: 'The user may have been deleted. Please refresh the team management page.'
      });
    }

    // Check if permissions record exists
    const { data: existingPermissions, error: checkError } = await supabase
      .from('user_permissions')
      .select('user_id')
      .eq('user_id', targetUserId)
      .maybeSingle();

    if (checkError) {
      console.error('Error checking existing permissions:', checkError);
      let errorMessage = 'Database error while checking permissions';
      let hint = 'Please try again or contact support';
      
      if (checkError.code === 'PGRST116') {
        errorMessage = 'User permissions table not found in database';
        hint = 'Please create the user_permissions table. Run the SQL from server/supabase-complete-schema.sql in your Supabase SQL Editor';
      } else if (checkError.message?.includes('schema cache')) {
        errorMessage = 'Schema cache needs to be refreshed';
        hint = 'Go to Supabase Dashboard → Settings → API → Click "Reload schema" and wait 10-30 seconds';
      }
      
      return res.status(500).json({ 
        error: errorMessage,
        code: checkError.code,
        details: checkError.message,
        hint: hint
      });
    }

    let result;
    if (existingPermissions) {
      // Update existing permissions
      const { data, error } = await supabase
        .from('user_permissions')
        .update({
          ...sanitizedPermissions,
          updated_at: new Date().toISOString()
        })
        .eq('user_id', targetUserId)
        .select()
        .single();

      if (error) {
        console.error('Error updating permissions:', error);
        let errorMessage = 'Failed to update permissions';
        let hint = 'Please try again or contact support';
        
        if (error.code === 'PGRST116') {
          errorMessage = 'User permissions table not found in database';
          hint = 'Please create the user_permissions table. Run the SQL from server/supabase-complete-schema.sql in your Supabase SQL Editor';
        } else if (error.code === '23503') {
          errorMessage = 'Invalid user reference';
          hint = 'The user may have been deleted. Please refresh the team management page.';
        } else if (error.message?.includes('schema cache')) {
          errorMessage = 'Schema cache needs to be refreshed';
          hint = 'Go to Supabase Dashboard → Settings → API → Click "Reload schema" and wait 10-30 seconds';
        }
        
        return res.status(500).json({ 
          error: errorMessage,
          code: error.code,
          details: error.message,
          hint: hint
        });
      }
      result = data;
    } else {
      // Insert new permissions
      const { data, error } = await supabase
        .from('user_permissions')
        .insert({
          user_id: targetUserId,
          ...sanitizedPermissions
        })
        .select()
        .single();

      if (error) {
        console.error('Error creating permissions:', error);
        let errorMessage = 'Failed to create permissions';
        let hint = 'Please try again or contact support';
        
        if (error.code === 'PGRST116') {
          errorMessage = 'User permissions table not found in database';
          hint = 'Please create the user_permissions table. Run the SQL from server/supabase-complete-schema.sql in your Supabase SQL Editor';
        } else if (error.code === '23503') {
          errorMessage = 'Invalid user reference (foreign key violation)';
          hint = 'The user may have been deleted or the user_id is invalid. Please refresh the team management page.';
        } else if (error.code === '23505') {
          errorMessage = 'Permissions already exist for this user';
          hint = 'Try refreshing the page. The permissions may have been created by another process.';
        } else if (error.message?.includes('schema cache')) {
          errorMessage = 'Schema cache needs to be refreshed';
          hint = 'Go to Supabase Dashboard → Settings → API → Click "Reload schema" and wait 10-30 seconds';
        } else if (error.message) {
          errorMessage = `Failed to create permissions: ${error.message}`;
        }
        
        return res.status(500).json({ 
          error: errorMessage,
          code: error.code,
          details: error.message,
          hint: hint
        });
      }
      result = data;
    }

    // Remove internal fields before sending
    const { user_id, created_at, updated_at, ...permissionData } = result;
    res.json({
      success: true,
      permissions: permissionData
    });
  } catch (err) {
    console.error('Update permissions error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
