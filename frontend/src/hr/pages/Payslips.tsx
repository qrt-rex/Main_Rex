import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Banknote, Download, FileText, Landmark, MoreHorizontal, Printer, Receipt, ShieldCheck, Trash2 } from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';
import { useApi, useDebounced } from '../../lib/useApi';
import { currentMonth, currentYear, money, MONTHS } from '../../lib/format';
import { exportCsv } from '../../lib/spreadsheet';
import { calculateSalary, deleteSlip, generateSlip, listSlips, salarySummary, salesPayrollPreview, type SalaryCalc, type SalesPayrollPreview, type SalarySlip } from '../api';
import { EmployeeOptionList, useEmployeeOptions } from '../HrSection';
import { PayslipPreview, Toolbar } from '../components';
import { Button } from '../../components/common/Button';
import { Card, CardHeader } from '../../components/common/Card';
import { useConfirm } from '../../components/common/ConfirmDialog';
import { Dropdown, DropdownItem } from '../../components/common/Dropdown';
import { EmptyState } from '../../components/common/EmptyState';
import { ErrorState } from '../../components/common/ErrorState';
import { Input, SearchInput, Select } from '../../components/common/Input';
import { Table, type Column } from '../../components/common/Table';
import { Tabs } from '../../components/common/Tabs';
import { useToast } from '../../components/common/ToastContext';
import { StatCard } from '../../components/dashboard/StatCard';
import { PageHeader } from '../../components/layout/PageHeader';

