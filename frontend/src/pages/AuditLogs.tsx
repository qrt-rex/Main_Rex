import { useState } from 'react';
import { Download, ScrollText } from 'lucide-react';
import { api } from '../lib/api';
import { useApi, useDebounced } from '../lib/useApi';
import { dateTime, titleCase } from '../lib/format';
import { exportCsv } from '../lib/spreadsheet';
import { Badge, type BadgeTone } from '../components/common/Badge';
import { Button } from '../components/common/Button';
import { Card } from '../components/common/Card';
import { EmptyState } from '../components/common/EmptyState';
import { ErrorState } from '../components/common/ErrorState';
import { Input, SearchInput, Select } from '../components/common/Input';
import { Pagination, Table, type Column } from '../components/common/Table';
import { useToast } from '../components/common/ToastContext';
import { PageHeader } from '../components/layout/PageHeader';

interface Log {
  id: string;
  action: string;
  performed_by: string;
  performed_by_role?: string;
  target?: string;
  details?: Record<string, unknown>;
  ip_address?: string;
  timestamp: string;
}

const ACTIONS = [
  'LOGIN', 'LOGOUT', 'SESSION_TIMEOUT', 'PERMISSION_GRANT', 'PERMISSION_REVOKE', 'USER_CREATE', 'USER_UPDATE',
  'PAYROLL_INCREMENT', 'PAYROLL_DECREMENT', 'CANDIDATE_CREATE', 'CANDIDATE_STATUS_CHANGE',
  'EMPLOYEE_CREATE', 'EMPLOYEE_UPDATE', 'EMPLOYEE_DELETE',
];
const PAGE_SIZE = 30;

function tone(action: string): BadgeTone {
  if (action.includes('DELETE') || action.includes('REVOKE') || action === 'SESSION_TIMEOUT' || action.includes('DECREMENT')) return 'danger';
  if (action.includes('CREATE') || action.includes('GRANT') || action === 'LOGIN' || action.includes('INCREMENT')) return 'success';
  if (action.includes('UPDATE') || action.includes('CHANGE')) return 'warning';
  return 'neutral';
}

function describe(log: Log) {
  const d = log.details ?? {};
  if ((log.action === 'PAYROLL_INCREMENT' || log.action === 'PAYROLL_DECREMENT') && d.field) {
    return `${titleCase(String(d.field))}: ₹${Number(d.old_value || 0).toLocaleString('en-IN')} → ₹${Number(d.new_value || 0).toLocaleString('en-IN')}${d.reason ? ` · ${d.reason}` : ''}`;
  }
  if (typeof d.message === 'string') return d.message;
  return Object.entries(d).slice(0, 3).map(([k, v]) => `${titleCase(k)}: ${String(v)}`).join(' · ') || '—';
}

export function AuditLogs() {
  const { showToast } = useToast();
  const [page, setPage] = useState(1);
  const [action, setAction] = useState('');
  const [search, setSearch] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const q = useDebounced(search);

  const filters = { action: action || undefined, search: q || undefined, date_from: from ? `${from}T00:00:00` : undefined, date_to: to ? `${to}T23:59:59` : undefined };
  const logs = useApi(() => api.get<{ logs: Log[]; total: number }>('/api/logs', { ...filters, page, limit: PAGE_SIZE }), [page, action, q, from, to]);

  const resetPage = <T,>(fn: (v: T) => void) => (v: T) => { setPage(1); fn(v); };

  const exportLogs = async () => {
    try {
      const res = await api.get<{ logs: Log[] }>('/api/logs/export', filters);
      if (!res.logs.length) {
        showToast('No activity to export for these filters', 'info');
        return;
      }
      exportCsv(res.logs.map((l) => ({ Timestamp: l.timestamp, Action: l.action, 'Performed by': l.performed_by, Role: l.performed_by_role ?? '', Target: l.target ?? '', Details: describe(l), 'IP address': l.ip_address ?? '' })), `activity-log-${new Date().toISOString().slice(0, 10)}.csv`);
      showToast(`Exported ${res.logs.length} entries`, 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Export failed', 'error');
    }
  };

  const columns: Column<Log>[] = [
    { key: 'time', header: 'When', render: (l) => <span className="whitespace-nowrap text-text-muted">{dateTime(l.timestamp)}</span> },
    { key: 'action', header: 'Action', render: (l) => <Badge tone={tone(l.action)}>{titleCase(l.action)}</Badge> },
    { key: 'by', header: 'Performed by', render: (l) => <span><span className="block text-text">{l.performed_by || '—'}</span><span className="block text-xs text-text-muted">{l.performed_by_role}</span></span> },
    { key: 'target', header: 'Target', render: (l) => l.target || '—' },
    { key: 'details', header: 'Details', className: 'max-w-sm', render: (l) => <span className="line-clamp-2 text-text-secondary">{describe(l)}</span> },
    { key: 'ip', header: 'IP', render: (l) => <code className="text-xs text-text-muted">{l.ip_address || '—'}</code> },
  ];

  return (
    <>
      <PageHeader
        title="Activity log"
        description="Sign-ins, permission changes and record updates across the CRM."
        breadcrumbs={[{ label: 'Administration' }, { label: 'Activity log' }]}
        actions={<Button variant="secondary" onClick={exportLogs}><Download size={15} /> Export CSV</Button>}
      />
      <Card>
        <div className="flex flex-wrap items-end gap-2 border-b border-border p-3">
          <SearchInput value={search} onChange={resetPage(setSearch)} placeholder="Search performer, target or action" label="Search activity" />
          <Select aria-label="Filter by action" value={action} onChange={(e) => resetPage(setAction)(e.target.value)} selectClassName="w-48">
            <option value="">All actions</option>
            {ACTIONS.map((a) => <option key={a} value={a}>{titleCase(a)}</option>)}
          </Select>
          <Input aria-label="From date" type="date" value={from} onChange={(e) => resetPage(setFrom)(e.target.value)} inputClassName="w-40" />
          <Input aria-label="To date" type="date" value={to} onChange={(e) => resetPage(setTo)(e.target.value)} inputClassName="w-40" />
        </div>
        {logs.status === 'error' ? (
          <ErrorState onRetry={logs.reload} message={logs.error} />
        ) : (
          <>
            <Table caption="Activity log" columns={columns} rows={logs.data?.logs ?? []} rowKey={(l) => l.id} loading={logs.loading}
              empty={<EmptyState compact icon={ScrollText} title="No activity found" description="Adjust the filters or check back later." />} />
            {(logs.data?.total ?? 0) > PAGE_SIZE && <Pagination page={page} pageSize={PAGE_SIZE} total={logs.data!.total} onChange={setPage} noun="entries" />}
          </>
        )}
      </Card>
    </>
  );
}
