import { useMemo, useState, type ReactNode } from 'react';
import { Download } from 'lucide-react';
import { Button } from '../../components/common/Button';
import { EmptyState } from '../../components/common/EmptyState';
import { ErrorState } from '../../components/common/ErrorState';
import { SearchInput } from '../../components/common/Input';
import { Skeleton } from '../../components/common/Skeleton';
import type { IvrRow } from '../types';

// Never shown, whatever the IVR sends back.
const HIDDEN = /pass(word)?|secret|token|sip_password|api_key/i;

export const humanize = (key: string) =>
  key
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/^\w/, (c) => c.toUpperCase());

const ISO_DATE = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2})?/;

/** A readable value for one IVR field. */
export function cellText(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (typeof v === 'number') return v.toLocaleString('en-IN');
  if (typeof v === 'string') {
    if (ISO_DATE.test(v)) {
      const d = new Date(v);
      if (!Number.isNaN(d.getTime())) {
        return v.length <= 10 ? d.toLocaleDateString('en-IN') : d.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
      }
    }
    return v;
  }
  if (Array.isArray(v)) return v.length ? v.map(cellText).join(', ') : '—';
  if (typeof v === 'object') {
    const o = v as IvrRow;
    const named = o.name ?? o.title ?? o.label ?? o.number;
    return named !== undefined ? cellText(named) : JSON.stringify(v);
  }
  return String(v);
}

function Cell({ value }: { value: unknown }) {
  if (typeof value === 'string' && /^https?:\/\//.test(value)) {
    return (
      <a href={value} target="_blank" rel="noopener noreferrer" className="font-medium text-primary hover:underline">
        Open
      </a>
    );
  }
  return <>{cellText(value)}</>;
}

export function columnsOf(rows: IvrRow[]): string[] {
  const cols: string[] = [];
  for (const row of rows.slice(0, 100)) {
    for (const k of Object.keys(row)) if (!cols.includes(k) && !HIDDEN.test(k)) cols.push(k);
  }
  return cols;
}

function toCsv(rows: IvrRow[], cols: string[]) {
  const esc = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const lines = [cols.map((c) => esc(humanize(c))).join(',')];
  for (const r of rows) lines.push(cols.map((c) => esc(r[c] === null || r[c] === undefined ? '' : cellText(r[c]))).join(','));
  return lines.join('\n');
}

interface IvrTableProps {
  rows: IvrRow[] | null;
  status: 'loading' | 'success' | 'error';
  error?: string;
  onRetry: () => void;
  emptyTitle: string;
  filename: string;
  actions?: ReactNode;
}

/** Every row and field the IVR returned, as-is: searchable and exportable. */
export function IvrTable({ rows, status, error, onRetry, emptyTitle, filename, actions }: IvrTableProps) {
  const [query, setQuery] = useState('');
  const all = rows ?? [];
  const cols = useMemo(() => columnsOf(all), [all]);
  const q = query.trim().toLowerCase();
  const shown = q ? all.filter((r) => cols.some((c) => cellText(r[c]).toLowerCase().includes(q))) : all;

  const exportCsv = () => {
    const blob = new Blob([toCsv(shown, cols)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${filename}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  if (status === 'error') {
    return (
      <div className="rounded-xl border border-border bg-surface">
        <ErrorState message={error} onRetry={onRetry} />
      </div>
    );
  }
  if (status === 'loading' && !rows) {
    return (
      <div className="space-y-2">
        {[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-10" />)}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="w-full sm:max-w-xs">
          <SearchInput value={query} onChange={setQuery} placeholder="Search…" label="Search records" />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-text-muted">
            {shown.length === all.length ? `${all.length} records` : `${shown.length} of ${all.length}`}
          </span>
          {actions}
          <Button size="sm" variant="secondary" onClick={exportCsv} disabled={!shown.length}>
            <Download size={13} aria-hidden="true" /> Export CSV
          </Button>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-[var(--shadow-card)]">
        {all.length === 0 ? (
          <EmptyState title={emptyTitle} description="The IVR returned no records." compact />
        ) : shown.length === 0 ? (
          <EmptyState title="No matches" description="Try a different search." compact />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-border bg-surface-secondary text-[11px] font-semibold uppercase tracking-wider text-text-muted">
                <tr>
                  {cols.map((c) => (
                    <th key={c} className="whitespace-nowrap px-4 py-2.5">{humanize(c)}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border text-text">
                {shown.map((r, i) => (
                  <tr key={String(r.id ?? r.uuid ?? i)} className="hover:bg-surface-secondary/60">
                    {cols.map((c) => (
                      <td key={c} className="max-w-[260px] truncate whitespace-nowrap px-4 py-2.5" title={cellText(r[c])}>
                        <Cell value={r[c]} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
