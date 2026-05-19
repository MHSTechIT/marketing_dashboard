import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import PermissionToggle from '../components/PermissionToggle';
import './ManagePermissions.css';

const API_BASE = process.env.REACT_APP_API_BASE || 'http://localhost:4000';

export default function ManagePermissions() {
  const { userId } = useParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);
  const [permissions, setPermissions] = useState({
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
  });

  // Get auth token from localStorage
  const getAuthToken = () => {
    try {
      const authData = localStorage.getItem(process.env.REACT_APP_STORAGE_KEY || "app_auth");
      if (authData) {
        const parsed = JSON.parse(authData);
        return parsed.token;
      }
    } catch (e) {
      console.error('Error getting auth token:', e);
    }
    return null;
  };

  // Fetch current user info
  useEffect(() => {
    const fetchCurrentUser = async () => {
      const token = getAuthToken();
      if (!token) {
        navigate('/login');
        return;
      }

      try {
        const res = await fetch(`${API_BASE}/api/auth/me`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (res.ok) {
          const user = await res.json();
          setCurrentUser(user);
        }
      } catch (err) {
        console.error('Error fetching current user:', err);
      }
    };

    fetchCurrentUser();
  }, [navigate]);

  // Fetch permissions and target user info
  useEffect(() => {
    const fetchData = async () => {
      const token = getAuthToken();
      if (!token) return;

      setLoading(true);
      try {
        // Fetch permissions
        const permRes = await fetch(`${API_BASE}/api/permissions/${userId}`, {
          headers: { Authorization: `Bearer ${token}` }
        });

        if (permRes.ok) {
          const permData = await permRes.json();
          setPermissions(permData);
        } else if (permRes.status === 403) {
          alert('Access denied');
          navigate('/team-management');
          return;
        }

        // Note: In a real app, you'd fetch target user via GET /api/users/:userId
        // For now we use userId from params for display

      } catch (err) {
        console.error('Error fetching data:', err);
        alert('Failed to load permissions');
      } finally {
        setLoading(false);
      }
    };

    if (userId) {
      fetchData();
    }
  }, [userId, navigate]);

  const isAdmin = currentUser?.role?.toLowerCase() === 'admin';
  const isViewingOwnPermissions = parseInt(userId) === currentUser?.id;
  const isReadOnly = !isAdmin && !isViewingOwnPermissions;
  
  // If admin viewing own permissions, set all to true
  useEffect(() => {
    if (isAdmin && isViewingOwnPermissions) {
      setPermissions({
        dashboard: true,
        dashboard_admin_leads: true,
        dashboard_content_marketing: true,
        best_ads: true,
        best_reels: true,
        plan_view: true,
        plan_edit: true,
        audience_view: true,
        audience_edit: true,
        audience_export: true,
        ai_insights: true,
        settings: true,
        meta_settings: true,
        team_management: true
      });
    }
  }, [isAdmin, isViewingOwnPermissions]);

  // Handle permission toggle
  const handleToggle = (key) => {
    if (isReadOnly) return; // Don't allow changes in read-only mode

    setPermissions(prev => {
      const newPerms = { ...prev, [key]: !prev[key] };

      // Parent-child logic
      if (key === 'dashboard') {
        if (!newPerms.dashboard) {
          // Parent OFF → all children OFF
          newPerms.dashboard_admin_leads = false;
          newPerms.dashboard_content_marketing = false;
        }
      } else if (key === 'settings') {
        if (!newPerms.settings) {
          // Parent OFF → all children OFF
          newPerms.meta_settings = false;
          newPerms.team_management = false;
        }
      } else if (key === 'dashboard_admin_leads' || key === 'dashboard_content_marketing') {
        // If any child is ON, parent must be ON
        if (newPerms.dashboard_admin_leads || newPerms.dashboard_content_marketing) {
          newPerms.dashboard = true;
        }
      } else if (key === 'meta_settings' || key === 'team_management') {
        // If any child is ON, parent must be ON
        if (newPerms.meta_settings || newPerms.team_management) {
          newPerms.settings = true;
        }
      }

      return newPerms;
    });
  };

  // Handle save
  const handleSave = async () => {
    if (isReadOnly) return;

    const token = getAuthToken();
    if (!token) {
      alert('Not authenticated');
      return;
    }

    setSaving(true);
    try {
      const res = await fetch(`${API_BASE}/api/permissions/update`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          userId: parseInt(userId),
          permissions
        })
      });

      if (res.ok) {
        await res.json();
        alert('Permissions saved successfully!');
        // Optionally navigate back
        // navigate('/team-management');
      } else if (res.status === 403) {
        alert('You do not have permission to update permissions. Admin access is required.');
      } else if (res.status === 404) {
        const errorData = await res.json().catch(() => ({}));
        const errorMessage = errorData.error || 'User not found';
        const hint = errorData.hint || 'Please refresh the team management page and try again.';
        alert(`${errorMessage}\n\n${hint}`);
      } else {
        // Try to get detailed error message
        let errorMessage = 'Failed to save permissions';
        let hint = '';
        
        try {
          const errorData = await res.json();
          errorMessage = errorData.error || errorMessage;
          hint = errorData.hint || '';
          
          // Log detailed error for debugging
          console.error('Error saving permissions:', {
            status: res.status,
            statusText: res.statusText,
            error: errorData.error,
            code: errorData.code,
            details: errorData.details,
            hint: errorData.hint,
            userId: userId,
            fullResponse: errorData
          });
          
          // Build user-friendly error message
          let fullMessage = errorMessage;
          if (hint) {
            fullMessage += `\n\n${hint}`;
          }
          
          alert(fullMessage);
        } catch (parseError) {
          console.error('Error parsing error response:', parseError);
          alert(`Failed to save permissions (Status: ${res.status}). Please check the console for details.`);
        }
      }
    } catch (err) {
      console.error('Error saving permissions:', err);
      alert('Failed to save permissions');
    } finally {
      setSaving(false);
    }
  };

  // Check if child is disabled
  const isChildDisabled = (parentKey) => {
    if (isReadOnly) return true;
    return !permissions[parentKey];
  };

  if (loading) {
    return (
      <div className="manage-permissions-container">
        <div className="loading-spinner">Loading...</div>
      </div>
    );
  }

  return (
    <div className="manage-permissions-container">
      <div className="permissions-header">
        <h1 className="permissions-title">Manage Permissions</h1>
        <button className="btn-back" onClick={() => navigate('/team-management')}>
          ← Back to Team
        </button>
      </div>

      <div className="permissions-content">
        {/* Dashboard Section */}
        <div className="permission-section">
          <h2 className="permission-section-title">Dashboard</h2>
          <div className="permission-item">
            <PermissionToggle
              label="Access Dashboard"
              checked={permissions.dashboard}
              onChange={() => handleToggle('dashboard')}
              disabled={isReadOnly}
            />
          </div>
          <div className="permission-item permission-item-child">
            <PermissionToggle
              label="Total Leads Admin View table - Admin View"
              checked={permissions.dashboard_admin_leads}
              onChange={() => handleToggle('dashboard_admin_leads')}
              disabled={isChildDisabled('dashboard')}
            />
          </div>
          <div className="permission-item permission-item-child">
            <PermissionToggle
              label="Content Marketing - Dashboard"
              checked={permissions.dashboard_content_marketing}
              onChange={() => handleToggle('dashboard_content_marketing')}
              disabled={isChildDisabled('dashboard')}
            />
          </div>
        </div>

        {/* Best Performing Ad Section */}
        <div className="permission-section">
          <h2 className="permission-section-title">Best Performing Ad</h2>
          <div className="permission-item">
            <PermissionToggle
              label="View Best Performing Ad"
              checked={permissions.best_ads}
              onChange={() => handleToggle('best_ads')}
              disabled={isReadOnly}
            />
          </div>
        </div>

        {/* Best Performing Reel Section */}
        <div className="permission-section">
          <h2 className="permission-section-title">Best Performing Reel</h2>
          <div className="permission-item">
            <PermissionToggle
              label="View Best Performing Reel"
              checked={permissions.best_reels}
              onChange={() => handleToggle('best_reels')}
              disabled={isReadOnly}
            />
          </div>
        </div>

        {/* Plan Section */}
        <div className="permission-section">
          <h2 className="permission-section-title">Plan</h2>
          <div className="permission-item">
            <PermissionToggle
              label="View Plan"
              checked={permissions.plan_view}
              onChange={() => handleToggle('plan_view')}
              disabled={isReadOnly}
            />
          </div>
          <div className="permission-item">
            <PermissionToggle
              label="Create / Edit Plan"
              checked={permissions.plan_edit}
              onChange={() => handleToggle('plan_edit')}
              disabled={isReadOnly}
            />
          </div>
        </div>

        {/* Audience Section */}
        <div className="permission-section">
          <h2 className="permission-section-title">Audience</h2>
          <div className="permission-item">
            <PermissionToggle
              label="View Audience"
              checked={permissions.audience_view}
              onChange={() => handleToggle('audience_view')}
              disabled={isReadOnly}
            />
          </div>
          <div className="permission-item">
            <PermissionToggle
              label="Create / Edit Audience"
              checked={permissions.audience_edit}
              onChange={() => handleToggle('audience_edit')}
              disabled={isReadOnly}
            />
          </div>
          <div className="permission-item">
            <PermissionToggle
              label="Export Audience"
              checked={permissions.audience_export}
              onChange={() => handleToggle('audience_export')}
              disabled={isReadOnly}
            />
          </div>
        </div>

        {/* AI Insights Section */}
        <div className="permission-section">
          <h2 className="permission-section-title">AI Insights</h2>
          <div className="permission-item">
            <PermissionToggle
              label="View AI Insights"
              checked={permissions.ai_insights}
              onChange={() => handleToggle('ai_insights')}
              disabled={isReadOnly}
            />
          </div>
        </div>

        {/* Settings Section - Admin Only */}
        {isAdmin && (
          <div className="permission-section">
            <h2 className="permission-section-title">Settings (ADMIN ONLY)</h2>
            <div className="permission-item">
              <PermissionToggle
                label="Access Settings"
                checked={permissions.settings}
                onChange={() => handleToggle('settings')}
                disabled={isReadOnly}
              />
            </div>
            <div className="permission-item permission-item-child">
              <PermissionToggle
                label="Meta Settings"
                checked={permissions.meta_settings}
                onChange={() => handleToggle('meta_settings')}
                disabled={isChildDisabled('settings')}
              />
            </div>
            <div className="permission-item permission-item-child">
              <PermissionToggle
                label="Team Management"
                checked={permissions.team_management}
                onChange={() => handleToggle('team_management')}
                disabled={isChildDisabled('settings')}
              />
            </div>
          </div>
        )}
      </div>

      {/* Sticky Save Button */}
      {!isReadOnly && (
        <div className="permissions-footer">
          <button
            className="btn-save-permissions"
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      )}
    </div>
  );
}
