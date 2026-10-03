import type { ReactNode } from 'react';
import { Outlet } from 'react-router-dom';
import { Header } from '../components/navigation/Header';
import { NotificationsProvider } from '../lib/notifications';
import { greeting } from '../lib/format';
import { useAuth } from '../auth/AuthContext';
import { LauncherSearch } from './components';
import { LauncherContext, useOnLauncher } from './launcher';

/**
 * Layout for the role dashboards: header only, no module sidebar. The dashboard itself
 * is the control centre, so navigation lives in its cards. Module pages keep AppLayout.
 */
export function DashboardShell() {
  return (
    <NotificationsProvider>
      <div className="flex min-h-screen flex-col bg-[linear-gradient(160deg,#1b1f5e_0%,#2a3a9c_45%,#4a5fd0_100%)]">
        <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[70] focus:rounded-md focus:bg-elevated focus:px-3 focus:py-2 focus:text-sm focus:shadow-[var(--shadow-pop)]">
          Skip to content
        </a>
        <Header />
        <main id="main" tabIndex={-1} className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-6 outline-none sm:px-6 lg:px-8">
          <LauncherContext.Provider value={true}>
            <Outlet />
          </LauncherContext.Provider>
        </main>
      </div>
    </NotificationsProvider>
  );
}

/** Welcome block every role dashboard opens with. */
export function DashboardIntro({ title, subtitle, actions }: { title?: string; subtitle: string; actions?: ReactNode }) {
  const { user } = useAuth();
  const onLauncher = useOnLauncher();
  const name = (user?.username || user?.email || '').split(/[\s@]/)[0];

  return (
    <>
    {onLauncher && <LauncherSearch />}
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className={`text-2xl font-semibold tracking-tight ${onLauncher ? 'text-white' : 'text-text'}`}>
          {title ?? `${greeting()}, ${name}`}
        </h1>
        <p className={`mt-1 text-base ${onLauncher ? 'text-white/75' : 'text-text-muted'}`}>
          <span className={`font-medium ${onLauncher ? 'text-white' : 'text-text-secondary'}`}>{user?.role_label}</span>
          <span aria-hidden="true"> · </span>
          {subtitle}
        </p>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
    </>
  );
}
