import { Link } from 'react-router-dom';
import { ArrowRight, CheckCircle2, ClipboardList, PauseCircle, Zap } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useApi } from '../lib/useApi';
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
}

const TILES: Tile[] = [
  {
    bucket: 'need_action', label: 'To do', caption: 'Clients waiting on us', icon: Zap,
    tone: 'border-primary/30 bg-primary-soft text-primary',
    value: (c) => c.need_action,
  },
  {
    bucket: 'on_hold', label: 'On hold', caption: 'Stuck or waiting', icon: PauseCircle,
    tone: 'border-warning/30 bg-warning-bg text-warning',
    value: (c) => c.on_hold,
  },
  {
    bucket: 'completed', label: 'Done', caption: 'Finished work', icon: CheckCircle2,
    tone: 'border-success/30 bg-success-bg text-success',
    value: (c) => c.completed,
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
        title={<span className="inline-flex items-center gap-2"><ClipboardList size={16} className="text-primary" aria-hidden="true" /> Client work</span>}
        description={scope}
        actions={<><LiveDot /><Link to="/client-work" className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">Open <ArrowRight size={12} aria-hidden="true" /></Link></>}
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
                  <p className="mt-1 text-sm text-text-secondary">{t.caption}</p>
                </Link>
              );
            })}
          </div>
        </div>
      )}
    </Card>
  );
}
