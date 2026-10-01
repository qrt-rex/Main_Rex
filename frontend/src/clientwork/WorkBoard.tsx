import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { CheckCircle2, ClipboardList, Hourglass, PauseCircle, Search, X, Zap } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { useApi, useDebounced } from '../lib/useApi';
import { date, dateTime, relativeTime } from '../lib/format';
import { Badge } from '../components/common/Badge';
import { Button } from '../components/common/Button';
import { Card } from '../components/common/Card';
import { EmptyState } from '../components/common/EmptyState';
import { ErrorState } from '../components/common/ErrorState';
import { Table, type Column } from '../components/common/Table';
import { Tabs } from '../components/common/Tabs';
import { cw, PRIORITIES, type Bucket, type Filters, type WaitingItem, type Work } from './api';
import { ClientWorkAnalytics } from './ClientWorkAnalytics';
import { useClientWorkLive } from './live';
import { DeadlineBadge, LiveDot, PriorityBadge, ProgressBar, WorkStatusBadge, duration, selectCls, title } from './ui';

type TabId = 'all' | 'need_action' | 'on_hold' | 'completed' | 'waiting' | 'analytics';
const TAB_IDS: TabId[] = ['all', 'need_action', 'on_hold', 'completed', 'waiting', 'analytics'];

const SORTS: [string, string][] = [
  ['priority', 'Priority'], ['deadline', 'Deadline'], ['client', 'Client'], ['work_type', 'Work type'],
  ['status', 'Status'], ['assigned_date', 'Assignment date'], ['updated', 'Last activity'],
];

const Dash = <span className="text-text-muted">—</span>;

function Client({ w }: { w: Work }) {
  return (
    <span className="block min-w-0">
      <span className="block truncate font-medium text-text">{w.client_name}</span>
      <span className="block truncate font-mono text-xs text-text-muted">{w.client_ref} · {w.work_no}</span>
    </span>
  );
}

function Pending({ w }: { w: Work }) {
  const n = w.pending_items_count;
  if (!n) return Dash;
  return (
    <span title={w.pending_requests.map((r) => r.label).join(', ')}>
      <Badge tone="warning">{n} item{n === 1 ? '' : 's'}</Badge>
      <span className="mt-0.5 block max-w-[180px] truncate text-xs text-text-muted">{w.pending_requests.map((r) => r.label).join(', ')}</span>
    </span>
  );
}

