import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from './AuthContext';

function FullPageSpinner() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-bg" aria-busy="true" aria-label="Loading">
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-border border-t-primary" />
    </div>
  );
}

/** Gate for every authenticated route. Checked on each render, so Back after sign-out lands on /login. */
export function RequireAuth() {
  const { status, signOutReason } = useAuth();
  const location = useLocation();
  if (status === 'checking') return <FullPageSpinner />;
  if (status === 'unauthenticated') {
    // Deep links and expired sessions resume where they left off; a deliberate sign-out starts fresh.
    const state = signOutReason === 'manual' ? undefined : { from: location.pathname + location.search };
    return <Navigate to="/login" replace state={state} />;
  }
  return <Outlet />;
}

/** The login page is only for signed-out users. */
export function RedirectIfAuthenticated({ children }: { children: React.ReactNode }) {
  const { status } = useAuth();
  const location = useLocation();
  if (status === 'checking') return <FullPageSpinner />;
  if (status === 'authenticated') {
    const from = (location.state as { from?: string } | null)?.from;
    return <Navigate to={from && from !== '/login' ? from : '/dashboard'} replace />;
  }
  return <>{children}</>;
}
