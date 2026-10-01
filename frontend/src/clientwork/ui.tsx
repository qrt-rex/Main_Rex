import type { ReactNode } from 'react';
import { Badge, type BadgeTone } from '../components/common/Badge';
import { date } from '../lib/format';
import { useLiveConnected } from './live';
import type { Priority, Work, WorkStatus } from './api';

export const STATUS_LABEL: Record<WorkStatus, string> = {
  NEED_ACTION: 'Need action', IN_PROGRESS: 'In progress', ON_HOLD: 'On hold', COMPLETED: 'Completed', CANCELLED: 'Cancelled',
};
const STATUS_TONE: Record<WorkStatus, BadgeTone> = {
  NEED_ACTION: 'primary', IN_PROGRESS: 'info', ON_HOLD: 'warning', COMPLETED: 'success', CANCELLED: 'neutral',
};
const PRIORITY_TONE: Record<Priority, BadgeTone> = { CRITICAL: 'danger', HIGH: 'warning', MEDIUM: 'info', LOW: 'neutral' };
const DEADLINE_TONE = { OVERDUE: 'danger', DUE_TODAY: 'warning', DUE_SOON: 'warning', ON_TRACK: 'neutral', NO_DEADLINE: 'neutral', CLOSED: 'neutral' } as const;

export const title = (s: string) => s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, ' ');

/** "3d 6h", "5h 20m", "12m": calendar time at the precision a person reads it. */
export function duration(seconds?: number | null): string {
  const s = Math.max(0, Math.round(seconds ?? 0));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return h ? `${d}d ${h}h` : `${d}d`;
  if (h > 0) return m ? `${h}h ${m}m` : `${h}h`;
  return m > 0 ? `${m}m` : s > 0 ? '<1m' : '0m';
}

export const clients = (n: number) => `${n} ${n === 1 ? 'Client' : 'Clients'}`;

export function WorkStatusBadge({ work }: { work: Pick<Work, 'status' | 'hold_label' | 'hold'> }) {
  if (work.status === 'ON_HOLD' && work.hold_label) {
    // The two kinds of hold read differently at a glance: waiting on the client vs blocked inside.
    return <Badge tone={work.hold?.type === 'INTERNAL_BLOCKER' ? 'danger' : 'warning'} dot>{work.hold_label}</Badge>;
  }
  return <Badge tone={STATUS_TONE[work.status]} dot>{STATUS_LABEL[work.status]}</Badge>;
}

export function PriorityBadge({ priority }: { priority: Priority }) {
  return <Badge tone={PRIORITY_TONE[priority]}>{title(priority)}</Badge>;
}

export function DeadlineBadge({ work, showDate = true }: { work: Pick<Work, 'deadline' | 'deadline_info'>; showDate?: boolean }) {
  const info = work.deadline_info;
  return (
    <span className="inline-flex flex-col items-start gap-0.5">
      {showDate && <span className="text-sm text-text">{date(work.deadline)}</span>}
      <Badge tone={DEADLINE_TONE[info.state]}>{info.label}</Badge>
    </span>
  );
}

/** Progress is always computed from the tasks by the server; this only draws it. */
export function ProgressBar({ value, label, tone = 'primary' }: { value: number; label?: ReactNode; tone?: 'primary' | 'success' | 'warning' }) {
  const pct = Math.max(0, Math.min(100, Math.round(value)));
  const bar = { primary: 'bg-primary', success: 'bg-success', warning: 'bg-warning' }[tone];
  return (
    <div className="min-w-[96px]">
      <div className="mb-1 flex items-baseline justify-between gap-2 text-xs">
        <span className="text-text-muted">{label}</span>
        <span className="font-medium tabular-nums text-text">{pct}%</span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-neutral-bg" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <div className={`h-full rounded-full transition-[width] duration-500 ${bar}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/** Small "Live" indicator: green while the real-time stream is connected, amber while only polling. */
export function LiveDot() {
  const live = useLiveConnected();
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-text-muted" title={live ? 'Updating in real time' : 'Reconnecting… refreshing every 30 seconds'}>
      <span className={`h-2 w-2 rounded-full ${live ? 'animate-pulse bg-success' : 'bg-warning'}`} aria-hidden="true" />
      {live ? 'Live' : 'Refreshing'}
    </span>
  );
}

export function Stat({ label, value, tone = 'neutral', hint }: { label: string; value: ReactNode; tone?: 'neutral' | 'danger' | 'warning' | 'success' | 'primary'; hint?: ReactNode }) {
  const color = { neutral: 'text-text', danger: 'text-danger', warning: 'text-warning', success: 'text-success', primary: 'text-primary' }[tone];
  return (
    <div className="rounded-lg border border-border bg-surface px-4 py-3 shadow-[var(--shadow-card)]">
      <p className="truncate text-xs font-medium text-text-muted">{label}</p>
      <p className={`mt-1 text-xl font-semibold tabular-nums ${color}`}>{value}</p>
      {hint && <p className="mt-0.5 truncate text-xs text-text-muted">{hint}</p>}
    </div>
  );
}

export const selectCls = 'h-9 rounded-md border border-border bg-surface px-2.5 text-sm text-text shadow-[var(--shadow-card)] hover:border-border-strong focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/25';
