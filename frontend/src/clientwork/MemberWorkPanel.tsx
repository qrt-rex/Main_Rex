import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, ListTodo } from 'lucide-react';
import { useApi } from '../lib/useApi';
import { Card, CardHeader } from '../components/common/Card';
import { Table, type Column } from '../components/common/Table';
import { EmptyState } from '../components/common/EmptyState';
import { cw, type Work } from './api';
import { useClientWorkLive } from './live';
import { DeadlineBadge, LiveDot, WorkStatusBadge } from './ui';

const columns: Column<Work>[] = [
  { key: 'client', header: 'Client', render: (w) => <span className="block min-w-0"><span className="block truncate font-medium text-text">{w.client_name}</span><span className="block truncate text-xs text-text-muted">{w.work_type}</span></span>, sortValue: (w) => w.client_name },
  { key: 'status', header: 'Status', render: (w) => <WorkStatusBadge work={w} />, sortValue: (w) => w.status },
  { key: 'deadline', header: 'Deadline', render: (w) => <DeadlineBadge work={w} />, sortValue: (w) => w.deadline ?? '9999' },
  { key: 'next', header: 'Next action', render: (w) => <span className="block max-w-[220px] truncate text-text-secondary" title={w.next_action}>{w.next_action}</span> },
];

/**
 * Role dashboards: the clients this person should work on next, most urgent first. No counters.
 * Renders nothing until the user has been given client work; the live stream makes it appear the moment they are.
 */
export function MemberWorkPanel() {
  const navigate = useNavigate();
  const summary = useApi(() => cw.summary(true));
  const queue = useApi(() => cw.list({ bucket: 'need_action', sort: 'priority', order: 'asc', limit: 8 }, true));
  useClientWorkLive(() => { summary.reload(); queue.reload(); });
  const c = summary.data?.counters;
  if (!c || c.my_clients === 0) return null;
  const items = queue.data?.items ?? [];

  return (
    <section className="mt-6 space-y-3" aria-label="My client work">
      <Card>
        <CardHeader title="My clients to work on" description="Most urgent first"
          actions={<><LiveDot /><Link to="/client-work" className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">See all <ArrowRight size={12} aria-hidden="true" /></Link></>} />
        <Table columns={columns} rows={items} rowKey={(w) => w.id} loading={!queue.data} onRowClick={(w) => navigate(`/client-work/${w.id}`)}
          empty={<EmptyState compact icon={ListTodo} title="Your queue is clear" description="Clients Legal assigns to you appear here instantly." />} />
      </Card>
    </section>
  );
}
