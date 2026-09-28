import { useMemo, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { MoreHorizontal, Pencil, Power, UserPlus, Users as UsersIcon } from 'lucide-react';
import { api, ApiError } from '../lib/api';
import { useApi } from '../lib/useApi';
import { dateTime } from '../lib/format';
import { useAuth } from '../auth/AuthContext';
import { Avatar } from '../components/common/Avatar';
import { Badge } from '../components/common/Badge';
import { Button } from '../components/common/Button';
import { Card } from '../components/common/Card';
import { useConfirm } from '../components/common/ConfirmDialog';
import { Dropdown, DropdownItem, DropdownSeparator } from '../components/common/Dropdown';
import { EmptyState } from '../components/common/EmptyState';
import { ErrorState } from '../components/common/ErrorState';
import { Input, SearchInput, Select } from '../components/common/Input';
import { Modal } from '../components/common/Modal';
import { Table, type Column } from '../components/common/Table';
import { useToast } from '../components/common/ToastContext';
import { PageHeader } from '../components/layout/PageHeader';

interface Account { id: string; username: string; email: string; role: string; is_active: boolean; last_login: string | null; created_at: string | null }
interface Role { id: string; label: string }

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function UserForm({ open, onClose, roles, account, onSaved }: {
  open: boolean; onClose: () => void; roles: Role[]; account: Account | null; onSaved: () => void;
}) {
  const { showToast } = useToast();
  const editing = !!account;
  // Mounted fresh (keyed) each time it opens, so initial state comes straight from props.
  const [form, setForm] = useState({ username: account?.username ?? '', email: account?.email ?? '', role: account?.role ?? roles[0]?.id ?? '', password: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const next: Record<string, string> = {};
    if (form.username.trim().length < 2) next.username = 'Enter a name (at least 2 characters).';
    if (!editing && !EMAIL_RE.test(form.email)) next.email = 'Enter a valid email address.';
    if (!editing && form.password.length < 8) next.password = 'Use at least 8 characters.';
    setErrors(next);
    if (Object.keys(next).length) return;

    setSaving(true);
    try {
      if (editing) {
        await api.patch(`/api/users/${account!.id}`, { username: form.username.trim(), role: form.role !== account!.role ? form.role : undefined });
        showToast('User updated', 'success');
      } else {
        await api.post('/api/users', { username: form.username.trim(), email: form.email.trim(), role: form.role, password: form.password });
        showToast(`Account created for ${form.email.trim()}`, 'success');
      }
      onSaved();
      onClose();
    } catch (err) {
      setErrors({ form: err instanceof ApiError ? err.message : 'Could not save the user.' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? 'Edit user' : 'Add user'}
      description={editing ? account!.email : 'They sign in with this password and a code sent to their email.'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="user-form" loading={saving}>{editing ? 'Save changes' : 'Create user'}</Button>
        </>
      }
    >
      <form id="user-form" onSubmit={submit} noValidate className="space-y-4">
        <Input label="Full name" value={form.username} onChange={set('username')} error={errors.username} required autoFocus />
        {!editing && <Input label="Email" type="email" value={form.email} onChange={set('email')} error={errors.email} required />}
        <Select label="Role" value={form.role} onChange={set('role')} required hint="The role decides which modules they can see.">
          {roles.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
        </Select>
        {!editing && (
          <Input label="Temporary password" type="password" autoComplete="new-password" value={form.password} onChange={set('password')} error={errors.password} hint="At least 8 characters. Share it securely." required />
        )}
        {errors.form && <p role="alert" className="text-sm text-danger">{errors.form}</p>}
      </form>
    </Modal>
  );
}

export function Users() {
  const { user } = useAuth();
  const { showToast } = useToast();
  const confirm = useConfirm();
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState(params.get('q') ?? '');
  const [roleFilter, setRoleFilter] = useState('');
  const [editing, setEditing] = useState<Account | null>(null);
  const [formOpen, setFormOpen] = useState(params.get('new') === '1');

  const accounts = useApi(() => api.get<Account[]>('/api/users'));
  const catalog = useApi(() => api.get<{ roles: Role[] }>('/api/rbac/catalog'));
  const isSuper = user?.role === 'superadmin';
  const allRoles = catalog.data?.roles ?? [];
  const assignable = allRoles.filter((r) => isSuper || r.id !== 'superadmin');
  const roleLabel = (id: string) => allRoles.find((r) => r.id === id)?.label ?? id;

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (accounts.data ?? []).filter((a) => (!roleFilter || a.role === roleFilter) && (!q || `${a.username} ${a.email}`.toLowerCase().includes(q)));
  }, [accounts.data, search, roleFilter]);

  const closeForm = () => {
    setFormOpen(false);
    setEditing(null);
    if (params.has('new')) setParams({}, { replace: true });
  };

  const toggleActive = async (a: Account) => {
    const deactivate = a.is_active;
    const ok = await confirm({
      title: deactivate ? `Deactivate ${a.username}?` : `Reactivate ${a.username}?`,
      message: deactivate ? 'They will be signed out immediately and won\'t be able to sign in until reactivated.' : 'They will be able to sign in again with their existing password.',
      confirmText: deactivate ? 'Deactivate' : 'Reactivate',
      tone: deactivate ? 'danger' : 'primary',
    });
    if (!ok) return;
    try {
      await api.patch(`/api/users/${a.id}`, { is_active: !a.is_active });
      showToast(deactivate ? 'User deactivated' : 'User reactivated', 'success');
      accounts.reload();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not update the user', 'error');
    }
  };

  const columns: Column<Account>[] = [
    {
      key: 'name', header: 'User', sortValue: (a) => a.username.toLowerCase(),
      render: (a) => (
        <span className="flex min-w-0 items-center gap-3">
          <Avatar name={a.username || a.email} size={30} />
          <span className="min-w-0">
            <span className="block truncate font-medium text-text">{a.username}{a.id === user?.id && <span className="ml-1.5 text-xs font-normal text-text-muted">(you)</span>}</span>
            <span className="block truncate text-xs text-text-muted">{a.email}</span>
          </span>
        </span>
      ),
    },
    { key: 'role', header: 'Role', sortValue: (a) => roleLabel(a.role), render: (a) => <Badge tone={a.role === 'superadmin' ? 'primary' : 'neutral'}>{roleLabel(a.role)}</Badge> },
    { key: 'status', header: 'Status', sortValue: (a) => (a.is_active ? 0 : 1), render: (a) => <Badge tone={a.is_active ? 'success' : 'neutral'} dot>{a.is_active ? 'Active' : 'Inactive'}</Badge> },
    { key: 'last', header: 'Last sign-in', sortValue: (a) => a.last_login ?? '', render: (a) => <span className="text-text-muted">{a.last_login ? dateTime(a.last_login) : 'Never'}</span> },
    {
      key: 'actions', header: <span className="sr-only">Actions</span>, align: 'right',
      render: (a) => {
        const self = a.id === user?.id;
        const protectedAcct = a.role === 'superadmin' && !isSuper;
        if (protectedAcct) return null;
        return (
          <Dropdown label={`Actions for ${a.username}`} width="w-48" triggerClassName="h-8 w-8 justify-center text-text-muted hover:bg-neutral-bg hover:text-text" trigger={<MoreHorizontal size={16} />}>
            <DropdownItem icon={<Pencil size={15} />} onClick={() => { setEditing(a); setFormOpen(true); }}>Edit name & role</DropdownItem>
            {!self && (
              <>
                <DropdownSeparator />
                <DropdownItem icon={<Power size={15} />} tone={a.is_active ? 'danger' : 'default'} onClick={() => toggleActive(a)}>
                  {a.is_active ? 'Deactivate' : 'Reactivate'}
                </DropdownItem>
              </>
            )}
          </Dropdown>
        );
      },
    },
  ];

  return (
    <>
      <PageHeader
        title="Users"
        description="Everyone who can sign in to the CRM, and the role that decides what they see."
        breadcrumbs={[{ label: 'Administration' }, { label: 'Users' }]}
        actions={<Button onClick={() => { setEditing(null); setFormOpen(true); }} disabled={!catalog.data}><UserPlus size={15} /> Add user</Button>}
      />
      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
          <SearchInput value={search} onChange={setSearch} placeholder="Search by name or email" label="Search users" />
          <Select aria-label="Filter by role" value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)} selectClassName="w-44">
            <option value="">All roles</option>
            {allRoles.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
          </Select>
          <span className="ml-auto text-xs text-text-muted">{rows.length} of {accounts.data?.length ?? 0}</span>
        </div>
        {accounts.status === 'error' ? (
          <ErrorState onRetry={accounts.reload} message={accounts.error} />
        ) : (
          <Table
            caption="Users"
            columns={columns}
            rows={rows}
            rowKey={(a) => a.id}
            loading={accounts.loading && !accounts.data}
            empty={<EmptyState compact icon={UsersIcon} title="No users match" description="Try a different search or role filter." />}
          />
        )}
      </Card>
      {catalog.data && formOpen && (
        <UserForm key={editing?.id ?? 'new'} open onClose={closeForm} roles={editing?.id === user?.id ? allRoles.filter((r) => r.id === editing?.role) : assignable} account={editing} onSaved={accounts.reload} />
      )}
    </>
  );
}
