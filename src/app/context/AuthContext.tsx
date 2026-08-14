import { createContext, useContext, useEffect, useState } from "react";

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
  hydrating: boolean;
  login: (email: string, password: string) => Promise<{ error?: string; code?: string }>;
  register: (name: string, email: string, password: string) => Promise<{ error?: string }>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [hydrating, setHydrating] = useState(false);

  // If the user arrived from the Radiografía flow, import that session's data
  // into their fresh account before we expose them to the app — so the data
  // hooks mount with everything already in place. One-shot; cleared after.
  const claimPendingXray = async () => {
    const sid = localStorage.getItem("xraySessionId");
    if (!sid) return;
    setHydrating(true);
    try {
      await fetch("/api/xray/claim", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: sid }),
      });
    } catch {
      // Best-effort: a failed hydration must not block sign-in.
    } finally {
      localStorage.removeItem("xraySessionId");
      setHydrating(false);
    }
  };

  const fetchMe = async () => {
    try {
      const res = await fetch("/api/auth/me", { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        await claimPendingXray();
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
    await claimPendingXray();
    setUser(data.user);
    return {};
  };

  const register = async (name: string, email: string, password: string) => {
    const res = await fetch("/api/auth/register", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, email, password }),
    });
    const data = await res.json();
    if (!res.ok) return { error: data.error || "Registration failed" };
    return {};
  };

  const logout = async () => {
    await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    setUser(null);
  };

  const refreshUser = async () => {
    await fetchMe();
  };

  return (
    <AuthContext.Provider value={{ user, loading, hydrating, login, register, logout, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
