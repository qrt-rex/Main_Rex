import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, Briefcase, CalendarCheck, CheckCircle2, ExternalLink, FileText, PauseCircle, Search, UserCheck, XCircle } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { api } from '../lib/api';
import { useApi, useDebounced } from '../lib/useApi';
import { date, money } from '../lib/format';
import { StatusBadge } from '../components/common/Badge';
import { Button } from '../components/common/Button';
import { Card, CardHeader } from '../components/common/Card';
import { Modal } from '../components/common/Modal';
import { useToast } from '../components/common/ToastContext';
import { pendingLeaves, decideLeave, type LeaveRequest } from '../hr/api';
import { AssignClientModal } from '../clientwork/AssignClientModal';

export interface LegalClient {
  kind: 'record' | 'document';
  id: string;
  reference: string;
  company_name: string;
  contact_name: string;
  contact_email: string;
  contact_phone: string;
  gstin: string;
  bdm: string;
  services: string[];
  documents: string[];
  amount: number | null;
  status: string;
  assigned_to: { user_id: string; name: string; email: string; assigned_at?: string } | null;
  created_at: string;
}
interface Staff { id: string; name: string; email: string; role_label: string }

const STATUSES = ['PENDING', 'UNDER REVIEW', 'APPROVED', 'HOLD', 'REJECTED'];
const inputCls = 'rounded-xl border border-slate-200 bg-slate-50/50 px-3 py-2 text-xs font-semibold text-slate-700 focus:border-indigo-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 dark:border-slate-700 dark:bg-slate-800/80 dark:text-slate-200';
const card = 'rounded-2xl border border-slate-200/80 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900 overflow-hidden';
const th = 'py-3.5 px-4';

/** Bill & Invoices "Create invoice", pre-filled with this client and its services. */
function invoiceLink(c: LegalClient) {
  const p = new URLSearchParams({ client_name: c.company_name, from: c.reference });
  if (c.contact_email) p.set('email', c.contact_email);
  if (c.contact_phone) p.set('phone', c.contact_phone);
  if (c.gstin) p.set('gstin', c.gstin);
  c.services.forEach((s) => p.append('service', s));
  return `/billing/create?${p.toString()}`;
}

const what = (c: LegalClient) => (c.services.length ? c.services : c.documents.length ? c.documents.map((d) => `📎 ${d}`) : ['—']);

