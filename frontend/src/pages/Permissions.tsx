import { useMemo, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { api } from '../lib/api';
import { useApi } from '../lib/useApi';
import { useAuth } from '../auth/AuthContext';
import { Card, CardHeader } from '../components/common/Card';
import { ErrorState } from '../components/common/ErrorState';
import { PageSkeleton } from '../components/common/Skeleton';
import { Tabs } from '../components/common/Tabs';
import { useToast } from '../components/common/ToastContext';
import { PageHeader } from '../components/layout/PageHeader';
import { PermissionMatrix, type CatalogGroup, type RoleDef } from '../components/permissions/PermissionMatrix';

interface Catalog { roles: RoleDef[]; groups: CatalogGroup[] }

export function Permissions() {
  const { refresh } = useAuth();
  const { showToast } = useToast();
  const catalog = useApi(() => api.get<Catalog>('/api/rbac/catalog'));
  const matrix = useApi(() => api.get<Record<string, string[]>>('/api/rbac/roles'));
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [group, setGroup] = useState<string | null>(null);

  // Tabs per module area keep the matrix scannable; HR's four groups share one tab.
  const areas = useMemo(() => {
    const groups = catalog.data?.groups ?? [];
    const hr = groups.filter((g) => g.id.startsWith('hr_'));
    return [
      ...(hr.length ? [{ id: 'hr', label: 'HR', groups: hr }] : []),
      ...groups.filter((g) => !g.id.startsWith('hr_')).map((g) => ({ id: g.id, label: g.label, groups: [g] })),
    ];
  }, [catalog.data]);
  const active = areas.find((a) => a.id === group) ?? areas[0];

  const toggle = async (role: string, permission: string, granted: boolean) => {
    const key = `${role}:${permission}`;
    const previous = matrix.data;
    setPending((p) => new Set(p).add(key));
    matrix.setData((m) => m && { ...m, [role]: granted ? [...m[role], permission] : m[role].filter((x) => x !== permission) });
    try {
      const res = await api.patch<{ permissions: string[] }>(`/api/rbac/roles/${role}`, { permission, granted });
      matrix.setData((m) => m && { ...m, [role]: res.permissions });
      showToast('Permission updated', 'success');
      refresh();
    } catch (err) {
      matrix.setData(previous);
      showToast(err instanceof Error ? err.message : 'Could not update permission', 'error');
    } finally {
      setPending((p) => {
        const next = new Set(p);
        next.delete(key);
        return next;
      });
    }
  };

  if (catalog.status === 'error' || matrix.status === 'error') {
    return (
      <>
        <PageHeader title="Roles & permissions" />
        <Card><ErrorState onRetry={() => { catalog.reload(); matrix.reload(); }} message={catalog.error || matrix.error} /></Card>
      </>
    );
  }
  if (!catalog.data || !matrix.data || !active) return <PageSkeleton />;

  return (
    <>
      <PageHeader
        title="Roles & permissions"
        description="Choose what each role can see and do. Changes apply immediately and are enforced by the server."
        breadcrumbs={[{ label: 'Administration' }, { label: 'Roles & permissions' }]}
      />
      <Tabs tabs={areas.map((a) => ({ id: a.id, label: a.label }))} active={active.id} onChange={setGroup} className="mb-4" />
      <div className="space-y-4">
        {active.groups.map((g) => (
          <Card key={g.id}>
            <CardHeader title={g.label} description={`${g.permissions.length} permissions`} />
            <PermissionMatrix group={g} roles={catalog.data!.roles} matrix={matrix.data!} pending={pending} onToggle={toggle} />
          </Card>
        ))}
      </div>
      <p className="mt-4 flex items-start gap-2 text-xs text-text-muted">
        <ShieldCheck size={14} className="mt-px shrink-0" aria-hidden="true" />
        Users without a permission don't see that entity anywhere: navigation, dashboard, search and direct links all treat it as non-existent, and the API rejects the request.
      </p>
    </>
  );
}