function columnsFor(tab: TabId, monitor: boolean): Column<Work>[] {
  const client: Column<Work> = { key: 'client', header: 'Client', render: (w) => <Client w={w} />, sortValue: (w) => w.client_name };
  const member: Column<Work> = { key: 'member', header: 'Assigned member', render: (w) => <span className="whitespace-nowrap text-text">{w.assigned_to?.name}</span>, sortValue: (w) => w.assigned_to?.name ?? '' };
  const deadline: Column<Work> = { key: 'deadline', header: 'Deadline', render: (w) => <DeadlineBadge work={w} />, sortValue: (w) => w.deadline ?? '9999' };
  const last: Column<Work> = { key: 'last', header: 'Last activity', render: (w) => <span className="whitespace-nowrap text-text-muted">{relativeTime(w.last_activity_at)}</span>, sortValue: (w) => w.last_activity_at };

  if (tab === 'on_hold') {
    return [
      client,
      { key: 'type', header: 'Hold', render: (w) => <WorkStatusBadge work={w} /> },
      { key: 'reason', header: 'Hold reason', render: (w) => <span className="block max-w-[260px] truncate text-text-secondary" title={w.hold?.reason}>{w.hold?.reason ?? '—'}</span> },
      { key: 'since', header: 'Waiting since', render: (w) => <span className="whitespace-nowrap">{dateTime(w.hold?.started_at)}</span>, sortValue: (w) => w.hold?.started_at ?? '' },
      { key: 'items', header: 'Pending client items', render: (w) => <Pending w={w} /> },
      { key: 'days', header: 'Days waiting', align: 'right', render: (w) => <span className="tabular-nums">{w.hold?.days_waiting ?? 0}</span>, sortValue: (w) => w.hold?.seconds_waiting ?? 0 },
      member,
      { key: 'expected', header: 'Expected response', render: (w) => {
        const d = w.hold?.expected_response_date;
        const late = !!d && d < new Date().toLocaleDateString('en-CA');
        return d ? <span className={late ? 'font-medium text-danger' : ''}>{date(d)}{late && <span className="block text-xs">Overdue</span>}</span> : Dash;
      }, sortValue: (w) => w.hold?.expected_response_date ?? '9999' },
    ];
  }
  if (tab === 'completed') {
    return [
      client,
      { key: 'by', header: 'Completed by', render: (w) => w.completed_by?.name ?? Dash },
      { key: 'on', header: 'Completion date', render: (w) => <span className="whitespace-nowrap">{dateTime(w.completed_at)}</span>, sortValue: (w) => w.completed_at ?? '' },
      { key: 'tasks', header: 'Total tasks', align: 'right', render: (w) => <span className="tabular-nums">{w.total_tasks}</span>, sortValue: (w) => w.total_tasks },
      { key: 'dur', header: 'Completion time', align: 'right', render: (w) => <span className="tabular-nums">{duration(w.durations.total)}</span>, sortValue: (w) => w.durations.total },
      { key: 'active', header: 'Total working time', align: 'right', render: (w) => <span className="tabular-nums">{duration(w.durations.active)}</span>, sortValue: (w) => w.durations.active },
      { key: 'hold', header: 'Total on-hold time', align: 'right', render: (w) => <span className="tabular-nums">{duration(w.durations.hold)}</span>, sortValue: (w) => w.durations.hold },
      ...(monitor ? [member] : []),
    ];
  }
  if (tab === 'all') {
    return [
      client, member,
      { key: 'status', header: 'Current status', render: (w) => <WorkStatusBadge work={w} />, sortValue: (w) => w.status },
      { key: 'progress', header: 'Progress', render: (w) => <ProgressBar value={w.progress} tone={w.status === 'COMPLETED' ? 'success' : 'primary'} />, sortValue: (w) => w.progress },
      { key: 'done', header: 'Completed tasks', align: 'right', render: (w) => <span className="tabular-nums">{w.completed_tasks}</span>, sortValue: (w) => w.completed_tasks },
      { key: 'pending', header: 'Pending tasks', align: 'right', render: (w) => <span className="tabular-nums">{w.pending_tasks}</span>, sortValue: (w) => w.pending_tasks },
      { key: 'client_pending', header: 'Client pending items', align: 'right', render: (w) => <span className={`tabular-nums ${w.pending_items_count ? 'font-medium text-warning' : ''}`}>{w.pending_items_count}</span>, sortValue: (w) => w.pending_items_count },
      { key: 'open', header: 'Days open', align: 'right', render: (w) => <span className="tabular-nums">{w.days_open}</span>, sortValue: (w) => w.days_open },
      { key: 'hold_days', header: 'Days on hold', align: 'right', render: (w) => <span className="tabular-nums">{w.days_on_hold}</span>, sortValue: (w) => w.days_on_hold },
      deadline, last,
    ];
  }
  // need_action: the member's action queue
  return [
    client,
    { key: 'type', header: 'Work type', render: (w) => <span className="block max-w-[180px]"><span className="block truncate text-text">{w.work_type}</span>{w.required_action && <span className="block truncate text-xs text-text-muted" title={w.required_action}>{w.required_action}</span>}</span>, sortValue: (w) => w.work_type },
    { key: 'priority', header: 'Priority', render: (w) => <PriorityBadge priority={w.priority} />, sortValue: (w) => PRIORITIES.indexOf(w.priority) },
    monitor ? member : { key: 'by', header: 'Assigned by', render: (w) => <span className="whitespace-nowrap">{w.assigned_by?.name}</span> },
    { key: 'tasks', header: 'Tasks', render: (w) => <div className="min-w-[120px]"><ProgressBar value={w.progress} label={`${w.completed_tasks}/${w.total_tasks} done`} /></div>, sortValue: (w) => w.progress },
    deadline,
    { key: 'status', header: 'Status', render: (w) => <WorkStatusBadge work={w} />, sortValue: (w) => w.status },
    { key: 'next', header: 'Next action', render: (w) => <span className="block max-w-[200px] truncate text-text-secondary" title={w.next_action}>{w.next_action}</span> },
    { key: 'elapsed', header: 'Time elapsed', align: 'right', render: (w) => <span className="whitespace-nowrap tabular-nums">{duration(w.durations.total)}</span>, sortValue: (w) => w.durations.total },
    last,
  ];
}

