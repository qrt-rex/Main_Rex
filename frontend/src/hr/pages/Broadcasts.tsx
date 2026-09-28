import { useState, type FormEvent } from 'react';
import { Megaphone, Send } from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';
import { useApi } from '../../lib/useApi';
import { date } from '../../lib/format';
import { BRANCHES, DEPARTMENTS, listBroadcasts, publishBroadcast, type Broadcast, type Employee } from '../api';
import { useEmployeeOptions } from '../HrSection';
import { StatusBadge } from '../../components/common/Badge';
import { Button } from '../../components/common/Button';
import { Card } from '../../components/common/Card';
import { EmptyState } from '../../components/common/EmptyState';
import { ErrorState } from '../../components/common/ErrorState';
import { Checkbox, Input, SearchInput, Select, Textarea } from '../../components/common/Input';
import { Modal } from '../../components/common/Modal';
import { Table, type Column } from '../../components/common/Table';
import { useToast } from '../../components/common/ToastContext';
import { PageHeader } from '../../components/layout/PageHeader';

const PRIORITIES = [['INFO', 'Standard information'], ['IMPORTANT', 'Important notice'], ['POLICY_UPDATE', 'Policy update'], ['CRITICAL_EMERGENCY', 'Critical / emergency']] as const;
const AUDIENCE: Record<string, string> = { ALL_EMPLOYEES: 'All employees', DEPARTMENT: 'Department', BRANCH: 'Branch', CUSTOM_LIST: 'Selected employees' };
/** Who receives company notices; the server applies the same rule. */
const RECEIVES_NOTICES = ['Active', 'Probation'];

/** The configured branches plus any other branch an employee record uses. */
const branchesOf = (employees: Employee[]) => [
  ...BRANCHES,
  ...[...new Set(employees.map((e) => e.branch?.trim()))].filter((b): b is string => !!b && !BRANCHES.includes(b)).sort(),
];

function audienceLabel(b: Broadcast) {
  if (b.audience_type === 'DEPARTMENT' && b.target_departments?.length) return `Department · ${b.target_departments.join(', ')}`;
  if (b.audience_type === 'BRANCH' && b.target_branches?.length) return `Branch · ${b.target_branches.join(', ')}`;
  if (b.audience_type === 'CUSTOM_LIST') return b.total_recipients === 1 ? 'Personal (1 employee)' : `${b.total_recipients} selected employees`;
  return AUDIENCE[b.audience_type] ?? 'All employees';
}

