import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Users } from 'lucide-react';
import { useApi, useDebounced } from '../../lib/useApi';
import { money } from '../../lib/format';
import { Card } from '../../components/common/Card';
import { EmptyState } from '../../components/common/EmptyState';
import { ErrorState } from '../../components/common/ErrorState';
import { SearchInput } from '../../components/common/Input';
import { Drawer } from '../../components/common/Modal';
import { Table, type Column } from '../../components/common/Table';
import { ExportMenu, Toolbar } from '../components';
import { getPfEmployees, type PfEmployeeRow } from './api';
import { EmployeePfCard, PfStatusBadge } from './components';
import { pfMoney } from './format';
import { PfFilterBar } from './filters';
import { defaultFilters, filterParams } from './format';

const pfExportRow = (r: PfEmployeeRow) => ({
  'Employee ID': r.employee_code, 'Employee name': r.employee_name, Department: r.department, Branch: r.branch,
  'Basic salary': r.basic_salary, 'PF wage': r.pf_wage, 'PF applicable': r.pf_applicable ? 'Yes' : 'No', 'EPS applicable': r.eps_applicable ? 'Yes' : 'No',
  'Employee PF': r.employee_pf, 'Employer PF': r.employer_pf, EPS: r.eps, 'Employer EPF': r.employer_epf,
  UAN: r.uan, 'PF Member ID': r.pf_member_id, 'PF status': r.pf_status, Note: r.reason, Source: r.source === 'payroll' ? 'Payroll' : 'Projected',
});

export function PfEmployeesTab() {
  const [params, setParams] = useSearchParams();
  const [f, setF] = useState(defaultFilters);
  const [search, setSearch] = useState('');
  const q = useDebounced(search).trim().toLowerCase();
  const list = useApi(() => getPfEmployees(filterParams(f)), [f]);
  const open = params.get('employee');
  const setOpen = (id: string | null) => setParams((p) => { const n = new URLSearchParams(p); if (id) n.set('employee', id); else n.delete('employee'); return n; }, { replace: true });

  const rows = useMemo(() => (list.data?.rows ?? []).filter((r) => !q ||
    [r.employee_name, r.employee_code, r.uan, r.pf_member_id, r.department].some((v) => String(v ?? '').toLowerCase().includes(q))), [list.data, q]);

  const columns: Column<PfEmployeeRow>[] = [
    { key: 'code', header: 'Employee ID', render: (r) => <span className="font-mono text-xs">{r.employee_code}</span>, sortValue: (r) => r.employee_code },
    { key: 'name', header: 'Employee name', render: (r) => <span className="font-medium text-text">{r.employee_name}</span>, sortValue: (r) => r.employee_name },
    { key: 'dept', header: 'Department', render: (r) => r.department, sortValue: (r) => r.department },
    { key: 'basic', header: 'Basic salary', align: 'right', render: (r) => money(r.basic_salary), sortValue: (r) => r.basic_salary },
    { key: 'wage', header: 'PF wage', align: 'right', render: (r) => <span title={r.wage_limited_by ? `Basic ${r.wage_limited_by === 'maximum' ? 'above the maximum' : 'below the minimum'} PF wage` : undefined}>{money(r.pf_wage)}{r.wage_limited_by && <sup className="ml-0.5 text-primary">*</sup>}</span>, sortValue: (r) => r.pf_wage },
    { key: 'applicable', header: 'PF applicable', render: (r) => (r.pf_applicable ? 'Yes' : 'No'), sortValue: (r) => (r.pf_applicable ? 1 : 0) },
    { key: 'emp_pf', header: 'Employee PF', align: 'right', render: (r) => pfMoney(r.employee_pf), sortValue: (r) => r.employee_pf },
    { key: 'er_pf', header: 'Employer PF', align: 'right', render: (r) => pfMoney(r.employer_pf), sortValue: (r) => r.employer_pf },
    { key: 'eps', header: 'EPS', align: 'right', render: (r) => pfMoney(r.eps), sortValue: (r) => r.eps },
    { key: 'epf', header: 'Employer EPF', align: 'right', render: (r) => pfMoney(r.employer_epf), sortValue: (r) => r.employer_epf },
    { key: 'uan', header: 'UAN', render: (r) => (r.uan ? <span className="font-mono text-xs">{r.uan}</span> : <span className="text-xs text-warning">Missing</span>), sortValue: (r) => r.uan },
    { key: 'status', header: 'PF status', render: (r) => <PfStatusBadge status={r.pf_status} />, sortValue: (r) => r.pf_status },
  ];

  return (
    <>
      <Card>
        <Toolbar count={list.data ? `${rows.length} employees · ${f.month} ${f.year}` : undefined}>
          <SearchInput value={search} onChange={setSearch} placeholder="Search name, ID, UAN" label="Search employees" />
          <PfFilterBar value={f} onChange={setF} show={{ month: true, year: true, department: true, branch: true, pf_status: true, pf_applicable: true, eps_applicable: true }} />
          <ExportMenu fetchRows={async () => rows.map(pfExportRow)} filename={`pf-employees-${f.month}-${f.year}`} sheet="Employee PF" />
        </Toolbar>
        {list.status === 'error' ? <ErrorState onRetry={list.reload} message={list.error} /> : (
          <Table columns={columns} rows={rows} rowKey={(r) => r.employee_id} loading={list.loading} onRowClick={(r) => setOpen(r.employee_id)} caption="Employee PF details"
            empty={<EmptyState compact icon={Users} title="No employees match" description="Change the filters or search." />} />
        )}
        <p className="border-t border-border px-4 py-2 text-xs text-text-muted">* PF wage set by the rule's minimum or maximum, not the actual basic. Months with payroll show payroll's figures; others are projected.</p>
      </Card>
      <Drawer open={!!open} onClose={() => setOpen(null)} title="PF details">
        {open && <EmployeePfCard employeeId={open} compact />}
      </Drawer>
    </>
  );
}
