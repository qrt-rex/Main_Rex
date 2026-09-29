/**
 * Which dashboard a role lands on after the single common login.
 * Roles without a purpose-built dashboard get the permission-driven workspace,
 * so adding a role never leaves anyone without a home screen.
 */
const ROLE_HOME: Record<string, string> = {
  superadmin: '/dashboard/admin',
  admin: '/dashboard/admin',
  it: '/dashboard/it',
  sales: '/dashboard/sales',
  support: '/dashboard/support',
  employee: '/dashboard/employee',
  hr: '/dashboard/hr',
  legal: '/dashboard/legal',
};

export const DASHBOARD_SLUGS = ['admin', 'it', 'sales', 'support', 'employee', 'hr', 'legal', 'workspace'] as const;
export type DashboardSlug = (typeof DASHBOARD_SLUGS)[number];

export function dashboardPathFor(role?: string | null): string {
  return ROLE_HOME[(role ?? '').toLowerCase()] ?? '/dashboard/workspace';
}

/** Super Admins may open any role's dashboard; everyone else only their own. */
export function canViewDashboard(role: string | null | undefined, slug: string, extraRoles: string[] = []): boolean {
  if ((role ?? '').toLowerCase() === 'superadmin') return true;
  // A user given extra roles may open each of those roles' dashboards as well as their own.
  return [role, ...extraRoles].some((r) => dashboardPathFor(r) === `/dashboard/${slug}`);
}
