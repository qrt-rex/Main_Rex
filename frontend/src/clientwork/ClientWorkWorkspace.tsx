import { useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  ArrowLeft, CalendarClock, CheckCircle2, FilePlus2, FileQuestion, FileText, Flag, History, MessageSquare, MessageSquarePlus,
  PauseCircle, Pencil, PlayCircle, Plus, RotateCcw, ShieldAlert, StickyNote, Upload, UserRoundCog, Download, Inbox, Hourglass, ListChecks,
} from 'lucide-react';
import { useApi } from '../lib/useApi';
import { api, saveBlob } from '../lib/api';
import { date, dateTime, relativeTime } from '../lib/format';
import { Badge } from '../components/common/Badge';
import { Button } from '../components/common/Button';
import { Card, CardHeader } from '../components/common/Card';
import { useConfirm } from '../components/common/ConfirmDialog';
import { EmptyState } from '../components/common/EmptyState';
import { ErrorState } from '../components/common/ErrorState';
import { PageSkeleton } from '../components/common/Skeleton';
import { Tabs } from '../components/common/Tabs';
import { useToast } from '../components/common/ToastContext';
import { cw, TASK_STATUSES, type Activity, type ClientRequest, type Task, type TaskStatus, type WorkDetail } from './api';
import { useClientWorkLive } from './live';
import { DeadlineBadge, LiveDot, PriorityBadge, ProgressBar, Stat, WorkStatusBadge, duration, selectCls, title } from './ui';
import { DetailsDialog, HoldModal, NoteDialog, NoteOnlyDialog, ReassignDialog, RequestDialog, ResponseDialog, TaskDialog, UploadDialog } from './WorkModals';

type TabId = 'overview' | 'tasks' | 'actions' | 'documents' | 'timeline' | 'history';
type Dialog = null | 'hold' | 'resume' | 'complete' | 'task' | 'note' | 'comment' | 'issue' | 'request-doc' | 'request-info' | 'upload' | 'response' | 'details' | 'priority' | 'deadline' | 'reassign';

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <div className="min-w-0"><dt className="text-xs text-text-muted">{label}</dt><dd className="mt-0.5 break-words text-sm text-text">{children || '—'}</dd></div>;
}

