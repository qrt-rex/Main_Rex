import { useState, type FormEvent } from 'react';
import { HandCoins, Plus } from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';
import { useApi } from '../../lib/useApi';
import { currentMonth, currentYear, date, money, MONTHS, todayISO } from '../../lib/format';
import { approveAdvance, createAdjustment, listAdvances, listBonuses, listLoans, listOvertime, type Advance, type Bonus, type Loan, type Overtime } from '../api';
import { EmployeeOptionList, useEmployeeOptions } from '../HrSection';
import { Badge, StatusBadge } from '../../components/common/Badge';
import { Button } from '../../components/common/Button';
import { Card } from '../../components/common/Card';
import { EmptyState } from '../../components/common/EmptyState';
import { ErrorState } from '../../components/common/ErrorState';
import { Input, Select } from '../../components/common/Input';
import { Modal } from '../../components/common/Modal';
import { Table, type Column } from '../../components/common/Table';
import { Tabs } from '../../components/common/Tabs';
import { useToast } from '../../components/common/ToastContext';
import { PageHeader } from '../../components/layout/PageHeader';

type Kind = 'advances' | 'loans' | 'bonuses' | 'overtime';
const BONUS_TYPES = ['Performance Bonus', 'Festival Bonus', 'Sales Incentive', 'Project Bonus', 'Attendance Bonus', 'Custom Bonus'];

const FORMS: Record<Kind, { title: string; description: string; submit: string }> = {
  advances: { title: 'Issue salary advance', description: 'Recovered automatically from monthly payroll until repaid.', submit: 'Issue advance' },
  loans: { title: 'Issue employee loan', description: 'EMIs are deducted automatically from monthly payroll.', submit: 'Create loan' },
  bonuses: { title: 'Award bonus', description: 'Credited in the selected payroll month.', submit: 'Award bonus' },
  overtime: { title: 'Log approved overtime', description: 'Paid through payroll at the overtime rate.', submit: 'Log overtime' },
};

