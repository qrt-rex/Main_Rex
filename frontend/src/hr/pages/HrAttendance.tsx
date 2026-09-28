import { useState, type FormEvent } from 'react';
import { CalendarClock, RefreshCw, Settings2 } from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';
import { useApi } from '../../lib/useApi';
import { date, todayISO } from '../../lib/format';
import { getAttendanceConfig, listAttendance, saveAttendanceConfig, type AttendanceConfig, type AttendanceRecord } from '../api';
import { EmployeeOptionList } from '../HrSection';
import { Toolbar } from '../components';
import { Badge, StatusBadge, type BadgeTone } from '../../components/common/Badge';
import { Button } from '../../components/common/Button';
import { Card, CardHeader } from '../../components/common/Card';
import { EmptyState } from '../../components/common/EmptyState';
import { ErrorState } from '../../components/common/ErrorState';
import { Input, Select } from '../../components/common/Input';
import { Modal } from '../../components/common/Modal';
import { Skeleton } from '../../components/common/Skeleton';
import { Table, type Column } from '../../components/common/Table';
import { useToast } from '../../components/common/ToastContext';
import { PageHeader } from '../../components/layout/PageHeader';

const fmt12 = (t = '00:00') => {
  const [h, m] = t.split(':').map(Number);
  return new Date(2000, 0, 1, h, m).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
};
const plusMinute = (t: string) => {
  const [h, m] = t.split(':').map(Number);
  const d = new Date(2000, 0, 1, h, m + 1);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

function Policies({ cfg }: { cfg: AttendanceConfig }) {
  const penalty = cfg.penalty_type === 'MARK_HALF_DAY' ? '3 lates convert to a half-day' : '3 lates deduct 1 casual leave';
  const rules: [string, string, string, string, BadgeTone][] = [
    ['On time', `${fmt12(cfg.shift_start_time)} – ${fmt12(cfg.grace_cutoff_time)}`, 'Full-day present, no penalty', 'Present', 'success'],
    ['Late', `${fmt12(plusMinute(cfg.grace_cutoff_time))} – ${fmt12(cfg.late_cutoff_time)}`, `Warning email; ${penalty}`, 'Late', 'warning'],
    ['Very late', `After ${fmt12(cfg.late_cutoff_time)}`, 'Downgraded to half-day, HR alerted', 'Half-day', 'danger'],
    ['Early logout', `Before ${fmt12(cfg.early_logout_cutoff_time)}`, 'Downgraded to half-day', 'Half-day', 'danger'],
  ];
  return (
    <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-4">
      {rules.map(([title, window, effect, label, tone]) => (
        <div key={title} className="rounded-md border border-border p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-medium text-text">{title}</p>
            <Badge tone={tone}>{label}</Badge>
          </div>
          <p className="mt-1 text-sm tabular-nums text-text-secondary">{window}</p>
          <p className="mt-0.5 text-xs text-text-muted">{effect}</p>
        </div>
      ))}
    </div>
  );
}

function RulesModal({ cfg, onClose, onSaved }: { cfg: AttendanceConfig; onClose: () => void; onSaved: () => void }) {
  const { showToast } = useToast();
  const [v, setV] = useState(cfg);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const set = (k: keyof AttendanceConfig) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setV((s) => ({ ...s, [k]: e.target.value }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const order = [v.shift_start_time, v.grace_cutoff_time, v.late_cutoff_time];
    if (!(order[0] < order[1] && order[1] < order[2])) {
      setError('Times must go in order: shift start, then grace cutoff, then late cutoff.');
      return;
    }
    if (!(v.early_logout_cutoff_time > v.shift_start_time)) {
      setError('The early logout cutoff must be after the shift start.');
      return;
    }
    setSaving(true);
    try {
      await saveAttendanceConfig(v);
      showToast('Attendance rules updated', 'success');
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the rules');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open onClose={onClose} title="Shift & grace rules" description="Used to classify every punch as present, late or half-day."
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" form="rules-form" loading={saving}>Save rules</Button></>}>
      <form id="rules-form" onSubmit={submit} noValidate className="grid gap-4 sm:grid-cols-2">
        <Input label="Shift start" type="time" required value={v.shift_start_time} onChange={set('shift_start_time')} />
        <Input label="Grace cutoff (on time until)" type="time" required value={v.grace_cutoff_time} onChange={set('grace_cutoff_time')} />
        <Input label="Late cutoff (half-day after)" type="time" required value={v.late_cutoff_time} onChange={set('late_cutoff_time')} />
        <Input label="Early logout cutoff" type="time" required value={v.early_logout_cutoff_time} onChange={set('early_logout_cutoff_time')} />
        <Select label="Three-lates penalty" value={v.penalty_type} onChange={set('penalty_type')}>
          <option value="DEDUCT_CL">Deduct 1 casual leave</option>
          <option value="MARK_HALF_DAY">Convert to half-day</option>
        </Select>
        <Input label="HR alert email" type="email" required value={v.hr_notification_email} onChange={set('hr_notification_email')} />
        {error && <p role="alert" className="text-sm text-danger sm:col-span-2">{error}</p>}
      </form>
    </Modal>
  );
}

export function HrAttendance() {
  const { can } = useAuth();
  const [day, setDay] = useState('');
  const [month, setMonth] = useState('');
  const [employee, setEmployee] = useState('');
  const [editing, setEditing] = useState(false);

  const cfg = useApi(getAttendanceConfig);
  const records = useApi(() => listAttendance({ date_str: day || undefined, month: month || undefined, employee_id: employee || undefined }), [day, month, employee]);

  const pickDay = (v: string) => { setMonth(''); setDay(v); };
  const thisMonth = () => { setDay(''); setMonth(todayISO().slice(0, 7)); };
  const scope = day ? date(day) : month ? new Date(`${month}-01T00:00:00`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }) : 'All records';

  const columns: Column<AttendanceRecord>[] = [
    { key: 'emp', header: 'Employee', sortValue: (r) => r.employee_name ?? r.employee_id, render: (r) => <span><span className="block font-medium text-text">{r.employee_name || 'Employee'}</span><span className="block text-xs text-text-muted">{r.department || '—'} · {r.employee_id}</span></span> },
    { key: 'date', header: 'Date', sortValue: (r) => r.attendance_date, render: (r) => <span className="whitespace-nowrap">{date(r.attendance_date)}</span> },
    { key: 'in', header: 'Punch in', render: (r) => <span className="tabular-nums">{r.punch_in_local || '—'}</span> },
    { key: 'out', header: 'Punch out', render: (r) => <span className="tabular-nums">{r.punch_out_local || '—'}</span> },
    { key: 'hours', header: 'Hours', align: 'right', sortValue: (r) => r.total_work_hours ?? 0, render: (r) => <span className="tabular-nums">{r.total_work_hours ?? 0} h</span> },
    { key: 'status', header: 'Status', sortValue: (r) => r.status, render: (r) => <span className="inline-flex items-center gap-1.5"><StatusBadge status={r.status} />{r.status === 'LATE' && r.late_minutes ? <span className="text-xs text-text-muted">+{r.late_minutes} min</span> : null}</span> },
    { key: 'remarks', header: 'Remarks', className: 'max-w-xs', render: (r) => <span className="line-clamp-2 text-text-muted">{r.penalty_details || r.half_day_reason || r.remarks || 'Standard punch'}</span> },
  ];

  return (
    <>
      <PageHeader
        title="Attendance"
        description="Punch records classified against your shift and grace rules."
        breadcrumbs={[{ label: 'HR' }, { label: 'Attendance' }]}
        actions={<>
          <Button variant="secondary" onClick={records.reload}><RefreshCw size={15} /> Refresh</Button>
          {can('hr.attendance.edit') && cfg.data && <Button variant="secondary" onClick={() => setEditing(true)}><Settings2 size={15} /> Shift rules</Button>}
        </>}
      />

      <Card className="mb-4">
        <CardHeader title="Attendance policy" description="Applied automatically to every punch" />
        {cfg.status === 'error' ? <ErrorState compact onRetry={cfg.reload} message={cfg.error} /> : cfg.data ? <Policies cfg={cfg.data} /> : <div className="p-4"><Skeleton className="h-20" /></div>}
      </Card>

      <Card>
        <Toolbar count={records.data ? `${records.data.data.length} records · ${scope}` : undefined}>
          <Input aria-label="Date" type="date" value={day} onChange={(e) => pickDay(e.target.value)} inputClassName="w-40" />
          <Button variant={day === todayISO() ? 'primary' : 'secondary'} size="sm" onClick={() => pickDay(todayISO())}>Today</Button>
          <Button variant={month ? 'primary' : 'secondary'} size="sm" onClick={thisMonth}>This month</Button>
          {(day || month) && <Button variant="ghost" size="sm" onClick={() => { setDay(''); setMonth(''); }}>Clear</Button>}
          <Select aria-label="Employee" value={employee} onChange={(e) => setEmployee(e.target.value)} selectClassName="w-56">
            <option value="">All employees</option>
            <EmployeeOptionList valueKey="employee_code" />
          </Select>
        </Toolbar>
        {records.status === 'error' ? <ErrorState onRetry={records.reload} message={records.error} /> : (
          <Table caption="Attendance records" columns={columns} rows={records.data?.data ?? []} rowKey={(r) => r.id ?? `${r.employee_id}-${r.attendance_date}`} loading={records.loading}
            empty={<EmptyState compact icon={CalendarClock} title="No attendance records" description={day || month || employee ? 'Nothing matches these filters.' : 'Punches will appear here as employees check in.'} />} />
        )}
      </Card>
      {editing && cfg.data && <RulesModal cfg={cfg.data} onClose={() => setEditing(false)} onSaved={cfg.reload} />}
    </>
  );
}
