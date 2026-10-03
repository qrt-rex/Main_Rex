import { CircleCheck, ListChecks, Megaphone, TriangleAlert } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { useApi } from '../lib/useApi';
import { relativeTime } from '../lib/format';
import { Card } from '../components/common/Card';
import { EmptyState } from '../components/common/EmptyState';
import { ErrorState } from '../components/common/ErrorState';
import { Table, type Column } from '../components/common/Table';
import { ModuleEntities, SectionTitle, TaskPanel } from './components';
import { DashboardIntro } from './DashboardShell';
import { supportDesk, type SupportDesk, type WorkspaceSummary } from './api';

type Request = SupportDesk['open_requests'][number];

/** Support home: clients waiting for help first, then your tasks and company news. */
export function SupportDashboard({ summary }: { summary: WorkspaceSummary }) {
  const { can } = useAuth();
  const { data: desk, status, error, reload } = useApi(supportDesk, [], can('support.desk.view'));
  const { clients, updates, me } = summary;

  const columns: Column<Request>[] = [
    { key: 'title', header: 'What they need', render: (r) => (
      <span className="block min-w-0">
        <span className="block truncate font-medium text-text">{r.title}</span>
        {r.reason && <span className="block truncate text-xs text-text-muted">{r.reason}</span>}
      </span>
    ), sortValue: (r) => r.title },
    { key: 'client', header: 'Client', render: (r) => <span className="text-text-secondary">{r.client}</span>, sortValue: (r) => r.client },
    { key: 'timestamp', header: 'Asked', align: 'right', render: (r) => <span className="whitespace-nowrap text-text-muted">{relativeTime(r.timestamp)}</span>, sortValue: (r) => r.timestamp || '' },
  ];

  const blocked = clients
    ? clients.tasks.filter((t) => t.status === 'BLOCKED').map((t) => ({
        id: t.id, title: t.title, description: t.reason || `${t.client} · ${t.project}`, status: t.status, timestamp: t.timestamp,
      }))
    : [];

  return (
    <>
      <DashboardIntro subtitle="Help the clients who are waiting." />

      <SectionTitle>Clients waiting for help</SectionTitle>
      <Card>
        {status === 'error' ? (
          <ErrorState compact onRetry={reload} message={error} />
        ) : (
          <Table
            columns={columns}
            rows={desk?.open_requests ?? []}
            rowKey={(r) => r.id}
            loading={status === 'loading'}
            empty={<EmptyState compact icon={CircleCheck} title="No one is waiting" description="New client requests show up here." />}
          />
        )}
      </Card>

      <div className="mt-8 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <TaskPanel
          title="Tasks for me"
          items={me.tasks}
          emptyTitle="Nothing to do right now"
          emptyDescription="Work given to you shows up here."
          emptyIcon={ListChecks}
          limit={6}
        />
        <TaskPanel
          title="Company news"
          items={updates}
          emptyTitle="No news"
          emptyIcon={Megaphone}
          link={can('hr.broadcasts.view') ? { to: '/hr/broadcasts', label: 'See all' } : undefined}
          limit={5}
        />
      </div>

      {blocked.length > 0 && (
        <div className="mt-4">
          <TaskPanel title="Stuck work" items={blocked} emptyTitle="Nothing is stuck" emptyIcon={TriangleAlert} limit={5} />
        </div>
      )}

      <SectionTitle>Everything else</SectionTitle>
      <ModuleEntities ids={['sales-customers', 'sales-contacts', 'hr-productivity', 'hr-broadcasts', 'ops-reports']} />
    </>
  );
}
