import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Banknote } from 'lucide-react';
import { useApi } from '../../lib/useApi';
import { money } from '../../lib/format';
import { StatusBadge } from '../../components/common/Badge';
import { Card } from '../../components/common/Card';
import { EmptyState } from '../../components/common/EmptyState';
import { ErrorState } from '../../components/common/ErrorState';
import { Modal } from '../../components/common/Modal';
import { Table, type Column } from '../../components/common/Table';
import { ExportMenu, Toolbar } from '../components';
import { getPfPayroll, type PfPayrollRow } from './api';
import { PfStatusBadge } from './components';
import { pct, pfMoney } from './format';
import { PfFilterBar } from './filters';
import { defaultFilters, filterParams } from './format';

function PreviewModal({ row, onClose }: { row: PfPayrollRow | null; onClose: () => void }) {
  const r = row;
  const items: [string, string][] = r ? [
    ['Employee name', r.employee_name], ['Basic salary', money(r.basic_salary)],
    ['Minimum PF wage', r.minimum_pf_wage === null ? '—' : money(r.minimum_pf_wage)], ['Maximum PF wage', r.maximum_pf_wage === null ? '—' : money(r.maximum_pf_wage)],
    ['Calculated PF wage', money(r.pf_wage)],
    ['Employee PF %', pct(r.employee_pf_percent)], ['Employee PF amount', pfMoney(r.employee_pf)],
    ['Employer PF %', pct(r.employer_pf_percent)], ['Employer PF amount', pfMoney(r.employer_pf)],
    ['EPS %', pct(r.eps_percent)], ['EPS amount', pfMoney(r.eps)], ['Employer EPF amount', pfMoney(r.employer_epf)],
    ['PF rule', r.rule_name || '—'],
  ] : [];
  return (
    <Modal open={!!r} onClose={onClose} title="PF calculation preview" description={r?.payroll_id ? 'As calculated on the payroll record.' : 'Payroll not calculated yet: what PF will be with today\'s salary and PF details.'}>
      {r && (
        <>
          <div className="mb-3 flex items-center gap-2"><PfStatusBadge status={r.pf_status} /><span className="text-sm text-text-muted">{r.reason}</span></div>
          <dl className="divide-y divide-border rounded-md border border-border text-sm">
            {items.map(([k, v]) => <div key={k} className="flex justify-between gap-3 px-3 py-2"><dt className="text-text-muted">{k}</dt><dd className="tabular-nums text-text">{v}</dd></div>)}
          </dl>
          {r.issues.length > 0 && <ul className="mt-3 space-y-1 text-xs">{r.issues.map((i) => <li key={i.code} className={i.blocking ? 'text-danger' : 'text-warning'}>{i.message}</li>)}</ul>}
        </>
      )}
    </Modal>
  );
}

/** PF on the month's payroll: the figures each payroll record stored, or a preview where payroll hasn't run yet. */
export function PfPayrollTab() {
  const [f, setF] = useState(defaultFilters);
  const [preview, setPreview] = useState<PfPayrollRow | null>(null);
  const p = filterParams(f);
  const list = useApi(() => getPfPayroll({ month: f.month, year: f.year, department: p.department }), [f.month, f.year, f.department]);
  const rows = list.data?.rows ?? [];
  const blocked = rows.filter((r) => r.blocking).length;

  const columns: Column<PfPayrollRow>[] = [
    { key: 'name', header: 'Employee', render: (r) => <span><span className="font-medium text-text">{r.employee_name}</span> <span className="text-xs text-text-muted">{r.employee_code}</span></span>, sortValue: (r) => r.employee_name },
    { key: 'basic', header: 'Basic salary', align: 'right', render: (r) => money(r.basic_salary), sortValue: (r) => r.basic_salary },
    { key: 'wage', header: 'PF wage', align: 'right', render: (r) => money(r.pf_wage), sortValue: (r) => r.pf_wage },
    { key: 'emp', header: 'Employee PF', align: 'right', render: (r) => pfMoney(r.employee_pf), sortValue: (r) => r.employee_pf },
    { key: 'er', header: 'Employer PF', align: 'right', render: (r) => pfMoney(r.employer_pf), sortValue: (r) => r.employer_pf },
    { key: 'eps', header: 'EPS', align: 'right', render: (r) => pfMoney(r.eps), sortValue: (r) => r.eps },
    { key: 'epf', header: 'Employer EPF', align: 'right', render: (r) => pfMoney(r.employer_epf), sortValue: (r) => r.employer_epf },
    { key: 'net', header: 'Net salary', align: 'right', render: (r) => (r.net_salary === null ? <span className="text-xs text-text-muted">Not calculated</span> : money(r.net_salary)), sortValue: (r) => r.net_salary ?? -1 },
    { key: 'payroll', header: 'Payroll', render: (r) => (r.payroll_id ? <StatusBadge status={r.payroll_status} /> : <span className="text-xs text-text-muted">Preview</span>) },
    { key: 'pf', header: 'PF', render: (r) => (r.legacy ? <span className="text-xs text-text-muted">Before PF rules</span> : <PfStatusBadge status={r.pf_status} />), sortValue: (r) => r.pf_status ?? '' },
  ];

  return (
    <>
      {blocked > 0 && (
        <Card className="mb-4 border-danger/40 p-4 text-sm">
          <p className="font-medium text-danger">{blocked} employee(s) can't have payroll finalized yet</p>
          <p className="text-text-secondary">Their PF information is incomplete. Open a row to see why, then fix it under <Link className="text-primary hover:underline" to="/hr/pf?tab=employees">Employee PF details</Link> (or mark the employee PF-exempt with a reason) and recalculate.</p>
        </Card>
      )}
      <Card>
        <Toolbar count={list.data ? `${rows.length} employees` : undefined}>
          <PfFilterBar value={f} onChange={setF} show={{ month: true, year: true, department: true }} />
          <ExportMenu filename={`pf-payroll-${f.month}-${f.year}`} sheet="PF payroll" fetchRows={async () => rows.map((r) => ({
            Employee: r.employee_name, 'Employee ID': r.employee_code, Department: r.department, 'Basic salary': r.basic_salary,
            'Minimum PF wage': r.minimum_pf_wage, 'Maximum PF wage': r.maximum_pf_wage, 'PF wage': r.pf_wage,
            'Employee PF %': r.employee_pf_percent, 'Employee PF': r.employee_pf, 'Employer PF %': r.employer_pf_percent, 'Employer PF': r.employer_pf,
            'EPS %': r.eps_percent, EPS: r.eps, 'Employer EPF': r.employer_epf, 'Net salary': r.net_salary, 'Payroll status': r.payroll_status, 'PF status': r.pf_status, 'PF rule': r.rule_name,
          }))} />
        </Toolbar>
        {list.status === 'error' ? <ErrorState onRetry={list.reload} message={list.error} /> : (
          <Table columns={columns} rows={rows} rowKey={(r) => r.employee_id} loading={list.loading} onRowClick={setPreview} caption="PF payroll"
            empty={<EmptyState compact icon={Banknote} title="No employees" description="No active employees match these filters." />} />
        )}
        <p className="border-t border-border px-4 py-2 text-xs text-text-muted">PF is calculated on the PF wage (the basic held between the rule's minimum and maximum PF wage), not on the basic itself. Open a row for the full calculation.</p>
      </Card>
      <PreviewModal row={preview} onClose={() => setPreview(null)} />
    </>
  );
}
