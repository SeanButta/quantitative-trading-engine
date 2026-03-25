/**
 * Auth Context + Login/Register UI
 * =================================
 * Provides:
 *   - AuthContext: { user, token, login, logout, register, isAuthenticated }
 *   - AuthProvider: wraps the app and restores session from sessionStorage
 *   - AuthScreen: beautiful login/register modal rendered when not authenticated
 *   - useAuth(): hook to consume the context
 *
 * Token strategy (cross-origin Vercel → Railway):
 *   - Access token stored in React state + sessionStorage (cleared on tab close)
 *   - On page reload, restores token from sessionStorage and validates via /auth/me
 *   - No refresh token in MVP; user re-logs in after ACCESS_TOKEN_EXPIRE_MINUTES (default 60min)
 */

import React, {
  createContext, useCallback, useContext, useEffect, useRef, useState,
} from "react";

// ---------------------------------------------------------------------------
// Demo Mode — set to false to re-enable auth
// ---------------------------------------------------------------------------
// When true: everyone gets full access without logging in.
// To re-enable auth: change this to false and redeploy.
const DEMO_MODE = true;

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const AuthCtx = createContext(null);

export function useAuth() {
  return useContext(AuthCtx);
}

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

const SESSION_KEY = "qt_token";
const USER_KEY    = "qt_user";

async function apiPost(path, body, token) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(path, { method: "POST", headers, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || `HTTP ${res.status}`);
  return data;
}

