import { useState } from 'react';
import { ScrollText } from 'lucide-react';
import { useApi } from '../../lib/useApi';
import { dateTime } from '../../lib/format';
import { Card, CardHeader } from '../../components/common/Card';
import { EmptyState } from '../../components/common/EmptyState';
import { ErrorState } from '../../components/common/ErrorState';
import { Input, Select } from '../../components/common/Input';
import { Table, type Column } from '../../components/common/Table';
import { EmployeeOptionList } from '../HrSection';
import { ExportMenu, Toolbar } from '../components';
import { getPfAudit, type PfAuditRow } from './api';

const ENTITIES: [string, string][] = [
  ['', 'Everything'], ['employee_pf_details', 'Employee PF details'], ['pf_calculation', 'PF calculation'], ['salary', 'Salary'],
  ['pf_rule', 'PF rules'], ['pf_settings', 'PF settings'],
];
const show = (v: unknown) => (v === null || v === undefined || v === '' ? '—' : typeof v === 'boolean' ? (v ? 'Yes' : 'No')
  : typeof v === 'number' ? v.toLocaleString('en-IN', { minimumFractionDigits: Number.isInteger(v) ? 0 : 2, maximumFractionDigits: 2 }) : String(v));

/** The PF audit trail. Read-only: there is no edit or delete anywhere in the app or the API. */
export function PfAuditTab() {
  const [employee, setEmployee] = useState('');
  const [entity, setEntity] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const logs = useApi(() => getPfAudit({ employee_id: employee || undefined, entity: entity || undefined, start: start || undefined, end: end || undefined }), [employee, entity, start, end]);
  const rows = logs.data?.rows ?? [];

  const columns: Column<PfAuditRow>[] = [
    { key: 'when', header: 'Date / time', render: (r) => <span className="whitespace-nowrap text-xs">{dateTime(r.created_at)}</span>, sortValue: (r) => r.created_at },
    { key: 'employee', header: 'Employee', render: (r) => (r.employee_name ? <span>{r.employee_name} <span className="text-xs text-text-muted">{r.employee_code}</span></span> : <span className="text-text-muted">{r.entity === 'pf_rule' ? 'PF rule' : 'PF settings'}</span>), sortValue: (r) => r.employee_name },
    { key: 'field', header: 'Field', render: (r) => r.field_name, sortValue: (r) => r.field_name },
    { key: 'old', header: 'Previous value', render: (r) => <span className="break-all">{show(r.old_value)}</span> },
    { key: 'new', header: 'New value', render: (r) => <span className="break-all">{show(r.new_value)}</span> },
    { key: 'by', header: 'Changed by', render: (r) => <span className="text-xs">{r.changed_by_name || r.changed_by}<br /><span className="text-text-muted">{r.changed_by_role}</span></span>, sortValue: (r) => r.changed_by },
    { key: 'reason', header: 'Reason', render: (r) => r.reason || '—' },
    { key: 'ip', header: 'IP address', render: (r) => <span className="font-mono text-xs">{r.ip_address || '—'}</span> },
  ];

  return (
    <Card>
      <CardHeader title="PF audit log" description="Every PF-related change, one row per field. Entries can't be edited or deleted." />
      <Toolbar count={logs.data ? `${rows.length} changes` : undefined}>
        <Select aria-label="Employee" value={employee} onChange={(e) => setEmployee(e.target.value)} selectClassName="w-52">
          <option value="">All employees</option><EmployeeOptionList />
        </Select>
        <Select aria-label="Area" value={entity} onChange={(e) => setEntity(e.target.value)} selectClassName="w-48">
          {ENTITIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </Select>
        <Input aria-label="From date" type="date" value={start} onChange={(e) => setStart(e.target.value)} inputClassName="w-40" />
        <Input aria-label="To date" type="date" value={end} onChange={(e) => setEnd(e.target.value)} inputClassName="w-40" />
        <ExportMenu filename="pf-audit-log" sheet="PF audit log" fetchRows={async () => rows.map((r) => ({
          'Date/time': r.created_at, Employee: r.employee_name, 'Employee ID': r.employee_code, Area: r.entity, Field: r.field_name,
          'Previous value': show(r.old_value), 'New value': show(r.new_value), 'Changed by': r.changed_by, Role: r.changed_by_role, Reason: r.reason, 'IP address': r.ip_address,
        }))} />
      </Toolbar>
      {logs.status === 'error' ? <ErrorState onRetry={logs.reload} message={logs.error} /> : (
        <Table columns={columns} rows={rows} rowKey={(r) => r.id} loading={logs.loading} caption="PF audit log"
          empty={<EmptyState compact icon={ScrollText} title="No PF changes" description="Changes to PF details, rules, settings and salaries that move PF appear here." />} />
      )}
    </Card>
  );
}
