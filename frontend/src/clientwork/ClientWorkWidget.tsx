import { Link } from 'react-router-dom';
import { ArrowRight, CheckCircle2, ClipboardList, PauseCircle, Zap } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useApi } from '../lib/useApi';
import { number } from '../lib/format';
import { Card, CardHeader } from '../components/common/Card';
import { ErrorState } from '../components/common/ErrorState';
import { Skeleton } from '../components/common/Skeleton';
import { cw, type Counters } from './api';
import { useClientWorkLive } from './live';
import { LiveDot, clients } from './ui';

interface Tile {
  bucket: 'need_action' | 'on_hold' | 'completed';
  label: string;
  caption: string;
  icon: LucideIcon;
  tone: string;
  value: (c: Counters) => number;
  detail: (c: Counters) => string;
}

const TILES: Tile[] = [
  {
    bucket: 'need_action', label: 'Need Action', caption: 'Work requiring internal action', icon: Zap,
    tone: 'border-primary/30 bg-primary-soft text-primary',
    value: (c) => c.need_action,
    detail: (c) => `${c.in_progress} in progress · ${c.overdue} overdue · ${c.due_today} due today`,
  },
  {
    bucket: 'on_hold', label: 'On Hold', caption: 'Blocked or waiting', icon: PauseCircle,
    tone: 'border-warning/30 bg-warning-bg text-warning',
    value: (c) => c.on_hold,
    detail: (c) => `${c.waiting_for_client} waiting for client · ${c.internal_blocker} internal blocker`,
  },
  {
    bucket: 'completed', label: 'Completed', caption: 'Finished client work', icon: CheckCircle2,
    tone: 'border-success/30 bg-success-bg text-success',
    value: (c) => c.completed,
    detail: (c) => `${c.completed_today} today · ${c.completed_this_week} this week · ${c.completed_this_month} this month`,
  },
];

/** The Client Work Management box of the Admin dashboard: three live counters that open the filtered workspace. */
export function ClientWorkWidget() {
  const summary = useApi(cw.summary);
  useClientWorkLive(summary.reload);
  const c = summary.data?.counters;
  const scope = summary.data?.scope === 'all' ? 'All client work' : 'Work assigned to you';

  return (
    <Card>
      <CardHeader
        title={<span className="inline-flex items-center gap-2"><ClipboardList size={16} className="text-primary" aria-hidden="true" /> Client Work Management</span>}
        description={`${scope} · assigned by Legal, tracked from first action to completion`}
        actions={<><LiveDot /><Link to="/client-work" className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">Open workspace <ArrowRight size={12} aria-hidden="true" /></Link></>}
      />
      {summary.status === 'error' && !c ? (
        <ErrorState compact onRetry={summary.reload} message={summary.error} />
      ) : (
        <div className="p-4">
          <div className="grid gap-3 md:grid-cols-3">
            {TILES.map((t) => {
              const Icon = t.icon;
              return (
                <Link
                  key={t.bucket}
                  to={`/client-work?bucket=${t.bucket}`}
                  className={`group block rounded-lg border p-4 transition-all hover:-translate-y-0.5 hover:shadow-[var(--shadow-pop)] ${t.tone}`}
                  aria-label={`${t.label}: open the filtered list`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold">{t.label}</span>
                    <Icon size={18} aria-hidden="true" />
                  </div>
                  {c ? (
                    <p className="mt-3 text-3xl font-semibold tracking-tight tabular-nums text-text" aria-live="polite">{clients(t.value(c))}</p>
                  ) : (
                    <Skeleton className="mt-3 h-9 w-32" />
                  )}
                  <p className="mt-1 text-xs text-text-secondary">{t.caption}</p>
                  <p className="mt-2 truncate border-t border-current/15 pt-2 text-xs text-text-muted">{c ? t.detail(c) : ' '}</p>
                </Link>
              );
            })}
          </div>

          {c && (
            <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-4 lg:grid-cols-7">
              {([
                ['Total active', c.total_active, ''],
                ['Overdue', c.overdue, c.overdue ? 'text-danger' : ''],
                ['Due today', c.due_today, c.due_today ? 'text-warning' : ''],
                ['Due soon', c.due_soon, ''],
                ['Completed today', c.completed_today, ''],
                ['This week', c.completed_this_week, ''],
                ['This month', c.completed_this_month, ''],
              ] as [string, number, string][]).map(([label, v, cls]) => (
                <div key={label} className="flex items-baseline justify-between gap-2 rounded-md bg-surface-secondary px-3 py-2">
                  <dt className="text-text-muted">{label}</dt>
                  <dd className={`font-semibold tabular-nums ${cls || 'text-text'}`}>{number(v)}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      )}
    </Card>
  );
}
