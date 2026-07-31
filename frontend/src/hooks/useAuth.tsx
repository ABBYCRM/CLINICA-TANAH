import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { api, setTenantOverride, getTenantOverride } from '../lib/api';

interface User {
  id: string;
  email: string;
  full_name: string;
  role: string;
  tenant_id: string;
  tenant_name?: string;
  is_superadmin?: boolean;
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  effectiveTenantId: string | null;
  setEffectiveTenantId: (id: string | null) => void;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [effectiveTenantId, setEffectiveTenantIdState] = useState<string | null>(getTenantOverride());

  useEffect(() => {
    const stored = localStorage.getItem('auth_user');
    if (stored) {
      try { setUser(JSON.parse(stored)); } catch { /* ignore */ }
    }
    // Refresh from /me so upgrades (tenant_id, is_superadmin) apply without re-login
    const token = localStorage.getItem('auth_token');
    if (!token) { setLoading(false); return; }
    api.get('/api/auth/me')
      .then((d) => {
        const u = d.user;
        if (!u) return;
        const next = {
          id: u.id,
          email: u.email,
          full_name: u.full_name,
          role: u.role,
          tenant_id: u.tenant_id,
          tenant_name: u.tenant_name || u.effective_tenant_name,
          is_superadmin: !!u.is_superadmin,
        };
        localStorage.setItem('auth_user', JSON.stringify(next));
        setUser(next);
      })
      .catch((e: any) => {
        // Only wipe the session on auth failures — transient network blips keep the cached user
        const status = e?.status;
        const code = e?.body?.error || e?.message;
        if (status === 401 || code === 'invalid_token' || code === 'unauthorized') {
          localStorage.removeItem('auth_token');
          localStorage.removeItem('auth_user');
          setTenantOverride(null);
          setUser(null);
        }
      })
      .finally(() => setLoading(false));
  }, []);

  const setEffectiveTenantId = (id: string | null) => {
    setTenantOverride(id);
    setEffectiveTenantIdState(id);
  };

  const login = async (email: string, password: string) => {
    const res = await api.post('/api/auth/login', { email, password });
    localStorage.setItem('auth_token', res.token);
    localStorage.setItem('auth_user', JSON.stringify(res.user));
    setTenantOverride(null);
    setEffectiveTenantIdState(null);
    setUser(res.user);
  };

  const logout = () => {
    localStorage.removeItem('auth_token');
    localStorage.removeItem('auth_user');
    setTenantOverride(null);
    setEffectiveTenantIdState(null);
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, effectiveTenantId, setEffectiveTenantId, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
