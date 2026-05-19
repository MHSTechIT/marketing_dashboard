import React, { useState, useEffect, useRef } from "react";
import { Link, NavLink, useNavigate, useLocation } from "react-router-dom";
import { auth } from "../utils/auth";
import logo from "../assets/MHS_Log.png"; // Import the logo
import ProfileDropdown from "./ProfileDropdown";

export default function Layout({ children }) {
  const navigate = useNavigate();
  const location = useLocation();

  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [openSettingsMenu, setOpenSettingsMenu] = useState(false);
  const settingsMenuRef = useRef(null);

  // eslint-disable-next-line no-unused-vars -- used by logout UI when wired
  const handleLogout = () => {
    auth.logout();
    navigate("/login");
  };

  const toggleSettingsMenu = () => {
    setOpenSettingsMenu(!openSettingsMenu);
  };

  // Check if current route is a settings route
  const isSettingsRoute = location.pathname === '/team-management';

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (settingsMenuRef.current && !settingsMenuRef.current.contains(event.target)) {
        setOpenSettingsMenu(false);
      }
    };

    if (openSettingsMenu) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [openSettingsMenu]);

  return (
    <div
      className={`app-shell ${sidebarOpen ? "sidebar-open" : "sidebar-closed"
        }`}
    >
      {/* SIDEBAR */}
      <aside
        className={`sidebar text-white shadow-lg ${sidebarOpen ? "open" : "closed"
          }`}
      >
        <div className="p-3 border-bottom border-white-10 d-flex justify-content-between align-items-center branding-header">
          <Link
            to="/"
            className="text-white text-decoration-none fw-bold d-flex align-items-center gap-2 branding-link"
            onClick={() => {
              if (window.innerWidth < 992) setSidebarOpen(false);
            }}
          >
            {/* Logo Image */}
            <img src={logo} alt="MHS Logo" className="sidebar-logo" />
            <span className="brand-text">MHS Dashboard</span>
          </Link>

          <button
            className="btn btn-sm btn-icon d-lg-none text-white-50"
            onClick={() => setSidebarOpen(false)}
          >
            ✕
          </button>
        </div>

        <ul className="nav flex-column px-2 pt-3 custom-nav">
          {/* 1. Dashboard */}
          <li className="nav-item mb-2">
            <NavLink
              end
              to="/"
              className="nav-link sidebar-link d-flex align-items-center"
              onClick={() => {
                if (window.innerWidth < 992) setSidebarOpen(false);
              }}
            >
              <span className="icon-wrapper me-3">📊</span>
              <span>Dashboard</span>
            </NavLink>
          </li>

          {/* 2. Best Performing Ad */}
          <li className="nav-item mb-2">
            <NavLink
              to="/best-ad"
              className="nav-link sidebar-link d-flex align-items-center"
              onClick={() => {
                if (window.innerWidth < 992) setSidebarOpen(false);
              }}
            >
              <span className="icon-wrapper me-3">⭐</span>
              <span>Best Performing Ad</span>
            </NavLink>
          </li>

          {/* 3. Best Performing Reel */}
          <li className="nav-item mb-2">
            <NavLink
              to="/best-reel"
              className="nav-link sidebar-link d-flex align-items-center"
              onClick={() => {
                if (window.innerWidth < 992) setSidebarOpen(false);
              }}
            >
              <span className="icon-wrapper me-3">🎬</span>
              <span>Best Performing Reel</span>
            </NavLink>
          </li>

          {/* 4. Plan (includes Team Performance & Goals) */}
          <li className="nav-item mb-2">
            <NavLink
              to="/plan"
              className="nav-link sidebar-link d-flex align-items-center"
              onClick={() => {
                if (window.innerWidth < 992) setSidebarOpen(false);
              }}
            >
              <span className="icon-wrapper me-3">🗓️</span>
              <span>Plan</span>
            </NavLink>
          </li>

          {/* 5. Audience */}
          <li className="nav-item mb-2">
            <NavLink
              to="/audience"
              className="nav-link sidebar-link d-flex align-items-center"
              onClick={() => {
                if (window.innerWidth < 992) setSidebarOpen(false);
              }}
            >
              <span className="icon-wrapper me-3">👥</span>
              <span>Audience</span>
            </NavLink>
          </li>

          {/* 6. AI Insights */}
          <li className="nav-item mb-2">
            <NavLink
              to="/ai-insights"
              className="nav-link sidebar-link d-flex align-items-center ai-link"
              onClick={() => {
                if (window.innerWidth < 992) setSidebarOpen(false);
              }}
            >
              <span className="icon-wrapper me-3">🤖</span>
              <span>AI Insights</span>
            </NavLink>
          </li>

          {/* 7. Unique Leads */}
          <li className="nav-item mb-2">
            <NavLink
              to="/unique-leads"
              className="nav-link sidebar-link d-flex align-items-center"
              onClick={() => {
                if (window.innerWidth < 992) setSidebarOpen(false);
              }}
            >
              <span className="icon-wrapper me-3">📋</span>
              <span>Unique Leads</span>
            </NavLink>
          </li>

          {/* 8. Collaboration */}
          <li className="nav-item mb-2">
            <NavLink
              to="/collaboration"
              className="nav-link sidebar-link d-flex align-items-center"
              onClick={() => {
                if (window.innerWidth < 992) setSidebarOpen(false);
              }}
            >
              <span className="icon-wrapper me-3">🤝</span>
              <span>Collaboration</span>
            </NavLink>
          </li>

          {/* 9. Settings Dropdown */}
          <li className="nav-item mb-2" ref={settingsMenuRef}>
            <button
              className={`nav-link sidebar-link d-flex align-items-center justify-content-between w-100 ${
                isSettingsRoute ? 'active-parent' : ''
              }`}
              onClick={toggleSettingsMenu}
              style={{ background: 'none', border: 'none', cursor: 'pointer' }}
            >
              <div className="d-flex align-items-center">
                <span className="icon-wrapper me-3">⚙️</span>
                <span>Settings</span>
              </div>
              <span className="dropdown-arrow" style={{ 
                fontSize: '0.75rem', 
                transition: 'transform 0.2s ease',
                transform: openSettingsMenu ? 'rotate(180deg)' : 'rotate(0deg)'
              }}>
                ▼
              </span>
            </button>
            {openSettingsMenu && (
              <ul className="settings-submenu animate-submenu">
                <li>
                  <NavLink
                    to="/team-management"
                    className="nav-link sidebar-link submenu-link d-flex align-items-center"
                    onClick={() => {
                      setOpenSettingsMenu(false);
                      if (window.innerWidth < 992) setSidebarOpen(false);
                    }}
                  >
                    <span className="icon-wrapper me-3">👥</span>
                    <span>Team Management</span>
                  </NavLink>
                </li>
              </ul>
            )}
          </li>
        </ul>
      </aside>

      {sidebarOpen && (
        <div
          className="sidebar-backdrop d-lg-none"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* MAIN AREA */}
      <div className="main-area d-flex flex-column">
        {/* TOPBAR */}
        <header className="custom-header-style d-flex justify-content-between align-items-center px-4 py-3 border-bottom shadow-sm">
          <div className="d-flex align-items-center gap-3">
            <button
              className="btn btn-light btn-sm rounded-circle p-2"
              onClick={() => setSidebarOpen((prev) => !prev)}
            >
              ☰
            </button>
            <h5 className="mb-0 fw-bold d-none d-sm-block" style={{ color: 'var(--text, #1a1d1f)' }}>
              {location.pathname === '/' ? 'Dashboard'
                : location.pathname.substring(1).replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
            </h5>
          </div>

          <div className="d-flex align-items-center gap-3">
            <ProfileDropdown />
          </div>
        </header>

        {/* 👇 Only this scrolls */}
        <main className="layout-content flex-grow-1 p-4">{children}</main>
      </div>

      {/* STYLES */}
      <style jsx="true">{`
        /* Core Reset */
        html, body, #root { height: 100%; }
        body { margin: 0; overflow: hidden; background-color: var(--bg, #f3f4f6); color: var(--text, #1a1d1f); font-family: 'Inter', sans-serif; transition: background-color 0.3s ease, color 0.3s ease; }
        
        /* Layout Structure */
        .app-shell { height: 100vh; display: flex; background-color: var(--bg, #f3f4f6); transition: background-color 0.3s ease; }
        .main-area { flex: 1; display: flex; flex-direction: column; min-height: 0; min-width: 0; width: 100%; overflow-x: hidden; background-color: var(--bg, #f3f4f6); transition: background-color 0.3s ease; }
        .layout-content { flex: 1; overflow-y: auto; overflow-x: auto; padding: 2rem; width: 100%; max-width: 100%; box-sizing: border-box; background-color: var(--bg, #f5f7fa); color: var(--text, #1a1d1f); transition: background-color 0.3s ease, color 0.3s ease; }

        /* Sidebar Styling */
        .sidebar {
            background: var(--nav, #0f2d5e) !important;
            transition: width 0.3s cubic-bezier(0.4, 0, 0.2, 1), transform 0.3s ease, background-color 0.3s ease;
            overflow-y: auto;
            overflow-x: hidden;
            z-index: 1000;
            border-right: 1px solid rgba(255,255,255,0.05);
            flex: 0 0 auto;
            flex-shrink: 0;
        }
        
        .sidebar-logo {
            height: 32px;
            width: auto;
            object-fit: contain;
        }
        
        .brand-text {
            font-size: 1.1rem;
            letter-spacing: 0.5px;
        }

        .border-white-10 { border-color: rgba(255,255,255,0.1) !important; }
        
        .sidebar.open { box-shadow: 4px 0 24px rgba(0,0,0,0.1); }
        .sidebar.closed { box-shadow: none; }

        .sidebar-link {
          border-radius: 8px;
          padding: 10px 16px;
          font-size: 0.95rem;
          color: rgba(255,255,255,0.7) !important;
          transition: all 0.2s ease;
          margin-bottom: 4px;
          border: 1px solid transparent;
          min-width: 0;
        }

        /* Prevent label wrapping/clipping inside flex links */
        .sidebar-link span:not(.icon-wrapper) {
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          min-width: 0;
        }

        .sidebar-link:hover {
          background-color: rgba(255, 255, 255, 0.9);
          color: #000 !important;
          padding-left: 20px;
        }

        .nav-link.active, .active-parent {
          background: linear-gradient(90deg, rgba(59, 130, 246, 0.2), rgba(37, 99, 235, 0.1));
          border: 1px solid rgba(59, 130, 246, 0.4);
          color: #000 !important;
          box-shadow: 0 0 15px rgba(59, 130, 246, 0.1);
        }
        
        /* Special AI Link Style */
        .ai-link.active {
             background: linear-gradient(90deg, rgba(139, 92, 246, 0.2), rgba(217, 70, 239, 0.1));
             border-color: rgba(168, 85, 247, 0.4);
             box-shadow: 0 0 15px rgba(168, 85, 247, 0.2);
             color: #000 !important;
        }

        .icon-wrapper {
            width: 24px;
            text-align: center;
            display: inline-block;
            font-size: 1.1rem;
        }

        /* Submenu */
        .submenu-link { font-size: 0.85rem; padding-left: 12px; }
        .animate-submenu { animation: slideDown 0.2s ease-out; }
        @keyframes slideDown { from { opacity: 0; transform: translateY(-5px); } to { opacity: 1; transform: translateY(0); } }
        
        /* Settings Dropdown */
        .settings-submenu {
          list-style: none;
          padding: 0;
          margin: 4px 0 0 0;
          background-color: rgba(0, 0, 0, 0.15);
          border-radius: 8px;
          overflow: hidden;
        }
        
        .settings-submenu li {
          margin: 0;
        }
        
        .settings-submenu .sidebar-link {
          margin: 0;
          padding-left: 48px;
          background-color: transparent;
        }
        
        .settings-submenu .sidebar-link:hover {
          background-color: rgba(255, 255, 255, 0.9);
          color: #000 !important;
          padding-left: 52px;
        }
        
        .settings-submenu .sidebar-link.active {
          background: linear-gradient(90deg, rgba(59, 130, 246, 0.2), rgba(37, 99, 235, 0.1));
          border: 1px solid rgba(59, 130, 246, 0.4);
          color: #000 !important;
        }
        
        .dropdown-arrow {
          opacity: 0.7;
        }

        /* Responsive */
        @media (min-width: 992px) {
          .sidebar { position: relative; height: 100vh; }
          .sidebar.open { width: 260px; }
          .sidebar.closed { width: 0; border: none; }
        }

        @media (max-width: 991.98px) {
          .app-shell { position: relative; }
          .sidebar { position: fixed; top: 0; left: 0; height: 100%; width: 260px; transform: translateX(-100%); }
          .sidebar.open { transform: translateX(0); }
          .sidebar.closed { transform: translateX(-100%); }
          .sidebar-backdrop { position: fixed; inset: 0; background-color: rgba(0, 0, 0, 0.5); z-index: 900; animation: fadeIn 0.2s ease; }
        }
        
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
      `}</style>
    </div>
  );
}
