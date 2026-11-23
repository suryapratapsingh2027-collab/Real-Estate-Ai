import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { Permission, RoleName } from '@rea/shared';
import { api, refreshAccessToken, tokenStore } from '@/services/api';

export type Me = { id: string; email: string; fullName: string; role: RoleName; brokerId: string | null; permissions: Permission[] };

type AuthState = {
  user: Me | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  can: (...perms: Permission[]) => boolean;
  reload: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const qc = useQueryClient();

  const loadMe = useCallback(async () => setUser(await api<Me>('/auth/me')), []);

  useEffect(() => {
    tokenStore.onLost(() => {
      tokenStore.set(null);
      setUser(null);
      qc.clear();
    });
    (async () => {
      try {
        if (await refreshAccessToken()) await loadMe();
      } catch {
        setUser(null);
      } finally {
        setLoading(false);
      }
    })();
  }, [loadMe, qc]);

  const login = useCallback(
    async (email: string, password: string) => {
      const r = await api<{ accessToken: string }>('/auth/login', { method: 'POST', body: { email, password }, auth: false });
      tokenStore.set(r.accessToken);
      await loadMe();
    },
    [loadMe],
  );

  const logout = useCallback(async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'include', headers: { 'X-Requested-With': 'XMLHttpRequest' } });
    } finally {
      tokenStore.set(null);
      setUser(null);
      qc.clear();
    }
  }, [qc]);

  const value = useMemo<AuthState>(
    () => ({
      user,
      loading,
      login,
      logout,
      reload: loadMe,
      can: (...perms) => Boolean(user && perms.every((p) => user.permissions.includes(p))),
    }),
    [user, loading, login, logout, loadMe],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
