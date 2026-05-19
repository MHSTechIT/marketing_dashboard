import React, { useState } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { auth } from "../../utils/auth";
import "./AuthPages.css";

const API_BASE = process.env.REACT_APP_API_BASE || "";
const STORAGE_KEY = process.env.REACT_APP_STORAGE_KEY || "app_auth";

export default function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const buildLoginUrl = () => {
    if (typeof API_BASE === "string" && API_BASE.trim() !== "") {
      return API_BASE.replace(/\/+$/g, "") + "/api/auth/login";
    }
    return "/api/auth/login";
  };
  const handleClick = () => {
    window.location.href = 'https://www.google.com'; 
  };

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");

    const email = String(username || "").trim();
    const pw = String(password || "");

    if (!email || !pw) {
      setError("Please fill in all fields");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(buildLoginUrl(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password: pw }),
      });

      let payload = {};
      try {
        payload = await res.json();
      } catch (err) {
        payload = {};
      }

      if (!res.ok) {
        setError(payload?.error || payload?.message || "Invalid credentials");
        return;
      }

      const token = payload?.token;
      const user = payload?.user;

      if (!token) {
        setError("Login failed: no token received");
        return;
      }

      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ token, user }));
      } catch (err) {}

      try {
        if (auth && typeof auth.login === "function") {
          auth.login(token, user);
        }
      } catch (err) {}

      const from = location.state?.from ?? "/";
      navigate(from, { replace: true });
    } catch (err) {
      const base = process.env.REACT_APP_API_BASE || "";
      setError(
        base
          ? "Network error — please try again. Check that the API server is running and reachable."
          : "Network error — API URL is not set. For production, set REACT_APP_API_BASE to your backend URL and redeploy."
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="authPage">
      <div className="authCardWrap">
        <div className="authCard" role="region" aria-label="Login form">
          <h1 className="authTitle">Welcome Back!</h1>
          <p className="authSubtitle">Sign in to your account</p>

          {error && (
            <div className="authAlert" role="alert">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit}>
            <div className="authField">
              <div className="authInputRow">
                <div className="authIconBox" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none">
                    <path
                      d="M4 6.5C4 5.67157 4.67157 5 5.5 5H18.5C19.3284 5 20 5.67157 20 6.5V17.5C20 18.3284 19.3284 19 18.5 19H5.5C4.67157 19 4 18.3284 4 17.5V6.5Z"
                      stroke="white"
                      strokeOpacity="0.9"
                      strokeWidth="1.6"
                    />
                    <path
                      d="M5.5 7L12 11.5L18.5 7"
                      stroke="white"
                      strokeOpacity="0.9"
                      strokeWidth="1.6"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </div>
                <div className="authLabelCol">
                  <label className="authLabel" htmlFor="loginEmail">Email</label>
                  <input
                    id="loginEmail"
                    type="email"
                    className="authInput"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    required
                    disabled={loading}
                    placeholder="Enter your email"
                    autoComplete="email"
                  />
                </div>
              </div>
            </div>

            <div className="authField">
              <div className="authInputRow">
                <div className="authIconBox" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none">
                    <path
                      d="M7.5 10V8.5C7.5 6.01472 9.51472 4 12 4C14.4853 4 16.5 6.01472 16.5 8.5V10"
                      stroke="black"
                      strokeOpacity="0.9"
                      strokeWidth="1.6"
                      strokeLinecap="round"
                    />
                    <path
                      d="M7.5 10H16.5C17.3284 10 18 10.6716 18 11.5V18.5C18 19.3284 17.3284 20 16.5 20H7.5C6.67157 20 6 19.3284 6 18.5V11.5C6 10.6716 6.67157 10 7.5 10Z"
                      stroke="black"
                      strokeOpacity="0.9"
                      strokeWidth="1.6"
                    />
                  </svg>
                </div>
                <div className="authLabelCol">
                  <label className="authLabel" htmlFor="loginPassword">Password</label>
                  <input
                    id="loginPassword"
                    type="password"
                    className="authInput"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    disabled={loading}
                    placeholder="Enter your password"
                    autoComplete="current-password"
                  />
                </div>
              </div>
            </div>

            <button className="authPrimaryBtn" disabled={loading} type="submit">
              {loading ? "Signing in…" : "Login"}
            </button>

            {/* Keep existing handler around (not shown in UI now) */}
            <div style={{ display: "none" }}>
              <button type="button" onClick={handleClick}>Hidden</button>
            </div>

            <div className="authDivider">OR</div>

            <div className="authFooterLink">
              Don&apos;t have an account? <Link to="/signup">Sign Up</Link>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}