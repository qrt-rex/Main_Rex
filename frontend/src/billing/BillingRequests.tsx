import { useState, useEffect, useCallback, type FormEvent } from 'react';
import { isPhoneOk, PHONE_ERROR, phoneDigits, phoneInput } from '../lib/phone';
import { useNavigate } from 'react-router-dom';
import { Inbox, Plus, Trash2, CheckCircle2, Clock, XCircle } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { Card } from '../components/common/Card';
import { Modal } from '../components/common/Modal';
import { useConfirm } from '../components/common/ConfirmDialog';
import { useToast } from '../components/common/ToastContext';
import { api, ApiError } from '../lib/api';
import { date, money } from '../lib/format';

export interface InvoiceRequest {
  id: string;
  request_number: string;
  billing_name: string;
  billing_address: string;
  billing_phone: string;
  client_gstin: string;
  client_state: string;
  branch_key: string;
  remark: string;
  items: { particulars: string; quantity: number; rate: number }[];
  estimated_total: number;
  status: 'pending' | 'approved' | 'rejected';
  requested_by: string;
  requested_by_name: string;
  sales_person_email?: string;
  created_at: string;
  invoice_id?: string;
  invoice_number?: string;
}

const BRANCHES = [
  { key: 'ahmedabad_y', label: 'Ahmedabad(Y) [AM1]' },
  { key: 'ahmedabad_a', label: 'Ahmedabad(A) [AM2]' },
  { key: 'baroda', label: 'Baroda [BRD]' },
];
const STATES = ['Gujarat', 'Maharashtra', 'Rajasthan', 'Delhi', 'Karnataka', 'Telangana', 'Other State'];
const branchLabel = (key: string) => BRANCHES.find((b) => b.key === key)?.label ?? key;

const inputCls = 'w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text placeholder:text-text-muted focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary';
const labelCls = 'block text-xs font-medium text-text mb-1';

interface Row { particulars: string; quantity: string; rate: string }
const blankRow = (): Row => ({ particulars: '', quantity: '1', rate: '' });
const blankForm = () => ({ billing_name: '', billing_address: '', billing_phone: '', client_gstin: '', client_state: 'Gujarat', branch_key: 'ahmedabad_y', remark: '' });

function statusBadge(status: InvoiceRequest['status']) {
  if (status === 'approved') return <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-600 dark:text-emerald-400"><CheckCircle2 size={12} /> Approved</span>;
  if (status === 'rejected') return <span className="inline-flex items-center gap-1 rounded-full bg-rose-500/10 px-2 py-0.5 text-xs font-medium text-rose-600 dark:text-rose-400"><XCircle size={12} /> Rejected</span>;
  return <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-600 dark:text-amber-400"><Clock size={12} /> Pending</span>;
}

