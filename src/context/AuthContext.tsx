import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { AuthUser, getCurrentUser, loadSession, loginUser, logoutUser } from '../lib/auth';
import { registerOn401Handler } from '../lib/api';

interface AuthContextType {
  user: AuthUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  signOut: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const initialised = useRef(false);

  useEffect(() => {
    if (initialised.current) return;
    initialised.current = true;
    const token = loadSession();
    if (token) setUser(getCurrentUser());
    setLoading(false);

    registerOn401Handler(() => {
      logoutUser();
      setUser(null);
      window.location.href = '/login?expired=1';
    });
  }, []);

  async function login(email: string, password: string) {
    const { user: u } = await loginUser(email, password);
    setUser(u);
  }

  function signOut() {
    logoutUser();
    setUser(null);
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}