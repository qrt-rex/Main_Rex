import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, ListTodo } from 'lucide-react';
import { useApi } from '../lib/useApi';
import { number } from '../lib/format';
import { Card, CardHeader } from '../components/common/Card';
import { Table, type Column } from '../components/common/Table';
import { EmptyState } from '../components/common/EmptyState';
import { cw, PRIORITIES, type Work } from './api';
import { useClientWorkLive } from './live';
import { DeadlineBadge, LiveDot, PriorityBadge, ProgressBar, Stat, WorkStatusBadge } from './ui';

const columns: Column<Work>[] = [
  { key: 'client', header: 'Client', render: (w) => <span className="block min-w-0"><span className="block truncate font-medium text-text">{w.client_name}</span><span className="block truncate text-xs text-text-muted">{w.work_type}</span></span>, sortValue: (w) => w.client_name },
  { key: 'priority', header: 'Priority', render: (w) => <PriorityBadge priority={w.priority} />, sortValue: (w) => PRIORITIES.indexOf(w.priority) },
  { key: 'status', header: 'Status', render: (w) => <WorkStatusBadge work={w} />, sortValue: (w) => w.status },
  { key: 'tasks', header: 'Progress', render: (w) => <ProgressBar value={w.progress} label={`${w.completed_tasks}/${w.total_tasks} tasks`} />, sortValue: (w) => w.progress },
  { key: 'deadline', header: 'Deadline', render: (w) => <DeadlineBadge work={w} />, sortValue: (w) => w.deadline ?? '9999' },
  { key: 'next', header: 'Next action', render: (w) => <span className="block max-w-[220px] truncate text-text-secondary" title={w.next_action}>{w.next_action}</span> },
];

/**
 * Role dashboards: "My Clients / Need Action / On Hold / Completed / Overdue / Due today" and the My Action Queue.
 * Renders nothing until the user has been given client work; the live stream makes it appear the moment they are.
 */
export function MemberWorkPanel({ queueOnly = false }: { queueOnly?: boolean }) {
  const navigate = useNavigate();
  const summary = useApi(() => cw.summary(true));
  const queue = useApi(() => cw.list({ bucket: 'need_action', sort: 'priority', order: 'asc', limit: 8 }, true));
  useClientWorkLive(() => { summary.reload(); queue.reload(); });
  const c = summary.data?.counters;
  if (!c || c.my_clients === 0) return null;
  const items = queue.data?.items ?? [];

  return (
    <section className="mt-6 space-y-3" aria-label="My client work">
      {!queueOnly && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <Stat label="My clients" value={number(c.my_clients)} tone="primary" />
          <Stat label="Need action" value={number(c.need_action)} hint={`${c.in_progress} in progress`} />
          <Stat label="On hold" value={number(c.on_hold)} tone={c.on_hold ? 'warning' : 'neutral'} hint={`${c.waiting_for_client} waiting for client`} />
          <Stat label="Completed" value={number(c.completed)} tone="success" />
          <Stat label="Overdue" value={number(c.overdue)} tone={c.overdue ? 'danger' : 'neutral'} />
          <Stat label="Due today" value={number(c.due_today)} tone={c.due_today ? 'warning' : 'neutral'} />
        </div>
      )}
      <Card>
        <CardHeader title="My action queue" description="Sorted by priority, then deadline"
          actions={<><LiveDot /><Link to="/client-work" className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">All my client work <ArrowRight size={12} aria-hidden="true" /></Link></>} />
        <Table columns={columns} rows={items} rowKey={(w) => w.id} loading={!queue.data} onRowClick={(w) => navigate(`/client-work/${w.id}`)}
          empty={<EmptyState compact icon={ListTodo} title="Your queue is clear" description="Clients Legal assigns to you appear here instantly." />} />
      </Card>
    </section>
  );
}
