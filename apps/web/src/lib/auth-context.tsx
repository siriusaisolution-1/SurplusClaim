import { useRouter } from 'next/router';
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';

import { API_BASE_URL } from './api';

export type UserRole = 'SUPER_ADMIN' | 'TENANT_ADMIN' | 'REVIEWER' | 'OPS' | 'B2B_CLIENT' | 'READ_ONLY';

export interface UserProfile {
  id: string;
  tenantId: string;
  email: string;
  fullName: string;
  role: UserRole;
}

interface AuthState {
  user: UserProfile | null;
  accessToken: string | null;
  refreshToken: string | null;
  loading: boolean;
  login: (tenantId: string, email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

function persistSession(user: UserProfile, accessToken: string, refreshToken: string) {
  if (typeof window === 'undefined') return;
  localStorage.setItem('auth:user', JSON.stringify(user));
  localStorage.setItem('auth:accessToken', accessToken);
  localStorage.setItem('auth:refreshToken', refreshToken);
}

function clearSession() {
  if (typeof window === 'undefined') return;
  localStorage.removeItem('auth:user');
  localStorage.removeItem('auth:accessToken');
  localStorage.removeItem('auth:refreshToken');
}

export const AuthProvider: React.FC<React.PropsWithChildren> = ({ children }) => {
  const router = useRouter();
  const [user, setUser] = useState<UserProfile | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const storedUser = localStorage.getItem('auth:user');
    const storedAccess = localStorage.getItem('auth:accessToken');
    const storedRefresh = localStorage.getItem('auth:refreshToken');
    if (storedUser && storedAccess && storedRefresh) {
      setUser(JSON.parse(storedUser));
      setAccessToken(storedAccess);
      setRefreshToken(storedRefresh);
    }
    setLoading(false);
  }, []);

  const login = async (tenantId: string, email: string, password: string) => {
    const response = await fetch(`${API_BASE_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tenantId, email, password })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message ?? 'Unable to login');
    }

    const payload = await response.json();
    setUser(payload.user);
    setAccessToken(payload.accessToken);
    setRefreshToken(payload.refreshToken);
    persistSession(payload.user, payload.accessToken, payload.refreshToken);
    void router.push('/');
  };

  const refresh = async () => {
    if (!refreshToken) return;
    const response = await fetch(`${API_BASE_URL}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken })
    });

    if (response.ok) {
      const payload = await response.json();
      setUser(payload.user);
      setAccessToken(payload.accessToken);
      setRefreshToken(payload.refreshToken);
      persistSession(payload.user, payload.accessToken, payload.refreshToken);
    } else {
      clearSession();
      setUser(null);
      setAccessToken(null);
      setRefreshToken(null);
    }
  };

  const logout = async () => {
    if (accessToken) {
      await fetch(`${API_BASE_URL}/auth/logout`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`
        },
        body: JSON.stringify({ refreshToken })
      });
    }
    clearSession();
    setUser(null);
    setAccessToken(null);
    setRefreshToken(null);
    void router.push('/login');
  };

  const value = useMemo(
    () => ({ user, accessToken, refreshToken, loading, login, logout, refresh }),
    [user, accessToken, refreshToken, loading]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
