import { Link } from 'react-router-dom';
import {
  Banknote, CalendarCheck, CalendarClock, FileSpreadsheet, FileText, Megaphone, Radio, Scale, ShieldCheck, UserPlus, UserRoundPlus, Users, UsersRound,
} from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { money, number } from '../lib/format';
import { Card, CardHeader } from '../components/common/Card';
import { StatCard } from '../components/dashboard/StatCard';
import { HBarChart } from '../components/charts/Charts';
import { ActivityTable, ModuleEntities, ProgressCard, SectionTitle, StatGrid, TaskPanel, TwoColumn } from './components';
import { DashboardIntro } from './DashboardShell';
import { SalesTeamOverview } from '../sales/SalesToday';
import type { WorkspaceSummary } from './api';

/** Organisation-wide control centre: people, money, pipeline, access and activity. */
export function AdminDashboard({ summary }: { summary: WorkspaceSummary }) {
  const { can } = useAuth();
  const { workforce, payroll, recruitment, users, approvals = [], updates, activity } = summary;

  const priority = [
    ...approvals,
    ...(recruitment && recruitment.pending_onboarding > 0
      ? [{
          id: 'onboarding',
          title: `${recruitment.pending_onboarding} candidate${recruitment.pending_onboarding === 1 ? '' : 's'} awaiting onboarding`,
          description: 'Joining links issued but not completed',
          link: '/hr/recruitment',
          status: 'PENDING',
        }]
      : []),
  ];

  return (
    <>
      <DashboardIntro
        subtitle="Organisation overview across people, payroll, pipeline and access."
        actions={<>
          <a
            href="/ivr"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-9 items-center gap-2 rounded-md bg-[#FACC15] px-3.5 text-sm font-bold text-neutral-950 shadow-[var(--shadow-card)] hover:bg-amber-400 active:bg-amber-500 transition-colors"
            title="Open IVR Voice Blasts in a new window"
          >
            <Radio size={15} className="stroke-[2.4]" aria-hidden="true" /> IVR
          </a>
          {can('users.manage') && (
            <Link to="/admin/users?new=1" className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-surface px-3.5 text-sm font-medium text-text shadow-[var(--shadow-card)] hover:bg-surface-secondary">
              <UserRoundPlus size={15} aria-hidden="true" /> Create member
            </Link>
          )}
          {can('hr.employees.create') && (
            <Link to="/hr/employees/new" className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-3.5 text-sm font-medium text-on-primary shadow-[var(--shadow-card)] hover:bg-primary-hover">
              <UserPlus size={15} aria-hidden="true" /> Add employee
            </Link>
          )}
          {can('billing.create') && (
            <Link to="/billing/create" className="inline-flex h-9 items-center gap-2 rounded-md bg-emerald-600 px-3.5 text-sm font-medium text-white shadow-[var(--shadow-card)] hover:bg-emerald-700">
              <FileSpreadsheet size={15} aria-hidden="true" /> Create Invoice
            </Link>
          )}
          {can('billing.view') && (
            <Link to="/billing/invoices" className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-surface px-3.5 text-sm font-medium text-text shadow-[var(--shadow-card)] hover:bg-surface-secondary">
              <FileText size={15} aria-hidden="true" /> Bill & Invoices
            </Link>
          )}
          {can('legal.view') && (
            <Link to="/legal" className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-surface px-3.5 text-sm font-medium text-text shadow-[var(--shadow-card)] hover:bg-surface-secondary">
              <Scale size={15} aria-hidden="true" /> Legal [Contracts & cases]
            </Link>
          )}
        </>}
      />

      <StatGrid>
        {workforce && (
          <StatCard
            icon={UsersRound}
            label="Workforce"
            to={can('hr.employees.view') ? '/hr/employees' : undefined}
            value={number(workforce.active_employees + workforce.active_interns)}
            hint={`${workforce.active_employees} employees · ${workforce.active_interns} interns`}
          />
        )}
        {workforce && (
          <StatCard
            icon={CalendarClock}
            tone="success"
            label="Present today"
            to={can('hr.attendance.view') ? '/hr/attendance' : undefined}
            value={number(workforce.present_today)}
            hint={`${workforce.late_today} late · ${workforce.on_leave_today} on leave`}
          />
        )}
        {payroll && (
          <StatCard
            icon={Banknote}
            tone="info"
            label="Net payroll disbursed"
            to={can('hr.payroll.view') ? '/hr/payroll' : undefined}
            value={money(payroll.total_net_disbursed)}
            hint={`${payroll.slips_total} payslips issued`}
          />
        )}
        {users && (
          <StatCard
            icon={Users}
            label="Active users"
            to="/admin/users"
            value={number(users.active)}
            hint={`${users.total} accounts · ${users.disabled} disabled`}
          />
        )}
        {recruitment && (
          <StatCard
            icon={UserPlus}
            label="Candidates"
            to="/hr/recruitment"
            value={number(recruitment.total_candidates)}
            hint={`${recruitment.pending_onboarding} pending onboarding`}
          />
        )}
      </StatGrid>

      <SectionTitle>Priority and pending work</SectionTitle>
      <TwoColumn
        main={<>
          <TaskPanel
            title="Pending approvals"
            description="Items waiting on an administrator"
            items={priority}
            emptyTitle="Nothing needs approval"
            emptyDescription="Leave requests and onboarding follow-ups will appear here."
            emptyIcon={CalendarCheck}
            link={can('hr.leave.view') ? { to: '/hr/leave', label: 'All leave requests' } : undefined}
          />
          {workforce && workforce.departments.length > 0 && (
            <Card>
              <CardHeader
                title="Employees by department"
                description="Current headcount"
                actions={can('hr.employees.view') ? <Link to="/hr/employees" className="text-xs font-medium text-primary hover:underline">View directory</Link> : undefined}
              />
              <div className="p-4"><HBarChart data={workforce.departments} valueLabel="Employees" /></div>
            </Card>
          )}
          {recruitment && recruitment.by_status.length > 0 && (
            <Card>
              <CardHeader
                title="Recruitment pipeline"
                description="Candidates by stage"
                actions={<Link to="/hr/recruitment" className="text-xs font-medium text-primary hover:underline">Open pipeline</Link>}
              />
              <div className="p-4"><HBarChart data={recruitment.by_status} valueLabel="Candidates" slot={2} /></div>
            </Card>
          )}
        </>}
        side={<>
          <TaskPanel
            title="Updates from the company"
            items={updates}
            emptyTitle="No announcements"
            emptyDescription="Published broadcasts appear here."
            emptyIcon={Megaphone}
            link={can('hr.broadcasts.view') ? { to: '/hr/broadcasts', label: 'All broadcasts' } : undefined}
          />
          {payroll && (
            <ProgressCard
              title="Payroll progress"
              description="Runs recorded this cycle"
              rows={[
                { label: 'Approved or paid', value: payroll.approved_payroll, max: payroll.approved_payroll + payroll.pending_payroll, tone: 'success' },
                { label: 'Awaiting approval', value: payroll.pending_payroll, max: payroll.approved_payroll + payroll.pending_payroll, tone: 'warning' },
              ]}
            />
          )}
          {users && users.by_role.length > 0 && (
            <Card>
              <CardHeader
                title="Access by role"
                actions={can('permissions.manage') ? <Link to="/admin/permissions" className="text-xs font-medium text-primary hover:underline">Manage access</Link> : undefined}
              />
              <div className="p-4"><HBarChart data={users.by_role} valueLabel="Accounts" slot={3} /></div>
            </Card>
          )}
        </>}
      />

      {can('sales.hub.view') && <SalesTeamOverview />}

      <SectionTitle
        action={can('permissions.manage') ? <Link to="/admin/permissions" className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"><ShieldCheck size={13} aria-hidden="true" /> Access management</Link> : undefined}
      >
        Your modules
      </SectionTitle>
      <ModuleEntities />

      <SectionTitle>Recent activity</SectionTitle>
      <ActivityTable
        title="Across the CRM"
        description="Sign-ins, record changes and permission updates"
        items={activity}
        link={can('audit.view') ? { to: '/admin/activity', label: 'Full activity log' } : undefined}
      />
    </>
  );
}
