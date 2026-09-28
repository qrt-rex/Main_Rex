import { useState, type FormEvent } from 'react';
import { Play, Workflow } from 'lucide-react';
import { api } from '../lib/api';
import { useApi } from '../lib/useApi';
import { dateTime, relativeTime } from '../lib/format';
import { Badge, StatusBadge } from '../components/common/Badge';
import { Button } from '../components/common/Button';
import { Card, CardHeader } from '../components/common/Card';
import { EmptyState } from '../components/common/EmptyState';
import { ErrorState } from '../components/common/ErrorState';
import { Input } from '../components/common/Input';
import { PageSkeleton } from '../components/common/Skeleton';
import { Table, type Column } from '../components/common/Table';
import { useToast } from '../components/common/ToastContext';
import { PageHeader } from '../components/layout/PageHeader';

interface Schedule { type: 'daily' | 'monthly' | 'interval'; time?: string; day?: number; minutes?: number }
interface Option { key: string; label: string; type: 'number' | 'text'; value: string | number }
interface Automation {
  id: string;
  category: string;
  label: string;
  description: string;
  enabled: boolean;
  schedule: Schedule;
  options: Option[];
  last_run_at?: string | null;
  last_status?: 'success' | 'failed' | null;
  last_message?: string | null;
}
interface Overview { settings: { hr_email: string; accounts_email: string }; automations: Automation[] }
interface Run { id: string; automation_id: string; label: string; trigger: string; status: string; message: string; finished_at: string }

const CATEGORIES = ['Payroll', 'Billing', 'HR', 'Recruitment'];
// Stored in UTC without a zone marker.
const utc = (s?: string | null) => (s ? `${s}${/[zZ]|[+-]\d\d:\d\d$/.test(s) ? '' : 'Z'}` : '');

function describeSchedule(s: Schedule) {
  if (s.type === 'interval') return `Every ${s.minutes} minutes`;
  if (s.type === 'monthly') return `Day ${s.day} of every month at ${s.time}`;
  return `Every day at ${s.time}`;
}

function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${checked ? 'bg-primary' : 'bg-neutral-bg border border-border'}`}>
      <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-6' : 'translate-x-1'}`} />
    </button>
  );
}