function Register({ onPreview }: { onPreview: (id: string) => void }) {
  const { can } = useAuth();
  const { showToast } = useToast();
  const confirm = useConfirm();
  const [month, setMonth] = useState(currentMonth());
  const [year, setYear] = useState(currentYear());
  const [search, setSearch] = useState('');
  const q = useDebounced(search).toLowerCase();

  const summary = useApi(() => salarySummary(month, year), [month, year]);
  const slips = useApi(() => listSlips(month, year), [month, year]);
  const rows = useMemo(() => (slips.data?.slips ?? []).filter((s) => !q || `${s.employee_name} ${s.employee_code} ${s.slip_number}`.toLowerCase().includes(q)), [slips.data, q]);

  const remove = async (s: SalarySlip) => {
    const ok = await confirm({ title: `Delete payslip ${s.slip_number}?`, message: 'Finalized or paid payroll must be unlocked before it can be deleted.', confirmText: 'Delete payslip', tone: 'danger' });
    if (!ok) return;
    try {
      await deleteSlip(s.id);
      showToast('Payslip deleted', 'success');
      slips.reload();
      summary.reload();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not delete', 'error');
    }
  };

  const columns: Column<SalarySlip>[] = [
    { key: 'slip', header: 'Slip no.', sortValue: (s) => s.slip_number, render: (s) => <span className="font-mono text-xs text-text-secondary">{s.slip_number}</span> },
    { key: 'emp', header: 'Employee', sortValue: (s) => s.employee_name, render: (s) => <span><span className="block font-medium text-text">{s.employee_name}</span><span className="block text-xs text-text-muted">{s.employee_code} · {s.department}</span></span> },
    { key: 'basic', header: 'Basic', align: 'right', sortValue: (s) => s.earnings.basic, render: (s) => <span className="tabular-nums">{money(s.earnings.basic)}</span> },
    { key: 'gross', header: 'Gross', align: 'right', sortValue: (s) => s.earnings.gross_earnings, render: (s) => <span className="tabular-nums">{money(s.earnings.gross_earnings)}</span> },
    { key: 'pf', header: 'PF', align: 'right', render: (s) => <span className="tabular-nums text-text-secondary">{money(s.deductions.pf)}</span> },
    { key: 'pt', header: 'PT', align: 'right', render: (s) => <span className="tabular-nums text-text-secondary">{money(s.deductions.pt)}</span> },
    { key: 'net', header: 'Net payout', align: 'right', sortValue: (s) => s.net_salary, render: (s) => <span className="font-semibold tabular-nums text-text">{money(s.net_salary)}</span> },
    {
      key: 'actions', header: <span className="sr-only">Actions</span>, align: 'right',
      render: (s) => (
        <span onClick={(e) => e.stopPropagation()}>
          <Dropdown label={`Actions for ${s.slip_number}`} width="w-48" triggerClassName="h-8 w-8 justify-center text-text-muted hover:bg-neutral-bg hover:text-text" trigger={<MoreHorizontal size={16} />}>
            <DropdownItem icon={<Printer size={15} />} onClick={() => onPreview(s.id)}>View & print</DropdownItem>
            {can('hr.payroll.process') && <DropdownItem icon={<Trash2 size={15} />} tone="danger" onClick={() => remove(s)}>Delete</DropdownItem>}
          </Dropdown>
        </span>
      ),
    },
  ];

  const sm = summary.data;
  return (
    <>
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatCard icon={Receipt} label="Payslips" value={sm?.total_slips ?? '—'} />
        <StatCard icon={Banknote} tone="info" label="Gross disbursed" value={sm ? money(sm.total_gross_disbursed) : '—'} />
        <StatCard icon={ShieldCheck} tone="warning" label="PF deducted" value={sm ? money(sm.total_pf_deducted) : '—'} />
        <StatCard icon={Landmark} tone="warning" label="PT deducted" value={sm ? money(sm.total_pt_deducted) : '—'} />
        <StatCard icon={Banknote} tone="success" label="Net payout" value={sm ? money(sm.total_net_disbursed) : '—'} />
      </div>
      <Card>
        <Toolbar count={slips.data ? `${rows.length} payslips` : undefined}>
          <Select aria-label="Month" value={month} onChange={(e) => setMonth(e.target.value as typeof month)} selectClassName="w-36">{MONTHS.map((m) => <option key={m}>{m}</option>)}</Select>
          <Input aria-label="Year" type="number" min={2020} max={2100} value={year} onChange={(e) => setYear(Number(e.target.value) || currentYear())} inputClassName="w-24" />
          <SearchInput value={search} onChange={setSearch} placeholder="Search name, code, slip no." label="Search payslips" />
          <Button variant="secondary" size="sm" disabled={!rows.length} onClick={() => exportCsv(rows.map((s) => ({
            'Slip no.': s.slip_number, 'Employee code': s.employee_code, Employee: s.employee_name, Department: s.department, Designation: s.designation,
            Month: s.month, Year: s.year, Basic: s.earnings.basic, Gross: s.earnings.gross_earnings, PF: s.deductions.pf, PT: s.deductions.pt, Net: s.net_salary,
          })), `salary-register-${month}-${year}.csv`)}><Download size={14} /> Export CSV</Button>
        </Toolbar>
        {slips.status === 'error' ? <ErrorState onRetry={slips.reload} message={slips.error} /> : (
          <Table caption={`Salary register ${month} ${year}`} columns={columns} rows={rows} rowKey={(s) => s.id} loading={slips.loading} onRowClick={(s) => onPreview(s.id)}
            empty={<EmptyState compact icon={Receipt} title={`No payslips for ${month} ${year}`} description="Payslips appear here once payroll is processed or a slip is generated." />} />
        )}
      </Card>
    </>
  );
}

