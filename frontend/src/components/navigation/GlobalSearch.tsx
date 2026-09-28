import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { CornerDownLeft, Search, UserPlus, Users, UserRound } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';
import { visibleSections } from '../../modules/registry';
import { api } from '../../lib/api';
import { useDebounced } from '../../lib/useApi';

interface Result {
  id: string;
  group: string;
  label: string;
  sub?: string;
  icon: LucideIcon;
  to: string;
}

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

export function GlobalSearch() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [remote, setRemote] = useState<Result[]>([]);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const debounced = useDebounced(query.trim(), 250);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        opener.current = document.activeElement as HTMLElement;
        setOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (open) {
      input.current?.focus();
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = '';
      };
    }
  }, [open]);

  // Live records, only from sources the user is permitted to read.
  useEffect(() => {
    if (!open || debounced.length < 2) {
      setRemote([]);
      return;
    }
    let cancelled = false;
    const jobs: Promise<Result[]>[] = [];
    if (can('hr.employees.view')) {
      jobs.push(api.get<{ employees: { id: string; full_name: string; employee_code: string; department: string }[] }>('/api/employees', { search: debounced, limit: 5 })
        .then((r) => r.employees.map((e) => ({ id: `emp-${e.id}`, group: 'Employees', label: e.full_name, sub: `${e.employee_code} · ${e.department}`, icon: UserRound, to: `/hr/employees?open=${e.id}` }))));
    }
    if (can('hr.recruitment.view')) {
      jobs.push(api.get<{ candidates: { id: string; candidate_name: string; position_applied: string; status: string }[] }>('/api/candidates', { search: debounced, limit: 5 })
        .then((r) => r.candidates.map((c) => ({ id: `cand-${c.id}`, group: 'Candidates', label: c.candidate_name, sub: `${c.position_applied} · ${c.status}`, icon: UserPlus, to: `/hr/recruitment?open=${c.id}` }))));
    }
    if (can('users.manage')) {
      jobs.push(api.get<{ id: string; username: string; email: string }[]>('/api/users')
        .then((r) => r.filter((u) => `${u.username} ${u.email}`.toLowerCase().includes(debounced.toLowerCase())).slice(0, 5)
          .map((u) => ({ id: `user-${u.id}`, group: 'Users', label: u.username, sub: u.email, icon: Users, to: `/admin/users?q=${encodeURIComponent(u.email)}` }))));
    }
    Promise.all(jobs.map((j) => j.catch(() => [] as Result[]))).then((groups) => {
      if (!cancelled) setRemote(groups.flat());
    });
    return () => {
      cancelled = true;
    };
  }, [debounced, open, can]);

  const pages = useMemo<Result[]>(() => {
    const q = query.trim().toLowerCase();
    return visibleSections(can)
      .flatMap((s) => s.items.map((i) => ({ id: i.id, group: 'Go to', label: i.label, sub: s.label, icon: i.icon, to: i.path })))
      .filter((r) => !q || `${r.label} ${r.sub}`.toLowerCase().includes(q))
      .slice(0, q ? 8 : 6);
  }, [query, can]);

  const results = [...pages, ...remote];
  const groups = results.reduce<Record<string, Result[]>>((acc, r) => ((acc[r.group] ??= []).push(r), acc), {});

  useEffect(() => setActive(0), [query, remote.length]);

  const close = () => {
    setOpen(false);
    setQuery('');
    opener.current?.focus?.();
  };
  const go = (r: Result) => {
    close();
    navigate(r.to);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === 'Enter' && results[active]) {
      e.preventDefault();
      go(results[active]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  };

  let index = -1;
  return (
    <>
      <button
        onClick={(e) => {
          opener.current = e.currentTarget;
          setOpen(true);
        }}
        aria-label="Search"
        className="flex h-9 items-center gap-2 rounded-md border border-border bg-surface-secondary px-2.5 text-sm text-text-muted transition-colors hover:border-border-strong hover:text-text sm:w-64 md:w-72"
      >
        <Search size={15} aria-hidden="true" />
        <span className="hidden flex-1 text-left sm:inline">Search CRM…</span>
        <kbd className="hidden rounded border border-border bg-surface px-1.5 py-px font-sans text-[11px] font-medium sm:inline">{isMac ? '⌘' : 'Ctrl'} K</kbd>
      </button>

      {open &&
        createPortal(
          <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/45 px-4 pt-[12vh] animate-fade-in" onMouseDown={(e) => e.target === e.currentTarget && close()}>
            <div role="dialog" aria-modal="true" aria-label="Search" className="w-full max-w-xl overflow-hidden rounded-xl border border-border bg-elevated shadow-[var(--shadow-pop)] animate-pop-in">
              <div className="flex items-center gap-3 border-b border-border px-4">
                <Search size={17} className="shrink-0 text-text-muted" aria-hidden="true" />
                <input
                  ref={input}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={onKeyDown}
                  placeholder="Search pages, employees, candidates, users…"
                  aria-label="Search the CRM"
                  role="combobox"
                  aria-expanded
                  aria-controls="search-results"
                  aria-activedescendant={results[active] ? `sr-${results[active].id}` : undefined}
                  className="h-12 w-full bg-transparent text-sm text-text outline-none placeholder:text-text-muted"
                />
                <kbd className="hidden rounded border border-border px-1.5 py-px text-[11px] text-text-muted sm:inline">Esc</kbd>
              </div>
              <div id="search-results" role="listbox" className="max-h-[55vh] overflow-y-auto p-1.5">
                {results.length === 0 && (
                  <p className="px-3 py-10 text-center text-sm text-text-muted">
                    {debounced.length >= 2 ? `No results for “${query}”` : 'Type to search'}
                  </p>
                )}
                {Object.entries(groups).map(([group, items]) => (
                  <div key={group} className="mb-1">
                    <p className="px-2.5 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-text-muted">{group}</p>
                    {items.map((r) => {
                      index += 1;
                      const i = index;
                      const selected = i === active;
                      return (
                        <div
                          key={r.id}
                          id={`sr-${r.id}`}
                          role="option"
                          aria-selected={selected}
                          onMouseMove={() => setActive(i)}
                          onClick={() => go(r)}
                          className={`flex cursor-pointer items-center gap-3 rounded-md px-2.5 py-2 ${selected ? 'bg-neutral-bg' : ''}`}
                        >
                          <r.icon size={16} className="shrink-0 text-text-muted" aria-hidden="true" />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm text-text">{r.label}</span>
                            {r.sub && <span className="block truncate text-xs text-text-muted">{r.sub}</span>}
                          </span>
                          {selected && <CornerDownLeft size={14} className="shrink-0 text-text-muted" aria-hidden="true" />}
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
