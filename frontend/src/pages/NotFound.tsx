import { Link } from 'react-router-dom';
import { Compass } from 'lucide-react';

export function NotFound() {
  return (
    <div className="flex flex-col items-center py-24 text-center">
      <span className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-neutral-bg text-text-muted">
        <Compass size={22} aria-hidden="true" />
      </span>
      <h1 className="text-lg font-semibold text-text">Page not found</h1>
      <p className="mt-1 max-w-sm text-sm text-text-muted">This page doesn't exist or isn't available to your account.</p>
      <Link to="/dashboard" className="mt-5 inline-flex h-9 items-center rounded-md border border-border bg-surface px-3.5 text-sm font-medium text-text shadow-[var(--shadow-card)] hover:bg-surface-secondary">
        Back to dashboard
      </Link>
    </div>
  );
}
