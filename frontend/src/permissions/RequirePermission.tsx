import type { ReactNode } from 'react';
import { useAuth } from '../auth/AuthContext';
import { NotFound } from '../pages/NotFound';

/**
 * Route guard. Unauthorized entities don't exist for the user, so a direct URL gets the
 * same 404 as a typo rather than an "access restricted" page. The backend independently
 * rejects the underlying API calls (rbac_service.ROUTE_RULES).
 */
export function RequirePermission({ permission, children }: { permission: string | string[]; children: ReactNode }) {
  const { can } = useAuth();
  const required = Array.isArray(permission) ? permission : [permission];
  return required.every(can) ? <>{children}</> : <NotFound />;
}
