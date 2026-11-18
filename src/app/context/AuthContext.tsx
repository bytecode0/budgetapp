import { createContext, useContext, useEffect, useRef, useState } from "react";
import i18n from "i18next";

export interface AuthUser {
  id: string;
  name: string | null;
  email: string | null;
  image: string | null;
  plan: "free" | "premium";
  subscriptionStatus: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
}

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<{ error?: string; code?: string }>;
  register: (name: string, email: string, password: string) => Promise<{ error?: string; code?: string }>;
  /** null when a sign-out was already under way (that one reports the result). */
  logout: () => Promise<{ ok: boolean } | null>;
  /** True while a sign-out request is in flight, for every sign-out button. */
  signingOut: boolean;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [signingOut, setSigningOut] = useState(false);
  const signingOutRef = useRef(false);

  const fetchMe = async () => {
    try {
      const res = await fetch("/api/auth/me", { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        setUser(data.user);
      } else {
        setUser(null);
      }
    } catch {
      setUser(null);
    }
  };

  useEffect(() => {
    fetchMe().finally(() => setLoading(false));

    // Re-verify auth when browser restores page from bfcache (back/forward navigation).
    // Without this, the browser restores the React heap with user still set,
    // even though the auth cookie was cleared on logout.
    const handlePageShow = (e: PageTransitionEvent) => {
      if (e.persisted) {
        fetchMe();
      }
    };
    window.addEventListener("pageshow", handlePageShow);
    return () => window.removeEventListener("pageshow", handlePageShow);
  }, []);

  const login = async (email: string, password: string) => {
    const res = await fetch("/api/auth/login", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!res.ok) return { error: data.error || "Login failed", code: data.code };
    setUser(data.user);
    return {};
  };

  const register = async (name: string, email: string, password: string) => {
    const res = await fetch("/api/auth/register", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      // The server accepts only "es" | "en"; Spanish is the default.
      body: JSON.stringify({ name, email, password, language: i18n.language === "en" ? "en" : "es" }),
    });
    const data = await res.json();
    if (!res.ok) return { error: data.error || "Registration failed", code: data.code };
    return {};
  };

  // Always ends the local session, even if the request fails (offline,
  // server error): `ok` says whether the server confirmed it. One at a time:
  // a second call while one is in flight sends nothing and returns null.
  const logout = async () => {
    if (signingOutRef.current) return null;
    signingOutRef.current = true;
    setSigningOut(true);
    let ok = false;
    try {
      const res = await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
      ok = res.ok;
    } catch {
      ok = false;
    }
    signingOutRef.current = false;
    setSigningOut(false);
    setUser(null);
    return { ok };
  };

  const refreshUser = async () => {
    await fetchMe();
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout, signingOut, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
