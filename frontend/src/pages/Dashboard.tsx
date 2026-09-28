import { Link } from 'react-router-dom';
import { ArrowRight, Banknote, CalendarCheck, CalendarClock, Megaphone, ShieldCheck, UserPlus, Users, UsersRound } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { api } from '../lib/api';
import { useApi } from '../lib/useApi';
import { currentMonth, currentYear, dateTime, greeting, money, number, titleCase } from '../lib/format';
import { visibleSections } from '../modules/registry';
import { getDashboardMetrics, listEmployees, payrollMetrics } from '../hr/api';
import { Card, CardHeader } from '../components/common/Card';
import { StatCard } from '../components/dashboard/StatCard';
import { HBarChart } from '../components/charts/Charts';
import { Skeleton } from '../components/common/Skeleton';
import { ModuleCard } from '../components/modules/ModuleCard';

interface LogEntry { id: string; action: string; performed_by: string; target: string; timestamp: string }

function QuickAction({ to, icon: Icon, label }: { to: string; icon: LucideIcon; label: string }) {
  return (
    <Link to={to} className="group flex items-center gap-3 rounded-md border border-border bg-surface px-3 py-2.5 text-sm font-medium text-text transition-colors hover:border-border-strong hover:bg-surface-secondary">
      <span className="flex h-7 w-7 items-center justify-center rounded-md bg-primary-soft text-primary"><Icon size={15} aria-hidden="true" /></span>
      <span className="flex-1 truncate">{label}</span>
      <ArrowRight size={14} className="text-text-muted transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
    </Link>
  );
}

