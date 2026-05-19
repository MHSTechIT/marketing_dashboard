import React from "react";
import { Link } from "react-router-dom";
import { auth } from "../utils/auth";

export default function Home() {
  const actions = [
    { label: "Meta", icon: "👤", onClick: () => alert("Create User") },
    { label: "YouTube", icon: "📤", onClick: () => alert("Export") },
    
  ];

  return (
    <div className="container-fluid py-4">
      {/* Top Greeting + Actions */}
      <div className="row mb-4 align-items-center">
        <div className="col-12 col-lg-9">
          <h3 className="fw-bold mb-1">
            Welcome, <span className="text-primary">{auth.getUser()}</span>
          </h3>
          <p className="text-muted mb-0">Have a good day!.</p>
        </div>
        <div className="col-3 col-lg-3 text-lg-end mt-3 mt-lg-0">
          <select
            className="form-select form-select-sm admin-dropdown-select"
            onChange={(e) => {
              const selectedIndex = e.target.value;
              const selectedItem = actions[selectedIndex];

              if (selectedItem?.onClick) {
                selectedItem.onClick(selectedItem);
              }
            }}
          >
            <option value="">All</option>
            {actions.map((item, index) => (
              <option key={index} value={index}>
                {item.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Stat cards row */}
      <div className="row g-3 mb-4">
        <div className="col-6 col-xl-3">
          <div className="card shadow-sm border-0 dashboard-card">
            <div className="card-body">
              <p className="text-muted text-uppercase small mb-1">
                Total Items
              </p>
              <h4 className="fw-bold mb-0">128</h4>
              <small className="text-success">+8 today</small>
            </div>
          </div>
        </div>
        <div className="col-6 col-xl-3">
          <div className="card shadow-sm border-0 dashboard-card">
            <div className="card-body">
              <p className="text-muted text-uppercase small mb-1">Operations</p>
              <h4 className="fw-bold mb-0">42</h4>
              <small className="text-info">Running</small>
            </div>
          </div>
        </div>
        <div className="col-6 col-xl-3">
          <div className="card shadow-sm border-0 dashboard-card">
            <div className="card-body">
              <p className="text-muted text-uppercase small mb-1">
                Pending Tasks
              </p>
              <h4 className="fw-bold mb-0">15</h4>
              <small className="text-warning">Need attention</small>
            </div>
          </div>
        </div>
        <div className="col-6 col-xl-3">
          <div className="card shadow-sm border-0 dashboard-card">
            <div className="card-body">
              <p className="text-muted text-uppercase small mb-1">Reports</p>
              <h4 className="fw-bold mb-0">9</h4>
              <small className="text-muted">This week</small>
            </div>
          </div>
        </div>
      </div>

      {/* Main content grid */}
      <div className="row g-3">
        {/* Left: Your main navigation cards */}
        <div className="col-lg-8">
          <div className="row g-3">
            <div className="col-md-4">
              <div className="card h-100 shadow-sm border-0 dashboard-card">
                <div className="card-body d-flex flex-column">
                  <h5 className="fw-bold text-primary">Master</h5>
                  <p className="text-muted flex-grow-1">
                    Manage master data entries.
                  </p>
                  <Link
                    to="/master/item"
                    className="btn btn-primary btn-sm mt-auto align-self-start"
                  >
                    Go →
                  </Link>
                </div>
              </div>
            </div>

            <div className="col-md-4">
              <div className="card h-100 shadow-sm border-0 dashboard-card">
                <div className="card-body d-flex flex-column">
                  <h5 className="fw-bold text-success">Operation</h5>
                  <p className="text-muted flex-grow-1">
                    Add and view operational entries.
                  </p>
                  <Link
                    to="/operation/task"
                    className="btn btn-success btn-sm mt-auto align-self-start"
                  >
                    Go →
                  </Link>
                </div>
              </div>
            </div>

            <div className="col-md-4">
              <div className="card h-100 shadow-sm border-0 dashboard-card">
                <div className="card-body d-flex flex-column">
                  <h5 className="fw-bold text-warning">Reports</h5>
                  <p className="text-muted flex-grow-1">
                    View and export reports.
                  </p>
                  <Link
                    to="/report"
                    className="btn btn-warning btn-sm text-white mt-auto align-self-start"
                  >
                    Go →
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Right: Simple "activity" / info card */}
        <div className="col-lg-4">
          <div className="card h-100 shadow-sm border-0 dashboard-card">
            <div className="card-header bg-white border-0 pb-0">
              <h6 className="fw-bold mb-0">Quick Overview</h6>
            </div>
            <div className="card-body">
              <p className="text-muted small">
                Use the cards on the left to quickly jump into different areas
                of the app.
              </p>
              <ul className="list-group list-group-flush small">
                <li className="list-group-item px-0 d-flex justify-content-between align-items-center">
                  Last login
                  <span className="badge bg-light text-muted border">
                    Just now
                  </span>
                </li>
                <li className="list-group-item px-0 d-flex justify-content-between align-items-center">
                  Theme
                  <span className="badge bg-primary-subtle text-primary">
                    Multi-color
                  </span>
                </li>
                <li className="list-group-item px-0 d-flex justify-content-between align-items-center">
                  Layout
                  <span className="badge bg-success-subtle text-success">
                    Responsive
                  </span>
                </li>
                <li className="list-group-item px-0 d-flex justify-content-between align-items-center">
                  Navigation
                  <span className="badge bg-info-subtle text-info">
                    React Router
                  </span>
                </li>
              </ul>
            </div>
          </div>
        </div>
      </div>

      {/* Small CSS for hover / dashboard feel */}
      <style jsx="true">{`
        .dashboard-card {
          border-radius: 12px;
          transition: transform 0.2s ease, box-shadow 0.2s ease;
        }
        .dashboard-card:hover {
          transform: translateY(-4px);
          box-shadow: 0 0.75rem 1.5rem rgba(0, 0, 0, 0.08);
        }
      `}</style>
    </div>
  );
}
