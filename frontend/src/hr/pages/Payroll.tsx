import { useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import {
  Banknote, CheckCheck, Download, FileText, Landmark, Lock, LockOpen, Mail, MoreHorizontal, Pencil, Play, Receipt, Scale, Users, X, Zap,
} from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';
import { useApi } from '../../lib/useApi';
import { currentMonth, currentYear, money, MONTHS } from '../../lib/format';
import { exportCsv } from '../../lib/spreadsheet';
import {
  bankExport, calculateBulk, DEPARTMENTS, editPayroll, listPayroll, payrollAction, payrollMetrics, sendBulkPayslips, unlockPayroll,
  type PayrollRecord,
} from '../api';
import { PayslipPreview, Toolbar } from '../components';
import { StatusBadge } from '../../components/common/Badge';
import { Button } from '../../components/common/Button';
import { Card } from '../../components/common/Card';
import { useConfirm } from '../../components/common/ConfirmDialog';
import { Dropdown, DropdownItem, DropdownSeparator } from '../../components/common/Dropdown';
import { EmptyState } from '../../components/common/EmptyState';
import { ErrorState } from '../../components/common/ErrorState';
import { Checkbox, Input, SearchInput, Select, Textarea } from '../../components/common/Input';
import { Modal } from '../../components/common/Modal';
import { Table, type Column } from '../../components/common/Table';
import { useToast } from '../../components/common/ToastContext';
import { StatCard } from '../../components/dashboard/StatCard';
import { PageHeader } from '../../components/layout/PageHeader';

const STATUSES = ['DRAFT', 'CALCULATED', 'UNDER_REVIEW', 'APPROVED', 'FINALIZED', 'PAID'];
const idOf = (p: PayrollRecord) => p.id || p._id || '';
const isLocked = (p: PayrollRecord) => !!p.is_locked || p.status === 'FINALIZED' || p.status === 'PAID';

const EARNINGS = [['basic', 'Basic'], ['da', 'Dearness allowance'], ['hra', 'HRA'], ['conveyance', 'Conveyance'], ['medical', 'Medical allowance'], ['special_allowance', 'Special allowance'], ['bonus', 'Performance bonus'], ['incentive', 'Incentives'], ['overtime_pay', 'Overtime pay'], ['other_earnings', 'Other earnings']] as const;
const DEDUCTIONS = [['pf', 'Provident fund'], ['esi', 'ESI'], ['professional_tax', 'Professional tax'], ['tds', 'TDS'], ['unpaid_leave_deduction', 'Unpaid leave'], ['late_deduction', 'Late marks'], ['salary_advance_deduction', 'Advance recovery'], ['loan_deduction', 'Loan EMI'], ['other_deductions', 'Other deductions']] as const;

function initialValues(p: PayrollRecord) {
  const e = p.earnings ?? {};
  const d = p.deductions ?? {};
  return {
    basic: e.basic ?? 0, da: e.da ?? 0, hra: e.hra ?? 0, conveyance: e.conveyance ?? 0, medical: e.medical ?? 0, special_allowance: e.special_allowance ?? 0,
    bonus: e.bonus ?? 0, incentive: e.incentive ?? 0, overtime_pay: e.overtime_pay ?? 0, other_earnings: (e.other_earnings ?? 0) + (e.manual_adjustments ?? 0),
    pf: d.pf ?? 0, esi: d.esi ?? 0, professional_tax: d.professional_tax ?? d.pt ?? 200, tds: d.tds ?? 0,
    unpaid_leave_deduction: d.unpaid_leave_deduction ?? d.lop_deduction ?? 0, late_deduction: d.late_deduction ?? 0,
    salary_advance_deduction: d.salary_advance_deduction ?? 0, loan_deduction: d.loan_deduction ?? 0,
    other_deductions: (d.other_deductions ?? 0) + (d.manual_adjustments ?? 0),
  } as Record<string, number>;
}

function EditModal({ record, onClose, onSaved, onPreview }: { record: PayrollRecord; onClose: () => void; onSaved: () => void; onPreview: () => void }) {
  const { can } = useAuth();
  const { showToast } = useToast();
  const [v, setV] = useState<Record<string, string>>(() => Object.fromEntries(Object.entries(initialValues(record)).map(([k, n]) => [k, String(n)])));
  const [remarks, setRemarks] = useState(record.remarks ?? '');
  const [busy, setBusy] = useState<string | null>(null);
  const num = (k: string) => Number(v[k]) || 0;
  const gross = EARNINGS.reduce((s, [k]) => s + num(k), 0);
  const deductions = DEDUCTIONS.reduce((s, [k]) => s + num(k), 0);
  const net = Math.max(0, gross - deductions);
  const att = record.attendance ?? {};
  const locked = isLocked(record);
  // PF from the PF engine is read-only here: the backend redoes it when basic or DA changes.
  const pfFromEngine = !!record.pf;

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (Object.values(v).some((x) => Number(x) < 0)) {
      showToast('Amounts cannot be negative', 'error');
      return;
    }
    setBusy('save');
    try {
      await editPayroll(idOf(record), { ...Object.fromEntries(Object.keys(v).filter((k) => !(pfFromEngine && k === 'pf')).map((k) => [k, num(k)])), remarks });
      showToast('Payroll recalculated and saved', 'success');
      onSaved();
      onClose();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not save', 'error');
    } finally {
      setBusy(null);
    }
  };

  const act = async (action: 'approve' | 'send-email') => {
    setBusy(action);
    try {
      const res = await payrollAction(idOf(record), action);
      showToast(action === 'approve' ? 'Payroll approved' : res.success ? `Payslip emailed to ${res.email}` : res.message || 'Email could not be sent', action === 'send-email' && !res.success ? 'warning' : 'success');
      if (action === 'approve') {
        onSaved();
        onClose();
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Action failed', 'error');
    } finally {
      setBusy(null);
    }
  };

  const pfHint = record.pf && (record.pf.status === 'CALCULATED'
    ? `On PF wage ${money(record.pf.pf_wage ?? 0, true)}${record.pf.rule_name ? ` · ${record.pf.rule_name}` : ''}. Recalculated on save if basic or DA changes.`
    : record.pf.reason || 'Set by the PF rules.');
  const field = (k: string, label: string) => (
    <Input key={k} label={label} type="number" step="0.01" min={0} value={v[k]} onChange={(e) => setV((s) => ({ ...s, [k]: e.target.value }))}
      disabled={locked || !can('hr.payroll.process') || (pfFromEngine && k === 'pf')} hint={pfFromEngine && k === 'pf' ? pfHint : undefined} inputClassName="tabular-nums text-right" />
  );

  return (
    <Modal open onClose={onClose} size="xl" closeOnOverlay={false}
      title={`${record.employee_name} · ${record.month} ${record.year}`}
      description={<span className="inline-flex flex-wrap items-center gap-2">{record.employee_code} · {record.department} · {record.designation} <StatusBadge status={record.status} /></span>}
      footer={<>
        <Button variant="ghost" onClick={onPreview}><FileText size={15} /> Preview payslip</Button>
        {can('hr.payroll.process') && <Button variant="ghost" onClick={() => act('send-email')} loading={busy === 'send-email'}><Mail size={15} /> Email payslip</Button>}
        <span className="flex-1" />
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        {can('hr.payroll.approve') && !locked && record.status !== 'APPROVED' && <Button variant="secondary" onClick={() => act('approve')} loading={busy === 'approve'}><CheckCheck size={15} /> Approve</Button>}
        {can('hr.payroll.process') && !locked && <Button type="submit" form="payroll-form" loading={busy === 'save'}>Save & recalculate</Button>}
      </>}>
      {locked && <p className="mb-4 flex items-center gap-2 rounded-md bg-info-bg px-3 py-2 text-sm text-info"><Lock size={14} aria-hidden="true" /> This payroll is finalized. Unlock it with a reason to make changes.</p>}
      <div className="mb-4 grid grid-cols-3 gap-2 text-center sm:grid-cols-7">
        {([['Working', att.working_days], ['Present', att.present_days], ['Paid leave', att.paid_leave_days], ['LOP', att.unpaid_leave_days], ['Half days', att.half_days], ['Late marks', att.late_count], ['OT hours', att.overtime_hours]] as const).map(([label, value]) => (
          <div key={label} className="rounded-md border border-border px-2 py-2">
            <p className="text-[11px] text-text-muted">{label}</p>
            <p className="text-sm font-semibold tabular-nums text-text">{value ?? 0}</p>
          </div>
        ))}
      </div>
      <form id="payroll-form" onSubmit={save} noValidate className="grid gap-5 md:grid-cols-2">
        <fieldset className="space-y-3">
          <legend className="mb-2 flex w-full items-center justify-between text-sm font-semibold text-text">Earnings <span className="tabular-nums text-text-secondary">{money(gross, true)}</span></legend>
          <div className="grid grid-cols-2 gap-3">{EARNINGS.map(([k, l]) => field(k, l))}</div>
        </fieldset>
        <fieldset className="space-y-3">
          <legend className="mb-2 flex w-full items-center justify-between text-sm font-semibold text-text">Deductions <span className="tabular-nums text-text-secondary">{money(deductions, true)}</span></legend>
          <div className="grid grid-cols-2 gap-3">{DEDUCTIONS.map(([k, l]) => field(k, l))}</div>
        </fieldset>
        <div className="flex items-center justify-between rounded-lg border border-border bg-surface-secondary px-4 py-3 md:col-span-2">
          <span className="text-sm font-medium text-text-secondary">Net payable</span>
          <span className="text-2xl font-semibold tabular-nums text-text">{money(net, true)}</span>
        </div>
        <Input label="Remarks" value={remarks} onChange={(e) => setRemarks(e.target.value)} disabled={locked || !can('hr.payroll.process')} placeholder="e.g. Q3 incentive approved" className="md:col-span-2" />
      </form>
    </Modal>
  );
}

function BatchModal({ month, year, onClose, onDone }: { month: string; year: number; onClose: () => void; onDone: () => void }) {
  const { showToast } = useToast();
  const [v, setV] = useState({ month, year: String(year), department: 'All', auto_approve: true });
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<Awaited<ReturnType<typeof calculateBulk>> | null>(null);

  const run = async (e: FormEvent) => {
    e.preventDefault();
    setRunning(true);
    try {
      const res = await calculateBulk({ month: v.month, year: Number(v.year), department: v.department, auto_approve: v.auto_approve });
      setResult(res);
      showToast(`Payroll calculated for ${res.successful_count} employees`, res.failed_count ? 'warning' : 'success');
      onDone();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Batch payroll failed', 'error');
    } finally {
      setRunning(false);
    }
  };

  return (
    <Modal open onClose={onClose} closeOnOverlay={false} title="Run batch payroll"
      description="Calculates PF, PT, ESI, TDS, leave and loan/advance deductions for every active employee in scope."
      footer={result
        ? <Button onClick={onClose}>Done</Button>
        : <><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" form="batch-form" loading={running}><Play size={15} /> Run payroll</Button></>}>
      {result ? (
        <div className="space-y-3">
          <p className="text-sm text-text">Processed <strong>{result.total_processed}</strong> employees: <span className="text-success">{result.successful_count} succeeded</span>{result.failed_count > 0 && <>, <span className="text-danger">{result.failed_count} failed</span></>}.</p>
          {result.failed.length > 0 && (
            <ul className="max-h-48 space-y-1 overflow-y-auto rounded-md border border-border p-3 text-xs text-text-secondary">
              {result.failed.map((f) => <li key={f.employee_code}><strong className="text-text">{f.employee_name}</strong> ({f.employee_code}): {f.reason}</li>)}
            </ul>
          )}
        </div>
      ) : (
        <form id="batch-form" onSubmit={run} className="grid gap-4 sm:grid-cols-2">
          <Select label="Month" value={v.month} onChange={(e) => setV((s) => ({ ...s, month: e.target.value }))}>{MONTHS.map((m) => <option key={m}>{m}</option>)}</Select>
          <Input label="Year" type="number" min={2020} max={2100} value={v.year} onChange={(e) => setV((s) => ({ ...s, year: e.target.value }))} />
          <Select label="Department" value={v.department} onChange={(e) => setV((s) => ({ ...s, department: e.target.value }))} className="sm:col-span-2">
            <option value="All">All departments</option>{DEPARTMENTS.map((d) => <option key={d}>{d}</option>)}
          </Select>
          <Checkbox label="Mark results as approved" description="Skip the review step for this run" checked={v.auto_approve} onChange={(e) => setV((s) => ({ ...s, auto_approve: e.target.checked }))} className="sm:col-span-2" />
        </form>
      )}
    </Modal>
  );
}

function UnlockModal({ record, onClose, onDone }: { record: PayrollRecord; onClose: () => void; onDone: () => void }) {
  const { showToast } = useToast();
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (reason.trim().length < 5) {
      setError('Explain why (at least 5 characters). This is recorded in the audit trail.');
      return;
    }
    setSaving(true);
    try {
      await unlockPayroll(idOf(record), reason.trim());
      showToast('Payroll unlocked for revision', 'success');
      onDone();
      onClose();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not unlock', 'error');
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal open onClose={onClose} title="Unlock finalized payroll" description={`${record.employee_name} · ${record.month} ${record.year}. Unlocking creates an audited revision and returns it to review.`}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button variant="danger" type="submit" form="unlock-form" loading={saving}><LockOpen size={15} /> Unlock</Button></>}>
      <form id="unlock-form" onSubmit={submit} noValidate>
        <Textarea label="Reason for unlocking" required value={reason} onChange={(e) => { setReason(e.target.value); setError(''); }} error={error || undefined} autoFocus placeholder="e.g. Correcting overtime missed in the first run" />
      </form>
    </Modal>
  );
}

export function Payroll() {
  const { can } = useAuth();
  const { showToast } = useToast();
  const confirm = useConfirm();
  const [month, setMonth] = useState(currentMonth());
  const [year, setYear] = useState(currentYear());
  const [department, setDepartment] = useState('');
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<PayrollRecord | null>(null);
  const [unlocking, setUnlocking] = useState<PayrollRecord | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [batch, setBatch] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);

  const records = useApi(() => listPayroll({ month, year, department: department || undefined, status: status || undefined }), [month, year, department, status]);
  const metrics = useApi(() => payrollMetrics(month, year), [month, year]);
  const reload = () => { records.reload(); metrics.reload(); setSelected(new Set()); };

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (records.data ?? []).filter((p) => !q || `${p.employee_name} ${p.employee_code} ${p.department} ${p.designation}`.toLowerCase().includes(q));
  }, [records.data, search]);
  const selectedRows = rows.filter((p) => selected.has(idOf(p)));

  const rowAction = async (p: PayrollRecord, action: 'finalize' | 'send-email') => {
    if (action === 'finalize') {
      const ok = await confirm({ title: `Finalize payroll for ${p.employee_name}?`, message: 'The record is locked and advance/loan recoveries are committed. It can only be changed again by unlocking with a reason.', confirmText: 'Finalize' });
      if (!ok) return;
    }
    try {
      const res = await payrollAction(idOf(p), action);
      showToast(action === 'finalize' ? 'Payroll finalized' : res.success ? `Payslip emailed to ${res.email}` : res.message || 'Email could not be sent', action === 'send-email' && !res.success ? 'warning' : 'success');
      if (action === 'finalize') reload();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Action failed', 'error');
    }
  };

  const bulk = async (kind: 'calculate' | 'finalize' | 'email' | 'paid') => {
    const ids = selectedRows.map(idOf);
    if (!ids.length) return;
    const prompts = {
      calculate: null,
      finalize: { title: `Finalize ${ids.length} payrolls?`, message: 'Selected records are locked and payslips are issued.', confirmText: 'Finalize all' },
      email: { title: `Email ${ids.length} payslips?`, message: 'Each employee receives only their own payslip.', confirmText: 'Send emails' },
      paid: { title: `Mark ${ids.length} payrolls as paid?`, message: 'Use this once salaries have been transferred.', confirmText: 'Mark paid' },
    } as const;
    const prompt = prompts[kind];
    if (prompt && !(await confirm(prompt))) return;
    setBulkBusy(true);
    try {
      if (kind === 'calculate') {
        const res = await calculateBulk({ month, year, employee_ids: selectedRows.map((p) => p.employee_id), auto_approve: false });
        showToast(`Recalculated ${res.successful_count}, ${res.failed_count} failed`, res.failed_count ? 'warning' : 'success');
      } else if (kind === 'email') {
        const res = await sendBulkPayslips(ids);
        showToast(`${res.sent_count} payslips sent, ${res.failed_count} failed`, res.failed_count ? 'warning' : 'success');
      } else {
        const results = await Promise.allSettled(ids.map((id) => payrollAction(id, kind === 'finalize' ? 'finalize' : 'mark-paid')));
        const failed = results.filter((r) => r.status === 'rejected').length;
        showToast(`${ids.length - failed} updated${failed ? `, ${failed} failed` : ''}`, failed ? 'warning' : 'success');
      }
      reload();
    } finally {
      setBulkBusy(false);
    }
  };

  const exportRows = (list: PayrollRecord[]) => exportCsv(list.map((p) => ({
    'Employee code': p.employee_code, Employee: p.employee_name, Department: p.department, Designation: p.designation, Month: p.month, Year: p.year,
    Gross: p.gross_salary, Deductions: p.total_deductions, 'Advance recovery': p.deductions?.salary_advance_deduction ?? 0,
    'Loan EMI': p.deductions?.loan_deduction ?? 0, 'Net payable': p.net_salary, Status: p.status,
  })), `payroll-register-${month}-${year}.csv`);

  const downloadBank = async () => {
    try {
      const res = await bankExport(month, year);
      if (!res.records.length) {
        showToast('No approved or finalized payroll to export for this period', 'info');
        return;
      }
      exportCsv(res.records.map((r) => ({ 'Employee code': r.employee_code, Employee: r.employee_name, Department: r.department, Bank: r.bank_name, 'Account number': r.account_no, IFSC: r.ifsc_code, 'Net salary': r.net_salary, 'Payment reference': r.payment_reference })), `bank-payout-${month}-${year}.csv`);
      showToast('Bank payout file downloaded', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Bank export failed', 'error');
    }
  };

  const columns: Column<PayrollRecord>[] = [
    { key: 'emp', header: 'Employee', sortValue: (p) => p.employee_name, render: (p) => <span><span className="block font-medium text-text">{p.employee_name}</span><span className="block font-mono text-xs text-text-muted">{p.employee_code}</span></span> },
    { key: 'dept', header: 'Department', sortValue: (p) => p.department, render: (p) => <span><span className="block text-text">{p.department}</span><span className="block text-xs text-text-muted">{p.designation}</span></span> },
    { key: 'gross', header: 'Gross', align: 'right', sortValue: (p) => p.gross_salary, render: (p) => <span className="tabular-nums">{money(p.gross_salary)}</span> },
    { key: 'ded', header: 'Deductions', align: 'right', sortValue: (p) => p.total_deductions, render: (p) => <span className="tabular-nums text-text-secondary">{money(p.total_deductions)}</span> },
    { key: 'adv', header: 'Advance / loan', align: 'right', render: (p) => { const n = (p.deductions?.salary_advance_deduction ?? 0) + (p.deductions?.loan_deduction ?? 0); return n ? <span className="tabular-nums">{money(n)}</span> : <span className="text-text-muted">—</span>; } },
    { key: 'net', header: 'Net payable', align: 'right', sortValue: (p) => p.net_salary, render: (p) => <span className="font-semibold tabular-nums text-text">{money(p.net_salary)}</span> },
    { key: 'status', header: 'Status', sortValue: (p) => p.status, render: (p) => <span className="inline-flex items-center gap-1.5"><StatusBadge status={p.status} />{isLocked(p) && <Lock size={12} className="text-text-muted" aria-label="Locked" />}</span> },
    {
      key: 'actions', header: <span className="sr-only">Actions</span>, align: 'right',
      render: (p) => (
        <span onClick={(e) => e.stopPropagation()}>
          <Dropdown label={`Actions for ${p.employee_name}`} width="w-56" triggerClassName="h-8 w-8 justify-center text-text-muted hover:bg-neutral-bg hover:text-text" trigger={<MoreHorizontal size={16} />}>
            <DropdownItem icon={<Pencil size={15} />} onClick={() => setEditing(p)}>{isLocked(p) || !can('hr.payroll.process') ? 'View breakdown' : 'Edit & recalculate'}</DropdownItem>
            <DropdownItem icon={<FileText size={15} />} onClick={() => setPreviewId(idOf(p))}>Preview payslip</DropdownItem>
            {can('hr.payroll.process') && <DropdownItem icon={<Mail size={15} />} onClick={() => rowAction(p, 'send-email')}>Email payslip</DropdownItem>}
            {can('hr.payroll.approve') && (
              <>
                <DropdownSeparator />
                {isLocked(p)
                  ? <DropdownItem icon={<LockOpen size={15} />} onClick={() => setUnlocking(p)}>Unlock…</DropdownItem>
                  : <DropdownItem icon={<Lock size={15} />} onClick={() => rowAction(p, 'finalize')}>Finalize & lock</DropdownItem>}
              </>
            )}
          </Dropdown>
        </span>
      ),
    },
  ];

  const m = metrics.data;
  return (
    <>
      <PageHeader
        title="Payroll"
        description="Calculate, review, approve and pay monthly salaries."
        breadcrumbs={[{ label: 'HR' }, { label: 'Payroll' }]}
        actions={<>
          {can('hr.payroll.approve') && <Button variant="secondary" onClick={downloadBank}><Landmark size={15} /> Bank payout file</Button>}
          <Link to="/hr/payslips" className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-surface px-3.5 text-sm font-medium text-text shadow-[var(--shadow-card)] hover:bg-surface-secondary"><Receipt size={15} /> Salary register</Link>
          {can('hr.payroll.process') && <Button onClick={() => setBatch(true)}><Zap size={15} /> Run payroll</Button>}
        </>}
      />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        <StatCard icon={Users} label="Active employees" value={m?.total_employees ?? '—'} />
        <StatCard icon={CheckCheck} tone="success" label="Processed" value={m?.processed_count ?? '—'} />
        <StatCard icon={Scale} tone="warning" label="Pending" value={m?.pending_count ?? '—'} />
        <StatCard icon={Banknote} tone="info" label="Gross payroll" value={m ? money(m.total_gross_payroll) : '—'} />
        <StatCard icon={Receipt} tone="danger" label="Deductions" value={m ? money(m.total_deductions) : '—'} />
        <StatCard icon={Landmark} tone="success" label="Net payable" value={m ? money(m.total_net_payroll) : '—'} />
      </div>

      <Card>
        <Toolbar count={records.data ? `${rows.length} records` : undefined}>
          <Select aria-label="Month" value={month} onChange={(e) => setMonth(e.target.value as typeof month)} selectClassName="w-36">{MONTHS.map((mo) => <option key={mo}>{mo}</option>)}</Select>
          <Input aria-label="Year" type="number" min={2020} max={2100} value={year} onChange={(e) => setYear(Number(e.target.value) || currentYear())} inputClassName="w-24" />
          <Select aria-label="Department" value={department} onChange={(e) => setDepartment(e.target.value)} selectClassName="w-40"><option value="">All departments</option>{DEPARTMENTS.map((d) => <option key={d}>{d}</option>)}</Select>
          <Select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)} selectClassName="w-36"><option value="">All statuses</option>{STATUSES.map((s) => <option key={s} value={s}>{s.charAt(0) + s.slice(1).toLowerCase().replace('_', ' ')}</option>)}</Select>
          <SearchInput value={search} onChange={setSearch} placeholder="Search employee…" label="Search payroll" />
        </Toolbar>

        {selectedRows.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 border-b border-border bg-primary-soft/50 px-3 py-2 animate-fade-in" role="region" aria-label="Bulk actions">
            <span className="mr-1 text-sm font-medium text-text">{selectedRows.length} selected</span>
            {can('hr.payroll.process') && <Button size="sm" variant="secondary" onClick={() => bulk('calculate')} disabled={bulkBusy}><Zap size={14} /> Recalculate</Button>}
            {can('hr.payroll.approve') && <Button size="sm" variant="secondary" onClick={() => bulk('finalize')} disabled={bulkBusy}><Lock size={14} /> Finalize</Button>}
            {can('hr.payroll.process') && <Button size="sm" variant="secondary" onClick={() => bulk('email')} disabled={bulkBusy}><Mail size={14} /> Email payslips</Button>}
            {can('hr.payroll.approve') && <Button size="sm" variant="secondary" onClick={() => bulk('paid')} disabled={bulkBusy}><CheckCheck size={14} /> Mark paid</Button>}
            <Button size="sm" variant="secondary" onClick={() => exportRows(selectedRows)}><Download size={14} /> Export</Button>
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())} className="ml-auto"><X size={14} /> Clear</Button>
          </div>
        )}

        {records.status === 'error' ? <ErrorState onRetry={records.reload} message={records.error} /> : (
          <Table
            caption={`Payroll for ${month} ${year}`}
            columns={columns}
            rows={rows}
            rowKey={idOf}
            loading={records.loading}
            onRowClick={setEditing}
            selection={{ selected, onChange: setSelected }}
            empty={<EmptyState icon={Banknote} title={`No payroll for ${month} ${year}`} description="Run payroll to calculate salaries for this period." action={can('hr.payroll.process') ? <Button onClick={() => setBatch(true)}><Zap size={15} /> Run payroll</Button> : undefined} />}
          />
        )}
        {rows.length > 0 && selectedRows.length === 0 && (
          <div className="flex justify-end border-t border-border px-3 py-2">
            <Button size="sm" variant="ghost" onClick={() => exportRows(rows)}><Download size={14} /> Export register (CSV)</Button>
          </div>
        )}
      </Card>

      {editing && <EditModal record={editing} onClose={() => setEditing(null)} onSaved={reload} onPreview={() => { setPreviewId(idOf(editing)); setEditing(null); }} />}
      {unlocking && <UnlockModal record={unlocking} onClose={() => setUnlocking(null)} onDone={reload} />}
      {batch && <BatchModal month={month} year={year} onClose={() => setBatch(false)} onDone={reload} />}
      <PayslipPreview id={previewId} onClose={() => setPreviewId(null)} />
    </>
  );
}
