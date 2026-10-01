import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, setUnauthorizedHandler, tokenStore } from '../lib/api';
import { useToast } from '../components/common/ToastContext';

export interface CurrentUser {
  id: string;
  username: string;
  email: string;
  role: string;
  role_label: string;
  /** Roles given on top of the primary one, by a Super Admin. */
  extra_roles?: string[];
  last_login: string | null;
  permissions: string[];
}

type Status = 'checking' | 'authenticated' | 'unauthenticated';
export type SignOutReason = 'manual' | 'timeout' | 'expired';

export interface LoginStep1 {
  email: string;
  message: string;
  debug_otp: string | null;
  /** Proof the password check passed; required to verify or resend the 2FA code. */
  temp_token: string;
}

interface AuthContextValue {
  status: Status;
  user: CurrentUser | null;
  signOutReason: SignOutReason | null;
  can: (permission: string) => boolean;
  canAny: (permissions: string[]) => boolean;
  startLogin: (email: string, password: string) => Promise<LoginStep1>;
  verifyOtp: (email: string, otp: string, tempToken: string) => Promise<void>;
  resendOtp: (email: string, tempToken: string) => Promise<string | null>;
  loginWithGoogle: (payload: { credential?: string; access_token?: string; email?: string }) => Promise<void>;
  logout: (reason?: SignOutReason) => Promise<void>;

  refresh: () => Promise<void>;
}


const AuthContext = createContext<AuthContextValue | null>(null);

const ACTIVITY_EVENTS = ['mousedown', 'keydown', 'scroll', 'touchstart'] as const;
const WARN_BEFORE_MS = 60_000;

function clearSessionCaches() {
  try {
    Object.keys(sessionStorage).filter((k) => k.startsWith('rex-crm')).forEach((k) => sessionStorage.removeItem(k));
    localStorage.removeItem('rex-crm-ivr-session'); // the IVR dialer session belongs to this CRM sign-in
  } catch {
    // storage unavailable
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const { showToast } = useToast();
  const [status, setStatus] = useState<Status>(() => (tokenStore.get() ? 'checking' : 'unauthenticated'));
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [signOutReason, setSignOutReason] = useState<SignOutReason | null>(null);
  const lastRefresh = useRef(0);

  const endSession = useCallback((reason: SignOutReason) => {
    tokenStore.set(null);
    clearSessionCaches();
    setUser(null);
    setSignOutReason(reason);
    setStatus('unauthenticated');
  }, []);

  const loadMe = useCallback(async () => {
    const me = await api.get<CurrentUser>('/api/rbac/me');
    lastRefresh.current = Date.now();
    setUser(me);
    setStatus('authenticated');
  }, []);

  // Restore an existing session on first load.
  useEffect(() => {
    if (!tokenStore.get()) return;
    loadMe().catch(() => endSession('expired'));
  }, [loadMe, endSession]);

  // Any 401 (expired/revoked token, deactivated account) ends the session app-wide.
  useEffect(() => {
    setUnauthorizedHandler(() => endSession('expired'));
    return () => setUnauthorizedHandler(null);
  }, [endSession]);

  // Signing out (or in) in another tab applies here too.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== tokenStore.key) return;
      if (!e.newValue) endSession('manual');
      else loadMe().catch(() => endSession('expired'));
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [endSession, loadMe]);

  const refresh = useCallback(async () => {
    if (!tokenStore.get()) return;
    await loadMe().catch(() => undefined);
  }, [loadMe]);

  // Pick up permission changes a Super Admin made while this tab was in the background.
  useEffect(() => {
    if (status !== 'authenticated') return;
    const onFocus = () => {
      if (Date.now() - lastRefresh.current > 15_000) refresh();
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [status, refresh]);

  const logout = useCallback(async (reason: SignOutReason = 'manual') => {
    if (tokenStore.get() && reason !== 'expired') {
      // Revokes the token server-side; the local session ends regardless of the outcome.
      await api.post(reason === 'timeout' ? '/api/auth/session-timeout' : '/api/auth/logout').catch(() => undefined);
    }
    endSession(reason);
  }, [endSession]);

  // Inactivity timeout, using the backend's configured window (default 60 min).
  useEffect(() => {
    if (status !== 'authenticated') return;
    let timeoutMs = 60 * 60_000;
    let warnTimer: number | undefined;
    let logoutTimer: number | undefined;
    let warned = false;
    let active = true;

    const schedule = () => {
      if (!active) return;
      window.clearTimeout(warnTimer);
      window.clearTimeout(logoutTimer);
      warned = false;
      warnTimer = window.setTimeout(() => {
        warned = true;
        showToast('You will be signed out in 1 minute due to inactivity.', 'warning', {
          duration: WARN_BEFORE_MS,
          action: { label: 'Stay signed in', onClick: schedule },
        });
      }, Math.max(0, timeoutMs - WARN_BEFORE_MS));
      logoutTimer = window.setTimeout(() => logout('timeout'), timeoutMs);
    };
    const onActivity = () => {
      if (!warned) schedule();
    };

    api.get<{ session_timeout_minutes: number }>('/api/auth/session-config')
      .then((cfg) => {
        if (cfg.session_timeout_minutes > 0) timeoutMs = cfg.session_timeout_minutes * 60_000;
      })
      .catch(() => undefined)
      .finally(schedule);

    ACTIVITY_EVENTS.forEach((e) => window.addEventListener(e, onActivity, { passive: true }));
    return () => {
      active = false;
      window.clearTimeout(warnTimer);
      window.clearTimeout(logoutTimer);
      ACTIVITY_EVENTS.forEach((e) => window.removeEventListener(e, onActivity));
    };
  }, [status, logout, showToast]);

  const startLogin = useCallback(
    (email: string, password: string) => api.post<LoginStep1>('/api/auth/login', { email, password }),
    [],
  );

  const verifyOtp = useCallback(async (email: string, otp: string, tempToken: string) => {
    const res = await api.post<{ access_token: string }>('/api/auth/verify-2fa', { email, otp, temp_token: tempToken });
    tokenStore.set(res.access_token);
    setSignOutReason(null);
    await loadMe();
  }, [loadMe]);

  const resendOtp = useCallback(async (email: string, tempToken: string) => {
    const res = await api.post<{ debug_otp: string | null }>('/api/auth/resend-2fa-otp', { email, temp_token: tempToken });
    return res.debug_otp;
  }, []);

  const loginWithGoogle = useCallback(async (payload: { credential?: string; access_token?: string; email?: string }) => {
    const res = await api.post<{ access_token: string; email: string; role: string }>('/api/auth/google', payload);
    tokenStore.set(res.access_token);
    setSignOutReason(null);
    await loadMe();
  }, [loadMe]);

  const value = useMemo<AuthContextValue>(() => {
    const granted = new Set(user?.permissions ?? []);
    return {
      status,
      user,
      signOutReason,
      can: (p) => granted.has(p),
      canAny: (ps) => ps.some((p) => granted.has(p)),
      startLogin,
      verifyOtp,
      resendOtp,
      loginWithGoogle,
      logout,
      refresh,
    };
  }, [status, user, signOutReason, startLogin, verifyOtp, resendOtp, loginWithGoogle, logout, refresh]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
