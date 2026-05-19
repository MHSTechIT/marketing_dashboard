import React, { createContext, useContext, useEffect, useState } from 'react';

// Change baseURL if your server runs elsewhere
const API_BASE = process.env.REACT_APP_API_BASE || 'http://localhost:4000';

const AuthContext = createContext(null);

export function useAuth() {
  return useContext(AuthContext);
}

function storageKey() {
  return 'ads_dashboard_auth';
}

export function AuthProvider({ children }) {
  const [token, setToken] = useState(() => {
    try {
      const raw = localStorage.getItem(storageKey());
      if (!raw) return null;
      const data = JSON.parse(raw);
      return data.token || null;
    } catch {
      return null;
    }
  });
  const [user, setUser] = useState(() => {
    try {
      const raw = localStorage.getItem(storageKey());
      if (!raw) return null;
      return JSON.parse(raw).user || null;
    } catch {
      return null;
    }
  });
  const [loading, setLoading] = useState(false);

  // Save to storage
  const persist = (tok, usr) => {
    setToken(tok);
    setUser(usr);
    if (tok) {
      localStorage.setItem(storageKey(), JSON.stringify({ token: tok, user: usr }));
    } else {
      localStorage.removeItem(storageKey());
    }
  };

  const login = async (email, password) => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Login failed');
      }
      const { token: tok, user: usr } = await res.json();
      persist(tok, usr);
      return usr;
    } finally {
      setLoading(false);
    }
  };

  const signup = async (email, password, fullName) => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/auth/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, fullName }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Signup failed');
      }
      const { token: tok, user: usr } = await res.json();
      persist(tok, usr);
      return usr;
    } finally {
      setLoading(false);
    }
  };

  const logout = () => {
    persist(null, null);
  };

  // get current user from server (verifies token)
  const fetchMe = async () => {
    if (!token) return null;
    try {
      const res = await fetch(`${API_BASE}/api/auth/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Failed to fetch user');
      const data = await res.json();
      setUser(data);
      // refresh storage
      localStorage.setItem(storageKey(), JSON.stringify({ token, user: data }));
      return data;
    } catch {
      // token invalid -> logout
      logout();
      return null;
    }
  };

  // helper for API calls that need Authorization header
  const fetchWithAuth = async (url, options = {}) => {
    const hdrs = options.headers ? { ...options.headers } : {};
    if (token) hdrs['Authorization'] = `Bearer ${token}`;
    const res = await fetch(url, { ...options, headers: hdrs });
    return res;
  };

  // Optionally validate token on mount:
  useEffect(() => {
    if (token && !user) {
      // attempt to fetch user, but don't block UI
      fetchMe().catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const value = {
    token,
    user,
    loading,
    login,
    signup,
    logout,
    fetchWithAuth,
    fetchMe,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
