import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { auth } from "../../utils/auth";
import "./AuthPages.css";


const API_BASE = process.env.REACT_APP_API_BASE || "http://localhost:4000";
const STORAGE_KEY =
  "59ca69f53c01829c41b079fb15fb5b9bc7ed726f15afdc9da7e57f83543fca15a06130d30bbf6744243d936c7b19d494353d7a55e742b0404ebd6c4704efd50c";

export default function Signup() {
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const buildSignupUrl = () => {
    if (typeof API_BASE === "string" && API_BASE.trim() !== "") {
      return API_BASE.replace(/\/+$/g, "") + "/api/auth/signup";
    }
    return "/api/auth/signup";
  };

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");

    if (!username || !password || !confirm) {
      setError("Please fill in all fields");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(buildSignupUrl(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: username, password, fullName }),
      });

      let payload = {};
      try {
        payload = await res.json();
      } catch {
        payload = {};
      }

      if (!res.ok) {
        setError(payload?.error || payload?.message || "Signup failed");
        return;
      }

      const token = payload?.token;
      const user = payload?.user;

      if (!token) {
        setError("Signup failed: no token returned");
        return;
      }

      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ token, user }));
      } catch {}

      try {
        if (auth && typeof auth.login === "function") {
          auth.login(token, user);
        }
      } catch {}

      navigate("/");
    } catch {
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
        <div className="authCard" role="region" aria-label="Signup form">
          <h1 className="authTitle">Welcome Back!</h1>
          <p className="authSubtitle">Create your account</p>

          {error && (
            <div className="authAlert" role="alert">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} noValidate>
            <div className="authField">
              <div className="authInputRow">
                <div className="authIconBox" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none">
                    <path
                      d="M12 12c2.4853 0 4.5-2.0147 4.5-4.5S14.4853 3 12 3 7.5 5.0147 7.5 7.5 9.5147 12 12 12Z"
                      stroke="white"
                      strokeOpacity="0.9"
                      strokeWidth="1.6"
                    />
                    <path
                      d="M4.5 21c1.2-3.6 4.2-6 7.5-6s6.3 2.4 7.5 6"
                      stroke="white"
                      strokeOpacity="0.9"
                      strokeWidth="1.6"
                      strokeLinecap="round"
                    />
                  </svg>
                </div>
                <div className="authLabelCol">
                  <label className="authLabel" htmlFor="signupFullName">Full Name</label>
                  <input
                    id="signupFullName"
                    type="text"
                    className="authInput"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    disabled={loading}
                    placeholder="(optional)"
                    autoComplete="name"
                  />
                </div>
              </div>
            </div>

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
                  <label className="authLabel" htmlFor="signupEmail">Email</label>
                  <input
                    id="signupEmail"
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
                      stroke="white"
                      strokeOpacity="0.9"
                      strokeWidth="1.6"
                      strokeLinecap="round"
                    />
                    <path
                      d="M7.5 10H16.5C17.3284 10 18 10.6716 18 11.5V18.5C18 19.3284 17.3284 20 16.5 20H7.5C6.67157 20 6 19.3284 6 18.5V11.5C6 10.6716 6.67157 10 7.5 10Z"
                      stroke="white"
                      strokeOpacity="0.9"
                      strokeWidth="1.6"
                    />
                  </svg>
                </div>
                <div className="authLabelCol">
                  <label className="authLabel" htmlFor="signupPassword">Password</label>
                  <input
                    id="signupPassword"
                    type="password"
                    className="authInput"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    disabled={loading}
                    placeholder="Create a password"
                    autoComplete="new-password"
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
                      stroke="white"
                      strokeOpacity="0.9"
                      strokeWidth="1.6"
                      strokeLinecap="round"
                    />
                    <path
                      d="M7.5 10H16.5C17.3284 10 18 10.6716 18 11.5V18.5C18 19.3284 17.3284 20 16.5 20H7.5C6.67157 20 6 19.3284 6 18.5V11.5C6 10.6716 6.67157 10 7.5 10Z"
                      stroke="white"
                      strokeOpacity="0.9"
                      strokeWidth="1.6"
                    />
                    <path
                      d="M12 13V17"
                      stroke="white"
                      strokeOpacity="0.9"
                      strokeWidth="1.6"
                      strokeLinecap="round"
                    />
                  </svg>
                </div>
                <div className="authLabelCol">
                  <label className="authLabel" htmlFor="signupConfirm">Confirm</label>
                  <input
                    id="signupConfirm"
                    type="password"
                    className="authInput"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    required
                    disabled={loading}
                    placeholder="Confirm password"
                    autoComplete="new-password"
                  />
                </div>
              </div>
            </div>

            <button className="authPrimaryBtn" disabled={loading} type="submit">
              {loading ? "Creating…" : "Sign Up"}
            </button>

            <div className="authDivider">OR</div>

            <div className="authFooterLink">
              Already have an account? <Link to="/login">Login</Link>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
