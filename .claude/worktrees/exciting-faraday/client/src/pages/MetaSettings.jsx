import React, { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { auth } from "../utils/auth";
import "./MetaSettings.css";

export default function MetaSettings() {
  const [formData, setFormData] = useState({
    appId: "",
    appSecret: "",
    adAccountId: "",
    accessToken: "",
    systemAccessToken: "",
  });
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState({ type: "", text: "" });
  const [credentialsStatus, setCredentialsStatus] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  const getToken = () => {
    try {
      const STORAGE_KEY = process.env.REACT_APP_STORAGE_KEY || "app_auth";
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const data = JSON.parse(stored);
        return data.token || null;
      }
    } catch (e) {
      console.error("Error getting token:", e);
    }
    return null;
  };

  useEffect(() => {
    const token = getToken();
    if (!token) {
      setIsAuthenticated(false);
      setMessage({ type: "error", text: "Please log in to save credentials" });
    } else {
      setIsAuthenticated(true);
      setMessage({ type: "", text: "" });
      loadCredentials();
    }
  }, []);

  const loadCredentials = async () => {
    try {
      const token = getToken();
      if (!token) return;

      const API_BASE = process.env.REACT_APP_API_BASE || "";
      const baseUrl = API_BASE && API_BASE.trim() !== "" 
        ? API_BASE.replace(/\/+$/, "")
        : "";
      
      // First, check if server is reachable
      try {
        const healthUrl = baseUrl ? `${baseUrl}/api/health` : "/api/health";
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout
        
        const healthRes = await fetch(healthUrl, { 
          method: "GET",
          signal: controller.signal
        });
        clearTimeout(timeoutId);
        
        if (!healthRes.ok) {
          throw new Error("Server health check failed");
        }
      } catch (healthError) {
        if (healthError.name === 'AbortError') {
          console.error("Server health check timed out");
        } else {
          console.error("Server health check failed:", healthError);
        }
        setMessage({ 
          type: "error", 
          text: "Cannot connect to server. Please ensure the server is running on port 4000." 
        });
        return;
      }

      const requestUrl = baseUrl 
        ? `${baseUrl}/api/meta/credentials`
        : "/api/meta/credentials";

      const res = await fetch(requestUrl, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (res.status === 401 || res.status === 403) {
        // Token is invalid or expired
        setIsAuthenticated(false);
        setMessage({ type: "error", text: "Please log in to save credentials" });
        return;
      }

      if (res.ok) {
        const data = await res.json();
        setCredentialsStatus(data);
        if (data.configured) {
          setFormData({
            appId: data.appId || "",
            appSecret: "", // Don't show secret
            adAccountId: data.adAccountId || "",
            accessToken: "", // Don't show token
          });
        }
      }
    } catch (error) {
      console.error("Error loading credentials:", error);
      if (error.name === 'AbortError' || error.name === 'TypeError') {
        setMessage({ 
          type: "error", 
          text: "Cannot connect to server. Please ensure the server is running on port 4000." 
        });
      }
    }
  };

  const handleChange = (e) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value,
    });
    // Only clear message if user is authenticated (don't clear auth error)
    if (isAuthenticated) {
      setMessage({ type: "", text: "" });
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setMessage({ type: "", text: "" });

    try {
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/cab85f09-d2ee-4a04-8381-ae9f6766f965',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'MetaSettings.jsx:72',message:'handleSubmit called',data:{hasFormData:!!formData,appId:formData.appId?formData.appId.substring(0,5)+'...':null,adAccountId:formData.adAccountId?formData.adAccountId.substring(0,5)+'...':null},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
      // #endregion

      if (!isAuthenticated) {
        setMessage({ type: "error", text: "Please log in to save credentials" });
        setSaving(false);
        return;
      }

      const token = getToken();
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/cab85f09-d2ee-4a04-8381-ae9f6766f965',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'MetaSettings.jsx:78',message:'Token retrieved',data:{hasToken:!!token,tokenLength:token?token.length:0},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
      // #endregion

      if (!token) {
        setIsAuthenticated(false);
        setMessage({ type: "error", text: "Please log in to save credentials" });
        setSaving(false);
        return;
      }

      // Use absolute URL with fallback to relative (for proxy)
      const API_BASE = process.env.REACT_APP_API_BASE || "";
      const requestUrl = API_BASE && API_BASE.trim() !== "" 
        ? `${API_BASE.replace(/\/+$/, "")}/api/meta/credentials`
        : "/api/meta/credentials";
      
      const requestBody = JSON.stringify(formData);
      const requestHeaders = {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      };

      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/cab85f09-d2ee-4a04-8381-ae9f6766f965',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'MetaSettings.jsx:93',message:'Before fetch request',data:{url:requestUrl,apiBase:API_BASE,method:'POST',hasBody:!!requestBody,bodyLength:requestBody.length,hasAuthHeader:!!requestHeaders.Authorization},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
      // #endregion

      const res = await fetch(requestUrl, {
        method: "POST",
        headers: requestHeaders,
        body: requestBody,
      });

      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/cab85f09-d2ee-4a04-8381-ae9f6766f965',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'MetaSettings.jsx:100',message:'After fetch response',data:{status:res.status,statusText:res.statusText,ok:res.ok,headers:Object.fromEntries(res.headers.entries())},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
      // #endregion

      // Handle authentication errors
      if (res.status === 401 || res.status === 403) {
        setIsAuthenticated(false);
        setMessage({ type: "error", text: "Please log in to save credentials" });
        setSaving(false);
        return;
      }

      let data;
      try {
        data = await res.json();
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/cab85f09-d2ee-4a04-8381-ae9f6766f965',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'MetaSettings.jsx:107',message:'Response JSON parsed',data:{hasData:!!data,error:data.error,success:data.success},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
        // #endregion
      } catch (parseError) {
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/cab85f09-d2ee-4a04-8381-ae9f6766f965',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'MetaSettings.jsx:111',message:'JSON parse error',data:{error:parseError.message},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
        // #endregion
        throw parseError;
      }

      if (res.ok) {
        setMessage({ type: "success", text: data.message || "Credentials saved successfully!" });
        await loadCredentials();
        // Clear sensitive fields
        setFormData({
          ...formData,
          appSecret: "",
          accessToken: "",
        });
      } else {
        setMessage({ type: "error", text: data.error || "Failed to save credentials" });
      }
    } catch (error) {
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/cab85f09-d2ee-4a04-8381-ae9f6766f965',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'MetaSettings.jsx:127',message:'Catch block - Network error',data:{errorName:error.name,errorMessage:error.message,errorStack:error.stack?.substring(0,200)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
      // #endregion
      
      // More detailed error message
      let errorMessage = "Network error. Please try again.";
      if (error.name === 'TypeError' && error.message.includes('fetch')) {
        errorMessage = "Cannot connect to server. Please ensure the server is running on port 4000.";
      } else if (error.message) {
        errorMessage = `Error: ${error.message}`;
      }
      
      setMessage({ type: "error", text: errorMessage });
      console.error("Error saving credentials:", error);
    } finally {
      setSaving(false);
    }
  };

  const cardVariants = {
    hidden: { opacity: 0, y: 20 },
    visible: {
      opacity: 1,
      y: 0,
      transition: { duration: 0.5 },
    },
  };

  return (
    <motion.div
      className="meta-settings-container"
      initial="hidden"
      animate="visible"
      variants={cardVariants}
    >
      <div className="settings-header">
        <h1>
          <span className="header-emoji">🔐</span> Meta API Settings
        </h1>
        <p className="settings-subtitle">
          Configure your Meta (Facebook) API credentials to connect your ad account
        </p>
      </div>

      {credentialsStatus?.configured && (
        <motion.div
          className="alert alert-info d-flex align-items-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
        >
          <span className="me-2">✅</span>
          <div>
            <strong>Credentials configured!</strong>
            {credentialsStatus.tokenExpiresAt && (
              <div className="small">
                Token expires: {new Date(credentialsStatus.tokenExpiresAt).toLocaleDateString()}
              </div>
            )}
          </div>
        </motion.div>
      )}

      {message.text && (
        <motion.div
          className={`alert alert-${message.type === "error" ? "danger" : "success"} ${!isAuthenticated && message.type === "error" ? "" : "alert-dismissible"} fade show`}
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
        >
          {message.text}
          {isAuthenticated || message.type !== "error" ? (
            <button
              type="button"
              className="btn-close"
              onClick={() => setMessage({ type: "", text: "" })}
            ></button>
          ) : null}
        </motion.div>
      )}

      <motion.div className="settings-card" variants={cardVariants}>
        <div className="card-body">
          <h3 className="card-title">
            <span className="title-emoji">📝</span> Enter Meta Credentials
          </h3>

          <form onSubmit={handleSubmit}>
            <div className="mb-3">
              <label htmlFor="appId" className="form-label">
                <span className="label-emoji">🆔</span> App ID
              </label>
              <input
                type="text"
                className="form-control"
                id="appId"
                name="appId"
                value={formData.appId}
                onChange={handleChange}
                placeholder="Enter your Meta App ID"
                required
                disabled={!isAuthenticated}
              />
              <small className="form-text text-muted">
                Found in Meta App Dashboard → Settings → Basic
              </small>
            </div>

            <div className="mb-3">
              <label htmlFor="appSecret" className="form-label">
                <span className="label-emoji">🔑</span> App Secret
              </label>
              <input
                type="password"
                className="form-control"
                id="appSecret"
                name="appSecret"
                value={formData.appSecret}
                onChange={handleChange}
                placeholder="Enter your Meta App Secret"
                required={!credentialsStatus?.configured}
                disabled={!isAuthenticated}
              />
              <small className="form-text text-muted">
                Found in Meta App Dashboard → Settings → Basic (click "Show")
              </small>
            </div>

            <div className="mb-3">
              <label htmlFor="adAccountId" className="form-label">
                <span className="label-emoji">📊</span> Ad Account ID
              </label>
              <input
                type="text"
                className="form-control"
                id="adAccountId"
                name="adAccountId"
                value={formData.adAccountId}
                onChange={handleChange}
                placeholder="act_123456789"
                required
                disabled={!isAuthenticated}
              />
              <small className="form-text text-muted">
                Format: act_XXXXXXXXX (found in Meta Ads Manager → Account Settings)
              </small>
            </div>

            <div className="mb-4">
              <label htmlFor="accessToken" className="form-label">
                <span className="label-emoji">🎫</span> Access Token (User Token)
              </label>
              <input
                type="password"
                className="form-control"
                id="accessToken"
                name="accessToken"
                value={formData.accessToken}
                onChange={handleChange}
                placeholder="Enter your Meta Access Token"
                required={!credentialsStatus?.configured}
                disabled={!isAuthenticated}
              />
              <small className="form-text text-muted">
                Generate from Meta Graph API Explorer or use a User Access Token (for campaigns, ads, insights)
              </small>
            </div>

            <div className="mb-4">
              <label htmlFor="systemAccessToken" className="form-label">
                <span className="label-emoji">🔐</span> System Access Token (Optional - for Leads)
              </label>
              <input
                type="password"
                className="form-control"
                id="systemAccessToken"
                name="systemAccessToken"
                value={formData.systemAccessToken}
                onChange={handleChange}
                placeholder="Enter System Access Token (for leads API only)"
                disabled={!isAuthenticated}
              />
              <small className="form-text text-muted">
                Separate token with 'leads_retrieval' permission for fetching leads. If not provided, user token will be used.
              </small>
            </div>

            <motion.button
              type="submit"
              className="btn btn-primary btn-lg w-100"
              disabled={saving || !isAuthenticated}
              whileHover={isAuthenticated && !saving ? { scale: 1.02 } : {}}
              whileTap={isAuthenticated && !saving ? { scale: 0.98 } : {}}
            >
              {saving ? (
                <>
                  <span className="spinner-border spinner-border-sm me-2"></span>
                  Saving...
                </>
              ) : (
                <>
                  <span className="me-2">💾</span>
                  {credentialsStatus?.configured ? "Update Credentials" : "Save Credentials"}
                </>
              )}
            </motion.button>
          </form>

          <div className="mt-4 p-3 bg-light rounded">
            <h5 className="mb-3">
              <span className="me-2">ℹ️</span> How to Get Your Credentials
            </h5>
            <ol>
              <li>
                Go to{" "}
                <a
                  href="https://developers.facebook.com/apps"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Meta for Developers
                </a>
              </li>
              <li>Create or select your app</li>
              <li>Get App ID and App Secret from Settings → Basic</li>
              <li>
                Get Access Token from{" "}
                <a
                  href="https://developers.facebook.com/tools/explorer"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Graph API Explorer
                </a>
              </li>
              <li>Get Ad Account ID from Meta Ads Manager → Account Settings</li>
            </ol>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

