import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Briefcase, CalendarDays, Clock, FilePlus2, FolderKanban, ListChecks,
  Megaphone, Plus, TriangleAlert, Users, Wallet,
} from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { date, money, number } from '../lib/format';
import { Button } from '../components/common/Button';
import { Card, CardHeader } from '../components/common/Card';
import { EmptyState } from '../components/common/EmptyState';
import { StatusBadge } from '../components/common/Badge';
import { Table, type Column } from '../components/common/Table';
import { StatCard } from '../components/dashboard/StatCard';
import { HBarChart } from '../components/charts/Charts';
import {
  ActivityTable, DetailCard, ModuleEntities, ProgressCard, SectionTitle,
  StatGrid, TaskPanel, TwoColumn,
} from './components';
import { DashboardIntro } from './DashboardShell';
import { SalesToday } from '../sales/SalesToday';
import { QuickLeadModal } from '../sales/SalesWidgets';
import { ClientDocumentFormModal, MyDocumentForms } from './ClientDocumentForm';
import type { TaskItem, WorkspaceSummary } from './api';

/** Sales control centre: sales hub, schemes, flyers, sales knowledge, client progress and integrated employee records. */
export function SalesDashboard({ summary }: { summary: WorkspaceSummary }) {
  const { user, can } = useAuth();
  const { clients, updates, activity, me } = summary;
  const [docFormOpen, setDocFormOpen] = useState(false);
  const [quickLeadOpen, setQuickLeadOpen] = useState(false);
  const [formsVersion, setFormsVersion] = useState(0);

  const openLeave = me.leaves.filter((l) => (l.status ?? '').toUpperCase() === 'PENDING').length;
  const canSubmitDocs = can('documents.submit');

  const columns: Column<TaskItem>[] = [
    { key: 'title', header: 'Work item', render: (r) => <span className="font-medium text-text">{r.title}</span>, sortValue: (r) => r.title },
    { key: 'client', header: 'Client', render: (r) => <span className="text-text-secondary">{r.client}</span>, sortValue: (r) => r.client },
    { key: 'project', header: 'Project', render: (r) => <span className="text-text-secondary">{r.project || '—'}</span> },
    { key: 'owner', header: 'Owner', render: (r) => <span className="text-text-secondary">{r.owner}</span> },
    { key: 'status', header: 'Status', align: 'right', render: (r) => <StatusBadge status={r.status} />, sortValue: (r) => r.status },
  ];

  return (
    <>
      <DashboardIntro
        subtitle="Your day, leads to call, schemes, marketing material, sales knowledge, client progress & employee records."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" onClick={() => setQuickLeadOpen(true)}>
              <Plus size={15} /> New CRM lead
            </Button>
            {canSubmitDocs && (
              <Button onClick={() => setDocFormOpen(true)}>
                <FilePlus2 size={15} /> Create document form
              </Button>
            )}
          </div>
        }
      />

      {quickLeadOpen && (
        <QuickLeadModal
          onClose={() => setQuickLeadOpen(false)}
          onSaved={() => window.location.reload()}
        />
      )}

      {docFormOpen && (
        <ClientDocumentFormModal
          onClose={() => setDocFormOpen(false)}
          onSubmitted={() => setFormsVersion((n) => n + 1)}
        />
      )}

      {/* 1. Complete Sales Workspace: Calling, Dialer, Schemes, Flyers, Sales Info, Attendance */}
      {can('sales.hub.view') && <SalesToday />}

      {/* 2. Client & Delivery Operations Overview */}
      {clients && (
        <>
          <SectionTitle>Client delivery overview</SectionTitle>
          <StatGrid>
            <StatCard icon={Users} label="Active clients" to={can('hr.productivity.view') ? '/hr/productivity' : undefined} value={number(clients.total_clients)} hint={`${clients.active_projects} active projects`} />
            <StatCard icon={FolderKanban} tone="info" label="Open work items" to={can('hr.productivity.view') ? '/hr/productivity' : undefined} value={number(clients.open_tasks)} hint={`${clients.blocked_tasks} blocked`} />
            <StatCard icon={Clock} tone="success" label="Hours delivered" value={`${number(clients.logged_hours)} h`} hint={clients.budget_hours > 0 ? `of ${number(clients.budget_hours)} h budgeted` : 'No budget set'} />
            <StatCard icon={ListChecks} tone="warning" label="Your open tasks" value={number(me.tasks.length)} hint="Assigned to you" />
          </StatGrid>
        </>
      )}

      {/* 3. Employee Profile, Leave, Payslips & Personal Records */}
      <SectionTitle>Your employee profile & records</SectionTitle>
      <StatGrid>
        <StatCard icon={ListChecks} label="Your assigned tasks" value={number(me.tasks.length)} hint="Personal work queue" />
        <StatCard icon={CalendarDays} tone="warning" label="Leave requests" value={number(openLeave)} hint={`${me.leaves.length} on record`} to={can('hr.leave.view') ? '/hr/leave' : undefined} />
        {me.payslip && <StatCard icon={Wallet} tone="info" label="Latest payslip" value={money(me.payslip.net_salary)} hint={me.payslip.period || 'Most recent'} to={can('hr.payroll.view') ? '/hr/payroll' : undefined} />}
        <StatCard icon={Megaphone} label="Company announcements" value={number(updates.length)} hint="Active updates" to={can('hr.broadcasts.view') ? '/hr/broadcasts' : undefined} />
      </StatGrid>

      <TwoColumn
        main={<>
          {clients ? (
            <Card>
              <CardHeader
                title="Client work in progress"
                description="Blocked items first, then everything still open"
                actions={can('hr.productivity.view') ? <Link to="/hr/productivity" className="text-xs font-medium text-primary hover:underline">Open delivery board</Link> : undefined}
              />
              <Table
                columns={columns}
                rows={clients.tasks}
                rowKey={(r) => r.id}
                empty={<EmptyState compact icon={Briefcase} title="No open client work" description="Tasks raised against client projects appear here." />}
              />
            </Card>
          ) : (
            <TaskPanel
              title="Your assigned tasks"
              description="Everything currently assigned to you"
              items={me.tasks}
              emptyTitle="Nothing assigned"
              emptyDescription="Tasks assigned to your account will appear here."
              emptyIcon={ListChecks}
            />
          )}

          {clients && clients.by_client.length > 0 && (
            <Card>
              <CardHeader title="Projects by client" description="Where delivery effort is committed" />
              <div className="p-4"><HBarChart data={clients.by_client} valueLabel="Projects" /></div>
            </Card>
          )}

          <TaskPanel
            title="Company announcements"
            items={updates}
            emptyTitle="No announcements"
            emptyIcon={Megaphone}
            link={can('hr.broadcasts.view') ? { to: '/hr/broadcasts', label: 'All broadcasts' } : undefined}
          />
        </>}
        side={<>
          {/* Employee Self-Service Cards */}
          {me.employee ? (
            <DetailCard
              title="Employee details"
              rows={[
                ['Name', me.employee.full_name || user?.username || '—'],
                ['Code', me.employee.employee_code || '—'],
                ['Department', me.employee.department || 'Sales'],
                ['Designation', me.employee.designation || 'Sales Executive'],
                ['Joined', me.employee.joining_date ? date(me.employee.joining_date) : '—'],
                ['Status', me.employee.status || 'ACTIVE'],
              ]}
            />
          ) : (
            <DetailCard
              title="Sales Account"
              rows={[
                ['Username', user?.username || '—'],
                ['Email', user?.email || '—'],
                ['Role', 'Sales Person & Employee'],
              ]}
            />
          )}

          {canSubmitDocs && <MyDocumentForms reloadKey={formsVersion} onCreate={() => setDocFormOpen(true)} />}

          <TaskPanel
            title="Your leave history"
            description="Recent requests & status"
            items={me.leaves}
            emptyTitle="No leave requests"
            emptyDescription="Requests you submit will appear here."
            emptyIcon={CalendarDays}
            link={can('hr.leave.view') ? { to: '/hr/leave', label: 'Apply or view leave' } : undefined}
            limit={5}
          />

          {me.payslip && (
            <DetailCard
              title="Latest salary slip"
              description="Issued to you"
              rows={[
                ['Pay period', me.payslip.period || 'Most recent'],
                ['Net pay', money(me.payslip.net_salary)],
              ]}
            />
          )}

          {clients && clients.budget_hours > 0 && (
            <ProgressCard
              title="Delivery progress"
              description="Logged against budgeted hours"
              rows={[
                { label: 'Hours delivered', value: clients.logged_hours, max: clients.budget_hours, hint: `${number(clients.logged_hours)} / ${number(clients.budget_hours)} h` },
                { label: 'Blocked work items', value: clients.blocked_tasks, max: Math.max(clients.open_tasks, 1), hint: number(clients.blocked_tasks), tone: clients.blocked_tasks > 0 ? 'warning' : 'success' },
              ]}
            />
          )}

          {clients && clients.blocked_tasks > 0 && (
            <TaskPanel
              title="Needs attention"
              items={clients.tasks.filter((t) => t.status === 'BLOCKED').map((t) => ({
                id: t.id, title: t.title, description: t.reason || `${t.client} · ${t.project}`, status: t.status, timestamp: t.timestamp,
              }))}
              emptyTitle="Nothing blocked"
              emptyIcon={TriangleAlert}
              limit={5}
            />
          )}
        </>}
      />

      <SectionTitle>Your accessible modules</SectionTitle>
      <ModuleEntities ids={['sales-leads', 'sales-deals', 'sales-customers', 'sales-contacts', 'hr-productivity', 'hr-leave', 'hr-broadcasts', 'hr-payslips']} />

      <SectionTitle>Recent account activity</SectionTitle>
      <ActivityTable title="Your recent actions" items={activity} link={can('audit.view') ? { to: '/admin/activity', label: 'Full activity log' } : undefined} />
    </>
  );
}
