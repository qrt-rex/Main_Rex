import { Link, useNavigate } from 'react-router-dom';
import { Bell, ChevronDown, CircleHelp, FileSpreadsheet, Keyboard, LogOut, Menu, Palette, ShieldCheck, UserRound } from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';
import { useNotifications } from '../../lib/notifications';
import { relativeTime } from '../../lib/format';
import { Avatar } from '../common/Avatar';
import { Dropdown, DropdownItem, DropdownLabel, DropdownSeparator } from '../common/Dropdown';
import { ThemeMenu } from '../common/ThemeSelector';
import { useToast } from '../common/ToastContext';
import { GlobalSearch } from './GlobalSearch';

const iconButton = 'h-9 w-9 justify-center text-text-muted hover:bg-neutral-bg hover:text-text';

function NotificationsMenu() {
  const navigate = useNavigate();
  const { items, unreadCount, isUnread, markAllRead } = useNotifications();
  const preview = items.slice(0, 5);

  return (
    <div className="relative">
      <Dropdown
        label={unreadCount ? `Notifications, ${unreadCount} unread` : 'Notifications'}
        width="w-80"
        triggerClassName={iconButton}
        trigger={<Bell size={18} aria-hidden="true" />}
      >
        <div className="flex items-center justify-between px-2.5 pb-1.5 pt-1">
          <span className="text-sm font-semibold text-text">Notifications</span>
          {unreadCount > 0 && (
            <button data-keep-open role="menuitem" tabIndex={-1} onClick={markAllRead} className="text-xs font-medium text-primary hover:underline">
              Mark all as read
            </button>
          )}
        </div>
        {preview.length === 0 ? (
          <p className="px-2.5 py-6 text-center text-sm text-text-muted">You're all caught up.</p>
        ) : (
          preview.map((n) => (
            <DropdownItem key={n.id} onClick={() => navigate(n.link)} className="items-start">
              <span className="flex items-start gap-2.5">
                <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${isUnread(n) ? 'bg-primary' : 'bg-transparent'}`} aria-hidden="true" />
                <span className="min-w-0">
                  <span className={`block truncate text-sm ${isUnread(n) ? 'font-medium text-text' : 'text-text-secondary'}`}>{n.title}</span>
                  <span className="block truncate text-xs text-text-muted">{relativeTime(n.timestamp)} · {n.description}</span>
                </span>
              </span>
            </DropdownItem>
          ))
        )}
        <DropdownSeparator />
        <DropdownItem onClick={() => navigate('/notifications')} className="justify-center text-primary">View all notifications</DropdownItem>
      </Dropdown>
      {unreadCount > 0 && (
        <span className="pointer-events-none absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-semibold text-white" aria-hidden="true">
          {unreadCount > 9 ? '9+' : unreadCount}
        </span>
      )}
    </div>
  );
}

function HelpMenu() {
  const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
  return (
    <Dropdown label="Help" width="w-64" triggerClassName={iconButton} trigger={<CircleHelp size={18} aria-hidden="true" />}>
      <DropdownLabel>Keyboard shortcuts</DropdownLabel>
      <div className="flex items-center justify-between px-2.5 py-1.5 text-sm text-text">
        <span className="flex items-center gap-2.5"><Keyboard size={16} className="text-text-muted" aria-hidden="true" /> Search</span>
        <kbd className="rounded border border-border px-1.5 text-[11px] text-text-muted">{isMac ? '⌘' : 'Ctrl'} K</kbd>
      </div>
      <DropdownSeparator />
      <DropdownItem icon={<CircleHelp size={16} />} onClick={() => { window.location.href = 'mailto:hr@rexera.co.in?subject=Rex%20CRM%20support'; }}>
        Contact support
      </DropdownItem>
    </Dropdown>
  );
}

function UserMenu() {
  const { user, logout } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();
  if (!user) return null;
  const name = user.username || user.email;

  const signOut = async () => {
    await logout('manual');
    navigate('/login', { replace: true });
    showToast('Signed out successfully', 'success');
  };

  return (
    <Dropdown
      label="Account menu"
      width="w-64"
      triggerClassName="h-9 gap-2 pl-1 pr-1.5 hover:bg-neutral-bg"
      trigger={
        <>
          <Avatar name={name} size={28} />
          <span className="hidden max-w-36 text-left leading-tight lg:block">
            <span className="block truncate text-[13px] font-medium text-text">{name}</span>
            <span className="block truncate text-xs text-text-muted">{user.role_label}</span>
          </span>
          <ChevronDown size={14} className="hidden text-text-muted lg:block" aria-hidden="true" />
        </>
      }
    >
      <div className="flex items-center gap-3 px-2.5 pb-2.5 pt-1.5">
        <Avatar name={name} size={36} />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-text">{name}</p>
          <p className="truncate text-xs text-text-muted">{user.role_label} · {user.email}</p>
        </div>
      </div>
      <DropdownSeparator />
      <DropdownItem icon={<UserRound size={16} />} onClick={() => navigate('/settings?tab=profile')}>Profile</DropdownItem>
      <DropdownItem icon={<Palette size={16} />} onClick={() => navigate('/settings?tab=preferences')}>Preferences</DropdownItem>
      <DropdownItem icon={<ShieldCheck size={16} />} onClick={() => navigate('/settings?tab=security')}>Security</DropdownItem>
      <DropdownSeparator />
      <DropdownItem icon={<LogOut size={16} />} onClick={signOut} className="hover:!bg-danger-bg hover:!text-danger focus-visible:!bg-danger-bg focus-visible:!text-danger">
        Sign out
      </DropdownItem>
    </Dropdown>
  );
}

/** `onOpenMenu` is only passed by AppLayout; the dashboard shell has no sidebar to open. */
export function Header({ onOpenMenu }: { onOpenMenu?: () => void }) {
  const { can } = useAuth();
  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 border-b border-border bg-surface/95 px-3 backdrop-blur supports-[backdrop-filter]:bg-surface/80 sm:px-4">
      {onOpenMenu && (
        <button onClick={onOpenMenu} aria-label="Open navigation" className="flex h-9 w-9 items-center justify-center rounded-md text-text-muted hover:bg-neutral-bg hover:text-text md:hidden">
          <Menu size={19} />
        </button>
      )}
      <Link to="/dashboard" className={`flex items-center gap-3 ${onOpenMenu ? 'md:hidden' : 'mr-2'}`} aria-label="Rex CRM home">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white p-1 shadow-xs border border-border shrink-0">
          <img src="/rex-logo.jpeg" alt="Rexera Logo" className="h-full w-full object-contain" />
        </div>
        {!onOpenMenu && (
          <div className="hidden sm:flex flex-col min-w-0">
            <span className="text-[15px] font-bold tracking-tight text-text leading-tight">REXERA</span>
            <span className="text-[9px] font-semibold text-text-muted uppercase tracking-wider">CRM</span>
          </div>
        )}
      </Link>
      <GlobalSearch />
      <div className="ml-auto flex items-center gap-1.5">
        {can('billing.view') && (
          <Link
            to="/billing/invoices"
            className="inline-flex h-8 items-center gap-1.5 rounded-md bg-emerald-600/10 px-2.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-600/20 dark:bg-emerald-500/20 dark:text-emerald-400 transition-colors"
            title="Open Billing & Invoicing Module"
          >
            <FileSpreadsheet size={14} />
            <span className="hidden sm:inline">Bill & Invoices</span>
          </Link>
        )}
        <NotificationsMenu />
        <HelpMenu />
        <ThemeMenu />
        <div className="mx-1 hidden h-6 w-px bg-border sm:block" aria-hidden="true" />
        <UserMenu />
      </div>
    </header>
  );
}
