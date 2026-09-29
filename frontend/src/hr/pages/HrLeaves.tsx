import { useEffect, useState, type FormEvent } from 'react';
import { AlertTriangle, CalendarDays, CalendarPlus, Check, X } from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';
import { useApi } from '../../lib/useApi';
import { date, todayISO } from '../../lib/format';
import { applyLeave, applyOwnLeave, decideLeave, leaveBalances, listLeaves, pendingLeaves, type LeaveRequest } from '../api';
import { EmployeeOptionList, useEmployeeOptions } from '../HrSection';
import { Badge, StatusBadge } from '../../components/common/Badge';
import { Button } from '../../components/common/Button';
import { Card, CardHeader } from '../../components/common/Card';
import { EmptyState } from '../../components/common/EmptyState';
import { ErrorState } from '../../components/common/ErrorState';
import { Input, Select, Textarea } from '../../components/common/Input';
import { Modal } from '../../components/common/Modal';
import { Skeleton } from '../../components/common/Skeleton';
import { Table, type Column } from '../../components/common/Table';
import { Tabs } from '../../components/common/Tabs';
import { useToast } from '../../components/common/ToastContext';
import { PageHeader } from '../../components/layout/PageHeader';

const LEAVE_TYPES = [['CL', 'Casual leave'], ['SL', 'Sick leave'], ['EL', 'Earned leave'], ['COMP_OFF', 'Compensatory off'], ['LOP', 'Loss of pay']] as const;
const idOf = (r: LeaveRequest) => r._id || r.id;
const daysBetween = (a: string, b: string) => (new Date(b).getTime() - new Date(a).getTime()) / 86_400_000 + 1;

