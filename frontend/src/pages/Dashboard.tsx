import { Banknote, CalendarCheck, Megaphone, ShieldCheck, UserPlus, Users } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { visibleSections } from '../modules/registry';
import { Card } from '../components/common/Card';
import { EmptyState } from '../components/common/EmptyState';
import { DashboardIntro } from '../dashboards/DashboardShell';
import { BigButtons, ModuleEntities, SectionTitle, type BigButtonItem } from '../dashboards/components';

/** Home for roles without a purpose-built dashboard (HR and others): big buttons, no counters or charts. */
export function Dashboard() {
  const { can } = useAuth();
  const hasModules = visibleSections(can).length > 0;

  const actions: (BigButtonItem & { perm: string })[] = [
    { to: '/hr/employees/new', icon: UserPlus, label: 'Add employee', perm: 'hr.employees.create' },
    { to: '/hr/leave', icon: CalendarCheck, label: 'Leave requests', perm: 'hr.leave.approve', tone: 'warning' },
    { to: '/hr/payroll', icon: Banknote, label: 'Run payroll', perm: 'hr.payroll.process', tone: 'success' },
    { to: '/hr/broadcasts', icon: Megaphone, label: 'Send news', perm: 'hr.broadcasts.publish', tone: 'info' },
    { to: '/admin/users?new=1', icon: Users, label: 'Add member', perm: 'users.manage' },
    { to: '/admin/permissions', icon: ShieldCheck, label: 'Permissions', perm: 'permissions.manage' },
  ];
  const buttons = actions.filter((a) => can(a.perm));

  return (
    <>
      <DashboardIntro subtitle="Pick what you want to do." />

      <BigButtons items={buttons} />

      <SectionTitle>Everything else</SectionTitle>
      {hasModules ? (
        <ModuleEntities grouped />
      ) : (
        <Card><EmptyState title="Nothing here yet" description="Ask a Super Admin to give your role access." /></Card>
      )}
    </>
  );
}