const waitingColumns: Column<WaitingItem>[] = [
  { key: 'client', header: 'Client', render: (r) => <span className="block"><span className="block font-medium text-text">{r.client_name}</span><span className="block font-mono text-xs text-text-muted">{r.client_ref}</span></span>, sortValue: (r) => r.client_name },
  { key: 'action', header: 'Required action', render: (r) => <span className="block max-w-[220px] truncate text-text-secondary" title={r.required_action}>{r.required_action || '—'}</span> },
  { key: 'doc', header: 'Required document', render: (r) => <span><span className="block text-text">{r.required_document}</span><span className="block text-xs text-text-muted">{r.kind === 'DOCUMENT' ? 'Document' : 'Information'}</span></span>, sortValue: (r) => r.required_document },
  { key: 'requested', header: 'Requested', render: (r) => <span className="whitespace-nowrap">{dateTime(r.requested_at)}</span>, sortValue: (r) => r.requested_at },
  { key: 'days', header: 'Days waiting', align: 'right', render: (r) => <span className="tabular-nums">{r.days_waiting}</span>, sortValue: (r) => r.days_waiting },
  { key: 'expected', header: 'Expected response', render: (r) => (r.expected_date ? <span className={r.overdue ? 'font-medium text-danger' : ''}>{date(r.expected_date)}{r.overdue && <span className="block text-xs">Overdue</span>}</span> : Dash), sortValue: (r) => r.expected_date ?? '9999' },
  { key: 'status', header: 'Status', render: (r) => (r.hold_label ? <Badge tone="warning" dot>{r.hold_label}</Badge> : <Badge tone="info" dot>{title(r.work_status)} · awaiting client</Badge>) },
  { key: 'member', header: 'Assigned member', render: (r) => <span className="whitespace-nowrap">{r.assigned_to}</span> },
];

const EMPTY: Record<string, { icon: typeof Zap; title: string; text: string }> = {
  all: { icon: ClipboardList, title: 'No client work yet', text: 'Assign a client from the Legal dashboard and it will appear here.' },
  need_action: { icon: Zap, title: 'Nothing needs action', text: 'New assignments and work returned from hold show up here instantly.' },
  on_hold: { icon: PauseCircle, title: 'Nothing is on hold', text: 'Work blocked by a missing client document or an internal issue appears here.' },
  completed: { icon: CheckCircle2, title: 'No completed work yet', text: 'Finished client work, with its durations, is listed here.' },
  waiting: { icon: Hourglass, title: 'Nothing waiting on clients', text: 'Requested documents and information that a client still owes appear here.' },
};

/**
 * The shared list workspace: Need Action / On Hold / Completed / Waiting for Client / Analytics, with combinable
 * filters kept in the URL. `monitor` (Legal, Super Admin) adds the "All work" overview and member / Legal filters.
 */
