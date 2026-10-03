import { useState, type DragEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  AlarmClock, ArrowRight, Bell, Briefcase, CircleCheck, Download, FileCheck2, FileClock, FileText, History, Mail, Phone, ShieldAlert,
  Trash2, UserRound, UserRoundCheck,
} from 'lucide-react';
import { api, saveBlob } from '../lib/api';
import { useApi, useDebounced } from '../lib/useApi';
import { useNotifications } from '../lib/notifications';
import { date, dateTime, number, relativeTime } from '../lib/format';
import { useAuth } from '../auth/AuthContext';
import { PageHeader } from '../components/layout/PageHeader';
import { Badge, StatusBadge } from '../components/common/Badge';
import { Button } from '../components/common/Button';
import { Card } from '../components/common/Card';
import { EmptyState } from '../components/common/EmptyState';
import { ErrorState } from '../components/common/ErrorState';
import { Checkbox, Input, SearchInput, Select, Textarea } from '../components/common/Input';
import { Drawer } from '../components/common/Modal';
import { Skeleton } from '../components/common/Skeleton';
import { Tabs } from '../components/common/Tabs';
import { useToast } from '../components/common/ToastContext';
import { StatCard } from '../components/dashboard/StatCard';

interface Stage { key: string; label: string; count: number }
interface Person { user_id: string; name: string; email: string }
interface LegalDocument {
  id: string; label: string; filename: string; content_type?: string | null; size?: number | null;
  source: 'APPROVED' | 'PROVIDED'; by: string; at: string;
}
interface StageMove { from: string; from_label: string; to: string; to_label: string; by: string; at: string; note: string }
interface Reminder {
  id: string; type: 'CALL' | 'EMAIL'; due_at: string; note: string; owner: Person; created_by: Person; created_at: string;
  done_at?: string | null; case_key: string; company_name: string;
}
interface OpsCase {
  key: string; kind: 'record' | 'document'; id: string; reference: string; company_name: string;
  contact_name: string; contact_email: string; contact_phone: string; gstin: string; bdm: string; services: string[];
  amount?: number | null; legal_status: string; legal_approved: boolean; created_at: string;
  assigned_to?: Person | null; assigned_by?: Person | null; assigned_at?: string | null;
  stage: string; stage_label: string; stage_since: string; stage_by: string;
  documents: LegalDocument[]; pending_review: number; next_reminder?: Reminder | null;
  history?: StageMove[]; reminders?: Reminder[];
}
type View = 'unassigned' | 'mine' | 'by_me' | 'all';
interface Board {
  view: View; views: Partial<Record<View, number>>; stages: Stage[]; cases: OpsCase[]; total: number;
  documents_total: number; awaiting_legal: number; can_manage: boolean;
}

const VIEW_LABELS: Record<View, string> = { unassigned: 'Unassigned', mine: 'Assigned to me', by_me: 'Assigned by me', all: 'All cases' };
const REMINDER_LABEL = { CALL: 'Call', EMAIL: 'Email' } as const;
const kb = (n?: number | null) => (!n ? '' : n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const caseUrl = (c: Pick<OpsCase, 'kind' | 'id'>) => `/api/operations/cases/${c.kind}/${encodeURIComponent(c.id)}`;
const fromKey = (key: string) => {
  const [kind, ...rest] = key.split(':');
  return { kind: kind as OpsCase['kind'], id: rest.join(':') };
};
// The backend stores UTC without a zone marker.
const toMs = (v?: string | null) => (v ? new Date(/[zZ]|[+-]\d\d:\d\d$/.test(v) ? v : `${v}Z`).getTime() : 0);
const overdue = (r?: Reminder | null) => !!r && toMs(r.due_at) <= Date.now();
const localInput = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);

function SourceBadge({ source }: { source: LegalDocument['source'] }) {
  return source === 'APPROVED' ? <Badge tone="success">Approved by Legal</Badge> : <Badge tone="info">Provided by Legal</Badge>;
}

