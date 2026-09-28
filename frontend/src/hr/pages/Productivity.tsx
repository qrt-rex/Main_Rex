import { useMemo, useState, type FormEvent } from 'react';
import { AlertOctagon, Briefcase, Clock, FolderKanban, ListPlus, Siren, TrendingDown, Flame } from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';
import { useApi } from '../../lib/useApi';
import { todayISO, titleCase } from '../../lib/format';
import { birdsEye, flagBlocker, listTasks, logTimesheet, quickTask, type BirdsEye, type ProjectTask } from '../api';
import { EmployeeOptionList } from '../HrSection';
import { Toolbar } from '../components';
import { Badge, StatusBadge } from '../../components/common/Badge';
import { Button } from '../../components/common/Button';
import { Card, CardHeader } from '../../components/common/Card';
import { EmptyState } from '../../components/common/EmptyState';
import { ErrorState } from '../../components/common/ErrorState';
import { Input, Select, Textarea } from '../../components/common/Input';
import { Modal } from '../../components/common/Modal';
import { PageSkeleton } from '../../components/common/Skeleton';
import { Table, type Column } from '../../components/common/Table';
import { useToast } from '../../components/common/ToastContext';
import { StatCard } from '../../components/dashboard/StatCard';
import { PageHeader } from '../../components/layout/PageHeader';

const BLOCKER_CATEGORIES = [
  ['WAITING_CLIENT_APPROVAL', 'Waiting for client approval'], ['MISSING_ASSETS_SPEC', 'Missing assets or specs'],
  ['SERVER_INFRA_ISSUE', 'Server or infrastructure down'], ['DEPENDENCY_ON_TEAM', 'Dependency on another team'],
  ['BUDGET_SCOPE_CREEP', 'Budget or scope creep'], ['OTHER', 'Other impediment'],
] as const;

type Dialog = 'task' | 'timesheet' | 'blocker' | null;
const taskId = (t: ProjectTask) => t._id ?? t.id ?? '';

