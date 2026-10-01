import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { FileBarChart } from 'lucide-react';
import { useApi } from '../../lib/useApi';
import { money, number } from '../../lib/format';
import { Card, CardHeader } from '../../components/common/Card';
import { EmptyState } from '../../components/common/EmptyState';
import { ErrorState } from '../../components/common/ErrorState';
import { Checkbox, Input, Select } from '../../components/common/Input';
import { Table, type Column } from '../../components/common/Table';
import { BRANCHES, DEPARTMENTS } from '../api';
import { EmployeeOptionList } from '../HrSection';
import { ExportMenu, Toolbar } from '../components';
import { getPfConfig, getPfReport, type PfReportKind } from './api';
import { pfMoney } from './format';

type Row = Record<string, unknown>;
const thisMonth = () => new Date().toLocaleDateString('en-CA').slice(0, 7);

const KINDS: { id: PfReportKind; label: string; description: string }[] = [
  { id: 'monthly', label: 'Monthly PF report', description: 'Each employee\'s PF as payroll calculated it.' },
  { id: 'department', label: 'Department-wise PF report', description: 'PF contribution grouped by department.' },
  { id: 'history', label: 'Employee PF history', description: 'One employee\'s PF month by month.' },
  { id: 'impact', label: 'PF rule impact report', description: 'Employees whose PF changes under a rule, against the rule before it.' },
  { id: 'exceptions', label: 'PF exception report', description: 'Missing UAN / Member ID / PF details, calculation errors, invalid configuration and exempt employees.' },
];

const m = (k: string) => (r: Row) => pfMoney(r[k]);
const num = (k: string) => (r: Row) => Number(r[k] ?? 0);
const txt = (k: string) => (r: Row) => String(r[k] ?? '');

const COLUMNS: Record<PfReportKind, [string, string, (r: Row) => React.ReactNode, ((r: Row) => string | number)?][]> = {
  monthly: [
    ['period', 'Month', (r) => `${r.month} ${r.year}`, txt('calculation_date')], ['employee_name', 'Employee', txt('employee_name'), txt('employee_name')],
    ['department', 'Department', txt('department'), txt('department')], ['basic_salary', 'Basic salary', (r) => money(r.basic_salary), num('basic_salary')],
    ['pf_wage', 'PF wage', (r) => money(r.pf_wage), num('pf_wage')], ['employee_pf', 'Employee PF', m('employee_pf'), num('employee_pf')],
    ['employer_pf', 'Employer PF', m('employer_pf'), num('employer_pf')], ['eps', 'EPS', m('eps'), num('eps')],
    ['employer_epf', 'Employer EPF', m('employer_epf'), num('employer_epf')], ['total_contribution', 'Total PF', m('total_contribution'), num('total_contribution')],
    ['finalized', 'Payroll', (r) => (r.finalized ? 'Finalized' : 'Open'), (r) => (r.finalized ? 1 : 0)],
  ],
  department: [
    ['department', 'Department', txt('department'), txt('department')], ['employees', 'Employees', (r) => number(r.employees), num('employees')],
    ['pf_wage', 'PF wage', (r) => money(r.pf_wage), num('pf_wage')], ['employee_pf', 'Employee PF', m('employee_pf'), num('employee_pf')],
    ['employer_pf', 'Employer PF', m('employer_pf'), num('employer_pf')], ['eps', 'EPS', m('eps'), num('eps')],
    ['employer_epf', 'Employer EPF', m('employer_epf'), num('employer_epf')], ['total_contribution', 'Total PF', m('total_contribution'), num('total_contribution')],
  ],
  history: [
    ['period', 'Month', (r) => `${r.month} ${r.year}`, txt('calculation_date')], ['pf_rule_name', 'PF rule', txt('pf_rule_name')],
    ['basic_salary', 'Basic salary', (r) => money(r.basic_salary), num('basic_salary')], ['pf_wage', 'PF wage', (r) => money(r.pf_wage), num('pf_wage')],
    ['employee_pf', 'Employee PF', m('employee_pf'), num('employee_pf')], ['employer_pf', 'Employer PF', m('employer_pf'), num('employer_pf')],
    ['eps', 'EPS', m('eps'), num('eps')], ['employer_epf', 'Employer EPF', m('employer_epf'), num('employer_epf')],
    ['status', 'PF status', txt('status')], ['finalized', 'Payroll', (r) => (r.finalized ? 'Finalized' : 'Open')],
  ],
  impact: [
    ['employee_name', 'Employee', txt('employee_name'), txt('employee_name')], ['department', 'Department', txt('department'), txt('department')],
    ['basic_salary', 'Basic salary', (r) => money(r.basic_salary), num('basic_salary')],
    ['previous_pf_wage', 'PF wage before', (r) => money(r.previous_pf_wage), num('previous_pf_wage')], ['new_pf_wage', 'PF wage after', (r) => money(r.new_pf_wage), num('new_pf_wage')],
    ['previous_employee_pf', 'Employee PF before', m('previous_employee_pf'), num('previous_employee_pf')], ['new_employee_pf', 'Employee PF after', m('new_employee_pf'), num('new_employee_pf')],
    ['new_employer_pf', 'Employer PF after', m('new_employer_pf'), num('new_employer_pf')], ['difference_employee_pf', 'Change', m('difference_employee_pf'), num('difference_employee_pf')],
  ],
  exceptions: [
    ['exception', 'Exception', (r) => String(r.exception).replace(/_/g, ' ').toLowerCase(), txt('exception')], ['employee_name', 'Employee', txt('employee_name'), txt('employee_name')],
    ['employee_code', 'Employee ID', txt('employee_code'), txt('employee_code')], ['department', 'Department', txt('department'), txt('department')],
    ['message', 'Detail', txt('message')], ['period', 'Period', txt('period')],
  ],
};