function Chips({ items }: { items: string[] }) {
  return (
    <span className="flex flex-wrap gap-1">
      {items.map((s) => <span key={s} className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-300">{s}</span>)}
    </span>
  );
}

function useClients(params: Record<string, string>) {
  const key = JSON.stringify(params);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- params are compared by value
  return useApi(() => api.get<{ items: LegalClient[]; total: number }>('/api/legal/clients', params), [key]);
}

function Toolbar({ search, setSearch, children }: { search: string; setSearch: (v: string) => void; children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative w-64">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input aria-label="Search clients" placeholder="Search client, reference, service…" value={search} onChange={(e) => setSearch(e.target.value)} className={`${inputCls} w-full pl-9`} />
      </div>
      {children}
    </div>
  );
}

function SectionHeader({ icon: Icon, title, count, children }: { icon: typeof Briefcase; title: string; count?: number; children?: ReactNode }) {
  return (
    <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-2">
        <div className="flex h-6 w-6 items-center justify-center rounded-md bg-indigo-50 text-indigo-600 dark:bg-indigo-950 dark:text-indigo-400"><Icon size={13} /></div>
        <h3 className="font-bold text-sm text-slate-800 dark:text-slate-100">{title}</h3>
        {count !== undefined && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-600 dark:bg-slate-800 dark:text-slate-300">{count}</span>}
      </div>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------- Assign clients
export function LegalAssignClients() {
  const { showToast } = useToast();
  const [search, setSearch] = useState('');
  const [assigned, setAssigned] = useState('');
  const [kind, setKind] = useState('');
  const q = useDebounced(search);
  const staff = useApi(() => api.get<{ staff: Staff[] }>('/api/legal/staff'));
  const list = useClients({ search: q, assigned, kind });
  const [busy, setBusy] = useState<string | null>(null);
  // Assigning to a member opens the work-details dialog (priority, deadline, required action); unassigning is immediate.
  const [pending, setPending] = useState<{ client: LegalClient; member: Staff } | null>(null);

  const choose = (c: LegalClient, userId: string) => {
    const member = (staff.data?.staff ?? []).find((p) => p.id === userId);
    if (member) setPending({ client: c, member });
    else void assign(c, '');
  };

  const assign = async (c: LegalClient, userId: string) => {
    setBusy(c.id);
    try {
      const updated = await api.put<LegalClient>(`/api/legal/clients/${c.kind}/${c.id}/assign`, { user_id: userId || null });
      list.setData((d) => d && { ...d, items: d.items.map((x) => (x.id === c.id ? updated : x)) });
      showToast(userId ? `${c.company_name} assigned to ${updated.assigned_to?.name}` : `${c.company_name} unassigned`, 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not assign', 'error');
    } finally {
      setBusy(null);
    }
  };

  const items = list.data?.items ?? [];
  const people = staff.data?.staff ?? [];

  return (
    <div className={card}>
      <SectionHeader icon={UserCheck} title="Assign clients" count={items.length}>
        <Toolbar search={search} setSearch={setSearch}>
          <select aria-label="Filter by type" value={kind} onChange={(e) => setKind(e.target.value)} className={`${inputCls} w-40`}>
            <option value="">All clients</option><option value="record">Legal records</option><option value="document">Document forms</option>
          </select>
          <select aria-label="Filter by assignment" value={assigned} onChange={(e) => setAssigned(e.target.value)} className={`${inputCls} w-48`}>
            <option value="">Everyone</option><option value="unassigned">Unassigned only</option><option value="assigned">Assigned only</option>
            {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Toolbar>
      </SectionHeader>
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-slate-100 dark:border-slate-800/80 bg-slate-50/60 dark:bg-slate-800/30 text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
              <th className={`${th} pl-6`}>Reference</th><th className={th}>Client</th><th className={th}>Services / documents</th>
              <th className={th}>Status</th><th className={`${th} pr-6`}>Assigned to</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 text-xs">
            {items.length === 0 ? (
              <tr><td colSpan={5} className="py-10 text-center text-slate-400">{list.loading ? 'Loading clients…' : list.status === 'error' ? list.error : 'No clients match.'}</td></tr>
            ) : items.map((c) => (
              <tr key={`${c.kind}-${c.id}`} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/30">
                <td className={`${th} pl-6 font-mono font-bold text-indigo-600 dark:text-indigo-400`}>{c.reference}<span className="block font-sans text-[10px] font-semibold uppercase text-slate-400">{c.kind === 'record' ? 'Legal record' : 'Document form'}</span></td>
                <td className={th}><span className="block font-semibold text-slate-800 dark:text-slate-100">{c.company_name}</span><span className="block text-slate-400">{c.contact_name || c.bdm}</span></td>
                <td className={th}><Chips items={what(c)} /></td>
                <td className={th}><StatusBadge status={c.status} /></td>
                <td className={`${th} pr-6`}>
                  <select aria-label={`Assign ${c.company_name}`} value={c.assigned_to?.user_id ?? ''} disabled={busy === c.id || staff.loading}
                    onChange={(e) => choose(c, e.target.value)} className={`${inputCls} w-52`}>
                    <option value="">— Unassigned —</option>
                    {people.map((p) => <option key={p.id} value={p.id}>{p.name} · {p.role_label}</option>)}
                    {c.assigned_to && !people.some((p) => p.id === c.assigned_to!.user_id) && <option value={c.assigned_to.user_id}>{c.assigned_to.name} (inactive)</option>}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <AssignClientModal<LegalClient>
        client={pending?.client ?? null} member={pending?.member ?? null} onClose={() => setPending(null)}
        onAssigned={(updated) => {
          list.setData((d) => d && { ...d, items: d.items.map((x) => (x.id === updated.id ? updated : x)) });
          showToast(`${updated.company_name} assigned to ${updated.assigned_to?.name}. It is in their Need Action list now.`, 'success');
        }}
      />
    </div>
  );
}

const idOf = (r: LeaveRequest) => r._id || r.id || '';

export function LegalSalesLeaveApprovals() {
  const { showToast } = useToast();
  const pending = useApi(pendingLeaves);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rejectingRequest, setRejectingRequest] = useState<LeaveRequest | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const requests = useMemo(() => pending.data?.data ?? [], [pending.data]);

  const approve = async (req: LeaveRequest) => {
    const id = idOf(req);
    if (!id) return;
    setBusyId(id);
    try {
      await decideLeave(id, 'APPROVE', 'Approved by Legal');
      showToast(`Leave approved for ${req.employee_name}`, 'success');
      pending.reload();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not approve leave', 'error');
    } finally {
      setBusyId(null);
    }
  };

  const submitReject = async () => {
    if (!rejectingRequest) return;
    const id = idOf(rejectingRequest);
    if (!id) return;
    setBusyId(id);
    try {
      await decideLeave(id, 'REJECT', rejectReason.trim() || 'Rejected by Legal');
      showToast(`Leave rejected for ${rejectingRequest.employee_name}`, 'success');
      setRejectingRequest(null);
      setRejectReason('');
      pending.reload();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not reject leave', 'error');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <>
      <div className={card}>
        <SectionHeader icon={CalendarCheck} title="Salesperson leave approvals" count={requests.length}>
          {requests.length > 0 && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-3 py-1 text-xs font-bold text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
              <span className="h-2 w-2 rounded-full bg-amber-500 animate-pulse" />
              {requests.length} pending approval
            </span>
          )}
        </SectionHeader>

        {requests.length === 0 ? (
          <div className="p-8 text-center text-slate-400">
            <CalendarCheck size={28} className="mx-auto mb-2 text-slate-300 dark:text-slate-600" />
            <p className="text-sm font-semibold text-slate-600 dark:text-slate-300">No salesperson leave requests pending</p>
            <p className="mt-1 text-xs text-slate-400">When a salesperson applies for leave, it will appear here for review and decision.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-100 dark:border-slate-800/80 bg-slate-50/60 dark:bg-slate-800/30 text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                  <th className={`${th} pl-6`}>Salesperson</th>
                  <th className={th}>Leave Type</th>
                  <th className={th}>Dates & Duration</th>
                  <th className={th}>Reason</th>
                  <th className={th}>Balances & Risk</th>
                  <th className={`${th} pr-6 text-right`}>Decision</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 text-xs">
                {requests.map((r) => {
                  const id = idOf(r);
                  const isBusy = busyId === id;
                  return (
                    <tr key={id} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/30">
                      <td className={`${th} pl-6`}>
                        <span className="block font-semibold text-slate-800 dark:text-slate-100">{r.employee_name}</span>
                        <span className="block text-[11px] text-slate-400">{r.employee_email || r.department}</span>
                        {r.applicant_role && (
                          <span className="inline-block mt-0.5 rounded bg-indigo-50 dark:bg-indigo-950/60 px-1.5 py-0.2 text-[10px] font-bold text-indigo-600 dark:text-indigo-400 uppercase">
                            {r.applicant_role}
                          </span>
                        )}
                      </td>
                      <td className={th}>
                        <span className="inline-flex items-center rounded-md bg-slate-100 dark:bg-slate-800 px-2 py-0.5 text-xs font-bold text-slate-700 dark:text-slate-200">
                          {r.leave_type}
                        </span>
                        {r.is_loss_of_pay && (
                          <span className="block mt-0.5 text-[10px] font-semibold text-rose-500">
                            LOP ({r.lop_days}d)
                          </span>
                        )}
                      </td>
                      <td className={th}>
                        <span className="block font-medium text-slate-700 dark:text-slate-200">
                          {date(r.start_date)} – {date(r.end_date)}
                        </span>
                        <span className="block text-[11px] text-slate-400">
                          {r.total_days} day{r.total_days === 1 ? '' : 's'} · {r.duration_type?.replace('_', ' ')}
                        </span>
                      </td>
                      <td className={`${th} max-w-xs`}>
                        <p className="truncate text-slate-700 dark:text-slate-300" title={r.reason}>
                          {r.reason || '—'}
                        </p>
                        {r.medical_certificate_url && (
                          <a
                            href={r.medical_certificate_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-[11px] text-indigo-600 hover:underline font-semibold mt-0.5"
                          >
                            <ExternalLink size={11} /> Med Certificate
                          </a>
                        )}
                      </td>
                      <td className={th}>
                        {r.conflict_warning?.has_conflict && (
                          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-600 dark:text-amber-400 block mb-1">
                            <AlertTriangle size={12} /> {r.conflict_warning.conflict_count} on leave
                          </span>
                        )}
                        {r.balances && (
                          <div className="text-[10px] text-slate-500 space-x-1">
                            <span>CL: {r.balances.casual_leave_available ?? '—'}</span>
                            <span>·</span>
                            <span>SL: {r.balances.sick_leave_available ?? '—'}</span>
                            <span>·</span>
                            <span>EL: {r.balances.earned_leave_available ?? '—'}</span>
                          </div>
                        )}
                      </td>
                      <td className={`${th} pr-6 text-right`}>
                        <span className="flex flex-wrap justify-end gap-1.5">
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => approve(r)}
                            className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-700 hover:bg-emerald-100 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300 disabled:opacity-40 transition-colors"
                          >
                            <CheckCircle2 size={13} /> Approve
                          </button>
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => { setRejectingRequest(r); setRejectReason(''); }}
                            className="inline-flex items-center gap-1 rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1 text-xs font-bold text-rose-700 hover:bg-rose-100 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300 disabled:opacity-40 transition-colors"
                          >
                            <XCircle size={13} /> Reject
                          </button>
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {rejectingRequest && (
        <Modal
          open
          onClose={() => setRejectingRequest(null)}
          title="Reject salesperson leave request"
          description={`${rejectingRequest.employee_name} · ${rejectingRequest.leave_type} · ${date(rejectingRequest.start_date)} – ${date(rejectingRequest.end_date)}`}
          footer={
            <>
              <Button variant="secondary" onClick={() => setRejectingRequest(null)}>Cancel</Button>
              <Button variant="danger" loading={busyId === idOf(rejectingRequest)} onClick={submitReject}>Confirm Rejection</Button>
            </>
          }
        >
          <div className="space-y-3">
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
              Reason for rejection (optional):
            </label>
            <textarea
              rows={3}
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="e.g. Critical sales campaign week, please reschedule…"
              className="w-full rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-800 placeholder:text-slate-400 focus:border-indigo-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
            />
          </div>
        </Modal>
      )}
    </>
  );
}

// ---------------------------------------------------------------- Approvals
export function LegalApprovals() {
  const { showToast } = useToast();
  const { can } = useAuth();
  const [search, setSearch] = useState('');
  const [member, setMember] = useState('assigned');
  const [status, setStatus] = useState('');
  const q = useDebounced(search);
  const staff = useApi(() => api.get<{ staff: Staff[] }>('/api/legal/staff'));
  const list = useClients({ search: q, assigned: member, status });
  const [busy, setBusy] = useState<string | null>(null);
  const items = useMemo(() => list.data?.items ?? [], [list.data]);

  // Per-member totals over what is shown.
  const byMember = useMemo(() => {
    const m = new Map<string, { name: string; total: number; approved: number; waiting: number }>();
    for (const c of items) {
      const key = c.assigned_to?.user_id ?? '';
      const row = m.get(key) ?? { name: c.assigned_to?.name ?? 'Unassigned', total: 0, approved: 0, waiting: 0 };
      row.total += 1;
      if (c.status === 'APPROVED') row.approved += 1;
      if (c.status === 'PENDING' || c.status === 'UNDER REVIEW') row.waiting += 1;
      m.set(key, row);
    }
    return [...m.entries()].sort((a, b) => b[1].waiting - a[1].waiting);
  }, [items]);

  const decide = async (c: LegalClient, next: string) => {
    setBusy(c.id);
    try {
      const updated = await api.patch<LegalClient>(`/api/legal/clients/${c.kind}/${c.id}/status`, { status: next });
      list.setData((d) => d && { ...d, items: d.items.map((x) => (x.id === c.id ? { ...x, status: updated.status } : x)) });
      showToast(`${c.company_name}: ${next.toLowerCase()}`, 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not update', 'error');
    } finally {
      setBusy(null);
    }
  };

  const actionBtn = 'inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px] font-bold disabled:opacity-40';

  return (
    <div className="space-y-6">
      {/* 1. Salesperson Leave Approvals Queue */}
      <LegalSalesLeaveApprovals />

      {/* 2. Client Services Approvals */}
      {byMember.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {byMember.slice(0, 8).map(([id, m]) => (
            <button key={id || 'none'} type="button" onClick={() => setMember(id || 'unassigned')}
              className={`${card} p-4 text-left transition hover:border-indigo-300 ${member === id ? 'ring-2 ring-indigo-500/40' : ''}`}>
              <p className="truncate text-sm font-bold text-slate-800 dark:text-slate-100">{m.name}</p>
              <p className="mt-1 text-xs text-slate-500">{m.total} client{m.total === 1 ? '' : 's'} · <span className="text-amber-600">{m.waiting} waiting</span> · <span className="text-emerald-600">{m.approved} approved</span></p>
            </button>
          ))}
        </div>
      )}
      <div className={card}>
        <SectionHeader icon={CheckCircle2} title="Client service approvals" count={items.length}>
          <Toolbar search={search} setSearch={setSearch}>
            <select aria-label="Filter by assigned member" value={member} onChange={(e) => setMember(e.target.value)} className={`${inputCls} w-48`}>
              <option value="assigned">All assigned members</option><option value="">All clients</option><option value="unassigned">Unassigned</option>
              {(staff.data?.staff ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <select aria-label="Filter by status" value={status} onChange={(e) => setStatus(e.target.value)} className={`${inputCls} w-40`}>
              <option value="">All Status</option>{STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </Toolbar>
        </SectionHeader>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-100 dark:border-slate-800/80 bg-slate-50/60 dark:bg-slate-800/30 text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                <th className={`${th} pl-6`}>Assigned member</th><th className={th}>Client</th><th className={th}>Services</th>
                <th className={th}>Amount</th><th className={th}>Status</th><th className={`${th} pr-6 text-right`}>Decision</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 text-xs">
              {items.length === 0 ? (
                <tr><td colSpan={6} className="py-10 text-center text-slate-400">{list.loading ? 'Loading…' : list.status === 'error' ? list.error : 'Nothing to show. Assign clients to members first.'}</td></tr>
              ) : items.map((c) => (
                <tr key={`${c.kind}-${c.id}`} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/30">
                  <td className={`${th} pl-6`}>{c.assigned_to ? <><span className="block font-semibold text-slate-800 dark:text-slate-100">{c.assigned_to.name}</span><span className="block text-slate-400">{c.assigned_to.email}</span></> : <span className="text-slate-400">Unassigned</span>}</td>
                  <td className={th}><span className="block font-semibold text-slate-800 dark:text-slate-100">{c.company_name}</span><span className="block font-mono text-indigo-600 dark:text-indigo-400">{c.reference}</span></td>
                  <td className={th}><Chips items={what(c)} /></td>
                  <td className={`${th} font-bold text-emerald-600 dark:text-emerald-400`}>{c.amount != null ? money(c.amount) : '—'}</td>
                  <td className={th}><StatusBadge status={c.status} /></td>
                  <td className={`${th} pr-6`}>
                    <span className="flex flex-wrap justify-end gap-1.5">
                      <button type="button" disabled={busy === c.id || c.status === 'APPROVED'} onClick={() => decide(c, 'APPROVED')} className={`${actionBtn} border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300`}><CheckCircle2 size={12} /> Approve</button>
                      <button type="button" disabled={busy === c.id || c.status === 'HOLD'} onClick={() => decide(c, 'HOLD')} className={`${actionBtn} border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300`}><PauseCircle size={12} /> Hold</button>
                      <button type="button" disabled={busy === c.id || c.status === 'REJECTED'} onClick={() => decide(c, 'REJECTED')} className={`${actionBtn} border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300`}><XCircle size={12} /> Reject</button>
                      {c.status === 'APPROVED' && can('billing.create') && (
                        <Link to={invoiceLink(c)} className={`${actionBtn} border-indigo-200 bg-indigo-50 text-indigo-700 dark:border-indigo-900 dark:bg-indigo-950/40 dark:text-indigo-300`}><FileText size={12} /> Create invoice</Link>
                      )}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Staff dashboards
/** "Clients assigned to you" on each staff dashboard; hidden when nothing is assigned. */
export function AssignedClientsCard() {
  const { can } = useAuth();
  const mine = useApi(() => api.get<{ items: LegalClient[] }>('/api/legal/assigned/mine'));
  const items = mine.data?.items ?? [];
  if (!items.length) return null;
  return (
    <div className="mt-6">
      <Card>
        <CardHeader title="Clients assigned to you" description="Assigned by the Legal team, with each client's services and approval status" />
        <ul className="divide-y divide-border">
          {items.map((c) => (
            <li key={`${c.kind}-${c.id}`} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
              <span className="min-w-0">
                <span className="block font-medium text-text">{c.company_name} <span className="font-mono text-xs text-text-muted">{c.reference}</span></span>
                <span className="mt-1 block text-xs text-text-muted">{what(c).join(' · ')}{c.amount != null ? ` · ${money(c.amount)}` : ''}{c.created_at ? ` · ${date(c.created_at.slice(0, 10))}` : ''}</span>
              </span>
              <span className="flex items-center gap-2">
                <StatusBadge status={c.status} />
                {c.status === 'APPROVED' && can('billing.create') && (
                  <Link to={invoiceLink(c)} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-3 text-xs font-medium text-text hover:bg-neutral-bg"><FileText size={13} /> Create invoice</Link>
                )}
              </span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
