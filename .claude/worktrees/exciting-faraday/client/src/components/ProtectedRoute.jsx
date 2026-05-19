import React from "react";
import { Navigate } from "react-router-dom";
import { auth } from "../utils/auth";

export default function ProtectedRoute({ children }) {
  if (!auth.isAuthenticated()) {
    return <Navigate to="/login" replace />;
  }
  return children;
}
