import type { ReactNode } from 'react';
import { Link, NavLink } from 'react-router-dom';

/** Layout for the pages outsiders use without signing in: the candidate form and the joining portal. */
export function PublicShell({ title, description, children, width = 'max-w-4xl' }: { title: string; description?: string; children: ReactNode; width?: string }) {
  const link = ({ isActive }: { isActive: boolean }) =>
    `rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${isActive ? 'bg-primary text-on-primary' : 'text-text-secondary hover:bg-surface-secondary hover:text-text'}`;
  return (
    <div className="min-h-screen bg-surface-secondary px-4 py-6 sm:py-10">
      <div className={`mx-auto ${width}`}>
        <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <Link to="/apply" className="flex items-center gap-3">
            <img src="/rex-logo.jpeg" alt="Rexera" className="h-10 w-auto rounded-md bg-white p-1 shadow-[var(--shadow-card)]" />
            <span className="text-sm font-semibold text-text">Rexera Careers</span>
          </Link>
          <nav className="flex flex-wrap items-center gap-1" aria-label="Public pages">
            <NavLink to="/apply" className={link}>Apply</NavLink>
            <NavLink to="/joining" className={link}>Onboarding</NavLink>
            <Link to="/login" className="rounded-md px-3 py-1.5 text-sm font-medium text-text-secondary hover:bg-surface-secondary hover:text-text">Staff sign in</Link>
          </nav>
        </header>
        <main className="rounded-lg border border-border bg-surface p-5 shadow-[var(--shadow-card)] sm:p-8">
          <div className="mb-6 border-b border-border pb-4">
            <h1 className="text-xl font-semibold text-text">{title}</h1>
            {description && <p className="mt-1 text-sm text-text-muted">{description}</p>}
          </div>
          {children}
        </main>
        <p className="mt-6 text-center text-xs text-text-muted">© {new Date().getFullYear()} Rexera Financial Services Private Limited</p>
      </div>
    </div>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return <h2 className="mb-3 mt-6 border-l-4 border-primary pl-2.5 text-sm font-semibold text-text first:mt-0">{children}</h2>;
}