export function WorkBoard({ monitor }: { monitor: boolean }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const set = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    Object.entries(patch).forEach(([k, v]) => (v ? next.set(k, v) : next.delete(k)));
    next.delete('skip');
    setParams(next, { replace: true });
  };

  const raw = params.get('tab') ?? params.get('bucket') ?? (monitor ? 'all' : 'need_action');
  const tab = (TAB_IDS.includes(raw as TabId) && (raw !== 'all' || monitor) ? raw : monitor ? 'all' : 'need_action') as TabId;

  const [searchText, setSearchText] = useState(params.get('q') ?? '');
  const search = useDebounced(searchText);
  useEffect(() => { if ((params.get('q') ?? '') !== search) set({ q: search || null }); }, [search]); // eslint-disable-line react-hooks/exhaustive-deps

  const f: Filters = useMemo(() => ({
    bucket: (tab === 'need_action' || tab === 'on_hold' || tab === 'completed' ? tab : '') as Bucket | '',
    status: params.get('status') ?? '', priority: params.get('priority') ?? '', work_type: params.get('work_type') ?? '',
    assignee: params.get('assignee') ?? '', legal: params.get('legal') ?? '', search: params.get('q') ?? '',
    deadline_from: params.get('from') ?? '', deadline_to: params.get('to') ?? '',
    overdue: params.get('overdue') === '1', waiting_for_client: params.get('waiting') === '1' || tab === 'waiting',
    due: params.get('due') ?? '', sort: params.get('sort') ?? (tab === 'completed' ? 'updated' : 'priority'),
    order: (params.get('order') as 'asc' | 'desc') ?? (tab === 'completed' ? 'desc' : 'asc'), limit: 200,
  }), [params, tab]);
  const key = JSON.stringify([tab, f]);

  const listTab = tab !== 'analytics' && tab !== 'waiting';
  const list = useApi(() => cw.list(f), [key], listTab);
  const waiting = useApi(() => cw.waiting(f), [key], tab === 'waiting');
  const summary = useApi(cw.summary);
  useClientWorkLive(() => { if (listTab) list.reload(); if (tab === 'waiting') waiting.reload(); summary.reload(); });

  const c = summary.data?.counters;
  const tabs = [
    ...(monitor ? [{ id: 'all', label: 'All work', count: c ? c.total_active + c.completed : undefined }] : []),
    { id: 'need_action', label: 'Need Action', count: c?.need_action },
    { id: 'on_hold', label: 'On Hold', count: c?.on_hold },
    { id: 'completed', label: 'Completed', count: c?.completed },
    { id: 'waiting', label: 'Waiting for Client', count: c ? c.waiting_for_client : undefined },
    { id: 'analytics', label: 'Analytics' },
  ];

  const facets = list.data?.facets;
  const filtersActive = ['status', 'priority', 'work_type', 'assignee', 'legal', 'q', 'from', 'to', 'overdue', 'waiting', 'due'].some((k) => params.get(k));
  const clear = () => { setSearchText(''); const next = new URLSearchParams(); if (tab !== (monitor ? 'all' : 'need_action')) next.set('tab', tab); if (params.get('section')) next.set('section', params.get('section')!); setParams(next, { replace: true }); };
  const columns = useMemo(() => columnsFor(tab, monitor), [tab, monitor]);
  const items = list.data?.items ?? [];
  const empty = EMPTY[tab] ?? EMPTY.all;
  const EmptyIcon = empty.icon;
  const statusOptions = tab === 'need_action' ? ['NEED_ACTION', 'IN_PROGRESS'] : tab === 'all' ? ['NEED_ACTION', 'IN_PROGRESS', 'ON_HOLD', 'COMPLETED', 'CANCELLED'] : [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs tabs={tabs} active={tab} onChange={(id) => set({ tab: id, bucket: null, status: null })} className="min-w-0 flex-1" />
        <LiveDot />
      </div>

      {tab === 'analytics' ? <ClientWorkAnalytics /> : (
        <>
          <Card className="p-3">
            <div className="flex flex-wrap items-end gap-2">
              <label className="relative min-w-[200px] flex-1">
                <span className="sr-only">Search client or client ID</span>
                <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" aria-hidden="true" />
                <input value={searchText} onChange={(e) => setSearchText(e.target.value)} placeholder="Search client name or client ID…" className={`${selectCls} w-full pl-9`} />
              </label>
              {statusOptions.length > 0 && (
                <select aria-label="Status" className={selectCls} value={params.get('status') ?? ''} onChange={(e) => set({ status: e.target.value })}>
                  <option value="">All statuses</option>{statusOptions.map((s) => <option key={s} value={s}>{title(s)}</option>)}
                </select>
              )}
              <select aria-label="Priority" className={selectCls} value={params.get('priority') ?? ''} onChange={(e) => set({ priority: e.target.value })}>
                <option value="">All priorities</option>{PRIORITIES.map((p) => <option key={p} value={p}>{title(p)}</option>)}
              </select>
              <select aria-label="Work type" className={selectCls} value={params.get('work_type') ?? ''} onChange={(e) => set({ work_type: e.target.value })}>
                <option value="">All work types</option>{(facets?.work_types ?? []).map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
              {monitor && (
                <>
                  <select aria-label="Assigned member" className={selectCls} value={params.get('assignee') ?? ''} onChange={(e) => set({ assignee: e.target.value })}>
                    <option value="">All members</option>{(facets?.assignees ?? []).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                  <select aria-label="Assigned legal user" className={selectCls} value={params.get('legal') ?? ''} onChange={(e) => set({ legal: e.target.value })}>
                    <option value="">All Legal users</option>{(facets?.legal ?? []).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                </>
              )}
              <label className="flex flex-col text-[11px] text-text-muted">Deadline from
                <input type="date" className={selectCls} value={params.get('from') ?? ''} onChange={(e) => set({ from: e.target.value })} /></label>
              <label className="flex flex-col text-[11px] text-text-muted">to
                <input type="date" className={selectCls} value={params.get('to') ?? ''} onChange={(e) => set({ to: e.target.value })} /></label>
              <select aria-label="Sort by" className={selectCls} value={f.sort} onChange={(e) => set({ sort: e.target.value })}>
                {SORTS.map(([v, l]) => <option key={v} value={v}>Sort: {l}</option>)}
              </select>
              <Button variant="secondary" size="sm" className="h-9" onClick={() => set({ order: f.order === 'asc' ? 'desc' : 'asc' })} aria-label={`Order ${f.order === 'asc' ? 'ascending' : 'descending'}`}>{f.order === 'asc' ? '↑ Asc' : '↓ Desc'}</Button>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-4 text-sm">
              <label className="inline-flex cursor-pointer items-center gap-2 text-text-secondary"><input type="checkbox" className="accent-[var(--color-primary)]" checked={params.get('overdue') === '1'} onChange={(e) => set({ overdue: e.target.checked ? '1' : null })} /> Overdue only</label>
              {tab !== 'waiting' && <label className="inline-flex cursor-pointer items-center gap-2 text-text-secondary"><input type="checkbox" className="accent-[var(--color-primary)]" checked={params.get('waiting') === '1'} onChange={(e) => set({ waiting: e.target.checked ? '1' : null })} /> Waiting for client</label>}
              <label className="inline-flex items-center gap-2 text-text-secondary">Due
                <select aria-label="Due" className={`${selectCls} h-8`} value={params.get('due') ?? ''} onChange={(e) => set({ due: e.target.value })}><option value="">any time</option><option value="today">today</option><option value="soon">in the next 3 days</option></select></label>
              {filtersActive && <button type="button" onClick={clear} className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"><X size={12} aria-hidden="true" /> Clear filters</button>}
            </div>
          </Card>

          <Card>
            {tab === 'waiting' ? (
              waiting.status === 'error' && !waiting.data ? <ErrorState onRetry={waiting.reload} message={waiting.error} /> : (
                <Table columns={waitingColumns} rows={waiting.data?.items ?? []} rowKey={(r) => r.id} loading={!waiting.data}
                  onRowClick={(r) => navigate(`/client-work/${r.work_id}`)}
                  empty={<EmptyState icon={EmptyIcon} title={filtersActive ? 'No requests match these filters' : empty.title} description={empty.text} />} />
              )
            ) : list.status === 'error' && !list.data ? (
              <ErrorState onRetry={list.reload} message={list.error} />
            ) : (
              <Table columns={columns} rows={items} rowKey={(w) => w.id} loading={!list.data}
                onRowClick={(w) => navigate(`/client-work/${w.id}`)}
                caption={tab === 'need_action' && !monitor ? 'My action queue' : undefined}
                empty={<EmptyState icon={EmptyIcon} title={filtersActive ? 'No client work matches these filters' : empty.title}
                  description={filtersActive ? 'Try removing a filter.' : empty.text}
                  action={filtersActive ? <Button variant="secondary" size="sm" onClick={clear}>Clear filters</Button> : undefined} />} />
            )}
            {((tab === 'waiting' ? waiting.data?.total : list.data?.total) ?? 0) > 0 && (
              <p className="border-t border-border px-4 py-2 text-xs text-text-muted">
                {(tab === 'waiting' ? waiting.data?.total : list.data?.total)} result{(tab === 'waiting' ? waiting.data?.total : list.data?.total) === 1 ? '' : 's'}
                {!monitor && user ? ` · assigned to ${user.username}` : ''}
              </p>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