function Balances() {
  const { employees, available } = useEmployeeOptions();
  const [emp, setEmp] = useState('');
  useEffect(() => {
    if (!emp && employees[0]) setEmp(employees[0].employee_code);
  }, [employees, emp]);
  // Without the employee directory (e.g. sales), or before an employee is picked, show your own balances.
  const ref = available && emp ? emp : 'me';
  const bal = useApi(() => leaveBalances(ref), [ref], !!ref);
  const b = bal.data?.balances;
  const tiles: [string, number | undefined, string][] = [
    ['Casual leave', b?.casual_leave.available, 'available'],
    ['Sick leave', b?.sick_leave.available, 'available'],
    ['Earned leave', b?.earned_leave.available, 'available'],
    ['Loss of pay', b?.loss_of_pay_days_ytd, 'days this year'],
  ];
  return (
    <Card className="mb-4">
      <CardHeader
        title="Leave balances"
        actions={available && (
          <Select aria-label="Employee" value={emp} onChange={(e) => setEmp(e.target.value)} selectClassName="w-60">
            <EmployeeOptionList valueKey="employee_code" />
          </Select>
        )}
      />
      {bal.status === 'error' ? <ErrorState compact onRetry={bal.reload} message={bal.error} /> : (
        <div className="grid grid-cols-2 gap-3 p-4 lg:grid-cols-4">
          {tiles.map(([label, value, hint]) => (
            <div key={label} className="rounded-md border border-border p-3">
              <p className="text-xs text-text-muted">{label}</p>
              {value === undefined ? <Skeleton className="mt-1.5 h-7 w-12" /> : <p className="mt-1 text-2xl font-semibold text-text">{value}</p>}
              <p className="text-xs text-text-muted">{hint}</p>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

const LEVEL_LABEL = { HR: 'HR', ADMIN: 'Admin', SUPERADMIN: 'Super Admin' } as const;

/** own: request your own leave (no employee picker); otherwise HR files it on behalf of an employee. */
function ApplyModal({ own, onClose, onDone }: { own?: boolean; onClose: () => void; onDone: () => void }) {
  const { showToast } = useToast();
  const { employees } = useEmployeeOptions();
  const [v, setV] = useState({ employee_id: employees[0]?.employee_code ?? '', leave_type: 'CL', duration_type: 'FULL_DAY', start_date: todayISO(), end_date: todayISO(), reason: '', medical_certificate_url: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setV((s) => ({ ...s, [k]: e.target.value }));
  const needsCertificate = v.leave_type === 'SL' && v.start_date && v.end_date && daysBetween(v.start_date, v.end_date) > 2;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const er: Record<string, string> = {};
    if (!own && !v.employee_id) er.employee_id = 'Choose an employee.';
    if (!v.start_date) er.start_date = 'Choose a start date.';
    if (!v.end_date || v.end_date < v.start_date) er.end_date = 'End date must be on or after the start date.';
    if (!v.reason.trim()) er.reason = 'State the reason for leave.';
    if (needsCertificate && !/^https?:\/\//.test(v.medical_certificate_url)) er.medical_certificate_url = 'Sick leave over 2 days needs a medical certificate link.';
    setErrors(er);
    if (Object.keys(er).length) return;
    setSaving(true);
    try {
      const body = { ...v, reason: v.reason.trim(), medical_certificate_url: v.medical_certificate_url || null };
      if (own) showToast((await applyOwnLeave(body)).message, 'success');
      else {
        await applyLeave(body);
        showToast('Leave application submitted', 'success');
      }
      onDone();
      onClose();
    } catch (err) {
      setErrors({ form: err instanceof Error ? err.message : 'Could not submit the application' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open onClose={onClose} size="lg" closeOnOverlay={false} title={own ? 'Request leave' : 'Apply for leave'} description={own ? 'HR approves staff and sales leave; HR leave goes to an Admin, Admin leave to the Super Admin.' : 'Submitted on behalf of an employee; it enters the approval queue.'}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" form="leave-form" loading={saving}>Submit application</Button></>}>
      <form id="leave-form" onSubmit={submit} noValidate className="grid gap-4 sm:grid-cols-2">
        {!own && (
          <Select label="Employee" required value={v.employee_id} onChange={set('employee_id')} error={errors.employee_id} className="sm:col-span-2">
            <EmployeeOptionList valueKey="employee_code" />
          </Select>
        )}
        <Select label="Leave type" required value={v.leave_type} onChange={set('leave_type')}>
          {LEAVE_TYPES.map(([id, label]) => <option key={id} value={id}>{label} ({id})</option>)}
        </Select>
        <Select label="Duration" value={v.duration_type} onChange={set('duration_type')}>
          <option value="FULL_DAY">Full day</option><option value="FIRST_HALF">First half (0.5 day)</option><option value="SECOND_HALF">Second half (0.5 day)</option>
        </Select>
        <Input label="Start date" type="date" required value={v.start_date} onChange={set('start_date')} error={errors.start_date} />
        <Input label="End date" type="date" required value={v.end_date} min={v.start_date} onChange={set('end_date')} error={errors.end_date} />
        {needsCertificate && (
          <Input label="Medical certificate link" type="url" required value={v.medical_certificate_url} onChange={set('medical_certificate_url')} error={errors.medical_certificate_url} placeholder="https://…" className="sm:col-span-2" hint="Required for sick leave longer than 2 days." />
        )}
        <Textarea label="Reason" required value={v.reason} onChange={set('reason')} error={errors.reason} className="sm:col-span-2" />
        {errors.form && <p role="alert" className="text-sm text-danger sm:col-span-2">{errors.form}</p>}
      </form>
    </Modal>
  );
}

function RejectModal({ request, onClose, onDone }: { request: LeaveRequest; onClose: () => void; onDone: () => void }) {
  const { showToast } = useToast();
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!reason.trim()) {
      setError('Give the employee a reason.');
      return;
    }
    setSaving(true);
    try {
      await decideLeave(idOf(request), 'REJECT', reason.trim());
      showToast('Leave request rejected', 'success');
      onDone();
      onClose();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not reject', 'error');
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal open onClose={onClose} title="Reject leave request" description={`${request.employee_name} · ${request.leave_type} · ${date(request.start_date)} – ${date(request.end_date)}`}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button variant="danger" type="submit" form="reject-form" loading={saving}>Reject request</Button></>}>
      <form id="reject-form" onSubmit={submit} noValidate>
        <Textarea label="Reason for rejection" required value={reason} onChange={(e) => { setReason(e.target.value); setError(''); }} error={error || undefined} autoFocus />
      </form>
    </Modal>
  );
}

export function HrLeaves() {
  const { can } = useAuth();
  const { showToast } = useToast();
  const [tab, setTab] = useState('pending');
  const [applying, setApplying] = useState<'own' | 'behalf' | null>(null);
  const [rejecting, setRejecting] = useState<LeaveRequest | null>(null);
  const [approving, setApproving] = useState<string | null>(null);

  const pending = useApi(pendingLeaves);
  const history = useApi(listLeaves);
  const reload = () => { pending.reload(); history.reload(); };

  const approve = async (r: LeaveRequest) => {
    setApproving(idOf(r));
    try {
      await decideLeave(idOf(r), 'APPROVE', 'Approved by HR');
      showToast(`Leave approved for ${r.employee_name}`, 'success');
      reload();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not approve', 'error');
    } finally {
      setApproving(null);
    }
  };

  const pendingColumns: Column<LeaveRequest>[] = [
    { key: 'emp', header: 'Employee', sortValue: (r) => r.employee_name, render: (r) => <span><span className="block font-medium text-text">{r.employee_name}</span><span className="block text-xs text-text-muted">{r.department} · {r.employee_id}</span></span> },
    { key: 'type', header: 'Type', render: (r) => <span className="inline-flex flex-col items-start gap-1"><Badge tone="primary">{r.leave_type}</Badge>{r.is_loss_of_pay && <Badge tone="danger">LOP {r.lop_days} d</Badge>}</span> },
    { key: 'dates', header: 'Dates', sortValue: (r) => r.start_date, render: (r) => <span className="whitespace-nowrap">{date(r.start_date)} – {date(r.end_date)}<span className="block text-xs text-text-muted">{r.total_days} day{r.total_days === 1 ? '' : 's'}</span></span> },
    { key: 'bal', header: 'Balance', render: (r) => r.balances ? <span className="whitespace-nowrap text-xs text-text-muted">CL {r.balances.casual_leave_available} · SL {r.balances.sick_leave_available} · EL {r.balances.earned_leave_available}</span> : '—' },
    {
      key: 'overlap', header: 'Team overlap',
      render: (r) => r.conflict_warning?.has_conflict
        ? <span className="inline-flex items-start gap-1.5 text-xs text-warning"><AlertTriangle size={13} className="mt-px shrink-0" aria-hidden="true" /><span>{r.conflict_warning.conflict_count} away: {r.conflict_warning.conflicting_colleagues.map((c) => c.employee_name).join(', ')}</span></span>
        : <span className="text-xs text-success">No conflict</span>,
    },
    { key: 'level', header: 'Approver', render: (r) => <Badge tone="neutral">{LEVEL_LABEL[r.approval_level ?? 'HR']}</Badge> },
    { key: 'reason', header: 'Reason', className: 'max-w-48', render: (r) => <span className="line-clamp-2 text-text-secondary">{r.reason}</span> },
    ...(can('hr.leave.approve') ? [{
      key: 'actions', header: <span className="sr-only">Decision</span>, align: 'right' as const,
      render: (r: LeaveRequest) => (
        <span className="flex justify-end gap-1.5">
          <Button size="sm" variant="secondary" onClick={() => setRejecting(r)}><X size={14} /> Reject</Button>
          <Button size="sm" onClick={() => approve(r)} loading={approving === idOf(r)}><Check size={14} /> Approve</Button>
        </span>
      ),
    }] : []),
  ];

  const historyColumns: Column<LeaveRequest>[] = [
    { key: 'emp', header: 'Employee', sortValue: (r) => r.employee_name, render: (r) => <span><span className="block text-text">{r.employee_name}</span><span className="block text-xs text-text-muted">{r.employee_id}</span></span> },
    { key: 'type', header: 'Type', render: (r) => r.leave_type },
    { key: 'dates', header: 'Period', sortValue: (r) => r.start_date, render: (r) => <span className="whitespace-nowrap">{date(r.start_date)} – {date(r.end_date)}</span> },
    { key: 'days', header: 'Days', align: 'right', sortValue: (r) => r.total_days, render: (r) => r.total_days },
    { key: 'status', header: 'Status', sortValue: (r) => r.status, render: (r) => <StatusBadge status={r.status} /> },
    { key: 'lop', header: 'Pay', render: (r) => r.is_loss_of_pay ? <span className="text-danger">{r.lop_days} LOP days</span> : <span className="text-text-muted">Paid</span> },
    { key: 'level', header: 'Approver', render: (r) => LEVEL_LABEL[r.approval_level ?? 'HR'] },
    { key: 'by', header: 'Decided by', render: (r) => r.action_by_name || '—' },
    { key: 'applied', header: 'Applied', sortValue: (r) => r.created_at ?? '', render: (r) => <span className="whitespace-nowrap text-text-muted">{date(r.created_at?.slice(0, 10))}</span> },
  ];

  const active = tab === 'pending' ? pending : history;
  return (
    <>
      <PageHeader
        title="Leave"
        description="Balances, approvals and leave history. Sales leave goes to HR, HR leave to an Admin, Admin leave to the Super Admin."
        breadcrumbs={[{ label: 'HR' }, { label: 'Leave' }]}
        actions={<>
          <Button variant={can('hr.leave.apply') ? 'secondary' : 'primary'} onClick={() => setApplying('own')}><CalendarPlus size={15} /> Request my leave</Button>
          {can('hr.leave.apply') && <Button onClick={() => setApplying('behalf')}><CalendarPlus size={15} /> Apply for an employee</Button>}
        </>}
      />
      <Balances />
      <Card>
        <div className="px-4 pt-2">
          <Tabs tabs={[{ id: 'pending', label: 'Pending approval', count: pending.data?.data.length }, { id: 'history', label: 'All requests', count: history.data?.data.length }]} active={tab} onChange={setTab} />
        </div>
        {active.status === 'error' ? <ErrorState onRetry={active.reload} message={active.error} /> : (
          <Table
            caption={tab === 'pending' ? 'Pending leave requests' : 'All leave requests'}
            columns={tab === 'pending' ? pendingColumns : historyColumns}
            rows={active.data?.data ?? []}
            rowKey={idOf}
            loading={active.loading && !active.data}
            empty={<EmptyState compact icon={CalendarDays} title={tab === 'pending' ? 'No pending requests' : 'No leave requests yet'} description={tab === 'pending' ? 'New applications will appear here for review.' : undefined} />}
          />
        )}
      </Card>
      {applying && <ApplyModal own={applying === 'own'} onClose={() => setApplying(null)} onDone={reload} />}
      {rejecting && <RejectModal request={rejecting} onClose={() => setRejecting(null)} onDone={reload} />}
    </>
  );
}