function TaskForms({ dialog, tasks, onClose, onDone }: { dialog: Dialog; tasks: ProjectTask[]; onClose: () => void; onDone: () => void }) {
  const { showToast } = useToast();
  const [v, setV] = useState<Record<string, string>>({ estimated_hours: '8', work_date: todayISO(), task_new_status: 'IN_PROGRESS', blocker_category: 'WAITING_CLIENT_APPROVAL', task_id: taskId(tasks[0] ?? {} as ProjectTask) });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setV((s) => ({ ...s, [k]: e.target.value }));
  const clients = [...new Set(tasks.map((t) => t.client_name).filter(Boolean))] as string[];
  const projects = [...new Set(tasks.map((t) => t.project_name).filter(Boolean))] as string[];

  const required = dialog === 'task' ? ['client_name', 'project_name', 'task_title', 'employee_id']
    : dialog === 'timesheet' ? ['employee_id', 'task_id', 'work_date', 'hours_spent', 'work_description']
    : ['employee_id', 'task_id', 'blocker_reason'];

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const er = Object.fromEntries(required.filter((k) => !String(v[k] ?? '').trim()).map((k) => [k, 'Required']));
    const hours = Number(v.hours_spent);
    if (dialog === 'timesheet' && v.hours_spent && !(hours > 0 && hours <= 24)) er.hours_spent = 'Enter between 0.25 and 24 hours.';
    setErrors(er);
    if (Object.keys(er).length) return;
    setSaving(true);
    try {
      if (dialog === 'task') {
        await quickTask({ client_name: v.client_name.trim(), project_name: v.project_name.trim(), task_title: v.task_title.trim(), employee_id: v.employee_id, estimated_hours: Number(v.estimated_hours) || 0 });
        showToast('Task created', 'success');
      } else if (dialog === 'timesheet') {
        const res = await logTimesheet({ employee_id: v.employee_id, task_id: v.task_id, work_date: v.work_date, hours_spent: hours, work_description: v.work_description.trim(), task_new_status: v.task_new_status });
        showToast(res.message || 'Timesheet logged', 'success');
      } else {
        const res = await flagBlocker({ employee_id: v.employee_id, task_id: v.task_id, blocker_category: v.blocker_category, blocker_reason: v.blocker_reason.trim() });
        showToast(res.message || 'Blocker escalated to HR and the project manager', 'warning');
      }
      onDone();
      onClose();
    } catch (err) {
      setErrors({ form: err instanceof Error ? err.message : 'Could not save' });
    } finally {
      setSaving(false);
    }
  };

  const titles = { task: 'New client task', timesheet: 'Log timesheet', blocker: 'Flag a blocker' };
  const noTasks = dialog !== 'task' && tasks.length === 0;
  const taskSelect = (
    <Select label="Task" required value={v.task_id ?? ''} onChange={set('task_id')} error={errors.task_id} className="sm:col-span-2">
      {tasks.map((t) => <option key={taskId(t)} value={taskId(t)}>[{t.client_name || 'Client'}] {t.task_title} · {t.project_name || 'Project'}</option>)}
    </Select>
  );

  return (
    <Modal open={!!dialog} onClose={onClose} size="lg" closeOnOverlay={false} title={dialog ? titles[dialog] : ''}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" form="prod-form" loading={saving} disabled={noTasks} variant={dialog === 'blocker' ? 'danger' : 'primary'}>{dialog === 'task' ? 'Create task' : dialog === 'timesheet' ? 'Save entry' : 'Escalate blocker'}</Button></>}>
      {noTasks ? (
        <EmptyState compact icon={ListPlus} title="No tasks yet" description="Create a client task first, then log time or flag blockers against it." />
      ) : (
        <form id="prod-form" onSubmit={submit} noValidate className="grid gap-4 sm:grid-cols-2">
          <Select label={dialog === 'task' ? 'Assign to' : 'Employee'} required value={v.employee_id ?? ''} onChange={set('employee_id')} error={errors.employee_id} className="sm:col-span-2">
            <option value="">Choose an employee…</option>
            <EmployeeOptionList valueKey="employee_code" />
          </Select>
          {dialog === 'task' && (
            <>
              <Input label="Client" required value={v.client_name ?? ''} onChange={set('client_name')} error={errors.client_name} list="clients" placeholder="e.g. Acme Corp" />
              <datalist id="clients">{clients.map((c) => <option key={c} value={c} />)}</datalist>
              <Input label="Project" required value={v.project_name ?? ''} onChange={set('project_name')} error={errors.project_name} list="projects" placeholder="e.g. Website redesign" />
              <datalist id="projects">{projects.map((p) => <option key={p} value={p} />)}</datalist>
              <Input label="Task title" required value={v.task_title ?? ''} onChange={set('task_title')} error={errors.task_title} className="sm:col-span-2" />
              <Input label="Estimated hours" type="number" min={0} step={0.5} value={v.estimated_hours} onChange={set('estimated_hours')} />
            </>
          )}
          {dialog === 'timesheet' && (
            <>
              {taskSelect}
              <Input label="Work date" type="date" required max={todayISO()} value={v.work_date} onChange={set('work_date')} error={errors.work_date} />
              <Input label="Hours spent" type="number" required min={0.25} max={24} step={0.25} value={v.hours_spent ?? ''} onChange={set('hours_spent')} error={errors.hours_spent} />
              <Select label="Task status" value={v.task_new_status} onChange={set('task_new_status')}>
                <option value="IN_PROGRESS">In progress</option><option value="UNDER_REVIEW">Under review</option><option value="COMPLETED">Completed</option>
              </Select>
              <Textarea label="Work description" required value={v.work_description ?? ''} onChange={set('work_description')} error={errors.work_description} className="sm:col-span-2" placeholder="What was delivered today…" />
            </>
          )}
          {dialog === 'blocker' && (
            <>
              {taskSelect}
              <Select label="Category" required value={v.blocker_category} onChange={set('blocker_category')} className="sm:col-span-2">
                {BLOCKER_CATEGORIES.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
              </Select>
              <Textarea label="What's blocking progress?" required value={v.blocker_reason ?? ''} onChange={set('blocker_reason')} error={errors.blocker_reason} className="sm:col-span-2" placeholder="Describe the impediment and the help needed" />
            </>
          )}
          {errors.form && <p role="alert" className="text-sm text-danger sm:col-span-2">{errors.form}</p>}
        </form>
      )}
    </Modal>
  );
}

