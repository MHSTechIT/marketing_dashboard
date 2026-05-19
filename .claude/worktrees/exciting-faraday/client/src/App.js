import React from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Login from "./pages/Auth/Login";
import Signup from "./pages/Auth/Signup";
import Task from "./pages/Operations/Task";
import Report from "./pages/Reports/Report";
import ProtectedRoute from "./components/ProtectedRoute";
import Sidebar from "./components/Sidebar"
import "./App.css";
import "bootstrap/dist/css/bootstrap.min.css";
import AdsDashboardOptionA from "./pages/Dashboards";
import BestPerformingAd from "./pages/BestPerformingAd";
import BestPerformingReel from "./pages/BestPerformingReel";
import Plan from "./pages/Plan";
import Audience from "./pages/Audience";
import AIInsights from "./pages/AIInsights";
import UniqueLeads from "./pages/UniqueLeads";
import Collaboration from "./pages/Collaboration";
import HighFiveLanding from "./pages/HighFiveLanding";
import TeamManagement from "./pages/TeamManagement";
import ManagePermissions from "./pages/ManagePermissions";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/signup" element={<Signup />} />

        <Route
          path="/*"
          element={
            <ProtectedRoute>
              <Sidebar>
                <Routes>
                  <Route path="/" element={<AdsDashboardOptionA />} />
                  <Route path="/best-ad" element={<BestPerformingAd />} />
                  <Route path="/best-reel" element={<BestPerformingReel />} />
                  <Route path="/plan" element={<Plan />} />
                  <Route path="/audience" element={<Audience />} />
                  <Route path="/ai-insights" element={<AIInsights />} />
                  <Route path="/unique-leads" element={<UniqueLeads />} />
                  <Route path="/collaboration" element={<Collaboration />} />
                  <Route path="/operation/task" element={<Task />} />
                  <Route path="/report/daily" element={<Report />} />
                  <Route path="/high-five" element={<HighFiveLanding />} />
                  <Route path="/team-management" element={<TeamManagement />} />
                  <Route path="/manage-permissions/:userId" element={<ManagePermissions />} />
                </Routes>
              </Sidebar>
            </ProtectedRoute>
          }
        />
      </Routes>
    </BrowserRouter>
  );
}
