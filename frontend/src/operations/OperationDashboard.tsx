import { useState, type DragEvent, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  AlarmClock, ArrowLeft, ArrowRight, Bell, Briefcase, Check, ChevronDown, CircleCheck, Columns3, Download, Eye, FileText, FolderKanban,
  History, Inbox, Mail, Pencil, Phone, Plus, Search, Send, ShieldAlert, Trash2, UserRound, UserRoundCheck, Wrench, X, type LucideIcon,
} from 'lucide-react';
import { api, saveBlob } from '../lib/api';
import { useApi, useDebounced } from '../lib/useApi';
import { useNotifications } from '../lib/notifications';
import { dateTime, relativeTime } from '../lib/format';
import { useAuth } from '../auth/AuthContext';
import { PageHeader } from '../components/layout/PageHeader';
import { Badge, StatusBadge } from '../components/common/Badge';
import { Button } from '../components/common/Button';
import { Card } from '../components/common/Card';
import { EmptyState } from '../components/common/EmptyState';
import { ErrorState } from '../components/common/ErrorState';
import { Input, Select, Textarea } from '../components/common/Input';
import { Drawer } from '../components/common/Modal';
import { Skeleton } from '../components/common/Skeleton';
import { useToast } from '../components/common/ToastContext';
import { useConfirm } from '../components/common/ConfirmDialog';

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
  amount?: number | null; legal_status: string; legal_approved: boolean; legal_approved_at: string; current_status: string; created_at: string;
  assigned_to?: Person | null; assigned_by?: Person | null; assigned_at?: string | null;
  stage: string; stage_label: string; stage_since: string; stage_by: string; max_stage?: string | null; max_stage_label?: string;
  documents: LegalDocument[]; pending_review: number; next_reminder?: Reminder | null;
  history?: StageMove[]; reminders?: Reminder[];
}
type View = 'unassigned' | 'mine' | 'by_me' | 'all';
interface Board {
  view: View; views: Partial<Record<View, number>>; stages: Stage[]; cases: OpsCase[]; total: number;
  documents_total: number; awaiting_legal: number; can_manage: boolean;
}

interface Service { id: string; name: string }

const SECTION_TITLES: Record<View, string> = {
  unassigned: 'Unassigned CRM Entries', mine: 'My Assigned CRM Entries', by_me: 'CRM Entries I Assigned', all: 'All CRM Entries',
};
const REMINDER_LABEL = { CALL: 'Call', EMAIL: 'Email' } as const;
const caseUrl = (c: Pick<OpsCase, 'kind' | 'id'>) => `/api/operations/cases/${c.kind}/${encodeURIComponent(c.id)}`;
const fromKey = (key: string) => {
  const [kind, ...rest] = key.split(':');
  return { kind: kind as OpsCase['kind'], id: rest.join(':') };
};
// The backend stores UTC without a zone marker.
const toMs = (v?: string | null) => (v ? new Date(/[zZ]|[+-]\d\d:\d\d$/.test(v) ? v : `${v}Z`).getTime() : 0);
const overdue = (r?: Reminder | null) => !!r && toMs(r.due_at) <= Date.now();
const localInput = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);