function CreateModal({ kind, onClose, onDone }: { kind: Kind; onClose: () => void; onDone: () => void }) {
  const { showToast } = useToast();
  const { employees } = useEmployeeOptions();
  const [v, setV] = useState<Record<string, string>>({
    employee_id: employees[0]?.id ?? '', month: currentMonth(), year: String(currentYear()), start_month: currentMonth(), start_year: String(currentYear()),
    interest_rate_percent: '4', start_date: todayISO(), date: todayISO(), type: BONUS_TYPES[0],
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setV((s) => ({ ...s, [k]: e.target.value }));
  const n = (k: string) => Number(v[k]);

  const validate = () => {
    const e: Record<string, string> = {};
    if (!v.employee_id) e.employee_id = 'Choose an employee.';
    if (kind === 'advances') {
      if (!(n('advance_amount') >= 1000)) e.advance_amount = 'Minimum advance is ₹1,000.';
      if (!(n('monthly_deduction_amount') >= 500)) e.monthly_deduction_amount = 'Minimum installment is ₹500.';
      else if (n('monthly_deduction_amount') > n('advance_amount')) e.monthly_deduction_amount = 'Installment cannot exceed the advance.';
      if (!v.reason?.trim()) e.reason = 'Give a reason.';
    }
    if (kind === 'loans') {
      if (!(n('principal_amount') >= 5000)) e.principal_amount = 'Minimum loan is ₹5,000.';
      if (!(n('monthly_emi') > 0)) e.monthly_emi = 'Enter the monthly EMI.';
      else if (n('monthly_emi') > n('principal_amount') * (1 + (n('interest_rate_percent') || 0) / 100)) e.monthly_emi = 'EMI cannot exceed the total payable.';
      if (!((n('interest_rate_percent') || 0) >= 0 && (n('interest_rate_percent') || 0) <= 100)) e.interest_rate_percent = 'Enter a rate between 0 and 100%.';
      if (!v.start_date) e.start_date = 'Choose a start date.';
    }
    if (kind === 'bonuses') {
      if (!(n('amount') >= 500)) e.amount = 'Minimum bonus is ₹500.';
      if (!v.reason?.trim()) e.reason = 'Give a justification.';
    }
    if (kind === 'overtime') {
      if (!(n('hours') >= 0.5)) e.hours = 'Enter at least 0.5 hours.';
      else if (n('hours') > 24) e.hours = 'A day has at most 24 hours.';
      if (!v.date) e.date = 'Choose the date.';
    }
    return e;
  };

  const body = (): Record<string, unknown> => {
    switch (kind) {
      case 'advances': return { employee_id: v.employee_id, advance_amount: n('advance_amount'), monthly_deduction_amount: n('monthly_deduction_amount'), start_month: v.start_month, start_year: n('start_year'), reason: v.reason.trim() };
      case 'loans': return { employee_id: v.employee_id, principal_amount: n('principal_amount'), interest_rate_percent: n('interest_rate_percent') || 0, monthly_emi: n('monthly_emi'), start_date: v.start_date, reason: v.reason?.trim() ?? '' };
      case 'bonuses': return { employee_id: v.employee_id, type: v.type, amount: n('amount'), month: v.month, year: n('year'), reason: v.reason.trim() };
      case 'overtime': return { employee_id: v.employee_id, date: v.date, hours: n('hours'), rate_per_hour: v.rate_per_hour ? n('rate_per_hour') : null, reason: v.reason?.trim() ?? '' };
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const found = validate();
    setErrors(found);
    if (Object.keys(found).length) return;
    setSaving(true);
    try {
      await createAdjustment(kind, body());
      showToast(`${FORMS[kind].submit.replace(/^\w+ /, '').replace(/^\w/, (c) => c.toUpperCase())} saved`, 'success');
      onDone();
      onClose();
    } catch (err) {
      setErrors({ form: err instanceof Error ? err.message : 'Could not save' });
    } finally {
      setSaving(false);
    }
  };

  const f = (name: string) => ({ value: v[name] ?? '', onChange: set(name), error: errors[name] || undefined });
  const monthYear = (m: string, y: string) => (
    <>
      <Select label="Month" {...f(m)}>{MONTHS.map((mo) => <option key={mo}>{mo}</option>)}</Select>
      <Input label="Year" type="number" min={2020} max={2100} {...f(y)} />
    </>
  );

  return (
    <Modal open onClose={onClose} closeOnOverlay={false} title={FORMS[kind].title} description={FORMS[kind].description}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" form="adj-form" loading={saving}>{FORMS[kind].submit}</Button></>}>
      <form id="adj-form" onSubmit={submit} noValidate className="grid gap-4 sm:grid-cols-2">
        <Select label="Employee" required {...f('employee_id')} className="sm:col-span-2"><EmployeeOptionList /></Select>
        {kind === 'advances' && <>
          <Input label="Advance amount (₹)" type="number" required min={1000} step={100} {...f('advance_amount')} />
          <Input label="Monthly recovery (₹)" type="number" required min={500} step={100} {...f('monthly_deduction_amount')} hint={n('advance_amount') && n('monthly_deduction_amount') ? `Recovered in ${Math.ceil(n('advance_amount') / n('monthly_deduction_amount'))} months` : undefined} />
          {monthYear('start_month', 'start_year')}
          <Input label="Reason" required {...f('reason')} className="sm:col-span-2" placeholder="e.g. Medical emergency" />
        </>}
        {kind === 'loans' && <>
          <Input label="Principal (₹)" type="number" required min={5000} {...f('principal_amount')} />
          <Input label="Annual interest (%)" type="number" min={0} step={0.5} {...f('interest_rate_percent')} />
          <Input label="Monthly EMI (₹)" type="number" required min={1} step={0.01} {...f('monthly_emi')} />
          <Input label="Start date" type="date" required {...f('start_date')} />
          <Input label="Purpose" {...f('reason')} className="sm:col-span-2" placeholder="e.g. Education assistance" />
        </>}
        {kind === 'bonuses' && <>
          <Select label="Category" {...f('type')}>{BONUS_TYPES.map((t) => <option key={t}>{t}</option>)}</Select>
          <Input label="Amount (₹)" type="number" required min={500} {...f('amount')} />
          {monthYear('month', 'year')}
          <Input label="Justification" required {...f('reason')} className="sm:col-span-2" />
        </>}
        {kind === 'overtime' && <>
          <Input label="Date" type="date" required max={todayISO()} {...f('date')} />
          <Input label="Hours" type="number" required min={0.5} step={0.5} {...f('hours')} />
          <Input label="Rate per hour (₹)" type="number" min={0} step={0.01} {...f('rate_per_hour')} hint="Leave blank to derive from basic salary" />
          <Input label="Project / reason" {...f('reason')} />
        </>}
        {errors.form && <p role="alert" className="text-sm text-danger sm:col-span-2">{errors.form}</p>}
      </form>
    </Modal>
  );
}

const person = (name: string, sub?: string) => <span><span className="block font-medium text-text">{name}</span>{sub && <span className="block text-xs text-text-muted">{sub}</span>}</span>;
const amount = (n: number, cls = '') => <span className={`tabular-nums ${cls}`}>{money(n)}</span>;

export function Advances() {
  const { can } = useAuth();
  const { showToast } = useToast();
  const { available } = useEmployeeOptions();
  const [tab, setTab] = useState<Kind>('advances');
  const [creating, setCreating] = useState(false);

  const advances = useApi(listAdvances);
  const loans = useApi(listLoans);
  const bonuses = useApi(listBonuses);
  const overtime = useApi(listOvertime);
  const sources = { advances, loans, bonuses, overtime };

  const approve = async (a: Advance) => {
    try {
      await approveAdvance(a.id);
      showToast('Advance approved', 'success');
      advances.reload();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not approve', 'error');
    }
  };

  const advanceCols: Column<Advance>[] = [
    { key: 'id', header: 'Advance', render: (a) => <span className="font-mono text-xs">{a.advance_id}</span> },
    { key: 'emp', header: 'Employee', sortValue: (a) => a.employee_name, render: (a) => person(a.employee_name, `${a.employee_code} · ${a.department}`) },
    { key: 'date', header: 'Requested', sortValue: (a) => a.request_date, render: (a) => <span className="whitespace-nowrap">{date(a.request_date)}</span> },
    { key: 'total', header: 'Amount', align: 'right', sortValue: (a) => a.advance_amount, render: (a) => amount(a.advance_amount) },
    { key: 'monthly', header: 'Per month', align: 'right', render: (a) => amount(a.monthly_deduction_amount, 'text-text-secondary') },
    {
      key: 'recovered', header: 'Recovered', sortValue: (a) => a.paid_amount / (a.advance_amount || 1),
      render: (a) => {
        const pct = Math.min(100, Math.round((a.paid_amount / (a.advance_amount || 1)) * 100));
        return <span className="flex min-w-28 items-center gap-2"><span className="h-1.5 flex-1 overflow-hidden rounded-full bg-neutral-bg"><span className="block h-full rounded-full bg-success" style={{ width: `${pct}%` }} /></span><span className="text-xs tabular-nums text-text-muted">{pct}%</span></span>;
      },
    },
    { key: 'left', header: 'Balance', align: 'right', sortValue: (a) => a.remaining_balance, render: (a) => amount(a.remaining_balance, 'font-medium text-text') },
    { key: 'status', header: 'Status', render: (a) => <StatusBadge status={a.status} /> },
    ...(can('hr.advances.manage') ? [{ key: 'act', header: <span className="sr-only">Actions</span>, align: 'right' as const, render: (a: Advance) => a.status === 'Pending' ? <Button size="sm" onClick={() => approve(a)}>Approve</Button> : null }] : []),
  ];
  const loanCols: Column<Loan>[] = [
    { key: 'id', header: 'Loan', render: (l) => <span className="font-mono text-xs">{l.loan_id}</span> },
    { key: 'emp', header: 'Employee', sortValue: (l) => l.employee_name, render: (l) => person(l.employee_name, `${l.employee_code} · ${l.department}`) },
    { key: 'start', header: 'Start', sortValue: (l) => l.start_date, render: (l) => <span className="whitespace-nowrap">{date(l.start_date)}</span> },
    { key: 'principal', header: 'Principal', align: 'right', sortValue: (l) => l.principal_amount, render: (l) => amount(l.principal_amount) },
    { key: 'rate', header: 'Interest', align: 'right', render: (l) => `${l.interest_rate_percent}%` },
    { key: 'total', header: 'Total payable', align: 'right', render: (l) => amount(l.total_payable) },
    { key: 'emi', header: 'EMI', align: 'right', render: (l) => amount(l.monthly_emi, 'text-text-secondary') },
    { key: 'left', header: 'Remaining', align: 'right', sortValue: (l) => l.remaining_amount, render: (l) => amount(l.remaining_amount, 'font-medium text-text') },
    { key: 'status', header: 'Status', render: (l) => <StatusBadge status={l.status} /> },
  ];
  const bonusCols: Column<Bonus>[] = [
    { key: 'id', header: 'Bonus', render: (b) => <span className="font-mono text-xs">{b.bonus_id}</span> },
    { key: 'emp', header: 'Employee', sortValue: (b) => b.employee_name, render: (b) => person(b.employee_name) },
    { key: 'type', header: 'Category', render: (b) => <Badge tone="primary">{b.type}</Badge> },
    { key: 'reason', header: 'Reason', className: 'max-w-64', render: (b) => <span className="line-clamp-2 text-text-secondary">{b.reason}</span> },
    { key: 'month', header: 'Payroll month', render: (b) => `${b.month} ${b.year}` },
    { key: 'amount', header: 'Amount', align: 'right', sortValue: (b) => b.amount, render: (b) => amount(b.amount, 'font-medium text-text') },
    { key: 'status', header: 'Status', render: (b) => <StatusBadge status={b.status} /> },
  ];
  const otCols: Column<Overtime>[] = [
    { key: 'emp', header: 'Employee', sortValue: (o) => o.employee_name, render: (o) => person(o.employee_name) },
    { key: 'date', header: 'Date', sortValue: (o) => o.date, render: (o) => <span className="whitespace-nowrap">{date(o.date)}</span> },
    { key: 'hours', header: 'Hours', align: 'right', sortValue: (o) => o.hours, render: (o) => `${o.hours} h` },
    { key: 'rate', header: 'Rate', align: 'right', render: (o) => <span className="tabular-nums">{money(o.rate_per_hour, true)}/h</span> },
    { key: 'amount', header: 'Amount', align: 'right', sortValue: (o) => o.amount, render: (o) => amount(o.amount, 'font-medium text-text') },
    { key: 'by', header: 'Approved by', render: (o) => o.approved_by || 'HR Admin' },
    { key: 'status', header: 'Status', render: (o) => <StatusBadge status={o.status} /> },
  ];

  const src = sources[tab];
  const table = {
    advances: <Table caption="Salary advances" columns={advanceCols} rows={advances.data ?? []} rowKey={(a) => a.id} loading={advances.loading} empty={<EmptyState compact icon={HandCoins} title="No salary advances" />} />,
    loans: <Table caption="Employee loans" columns={loanCols} rows={loans.data ?? []} rowKey={(l) => l.id} loading={loans.loading} empty={<EmptyState compact icon={HandCoins} title="No employee loans" />} />,
    bonuses: <Table caption="Bonuses" columns={bonusCols} rows={bonuses.data ?? []} rowKey={(b) => b.id} loading={bonuses.loading} empty={<EmptyState compact icon={HandCoins} title="No bonuses awarded" />} />,
    overtime: <Table caption="Overtime" columns={otCols} rows={overtime.data ?? []} rowKey={(o) => o.id} loading={overtime.loading} empty={<EmptyState compact icon={HandCoins} title="No overtime logged" />} />,
  }[tab];

  return (
    <>
      <PageHeader
        title="Advances & loans"
        description="Salary advances, employee loans, bonuses and overtime that flow into payroll."
        breadcrumbs={[{ label: 'HR' }, { label: 'Advances & loans' }]}
        actions={can('hr.advances.manage') && available && <Button onClick={() => setCreating(true)}><Plus size={15} /> {FORMS[tab].title}</Button>}
      />
      <Card>
        <div className="px-4 pt-2">
          <Tabs active={tab} onChange={(id) => setTab(id as Kind)} tabs={[
            { id: 'advances', label: 'Salary advances', count: advances.data?.length },
            { id: 'loans', label: 'Loans', count: loans.data?.length },
            { id: 'bonuses', label: 'Bonuses', count: bonuses.data?.length },
            { id: 'overtime', label: 'Overtime', count: overtime.data?.length },
          ]} />
        </div>
        {src.status === 'error' ? <ErrorState onRetry={src.reload} message={src.error} /> : table}
      </Card>
      {creating && <CreateModal kind={tab} onClose={() => setCreating(false)} onDone={src.reload} />}
    </>
  );
}