type Efficiency = NonNullable<BirdsEye['employee_efficiency']>[number];
type Project = NonNullable<BirdsEye['active_projects']>[number];

export function Productivity() {
  const { can } = useAuth();
  const [day, setDay] = useState(todayISO());
  const [dialog, setDialog] = useState<Dialog>(null);
  const report = useApi(() => birdsEye(day), [day]);
  const tasks = useApi(listTasks);
  const data: BirdsEye | null = report.data ? (report.data.data ?? report.data) : null;
  const taskList = useMemo(() => (Array.isArray(tasks.data) ? tasks.data : tasks.data?.data ?? []), [tasks.data]);
  const refresh = () => { report.reload(); tasks.reload(); };

  if (report.status === 'error' && !data) return <><PageHeader title="Productivity" /><Card><ErrorState onRetry={report.reload} message={report.error} /></Card></>;
  if (!data) return <PageSkeleton />;

  const eff = data.employee_efficiency ?? [];
  const billed = eff.reduce((n, e) => n + (e.logged_hours || 0), 0);
  const blockers = data.red_zone_bottlenecks ?? [];

  const effColumns: Column<Efficiency>[] = [
    { key: 'emp', header: 'Employee', sortValue: (e) => e.employee_name, render: (e) => <span><span className="block font-medium text-text">{e.employee_name}</span><span className="block text-xs text-text-muted">{e.department} · {e.employee_id}</span></span> },
    { key: 'att', header: 'Attendance', render: (e) => <StatusBadge status={e.attendance_status} /> },
    { key: 'present', header: 'Present', align: 'right', sortValue: (e) => e.present_hours, render: (e) => <span className="tabular-nums">{e.present_hours} h</span> },
    { key: 'logged', header: 'Client work', align: 'right', sortValue: (e) => e.logged_hours, render: (e) => <span className="tabular-nums">{e.logged_hours} h</span> },
    { key: 'ratio', header: 'Utilization', align: 'right', sortValue: (e) => e.efficiency_pct, render: (e) => <span className="tabular-nums">{e.efficiency_pct}%</span> },
    { key: 'health', header: 'Health', sortValue: (e) => e.health_status, render: (e) => <StatusBadge status={e.health_status} /> },
  ];
  const projColumns: Column<Project>[] = [
    { key: 'name', header: 'Project', sortValue: (p) => p.project_name, render: (p) => <span><span className="block font-medium text-text">{p.project_name}</span><span className="block text-xs text-text-muted">{p.client_name} · PM {p.project_manager}</span></span> },
    { key: 'tasks', header: 'Tasks', render: (p) => <span className="text-text-secondary">{p.completed_tasks}/{p.total_tasks} done{p.blocked_tasks ? <span className="text-danger"> · {p.blocked_tasks} blocked</span> : null}</span> },
    {
      key: 'progress', header: 'Progress', sortValue: (p) => p.completion_percentage,
      render: (p) => (
        <span className="flex min-w-32 items-center gap-2">
          <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-neutral-bg"><span className="block h-full rounded-full bg-success" style={{ width: `${p.completion_percentage}%` }} /></span>
          <span className="w-9 text-right text-xs tabular-nums text-text">{p.completion_percentage}%</span>
        </span>
      ),
    },
    { key: 'hours', header: 'Logged / budget', align: 'right', render: (p) => <span className="tabular-nums">{p.logged_hours_total} / {p.budget_hours} h</span> },
  ];

  return (
    <>
      <PageHeader
        title="Productivity"
        description="Client work logged against attendance, project progress and escalated blockers."
        breadcrumbs={[{ label: 'HR' }, { label: 'Productivity' }]}
        actions={can('hr.productivity.manage') && <>
          <Button variant="secondary" onClick={() => setDialog('blocker')}><Siren size={15} /> Flag blocker</Button>
          <Button variant="secondary" onClick={() => setDialog('timesheet')}><Clock size={15} /> Log time</Button>
          <Button onClick={() => setDialog('task')}><ListPlus size={15} /> New task</Button>
        </>}
      />

      <div className="mb-4 grid grid-cols-2 gap-3 xl:grid-cols-4">
        <StatCard icon={FolderKanban} label="Active projects" value={data.summary_metrics?.active_projects_count ?? 0} />
        <StatCard icon={Briefcase} tone="info" label="Client hours logged" value={`${billed.toFixed(1)} h`} hint="On the selected day" />
        <StatCard icon={TrendingDown} tone="warning" label="Under-utilized (< 4 h)" value={data.summary_metrics?.underutilized_count ?? 0} />
        <StatCard icon={Flame} tone="danger" label="Burnout risk (10 h+)" value={data.summary_metrics?.burnout_risk_count ?? 0} />
      </div>

      <Card className="mb-4">
        <CardHeader title="Red zone blockers" description="Tasks escalated as blocked across active projects" actions={<Badge tone={blockers.length ? 'danger' : 'success'} dot>{blockers.length ? `${blockers.length} blocked` : 'None'}</Badge>} />
        {blockers.length === 0 ? (
          <p className="px-4 py-6 text-sm text-text-muted">No critical bottlenecks flagged.</p>
        ) : (
          <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-3">
            {blockers.map((b, i) => (
              <div key={i} className="rounded-md border border-border border-l-4 border-l-danger p-3">
                <div className="mb-1 flex items-center justify-between gap-2">
                  <Badge tone="danger"><AlertOctagon size={11} aria-hidden="true" /> {titleCase(b.blocker_category || 'Blocker')}</Badge>
                  <span className="text-xs text-text-muted">Stuck {b.stuck_duration_hours} h</span>
                </div>
                <p className="text-sm font-medium text-text">{b.task_title}</p>
                <p className="text-xs text-text-muted">{b.client_name} · {b.project_name} · {b.assigned_to}</p>
                <p className="mt-2 rounded bg-surface-secondary px-2 py-1.5 text-xs text-text-secondary">{b.blocker_reason}</p>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card className="mb-4">
        <CardHeader title="Employee efficiency" description="Present hours vs. client work logged" />
        <Toolbar><Input aria-label="Date" type="date" max={todayISO()} value={day} onChange={(e) => setDay(e.target.value || todayISO())} inputClassName="w-40" /></Toolbar>
        <Table caption="Employee efficiency" columns={effColumns} rows={eff} rowKey={(e) => e.employee_id} loading={report.loading}
          empty={<EmptyState compact icon={Clock} title="Nothing logged for this day" description="Attendance and timesheets for the selected date will appear here." />} />
      </Card>

      <Card>
        <CardHeader title="Active client projects" />
        <Table caption="Active projects" columns={projColumns} rows={data.active_projects ?? []} rowKey={(p) => p.project_name} empty={<EmptyState compact icon={FolderKanban} title="No active projects" />} />
      </Card>

      {dialog && <TaskForms key={dialog} dialog={dialog} tasks={taskList} onClose={() => setDialog(null)} onDone={refresh} />}
    </>
  );
}
