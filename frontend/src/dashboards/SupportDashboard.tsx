import { Link } from 'react-router-dom';
import { CircleCheck, Headset, ListChecks, Megaphone, TriangleAlert, Users } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { useApi } from '../lib/useApi';
import { number, relativeTime } from '../lib/format';
import { Badge } from '../components/common/Badge';
import { Card, CardHeader } from '../components/common/Card';
import { EmptyState } from '../components/common/EmptyState';
import { ErrorState } from '../components/common/ErrorState';
import { Skeleton } from '../components/common/Skeleton';
import { Table, type Column } from '../components/common/Table';
import { StatCard } from '../components/dashboard/StatCard';
import { ActivityTable, ModuleEntities, SectionTitle, StatGrid, TaskPanel, TwoColumn } from './components';
import { DashboardIntro } from './DashboardShell';
import { supportDesk, type SupportDesk, type WorkspaceSummary } from './api';

type Request = SupportDesk['open_requests'][number];

/** Support control centre: open client requests first, then everything else. */
export function SupportDashboard({ summary }: { summary: WorkspaceSummary }) {
  const { can } = useAuth();
  const { data: desk, status, error, reload } = useApi(supportDesk, [], can('support.desk.view'));
  const { clients, updates, activity, me } = summary;

  const columns: Column<Request>[] = [
    { key: 'title', header: 'Request', render: (r) => (
      <span className="block min-w-0">
        <span className="block truncate font-medium text-text">{r.title}</span>
        {r.reason && <span className="block truncate text-xs text-text-muted">{r.reason}</span>}
      </span>
    ), sortValue: (r) => r.title },
    { key: 'client', header: 'Client', render: (r) => <span className="text-text-secondary">{r.client}</span>, sortValue: (r) => r.client },
    { key: 'owner', header: 'Owner', render: (r) => <span className="text-text-secondary">{r.owner}</span> },
    { key: 'category', header: 'Category', render: (r) => <Badge tone="warning">{r.category.replace(/_/g, ' ').toLowerCase()}</Badge> },
    { key: 'timestamp', header: 'Raised', align: 'right', render: (r) => <span className="whitespace-nowrap text-text-muted">{relativeTime(r.timestamp)}</span>, sortValue: (r) => r.timestamp || '' },
  ];

  return (
    <>
      <DashboardIntro subtitle="Open requests, client accounts and today's work." />

      <StatGrid>
        <StatCard
          icon={Headset}
          tone={desk && desk.total_open > 0 ? 'warning' : 'success'}
          label="Open requests"
          value={desk ? number(desk.total_open) : can('support.desk.view') ? <Skeleton className="h-7 w-10" /> : '—'}
          hint="Raised against client work"
        />
        <StatCard icon={ListChecks} label="Your tasks" value={number(me.tasks.length)} hint="Assigned to you" />
        {clients && <StatCard icon={Users} tone="info" label="Clients" value={number(clients.total_clients)} hint={`${clients.active_projects} active projects`} />}
        <StatCard icon={Megaphone} label="Company updates" value={number(updates.length)} hint="Active announcements" />
      </StatGrid>

      <SectionTitle>Requests needing action</SectionTitle>
      <TwoColumn
        main={<>
          <Card>
            <CardHeader
              title="Open client requests"
              description="Newest first"
              actions={can('hr.productivity.view') ? <Link to="/hr/productivity" className="text-xs font-medium text-primary hover:underline">Open delivery board</Link> : undefined}
            />
            {status === 'error' ? (
              <ErrorState compact onRetry={reload} message={error} />
            ) : (
              <Table
                columns={columns}
                rows={desk?.open_requests ?? []}
                rowKey={(r) => r.id}
                loading={status === 'loading'}
                empty={<EmptyState compact icon={CircleCheck} title="No open requests" description="Blocked client work will appear here as soon as it is raised." />}
              />
            )}
          </Card>
          <ActivityTable title="Recent activity" items={activity} link={can('audit.view') ? { to: '/admin/activity', label: 'Full activity log' } : undefined} />
        </>}
        side={<>
          <TaskPanel
            title="Pending work"
            description="Assigned to you"
            items={me.tasks}
            emptyTitle="Nothing assigned"
            emptyDescription="Tasks assigned to your account appear here."
            emptyIcon={ListChecks}
          />
          <TaskPanel
            title="New updates by the company"
            items={updates}
            emptyTitle="No announcements"
            emptyIcon={Megaphone}
            link={can('hr.broadcasts.view') ? { to: '/hr/broadcasts', label: 'All broadcasts' } : undefined}
          />
          {clients && clients.blocked_tasks > 0 && (
            <TaskPanel
              title="Escalations"
              description="Blocked client work"
              items={clients.tasks.filter((t) => t.status === 'BLOCKED').map((t) => ({
                id: t.id, title: t.title, description: t.reason || `${t.client} · ${t.project}`, status: t.status, timestamp: t.timestamp,
              }))}
              emptyTitle="No escalations"
              emptyIcon={TriangleAlert}
              limit={5}
            />
          )}
        </>}
      />

      <SectionTitle>Your modules</SectionTitle>
      <ModuleEntities ids={['ops-dashboard', 'sales-customers', 'sales-contacts', 'hr-productivity', 'hr-broadcasts', 'ops-reports']} />
    </>
  );
}
