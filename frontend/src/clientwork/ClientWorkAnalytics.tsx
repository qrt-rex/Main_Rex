import { useState } from 'react';
import { useApi } from '../lib/useApi';
import { number } from '../lib/format';
import { Card, CardHeader } from '../components/common/Card';
import { ErrorState } from '../components/common/ErrorState';
import { PageSkeleton } from '../components/common/Skeleton';
import { Tabs } from '../components/common/Tabs';
import { EmptyState } from '../components/common/EmptyState';
import { HBarChart, LineChart } from '../components/charts/Charts';
import { cw } from './api';
import { useClientWorkLive } from './live';
import { Stat, duration } from './ui';

/** Counters, completion trend, hold analysis, and (for Legal / Super Admin) per-member operational metrics. */
export function ClientWorkAnalytics() {
  const stats = useApi(cw.stats);
  useClientWorkLive(stats.reload);
  const [range, setRange] = useState<'daily' | 'weekly' | 'monthly'>('daily');

  if (stats.status === 'error' && !stats.data) return <Card><ErrorState onRetry={stats.reload} message={stats.error} /></Card>;
  if (!stats.data) return <PageSkeleton />;
  const s = stats.data;
  const c = s.counters;
  const p = s.performance;
  const mine = s.scope === 'mine';

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <Stat label={mine ? 'My clients' : 'Total active clients'} value={number(mine ? c.my_clients : c.total_active)} tone="primary" />
        <Stat label="Need action" value={number(c.need_action)} hint={`${c.in_progress} in progress`} />
        <Stat label="On hold" value={number(c.on_hold)} tone={c.on_hold ? 'warning' : 'neutral'} hint={`${c.waiting_for_client} waiting for client`} />
        <Stat label="Overdue" value={number(c.overdue)} tone={c.overdue ? 'danger' : 'neutral'} />
        <Stat label="Due today" value={number(c.due_today)} tone={c.due_today ? 'warning' : 'neutral'} />
        <Stat label="Due soon" value={number(c.due_soon)} hint="next 3 days" />
        <Stat label="Completed today" value={number(c.completed_today)} tone="success" />
        <Stat label="Completed this week" value={number(c.completed_this_week)} tone="success" />
        <Stat label="Completed this month" value={number(c.completed_this_month)} tone="success" />
        <Stat label="Completed (all time)" value={number(c.completed)} tone="success" />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            title="Completion trend"
            description="Client work completed per day, week or month"
            actions={<Tabs className="border-0" active={range} onChange={(id) => setRange(id as typeof range)}
              tabs={[{ id: 'daily', label: 'Daily' }, { id: 'weekly', label: 'Weekly' }, { id: 'monthly', label: 'Monthly' }]} />}
          />
          <div className="p-4"><LineChart data={s.trend[range]} valueLabel="Completed" /></div>
        </Card>
        <Card>
          <CardHeader title="Client work status" description="Where each client's work stands" />
          <div className="p-4"><HBarChart data={s.status_chart} valueLabel="Clients" emptyText="No client work yet" /></div>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader title="Performance" description="Averages over completed work" />
          <dl className="divide-y divide-border text-sm">
            {([
              ['Total clients', number(p.total_clients)],
              ['Average completion time', p.avg_completion_seconds ? duration(p.avg_completion_seconds) : '—'],
              ['Average active working time', p.avg_active_seconds ? duration(p.avg_active_seconds) : '—'],
              ['Average on-hold time', p.avg_hold_seconds ? duration(p.avg_hold_seconds) : '—'],
              ['Average client response time', p.avg_response_seconds ? duration(p.avg_response_seconds) : '—'],
              ['Completed work', number(p.completed_work)],
              ['Pending work', number(p.pending_work)],
              ['Overdue work', number(p.overdue_work)],
            ] as [string, string][]).map(([k, v]) => (
              <div key={k} className="flex items-center justify-between gap-3 px-4 py-2.5"><dt className="text-text-muted">{k}</dt><dd className="font-medium tabular-nums text-text">{v}</dd></div>
            ))}
          </dl>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader title="On-hold analysis" description="Blocked work, split by who is holding it up" />
          <div className="grid gap-4 p-4 sm:grid-cols-2">
            <div className="grid grid-cols-2 gap-3 self-start">
              <Stat label="Total on hold" value={number(s.hold_analysis.total_on_hold)} tone={s.hold_analysis.total_on_hold ? 'warning' : 'neutral'} />
              <Stat label="Avg hold duration" value={s.hold_analysis.avg_hold_seconds ? duration(s.hold_analysis.avg_hold_seconds) : '—'} />
              <Stat label="Waiting for client" value={number(s.hold_analysis.waiting_for_client)} />
              <Stat label="Internal blocker" value={number(s.hold_analysis.internal_blocker)} />
            </div>
            <HBarChart data={s.hold_analysis.chart} valueLabel="Clients" slot={3} emptyText="Nothing is on hold" />
          </div>
        </Card>
      </div>

      {s.members && (
        <Card>
          <CardHeader title="Member performance" description="Operational counts per assigned member, with no composite score" />
          {s.members.length === 0 ? (
            <EmptyState compact title="No assignments yet" description="Assign a client from the Legal dashboard to start tracking." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-border bg-surface-secondary text-xs uppercase tracking-wide text-text-muted">
                    <th className="px-4 py-2.5 font-medium">Member</th>
                    {['Assigned clients', 'Completed', 'Pending', 'Overdue', 'Avg completion time'].map((h) => <th key={h} className="px-4 py-2.5 text-right font-medium">{h}</th>)}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {s.members.map((m) => (
                    <tr key={m.user_id}>
                      <td className="px-4 py-2.5 font-medium text-text">{m.name}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{m.assigned}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-success">{m.completed}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{m.pending}</td>
                      <td className={`px-4 py-2.5 text-right tabular-nums ${m.overdue ? 'font-medium text-danger' : ''}`}>{m.overdue}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{m.avg_completion_seconds ? duration(m.avg_completion_seconds) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