export function Dashboard() {
  const { user, can } = useAuth();
  const month = currentMonth();
  const year = currentYear();

  const hr = useApi(getDashboardMetrics, [], can('hr.dashboard.view'));
  const staff = useApi(() => listEmployees({ limit: 1000 }), [], can('hr.employees.view'));
  const payroll = useApi(() => payrollMetrics(month, year), [month, year], can('hr.payroll.view'));
  const users = useApi(() => api.get<{ is_active: boolean }[]>('/api/users'), [], can('users.manage'));
  const logs = useApi(() => api.get<{ logs: LogEntry[] }>('/api/logs', { limit: 6 }), [], can('audit.view'));

  const sections = visibleSections(can);
  const name = (user?.username || user?.email || '').split(/[\s@]/)[0];

  const stats: React.ReactNode[] = [];
  if (can('hr.dashboard.view')) {
    const m = hr.data;
    stats.push(
      <StatCard key="workforce" icon={UsersRound} label="Workforce" to="/hr/employees" value={m ? number(m.active_employees + m.active_interns) : <Skeleton className="h-7 w-16" />} hint={m ? `${m.active_interns} interns` : undefined} />,
      <StatCard key="present" icon={CalendarClock} tone="success" label="Present today" to="/hr/attendance" value={m ? number(m.attendance_summary.present_count) : <Skeleton className="h-7 w-12" />} hint={m ? `${m.attendance_summary.late_count} late · ${m.attendance_summary.half_day_count} half-day` : undefined} />,
      <StatCard key="leave" icon={CalendarCheck} tone="warning" label="Pending leave" to="/hr/leave" value={m ? number(m.leaves_summary.pending_requests_count) : <Skeleton className="h-7 w-12" />} hint={m ? `${m.leaves_summary.on_leave_today_count} on leave today` : undefined} />,
    );
  }
  if (can('hr.payroll.view')) {
    stats.push(<StatCard key="payroll" icon={Banknote} tone="info" label={`Net payroll · ${month.slice(0, 3)}`} to="/hr/payroll" value={payroll.data ? money(payroll.data.total_net_payroll) : <Skeleton className="h-7 w-24" />} hint={payroll.data ? `${payroll.data.processed_count} of ${payroll.data.total_employees} processed` : undefined} />);
  }
  if (can('hr.recruitment.view') && hr.data) {
    stats.push(<StatCard key="cand" icon={UserPlus} label="Candidates" to="/hr/recruitment" value={number(hr.data.total_candidates)} hint={`${hr.data.pending_onboarding} pending onboarding`} />);
  }
  if (can('users.manage')) {
    const active = users.data?.filter((u) => u.is_active).length;
    stats.push(<StatCard key="users" icon={Users} label="Active users" to="/admin/users" value={users.data ? number(active) : <Skeleton className="h-7 w-10" />} hint={users.data ? `${users.data.length} accounts` : undefined} />);
  }

  const actions: { to: string; icon: LucideIcon; label: string; perm: string }[] = [
    { to: '/hr/employees/new', icon: UserPlus, label: 'Add employee', perm: 'hr.employees.create' },
    { to: '/hr/leave', icon: CalendarCheck, label: 'Review leave requests', perm: 'hr.leave.approve' },
    { to: '/hr/payroll', icon: Banknote, label: 'Run payroll', perm: 'hr.payroll.process' },
    { to: '/hr/broadcasts', icon: Megaphone, label: 'Publish announcement', perm: 'hr.broadcasts.publish' },
    { to: '/admin/users?new=1', icon: Users, label: 'Invite a user', perm: 'users.manage' },
    { to: '/admin/permissions', icon: ShieldCheck, label: 'Manage permissions', perm: 'permissions.manage' },
  ].filter((a) => can(a.perm));

  const departments = Object.entries(
    (staff.data?.employees ?? []).reduce<Record<string, number>>((acc, e) => {
      const d = e.department || 'Unassigned';
      acc[d] = (acc[d] ?? 0) + 1;
      return acc;
    }, {}),
  ).map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);

  const pipeline = (hr.data?.candidates_by_status ?? []).filter((s) => s.count > 0).map((s) => ({ label: s.status, value: s.count }));

  const activity = can('audit.view')
    ? (logs.data?.logs ?? []).map((l) => ({ id: l.id, title: `${titleCase(l.action)}${l.target ? ` · ${l.target}` : ''}`, meta: `${l.performed_by} · ${dateTime(l.timestamp)}` }))
    : (hr.data?.recent_activities ?? []).slice(0, 6).map((a) => ({ id: a.id, title: a.title, meta: a.description }));

  const hasMainColumn = can('hr.employees.view') || (can('hr.recruitment.view') && !!hr.data) || activity.length > 0;

  return (
    <>
      <div className="mb-6">
        <h1 className="text-xl font-semibold tracking-tight text-text">{greeting()}, {name}</h1>
        <p className="mt-1 text-sm text-text-muted">
          {new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })} · Here's what's happening today.
        </p>
      </div>

      {stats.length > 0 && <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">{stats}</div>}

      {!hasMainColumn ? (
        <div className="space-y-4">
          {actions.length > 0 && (
            <Card>
              <CardHeader title="Quick actions" />
              <div className="grid gap-2 p-3 sm:grid-cols-2 lg:grid-cols-3">{actions.map((a) => <QuickAction key={a.to} {...a} />)}</div>
            </Card>
          )}
          <Card>
            <CardHeader title="Your modules" description={`${sections.length} available to your role`} />
            <div className="grid gap-2 p-3 sm:grid-cols-2 lg:grid-cols-3">
              {sections.map((s) => <ModuleCard key={s.id} section={s} />)}
            </div>
            {sections.length === 0 && <p className="px-4 pb-6 text-sm text-text-muted">No modules have been assigned to your role yet. Contact a Super Admin for access.</p>}
          </Card>
        </div>
      ) : (
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {can('hr.employees.view') && (
            <Card>
              <CardHeader title="Employees by department" description="Current headcount" actions={<Link to="/hr/employees" className="text-xs font-medium text-primary hover:underline">View directory</Link>} />
              <div className="p-4">{staff.loading && !staff.data ? <Skeleton className="h-32" /> : <HBarChart data={departments} valueLabel="Employees" emptyText="No employees yet" />}</div>
            </Card>
          )}
          {can('hr.recruitment.view') && hr.data && (
            <Card>
              <CardHeader title="Recruitment pipeline" description="Candidates by stage" actions={<Link to="/hr/recruitment" className="text-xs font-medium text-primary hover:underline">Open pipeline</Link>} />
              <div className="p-4"><HBarChart data={pipeline} valueLabel="Candidates" slot={2} emptyText="No candidates in the pipeline yet" /></div>
            </Card>
          )}
          {activity.length > 0 && (
            <Card>
              <CardHeader title="Recent activity" actions={can('audit.view') ? <Link to="/admin/activity" className="text-xs font-medium text-primary hover:underline">Activity log</Link> : undefined} />
              <ul className="divide-y divide-border">
                {activity.map((a) => (
                  <li key={a.id} className="px-4 py-3">
                    <p className="truncate text-sm text-text">{a.title}</p>
                    <p className="truncate text-xs text-text-muted">{a.meta}</p>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>

        <div className="space-y-4">
          {actions.length > 0 && (
            <Card>
              <CardHeader title="Quick actions" />
              <div className="grid gap-2 p-3">{actions.map((a) => <QuickAction key={a.to} {...a} />)}</div>
            </Card>
          )}
          <Card>
            <CardHeader title="Your modules" description={`${sections.length} available to your role`} />
            <div className="grid gap-2 p-3">
              {sections.map((s) => <ModuleCard key={s.id} section={s} />)}
            </div>
          </Card>
        </div>
      </div>
      )}
    </>
  );
}
