import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import axios from 'axios';
import { api, type ApiErrorBody } from '../api/client';

export type UserRole = 'donor' | 'ngo' | 'volunteer' | 'admin';
export interface CurrentUser {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
  organizationId?: string;
  organizationName?: string;
  verificationStatus?: 'pending' | 'verified' | 'rejected';
  verificationNote?: string | null;
}

interface AuthContextValue {
  user: CurrentUser | null;
  loading: boolean;
  login(email: string, password: string): Promise<void>;
  register(payload: Record<string, unknown>): Promise<void>;
  logout(): void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = sessionStorage.getItem('foodloop.accessToken');
    if (!token) { setLoading(false); return; }
    api.get<{ data: { user: CurrentUser } }>('/auth/me')
      .then(({ data }) => setUser(data.data.user))
      .catch(() => { sessionStorage.removeItem('foodloop.accessToken'); setUser(null); })
      .finally(() => setLoading(false));
  }, []);

  async function login(email: string, password: string) {
    const { data } = await api.post<{ data: { token: string; user: CurrentUser } }>('/auth/login', { email, password });
    sessionStorage.setItem('foodloop.accessToken', data.data.token);
    setUser(data.data.user);
  }

  async function register(payload: Record<string, unknown>) {
    const { data } = await api.post<{ data: { token: string; user: CurrentUser } }>('/auth/register', payload);
    sessionStorage.setItem('foodloop.accessToken', data.data.token);
    setUser(data.data.user);
  }

  function logout() {
    sessionStorage.removeItem('foodloop.accessToken');
    setUser(null);
  }

  const value = useMemo(() => ({ user, loading, login, register, logout }), [user, loading]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}

export function errorMessage(error: unknown) {
  if (axios.isAxiosError<ApiErrorBody>(error)) {
    const details = error.response?.data?.error?.details;
    if (details?.length) return details.map((item) => item.message).join(' ');
    return error.response?.data?.error?.message ?? 'We could not reach FoodLoop. Check your connection and try again.';
  }
  return 'Something went wrong. Please try again.';
}
