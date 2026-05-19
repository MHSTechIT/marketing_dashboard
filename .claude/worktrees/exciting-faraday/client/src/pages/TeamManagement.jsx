import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import "./TeamManagement.css";

const API_BASE = process.env.REACT_APP_API_BASE || "http://localhost:4000";

// Helper to get auth token from localStorage
const getAuthToken = () => {
  try {
    // Try multiple storage keys that might be used
    const storageKeys = [
      process.env.REACT_APP_STORAGE_KEY || "app_auth",
      "59ca69f53c01829c41b079fb15fb5b9bc7ed726f15afdc9da7e57f83543fca15a06130d30bbf6744243d936c7b19d494353d7a55e742b0404ebd6c4704efd50c",
      "ads_dashboard_auth"
    ];
    
    for (const key of storageKeys) {
      const authData = localStorage.getItem(key);
      if (authData) {
        const parsed = JSON.parse(authData);
        if (parsed.token) {
          return parsed.token;
        }
      }
    }
  } catch (e) {
    console.error('Error getting auth token:', e);
  }
  return null;
};

export default function TeamManagement() {
  const navigate = useNavigate();
  
  const [teamMembers, setTeamMembers] = useState([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [showAddModal, setShowAddModal] = useState(false);
  const [showPermissionsModal, setShowPermissionsModal] = useState(false);
  const [selectedMember, setSelectedMember] = useState(null);
  const [editingMember, setEditingMember] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [formData, setFormData] = useState({
    name: "",
    country: "INDIA",
    phone: "",
    email: "",
    type: "Restricted",
    password: "",
    confirmPassword: ""
  });
  const [selectedService, setSelectedService] = useState("All memberships");

  // Fetch users from database
  const fetchUsers = async () => {
    const token = getAuthToken();
    if (!token) {
      setError("Please log in to view team members");
      return;
    }

    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${API_BASE}/api/users`, {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        }
      });

      if (res.status === 401) {
        setError("Session expired. Please log in again.");
        navigate("/login");
        return;
      }

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || "Failed to fetch users");
      }

      const users = await res.json();
      setTeamMembers(users);
    } catch (err) {
      console.error("Error fetching users:", err);
      setError(err.message || "Failed to load team members");
    } finally {
      setLoading(false);
    }
  };

  // Fetch users on component mount
  useEffect(() => {
    fetchUsers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Filter team members based on search query
  const filteredMembers = teamMembers.filter(member =>
    member.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (member.phone && member.phone.includes(searchQuery)) ||
    member.email.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Copy to clipboard function
  const copyToClipboard = (text, type) => {
    navigator.clipboard.writeText(text).then(() => {
      // You could add a toast notification here
      console.log(`${type} copied to clipboard`);
    });
  };

  // Handle add new member
  const handleAddMember = () => {
    setEditingMember(null);
    setError("");
    setFormData({
      name: "",
      country: "INDIA",
      phone: "",
      email: "",
      type: "Restricted",
      password: "",
      confirmPassword: ""
    });
    setShowAddModal(true);
  };

  // Handle edit member
  const handleEditMember = (member) => {
    setEditingMember(member);
    setError("");
    setFormData({
      name: member.name || "",
      country: member.country || "INDIA",
      phone: member.phone || "",
      email: member.email || "",
      type: member.type || "Restricted",
      password: "",
      confirmPassword: ""
    });
    setShowAddModal(true);
  };

  // Handle delete member
  const handleDeleteMember = async (id) => {
    if (!window.confirm("Are you sure you want to delete this team member?")) {
      return;
    }

    const token = getAuthToken();
    if (!token) {
      setError("Please log in to delete team members");
      return;
    }

    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${API_BASE}/api/users/${id}`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        }
      });

      if (res.status === 401) {
        setError("Session expired. Please log in again.");
        navigate("/login");
        return;
      }

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || "Failed to delete user");
      }

      // Refresh the user list
      await fetchUsers();
    } catch (err) {
      console.error("Error deleting user:", err);
      setError(err.message || "Failed to delete team member");
    } finally {
      setLoading(false);
    }
  };

  // Handle manage permissions
  const handleManagePermissions = (member) => {
    navigate(`/manage-permissions/${member.id}`);
  };

  // Handle save member (add or edit)
  const handleSaveMember = async () => {
    // Validation
    if (!formData.name || !formData.email) {
      setError("Please fill in name and email");
      return;
    }

    // For new users, password is required
    if (!editingMember) {
      if (!formData.password) {
        setError("Password is required for new users");
        return;
      }
      if (formData.password !== formData.confirmPassword) {
        setError("Passwords do not match");
        return;
      }
    }

    // If password is provided during edit, confirmPassword must match
    if (editingMember && formData.password) {
      if (formData.password !== formData.confirmPassword) {
        setError("Passwords do not match");
        return;
      }
    }

    const token = getAuthToken();
    if (!token) {
      setError("Please log in to save team members");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const requestBody = {
        email: formData.email,
        fullName: formData.name,
        role: formData.type
      };

      // Include password only if provided
      if (formData.password) {
        requestBody.password = formData.password;
      }

      let res;
      if (editingMember) {
        // Update existing user
        res = await fetch(`${API_BASE}/api/users/${editingMember.id}`, {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify(requestBody)
        });
      } else {
        // Create new user
        res = await fetch(`${API_BASE}/api/users`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify(requestBody)
        });
      }

      if (res.status === 401) {
        setError("Session expired. Please log in again.");
        navigate("/login");
        return;
      }

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || "Failed to save user");
      }

      // Refresh the user list
      await fetchUsers();

      // Close modal and reset form
      setShowAddModal(false);
      setEditingMember(null);
      setFormData({
        name: "",
        country: "INDIA",
        phone: "",
        email: "",
        type: "Restricted",
        password: "",
        confirmPassword: ""
      });
    } catch (err) {
      console.error("Error saving user:", err);
      setError(err.message || "Failed to save team member");
    } finally {
      setLoading(false);
    }
  };

  // Handle save permissions
  const handleSavePermissions = () => {
    // Handle permissions save logic here
    console.log("Saving permissions for", selectedMember, "with service", selectedService);
    setShowPermissionsModal(false);
    setSelectedMember(null);
  };

  return (
    <div className="team-management-container">
      {/* Header */}
      <div className="team-header">
        <h1 className="team-title">Team Members</h1>
        <button className="btn-add-member" onClick={handleAddMember} disabled={loading}>
          <span className="plus-icon">+</span> Add new member
        </button>
      </div>

      {/* Error Message */}
      {error && (
        <div style={{ 
          padding: "12px", 
          margin: "16px 0", 
          backgroundColor: "#fee", 
          color: "#c33", 
          borderRadius: "4px" 
        }}>
          {error}
        </div>
      )}

      {/* Search Bar */}
      <div className="search-container">
        <div className="search-input-wrapper">
          <span className="search-icon">🔍</span>
          <input
            type="text"
            className="search-input"
            placeholder="Search by name, phone, email"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      {/* Team Members Table */}
      <div className="table-container">
        {loading && teamMembers.length === 0 ? (
          <div style={{ padding: "40px", textAlign: "center" }}>Loading team members...</div>
        ) : (
          <table className="team-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Contact</th>
                <th>Type</th>
                <th>Created On</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredMembers.length === 0 ? (
                <tr>
                  <td colSpan="5" style={{ textAlign: "center", padding: "40px" }}>
                    {teamMembers.length === 0 ? "No team members found" : "No results match your search"}
                  </td>
                </tr>
              ) : (
                filteredMembers.map((member) => (
              <tr key={member.id}>
                <td>
                  <div className="member-name-cell">
                    <div className="member-name">{member.name || "N/A"}</div>
                    {member.country && (
                      <div className="member-country">
                        <span className="flag-icon">🇮🇳</span> {member.country}
                      </div>
                    )}
                  </div>
                </td>
                <td>
                  <div className="contact-cell">
                    {member.phone && (
                      <div className="contact-item">
                        <span className="contact-value">{member.phone}</span>
                        <button
                          className="copy-btn"
                          onClick={() => copyToClipboard(member.phone, "Phone")}
                          title="Copy phone number"
                        >
                          📋
                        </button>
                      </div>
                    )}
                    <div className="contact-item">
                      <span className="contact-value">{member.email}</span>
                      <button
                        className="copy-btn"
                        onClick={() => copyToClipboard(member.email, "Email")}
                        title="Copy email"
                      >
                        📋
                      </button>
                    </div>
                  </div>
                </td>
                <td>
                  <span className={`type-badge ${member.type.toLowerCase()}`}>
                    {member.type}
                  </span>
                </td>
                <td>{member.createdOn}</td>
                <td>
                  <div className="action-buttons">
                    <button
                      className="btn-manage-permissions"
                      onClick={() => handleManagePermissions(member)}
                    >
                      Manage permissions
                    </button>
                    <button
                      className="btn-action btn-edit"
                      onClick={() => handleEditMember(member)}
                      title="Edit"
                      disabled={loading}
                    >
                      ✏️
                    </button>
                    <button
                      className="btn-action btn-delete"
                      onClick={() => handleDeleteMember(member.id)}
                      title="Delete"
                      disabled={loading}
                    >
                      🗑️
                    </button>
                  </div>
                </td>
              </tr>
                ))
              )}
            </tbody>
          </table>
        )}
      </div>

      {/* Add/Edit Member Modal */}
      {showAddModal && (
        <div className="modal-overlay" onClick={() => setShowAddModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title">
                {editingMember ? "Edit team member" : "Add new team member"}
              </h2>
              <button
                className="modal-close"
                onClick={() => setShowAddModal(false)}
              >
                ✕
              </button>
            </div>

            <div className="modal-body">
              {/* Error message in modal */}
              {error && (
                <div style={{ 
                  padding: "8px", 
                  marginBottom: "16px", 
                  backgroundColor: "#fee", 
                  color: "#c33", 
                  borderRadius: "4px",
                  fontSize: "14px"
                }}>
                  {error}
                </div>
              )}

              {/* Profile Picture Upload */}
              <div className="profile-upload-container">
                <div className="profile-upload-circle">
                  <span className="upload-icon">+</span>
                  <span className="upload-text">Upload</span>
                </div>
              </div>

              {/* Name Field */}
              <div className="form-group">
                <label className="form-label">
                  Name *
                  <span className="char-counter">
                    {formData.name.length}/30
                  </span>
                </label>
                <input
                  type="text"
                  className="form-input"
                  maxLength={30}
                  value={formData.name}
                  onChange={(e) =>
                    setFormData({ ...formData, name: e.target.value })
                  }
                  disabled={loading}
                />
              </div>

              {/* Country and Phone */}
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Select a country</label>
                  <select
                    className="form-input form-select"
                    value={formData.country}
                    onChange={(e) =>
                      setFormData({ ...formData, country: e.target.value })
                    }
                    disabled={loading}
                  >
                    <option value="INDIA">India</option>
                    <option value="USA">United States</option>
                    <option value="UK">United Kingdom</option>
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Phone number</label>
                  <input
                    type="tel"
                    className="form-input"
                    value={formData.phone}
                    onChange={(e) =>
                      setFormData({ ...formData, phone: e.target.value })
                    }
                    disabled={loading}
                  />
                </div>
              </div>

              {/* Email Field */}
              <div className="form-group">
                <label className="form-label">Email *</label>
                <input
                  type="email"
                  className="form-input"
                  value={formData.email}
                  onChange={(e) =>
                    setFormData({ ...formData, email: e.target.value })
                  }
                  disabled={loading}
                />
              </div>

              {/* Password Fields */}
              {!editingMember && (
                <>
                  <div className="form-group">
                    <label className="form-label">Password *</label>
                    <input
                      type="password"
                      className="form-input"
                      value={formData.password}
                      onChange={(e) =>
                        setFormData({ ...formData, password: e.target.value })
                      }
                      disabled={loading}
                      placeholder="Create a password"
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Confirm Password *</label>
                    <input
                      type="password"
                      className="form-input"
                      value={formData.confirmPassword}
                      onChange={(e) =>
                        setFormData({ ...formData, confirmPassword: e.target.value })
                      }
                      disabled={loading}
                      placeholder="Confirm password"
                    />
                  </div>
                </>
              )}

              {editingMember && (
                <>
                  <div className="form-group">
                    <label className="form-label">New Password (optional)</label>
                    <input
                      type="password"
                      className="form-input"
                      value={formData.password}
                      onChange={(e) =>
                        setFormData({ ...formData, password: e.target.value })
                      }
                      disabled={loading}
                      placeholder="Leave empty to keep current password"
                    />
                  </div>
                  {formData.password && (
                    <div className="form-group">
                      <label className="form-label">Confirm New Password</label>
                      <input
                        type="password"
                        className="form-input"
                        value={formData.confirmPassword}
                        onChange={(e) =>
                          setFormData({ ...formData, confirmPassword: e.target.value })
                        }
                        disabled={loading}
                        placeholder="Confirm new password"
                      />
                    </div>
                  )}
                </>
              )}

              {/* User Access Type */}
              <div className="form-group">
                <label className="form-label">User access type:</label>
                <div className="access-type-options">
                  <label className="access-type-option">
                    <input
                      type="radio"
                      name="accessType"
                      value="Admin"
                      checked={formData.type === "Admin"}
                      onChange={(e) =>
                        setFormData({ ...formData, type: "Admin" })
                      }
                    />
                    <div className="option-content">
                      <div className="option-title">Admin Access</div>
                      <div className="option-description">
                        Access to all the modules
                      </div>
                    </div>
                  </label>
                  <label className="access-type-option">
                    <input
                      type="radio"
                      name="accessType"
                      value="Restricted"
                      checked={formData.type === "Restricted"}
                      onChange={(e) =>
                        setFormData({ ...formData, type: "Restricted" })
                      }
                    />
                    <div className="option-content">
                      <div className="option-title">Restricted Access</div>
                      <div className="option-description">
                        Access to particular modules
                      </div>
                    </div>
                  </label>
                </div>
              </div>
            </div>

            <div className="modal-footer">
              <button 
                className="btn-save" 
                onClick={handleSaveMember}
                disabled={loading}
              >
                {loading ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Manage Permissions Modal */}
      {showPermissionsModal && (
        <div
          className="modal-overlay"
          onClick={() => setShowPermissionsModal(false)}
        >
          <div
            className="modal-content permissions-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <h2 className="modal-title">Manage Permissions</h2>
              <button
                className="modal-close"
                onClick={() => setShowPermissionsModal(false)}
              >
                ✕
              </button>
            </div>

            <div className="modal-body">
              <div className="form-group">
                <label className="form-label">
                  Select Services in which you want to give access permissions
                </label>
                <div className="service-select-wrapper">
                  <select
                    className="form-input service-select"
                    value={selectedService}
                    onChange={(e) => setSelectedService(e.target.value)}
                  >
                    <option value="Admin Access">All memberships</option>
                    <option value="Manger Access">Basic Plan</option>
                    <option value="Team leader Access">Premium Plan</option>
                  </select>
                </div>
                <p className="service-hint">
                  If you choose all memberships, access permission will be
                  given to your future memberships automatically.
                </p>
              </div>

              <div className="warning-alert">
                <span className="warning-icon">⚠️</span>
                <div className="warning-text">
                  Any user account created previously using these credentials
                  will be given elevated permissions on dashboard and any
                  existing subscriptions would be cancelled. Do you wish to
                  continue?
                </div>
              </div>
            </div>

            <div className="modal-footer">
              <button className="btn-save" onClick={handleSavePermissions}>
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