export function PfReportsTab() {
  const [params] = useSearchParams();
  const [kind, setKind] = useState<PfReportKind>((KINDS.find((k) => k.id === params.get('kind'))?.id) ?? 'monthly');
  const [start, setStart] = useState(thisMonth());
  const [end, setEnd] = useState(thisMonth());
  const [department, setDepartment] = useState('all');
  const [branch, setBranch] = useState('all');
  const [employee, setEmployee] = useState('');
  const [ruleId, setRuleId] = useState(params.get('rule') ?? '');
  const [finalizedOnly, setFinalizedOnly] = useState(false);
  const rules = useApi(getPfConfig, [], kind === 'impact');
  const needsEmployee = kind === 'history' && !employee;
  const report = useApi(() => getPfReport({
    kind, start: kind === 'impact' ? undefined : start, end: kind === 'impact' ? undefined : end,
    department: department === 'all' ? undefined : department, branch: branch === 'all' ? undefined : branch,
    employee_id: employee || undefined, rule_id: ruleId || undefined, finalized_only: finalizedOnly || undefined,
  }), [kind, start, end, department, branch, employee, ruleId, finalizedOnly], !needsEmployee);

  const columns: Column<Row>[] = useMemo(() => COLUMNS[kind].map(([key, header, render, sortValue]) => ({
    key, header, render, sortValue, align: ['period', 'employee_name', 'department', 'exception', 'message', 'employee_code', 'pf_rule_name', 'status', 'finalized'].includes(key) ? 'left' : 'right',
  })), [kind]);
  const rows = report.data?.rows ?? [];
  const info = KINDS.find((k) => k.id === kind)!;
  const exportRows = () => rows.map((r) => Object.fromEntries(COLUMNS[kind].map(([key, header]) => {
    const v = key === 'period' ? `${r.month ?? ''} ${r.year ?? ''}`.trim() || r.period : key === 'finalized' ? (r.finalized ? 'Finalized' : 'Open') : r[key];
    return [header, v as unknown];
  })));

  return (
    <Card>
      <CardHeader title={info.label} description={info.description} />
      <Toolbar count={report.data && !needsEmployee ? `${rows.length} rows` : undefined}>
        <Select aria-label="Report" value={kind} onChange={(e) => setKind(e.target.value as PfReportKind)} selectClassName="w-60">
          {KINDS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
        </Select>
        {kind !== 'impact' && (
          <>
            <Input aria-label="From month" type="month" value={start} onChange={(e) => setStart(e.target.value)} inputClassName="w-40" />
            <Input aria-label="To month" type="month" value={end} onChange={(e) => setEnd(e.target.value)} inputClassName="w-40" />
          </>
        )}
        {kind === 'impact' && (
          <Select aria-label="PF rule" value={ruleId} onChange={(e) => setRuleId(e.target.value)} selectClassName="w-60">
            <option value="">Rule in force today</option>
            {(rules.data?.rules ?? []).map((r) => <option key={r.id} value={r.id}>{r.rule_name} (from {r.effective_from})</option>)}
          </Select>
        )}
        <Select aria-label="Department" value={department} onChange={(e) => setDepartment(e.target.value)} selectClassName="w-36">
          <option value="all">All departments</option>{DEPARTMENTS.map((d) => <option key={d}>{d}</option>)}
        </Select>
        {kind !== 'impact' && (
          <Select aria-label="Branch" value={branch} onChange={(e) => setBranch(e.target.value)} selectClassName="w-32">
            <option value="all">All branches</option>{BRANCHES.map((b) => <option key={b}>{b}</option>)}
          </Select>
        )}
        {(kind === 'history' || kind === 'monthly' || kind === 'exceptions') && (
          <Select aria-label="Employee" value={employee} onChange={(e) => setEmployee(e.target.value)} selectClassName="w-52">
            <option value="">{kind === 'history' ? 'Choose an employee' : 'All employees'}</option><EmployeeOptionList />
          </Select>
        )}
        {(kind === 'monthly' || kind === 'department' || kind === 'history') && <Checkbox label="Finalized payroll only" checked={finalizedOnly} onChange={(e) => setFinalizedOnly(e.target.checked)} />}
        <ExportMenu fetchRows={async () => exportRows()} filename={`pf-${kind}-report`} sheet={info.label.slice(0, 30)} />
      </Toolbar>
      {needsEmployee ? <EmptyState compact icon={FileBarChart} title="Choose an employee" description="The PF history report covers one employee." /> :
        report.status === 'error' ? <ErrorState onRetry={report.reload} message={report.error} /> : (
          <Table columns={columns} rows={rows} rowKey={(r) => String(r.id ?? `${r.employee_id}-${r.exception ?? ''}-${r.department ?? ''}-${r.calculation_date ?? ''}-${r.message ?? ''}`)}
            loading={report.loading} caption={info.label}
            empty={<EmptyState compact icon={FileBarChart} title="Nothing to report" description={kind === 'exceptions' ? 'No PF exceptions.' : 'No PF figures for these filters. Monthly reports cover payroll that has been calculated.'} />} />
        )}
      {report.data && Object.keys(report.data.totals).length > 0 && !needsEmployee && (
        <dl className="flex flex-wrap gap-x-6 gap-y-1 border-t border-border px-4 py-3 text-xs">
          {Object.entries(report.data.totals).map(([k, v]) => (
            <div key={k} className="flex gap-1.5"><dt className="text-text-muted">{k.replace(/_/g, ' ')}</dt><dd className="font-medium tabular-nums text-text">{kind === 'exceptions' || k === 'employees' ? number(v) : pfMoney(v)}</dd></div>
          ))}
        </dl>
      )}
    </Card>
  );
}
