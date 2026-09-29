import { useMemo, useState } from 'react';
import { api, ApiError } from '../../lib/api';
import { useApi } from '../../lib/useApi';
import { Badge } from '../common/Badge';
import { Button } from '../common/Button';
import { Checkbox, SearchInput } from '../common/Input';
import { Modal } from '../common/Modal';
import { Skeleton } from '../common/Skeleton';
import { useToast } from '../common/ToastContext';
import type { CatalogGroup, RoleDef } from './PermissionMatrix';

interface Catalog { roles: RoleDef[]; groups: CatalogGroup[] }
interface Access { user: { id: string; username: string; email: string; role: string }; extra_roles: string[]; grants: string[]; denies: string[] }
type Choice = 'inherit' | 'allow' | 'deny';

/**
 * One person's access: their own role, any extra roles, and a per-feature Inherit / Allow / Deny.
 * Effective access = every role's permissions, plus Allow, minus Deny (Deny always wins).
 */
export function UserAccessModal({ userId, onClose, onSaved }: { userId: string; onClose: () => void; onSaved: () => void }) {
  const { showToast } = useToast();
  const catalog = useApi(() => api.get<Catalog>('/api/rbac/catalog'));
  const matrix = useApi(() => api.get<Record<string, string[]>>('/api/rbac/roles'));
  const access = useApi(() => api.get<Access>(`/api/rbac/users/${userId}/access`), [userId]);
  const [extra, setExtra] = useState<string[] | null>(null);
  const [choices, setChoices] = useState<Record<string, Choice> | null>(null);
  const [q, setQ] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const ready = catalog.data && matrix.data && access.data;
  // Seed the editable state once the saved access has loaded.
  const extraRoles = extra ?? access.data?.extra_roles ?? [];
  const current: Record<string, Choice> = choices ?? Object.fromEntries([
    ...(access.data?.grants ?? []).map((p) => [p, 'allow'] as const),
    ...(access.data?.denies ?? []).map((p) => [p, 'deny'] as const),
  ]);

  const primary = access.data?.user.role ?? '';
  const roleLabel = (id: string) => catalog.data?.roles.find((r) => r.id === id)?.label ?? id;
  const heldRoles = useMemo(() => [primary, ...extraRoles].filter(Boolean), [primary, extraRoles]);
  const fromRoles = (perm: string) => heldRoles.filter((r) => (matrix.data?.[r] ?? []).includes(perm));
  const effective = (perm: string) => {
    const c = current[perm] ?? 'inherit';
    return c === 'deny' ? false : c === 'allow' || fromRoles(perm).length > 0;
  };

  const toggleRole = (id: string) => setExtra(extraRoles.includes(id) ? extraRoles.filter((r) => r !== id) : [...extraRoles, id]);
  const setChoice = (perm: string, c: Choice) => setChoices({ ...current, [perm]: c });

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      await api.put(`/api/rbac/users/${userId}/access`, {
        extra_roles: extraRoles,
        grants: Object.keys(current).filter((p) => current[p] === 'allow'),
        denies: Object.keys(current).filter((p) => current[p] === 'deny'),
      });
      showToast('Access updated', 'success');
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save access.');
    } finally {
      setSaving(false);
    }
  };

  const needle = q.trim().toLowerCase();
  const groups = (catalog.data?.groups ?? [])
    .map((g) => ({ ...g, permissions: g.permissions.filter((p) => !needle || `${p.label} ${p.key} ${g.label}`.toLowerCase().includes(needle)) }))
    .filter((g) => g.permissions.length);
  const overrides = Object.values(current).filter((c) => c !== 'inherit').length;

  return (
    <Modal open onClose={onClose} size="xl" closeOnOverlay={false}
      title={access.data ? `Access for ${access.data.user.username}` : 'Access'}
      description={access.data ? `${access.data.user.email} · own role: ${roleLabel(primary)}` : undefined}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} loading={saving} disabled={!ready}>Save access</Button></>}>
      {!ready ? <Skeleton className="h-64" /> : (
        <div className="space-y-5">
          <section>
            <h3 className="text-sm font-medium text-text">Additional roles</h3>
            <p className="mb-2 text-xs text-text-muted">They keep their own role and also get everything each ticked role can do.</p>
            <div className="grid gap-2 sm:grid-cols-3">
              {catalog.data!.roles.filter((r) => r.id !== 'superadmin' && r.id !== primary).map((r) => (
                <Checkbox key={r.id} label={r.label} checked={extraRoles.includes(r.id)} onChange={() => toggleRole(r.id)} />
              ))}
            </div>
          </section>

          <section>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-medium text-text">Feature access</h3>
                <p className="text-xs text-text-muted">Inherit follows their roles. Allow adds a feature; Deny removes it even if a role has it. {overrides} override{overrides === 1 ? '' : 's'} set.</p>
              </div>
              <SearchInput value={q} onChange={setQ} placeholder="Find a feature" label="Find a feature" />
            </div>
            <div className="max-h-[42vh] space-y-4 overflow-y-auto rounded-md border border-border p-3">
              {groups.map((g) => (
                <div key={g.id}>
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-text-muted">{g.label}</p>
                  <ul className="divide-y divide-border">
                    {g.permissions.map((p) => {
                      const via = fromRoles(p.key);
                      const on = effective(p.key);
                      return (
                        <li key={p.key} className="flex flex-wrap items-center gap-3 py-2">
                          <span className="min-w-0 flex-1">
                            <span className="block text-sm text-text">{p.label}</span>
                            <span className="block text-[11px] text-text-muted"><code>{p.key}</code>{via.length ? ` · via ${via.map(roleLabel).join(', ')}` : ' · not in their roles'}</span>
                          </span>
                          <Badge tone={on ? 'success' : 'neutral'}>{on ? 'Has access' : 'No access'}</Badge>
                          <select aria-label={`${p.label}: inherit, allow or deny`} value={current[p.key] ?? 'inherit'} onChange={(e) => setChoice(p.key, e.target.value as Choice)}
                            className="rounded-md border border-border bg-surface px-2 py-1 text-sm text-text focus:border-primary focus:outline-none">
                            <option value="inherit">Inherit</option>
                            <option value="allow">Allow</option>
                            <option value="deny">Deny</option>
                          </select>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
              {!groups.length && <p className="py-6 text-center text-sm text-text-muted">No feature matches.</p>}
            </div>
          </section>
          {error && <p role="alert" className="text-sm text-danger">{error}</p>}
        </div>
      )}
    </Modal>
  );
}
