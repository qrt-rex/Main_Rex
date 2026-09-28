import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import type { NavSection } from '../../types';

/** Entry point to a module the user can access (unauthorized modules are never rendered). */
export function ModuleCard({ section }: { section: NavSection }) {
  const Icon = section.icon;
  return (
    <Link
      to={section.items[0].path}
      className="group flex items-center gap-3 rounded-md border border-border px-3 py-2.5 transition-colors hover:border-border-strong hover:bg-surface-secondary"
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-neutral-bg text-text-secondary"><Icon size={16} aria-hidden="true" /></span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-text">{section.label}</span>
        <span className="block truncate text-xs text-text-muted">
          {section.items.length} {section.items.length === 1 ? 'area' : 'areas'} · {section.description}
        </span>
      </span>
      <ChevronRight size={15} className="shrink-0 text-text-muted transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
    </Link>
  );
}