async function apiGet(path, token) {
  const headers = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(path, { headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || `HTTP ${res.status}`);
  return data;
}

// ---------------------------------------------------------------------------
// AuthProvider
// ---------------------------------------------------------------------------

export function AuthProvider({ children }) {
  // ── Demo Mode shortcut ──────────────────────────────────────────────────
  if (DEMO_MODE) {
    const demoValue = {
      user:            { user_id: 0, email: "demo@picador.app", display_name: "Demo", tier: "free" },
      token:           "demo-mode",
      ready:           true,
      isAuthenticated: true,
      login:           async () => {},
      logout:          () => {},
      register:        async () => {},
      authFetch:       (url, opts = {}) => fetch(url, opts),
    };
    return <AuthCtx.Provider value={demoValue}>{children}</AuthCtx.Provider>;
  }

  const [user,  setUser]  = useState(null);   // { user_id, email, display_name, tier }
  const [token, setToken] = useState(null);
  const [ready, setReady] = useState(false);  // false = still rehydrating from sessionStorage

  // ── Rehydrate on mount ──────────────────────────────────────────────────
  useEffect(() => {
    const savedToken = sessionStorage.getItem(SESSION_KEY);
    const savedUser  = sessionStorage.getItem(USER_KEY);
    if (savedToken && savedUser) {
      try {
        const parsedUser = JSON.parse(savedUser);
        // Optimistically restore; validate in background
        setToken(savedToken);
        setUser(parsedUser);
        // Background validation (refresh user profile)
        apiGet("/api/auth/me", savedToken)
          .then(profile => {
            setUser({ ...parsedUser, ...profile });
            sessionStorage.setItem(USER_KEY, JSON.stringify({ ...parsedUser, ...profile }));
          })
          .catch(() => {
            // Token expired / revoked — clear session
            sessionStorage.removeItem(SESSION_KEY);
            sessionStorage.removeItem(USER_KEY);
            setToken(null);
            setUser(null);
          });
      } catch {
        sessionStorage.removeItem(SESSION_KEY);
        sessionStorage.removeItem(USER_KEY);
      }
    }
    setReady(true);
  }, []);

  // ── Login ────────────────────────────────────────────────────────────────
  const login = useCallback(async (email, password) => {
    const data = await apiPost("/api/auth/login", { email, password });
    _persistSession(data);
    return data;
  }, []);

  // ── Register ─────────────────────────────────────────────────────────────
  const register = useCallback(async (email, password, display_name) => {
    const data = await apiPost("/api/auth/register", { email, password, display_name });
    _persistSession(data);
    return data;
  }, []);

  // ── Logout ───────────────────────────────────────────────────────────────
  const logout = useCallback(() => {
    sessionStorage.removeItem(SESSION_KEY);
    sessionStorage.removeItem(USER_KEY);
    setToken(null);
    setUser(null);
  }, []);

  function _persistSession(data) {
    const userObj = {
      user_id:      data.user_id,
      email:        data.email,
      display_name: data.display_name,
      tier:         data.tier,
    };
    sessionStorage.setItem(SESSION_KEY, data.access_token);
    sessionStorage.setItem(USER_KEY, JSON.stringify(userObj));
    setToken(data.access_token);
    setUser(userObj);
  }

  // ── Authenticated fetch helper ────────────────────────────────────────────
  const authFetch = useCallback(async (url, options = {}) => {
    if (!token) throw new Error("Not authenticated");
    const headers = { ...(options.headers || {}), Authorization: `Bearer ${token}` };
    return fetch(url, { ...options, headers });
  }, [token]);

  const value = {
    user,
    token,
    ready,
    isAuthenticated: !!token && !!user,
    login,
    logout,
    register,
    authFetch,
  };

  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

// ---------------------------------------------------------------------------
// AuthScreen — rendered when !isAuthenticated
// ---------------------------------------------------------------------------

const S = {
  overlay: {
    position: "fixed", inset: 0,
    background: "linear-gradient(135deg, #050508 0%, #0d0d1a 50%, #050508 100%)",
    display: "flex", alignItems: "center", justifyContent: "center",
    zIndex: 9999, padding: 16,
  },
  card: {
    width: "100%", maxWidth: 420,
    background: "rgba(255,255,255,0.04)",
    border: "1px solid rgba(255,255,255,0.08)",
    borderRadius: 16, padding: "40px 36px",
    boxShadow: "0 32px 80px rgba(0,0,0,0.6)",
  },
  logo: {
    textAlign: "center", marginBottom: 32,
  },
  logoText: {
    fontSize: 22, fontWeight: 700, color: "#e2e8f0",
    letterSpacing: -0.5,
  },
  logoSub: {
    fontSize: 11, color: "#64748b", marginTop: 4, letterSpacing: 1,
  },
  tabs: {
    display: "flex", gap: 4, marginBottom: 28,
    background: "rgba(255,255,255,0.04)", borderRadius: 10, padding: 4,
  },
  tab: (active) => ({
    flex: 1, padding: "8px 0", fontSize: 13, fontWeight: 600,
    borderRadius: 8, border: "none", cursor: "pointer", transition: "all .15s",
    background: active ? "rgba(99,102,241,0.25)" : "transparent",
    color: active ? "#818cf8" : "#64748b",
  }),
  field: {
    marginBottom: 14,
  },
  label: {
    display: "block", fontSize: 11, color: "#94a3b8",
    marginBottom: 5, fontWeight: 600, letterSpacing: 0.5,
  },
  input: {
    width: "100%", padding: "10px 13px", fontSize: 14,
    background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)",
    borderRadius: 8, color: "#e2e8f0", outline: "none", boxSizing: "border-box",
    transition: "border-color .15s",
  },
  btn: (loading) => ({
    width: "100%", padding: "12px 0", marginTop: 8,
    fontSize: 14, fontWeight: 700, borderRadius: 10, border: "none",
    cursor: loading ? "not-allowed" : "pointer",
    background: loading
      ? "rgba(99,102,241,0.3)"
      : "linear-gradient(135deg, #6366f1 0%, #818cf8 100%)",
    color: loading ? "#64748b" : "#fff",
    transition: "all .15s",
    letterSpacing: 0.3,
  }),
  err: {
    marginTop: 12, padding: "9px 12px",
    background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.25)",
    borderRadius: 8, fontSize: 12, color: "#fca5a5", textAlign: "center",
  },
  divider: {
    display: "flex", alignItems: "center", gap: 10, margin: "20px 0",
  },
  divLine: { flex: 1, height: 1, background: "rgba(255,255,255,0.07)" },
  divText: { fontSize: 11, color: "#475569" },
  demoBtn: {
    width: "100%", padding: "10px 0",
    fontSize: 13, fontWeight: 600, borderRadius: 10,
    border: "1px solid rgba(255,255,255,0.1)",
    background: "transparent", color: "#94a3b8", cursor: "pointer",
    transition: "all .15s",
  },
  footnote: {
    marginTop: 20, fontSize: 11, color: "#475569", textAlign: "center",
    lineHeight: 1.6,
  },
};