/** Pick individual recipients, narrowed by search and branch. */
function EmployeePicker({ selected, onChange, error }: { selected: string[]; onChange: (ids: string[]) => void; error?: string }) {
  const { employees, loading, available } = useEmployeeOptions();
  const [search, setSearch] = useState('');
  const [branch, setBranch] = useState('');
  const pool = employees.filter((e) => RECEIVES_NOTICES.includes(e.employee_status));
  const q = search.trim().toLowerCase();
  const shown = pool.filter((e) => (!branch || e.branch === branch)
    && (!q || `${e.full_name} ${e.employee_code} ${e.email} ${e.department}`.toLowerCase().includes(q)));
  const chosen = new Set(selected);
  const allShown = shown.length > 0 && shown.every((e) => chosen.has(e.id));

  const toggle = (id: string) => onChange(chosen.has(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  const toggleShown = () => onChange(allShown
    ? selected.filter((id) => !shown.some((e) => e.id === id))
    : [...new Set([...selected, ...shown.map((e) => e.id)])]);

  if (!available) {
    return <p className="text-sm text-text-muted sm:col-span-2">Your role can't view the employee directory, so recipients can't be picked here.</p>;
  }
  return (
    <div className="space-y-2 sm:col-span-2">
      <p className="text-sm font-medium text-text">Recipients <span className="text-danger">*</span></p>
      <div className="flex flex-col gap-2 sm:flex-row">
        <SearchInput value={search} onChange={setSearch} placeholder="Search name, code, email…" label="Search employees" />
        <Select aria-label="Filter by branch" value={branch} onChange={(e) => setBranch(e.target.value)} selectClassName="w-40">
          <option value="">All branches</option>
          {branchesOf(pool).map((b) => <option key={b}>{b}</option>)}
        </Select>
      </div>
      <div className="flex items-center justify-between text-xs">
        <span className="text-text-muted">{selected.length} selected</span>
        <span className="flex gap-3">
          <button type="button" onClick={toggleShown} disabled={!shown.length} className="text-primary hover:underline disabled:opacity-50">
            {allShown ? 'Unselect shown' : `Select all shown (${shown.length})`}
          </button>
          {selected.length > 0 && <button type="button" onClick={() => onChange([])} className="text-primary hover:underline">Clear</button>}
        </span>
      </div>
      <div role="group" aria-label="Recipients" className={`max-h-56 divide-y divide-border overflow-y-auto rounded-md border ${error ? 'border-danger' : 'border-border'}`}>
        {loading ? <p className="p-3 text-sm text-text-muted">Loading employees…</p>
          : shown.length === 0 ? <p className="p-3 text-sm text-text-muted">No employees match.</p>
          : shown.map((e) => (
            <Checkbox key={e.id} checked={chosen.has(e.id)} onChange={() => toggle(e.id)} className="px-3 py-2 hover:bg-neutral-bg"
              label={`${e.full_name} · ${e.employee_code}`} description={[e.department, e.branch].filter(Boolean).join(' · ')} />
          ))}
      </div>
      {error && <p role="alert" className="text-xs text-danger">{error}</p>}
    </div>
  );
}

function Progress({ value, total, pct }: { value: number; total: number; pct: number }) {
  return (
    <span className="block min-w-32">
      <span className="flex justify-between text-xs"><span className="tabular-nums text-text">{value}/{total}</span><span className="tabular-nums text-text-muted">{pct}%</span></span>
      <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-neutral-bg"><span className="block h-full rounded-full bg-primary" style={{ width: `${pct}%` }} /></span>
    </span>
  );
}

function PublishModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { showToast } = useToast();
  const { employees } = useEmployeeOptions();
  const [v, setV] = useState({ title: '', priority: 'INFO', audience_type: 'ALL_EMPLOYEES', department: DEPARTMENTS[0], branch: BRANCHES[0], content: '', requires_acknowledgment: false, send_email: true });
  const [recipients, setRecipients] = useState<string[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const eligible = employees.filter((e) => RECEIVES_NOTICES.includes(e.employee_status));
  const inBranch = eligible.filter((e) => e.branch === v.branch).length;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const er: Record<string, string> = {};
    if (v.title.trim().length < 3) er.title = 'Give the announcement a headline.';
    if (!v.content.trim()) er.content = 'Write the announcement.';
    if (v.audience_type === 'CUSTOM_LIST' && !recipients.length) er.recipients = 'Select at least one employee.';
    setErrors(er);
    if (Object.keys(er).length) return;
    setSaving(true);
    try {
      const res = await publishBroadcast({
        title: v.title.trim(), priority: v.priority, audience_type: v.audience_type,
        target_departments: v.audience_type === 'DEPARTMENT' ? [v.department] : [],
        target_branches: v.audience_type === 'BRANCH' ? [v.branch] : [],
        target_employee_ids: v.audience_type === 'CUSTOM_LIST' ? recipients : [],
        rich_html_content: v.content.trim(), requires_acknowledgment: v.requires_acknowledgment, send_email: v.send_email,
      });
      showToast(res.message || 'Announcement published', 'success');
      onDone();
      onClose();
    } catch (err) {
      setErrors({ form: err instanceof Error ? err.message : 'Could not publish' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open onClose={onClose} size="lg" closeOnOverlay={false} title="Publish announcement" description="Delivered in-app to every targeted employee, and optionally by email."
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" form="bcast-form" loading={saving}><Send size={15} /> Publish</Button></>}>
      <form id="bcast-form" onSubmit={submit} noValidate className="grid gap-4 sm:grid-cols-2">
        <Input label="Headline" required value={v.title} onChange={(e) => setV((s) => ({ ...s, title: e.target.value }))} error={errors.title} placeholder="e.g. Office closed for Diwali" className="sm:col-span-2" />
        <Select label="Priority" value={v.priority} onChange={(e) => setV((s) => ({ ...s, priority: e.target.value }))}>
          {PRIORITIES.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
        </Select>
        <Select label="Audience" value={v.audience_type} onChange={(e) => setV((s) => ({ ...s, audience_type: e.target.value }))}>
          <option value="ALL_EMPLOYEES">All employees</option>
          <option value="DEPARTMENT">A department</option>
          <option value="BRANCH">A branch</option>
          <option value="CUSTOM_LIST">Specific employees (personal message)</option>
        </Select>
        {v.audience_type === 'DEPARTMENT' && (
          <Select label="Department" value={v.department} onChange={(e) => setV((s) => ({ ...s, department: e.target.value }))} className="sm:col-span-2">
            {DEPARTMENTS.map((d) => <option key={d}>{d}</option>)}
          </Select>
        )}
        {v.audience_type === 'BRANCH' && (
          <Select label="Branch" value={v.branch} onChange={(e) => setV((s) => ({ ...s, branch: e.target.value }))} className="sm:col-span-2"
            hint={`${inBranch} active employee${inBranch === 1 ? '' : 's'} in this branch`}>
            {branchesOf(eligible).map((b) => <option key={b}>{b}</option>)}
          </Select>
        )}
        {v.audience_type === 'CUSTOM_LIST' && <EmployeePicker selected={recipients} onChange={setRecipients} error={errors.recipients} />}
        <Textarea label="Message" required rows={6} value={v.content} onChange={(e) => setV((s) => ({ ...s, content: e.target.value }))} error={errors.content} hint="Basic HTML formatting is supported in emails." className="sm:col-span-2" />
        <Checkbox label="Require acknowledgment" description="Employees must confirm they've read it" checked={v.requires_acknowledgment} onChange={(e) => setV((s) => ({ ...s, requires_acknowledgment: e.target.checked }))} />
        <Checkbox label="Also send by email" description="Sent in throttled batches" checked={v.send_email} onChange={(e) => setV((s) => ({ ...s, send_email: e.target.checked }))} />
        {errors.form && <p role="alert" className="text-sm text-danger sm:col-span-2">{errors.form}</p>}
      </form>
    </Modal>
  );
}

export function Broadcasts() {
  const { can } = useAuth();
  const [publishing, setPublishing] = useState(false);
  const list = useApi(listBroadcasts);

  const columns: Column<Broadcast>[] = [
    { key: 'title', header: 'Announcement', sortValue: (b) => b.title, render: (b) => <span className="font-medium text-text">{b.title}</span> },
    { key: 'priority', header: 'Priority', sortValue: (b) => b.priority, render: (b) => <StatusBadge status={b.priority} /> },
    { key: 'audience', header: 'Audience', render: (b) => audienceLabel(b) },
    { key: 'recipients', header: 'Recipients', align: 'right', sortValue: (b) => b.total_recipients, render: (b) => <span className="tabular-nums">{b.total_recipients}</span> },
    { key: 'read', header: 'Read', sortValue: (b) => b.read_percentage, render: (b) => <Progress value={b.read_count} total={b.total_recipients} pct={b.read_percentage || 0} /> },
    { key: 'ack', header: 'Acknowledged', sortValue: (b) => b.acknowledged_percentage, render: (b) => <Progress value={b.acknowledged_count} total={b.total_recipients} pct={b.acknowledged_percentage || 0} /> },
    { key: 'date', header: 'Published', sortValue: (b) => b.created_at ?? '', render: (b) => <span className="whitespace-nowrap text-text-muted">{date(String(b.created_at ?? '').slice(0, 10))}</span> },
  ];

  return (
    <>
      <PageHeader
        title="Broadcasts"
        description="Company announcements and their read receipts."
        breadcrumbs={[{ label: 'HR' }, { label: 'Broadcasts' }]}
        actions={can('hr.broadcasts.publish') && <Button onClick={() => setPublishing(true)}><Megaphone size={15} /> New announcement</Button>}
      />
      <Card>
        {list.status === 'error' ? <ErrorState onRetry={list.reload} message={list.error} /> : (
          <Table caption="Announcements" columns={columns} rows={list.data?.data ?? []} rowKey={(b) => b.broadcast_id ?? `${b.title}-${b.created_at}`} loading={list.loading}
            empty={<EmptyState icon={Megaphone} title="No announcements yet" description="Announcements you publish will appear here with their read receipts." action={can('hr.broadcasts.publish') ? <Button onClick={() => setPublishing(true)}><Megaphone size={15} /> New announcement</Button> : undefined} />} />
        )}
      </Card>
      {publishing && <PublishModal onClose={() => setPublishing(false)} onDone={list.reload} />}
    </>
  );
}