/** One client's work: overview, tasks, actions, documents, timeline and history, kept current by the live stream. */
export function ClientWorkWorkspace() {
  const { id = '' } = useParams();
  const { showToast } = useToast();
  const confirm = useConfirm();
  const [tab, setTab] = useState<TabId>('overview');
  const [dialog, setDialog] = useState<Dialog>(null);
  const [editTask, setEditTask] = useState<Task | null>(null);
  const [uploadFor, setUploadFor] = useState<{ taskId?: string; requestId?: string }>({});
  const [noteTask, setNoteTask] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const detail = useApi(() => cw.detail(id), [id]);
  const timeline = useApi(() => cw.timeline(id), [id], tab === 'timeline' || tab === 'overview');
  const history = useApi(() => cw.history(id), [id], tab === 'history');
  const docs = useApi(() => cw.documents(id), [id], tab === 'documents' || tab === 'actions' || dialog === 'upload' || dialog === 'response');
  const comments = useApi(() => cw.comments(id), [id], tab === 'actions');
  const tasks = useApi(() => api.get<{ items: Task[] }>(`/api/client-work/work/${id}/tasks`), [id], tab === 'tasks');

  const reloadAll = () => { detail.reload(); timeline.reload(); history.reload(); docs.reload(); comments.reload(); tasks.reload(); };
  useClientWorkLive(reloadAll, (e) => !e.work_id || e.work_id === id);

  const w = detail.data;
  if (detail.status === 'error' && !w) {
    return (
      <Card>
        <ErrorState onRetry={detail.reload} message={detail.error} />
        <p className="pb-6 text-center"><Link to="/client-work" className="text-sm text-primary hover:underline">Back to client work</Link></p>
      </Card>
    );
  }
  if (!w) return <PageSkeleton />;

  const act = async (fn: () => Promise<{ message?: string }>, fallback: string) => {
    setBusy(true);
    try {
      const r = await fn();
      showToast(r.message ?? fallback, 'success');
      reloadAll();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Could not complete that action.', 'error');
      reloadAll();   // a conflict usually means somebody else changed it: show the current state
    } finally {
      setBusy(false);
    }
  };

  const open = w.status === 'NEED_ACTION' || w.status === 'IN_PROGRESS' || w.status === 'ON_HOLD';
  const canWork = w.can_act && open;
  const onHold = w.status === 'ON_HOLD';
  const running = canWork && !onHold;
  const done = () => reloadAll();

  const start = async () => {
    if (await confirm({ title: 'Start work?', message: `${w.client_name} moves to In progress and the working clock starts counting.`, confirmText: 'Start work' })) act(() => cw.start(w.id), 'Work started.');
  };
  const markDone = () => setDialog('complete');

  const tabs = [
    { id: 'overview', label: 'Overview' }, { id: 'tasks', label: 'Tasks', count: w.total_tasks }, { id: 'actions', label: 'Client actions', count: w.pending_items_count || undefined },
    { id: 'documents', label: 'Documents' }, { id: 'timeline', label: 'Activity timeline' }, { id: 'history', label: 'History' },
  ];

  return (
    <div className="space-y-4">
      <Link to="/client-work" className="inline-flex items-center gap-1.5 text-sm text-text-muted hover:text-text"><ArrowLeft size={14} aria-hidden="true" /> Client work</Link>

      <Card>
        <div className="flex flex-wrap items-start justify-between gap-4 p-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold tracking-tight text-text">{w.client_name}</h1>
              <WorkStatusBadge work={w} /><PriorityBadge priority={w.priority} />
            </div>
            <p className="mt-1 text-sm text-text-muted"><span className="font-mono">{w.client_ref}</span> · {w.work_no} · {w.work_type} · assigned to <strong className="font-medium text-text-secondary">{w.assigned_to.name}</strong> by {w.assigned_by.name}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <LiveDot />
            {canWork && w.status === 'NEED_ACTION' && <Button onClick={start} loading={busy}><PlayCircle size={15} aria-hidden="true" /> Start work</Button>}
            {canWork && w.status === 'IN_PROGRESS' && <Button variant="secondary" onClick={() => setDialog('hold')}><PauseCircle size={15} aria-hidden="true" /> Put on hold</Button>}
            {canWork && onHold && <Button onClick={() => setDialog('resume')}><RotateCcw size={15} aria-hidden="true" /> Resume work</Button>}
            {running && <Button variant={w.ready_to_complete ? 'primary' : 'secondary'} onClick={markDone}><CheckCircle2 size={15} aria-hidden="true" /> Mark completed</Button>}
            {w.can_manage && <Button variant="secondary" onClick={() => setDialog('reassign')}><UserRoundCog size={15} aria-hidden="true" /> Reassign</Button>}
            {open && (w.can_act || w.can_manage) && <Button variant="ghost" size="icon" aria-label="Edit work details" onClick={() => setDialog('details')}><Pencil size={15} aria-hidden="true" /></Button>}
            {w.can_override && !open && <Button variant="secondary" onClick={() => act(() => cw.setStatus(w.id, 'NEED_ACTION', 'Reopened'), 'Work reopened.')}><RotateCcw size={15} aria-hidden="true" /> Reopen</Button>}
          </div>
        </div>
        <div className="grid gap-4 border-t border-border p-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="sm:col-span-2">
            <ProgressBar value={w.progress} tone={w.status === 'COMPLETED' ? 'success' : 'primary'} label={`Client work progress · ${w.completed_tasks} of ${w.total_tasks} tasks done`} />
            <p className="mt-1.5 text-xs text-text-muted">Total {w.total_tasks} · Completed {w.completed_tasks} · Pending {w.pending_tasks} · Client pending {w.pending_items_count}</p>
          </div>
          <div><p className="text-xs text-text-muted">Deadline</p><div className="mt-0.5"><DeadlineBadge work={w} /></div></div>
          <div><p className="text-xs text-text-muted">Time elapsed</p><p className="mt-0.5 text-sm font-medium tabular-nums text-text">{duration(w.durations.total)}</p><p className="text-xs text-text-muted">Last activity {relativeTime(w.last_activity_at)}</p></div>
        </div>
        {onHold && w.hold && (
          <div className={`flex flex-wrap items-center gap-x-6 gap-y-1 border-t px-4 py-3 text-sm ${w.hold.type === 'INTERNAL_BLOCKER' ? 'border-danger/30 bg-danger-bg text-danger' : 'border-warning/30 bg-warning-bg text-warning'}`}>
            <strong className="font-semibold">{w.hold.label}</strong>
            <span>{w.hold.reason}</span>
            <span className="text-xs">Waiting {w.hold.days_waiting} day{w.hold.days_waiting === 1 ? '' : 's'} ({duration(w.hold.seconds_waiting)})</span>
            {w.hold.expected_response_date && <span className="text-xs">Response expected {date(w.hold.expected_response_date)}</span>}
          </div>
        )}
      </Card>

      <Tabs tabs={tabs} active={tab} onChange={(t) => setTab(t as TabId)} />

      {tab === 'overview' && <Overview w={w} timeline={timeline.data?.items ?? []} />}
      {tab === 'tasks' && (
        <TasksTab w={w} tasks={tasks.data?.items ?? w.tasks} loading={!tasks.data} canWork={canWork && !onHold} onHold={onHold && canWork}
          onAdd={() => { setEditTask(null); setDialog('task'); }} onEdit={(t) => { setEditTask(t); setDialog('task'); }}
          onUpload={(t) => { setUploadFor({ taskId: t.id }); setDialog('upload'); }} onComment={(t) => { setNoteTask(t.id); setDialog('comment'); }}
          onUpdate={(t, patch) => act(() => cw.updateTask(t.id, { ...patch, version: t.version }), 'Task updated.')}
          onComplete={(t) => act(() => cw.completeTask(t.id), 'Task completed.')} />
      )}
      {tab === 'actions' && (
        <ActionsTab w={w} canWork={canWork} onHold={onHold} running={running} dialog={setDialog} start={start} comments={comments.data?.items ?? []}
          requests={docs.data?.requests ?? w.pending_requests} onResolve={(cid) => act(() => cw.resolveIssue(cid) as Promise<{ message?: string }>, 'Issue resolved.')} />
      )}
      {tab === 'documents' && (
        <DocumentsTab requests={docs.data?.requests ?? []} files={docs.data?.files ?? []} loading={!docs.data} canWork={canWork && !onHold}
          onUpload={(requestId) => { setUploadFor({ requestId }); setDialog('upload'); }}
          onDownload={async (f) => { try { saveBlob(await cw.download(f.id), f.filename); } catch (e) { showToast(e instanceof Error ? e.message : 'Download failed', 'error'); } }} />
      )}
      {tab === 'timeline' && <TimelineTab items={timeline.data?.items} loading={!timeline.data} />}
      {tab === 'history' && <HistoryTab w={w} history={history.data ?? undefined} loading={!history.data} />}

      <HoldModal work={w} open={dialog === 'hold'} onClose={() => setDialog(null)} onDone={done} />
      <NoteOnlyDialog open={dialog === 'resume'} onClose={() => setDialog(null)} heading="Resume work" label="Resume note" submitLabel="Resume work"
        description={w.pending_items_count ? `${w.pending_items_count} client item${w.pending_items_count === 1 ? ' is' : 's are'} still pending. They stay on the Waiting for Client list after you resume.` : 'The work returns to Need Action.'}
        onSubmit={async (note) => { const r = await cw.resume(w.id, note); done(); return r; }} />
      <NoteOnlyDialog open={dialog === 'complete'} onClose={() => setDialog(null)} heading="Mark client work as completed" label="Completion notes" required={false} submitLabel="Mark completed"
        description={`${w.client_name} · ${w.completed_tasks} of ${w.total_tasks} tasks done · this closes the work and records the final durations.`}
        onSubmit={async (note) => { const r = await cw.complete(w.id, note); done(); return r; }}>
        {w.blockers.length > 0 && (
          <div role="alert" className="rounded-md border border-warning/30 bg-warning-bg px-3 py-2 text-sm text-warning">
            <p className="font-medium">Not ready to complete:</p>
            <ul className="mt-1 list-disc pl-5">{w.blockers.map((b) => <li key={b}>{b}</li>)}</ul>
          </div>
        )}
      </NoteOnlyDialog>
      <TaskDialog work={w} open={dialog === 'task'} onClose={() => setDialog(null)} onDone={done} task={editTask} />
      <NoteDialog work={w} open={dialog === 'note'} kind="NOTE" onClose={() => setDialog(null)} onDone={done} />
      <NoteDialog work={w} open={dialog === 'comment'} kind="COMMENT" taskId={noteTask} onClose={() => { setDialog(null); setNoteTask(null); }} onDone={done} />
      <NoteDialog work={w} open={dialog === 'issue'} kind="ISSUE" onClose={() => setDialog(null)} onDone={done} />
      <RequestDialog work={w} open={dialog === 'request-doc'} kind="DOCUMENT" onClose={() => setDialog(null)} onDone={done} />
      <RequestDialog work={w} open={dialog === 'request-info'} kind="INFORMATION" onClose={() => setDialog(null)} onDone={done} />
      <UploadDialog work={w} open={dialog === 'upload'} onClose={() => { setDialog(null); setUploadFor({}); }} onDone={done} requests={docs.data?.requests ?? []} taskId={uploadFor.taskId} requestId={uploadFor.requestId} />
      <ResponseDialog work={w} open={dialog === 'response'} onClose={() => setDialog(null)} onDone={done} requests={docs.data?.requests ?? []} />
      <DetailsDialog work={w} open={dialog === 'details' || dialog === 'priority' || dialog === 'deadline'} focus={dialog === 'priority' ? 'priority' : dialog === 'deadline' ? 'deadline' : undefined} onClose={() => setDialog(null)} onDone={done} />
      <ReassignDialog work={w} open={dialog === 'reassign'} onClose={() => setDialog(null)} onDone={done} />
    </div>
  );
}