export function AuthScreen({ onDemoMode }) {
  const { login, register } = useAuth();
  const [mode,   setMode]   = useState("login");   // login | register
  const [email,  setEmail]  = useState("");
  const [pass,   setPass]   = useState("");
  const [name,   setName]   = useState("");
  const [busy,   setBusy]   = useState(false);
  const [err,    setErr]    = useState("");

  async function submit(e) {
    e.preventDefault();
    setErr(""); setBusy(true);
    try {
      if (mode === "login") {
        await login(email, pass);
      } else {
        await register(email, pass, name);
      }
    } catch (ex) {
      setErr(ex.message || "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={S.overlay}>
      <div style={S.card}>
        {/* Logo */}
        <div style={S.logo}>
          <div style={S.logoText}>⚡ Quant Engine</div>
          <div style={S.logoSub}>QUANTITATIVE TRADING PLATFORM</div>
        </div>

        {/* Tabs */}
        <div style={S.tabs}>
          <button style={S.tab(mode === "login")}    onClick={() => { setMode("login");    setErr(""); }}>Sign In</button>
          <button style={S.tab(mode === "register")} onClick={() => { setMode("register"); setErr(""); }}>Create Account</button>
        </div>

        <form onSubmit={submit}>
          {mode === "register" && (
            <div style={S.field}>
              <label style={S.label}>DISPLAY NAME</label>
              <input
                style={S.input}
                type="text"
                placeholder="Your name"
                value={name}
                onChange={e => setName(e.target.value)}
                autoComplete="name"
              />
            </div>
          )}
          <div style={S.field}>
            <label style={S.label}>EMAIL</label>
            <input
              style={S.input}
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              autoComplete="email"
            />
          </div>
          <div style={S.field}>
            <label style={S.label}>PASSWORD</label>
            <input
              style={S.input}
              type="password"
              placeholder={mode === "register" ? "Min. 8 characters" : "Your password"}
              value={pass}
              onChange={e => setPass(e.target.value)}
              required
              autoComplete={mode === "register" ? "new-password" : "current-password"}
            />
          </div>

          {err && <div style={S.err}>{err}</div>}

          <button type="submit" style={S.btn(busy)} disabled={busy}>
            {busy ? "…" : mode === "login" ? "Sign In" : "Create Account"}
          </button>
        </form>

        {/* Demo mode divider */}
        <div style={S.divider}>
          <div style={S.divLine} />
          <span style={S.divText}>OR</span>
          <div style={S.divLine} />
        </div>
        <button style={S.demoBtn} onClick={onDemoMode}>
          Continue in Demo Mode
        </button>

        <div style={S.footnote}>
          Demo mode saves data to this browser only.<br/>
          Sign in to sync across devices and unlock full features.
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// UserMenu — small top-right widget in the main app
// ---------------------------------------------------------------------------

export function UserMenu() {
  const { user, logout } = useAuth();
  const [open, setOpen]  = useState(false);
  const ref              = useRef();

  useEffect(() => {
    function handler(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  if (!user) return null;

  const tierBadge = {
    free:  { label: "FREE",  color: "#64748b" },
    pro:   { label: "PRO",   color: "#818cf8" },
    admin: { label: "ADMIN", color: "#f59e0b" },
  }[user.tier] || { label: user.tier?.toUpperCase(), color: "#64748b" };

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          display: "flex", alignItems: "center", gap: 8,
          padding: "5px 10px", borderRadius: 8,
          background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)",
          cursor: "pointer", color: "#e2e8f0", fontSize: 12, fontWeight: 600,
        }}
      >
        <div style={{
          width: 24, height: 24, borderRadius: "50%",
          background: "linear-gradient(135deg,#6366f1,#818cf8)",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 11, fontWeight: 800, color: "#fff",
        }}>
          {(user.display_name || user.email || "?")[0].toUpperCase()}
        </div>
        <span>{user.display_name || user.email?.split("@")[0]}</span>
        <span style={{
          fontSize: 9, padding: "2px 5px", borderRadius: 4,
          background: "rgba(99,102,241,0.15)", color: tierBadge.color, fontWeight: 700,
        }}>
          {tierBadge.label}
        </span>
      </button>

      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 8px)", right: 0,
          background: "#0f1117", border: "1px solid rgba(255,255,255,0.1)",
          borderRadius: 10, padding: "6px 0", minWidth: 160,
          boxShadow: "0 8px 32px rgba(0,0,0,0.5)", zIndex: 1000,
        }}>
          <div style={{ padding: "8px 14px 6px", fontSize: 11, color: "#475569" }}>
            {user.email}
          </div>
          <div style={{ height: 1, background: "rgba(255,255,255,0.07)", margin: "4px 0" }} />
          <button
            onClick={() => { setOpen(false); logout(); }}
            style={{
              width: "100%", padding: "8px 14px", textAlign: "left",
              background: "none", border: "none", cursor: "pointer",
              color: "#f87171", fontSize: 13, fontWeight: 600,
            }}
          >
            Sign Out
          </button>
        </div>
      )}
    </div>
  );
}
