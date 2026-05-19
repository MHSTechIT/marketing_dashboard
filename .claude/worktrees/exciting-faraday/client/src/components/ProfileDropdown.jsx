import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { auth } from '../utils/auth';
import { setTheme, getCurrentTheme } from '../utils/theme';

export default function ProfileDropdown() {
  const [isOpen, setIsOpen] = useState(false);
  const [currentTheme, setCurrentTheme] = useState(getCurrentTheme());
  const dropdownRef = useRef(null);
  const navigate = useNavigate();

  // Get user info from localStorage (matching Login.jsx storage key)
  const STORAGE_KEY = process.env.REACT_APP_STORAGE_KEY || "app_auth";
  const getUserInfo = () => {
    try {
      const authData = localStorage.getItem(STORAGE_KEY);
      if (authData) {
        const parsed = JSON.parse(authData);
        if (parsed.user) {
          return {
            name: parsed.user.full_name || parsed.user.name || parsed.user.email?.split('@')[0] || 'user',
            email: parsed.user.email || 'user@example.com'
          };
        }
      }
    } catch (e) {
      console.error('Error parsing user info:', e);
    }
    // Fallback
    try {
      const token = localStorage.getItem("loggedInUser");
      if (token) {
        // Try to decode JWT token to get email (basic decode, not verification)
        try {
          const payload = JSON.parse(atob(token.split('.')[1]));
          return {
            name: payload.email?.split('@')[0] || 'user',
            email: payload.email || 'user@example.com'
          };
        } catch (e) {
          return { name: 'user', email: 'user@example.com' };
        }
      }
    } catch (e) {}
    return { name: 'user', email: 'user@example.com' };
  };

  const userInfo = getUserInfo();
  const userName = userInfo.name;
  const userEmail = userInfo.email;

  // Sync theme state with theme changes
  useEffect(() => {
    const updateTheme = () => {
      const storedTheme = getCurrentTheme();
      setCurrentTheme(storedTheme);
    };

    // Update on mount
    updateTheme();

    // Listen for custom themechange event
    const handleThemeChange = () => {
      updateTheme();
    };

    window.addEventListener('themechange', handleThemeChange);

    // Also listen for localStorage changes (in case theme is changed in another tab)
    const handleStorageChange = (e) => {
      if (e.key === 'theme') {
        updateTheme();
      }
    };

    window.addEventListener('storage', handleStorageChange);

    return () => {
      window.removeEventListener('themechange', handleThemeChange);
      window.removeEventListener('storage', handleStorageChange);
    };
  }, []);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  const handleThemeChange = (theme) => {
    setCurrentTheme(theme);
    setTheme(theme);
    setIsOpen(false);
  };

  const handleLogout = () => {
    // Clear both storage keys
    auth.logout();
    try {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem("loggedInUser");
    } catch (e) {
      console.error('Error clearing storage:', e);
    }
    navigate('/login');
  };

  const themeOptions = [
    { value: 'light', label: 'Light', icon: '☀️' },
    { value: 'dark', label: 'Dark', icon: '🌙' },
    { value: 'classic-dark', label: 'Classic Dark', icon: '🌑' },
    { value: 'system', label: 'System', icon: '💻' },
  ];

  return (
    <div className="position-relative" ref={dropdownRef}>
      {/* Profile Icon Button */}
      <button
        className="btn btn-link p-0 d-flex align-items-center justify-content-center"
        onClick={() => setIsOpen(!isOpen)}
        style={{
          width: '36px',
          height: '36px',
          borderRadius: '50%',
          backgroundColor: 'rgba(0, 0, 0, 0.05)',
          border: 'none',
          cursor: 'pointer',
          transition: 'all 0.2s ease',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.backgroundColor = 'rgba(0, 0, 0, 0.1)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.backgroundColor = 'rgba(0, 0, 0, 0.05)';
        }}
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ color: '#64748b' }}
        >
          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
          <circle cx="12" cy="7" r="4"></circle>
        </svg>
      </button>

      {/* Dropdown Menu */}
      {isOpen && (
        <div
          className="profile-dropdown-menu"
          style={{
            position: 'absolute',
            top: 'calc(100% + 8px)',
            right: 0,
            minWidth: '240px',
            backgroundColor: 'var(--card, #ffffff)',
            borderRadius: '12px',
            boxShadow: '0 4px 20px rgba(0, 0, 0, 0.15)',
            border: '1px solid rgba(0, 0, 0, 0.1)',
            zIndex: 1000,
            overflow: 'hidden',
            animation: 'fadeInDown 0.2s ease-out',
            color: 'var(--text, #1e293b)',
          }}
        >
          {/* User Account Info */}
          <div
            style={{
              padding: '16px',
              borderBottom: '1px solid rgba(0, 0, 0, 0.1)',
            }}
          >
            <div
              style={{
                fontWeight: 600,
                fontSize: '0.9rem',
                color: 'var(--text, #1e293b)',
                marginBottom: '4px',
              }}
            >
              {userName}
            </div>
            <div
              style={{
                fontSize: '0.8rem',
                color: 'var(--text, #64748b)',
                opacity: 0.8,
              }}
            >
              {userEmail}
            </div>
          </div>

          {/* Theme Section */}
          <div
            style={{
              padding: '8px 0',
              borderTop: '1px solid rgba(0, 0, 0, 0.1)',
              borderBottom: '1px solid #e2e8f0',
            }}
          >
            <div
              style={{
                padding: '8px 16px 12px',
                fontSize: '0.75rem',
                fontWeight: 600,
                color: 'var(--text, #64748b)',
                opacity: 0.8,
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
              }}
            >
              Theme
            </div>
            {themeOptions.map((option) => (
              <div
                key={option.value}
                className="profile-dropdown-item"
                style={{
                  padding: '10px 16px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  cursor: 'pointer',
                  transition: 'background-color 0.2s ease',
                  backgroundColor:
                    currentTheme === option.value ? 'rgba(0, 0, 0, 0.05)' : 'transparent',
                }}
                onMouseEnter={(e) => {
                  if (currentTheme !== option.value) {
                    e.currentTarget.style.backgroundColor = 'rgba(0, 0, 0, 0.03)';
                  }
                }}
                onMouseLeave={(e) => {
                  if (currentTheme !== option.value) {
                    e.currentTarget.style.backgroundColor = 'transparent';
                  }
                }}
                onClick={() => handleThemeChange(option.value)}
              >
                <span style={{ fontSize: '1.1rem', width: '20px' }}>
                  {option.icon}
                </span>
                <span
                  style={{
                    fontSize: '0.875rem',
                    color: 'var(--text, #1e293b)',
                    flex: 1,
                  }}
                >
                  {option.label}
                </span>
                {currentTheme === option.value && (
                  <span
                    style={{
                      width: '8px',
                      height: '8px',
                      borderRadius: '50%',
                      backgroundColor: '#0d6efd',
                    }}
                  />
                )}
              </div>
            ))}
          </div>

          {/* Log Out */}
          <div
            className="profile-dropdown-item"
            style={{
              padding: '12px 16px',
              cursor: 'pointer',
              transition: 'background-color 0.2s ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = 'rgba(0, 0, 0, 0.03)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = 'transparent';
            }}
            onClick={handleLogout}
          >
            <span
              style={{
                fontSize: '0.875rem',
                color: '#dc3545',
                fontWeight: 500,
              }}
            >
              Log out
            </span>
          </div>
        </div>
      )}

      <style>{`
        @keyframes fadeInDown {
          from {
            opacity: 0;
            transform: translateY(-8px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        /* Dark theme support for dropdown */
        [data-theme='dark'] .profile-dropdown-menu,
        [data-theme='classic-dark'] .profile-dropdown-menu {
          background-color: #1f2933 !important;
          border-color: #334155 !important;
        }

        [data-theme='dark'] .profile-dropdown-item,
        [data-theme='classic-dark'] .profile-dropdown-item {
          color: #e5e7eb !important;
        }

        [data-theme='dark'] .profile-dropdown-item:hover,
        [data-theme='classic-dark'] .profile-dropdown-item:hover {
          background-color: #334155 !important;
        }

        [data-theme='dark'] .profile-dropdown-menu > div:first-child > div:first-child,
        [data-theme='classic-dark'] .profile-dropdown-menu > div:first-child > div:first-child {
          color: #ffffff !important;
        }

        [data-theme='dark'] .profile-dropdown-menu > div:first-child > div:last-child,
        [data-theme='classic-dark'] .profile-dropdown-menu > div:first-child > div:last-child {
          color: #9ca3af !important;
        }

        [data-theme='dark'] .profile-dropdown-menu > div:nth-child(2) > div,
        [data-theme='classic-dark'] .profile-dropdown-menu > div:nth-child(2) > div {
          border-color: #334155 !important;
        }

        [data-theme='dark'] .profile-dropdown-menu > div:nth-child(3) > div:first-child,
        [data-theme='classic-dark'] .profile-dropdown-menu > div:nth-child(3) > div:first-child {
          color: #9ca3af !important;
        }

        [data-theme='dark'] .profile-dropdown-menu > div:nth-child(3) > div:not(:first-child),
        [data-theme='classic-dark'] .profile-dropdown-menu > div:nth-child(3) > div:not(:first-child) {
          color: #e5e7eb !important;
        }
      `}</style>
    </div>
  );
}
