import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import { Header } from '../navigation/Header';
import { Sidebar } from '../navigation/Sidebar';
import { NotificationsProvider } from '../../lib/notifications';
import { useMediaQuery, usePersistedState } from '../../lib/useMediaQuery';

/** Authenticated shell. Only ever rendered behind RequireAuth — the login page has its own layout. */
export function AppLayout() {
  const isDesktop = useMediaQuery('(min-width: 1024px)');
  const [userCollapsed, setUserCollapsed] = usePersistedState('rex-crm-sidebar-collapsed', false);
  const [mobileOpen, setMobileOpen] = useState(false);
  // Tablet always gets the icon rail; desktop follows the user's choice.
  const rail = !isDesktop || userCollapsed;

  return (
    <NotificationsProvider>
      <div className="flex min-h-screen bg-bg">
        <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[70] focus:rounded-md focus:bg-elevated focus:px-3 focus:py-2 focus:text-sm focus:shadow-[var(--shadow-pop)]">
          Skip to content
        </a>
        <Sidebar
          rail={rail}
          canToggleRail={isDesktop}
          onToggleRail={() => setUserCollapsed((v) => !v)}
          mobileOpen={mobileOpen}
          onCloseMobile={() => setMobileOpen(false)}
        />
        <div className="flex min-w-0 flex-1 flex-col">
          <Header onOpenMenu={() => setMobileOpen(true)} />
          <main id="main" tabIndex={-1} className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-6 outline-none sm:px-6 lg:px-8">
            <Outlet />
          </main>
        </div>
      </div>
    </NotificationsProvider>
  );
}