function NewRequestModal({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const { showToast } = useToast();
  const [f, setF] = useState(blankForm);
  const [rows, setRows] = useState<Row[]>([blankRow()]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  const setRow = (i: number, k: keyof Row, v: string) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, [k]: v } : r)));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (!f.billing_name.trim() || !f.billing_address.trim()) return setError('Enter the client name and address.');
    if (!isPhoneOk(f.billing_phone)) return setError(`Phone: ${PHONE_ERROR}`);
    if (f.client_gstin && !/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(f.client_gstin)) return setError('The GSTIN should be 15 characters, e.g. 24ABCDE1234F1Z5');
    if (rows.some((r) => !r.particulars.trim() || !(Number(r.quantity) > 0) || r.rate === '' || Number(r.rate) < 0)) return setError('Complete every item row.');
    setBusy(true);
    try {
      await api.post('/api/billing/requests', { ...f, items: rows.map((r) => ({ particulars: r.particulars, quantity: Number(r.quantity), rate: Number(r.rate) })) });
      showToast('Invoice request submitted', 'success');
      setF(blankForm());
      setRows([blankRow()]);
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not submit the request.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="xl"
      title="Request a tax invoice"
      description="A billing manager reviews it and issues the invoice."
      footer={
        <>
          <button type="button" onClick={onClose} className="rounded-md border border-border bg-surface px-3.5 py-1.5 text-sm font-medium text-text-secondary hover:bg-surface-secondary">Cancel</button>
          <button type="submit" form="billing-request-form" disabled={busy} className="rounded-md bg-primary px-3.5 py-1.5 text-sm font-medium text-on-primary hover:bg-primary-hover disabled:opacity-50">
            {busy ? 'Submitting…' : 'Submit request'}
          </button>
        </>
      }
    >
      <form id="billing-request-form" onSubmit={submit} noValidate className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className={labelCls}>Client name *</label>
            <input className={inputCls} value={f.billing_name} onChange={set('billing_name')} />
          </div>
          <div>
            <label className={labelCls}>Phone</label>
            <input className={inputCls} {...phoneInput} value={f.billing_phone} onChange={(e) => setF((x) => ({ ...x, billing_phone: phoneDigits(e.target.value) }))} />
          </div>
          <div className="sm:col-span-2">
            <label className={labelCls}>Billing address *</label>
            <input className={inputCls} value={f.billing_address} onChange={set('billing_address')} />
          </div>
          <div>
            <label className={labelCls}>Client GSTIN (optional)</label>
            <input className={`${inputCls} font-mono uppercase`} maxLength={15} value={f.client_gstin}
              onChange={(e) => setF((x) => ({ ...x, client_gstin: e.target.value.toUpperCase() }))} />
          </div>
          <div>
            <label className={labelCls}>Place of supply</label>
            <select className={inputCls} value={f.client_state} onChange={set('client_state')}>
              {STATES.map((s) => <option key={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls}>Branch</label>
            <select className={inputCls} value={f.branch_key} onChange={set('branch_key')}>
              {BRANCHES.map((b) => <option key={b.key} value={b.key}>{b.label}</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls}>Remark</label>
            <input className={inputCls} value={f.remark} onChange={set('remark')} />
          </div>
        </div>

        <div className="space-y-2 rounded-md border border-border p-3">
          <p className="text-xs font-semibold uppercase text-text-muted">Items (before GST)</p>
          {rows.map((r, i) => (
            <div key={i} className="grid grid-cols-12 gap-2">
              <input aria-label={`Item ${i + 1} particulars`} placeholder="Particulars" className={`${inputCls} col-span-12 sm:col-span-6`} value={r.particulars} onChange={(e) => setRow(i, 'particulars', e.target.value)} />
              <input aria-label={`Item ${i + 1} quantity`} type="number" min="0" step="any" placeholder="Qty" className={`${inputCls} col-span-4 sm:col-span-2`} value={r.quantity} onChange={(e) => setRow(i, 'quantity', e.target.value)} />
              <input aria-label={`Item ${i + 1} rate`} type="number" min="0" step="any" placeholder="Rate (₹)" className={`${inputCls} col-span-6 sm:col-span-3`} value={r.rate} onChange={(e) => setRow(i, 'rate', e.target.value)} />
              <button type="button" aria-label={`Remove item ${i + 1}`} disabled={rows.length === 1} onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}
                className="col-span-2 flex items-center justify-center rounded-md text-rose-600 hover:bg-rose-500/10 disabled:opacity-30 sm:col-span-1">
                <Trash2 size={15} />
              </button>
            </div>
          ))}
          <button type="button" onClick={() => setRows((rs) => [...rs, blankRow()])} className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
            <Plus size={13} /> Add item
          </button>
        </div>
        {error && <p role="alert" className="text-sm text-rose-600">{error}</p>}
      </form>
    </Modal>
  );
}

export function BillingRequests() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const { showToast } = useToast();
  const reviewer = can('billing.manage');
  const [status, setStatus] = useState(reviewer ? 'pending' : 'all');
  const [items, setItems] = useState<InvoiceRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  const load = useCallback(() => {
    api.get<{ items: InvoiceRequest[] }>('/api/billing/requests', { status })
      .then((d) => setItems(d.items || []))
      .catch((err) => showToast(err instanceof ApiError ? err.message : 'Could not load requests', 'error'))
      .finally(() => setLoading(false));
  }, [status, showToast]);

  useEffect(load, [load]);

  const reject = async (r: InvoiceRequest) => {
    if (!(await confirm({ title: `Reject ${r.request_number}?`, tone: 'danger', confirmText: 'Reject', message: `${r.billing_name} · ${money(r.estimated_total, true)} requested by ${r.requested_by_name}` }))) return;
    try {
      await api.post(`/api/billing/requests/${r.id}/reject`);
      showToast('Request rejected', 'success');
      load();
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Could not reject the request', 'error');
    }
  };

  return (
    <div className="space-y-6">
      <Card className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-text">Invoice requests</h2>
            <p className="text-xs text-text-muted">
              {reviewer ? 'Approving a request opens it as a tax invoice to check and save.' : 'Requests you have sent to a billing manager.'}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <select value={status} onChange={(e) => { setLoading(true); setStatus(e.target.value); }} aria-label="Filter by status"
              className="rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-text focus:border-primary focus:outline-none">
              <option value="all">All Statuses</option>
              <option value="pending">Pending</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
            </select>
            <button type="button" onClick={() => setCreating(true)}
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3.5 py-1.5 text-sm font-medium text-on-primary hover:bg-primary-hover transition-colors">
              <Plus size={14} /> Request Invoice
            </button>
          </div>
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-text">
            <thead className="border-b border-border bg-surface-secondary text-xs uppercase text-text-muted font-semibold">
              <tr>
                <th className="px-4 py-3">Request #</th>
                <th className="px-4 py-3">Client</th>
                <th className="px-4 py-3">Requested By</th>
                <th className="px-4 py-3">Branch</th>
                <th className="px-4 py-3 text-right">Estimated (₹)</th>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3 text-center">Status</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {loading ? (
                <tr><td colSpan={8} className="p-8 text-center text-text-muted">Loading requests...</td></tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={8} className="p-10 text-center text-text-muted">
                    <Inbox className="mx-auto h-8 w-8 text-text-muted/50 mb-2" />
                    No {status === 'all' ? '' : status} requests.
                  </td>
                </tr>
              ) : (
                items.map((r) => (
                  <tr key={r.id} className="hover:bg-surface-secondary/50">
                    <td className="px-4 py-3 font-semibold text-primary">{r.request_number}</td>
                    <td className="px-4 py-3 font-medium text-text">{r.billing_name}</td>
                    <td className="px-4 py-3 text-xs text-text-secondary">{r.requested_by_name || r.requested_by}</td>
                    <td className="px-4 py-3 text-xs text-text-muted">{branchLabel(r.branch_key)}</td>
                    <td className="px-4 py-3 text-right font-semibold tabular-nums">₹{r.estimated_total.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                    <td className="px-4 py-3 text-xs text-text-muted whitespace-nowrap">{date(r.created_at)}</td>
                    <td className="px-4 py-3 text-center">{statusBadge(r.status)}</td>
                    <td className="px-4 py-3 text-right">
                      {r.status === 'pending' && reviewer && (
                        <div className="flex justify-end gap-2">
                          {can('billing.tax_invoice') && (
                            <button type="button" onClick={() => navigate(`/billing/create?request=${r.id}`)}
                              className="rounded-md bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-700">Approve</button>
                          )}
                          <button type="button" onClick={() => reject(r)}
                            className="rounded-md px-2.5 py-1 text-xs font-medium text-rose-600 hover:bg-rose-500/10">Reject</button>
                        </div>
                      )}
                      {r.invoice_number && <span className="text-xs font-medium text-text-muted">{r.invoice_number}</span>}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <NewRequestModal open={creating} onClose={() => setCreating(false)} onSaved={load} />
    </div>
  );
}
