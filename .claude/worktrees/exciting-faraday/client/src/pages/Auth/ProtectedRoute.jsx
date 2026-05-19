import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from './AuthProvider';

export default function ProtectedRoute({ children }) {
  const { token, loading } = useAuth();

  // while checking token, you might show a spinner: for simplicity we just block until check finishes
  if (loading) return <div className="p-4">Loading...</div>;

  if (!token) {
    return <Navigate to="/login" replace />;
  }
  return children;
}

