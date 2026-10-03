import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Banknote, CalendarClock, DatabaseBackup, Download, FileText, GraduationCap,
  Upload, UserPlus, UsersRound,
} from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';
import { useApi } from '../../lib/useApi';
import { dateTime, number } from '../../lib/format';
import { exportExcel, parseAllSheets } from '../../lib/spreadsheet';
import { saveBlob } from '../../lib/api';
import { exportAll, getDashboardMetrics, importAll } from '../api';
import { Card, CardHeader } from '../../components/common/Card';
import { StatusBadge } from '../../components/common/Badge';
import { useConfirm } from '../../components/common/ConfirmDialog';
import { Dropdown, DropdownItem } from '../../components/common/Dropdown';
import { ErrorState } from '../../components/common/ErrorState';
import { PageSkeleton } from '../../components/common/Skeleton';
import { useToast } from '../../components/common/ToastContext';
import { StatCard } from '../../components/dashboard/StatCard';
import { PageHeader } from '../../components/layout/PageHeader';

function BackupMenu({ onRestored }: { onRestored: () => void }) {
  const { showToast } = useToast();
  const confirm = useConfirm();
  const file = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const download = async (format: 'xlsx' | 'json') => {
    setBusy(true);
    try {
      const data = await exportAll();
      const name = `rexera-hr-backup-${new Date().toISOString().slice(0, 10)}.${format}`;
      if (format === 'json') saveBlob(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), name);
      else await exportExcel({ Employees: data.employees ?? [], Interns: data.interns ?? [], Candidates: data.candidates ?? [], 'Salary Slips': data.salary_slips ?? [] }, name);
      showToast('Backup downloaded', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Backup failed', 'error');
    } finally {
      setBusy(false);
    }
  };

  const restore = async (f: File) => {
    try {
      let payload: Record<string, unknown[]>;
      if (f.name.toLowerCase().endsWith('.json')) {
        const parsed = JSON.parse(await f.text());
        payload = { employees: parsed.employees ?? [], interns: parsed.interns ?? [], candidates: parsed.candidates ?? [] };
      } else {
        const sheets = await parseAllSheets(f);
        payload = { employees: sheets.employees ?? sheets.employee ?? [], interns: sheets.interns ?? sheets.intern ?? [], candidates: sheets.candidates ?? sheets.candidate ?? [] };
      }
      const total = Object.values(payload).reduce((n, rows) => n + rows.length, 0);
      if (!total) {
        showToast('No employees, interns or candidates found in that file', 'warning');
        return;
      }
      const ok = await confirm({
        title: 'Restore from backup?',
        message: `This imports ${payload.employees.length} employees, ${payload.interns.length} interns and ${payload.candidates.length} candidates from ${f.name}.`,
        confirmText: 'Restore',
        tone: 'danger',
      });
      if (!ok) return;
      setBusy(true);
      const res = await importAll(payload);
      showToast(res.message || 'Backup restored', 'success');
      onRestored();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Restore failed', 'error');
    } finally {
      setBusy(false);
      if (file.current) file.current.value = '';
    }
  };

  return (
    <>
      <input ref={file} type="file" accept=".xlsx,.xls,.json" className="hidden" onChange={(e) => e.target.files?.[0] && restore(e.target.files[0])} />
      <Dropdown label="Backup and restore" width="w-56" triggerClassName="h-9 gap-2 border border-border bg-surface px-3 text-sm font-medium text-text shadow-[var(--shadow-card)] hover:bg-surface-secondary" trigger={<><DatabaseBackup size={15} /> {busy ? 'Working…' : 'Backup'}</>}>
        <DropdownItem icon={<Download size={15} />} onClick={() => download('xlsx')}>Export to Excel</DropdownItem>
        <DropdownItem icon={<Download size={15} />} onClick={() => download('json')}>Export to JSON</DropdownItem>
        <DropdownItem icon={<Upload size={15} />} onClick={() => file.current?.click()}>Restore from file…</DropdownItem>
      </Dropdown>
    </>
  );
}

export function HrDashboard() {
  const { can } = useAuth();
  const { data: m, status, error, reload } = useApi(getDashboardMetrics);

  if (status === 'error') return <><PageHeader title="HR overview" /><Card><ErrorState onRetry={reload} message={error} /></Card></>;
  if (!m) return <PageSkeleton />;

  const actions = [
    { to: '/hr/employees/new', label: 'Add employee', icon: UserPlus, perm: 'hr.employees.create' },
    { to: '/hr/interns/new', label: 'Onboard intern', icon: GraduationCap, perm: 'hr.interns.create' },
    { to: '/hr/payslips?tab=generate', label: 'Generate payslip', icon: FileText, perm: 'hr.payroll.process' },
    { to: '/hr/payroll', label: 'Run payroll', icon: Banknote, perm: 'hr.payroll.process' },
  ].filter((a) => can(a.perm));
  const PrimaryIcon = actions[0]?.icon ?? UserPlus;

  return (
    <>
      <PageHeader
        title="HR overview"
        description="Your people, today."
        breadcrumbs={[{ label: 'HR' }, { label: 'Overview' }]}
        actions={<>
          {can('hr.backup.manage') && <BackupMenu onRestored={reload} />}
          {actions.length > 0 && (
            <Link to={actions[0].to} className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-3.5 text-sm font-medium text-on-primary shadow-[var(--shadow-card)] hover:bg-primary-hover">
              <PrimaryIcon size={15} aria-hidden="true" /> {actions[0].label}
            </Link>
          )}
        </>}
      />

      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard icon={UsersRound} label="People working here" to={can('hr.employees.view') ? '/hr/employees' : undefined} value={number(m.active_employees + m.active_interns)} />
        <StatCard icon={CalendarClock} tone="success" label="Here today" to={can('hr.attendance.view') ? '/hr/attendance' : undefined} value={number(m.attendance_summary.present_count)} />
        <StatCard icon={UserPlus} label="Waiting to join" to={can('hr.recruitment.view') ? '/hr/recruitment' : undefined} value={number(m.pending_onboarding)} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="min-w-0 space-y-4 lg:col-span-2">
          <Card>
            <CardHeader title="Upcoming interviews" />
            {m.upcoming_interviews.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-text-muted">No interviews scheduled.</p>
            ) : (
              <ul className="divide-y divide-border">
                {m.upcoming_interviews.map((i) => (
                  <li key={`${i.email}-${i.interview_date}`} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-text">{i.candidate_name}</span>
                      <span className="block truncate text-xs text-text-muted">{i.position} · {i.interview_date}</span>
                    </span>
                    <StatusBadge status={i.status} />
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
        <div className="min-w-0 space-y-4">
          {actions.length > 1 && (
            <Card>
              <CardHeader title="Quick actions" />
              <div className="grid grid-cols-1 gap-2 p-3">
                {actions.map((a) => (
                  <Link key={a.to} to={a.to} className="flex items-center gap-3 rounded-md border border-border px-3 py-2 text-sm font-medium text-text hover:border-border-strong hover:bg-surface-secondary">
                    <a.icon size={15} className="text-text-muted" aria-hidden="true" /> {a.label}
                  </Link>
                ))}
              </div>
            </Card>
          )}
          <Card>
            <CardHeader title="Recent HR activity" />
            {m.recent_activities.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-text-muted">No recent activity.</p>
            ) : (
              <ul className="divide-y divide-border">
                {m.recent_activities.slice(0, 8).map((a) => (
                  <li key={a.id} className="px-4 py-3">
                    <p className="text-sm text-text">{a.title}</p>
                    <p className="text-xs text-text-muted">{a.description} · {dateTime(a.timestamp)}</p>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
