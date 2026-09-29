import type { ComponentType } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { useApi } from '../lib/useApi';
import { Card } from '../components/common/Card';
import { ErrorState } from '../components/common/ErrorState';
import { PageSkeleton } from '../components/common/Skeleton';
import { Dashboard } from '../pages/Dashboard';
import { DashboardIntro } from './DashboardShell';
import { AdminDashboard } from './AdminDashboard';
import { ItDashboard } from './ItDashboard';
import { SalesDashboard } from './SalesDashboard';
import { SupportDashboard } from './SupportDashboard';
import { EmployeeDashboard } from './EmployeeDashboard';
import { LegalDashboard } from './LegalDashboard';
import { AssignedClientsCard } from './LegalClients';
import { canViewDashboard, dashboardPathFor } from './roles';
import { workspaceSummary, type WorkspaceSummary } from './api';

const DASHBOARDS: Record<string, ComponentType<{ summary: WorkspaceSummary }>> = {
  admin: AdminDashboard,
  it: ItDashboard,
  sales: SalesDashboard,
  support: SupportDashboard,
  employee: EmployeeDashboard,
};

/** One request feeds the whole dashboard; the role decides how it is laid out. */
function Body({ slug }: { slug: string }) {
  if (slug === 'legal') {
    return <LegalDashboard />;
  }
  const { data, status, error, reload } = useApi(workspaceSummary);
  const View = DASHBOARDS[slug];

  // Roles without a purpose-built layout (HR, Legal) get the permission-driven workspace.
  if (!View) return <Dashboard />;

  if (status === 'error') {
    return (
      <>
        <DashboardIntro subtitle="Your dashboard could not be loaded." />
        <Card><ErrorState onRetry={reload} message={error} /></Card>
      </>
    );
  }
  if (!data) return <PageSkeleton />;
  return <View summary={data} />;
}

/**
 * `/dashboard/:slug`. A user who asks for someone else's dashboard is sent to their own
 * (Super Admins may open any of them); the backend enforces the same permissions on the data.
 */
export function RoleDashboard() {
  const { slug = '' } = useParams();
  const { user } = useAuth();

  if (!canViewDashboard(user?.role, slug, user?.extra_roles)) return <Navigate to={dashboardPathFor(user?.role)} replace />;
  return (
    <>
      <Body slug={slug} />
      {slug !== 'legal' && <AssignedClientsCard />}
    </>
  );
}

/** `/dashboard` — send everyone to the dashboard their role owns. */
export function DashboardHome() {
  const { user } = useAuth();
  return <Navigate to={dashboardPathFor(user?.role)} replace />;
}