function Generator({ initialEmployee, onGenerated }: { initialEmployee: string | null; onGenerated: (id: string) => void }) {
  const { showToast } = useToast();
  const { employees, available } = useEmployeeOptions();
  const [v, setV] = useState({ employee_id: initialEmployee ?? '', month: currentMonth() as string, year: String(currentYear()), working_days: '30', paid_days: '30', lop_days: '0', bonus: '0', other_deductions: '0' });
  const [calc, setCalc] = useState<SalaryCalc | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setV((s) => ({ ...s, [k]: e.target.value }));
  const emp = employees.find((e) => e.id === v.employee_id);
  const inputs = useDebounced(v, 250);
  const [sales, setSales] = useState<SalesPayrollPreview | null>(null);

  // Sales staff: fill the days from their Start/End Day punches; the incentive is added by the server.
  useEffect(() => {
    if (!v.employee_id || Number(v.year) < 2000) return;
    let cancelled = false;
    salesPayrollPreview(v.employee_id, v.month, Number(v.year)).then((p) => {
      if (cancelled) return;
      setSales(p);
      const a = p.attendance;
      if (a) {
        const lop = a.absent_days + a.unpaid_leave_days + a.half_days * 0.5;
        setV((s) => ({ ...s, working_days: String(a.working_days), lop_days: String(lop), paid_days: String(a.working_days - lop) }));
      }
    }).catch(() => !cancelled && setSales(null));
    return () => { cancelled = true; };
  }, [v.employee_id, v.month, v.year]);

  useEffect(() => {
    if (!emp) {
      setCalc(null);
      return;
    }
    let cancelled = false;
    calculateSalary({
      base_salary: emp.base_salary, hra: emp.hra, conveyance_allowance: emp.conveyance_allowance, special_allowance: emp.special_allowance,
      pf_opted: emp.pf_opted, professional_tax: emp.professional_tax || 200, bonus: (Number(inputs.bonus) || 0) + (sales?.incentive?.incentive ?? 0),
      other_deductions: Number(inputs.other_deductions) || 0, working_days: Number(inputs.working_days) || 30, lop_days: Number(inputs.lop_days) || 0,
    }).then((c) => !cancelled && setCalc(c)).catch(() => !cancelled && setCalc(null));
    return () => { cancelled = true; };
  }, [emp, inputs, sales]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!v.employee_id) return setError('Choose an employee.');
    if (Number(v.paid_days) + Number(v.lop_days) > Number(v.working_days)) return setError('Paid days plus LOP days cannot exceed working days.');
    setError('');
    setSaving(true);
    try {
      const slip = await generateSlip({
        employee_id: v.employee_id, month: v.month, year: Number(v.year), working_days: Number(v.working_days) || 30,
        paid_days: Number(v.paid_days) || 0, lop_days: Number(v.lop_days) || 0, bonus: Number(v.bonus) || 0, other_deductions: Number(v.other_deductions) || 0,
      });
      showToast(`Payslip ${slip.slip_number} generated`, 'success');
      onGenerated(slip.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not generate the payslip');
    } finally {
      setSaving(false);
    }
  };

  if (!available) return <Card><EmptyState icon={FileText} title="Employee directory access needed" description="Generating a payslip requires permission to view employees." /></Card>;

  return (
    <form onSubmit={submit} noValidate className="grid gap-4 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardHeader title="Payslip details" description="Salary components come from the employee's structure." />
        <div className="grid gap-4 p-4 sm:grid-cols-2">
          <Select label="Employee" required value={v.employee_id} onChange={set('employee_id')} className="sm:col-span-2">
            <option value="">Choose an employee…</option><EmployeeOptionList />
          </Select>
          <Select label="Month" value={v.month} onChange={set('month')}>{MONTHS.map((m) => <option key={m}>{m}</option>)}</Select>
          <Input label="Year" type="number" min={2020} max={2100} value={v.year} onChange={set('year')} />
          <Input label="Working days" type="number" min={1} max={31} value={v.working_days} onChange={set('working_days')} />
          <Input label="Paid days" type="number" min={0} max={31} value={v.paid_days} onChange={set('paid_days')} />
          <Input label="Loss-of-pay days" type="number" min={0} max={31} value={v.lop_days} onChange={set('lop_days')} />
          <Input label="Bonus / incentive (₹)" type="number" min={0} value={v.bonus} onChange={set('bonus')} />
          <Input label="Other deductions (₹)" type="number" min={0} value={v.other_deductions} onChange={set('other_deductions')} />
        </div>
      </Card>
      <div className="space-y-4">
        {sales?.is_sales && v.employee_id && (
          <Card>
            <CardHeader title="Sales attendance & incentive" description="From Start/End Day and client collections" />
            <dl className="divide-y divide-border text-sm">
              {sales.attendance && ([['Full days', sales.attendance.full_days], ['Half days', sales.attendance.half_days], ['Absent', sales.attendance.absent_days],
                ['Leave (paid / unpaid)', `${sales.attendance.paid_leave_days} / ${sales.attendance.unpaid_leave_days}`], ['Late marks', sales.attendance.late_count]] as const).map(([k, n]) => (
                <div key={k} className="flex justify-between px-4 py-2"><dt className="text-text-muted">{k}</dt><dd className="tabular-nums text-text">{n}</dd></div>
              ))}
              {sales.incentive && (
                <>
                  <div className="flex justify-between px-4 py-2"><dt className="text-text-muted">Collected this month</dt><dd className="tabular-nums text-text">{money(sales.incentive.collection)}</dd></div>
                  <div className="flex justify-between px-4 py-2"><dt className="text-text-muted">Target (salary ×4)</dt><dd className="tabular-nums text-text">{money(sales.incentive.target_amount)}</dd></div>
                  <div className="flex justify-between px-4 py-2 font-medium"><dt className="text-text">Sales incentive</dt><dd className="tabular-nums text-success">{money(sales.incentive.incentive)}</dd></div>
                </>
              )}
            </dl>
            {sales.incentive && <p className="px-4 py-3 text-xs text-text-muted">{sales.incentive.note}</p>}
          </Card>
        )}
        <Card className="lg:sticky lg:top-20">
          <CardHeader title="Calculation" description={emp ? emp.full_name : 'Choose an employee to preview'} />
          {emp ? (
            <dl className="divide-y divide-border text-sm">
              {([['Basic', emp.base_salary], ['HRA', emp.hra], ['Conveyance', emp.conveyance_allowance], ['Special allowance', emp.special_allowance]] as const).map(([k, n]) => (
                <div key={k} className="flex justify-between px-4 py-2"><dt className="text-text-muted">{k}</dt><dd className="tabular-nums text-text">{money(n)}</dd></div>
              ))}
              <div className="flex justify-between px-4 py-2 font-medium"><dt className="text-text">Gross</dt><dd className="tabular-nums text-text">{calc ? money(calc.gross_salary) : '—'}</dd></div>
              <div className="flex justify-between px-4 py-2"><dt className="text-text-muted">PF</dt><dd className="tabular-nums text-text">{calc ? `− ${money(calc.deductions.pf)}` : '—'}</dd></div>
              <div className="flex justify-between px-4 py-2"><dt className="text-text-muted">Professional tax</dt><dd className="tabular-nums text-text">{calc ? `− ${money(calc.deductions.pt)}` : '—'}</dd></div>
              <div className="flex justify-between px-4 py-2"><dt className="text-text-muted">LOP deduction</dt><dd className="tabular-nums text-text">{calc ? `− ${money(calc.deductions.lop_deduction)}` : '—'}</dd></div>
              <div className="bg-surface-secondary px-4 py-3">
                <div className="flex justify-between"><dt className="font-medium text-text">Net payable</dt><dd className="text-lg font-semibold tabular-nums text-success">{calc ? money(calc.net_salary) : '—'}</dd></div>
                {calc && <p className="mt-0.5 text-xs text-text-muted">{calc.net_salary_words}</p>}
              </div>
            </dl>
          ) : <p className="px-4 py-8 text-center text-sm text-text-muted">No employee selected.</p>}
        </Card>
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
        <Button type="submit" loading={saving} className="w-full justify-center"><FileText size={15} /> Generate payslip</Button>
      </div>
    </form>
  );
}

export function Payslips() {
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const [previewId, setPreviewId] = useState<string | null>(null);
  const tab = params.get('tab') === 'generate' && can('hr.payroll.process') ? 'generate' : 'register';
  const tabs = [{ id: 'register', label: 'Salary register' }, ...(can('hr.payroll.process') ? [{ id: 'generate', label: 'Generate payslip' }] : [])];

  return (
    <>
      <PageHeader title="Payslips" description="Monthly salary register and individual payslip generation." breadcrumbs={[{ label: 'HR' }, { label: 'Payslips' }]} />
      {tabs.length > 1 && <Tabs tabs={tabs} active={tab} onChange={(id) => setParams({ tab: id }, { replace: true })} className="mb-4" />}
      {tab === 'register'
        ? <Register onPreview={setPreviewId} />
        : <Generator initialEmployee={params.get('emp')} onGenerated={setPreviewId} />}
      <PayslipPreview id={previewId} onClose={() => setPreviewId(null)} />
    </>
  );
}
