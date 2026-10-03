import {
  CalendarCheck, ClipboardList, FileSpreadsheet, FileText, Megaphone, Radio, Scale, UserPlus, UserRoundPlus,
} from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { BigButtons, ModuleEntities, SectionTitle, TaskPanel, type BigButtonItem } from './components';
import { DashboardIntro } from './DashboardShell';
import { ClientWorkWidget } from '../clientwork/ClientWorkWidget';
import type { WorkspaceSummary } from './api';

/** Admin home: big buttons for everyday jobs, what is waiting for an OK, and company news. No charts or counters. */
export function AdminDashboard({ summary }: { summary: WorkspaceSummary }) {
  const { can } = useAuth();
  const { recruitment, approvals = [], updates } = summary;

  const priority = [
    ...approvals,
    ...(recruitment && recruitment.pending_onboarding > 0
      ? [{
          id: 'onboarding',
          title: 'New joiners have not finished onboarding',
          description: 'Joining links sent but not completed',
          link: '/hr/recruitment',
          status: 'PENDING',
        }]
      : []),
  ];

  const buttons: BigButtonItem[] = [
    { label: 'IVR', icon: Radio, href: '/ivr', tone: 'warning' as const },
    ...(can('clientwork.view') ? [{ label: 'Client work', icon: ClipboardList, to: '/client-work' }] : []),
    ...(can('legal.view') ? [{ label: 'Legal', icon: Scale, to: '/legal', tone: 'info' as const }] : []),
    ...(can('billing.create') ? [{ label: 'New invoice', icon: FileSpreadsheet, to: '/billing/create', tone: 'success' as const }] : []),
    ...(can('billing.view') ? [{ label: 'Invoices', icon: FileText, to: '/billing/invoices', tone: 'success' as const }] : []),
    ...(can('hr.leave.view') ? [{ label: 'Leave requests', icon: CalendarCheck, to: '/hr/leave', tone: 'warning' as const }] : []),
    ...(can('hr.employees.create') ? [{ label: 'Add employee', icon: UserPlus, to: '/hr/employees/new' }] : []),
    ...(can('users.manage') ? [{ label: 'Add member', icon: UserRoundPlus, to: '/admin/users?new=1' }] : []),
  ];

  return (
    <>
      <DashboardIntro subtitle="Pick what you want to do." />

      <BigButtons items={buttons} />

      {can('clientwork.view') && (
        <div className="mt-8">
          <ClientWorkWidget />
        </div>
      )}

      <div className="mt-8 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <TaskPanel
          title="Waiting for your OK"
          items={priority}
          emptyTitle="Nothing is waiting"
          emptyDescription="Requests that need your approval show up here."
          emptyIcon={CalendarCheck}
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

      <SectionTitle>Everything else</SectionTitle>
      <ModuleEntities grouped />
    </>
  );
}