function AutomationCard({ item, onSaved, onRan }: { item: Automation; onSaved: (a: Automation) => void; onRan: () => void }) {
  const { showToast } = useToast();
  const [schedule, setSchedule] = useState<Schedule>(item.schedule);
  const [options, setOptions] = useState<Record<string, string>>(() => Object.fromEntries(item.options.map((o) => [o.key, String(o.value ?? '')])));
  const [busy, setBusy] = useState<'save' | 'run' | null>(null);
  const dirty = JSON.stringify(schedule) !== JSON.stringify(item.schedule)
    || item.options.some((o) => String(o.value ?? '') !== options[o.key]);

  const save = async (enabled: boolean) => {
    setBusy('save');
    try {
      const updated = await api.put<Automation>(`/api/automations/${item.id}`, { enabled, schedule, options });
      onSaved(updated);
      showToast(enabled !== item.enabled ? `${item.label} ${enabled ? 'switched on' : 'switched off'}` : 'Automation saved', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not save', 'error');
    } finally {
      setBusy(null);
    }
  };

  const runNow = async () => {
    setBusy('run');
    try {
      const run = await api.post<Run>(`/api/automations/${item.id}/run`);
      showToast(run.message, run.status === 'success' ? 'success' : 'error');
      onRan();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not run', 'error');
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card className="flex flex-col">
      <div className="flex items-start justify-between gap-3 p-4">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-text">{item.label}</h3>
          <p className="mt-1 text-xs leading-5 text-text-muted">{item.description}</p>
        </div>
        <Switch checked={item.enabled} onChange={save} label={`${item.enabled ? 'Turn off' : 'Turn on'} ${item.label}`} disabled={busy !== null} />
      </div>
      <form onSubmit={(e: FormEvent) => { e.preventDefault(); save(item.enabled); }} className="grid gap-3 border-t border-border px-4 py-3 sm:grid-cols-2">
        {schedule.type === 'monthly' && (
          <Input label="Day of month" type="number" min={1} max={28} value={schedule.day ?? 1} onChange={(e) => setSchedule((s) => ({ ...s, day: Number(e.target.value) }))} />
        )}
        {schedule.type !== 'interval' ? (
          <Input label="Time (IST)" type="time" value={schedule.time ?? '09:00'} onChange={(e) => setSchedule((s) => ({ ...s, time: e.target.value }))} />
        ) : (
          <Input label="Every (minutes)" type="number" min={5} max={1440} value={schedule.minutes ?? 60} onChange={(e) => setSchedule((s) => ({ ...s, minutes: Number(e.target.value) }))} />
        )}
        {item.options.map((o) => (
          <Input key={o.key} label={o.label} type={o.type === 'number' ? 'number' : 'text'} min={o.type === 'number' ? 0 : undefined}
            value={options[o.key] ?? ''} onChange={(e) => setOptions((s) => ({ ...s, [o.key]: e.target.value }))} />
        ))}
        {dirty && <div className="sm:col-span-2"><Button type="submit" size="sm" loading={busy === 'save'}>Save changes</Button></div>}
      </form>
      <div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-3 text-xs">
        <span className="min-w-0 text-text-muted">
          {item.enabled ? <Badge tone="success" dot>On · {describeSchedule(item.schedule)}</Badge> : <Badge>Off</Badge>}
          {item.last_run_at && (
            <span className="mt-1.5 block" title={item.last_message ?? ''}>
              Last run {relativeTime(utc(item.last_run_at))}: <span className={item.last_status === 'failed' ? 'text-danger' : 'text-text-secondary'}>{item.last_message}</span>
            </span>
          )}
        </span>
        <Button variant="secondary" size="sm" onClick={runNow} loading={busy === 'run'} disabled={busy !== null}><Play size={13} /> Run now</Button>
      </div>
    </Card>
  );
}

function AddressesCard({ initial }: { initial: Overview['settings'] }) {
  const { showToast } = useToast();
  const [v, setV] = useState(initial);
  const [saving, setSaving] = useState(false);
  const save = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      setV(await api.put<Overview['settings']>('/api/automations/settings', v));
      showToast('Notification addresses saved', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not save', 'error');
    } finally {
      setSaving(false);
    }
  };
  return (
    <Card>
      <CardHeader title="Where automation alerts go" description="Payroll, leave, probation and onboarding alerts go to HR; receivable summaries go to accounts." />
      <form onSubmit={save} className="grid items-end gap-3 p-4 sm:grid-cols-[1fr_1fr_auto]">
        <Input label="HR email" type="email" required value={v.hr_email} onChange={(e) => setV((s) => ({ ...s, hr_email: e.target.value }))} />
        <Input label="Accounts email" type="email" required value={v.accounts_email} onChange={(e) => setV((s) => ({ ...s, accounts_email: e.target.value }))} />
        <Button type="submit" loading={saving}>Save</Button>
      </form>
    </Card>
  );
}

export function Automations() {
  const overview = useApi(() => api.get<Overview>('/api/automations'));
  const runs = useApi(() => api.get<{ runs: Run[] }>('/api/automations/runs', { limit: 50 }));

  const replace = (a: Automation) =>
    overview.setData((d) => (d ? { ...d, automations: d.automations.map((x) => (x.id === a.id ? a : x)) } : d));
  const refresh = () => {
    overview.reload();
    runs.reload();
  };

  const runColumns: Column<Run>[] = [
    { key: 'when', header: 'When', render: (r) => <span className="whitespace-nowrap text-text-muted">{dateTime(utc(r.finished_at))}</span> },
    { key: 'what', header: 'Automation', render: (r) => <span className="text-text">{r.label}</span> },
    { key: 'trigger', header: 'Started by', render: (r) => (r.trigger === 'schedule' ? 'Schedule' : 'Run now') },
    { key: 'status', header: 'Result', render: (r) => <StatusBadge status={r.status === 'success' ? 'COMPLETED' : 'FAILED'} /> },
    { key: 'message', header: 'Details', className: 'max-w-md', render: (r) => <span className="line-clamp-2 text-text-secondary">{r.message}</span> },
  ];

  const onCount = overview.data?.automations.filter((a) => a.enabled).length ?? 0;

  return (
    <>
      <PageHeader
        title="Automations"
        description="Scheduled payroll runs, payslip emails, payment reminders, HR alerts and onboarding follow-ups. Each one is off until you switch it on, and only acts on new work from that moment."
        breadcrumbs={[{ label: 'Administration' }, { label: 'Automations' }]}
        actions={overview.data && <Badge tone={onCount ? 'success' : 'neutral'} dot>{onCount} of {overview.data.automations.length} on</Badge>}
      />
      {overview.status === 'error' ? (
        <Card><ErrorState onRetry={overview.reload} message={overview.error} /></Card>
      ) : !overview.data ? (
        <PageSkeleton />
      ) : (
        <div className="space-y-6">
          <AddressesCard initial={overview.data.settings} />
          {CATEGORIES.map((cat) => {
            const items = overview.data!.automations.filter((a) => a.category === cat);
            if (!items.length) return null;
            return (
              <section key={cat} aria-labelledby={`auto-${cat}`}>
                <h2 id={`auto-${cat}`} className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">{cat}</h2>
                <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
                  {items.map((a) => <AutomationCard key={a.id} item={a} onSaved={replace} onRan={refresh} />)}
                </div>
              </section>
            );
          })}
          <Card>
            <CardHeader title="Recent runs" description="The last 50 runs, scheduled or started by hand." actions={<Button variant="ghost" size="sm" onClick={runs.reload}>Refresh</Button>} />
            {runs.status === 'error' ? <ErrorState onRetry={runs.reload} message={runs.error} /> : (
              <Table caption="Automation runs" columns={runColumns} rows={runs.data?.runs ?? []} rowKey={(r) => r.id} loading={runs.loading}
                empty={<EmptyState compact icon={Workflow} title="No runs yet" description="Runs appear here once an automation is switched on or run by hand." />} />
            )}
          </Card>
        </div>
      )}
    </>
  );
}