function ReminderLine({ r }: { r: Reminder }) {
  const Icon = r.type === 'CALL' ? Phone : Mail;
  return (
    <span className={`inline-flex items-center gap-1 ${overdue(r) ? 'text-danger' : 'text-text-muted'}`}>
      <Icon size={12} aria-hidden="true" />{REMINDER_LABEL[r.type]} {overdue(r) ? 'due' : dateTime(r.due_at)}
    </span>
  );
}

/** `/operations`: the board as its own page. */
export function OperationDashboard() {
  return (
    <>
      <PageHeader
        title="Operation dashboard"
        description="Client cases by stage, with the documents the Legal team provided or approved."
        breadcrumbs={[{ label: 'Dashboard', to: '/dashboard' }, { label: 'Operation dashboard' }]}
      />
      <OperationBoard />
    </>
  );
}

/**
 * The Operation dashboard: unassigned cases first, then the ones assigned to you or by you (managers also see all),
 * your call and email reminders, and your notifications. Also shown on the Admin dashboard.
 */
export function OperationBoard({ embedded = false }: { embedded?: boolean }) {
  const { showToast } = useToast();
  const [tab, setTab] = useState<View | 'reminders' | 'notifications'>('unassigned');
  const [search, setSearch] = useState('');
  const [withDocs, setWithDocs] = useState(false);
  const [open, setOpen] = useState<Pick<OpsCase, 'kind' | 'id' | 'key'> | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const q = useDebounced(search);
  const view: View = tab === 'reminders' || tab === 'notifications' ? 'unassigned' : tab;
  const board = useApi(() => api.get<Board>('/api/operations/board', { view, search: q, with_documents: withDocs || undefined }), [view, q, withDocs]);
  const reminders = useApi(() => api.get<{ items: Reminder[] }>('/api/operations/reminders'), []);
  const notifications = useNotifications();
  const data = board.data;
  const myReminders = reminders.data?.items ?? [];
  const due = myReminders.filter(overdue).length;
  const reload = () => { board.reload(); reminders.reload(); };

  const move = async (c: Pick<OpsCase, 'kind' | 'id' | 'company_name'>, stage: string, note = '') => {
    try {
      const updated = await api.put<OpsCase>(`${caseUrl(c)}/stage`, { stage, note });
      showToast(`${c.company_name} moved to ${updated.stage_label}`, 'success');
      board.reload();
      return updated;
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not move the case', 'error');
      return null;
    }
  };

  const drop = (e: DragEvent, stage: string) => {
    e.preventDefault();
    const c = data?.cases.find((x) => x.key === e.dataTransfer.getData('text/plain'));
    setDragging(null);
    if (c && c.stage !== stage) move(c, stage);
  };

  const views = (['unassigned', 'mine', 'by_me', 'all'] as View[]).filter((v) => v !== 'all' || data?.can_manage);
  const tabs = [
    ...views.map((v) => ({ id: v, label: VIEW_LABELS[v], count: data?.views[v] })),
    { id: 'reminders', label: 'My reminders', count: myReminders.length },
    { id: 'notifications', label: 'Notifications', count: notifications.unreadCount || undefined },
  ];

  return (
    <div className={embedded ? 'mb-6' : ''}>
      {embedded && (
        <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="text-base font-semibold text-text">Operation dashboard</h2>
            <p className="text-xs text-text-muted">Client cases by stage, with the documents Legal provided or approved.</p>
          </div>
          <Link to="/operations" className="text-xs font-medium text-primary hover:underline">Open full page</Link>
        </div>
      )}
      <Tabs tabs={tabs} active={tab} onChange={(id) => setTab(id as typeof tab)} className="mb-4" />

      {tab === 'reminders' ? (
        <RemindersList items={myReminders} loading={reminders.loading} error={reminders.status === 'error' ? reminders.error : ''}
          onOpen={(r) => setOpen({ ...fromKey(r.case_key), key: r.case_key })} onChanged={reload} />
      ) : tab === 'notifications' ? (
        <NotificationsList />
      ) : (
        <>
          <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard icon={Briefcase} label={VIEW_LABELS[view]} value={data ? number(data.total) : <Skeleton className="h-7 w-10" />} hint="Client cases in this view" />
            <StatCard icon={FileCheck2} tone="success" label="Documents from Legal" value={data ? number(data.documents_total) : <Skeleton className="h-7 w-10" />} hint="Provided or approved" />
            <StatCard icon={FileClock} tone={data?.awaiting_legal ? 'warning' : 'info'} label="Waiting for Legal approval" value={data ? number(data.awaiting_legal) : <Skeleton className="h-7 w-10" />} hint="Can't leave Onboarding yet" />
            <StatCard icon={AlarmClock} tone={due ? 'danger' : 'info'} label="Reminders due" value={reminders.data ? number(due) : <Skeleton className="h-7 w-10" />} hint={`${myReminders.length} open for you`} />
          </div>

          <Card className="mb-4 flex flex-wrap items-end gap-3 p-3">
            <SearchInput value={search} onChange={setSearch} label="Search cases" placeholder="Search company, reference, BDM, service…" />
            <Checkbox className="pb-2" label="Only cases with Legal documents" checked={withDocs} onChange={(e) => setWithDocs(e.target.checked)} />
            <p className="ml-auto pb-2 text-xs text-text-muted">Drag a card to another stage, or open it to assign, move or set a reminder.</p>
          </Card>

          {board.status === 'error' ? (
            <Card><ErrorState onRetry={board.reload} message={board.error} /></Card>
          ) : !data ? (
            <div className="flex gap-3 overflow-hidden">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-72 w-72 shrink-0" />)}</div>
          ) : data.total === 0 ? (
            <Card>
              <EmptyState icon={Briefcase} title={view === 'unassigned' ? 'No unassigned cases' : `Nothing ${VIEW_LABELS[view].toLowerCase()}`}
                description={view === 'unassigned' ? 'Clients added in the Legal module appear here, starting at Onboarding.' : 'Assign a case from the Unassigned tab.'} />
            </Card>
          ) : (
            <div className="-mx-1 flex gap-3 overflow-x-auto px-1 pb-3">
              {data.stages.map((s, i) => {
                const cases = data.cases.filter((c) => c.stage === s.key);
                return (
                  <section
                    key={s.key}
                    aria-label={s.label}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => drop(e, s.key)}
                    className={`flex w-72 shrink-0 flex-col rounded-lg border bg-surface-secondary ${dragging ? 'border-dashed border-border-strong' : 'border-border'}`}
                  >
                    <header className="flex items-center justify-between gap-2 border-b border-border px-3 py-2.5">
                      <h3 className="truncate text-sm font-semibold text-text"><span className="mr-1.5 text-text-muted">{i + 1}.</span>{s.label}</h3>
                      <span className="rounded-full bg-neutral-bg px-2 py-0.5 text-xs font-medium text-text-secondary tabular-nums">{s.count}</span>
                    </header>
                    <div className="flex max-h-[65vh] min-h-24 flex-col gap-2 overflow-y-auto p-2">
                      {cases.length === 0 && <p className="px-1 py-6 text-center text-xs text-text-muted">No cases at this stage</p>}
                      {cases.map((c) => (
                        <button
                          key={c.key}
                          type="button"
                          draggable={c.legal_approved}
                          onDragStart={(e) => { e.dataTransfer.setData('text/plain', c.key); setDragging(c.key); }}
                          onDragEnd={() => setDragging(null)}
                          onClick={() => setOpen(c)}
                          className={`rounded-md border border-border bg-surface p-3 text-left shadow-[var(--shadow-card)] transition-colors hover:border-border-strong ${dragging === c.key ? 'opacity-50' : ''}`}
                        >
                          <span className="flex items-center justify-between gap-2">
                            <span className="font-mono text-xs font-semibold text-primary">{c.reference || '—'}</span>
                            {c.legal_approved ? <StatusBadge status={c.legal_status} /> : <Badge tone="warning">Waiting for Legal</Badge>}
                          </span>
                          <span className="mt-1.5 block truncate text-sm font-medium text-text">{c.company_name}</span>
                          {(c.services.length > 0 || c.bdm) && <span className="mt-0.5 block truncate text-xs text-text-muted">{c.services.join(', ') || c.bdm}</span>}
                          <span className="mt-2 flex items-center justify-between gap-2 text-xs text-text-muted">
                            <span className={`inline-flex items-center gap-1 ${c.documents.length ? 'text-success' : ''}`}>
                              <FileText size={12} aria-hidden="true" />
                              {c.documents.length} {c.documents.length === 1 ? 'document' : 'documents'}
                              {c.pending_review > 0 && <span className="text-warning">· {c.pending_review} awaiting</span>}
                            </span>
                            <span>since {date(c.stage_since?.slice(0, 10))}</span>
                          </span>
                          <span className="mt-1 flex items-center justify-between gap-2 text-xs">
                            <span className="inline-flex min-w-0 items-center gap-1 truncate text-text-muted">
                              <UserRound size={12} aria-hidden="true" />{c.assigned_to?.name ?? 'Unassigned'}
                            </span>
                            {c.next_reminder && <ReminderLine r={c.next_reminder} />}
                          </span>
                        </button>
                      ))}
                    </div>
                  </section>
                );
              })}
            </div>
          )}
        </>
      )}

      {open && data && (
        <CaseDrawer key={open.key} target={open} stages={data.stages} onClose={() => setOpen(null)} onMove={move} onChanged={reload} />
      )}
    </div>
  );
}

