import React, { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { auth } from "../utils/auth";
import { setTheme, getCurrentTheme } from "../utils/theme";

export default function Layout({ children }) {
  const navigate = useNavigate();
  const [isOpen, setIsOpen] = useState(false); // for mobile nav toggle
  const [theme, setCurrentTheme] = useState(getCurrentTheme());
  const [openMenu, setOpenMenu] = useState(null); // for dropdown menus

  useEffect(() => {
    setTheme(theme);
  }, [theme]);

  const handleLogout = () => {
    auth.logout();
    navigate("/login");
  };

  const toggleNavbar = () => setIsOpen(!isOpen);

  const toggleSubmenu = (menu) => {
    setOpenMenu(openMenu === menu ? null : menu);
  };

  return (
    <div className="min-vh-100 d-flex flex-column">
      <nav className="navbar navbar-expand-lg navbar-dark bg-dark">
        <div className="container-fluid">
          <Link className="navbar-brand fw-bold" to="/">
          <i class="fa-brands fa-react fa-spin fa-spin-reverse"></i>
          </Link>
          <button
            className="navbar-toggler"
            type="button"
            onClick={toggleNavbar}
            aria-controls="navbarNav"
            aria-expanded={isOpen}
            aria-label="Toggle navigation"
          >
            <span className="navbar-toggler-icon"></span>
          </button>

          <div
            className={`collapse navbar-collapse ${isOpen ? "show" : ""}`}
            id="navbarNav"
          >
            <ul className="navbar-nav me-auto mb-2 mb-lg-0">
              <li className="nav-item">
                <Link
                  className="nav-link"
                  to="/"
                  onClick={() => setIsOpen(false)}
                >
                  🏠 Home
                </Link>
              </li>

              {/* Master Menu */}
              <li
                className={`nav-item dropdown ${
                  openMenu === "master" ? "show" : ""
                }`}
              >
                <button
                  className="nav-link dropdown-toggle "
                  onClick={() => toggleSubmenu("master")}
                >
                  📘 Master
                </button>
                <ul
                  className={`dropdown-menu ${
                    openMenu === "master" ? "show" : ""
                  }`}
                >
                  <li>
                    <Link
                      className="dropdown-item"
                      to="/master/item"
                      onClick={() => setOpenMenu(null)}
                    >
                      📦 Item Master
                    </Link>
                  </li>
                  <li>
                    <Link
                      className="dropdown-item"
                      to="/master/category"
                      onClick={() => setOpenMenu(null)}
                    >
                      🗂️ Category Master
                    </Link>
                  </li>
                </ul>
              </li>

              {/* Operation Menu */}
              <li
                className={`nav-item dropdown ${
                  openMenu === "operation" ? "show" : ""
                }`}
              >
                <button
                  className="nav-link dropdown-toggle"
                  onClick={() => toggleSubmenu("operation")}
                >
                  ⚙️ Operation
                </button>
                <ul
                  className={`dropdown-menu ${
                    openMenu === "operation" ? "show" : ""
                  }`}
                >
                  <li>
                    <Link
                      className="dropdown-item"
                      to="/operation/task"
                      onClick={() => setOpenMenu(null)}
                    >
                      🧩 Task Management
                    </Link>
                  </li>
                  <li>
                    <Link
                      className="dropdown-item"
                      to="/operation/transaction"
                      onClick={() => setOpenMenu(null)}
                    >
                      💼 Transaction
                    </Link>
                  </li>
                </ul>
              </li>

              {/* Report Menu */}
              <li
                className={`nav-item dropdown ${
                  openMenu === "report" ? "show" : ""
                }`}
              >
                <button
                  className="nav-link dropdown-toggle"
                  onClick={() => toggleSubmenu("report")}
                >
                  📊 Report
                </button>
                <ul
                  className={`dropdown-menu ${
                    openMenu === "report" ? "show" : ""
                  }`}
                >
                  <li>
                    <Link
                      className="dropdown-item"
                      to="/report/daily"
                      onClick={() => setOpenMenu(null)}
                    >
                      📅 Daily Report
                    </Link>
                  </li>
                  <li>
                    <Link
                      className="dropdown-item"
                      to="/report/summary"
                      onClick={() => setOpenMenu(null)}
                    >
                      📈 Summary Report
                    </Link>
                  </li>
                </ul>
              </li>
            </ul>

            <div className="d-flex align-items-center gap-2">
              <select
                className="form-select form-select-sm w-auto"
                value={theme}
                onChange={(e) => {
                  setCurrentTheme(e.target.value);
                  setTheme(e.target.value);
                }}
              >
                <option value="light">🌞 Light</option>
                <option value="dark">🌙 Dark</option>
                <option value="primary">💙 Blue</option>
                <option value="danger">❤️ Red</option>
                <option value="success">💚 Green</option>
              </select>
              <button
                className="btn btn-outline-light btn-sm"
                onClick={handleLogout}
              >
                Logout
              </button>
            </div>
          </div>
        </div>
      </nav>

      <main className="flex-grow-1 p-3 app-body">{children}</main>
    </div>
  );
}