// ---------------------------------------------------------------- overview
function Overview({ w, timeline }: { w: WorkDetail; timeline: Activity[] }) {
  const c = w.client;
  const h = w.hold;
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="space-y-4 lg:col-span-2">
        <Card>
          <CardHeader title="Work summary" />
          <dl className="grid gap-4 p-4 sm:grid-cols-2">
            <Field label="Work type">{w.work_type}</Field>
            <Field label="Required action">{w.required_action}</Field>
            <Field label="Current status"><WorkStatusBadge work={w} /></Field>
            <Field label="Priority"><PriorityBadge priority={w.priority} /></Field>
            <Field label="Next action">{w.next_action}</Field>
            <Field label="Deadline"><DeadlineBadge work={w} /></Field>
          </dl>
        </Card>
        {h && (
          <Card>
            <CardHeader title={h.label} description={`On hold since ${dateTime(h.started_at)} by ${h.started_by}`} />
            <dl className="grid gap-4 p-4 sm:grid-cols-2">
              <Field label="Hold reason">{h.reason}</Field>
              <Field label="Required from client">{h.required_from_client}</Field>
              <Field label="Pending items">{h.pending_items.length ? <ul className="list-decimal pl-4">{h.pending_items.map((i) => <li key={i}>{i}</li>)}</ul> : null}</Field>
              <Field label="Client response expected">{h.expected_response_date ? date(h.expected_response_date) : ''}</Field>
              <Field label="Days on hold">{`${h.days_waiting} day${h.days_waiting === 1 ? '' : 's'} (${duration(h.seconds_waiting)})`}</Field>
              <Field label="Pending items count">{String(w.pending_items_count)}</Field>
              <Field label="Internal note">{h.internal_note}</Field>
            </dl>
          </Card>
        )}
        {(w.status === 'NEED_ACTION' || w.status === 'IN_PROGRESS') && w.can_act && (
          <Card>
            <CardHeader title="Ready to complete?" description="Checked on the server before the work can be closed" />
            <div className="p-4 text-sm">
              {w.blockers.length === 0
                ? <p className="inline-flex items-center gap-2 text-success"><CheckCircle2 size={16} aria-hidden="true" /> Every required task, document and issue is resolved. You can mark this work completed.</p>
                : <ul className="space-y-1.5">{w.blockers.map((b) => <li key={b} className="flex items-start gap-2 text-text-secondary"><ShieldAlert size={15} className="mt-0.5 shrink-0 text-warning" aria-hidden="true" />{b}</li>)}</ul>}
            </div>
          </Card>
        )}
        {w.status === 'COMPLETED' && (
          <Card>
            <CardHeader title="Completion record" description="Kept permanently; reopening never overwrites it" />
            <dl className="grid gap-4 p-4 sm:grid-cols-3">
              <Field label="Completed by">{w.completed_by?.name}</Field>
              <Field label="Completed at">{dateTime(w.completed_at)}</Field>
              <Field label="Tasks">{`${w.completed_tasks} of ${w.total_tasks}`}</Field>
              <Field label="Total duration">{duration(w.total_duration ?? w.durations.total)}</Field>
              <Field label="Active working time">{duration(w.active_duration ?? w.durations.active)}</Field>
              <Field label="On-hold time">{duration(w.hold_duration ?? w.durations.hold)}</Field>
              <div className="sm:col-span-3"><Field label="Completion notes">{w.completion_notes}</Field></div>
            </dl>
          </Card>
        )}
        <Card>
          <CardHeader title="Recent activity" />
          <ActivityFeed items={timeline.slice(0, 6)} empty="No activity yet." />
        </Card>
      </div>
      <div className="space-y-4">
        <Card>
          <CardHeader title="Client" />
          <dl className="space-y-3 p-4">
            <Field label="Company">{c.company_name ?? w.client_name}</Field>
            <Field label="Reference"><span className="font-mono">{c.reference ?? w.client_ref}</span></Field>
            <Field label="Contact">{[c.contact_name, c.contact_email, c.contact_phone].filter(Boolean).join(' · ')}</Field>
            <Field label="GSTIN">{c.gstin}</Field>
            <Field label="Services / documents">{[...(c.services ?? []), ...(c.documents ?? [])].join(', ')}</Field>
            <Field label="BDM">{c.bdm}</Field>
            <Field label="Legal review status">{c.legal_status ? title(c.legal_status) : ''}</Field>
          </dl>
        </Card>
        <Card>
          <CardHeader title="Assignment" />
          <dl className="space-y-3 p-4">
            <Field label="Assigned to">{`${w.assigned_to.name} · ${w.assigned_to.email}`}</Field>
            <Field label="Assigned by">{`${w.assigned_by.name} (${w.assigned_by.role})`}</Field>
            <Field label="Assignment date">{dateTime(w.created_at)}</Field>
            <Field label="Work started">{dateTime(w.started_at)}</Field>
            <Field label="Times put on hold">{String(w.hold_count)}</Field>
          </dl>
        </Card>
        <Card>
          <CardHeader title="Time tracking" description="Calculated from server timestamps" />
          <div className="grid grid-cols-1 gap-3 p-4">
            <Stat label="Total calendar duration" value={duration(w.durations.total)} />
            <Stat label="Active working duration" value={duration(w.durations.active)} tone="primary" />
            <Stat label="On-hold duration" value={duration(w.durations.hold)} tone={w.durations.hold ? 'warning' : 'neutral'} />
          </div>
        </Card>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- tasks
function TasksTab({ w, tasks, loading, canWork, onHold, onAdd, onEdit, onUpload, onComment, onUpdate, onComplete }: {
  w: WorkDetail; tasks: Task[]; loading: boolean; canWork: boolean; onHold: boolean; onAdd: () => void; onEdit: (t: Task) => void; onUpload: (t: Task) => void;
  onComment: (t: Task) => void; onUpdate: (t: Task, patch: { status?: TaskStatus; completion_pct?: number; priority?: Task['priority'] }) => void; onComplete: (t: Task) => void;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const addable = (w.can_act || w.can_manage) && (w.status === 'NEED_ACTION' || w.status === 'IN_PROGRESS' || w.status === 'ON_HOLD');
  return (
    <Card>
      <CardHeader title="Tasks" description={`${w.completed_tasks} of ${w.total_tasks} completed`}
        actions={addable ? <Button size="sm" onClick={onAdd}><Plus size={14} aria-hidden="true" /> Add task</Button> : undefined} />
      {onHold && <p className="border-b border-border bg-warning-bg px-4 py-2 text-xs text-warning">This work is on hold. Resume it to update tasks.</p>}
      {loading && tasks.length === 0 ? <div className="p-4"><PageSkeleton /></div> : tasks.length === 0 ? (
        <EmptyState icon={ListChecks} title="No tasks yet" description="Break the work into tasks so progress can be measured." action={addable ? <Button size="sm" onClick={onAdd}>Add the first task</Button> : undefined} />
      ) : (
        <ul className="divide-y divide-border">
          {tasks.map((t) => {
            const expanded = openId === t.id;
            const closed = t.status === 'COMPLETED' || t.status === 'CANCELLED';
            return (
              <li key={t.id} className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setOpenId(expanded ? null : t.id)} aria-expanded={expanded}>
                    <span className={`block text-sm font-medium ${t.status === 'COMPLETED' ? 'text-text-muted line-through' : 'text-text'}`}>{t.name}{!t.required && <span className="ml-2 text-xs font-normal text-text-muted">(optional)</span>}</span>
                    <span className="mt-0.5 block text-xs text-text-muted">{t.assigned_to.name} · created {date(t.created_at)} · due {t.due_date ? date(t.due_date) : 'no date'}{t.overdue && <span className="ml-1 font-medium text-danger">overdue</span>}</span>
                  </button>
                  <div className="flex flex-wrap items-center gap-2">
                    <PriorityBadge priority={t.priority} />
                    {canWork ? (
                      <select aria-label={`Status of ${t.name}`} className={`${selectCls} h-8`} value={t.status} onChange={(e) => onUpdate(t, { status: e.target.value as TaskStatus })}>
                        {TASK_STATUSES.map((s) => <option key={s} value={s}>{title(s)}</option>)}
                      </select>
                    ) : <Badge tone={t.status === 'COMPLETED' ? 'success' : t.status === 'WAITING_FOR_CLIENT' ? 'warning' : t.status === 'IN_PROGRESS' ? 'info' : 'neutral'} dot>{title(t.status)}</Badge>}
                    {canWork && !closed && <Button size="sm" variant="secondary" onClick={() => onComplete(t)}><CheckCircle2 size={13} aria-hidden="true" /> Complete</Button>}
                  </div>
                </div>
                <div className="mt-2 max-w-md"><ProgressBar value={t.completion_pct} tone={t.status === 'COMPLETED' ? 'success' : 'primary'} label="Completion" /></div>
                {expanded && (
                  <div className="mt-3 space-y-3 rounded-md bg-surface-secondary p-3 text-sm">
                    {t.description && <p className="text-text-secondary">{t.description}</p>}
                    <div className="flex flex-wrap items-center gap-2">
                      {canWork && !closed && (
                        <label className="inline-flex items-center gap-2 text-xs text-text-muted">Completion %
                          <input type="number" min={0} max={100} step={10} defaultValue={t.completion_pct} aria-label={`Completion percentage of ${t.name}`}
                            onBlur={(e) => { const v = Number(e.target.value); if (v !== t.completion_pct && v >= 0 && v <= 100) onUpdate(t, { completion_pct: v }); }}
                            className={`${selectCls} h-8 w-20`} /></label>
                      )}
                      {canWork && <Button size="sm" variant="ghost" onClick={() => onEdit(t)}><Pencil size={13} aria-hidden="true" /> Edit</Button>}
                      {(w.can_act || w.can_manage) && <Button size="sm" variant="ghost" onClick={() => onComment(t)}><MessageSquarePlus size={13} aria-hidden="true" /> Comment</Button>}
                      {canWork && <Button size="sm" variant="ghost" onClick={() => onUpload(t)}><Upload size={13} aria-hidden="true" /> Attach</Button>}
                    </div>
                    <div>
                      <p className="text-xs font-medium text-text-muted">Comments ({t.comments?.length ?? 0})</p>
                      {(t.comments ?? []).map((c) => <p key={c.id} className="mt-1 text-text-secondary"><strong className="font-medium text-text">{c.user_name}</strong> · {relativeTime(c.created_at)} — {c.text}</p>)}
                    </div>
                    <div>
                      <p className="text-xs font-medium text-text-muted">Attachments ({t.attachments?.length ?? 0})</p>
                      {(t.attachments ?? []).map((a) => <p key={a.id} className="mt-1 inline-flex items-center gap-1.5 text-text-secondary"><FileText size={13} aria-hidden="true" /> {a.filename}</p>)}
                    </div>
                    <div>
                      <p className="text-xs font-medium text-text-muted">Activity history</p>
                      <ActivityFeed items={(t.history ?? []).slice(0, 8)} empty="No activity." compact />
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------- client actions
function ActionsTab({ w, canWork, onHold, running, dialog, start, comments, requests, onResolve }: {
  w: WorkDetail; canWork: boolean; onHold: boolean; running: boolean; dialog: (d: Dialog) => void; start: () => void;
  comments: { id: string; kind: string; text: string; critical: boolean; resolved: boolean; user_name: string; role: string; created_at: string }[];
  requests: ClientRequest[]; onResolve: (id: string) => void;
}) {
  const pending = requests.filter((r) => r.status === 'PENDING');
  const tile = (label: string, icon: ReactNode, onClick: () => void, enabled: boolean, why: string) => (
    <button key={label} type="button" disabled={!enabled} onClick={onClick} title={enabled ? undefined : why}
      className="flex items-center gap-2.5 rounded-md border border-border bg-surface px-3 py-2.5 text-left text-sm font-medium text-text shadow-[var(--shadow-card)] transition-colors hover:border-border-strong hover:bg-surface-secondary disabled:cursor-not-allowed disabled:opacity-45">
      <span className="text-primary" aria-hidden="true">{icon}</span>{label}
    </button>
  );
  const notMine = 'Only the assigned member can do this.';
  const needs = canWork ? 'Resume the work first.' : 'This work is closed.';
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="space-y-4 lg:col-span-2">
        <Card>
          <CardHeader title="Client actions" description={w.can_act ? 'Everything you can do on this work right now' : notMine} />
          <div className="grid gap-2 p-4 sm:grid-cols-2 xl:grid-cols-3">
            {tile('Start work', <PlayCircle size={16} />, start, canWork && w.status === 'NEED_ACTION', w.status === 'NEED_ACTION' ? notMine : 'Work has already started.')}
            {tile('Complete a task', <ListChecks size={16} />, () => undefined, false, 'Open the Tasks tab and use Complete on a task.')}
            {tile('Add note', <StickyNote size={16} />, () => dialog('note'), w.can_act || w.can_manage, notMine)}
            {tile('Add comment', <MessageSquare size={16} />, () => dialog('comment'), w.can_act || w.can_manage, notMine)}
            {tile('Raise an issue', <Flag size={16} />, () => dialog('issue'), w.can_act || w.can_manage, notMine)}
            {tile('Request information', <FileQuestion size={16} />, () => dialog('request-info'), running, onHold ? needs : notMine)}
            {tile('Request document from client', <FilePlus2 size={16} />, () => dialog('request-doc'), running, onHold ? needs : notMine)}
            {tile('Upload document', <Upload size={16} />, () => dialog('upload'), running, onHold ? needs : notMine)}
            {tile('Record client response', <Inbox size={16} />, () => dialog('response'), canWork && pending.length > 0, pending.length ? notMine : 'Nothing is pending from the client.')}
            {tile('Change priority', <Flag size={16} />, () => dialog('priority'), (w.can_act || w.can_manage) && w.status !== 'COMPLETED', notMine)}
            {tile('Change deadline', <CalendarClock size={16} />, () => dialog('deadline'), (w.can_act || w.can_manage) && w.status !== 'COMPLETED', notMine)}
            {tile('Put work on hold', <PauseCircle size={16} />, () => dialog('hold'), canWork && w.status === 'IN_PROGRESS', w.status === 'NEED_ACTION' ? 'Start work first.' : onHold ? 'Already on hold.' : notMine)}
            {tile('Resume work', <RotateCcw size={16} />, () => dialog('resume'), canWork && onHold, 'Only work on hold can be resumed.')}
            {tile('Mark completed', <CheckCircle2 size={16} />, () => dialog('complete'), running, onHold ? 'Resume the work first.' : notMine)}
          </div>
        </Card>
        <Card>
          <CardHeader title="Notes, comments and issues" />
          {comments.length === 0 ? <EmptyState compact icon={MessageSquare} title="Nothing here yet" description="Notes and comments added to this work appear here." /> : (
            <ul className="divide-y divide-border">
              {comments.map((c) => (
                <li key={c.id} className="px-4 py-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <strong className="font-medium text-text">{c.user_name}</strong><span className="text-xs text-text-muted">{c.role} · {relativeTime(c.created_at)}</span>
                    <Badge tone={c.kind === 'ISSUE' ? (c.resolved ? 'success' : c.critical ? 'danger' : 'warning') : 'neutral'}>{c.kind === 'ISSUE' ? `${c.critical ? 'Critical ' : ''}issue${c.resolved ? ' · resolved' : ''}` : title(c.kind)}</Badge>
                    {c.kind === 'ISSUE' && !c.resolved && (w.can_act || w.can_manage) && <Button size="sm" variant="ghost" onClick={() => onResolve(c.id)}>Resolve</Button>}
                  </div>
                  <p className="mt-1 whitespace-pre-wrap text-text-secondary">{c.text}</p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
      <Card className="self-start">
        <CardHeader title="Waiting for client" description={pending.length ? `${pending.length} pending` : 'Nothing pending'} />
        {pending.length === 0 ? <EmptyState compact icon={Hourglass} title="Client owes nothing" description="Requested documents and information show here until received." /> : (
          <ul className="divide-y divide-border">
            {pending.map((r) => {
              const days = Math.floor((Date.now() - new Date(/[zZ]|[+-]\d\d:\d\d$/.test(r.requested_at) ? r.requested_at : `${r.requested_at}Z`).getTime()) / 86400000);
              return (
                <li key={r.id} className="px-4 py-3 text-sm">
                  <p className="font-medium text-text">{r.label}</p>
                  <p className="text-xs text-text-muted">{r.kind === 'DOCUMENT' ? 'Document' : 'Information'} · requested {date(r.requested_at)} · {Math.max(0, days)} day{days === 1 ? '' : 's'} waiting{r.expected_date ? ` · expected ${date(r.expected_date)}` : ''}</p>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------- documents
function DocumentsTab({ requests, files, loading, canWork, onUpload, onDownload }: {
  requests: ClientRequest[]; files: { id: string; label: string; filename: string; size: number; uploaded_by: string; uploaded_at: string }[]; loading: boolean; canWork: boolean;
  onUpload: (requestId?: string) => void; onDownload: (f: { id: string; filename: string }) => void;
}) {
  if (loading) return <PageSkeleton />;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader title="Requested from client" description={`${requests.filter((r) => r.status === 'PENDING').length} pending of ${requests.length}`} />
        {requests.length === 0 ? <EmptyState compact icon={Inbox} title="No requests" description="Request a document or information from the client in Client actions." /> : (
          <ul className="divide-y divide-border">
            {requests.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
                <span className="min-w-0"><span className="block font-medium text-text">{r.label}</span>
                  <span className="block text-xs text-text-muted">{r.kind === 'DOCUMENT' ? 'Document' : 'Information'} · requested {date(r.requested_at)} by {r.requested_by}{r.received_at ? ` · received ${date(r.received_at)}` : r.expected_date ? ` · expected ${date(r.expected_date)}` : ''}{r.mandatory ? '' : ' · optional'}</span></span>
                <span className="flex items-center gap-2"><Badge tone={r.status === 'RECEIVED' ? 'success' : 'warning'} dot>{r.status === 'RECEIVED' ? 'Received' : 'Pending'}</Badge>
                  {r.status === 'PENDING' && r.kind === 'DOCUMENT' && canWork && <Button size="sm" variant="secondary" onClick={() => onUpload(r.id)}><Upload size={13} aria-hidden="true" /> Upload</Button>}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card>
        <CardHeader title="Files" description={`${files.length} uploaded`} actions={canWork ? <Button size="sm" onClick={() => onUpload()}><Upload size={13} aria-hidden="true" /> Upload document</Button> : undefined} />
        {files.length === 0 ? <EmptyState compact icon={FileText} title="No files yet" description="Uploaded documents are stored with this work." /> : (
          <ul className="divide-y divide-border">
            {files.map((f) => (
              <li key={f.id} className="flex items-center justify-between gap-2 px-4 py-3 text-sm">
                <span className="min-w-0"><span className="block truncate font-medium text-text">{f.label}</span><span className="block truncate text-xs text-text-muted">{f.filename} · {(f.size / 1024).toFixed(0)} KB · {f.uploaded_by} · {dateTime(f.uploaded_at)}</span></span>
                <Button size="sm" variant="ghost" onClick={() => onDownload(f)} aria-label={`Download ${f.filename}`}><Download size={14} aria-hidden="true" /></Button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------- timeline
const ACTION_TONE: Record<string, string> = {
  COMPLETED: 'bg-success', ASSIGNED: 'bg-primary', REASSIGNED: 'bg-primary', HOLD_STARTED: 'bg-warning', CLIENT_RESPONDED: 'bg-success', CANCELLED: 'bg-text-muted',
  ISSUE_ADDED: 'bg-danger', PRIORITY_CHANGED: 'bg-info', DEADLINE_CHANGED: 'bg-info',
};

function ActivityFeed({ items, empty, compact = false }: { items: Activity[]; empty: string; compact?: boolean }) {
  if (items.length === 0) return <p className="px-4 py-6 text-center text-sm text-text-muted">{empty}</p>;
  const shown = (v: unknown) => (v === null || v === undefined || v === '' ? null : typeof v === 'string' ? title(v) : String(v));
  return (
    <ol className={compact ? 'space-y-2' : 'space-y-0 px-4 py-2'}>
      {items.map((a) => (
        <li key={a.id} className={`relative flex gap-3 ${compact ? '' : 'py-2.5'}`}>
          <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${ACTION_TONE[a.action] ?? 'bg-border-strong'}`} aria-hidden="true" />
          <div className="min-w-0 text-sm">
            <p className="text-text">{a.summary}</p>
            <p className="text-xs text-text-muted">{dateTime(a.at)} · {a.user_name}{a.role ? ` (${a.role})` : ''}</p>
            {shown(a.old_value) && shown(a.new_value) && !compact && a.action !== 'COMMENT_ADDED' && a.action !== 'NOTE_ADDED' && (
              <p className="mt-0.5 text-xs text-text-secondary">{shown(a.old_value) ?? '—'} <span aria-hidden="true">→</span><span className="sr-only">changed to</span> {shown(a.new_value) ?? '—'}</p>
            )}
            {a.comment && <p className="mt-0.5 whitespace-pre-wrap text-xs text-text-muted">“{a.comment}”</p>}
          </div>
        </li>
      ))}
    </ol>
  );
}

function TimelineTab({ items, loading }: { items?: Activity[]; loading: boolean }) {
  return (
    <Card>
      <CardHeader title="Activity timeline" description="Permanent audit trail: user, role, action, old and new value, comment and time. It cannot be edited." />
      {loading ? <div className="p-4"><PageSkeleton /></div> : <ActivityFeed items={items ?? []} empty="No activity yet." />}
    </Card>
  );
}

// ---------------------------------------------------------------- history
function HistoryTab({ w, history, loading }: { w: WorkDetail; history?: import('./api').WorkHistory; loading: boolean }) {
  if (loading || !history) return <PageSkeleton />;
  const d = history.durations;
  const until = w.completed_at ? duration(d.total) : `${duration(d.total)} so far`;
  const th = 'px-4 py-2.5 text-left text-xs font-medium uppercase tracking-wide text-text-muted';
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Total calendar duration" value={duration(d.total)} hint="completed − assigned" />
        <Stat label="Active working duration" value={duration(d.active)} tone="primary" hint="total − on hold" />
        <Stat label="On-hold duration" value={duration(d.hold)} tone={d.hold ? 'warning' : 'neutral'} hint={`${history.holds.length} hold period${history.holds.length === 1 ? '' : 's'}`} />
        <Stat label="Time until completion" value={until} tone={w.completed_at ? 'success' : 'neutral'} />
      </div>
      <Card>
        <CardHeader title="Lifecycle" description="Server timestamps" />
        <ol className="divide-y divide-border">
          {history.time_logs.map((l) => (
            <li key={l.id} className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-2.5 text-sm">
              <span><strong className="font-medium text-text">{title(l.event)}</strong> <span className="text-text-muted">{l.note}</span></span>
              <span className="text-xs text-text-muted">{dateTime(l.at)} · {l.user_name}</span>
            </li>
          ))}
        </ol>
      </Card>
      <Card>
        <CardHeader title="Hold history" description="Each hold period; totals accumulate across every hold" />
        {history.holds.length === 0 ? <EmptyState compact icon={PauseCircle} title="Never put on hold" /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-border bg-surface-secondary"><th className={th}>Type</th><th className={th}>Reason</th><th className={th}>From</th><th className={th}>To</th><th className={`${th} text-right`}>Duration</th></tr></thead>
              <tbody className="divide-y divide-border">
                {history.holds.map((h) => (
                  <tr key={h.id}>
                    <td className="px-4 py-2.5"><Badge tone={h.type === 'INTERNAL_BLOCKER' ? 'danger' : 'warning'}>{h.type === 'INTERNAL_BLOCKER' ? 'Internal blocker' : 'Waiting for client'}</Badge></td>
                    <td className="max-w-[300px] px-4 py-2.5 text-text-secondary">{h.reason}{h.pending_items.length > 0 && <span className="block text-xs text-text-muted">{h.pending_items.join(', ')}</span>}</td>
                    <td className="whitespace-nowrap px-4 py-2.5">{dateTime(h.started_at)}</td>
                    <td className="whitespace-nowrap px-4 py-2.5">{h.ended_at ? <>{dateTime(h.ended_at)}{h.auto_resumed && <span className="block text-xs text-text-muted">auto-resumed</span>}</> : <Badge tone="warning">Open</Badge>}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{duration(h.duration_seconds)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <Card>
        <CardHeader title="Status history" />
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-border bg-surface-secondary"><th className={th}>When</th><th className={th}>From</th><th className={th}>To</th><th className={th}>By</th><th className={th}>Reason</th></tr></thead>
            <tbody className="divide-y divide-border">
              {history.status_history.map((s) => (
                <tr key={s.id}><td className="whitespace-nowrap px-4 py-2.5">{dateTime(s.at)}</td><td className="px-4 py-2.5">{s.from_status ? title(s.from_status) : '—'}</td><td className="px-4 py-2.5 font-medium text-text">{title(s.to_status)}</td><td className="px-4 py-2.5">{s.user_name}<span className="block text-xs text-text-muted">{s.role}</span></td><td className="px-4 py-2.5 text-text-secondary">{s.reason}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      {w.previous_works.length > 0 && (
        <Card>
          <CardHeader title="Earlier work for this client" description="Previous assignment cycles are kept, never overwritten" />
          <ul className="divide-y divide-border">
            {w.previous_works.map((p) => <li key={p.id}><Link to={`/client-work/${p.id}`} className="flex items-center justify-between px-4 py-2.5 text-sm hover:bg-surface-secondary"><span className="inline-flex items-center gap-2"><History size={14} aria-hidden="true" /> {p.work_no} · assigned {date(p.created_at)}</span><Badge tone={p.status === 'COMPLETED' ? 'success' : 'neutral'}>{title(p.status)}</Badge></Link></li>)}
          </ul>
        </Card>
      )}
      {(w.completion_history?.length ?? 0) > 0 && (
        <Card>
          <CardHeader title="Completion records" description="One per completion; a reopened work keeps the earlier ones" />
          <ul className="divide-y divide-border">
            {w.completion_history!.map((c, i) => <li key={i} className="px-4 py-2.5 text-sm"><strong className="font-medium text-text">{c.completed_by}</strong> · {dateTime(c.completed_at)} · {duration(c.total_duration)} total ({duration(c.active_duration)} active, {duration(c.hold_duration)} on hold) · {c.completed_tasks}/{c.total_tasks} tasks{c.notes ? ` — ${c.notes}` : ''}</li>)}
          </ul>
        </Card>
      )}
    </div>
  );
}
