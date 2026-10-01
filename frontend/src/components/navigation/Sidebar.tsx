import { useEffect, useRef } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { ChevronDown, LayoutDashboard, PanelLeftClose, PanelLeftOpen, PiggyBank, Settings, X } from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';
import { visibleSections } from '../../modules/registry';
import { usePersistedState } from '../../lib/useMediaQuery';
import { Tooltip } from '../common/Tooltip';
import type { NavItem } from '../../types';

interface SidebarProps {
  rail: boolean;
  canToggleRail: boolean;
  onToggleRail: () => void;
  mobileOpen: boolean;
  onCloseMobile: () => void;
}

function Brand({ rail }: { rail: boolean }) {
  return (
    <NavLink to="/dashboard" className={`flex h-16 shrink-0 items-center gap-3 border-b border-border ${rail ? 'justify-center px-2' : 'px-4'}`}>
      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white p-1 shadow-xs border border-border shrink-0">
        <img src="/rex-logo.jpeg" alt="Rexera Logo" className="h-full w-full object-contain" />
      </div>
      {!rail && (
        <div className="flex flex-col min-w-0">
          <span className="text-[15px] font-bold tracking-tight text-text leading-tight">REXERA</span>
          <span className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">CRM</span>
        </div>
      )}
    </NavLink>
  );
}

function Item({ item, rail, onNavigate }: { item: Pick<NavItem, 'path' | 'label' | 'icon' | 'end'>; rail: boolean; onNavigate?: () => void }) {
  const Icon = item.icon;
  const link = (
    <NavLink
      to={item.path}
      end={item.end}
      onClick={onNavigate}
      className={({ isActive }) =>
        `flex items-center gap-2.5 rounded-md text-[13px] font-medium transition-colors
        ${rail ? 'h-9 w-9 justify-center' : 'h-8 px-2.5'}
        ${isActive ? 'bg-primary-soft text-primary' : 'text-text-secondary hover:bg-neutral-bg hover:text-text'}`
      }
    >
      <Icon size={16} className="shrink-0" aria-hidden="true" />
      {rail ? <span className="sr-only">{item.label}</span> : <span className="truncate">{item.label}</span>}
    </NavLink>
  );
  return rail ? <Tooltip label={item.label} side="right">{link}</Tooltip> : link;
}

function NavContent({ rail, onNavigate }: { rail: boolean; onNavigate?: () => void }) {
  const { can } = useAuth();
  const { pathname } = useLocation();
  const sections = visibleSections(can);
  const [collapsed, setCollapsed] = usePersistedState<Record<string, boolean>>('rex-crm-nav-collapsed', {});

  return (
    <nav aria-label="Main" className={`flex-1 overflow-y-auto py-3 ${rail ? 'px-3.5' : 'px-3'}`}>
      <Item item={{ path: '/dashboard', label: 'Dashboard', icon: LayoutDashboard }} rail={rail} onNavigate={onNavigate} />
      {sections.map((section) => {
        const containsActive = section.items.some((i) => pathname === i.path || pathname.startsWith(`${i.path}/`));
        const isOpen = rail || containsActive || !collapsed[section.id];
        const listId = `nav-${section.id}`;
        return (
          <div key={section.id} className="mt-4">
            {rail ? (
              <div className="mx-auto mb-2 h-px w-6 bg-border" aria-hidden="true" />
            ) : (
              <button
                onClick={() => setCollapsed((c) => ({ ...c, [section.id]: isOpen }))}
                aria-expanded={isOpen}
                aria-controls={listId}
                className="mb-1 flex w-full items-center justify-between rounded px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider text-text-muted hover:text-text"
              >
                {section.label}
                <ChevronDown size={13} className={`transition-transform ${isOpen ? '' : '-rotate-90'}`} aria-hidden="true" />
              </button>
            )}
            {isOpen && (
              <ul id={listId} className="space-y-0.5">
                {section.items.map((item) => (
                  <li key={item.id}><Item item={item} rail={rail} onNavigate={onNavigate} /></li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </nav>
  );
}

export function Sidebar({ rail, canToggleRail, onToggleRail, mobileOpen, onCloseMobile }: SidebarProps) {
  const drawer = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!mobileOpen) return;
    drawer.current?.querySelector<HTMLElement>('a,button')?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onCloseMobile();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [mobileOpen, onCloseMobile]);

  const footer = (isRail: boolean, onNavigate?: () => void) => (
    <div className={`space-y-0.5 border-t border-border py-2 ${isRail ? 'px-3.5' : 'px-3'}`}>
      <Item item={{ path: '/my/pf', label: 'My PF', icon: PiggyBank }} rail={isRail} onNavigate={onNavigate} />
      <Item item={{ path: '/settings', label: 'Settings', icon: Settings }} rail={isRail} onNavigate={onNavigate} />
      {canToggleRail && !onNavigate && (
        <button
          onClick={onToggleRail}
          aria-label={isRail ? 'Expand sidebar' : 'Collapse sidebar'}
          className={`flex items-center gap-2.5 rounded-md text-[13px] font-medium text-text-muted hover:bg-neutral-bg hover:text-text
            ${isRail ? 'h-9 w-9 justify-center' : 'h-8 w-full px-2.5'}`}
        >
          {isRail ? <PanelLeftOpen size={16} /> : <><PanelLeftClose size={16} /> Collapse</>}
        </button>
      )}
    </div>
  );

  return (
    <>
      {/* Tablet & desktop */}
      <aside
        className={`sticky top-0 hidden h-screen shrink-0 flex-col border-r border-border bg-surface transition-[width] duration-200 md:flex
          ${rail ? 'w-16' : 'w-60'}`}
      >
        <Brand rail={rail} />
        <NavContent rail={rail} />
        {footer(rail)}
      </aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <div className="absolute inset-0 bg-black/45 animate-fade-in" onClick={onCloseMobile} aria-hidden="true" />
          <div ref={drawer} className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col border-r border-border bg-surface shadow-[var(--shadow-pop)] animate-slide-in-right">
            <div className="flex items-center justify-between pr-2">
              <Brand rail={false} />
              <button onClick={onCloseMobile} aria-label="Close navigation" className="rounded-md p-2 text-text-muted hover:bg-neutral-bg hover:text-text">
                <X size={18} />
              </button>
            </div>
            <NavContent rail={false} onNavigate={onCloseMobile} />
            {footer(false, onCloseMobile)}
          </div>
        </div>
      )}
    </>
  );
}
