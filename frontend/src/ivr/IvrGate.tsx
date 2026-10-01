import { createContext, useContext, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { ClipboardPaste, Headphones, LogIn, TriangleAlert, X } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { ApiError } from '../lib/api';
import { useApi } from '../lib/useApi';
import { Button } from '../components/common/Button';
import { Input, Textarea } from '../components/common/Input';
import { ivrApi, ivrSession } from './ivrApi';
import { IVR_SESSION_KEY, loadIvrSession, parseLoginResponse, type IvrSession, type IvrTokens } from './ivrAuth';

interface IvrContextValue {
  session: IvrSession;
  signOut: () => void;
}

const IvrContext = createContext<IvrContextValue | null>(null);

export function useIvr() {
  const ctx = useContext(IvrContext);
  if (!ctx) throw new Error('useIvr must be used inside <IvrGate>');
  return ctx;
}

/** Shows the IVR sign-in page until this CRM user has an IVR session, then the children. */
export function IvrGate({ title, children }: { title: string; children: ReactNode }) {
  const { user } = useAuth();
  const crmUserId = user?.id ?? '';
  const [session, setSession] = useState<IvrSession | null>(() => {
    const saved = loadIvrSession(crmUserId);
    ivrSession.adopt(saved);
    return saved;
  });

  useEffect(() => ivrSession.subscribe(setSession), []);

  // Another dialer / IVR tab signed in, refreshed its token or signed out.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === null || e.key === IVR_SESSION_KEY) ivrSession.adopt(loadIvrSession(crmUserId));
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [crmUserId]);

  if (!session) {
    return <IvrSignIn title={title} onSignedIn={(t) => ivrSession.set({ ...t, crmUserId })} />;
  }
  return <IvrContext.Provider value={{ session, signOut: () => ivrSession.set(null) }}>{children}</IvrContext.Provider>;
}

function IvrSignIn({ title, onSignedIn }: { title: string; onSignedIn: (t: IvrTokens) => void }) {
  const { user } = useAuth();
  const status = useApi(ivrApi.status);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasted, setPasted] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const notConfigured = status.data?.configured === false;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      onSignedIn(await ivrApi.login(email.trim(), password));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not sign in to the IVR.');
    } finally {
      setBusy(false);
    }
  };

  const usePasted = () => {
    setError('');
    try {
      onSignedIn(parseLoginResponse(pasted));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That login response could not be used.');
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg px-4 py-10 text-text antialiased">
      <div className="w-full max-w-md">
        <div className="mb-6 flex flex-col items-center text-center">
          <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-primary-soft text-primary">
            <Headphones size={22} aria-hidden="true" />
          </div>
          <h1 className="text-xl font-bold tracking-tight">{title}</h1>
          <p className="mt-1 text-sm text-text-muted">Sign in with your IVR account to continue.</p>
        </div>

        <div className="rounded-lg border border-border bg-surface p-6 shadow-[var(--shadow-card)]">
          {notConfigured && (
            <div className="mb-4 flex gap-2.5 rounded-lg border border-warning/30 bg-warning-bg p-3 text-xs text-text">
              <TriangleAlert size={16} className="mt-0.5 shrink-0 text-warning" aria-hidden="true" />
              <p>
                The IVR connection isn't set up on the server yet. An administrator needs to set{' '}
                <code className="font-mono font-semibold">IVR_API_BASE_URL</code> in the backend settings.
              </p>
            </div>
          )}

          {error && (
            <p role="alert" className="mb-4 rounded-lg border border-danger/30 bg-danger-bg px-3 py-2.5 text-xs font-medium text-danger">
              {error}
            </p>
          )}

          {!pasteOpen ? (
            <form onSubmit={submit} className="space-y-4">
              <Input
                label="IVR email"
                type="email"
                autoComplete="username"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
              />
              <Input
                label="IVR password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <Button type="submit" loading={busy} disabled={notConfigured} className="w-full">
                <LogIn size={15} aria-hidden="true" /> Sign in to IVR
              </Button>
              <button
                type="button"
                onClick={() => {
                  setPasteOpen(true);
                  setError('');
                }}
                className="flex w-full items-center justify-center gap-1.5 text-xs font-medium text-text-muted hover:text-primary"
              >
                <ClipboardPaste size={13} aria-hidden="true" /> Already signed in to the IVR? Use its login response
              </button>
            </form>
          ) : (
            <div className="space-y-3">
              <Textarea
                label="IVR login response (JSON)"
                rows={7}
                value={pasted}
                onChange={(e) => setPasted(e.target.value)}
                placeholder='{"success": true, "message": "Login successful", "data": {"user": …, "accessToken": …}}'
                hint="The session is kept only for your CRM sign-in on this browser."
              />
              <div className="flex gap-2">
                <Button variant="secondary" onClick={() => setPasteOpen(false)} className="flex-1">
                  <X size={14} aria-hidden="true" /> Back
                </Button>
                <Button onClick={usePasted} disabled={!pasted.trim() || notConfigured} className="flex-1">
                  Use this session
                </Button>
              </div>
            </div>
          )}
        </div>

        <p className="mt-4 text-center text-xs text-text-muted">
          CRM account: <span className="font-medium text-text-secondary">{user?.email}</span>
          {' · '}
          <button type="button" onClick={() => window.close()} className="font-medium hover:text-primary">
            Close tab
          </button>
        </p>
      </div>
    </div>
  );
}
