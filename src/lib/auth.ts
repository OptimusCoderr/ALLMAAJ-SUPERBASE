/**
 * Client-side auth helpers — talks to /api/auth on the Express backend.
 * JWT stored in sessionStorage (cleared on tab close).
 */

import { setAuthToken, getAuthToken } from './api';

export interface AuthUser {
  id: string;
  fullName: string;
  email: string;
  phone: string;
  role: 'admin' | 'staff';
  branchId: string | null;
}

function decodeToken(token: string): any {
  try {
    return JSON.parse(atob(token.split('.')[1]));
  } catch {
    return null;
  }
}

export function isTokenExpired(token: string): boolean {
  const p = decodeToken(token);
  if (!p?.exp) return true;
  return Date.now() >= p.exp * 1000;
}

export function getCurrentUser(): AuthUser | null {
  const token = getAuthToken();
  if (!token || isTokenExpired(token)) {
    setAuthToken(null);
    return null;
  }
  const p = decodeToken(token);
  if (!p) return null;
  return {
    id: p.id,
    fullName: p.fullName ?? p.email ?? '',
    email: p.email,
    phone: p.phone ?? '',
    role: p.role,
    branchId: p.branchId ?? null,
  };
}

const SESSION_KEY = 'bt_session';

export function persistSession(token: string) {
  try { sessionStorage.setItem(SESSION_KEY, token); } catch {}
  setAuthToken(token);
}

export function loadSession(): string | null {
  try {
    const token = sessionStorage.getItem(SESSION_KEY);
    if (token && !isTokenExpired(token)) {
      setAuthToken(token);
      return token;
    }
    sessionStorage.removeItem(SESSION_KEY);
  } catch {}
  return null;
}

export function clearSession() {
  try { sessionStorage.removeItem(SESSION_KEY); } catch {}
  setAuthToken(null);
}

// ─── Auth API ─────────────────────────────────────────────────────────────────

const API_BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ?? '';

async function authFetch(path: string, body: object): Promise<any> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || data.error || `HTTP ${res.status}`);
  return data;
}

export async function loginUser(email: string, password: string): Promise<{ token: string; user: AuthUser }> {
  const res = await authFetch('/api/auth/login', { email: email.trim().toLowerCase(), password });
  // Backend wraps in { success, data: { token, user } }
  const payload = res?.data ?? res;
  persistSession(payload.token);
  return payload as { token: string; user: AuthUser };
}

export function logoutUser() {
  clearSession();
}
