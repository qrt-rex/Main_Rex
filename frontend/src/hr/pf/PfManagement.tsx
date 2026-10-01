import { lazy, Suspense } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { Tabs } from '../../components/common/Tabs';
import { PageSkeleton } from '../../components/common/Skeleton';
import { PageHeader } from '../../components/layout/PageHeader';

const PfDashboardTab = lazy(() => import('./PfDashboardTab').then((m) => ({ default: m.PfDashboardTab })));
const PfConfigTab = lazy(() => import('./PfConfigTab').then((m) => ({ default: m.PfConfigTab })));
const PfEmployeesTab = lazy(() => import('./PfEmployeesTab').then((m) => ({ default: m.PfEmployeesTab })));
const PfPayrollTab = lazy(() => import('./PfPayrollTab').then((m) => ({ default: m.PfPayrollTab })));
const PfReportsTab = lazy(() => import('./PfReportsTab').then((m) => ({ default: m.PfReportsTab })));
const PfAuditTab = lazy(() => import('./PfAuditTab').then((m) => ({ default: m.PfAuditTab })));

/** HR → PF management: dashboard, configuration, employee PF, PF payroll, reports and audit, one tab each. */
export function PfManagement() {
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const tabs = [
    { id: 'dashboard', label: 'PF dashboard' },
    { id: 'config', label: 'PF configuration' },
    { id: 'employees', label: 'Employee PF details' },
    { id: 'payroll', label: 'PF payroll' },
    ...(can('hr.pf.reports') ? [{ id: 'reports', label: 'PF reports' }] : []),
    ...(can('hr.pf.audit') ? [{ id: 'audit', label: 'PF audit log' }] : []),
  ];
  const active = tabs.some((t) => t.id === params.get('tab')) ? params.get('tab')! : 'dashboard';
  const go = (tab: string) => setParams((p) => { const n = new URLSearchParams(p); n.set('tab', tab); return n; }, { replace: true });

  return (
    <>
      <PageHeader
        title="PF management"
        description="Provident fund (EPF / EPS): effective-dated rules, each employee's PF details, and the PF payroll calculates."
        breadcrumbs={[{ label: 'HR' }, { label: 'PF management' }]}
      />
      <Tabs tabs={tabs} active={active} onChange={go} className="mb-4" />
      <Suspense fallback={<PageSkeleton />}>
        {active === 'dashboard' && <PfDashboardTab />}
        {active === 'config' && <PfConfigTab />}
        {active === 'employees' && <PfEmployeesTab />}
        {active === 'payroll' && <PfPayrollTab />}
        {active === 'reports' && <PfReportsTab />}
        {active === 'audit' && <PfAuditTab />}
      </Suspense>
    </>
  );
}