/** Collapsible section with the amber header used across the Operation dashboard. */
function Section({ icon: Icon, title, children, defaultOpen = true }: { icon: typeof Bell; title: ReactNode; children: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="mb-4 overflow-hidden rounded-xl border border-border bg-surface-secondary">
      <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-3 border-b border-amber-200/70 bg-amber-50/70 px-4 py-3 text-left dark:border-amber-900/50 dark:bg-amber-950/30">
        <span className="flex items-center gap-2 text-sm font-semibold text-amber-700 dark:text-amber-400"><Icon size={16} aria-hidden="true" />{title}</span>
        <ChevronDown size={18} aria-hidden="true" className={`text-text-muted transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && <div className="p-3 sm:p-4">{children}</div>}
    </div>
  );
}

function DocsReady() {
  return <span className="inline-flex items-center gap-1 text-xs text-success"><FileText size={12} aria-hidden="true" />Legal documents ready</span>;
}

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

/** Each part of the Operation dashboard is one big picture tile on the home screen. */
type Screen = View | 'stages' | 'reminders' | 'notifications' | 'services';
const SCREENS: Screen[] = ['unassigned', 'mine', 'by_me', 'all', 'stages', 'reminders', 'notifications', 'services'];
// Flat colours from the dashboards' app-launcher palette, picked so neighbouring tiles differ.
const TILES: Record<Screen, { label: string; icon: LucideIcon; color: string }> = {
  unassigned: { label: 'Unassigned', icon: Inbox, color: 'bg-[#D9822B]' },
  mine: { label: 'Assigned to me', icon: UserRoundCheck, color: 'bg-[#2E86DE]' },
  by_me: { label: 'Assigned by me', icon: Send, color: 'bg-[#6C4AB6]' },
  all: { label: 'All cases', icon: FolderKanban, color: 'bg-[#1E8C7E]' },
  stages: { label: 'Stages', icon: Columns3, color: 'bg-[#2C5F8A]' },
  reminders: { label: 'Reminders', icon: AlarmClock, color: 'bg-[#C0392B]' },
  notifications: { label: 'Notifications', icon: Bell, color: 'bg-[#B5485D]' },
  services: { label: 'Services', icon: Wrench, color: 'bg-[#8E9F2E]' },
};

function TileIcon({ screen, size = 'lg' }: { screen: Screen; size?: 'lg' | 'sm' }) {
  const { icon: Icon, color } = TILES[screen];
  return (
    <span className={`flex shrink-0 items-center justify-center text-white ${color} ${size === 'lg'
      ? 'h-16 w-16 rounded-xl shadow-[0_6px_14px_rgba(0,0,0,0.35)] sm:h-[72px] sm:w-[72px]' : 'h-9 w-9 rounded-lg shadow-sm'}`}>
      <Icon size={size === 'lg' ? 34 : 18} strokeWidth={2.2} aria-hidden="true" />
    </span>
  );
}

/**
 * The Operation dashboard. Its home screen is a search bar over a grid of big tiles: unassigned cases first, then the
 * ones assigned to you or by you (managers also get all cases and the services list), the stage board, your call and
 * email reminders, and your notifications. Also shown on the Admin dashboard.
 */
export function OperationBoard({ embedded = false }: { embedded?: boolean }) {
  const { showToast } = useToast();
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const [localScreen, setLocalScreen] = useState<Screen | 'home'>('home');
  const asked = params.get('show') as Screen | null;
  // On its own page the open tile lives in the address, so the browser's Back button returns to the tiles.
  const screen: Screen | 'home' = embedded ? localScreen : asked && SCREENS.includes(asked) ? asked : 'home';
  const go = (s: Screen | 'home') => (embedded ? setLocalScreen(s) : setParams(s === 'home' ? {} : { show: s }));
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState<Pick<OpsCase, 'kind' | 'id' | 'key'> | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const q = useDebounced(search).trim();
  const searching = screen === 'home' && q !== '';
  const manage = can('operations.dashboard.manage');
  const admins = useApi(() => api.get<{ items: Person[] }>('/api/operations/assignees'), []);
  const services = useApi(() => api.get<{ items: Service[] }>('/api/operations/services'), []);
  const view: View = screen === 'unassigned' || screen === 'mine' || screen === 'by_me' ? screen : 'all';
  const board = useApi(() => api.get<Board>('/api/operations/board', { view, search: searching ? q : '' }), [view, searching ? q : '']);
  const reminders = useApi(() => api.get<{ items: Reminder[] }>('/api/operations/reminders'), []);
  const notifications = useNotifications();
  const data = board.data;
  const myReminders = reminders.data?.items ?? [];
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

  const flags: Partial<Record<Screen, string>> = {
    reminders: myReminders.some(overdue) ? 'Due' : undefined,
    notifications: notifications.unreadCount ? 'New' : undefined,
  };
  const tiles = SCREENS.filter((s) => (s !== 'all' && s !== 'services') || manage);

  const entries = (title: string, empty = 'No entries found.') => (
    board.status === 'error' ? <Card><ErrorState onRetry={board.reload} message={board.error} /></Card>
      : !data ? <Skeleton className="h-64 w-full" />
        : (
          <Section icon={UserRoundCheck} title={`${title} (Newest legal approval first)`}>
            {data.total === 0 ? (
              <p className="rounded-lg border border-dashed border-border bg-surface py-8 text-center text-sm text-text-muted">{empty}</p>
            ) : (
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {data.cases.map((c) => (
                  <EntryCard key={c.key} c={c} stages={data.stages} admins={admins.data?.items ?? []} onView={() => setOpen(c)} onChanged={reload} />
                ))}
              </div>
            )}
          </Section>
        )
  );

  return (
    <div className={embedded ? 'mb-6' : ''}>
      {screen === 'home' ? (
        <>
          <div className="rounded-2xl bg-[linear-gradient(160deg,#1b1f5e_0%,#2a3a9c_45%,#4a5fd0_100%)] p-4 shadow-[var(--shadow-card)] sm:p-6">
            {embedded && (
              <div className="mb-3 flex flex-wrap items-end justify-between gap-2 text-white [text-shadow:0_1px_2px_rgba(0,0,0,0.3)]">
                <h2 className="text-lg font-semibold">Operation dashboard</h2>
                <Link to="/operations" className="text-xs font-medium text-white/85 hover:text-white hover:underline">Open full page</Link>
              </div>
            )}
            <label className="flex items-center gap-2 rounded-lg bg-white/10 px-3 py-2.5 text-white ring-1 ring-white/15 focus-within:ring-white/50">
              <Search size={17} aria-hidden="true" className="shrink-0 text-white/80" />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search a client…" aria-label="Search clients"
                className="min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-white/60" />
              {search && <button type="button" onClick={() => setSearch('')} aria-label="Clear search" className="text-white/70 hover:text-white"><X size={16} /></button>}
            </label>
            {!searching && (
              <div className="mt-6 grid grid-cols-3 gap-x-2 gap-y-5 sm:grid-cols-4 md:grid-cols-6 xl:grid-cols-8">
                {tiles.map((s) => (
                  <button key={s} type="button" onClick={() => go(s)}
                    className="group flex flex-col items-center gap-2 rounded-xl p-2 transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white">
                    <span className="relative transition-transform group-hover:-translate-y-0.5">
                      <TileIcon screen={s} />
                      {flags[s] && <span className="absolute -right-2 -top-2 rounded-full bg-danger px-2 py-0.5 text-[11px] font-semibold text-white shadow">{flags[s]}</span>}
                    </span>
                    <span className="text-center text-sm font-medium leading-tight text-white [text-shadow:0_1px_2px_rgba(0,0,0,0.4)]">{TILES[s].label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          {searching && <div className="mt-4">{entries('Clients found', 'No client matches that search.')}</div>}
        </>
      ) : (
        <>
          <div className="mb-4 flex items-center gap-3">
            <Button variant="secondary" onClick={() => go('home')}><ArrowLeft size={16} /> Back</Button>
            <TileIcon screen={screen} size="sm" />
            <h2 className="text-lg font-semibold text-text">{TILES[screen].label}</h2>
          </div>

          {screen === 'reminders' ? (
            <RemindersList items={myReminders} loading={reminders.loading} error={reminders.status === 'error' ? reminders.error : ''}
              onOpen={(r) => setOpen({ ...fromKey(r.case_key), key: r.case_key })} onChanged={reload} />
          ) : screen === 'notifications' ? (
            <NotificationsList />
          ) : screen === 'services' ? (
            <ManageServices items={services.data?.items ?? []} loading={services.loading} onChanged={services.reload} />
          ) : screen !== 'stages' ? (
            entries(SECTION_TITLES[view])
          ) : board.status === 'error' ? (
            <Card><ErrorState onRetry={board.reload} message={board.error} /></Card>
          ) : !data ? (
            <div className="flex gap-3 overflow-hidden">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-72 w-72 shrink-0" />)}</div>
          ) : data.total === 0 ? (
            <Card>
              <EmptyState icon={Briefcase} title="No cases yet" description="Clients added in the Legal module appear here, starting at Onboarding." />
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
                          <span className="block truncate text-sm font-medium text-text">{c.company_name}</span>
                          {(!c.legal_approved || c.documents.length > 0) && (
                            <span className="mt-1.5 flex flex-wrap items-center gap-2">
                              {!c.legal_approved && <Badge tone="warning">Waiting for Legal</Badge>}
                              {c.documents.length > 0 && <DocsReady />}
                            </span>
                          )}
                          <span className="mt-2 flex items-center justify-between gap-2 text-xs">
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
        <CaseDrawer key={open.key} target={open} stages={data.stages} admins={admins.data?.items ?? []} services={services.data?.items ?? []}
          onClose={() => setOpen(null)} onMove={move} onChanged={reload} />
      )}
    </div>
  );
}

/** One CRM entry as in the reference: current status, assign an Admin with the furthest stage they may take it to, view. */
function EntryCard({ c, stages, admins, onView, onChanged }: { c: OpsCase; stages: Stage[]; admins: Person[]; onView: () => void; onChanged: () => void }) {
  const { showToast } = useToast();
  const [assignee, setAssignee] = useState(c.assigned_to?.user_id ?? '');
  const [maxStage, setMaxStage] = useState(c.max_stage ?? '');
  const [saving, setSaving] = useState(false);
  const unchanged = assignee === (c.assigned_to?.user_id ?? '') && maxStage === (c.max_stage ?? '');
  const box = 'rounded-lg border border-border bg-surface-secondary p-3';
  const label = 'mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-text-muted';

  const assign = async () => {
    setSaving(true);
    try {
      const updated = await api.put<OpsCase>(`${caseUrl(c)}/assign`, { user_id: assignee, max_stage: maxStage || null });
      showToast(`${c.company_name} assigned to ${updated.assigned_to?.name}`, 'success');
      onChanged();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not assign', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-2.5 rounded-xl border border-border bg-surface p-3 shadow-[var(--shadow-card)]">
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-text">{c.company_name}</p>
        {c.services.length > 0 && <p className="truncate text-xs text-text-muted">{c.services.join(', ')}</p>}
        {(c.documents.length > 0 || c.next_reminder) && (
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
            {c.documents.length > 0 && <DocsReady />}
            {c.next_reminder && <ReminderLine r={c.next_reminder} />}
          </p>
        )}
      </div>
      <div className={box}>
        <p className={label}>Current status</p>
        <StatusBadge status={c.current_status} />
      </div>
      <div className={box}>
        <Select label="Assign admin member" value={assignee} onChange={(e) => setAssignee(e.target.value)}>
          <option value="">Select admin member</option>
          {admins.map((p) => <option key={p.user_id} value={p.user_id}>{p.name}</option>)}
        </Select>
      </div>
      <div className={box}>
        <Select label="Max allowed stage" value={maxStage} onChange={(e) => setMaxStage(e.target.value)}>
          <option value="">Select stage (any)</option>
          {stages.map((s, i) => <option key={s.key} value={s.key}>{i + 1}. {s.label}</option>)}
        </Select>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Button className="justify-center bg-emerald-600 text-white hover:bg-emerald-700" loading={saving} disabled={!assignee || unchanged} onClick={assign}>
          <Check size={15} /> Assign
        </Button>
        <Button className="justify-center" onClick={onView}><Eye size={15} /> View</Button>
      </div>
    </div>
  );
}

function ManageServices({ items, loading, onChanged }: { items: Service[]; loading: boolean; onChanged: () => void }) {
  const { showToast } = useToast();
  const confirm = useConfirm();
  const [name, setName] = useState('');
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const [busy, setBusy] = useState('');

  const run = async (what: string, fn: () => Promise<unknown>, done: string) => {
    setBusy(what);
    try {
      await fn();
      showToast(done, 'success');
      onChanged();
      return true;
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Something went wrong', 'error');
      return false;
    } finally {
      setBusy('');
    }
  };

  const add = async () => {
    if (await run('add', () => api.post('/api/operations/services', { name }), `Added ${name.trim()}`)) setName('');
  };
  const save = async () => {
    if (editing && await run(editing.id, () => api.put(`/api/operations/services/${editing.id}`, { name: editing.name }), 'Service renamed')) setEditing(null);
  };
  const remove = async (s: Service) => {
    if (!(await confirm({ title: `Delete “${s.name}”?`, message: 'It disappears from the services list. Cases that already list it keep it.', confirmText: 'Delete', tone: 'danger' }))) return;
    await run(s.id, () => api.delete(`/api/operations/services/${s.id}`), 'Service deleted');
  };

  return (
    <Section icon={Wrench} title="Manage Services">
      <form className="mb-3 flex flex-col gap-2 sm:flex-row" onSubmit={(e) => { e.preventDefault(); if (name.trim()) add(); }}>
        <Input aria-label="New service name" placeholder="New Service Name" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} className="flex-1" />
        <Button type="submit" className="justify-center bg-emerald-600 text-white hover:bg-emerald-700 sm:w-56" loading={busy === 'add'} disabled={!name.trim()}>
          <Plus size={15} /> Add Service
        </Button>
      </form>
      {loading && items.length === 0 ? <Skeleton className="h-20 w-full" /> : items.length === 0 ? (
        <p className="py-4 text-center text-sm text-text-muted">No services yet.</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {items.map((s) => (
            <div key={s.id} className="rounded-xl border border-border bg-surface p-3 shadow-[var(--shadow-card)]">
              {editing?.id === s.id ? (
                <Input aria-label="Service name" value={editing.name} maxLength={120} autoFocus onChange={(e) => setEditing({ id: s.id, name: e.target.value })}
                  onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(null); }} />
              ) : (
                <p className="truncate text-sm font-semibold text-text" title={s.name}>{s.name}</p>
              )}
              <div className="mt-2.5 grid grid-cols-2 gap-2">
                {editing?.id === s.id ? (
                  <>
                    <Button size="sm" variant="secondary" className="justify-center" loading={busy === s.id} disabled={!editing.name.trim()} onClick={save}><Check size={13} /> Save</Button>
                    <Button size="sm" variant="ghost" className="justify-center" onClick={() => setEditing(null)}>Cancel</Button>
                  </>
                ) : (
                  <>
                    <Button size="sm" variant="secondary" className="justify-center border-primary/40 text-primary" onClick={() => setEditing({ id: s.id, name: s.name })}><Pencil size={13} /> Edit</Button>
                    <Button size="sm" variant="secondary" className="justify-center border-danger/40 text-danger" loading={busy === s.id} onClick={() => remove(s)}><Trash2 size={13} /> Delete</Button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </Section>
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

function CaseDrawer({ target, stages, admins, services, onClose, onMove, onChanged }: {
  target: Pick<OpsCase, 'kind' | 'id' | 'key'>; stages: Stage[]; admins: Person[]; services: Service[]; onClose: () => void;
  onMove: (c: OpsCase, stage: string, note?: string) => Promise<OpsCase | null>; onChanged: () => void;
}) {
  const { showToast } = useToast();
  const { user } = useAuth();
  const detail = useApi(() => api.get<OpsCase>(caseUrl(target)), [target.key]);
  const c = detail.data;
  const [stage, setStage] = useState<string | null>(null);
  const [assignee, setAssignee] = useState<string | null>(null);
  const [maxStage, setMaxStage] = useState<string | null>(null);
  const [picked, setPicked] = useState<string[] | null>(null);
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
  const chosenMax = maxStage ?? c.max_stage ?? '';
  const chosenServices = picked ?? c.services;
  const serviceNames = [...new Set([...services.map((s) => s.name), ...c.services])];

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
    const updated = await onMove(c, to);
    if (updated) setStage(null);
    return updated;
  });

  const assign = (userId: string | null) => run('assign', async () => {
    const updated = await api.put<OpsCase>(`${caseUrl(c)}/assign`, { user_id: userId, max_stage: userId ? chosenMax || null : null });
    showToast(userId ? `Assigned to ${updated.assigned_to?.name}` : 'Case unassigned', 'success');
    setAssignee(null);
    setMaxStage(null);
    onChanged();
    return updated;
  });

  const saveServices = () => run('services', async () => {
    const updated = await api.put<OpsCase>(`${caseUrl(c)}/services`, { services: chosenServices });
    showToast('Services saved', 'success');
    setPicked(null);
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
    ['Contact', [c.contact_name, c.contact_email, c.contact_phone].filter(Boolean).join(' · ')],
    [c.kind === 'record' ? 'BDM' : 'Submitted by', c.bdm], ['Legal status', c.legal_status.charAt(0) + c.legal_status.slice(1).toLowerCase()],
    ['Reference', c.reference],
  ];
  const openReminders = (c.reminders ?? []).filter((r) => !r.done_at);
  const section = 'mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted';

  return (
    <Drawer open onClose={onClose} title={c.company_name}>
      <div className="space-y-6">
        <div>
          <p className="text-xs text-text-muted">Current stage</p>
          <p className="mt-0.5 text-base font-semibold text-text">{index + 1}. {c.stage_label}</p>
          {index === 0 && <p className="mt-1 flex items-center gap-2 text-xs text-text-muted">Legal <StatusBadge status={c.current_status} /></p>}
          {c.max_stage_label && <p className="mt-1 text-xs text-text-muted">May go up to {c.max_stage_label}</p>}
          {!c.legal_approved && (
            <p className="mt-2 flex items-start gap-1.5 rounded-md bg-warning-bg px-3 py-2 text-xs text-warning">
              <ShieldAlert size={14} className="mt-px shrink-0" aria-hidden="true" />
              Onboarding finishes once Legal approves this client's documents. Until then the case stays here.
            </p>
          )}
          {c.legal_approved && (
            <div className="mt-3 space-y-2">
              {next && (
                <Button className="w-full justify-center" loading={busy === 'stage'} onClick={() => save(next.key)}>
                  Move to {next.label} <ArrowRight size={15} />
                </Button>
              )}
              <div className="flex items-end gap-2">
                <Select label="Or pick a stage" value={chosenStage} onChange={(e) => setStage(e.target.value)} className="min-w-0 flex-1">
                  {stages.map((s, i) => <option key={s.key} value={s.key}>{i + 1}. {s.label}</option>)}
                </Select>
                <Button variant="secondary" loading={busy === 'stage'} disabled={chosenStage === c.stage} onClick={() => save(chosenStage)}>Move</Button>
              </div>
            </div>
          )}
        </div>

        <div>
          <p className={section}>Documents from Legal</p>
          {c.documents.length === 0 ? (
            <p className="text-text-muted">Nothing provided or approved by Legal yet.</p>
          ) : (
            <ul className="divide-y divide-border rounded-md border border-border">
              {c.documents.map((d) => (
                <li key={d.id} className="flex items-center justify-between gap-3 px-3 py-2">
                  <span className="min-w-0">
                    <span className="block text-text">{d.label}</span>
                    <span className="block truncate text-xs text-text-muted">{d.filename}</span>
                    <span className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-text-muted"><SourceBadge source={d.source} />{d.by}{d.at ? `, ${dateTime(d.at)}` : ''}</span>
                  </span>
                  <Button size="sm" variant="secondary" onClick={() => download(d)} aria-label={`Download ${d.label}`}><Download size={13} /></Button>
                </li>
              ))}
            </ul>
          )}
          {c.pending_review > 0 && (
            <p className="mt-2 text-xs text-warning">Some client files are still waiting for Legal approval.</p>
          )}
        </div>

        <div>
          <p className={section}>Assigned to</p>
          <p className="text-sm text-text">
            {c.assigned_to ? <>{c.assigned_to.name}<span className="text-text-muted"> (by {c.assigned_by?.name})</span></> : <span className="text-text-muted">Not assigned yet</span>}
          </p>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <Select label="Admin" value={chosenAssignee} onChange={(e) => setAssignee(e.target.value)}>
              <option value="">Choose an Admin…</option>
              {admins.map((p) => <option key={p.user_id} value={p.user_id}>{p.name}</option>)}
            </Select>
            <Select label="Max allowed stage" value={chosenMax} onChange={(e) => setMaxStage(e.target.value)}>
              <option value="">Any stage</option>
              {stages.map((s, i) => <option key={s.key} value={s.key}>{i + 1}. {s.label}</option>)}
            </Select>
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button size="sm" loading={busy === 'assign'} disabled={!chosenAssignee || (chosenAssignee === c.assigned_to?.user_id && chosenMax === (c.max_stage ?? ''))} onClick={() => assign(chosenAssignee)}>
              <UserRoundCheck size={13} /> Assign
            </Button>
            {!c.assigned_to && user && admins.some((p) => p.user_id === user.id) && (
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
          <p className={section}>Services</p>
          {!picked ? (
            <div className="flex flex-wrap items-center gap-1.5">
              {c.services.length === 0 ? <span className="text-text-muted">None chosen yet</span>
                : c.services.map((n) => <span key={n} className="rounded-full border border-primary bg-primary-soft px-2.5 py-1 text-xs text-primary">{n}</span>)}
              {serviceNames.length > 0 && <Button size="sm" variant="ghost" onClick={() => setPicked(c.services)}><Pencil size={12} /> Change</Button>}
            </div>
          ) : (
            <>
              <div className="flex flex-wrap gap-1.5">
                {serviceNames.map((n) => {
                  const on = chosenServices.includes(n);
                  return (
                    <button key={n} type="button" aria-pressed={on}
                      onClick={() => setPicked(on ? chosenServices.filter((x) => x !== n) : [...chosenServices, n])}
                      className={`rounded-full border px-2.5 py-1 text-xs ${on ? 'border-primary bg-primary-soft text-primary' : 'border-border text-text-secondary hover:border-border-strong'}`}>
                      {on && <Check size={11} className="mr-1 inline" aria-hidden="true" />}{n}
                    </button>
                  );
                })}
              </div>
              <div className="mt-2 flex justify-end gap-2">
                <Button size="sm" variant="ghost" onClick={() => setPicked(null)}>Cancel</Button>
                <Button size="sm" loading={busy === 'services'} onClick={saveServices}>Save services</Button>
              </div>
            </>
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

        <details>
          <summary className={`${section} flex cursor-pointer items-center gap-1.5`}><History size={13} aria-hidden="true" />Stage history</summary>
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
        </details>
      </div>
    </Drawer>
  );
}