function RemindersList({ items, loading, error, onOpen, onChanged }: {
  items: Reminder[]; loading: boolean; error: string; onOpen: (r: Reminder) => void; onChanged: () => void;
}) {
  const { showToast } = useToast();
  const done = async (r: Reminder) => {
    try {
      await api.post(`/api/operations/reminders/${r.id}/done`);
      showToast('Reminder done', 'success');
      onChanged();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not update the reminder', 'error');
    }
  };
  if (error) return <Card><ErrorState message={error} onRetry={onChanged} /></Card>;
  if (loading && items.length === 0) return <Skeleton className="h-40 w-full" />;
  if (items.length === 0) return <Card><EmptyState icon={AlarmClock} title="No open reminders" description="Set a call or email reminder from any case to follow up with the client." /></Card>;
  return (
    <Card>
      <ul className="divide-y divide-border">
        {items.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
            <button type="button" onClick={() => onOpen(r)} className="min-w-0 flex-1 text-left">
              <span className="flex items-center gap-2 text-sm font-medium text-text">
                {r.type === 'CALL' ? <Phone size={14} aria-hidden="true" /> : <Mail size={14} aria-hidden="true" />}
                {REMINDER_LABEL[r.type]} {r.company_name}
                {overdue(r) && <Badge tone="danger">Due</Badge>}
              </span>
              <span className="block text-xs text-text-muted">{dateTime(r.due_at)}{r.note ? ` · ${r.note}` : ''}{r.created_by.user_id !== r.owner.user_id ? ` · set by ${r.created_by.name}` : ''}</span>
            </button>
            <Button size="sm" variant="secondary" onClick={() => done(r)}><CircleCheck size={13} /> Done</Button>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** Everything the bell holds: announcements from Super Admin and HR, approvals, assignments and due reminders. */
function NotificationsList() {
  const navigate = useNavigate();
  const { items, loading, error, isUnread, markAllRead, unreadCount, reload } = useNotifications();
  if (error && items.length === 0) return <Card><ErrorState onRetry={reload} message="We couldn't load your notifications." /></Card>;
  if (loading && items.length === 0) return <Skeleton className="h-40 w-full" />;
  if (items.length === 0) return <Card><EmptyState icon={Bell} title="You're all caught up" description="Announcements from Super Admin and HR, assignments and reminders appear here." /></Card>;
  return (
    <Card>
      {unreadCount > 0 && (
        <div className="flex justify-end border-b border-border px-4 py-2"><Button size="sm" variant="ghost" onClick={markAllRead}>Mark all as read</Button></div>
      )}
      <ul className="divide-y divide-border">
        {items.map((n) => (
          <li key={n.id}>
            <button type="button" onClick={() => navigate(n.type === 'broadcast' ? '/notifications' : n.link)} className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-surface-secondary">
              <span className="min-w-0 flex-1">
                <span className={`block text-sm ${isUnread(n) ? 'font-semibold text-text' : 'text-text-secondary'}`}>{n.title}</span>
                <span className="block truncate text-xs text-text-muted">{n.description}</span>
              </span>
              <span className="flex shrink-0 items-center gap-2 text-xs text-text-muted">
                {relativeTime(n.timestamp)}
                {isUnread(n) && <span className="h-2 w-2 rounded-full bg-primary" aria-label="Unread" />}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function CaseDrawer({ target, stages, onClose, onMove, onChanged }: {
  target: Pick<OpsCase, 'kind' | 'id' | 'key'>; stages: Stage[]; onClose: () => void;
  onMove: (c: OpsCase, stage: string, note?: string) => Promise<OpsCase | null>; onChanged: () => void;
}) {
  const { showToast } = useToast();
  const { user } = useAuth();
  const detail = useApi(() => api.get<OpsCase>(caseUrl(target)), [target.key]);
  const admins = useApi(() => api.get<{ items: Person[] }>('/api/operations/assignees'), []);
  const c = detail.data;
  const [stage, setStage] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [assignee, setAssignee] = useState<string | null>(null);
  const [rType, setRType] = useState<'CALL' | 'EMAIL'>('CALL');
  const [rDue, setRDue] = useState(() => localInput(new Date(Date.now() + 24 * 3600 * 1000)));
  const [rNote, setRNote] = useState('');
  const [busy, setBusy] = useState('');

  if (detail.status === 'error') {
    return <Drawer open onClose={onClose} title="Client case"><ErrorState message={detail.error} onRetry={detail.reload} /></Drawer>;
  }
  if (!c) {
    return <Drawer open onClose={onClose} title="Client case"><Skeleton className="h-64 w-full" /></Drawer>;
  }

  const index = stages.findIndex((s) => s.key === c.stage);
  const next = stages[index + 1];
  const chosenStage = stage ?? c.stage;
  const chosenAssignee = assignee ?? c.assigned_to?.user_id ?? '';

  const run = async (what: string, fn: () => Promise<OpsCase | null | void>) => {
    setBusy(what);
    try {
      const updated = await fn();
      if (updated) detail.setData(updated);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Something went wrong', 'error');
    } finally {
      setBusy('');
    }
  };

  const save = (to: string) => run('stage', async () => {
    const updated = await onMove(c, to, note);
    if (updated) { setStage(null); setNote(''); }
    return updated;
  });

  const assign = (userId: string | null) => run('assign', async () => {
    const updated = await api.put<OpsCase>(`${caseUrl(c)}/assign`, { user_id: userId });
    showToast(userId ? `Assigned to ${updated.assigned_to?.name}` : 'Case unassigned', 'success');
    setAssignee(null);
    onChanged();
    return updated;
  });

  const addReminder = () => run('reminder', async () => {
    await api.post(`${caseUrl(c)}/reminders`, { type: rType, due_at: new Date(rDue).toISOString(), note: rNote });
    showToast(`${REMINDER_LABEL[rType]} reminder set`, 'success');
    setRNote('');
    onChanged();
    detail.reload();
  });

  const reminderAction = (r: Reminder, action: 'done' | 'delete') => run(`r-${r.id}`, async () => {
    if (action === 'done') await api.post(`/api/operations/reminders/${r.id}/done`);
    else await api.delete(`/api/operations/reminders/${r.id}`);
    onChanged();
    detail.reload();
  });

  const download = async (d: LegalDocument) => {
    try {
      saveBlob(await api.blob(`${caseUrl(c)}/documents/${d.id}`), d.filename);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Download failed', 'error');
    }
  };

  const facts: [string, string][] = [
    ['Reference', c.reference], ['Legal status', c.legal_status.charAt(0) + c.legal_status.slice(1).toLowerCase()],
    ['Contact', [c.contact_name, c.contact_email, c.contact_phone].filter(Boolean).join(' · ')], ['GSTIN', c.gstin],
    [c.kind === 'record' ? 'BDM' : 'Submitted by', c.bdm], ['Services', c.services.join(', ')],
    ['Amount paid', c.amount != null ? `₹${Number(c.amount).toLocaleString('en-IN')}` : ''], ['Added', date(c.created_at?.slice(0, 10))],
  ];
  const openReminders = (c.reminders ?? []).filter((r) => !r.done_at);
  const section = 'mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted';

  return (
    <Drawer open onClose={onClose} title={c.company_name}>
      <div className="space-y-6">
        <div>
          <p className="text-xs text-text-muted">Current stage</p>
          <p className="mt-0.5 text-base font-semibold text-text">{index + 1}. {c.stage_label}</p>
          <p className="text-xs text-text-muted">Since {dateTime(c.stage_since)}{c.stage_by ? ` · moved by ${c.stage_by}` : ''}</p>
          {!c.legal_approved && (
            <p className="mt-2 flex items-start gap-1.5 rounded-md bg-warning-bg px-3 py-2 text-xs text-warning">
              <ShieldAlert size={14} className="mt-px shrink-0" aria-hidden="true" />
              Onboarding finishes once Legal approves this client's documents. Until then the case stays here.
            </p>
          )}
          <div className="mt-3 space-y-2 rounded-md border border-border p-3">
            <Select label="Move to stage" value={chosenStage} onChange={(e) => setStage(e.target.value)} disabled={!c.legal_approved}>
              {stages.map((s, i) => <option key={s.key} value={s.key}>{i + 1}. {s.label}</option>)}
            </Select>
            <Textarea label="Note (optional)" rows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} disabled={!c.legal_approved} />
            <div className="flex flex-wrap justify-end gap-2">
              {next && <Button variant="secondary" size="sm" loading={busy === 'stage'} disabled={!c.legal_approved} onClick={() => save(next.key)}>Next: {next.label} <ArrowRight size={13} /></Button>}
              <Button size="sm" loading={busy === 'stage'} disabled={chosenStage === c.stage} onClick={() => save(chosenStage)}>Move</Button>
            </div>
          </div>
        </div>

        <div>
          <p className={section}>Assigned to</p>
          <p className="text-sm text-text">
            {c.assigned_to ? <>{c.assigned_to.name}<span className="text-text-muted"> · by {c.assigned_by?.name}, {dateTime(c.assigned_at)}</span></> : <span className="text-text-muted">Not assigned yet</span>}
          </p>
          <div className="mt-2 flex flex-wrap items-end gap-2">
            <Select label="Admin" value={chosenAssignee} onChange={(e) => setAssignee(e.target.value)} className="min-w-0 flex-1">
              <option value="">Choose an Admin…</option>
              {(admins.data?.items ?? []).map((p) => <option key={p.user_id} value={p.user_id}>{p.name}{p.email && p.email !== p.name ? ` (${p.email})` : ''}</option>)}
            </Select>
            <Button size="sm" loading={busy === 'assign'} disabled={!chosenAssignee || chosenAssignee === c.assigned_to?.user_id} onClick={() => assign(chosenAssignee)}>
              <UserRoundCheck size={13} /> Assign
            </Button>
            {!c.assigned_to && user && (admins.data?.items ?? []).some((p) => p.user_id === user.id) && (
              <Button size="sm" variant="secondary" loading={busy === 'assign'} onClick={() => assign(user.id)}>Assign to me</Button>
            )}
            {c.assigned_to && <Button size="sm" variant="ghost" loading={busy === 'assign'} onClick={() => assign(null)}>Unassign</Button>}
          </div>
        </div>

        <div>
          <p className={section}>Call &amp; email reminders</p>
          {openReminders.length > 0 && (
            <ul className="mb-3 divide-y divide-border rounded-md border border-border">
              {openReminders.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-2 px-3 py-2">
                  <span className="min-w-0 text-xs">
                    <ReminderLine r={r} />
                    <span className="block text-text-muted">{overdue(r) ? `${dateTime(r.due_at)} · ` : ''}for {r.owner.name}{r.note ? ` · ${r.note}` : ''}</span>
                  </span>
                  <span className="flex shrink-0 gap-1">
                    <Button size="icon-sm" variant="ghost" aria-label="Mark done" loading={busy === `r-${r.id}`} onClick={() => reminderAction(r, 'done')}><CircleCheck size={14} /></Button>
                    <Button size="icon-sm" variant="danger-ghost" aria-label="Delete reminder" onClick={() => reminderAction(r, 'delete')}><Trash2 size={14} /></Button>
                  </span>
                </li>
              ))}
            </ul>
          )}
          <div className="grid gap-2 sm:grid-cols-[110px_1fr]">
            <Select label="Type" value={rType} onChange={(e) => setRType(e.target.value as 'CALL' | 'EMAIL')}>
              <option value="CALL">Call</option>
              <option value="EMAIL">Email</option>
            </Select>
            <Input label="Remind at" type="datetime-local" value={rDue} onChange={(e) => setRDue(e.target.value)} />
          </div>
          <Textarea className="mt-2" label="What to follow up on (optional)" rows={2} maxLength={1000} value={rNote} onChange={(e) => setRNote(e.target.value)} />
          <div className="mt-2 flex items-center justify-between gap-2">
            <p className="text-xs text-text-muted">Reminds {c.assigned_to?.name ?? 'you'} in the app and by email.</p>
            <Button size="sm" loading={busy === 'reminder'} disabled={!rDue} onClick={addReminder}><AlarmClock size={13} /> Set reminder</Button>
          </div>
        </div>

        <div>
          <p className={section}>Documents from Legal ({c.documents.length})</p>
          {c.documents.length === 0 ? (
            <p className="text-text-muted">Nothing provided or approved by Legal yet.</p>
          ) : (
            <ul className="divide-y divide-border rounded-md border border-border">
              {c.documents.map((d) => (
                <li key={d.id} className="flex items-center justify-between gap-3 px-3 py-2">
                  <span className="min-w-0">
                    <span className="block text-text">{d.label}</span>
                    <span className="block truncate text-xs text-text-muted">{[d.filename, kb(d.size)].filter(Boolean).join(' · ')}</span>
                    <span className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-text-muted"><SourceBadge source={d.source} />{d.by}{d.at ? `, ${dateTime(d.at)}` : ''}</span>
                  </span>
                  <Button size="sm" variant="secondary" onClick={() => download(d)} aria-label={`Download ${d.label}`}><Download size={13} /></Button>
                </li>
              ))}
            </ul>
          )}
          {c.pending_review > 0 && (
            <p className="mt-2 text-xs text-warning">{c.pending_review} client {c.pending_review === 1 ? 'file is' : 'files are'} waiting for Legal approval.</p>
          )}
        </div>

        <div>
          <p className={section}>Client details</p>
          <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
            {facts.map(([k, v]) => (
              <div key={k}><dt className="text-xs text-text-muted">{k}</dt><dd className="break-words text-text">{v || '—'}</dd></div>
            ))}
          </dl>
        </div>

        <div>
          <p className={`${section} flex items-center gap-1.5`}><History size={13} aria-hidden="true" />Stage history</p>
          {(c.history ?? []).length === 0 ? (
            <p className="text-text-muted">Not moved yet: started at {stages[0]?.label}.</p>
          ) : (
            <ol className="space-y-2">
              {(c.history ?? []).map((h, i) => (
                <li key={`${h.at}-${i}`} className="rounded-md border border-border px-3 py-2">
                  <p className="text-text">{h.from_label} <ArrowRight size={12} className="inline" aria-hidden="true" /> {h.to_label}</p>
                  <p className="text-xs text-text-muted">{h.by} · {dateTime(h.at)}</p>
                  {h.note && <p className="mt-1 whitespace-pre-line text-xs text-text-secondary">{h.note}</p>}
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
    </Drawer>
  );
}
