import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import {
  FileText, PlusCircle, Search, Filter, Download, Eye, Trash2, CheckCircle2,
  Clock, AlertCircle, Banknote, RefreshCw, X
} from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { useToast } from '../components/common/ToastContext';
import { useConfirm } from '../components/common/ConfirmDialog';
import { Card } from '../components/common/Card';
import { StatCard } from '../components/dashboard/StatCard';
import { api, ApiError, saveBlob } from '../lib/api';
import { money, todayISO } from '../lib/format';
import { openBillingPdf } from './pdf';

const PAGE_SIZE = 25;

interface Invoice {
  id: string;
  invoice_number: string;
  invoice_type: string;
  branch_key: string;
  invoice_date: string;
  due_date: string;
  client?: {
    name?: string;
    company_name?: string;
    gstin?: string;
    state?: string;
  };
  grand_total: number;
  paid_amount: number;
  balance_amount: number;
  status: 'issued' | 'paid' | 'partially_paid' | 'overdue';
}

interface Metrics {
  total_invoiced: number;
  total_collected: number;
  total_outstanding: number;
  invoices_count: number;
}

export function InvoicesList() {
  const { can } = useAuth();
  const { showToast } = useToast();
  const confirm = useConfirm();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [branchFilter, setBranchFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);

  // Payment Recording Modal State
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('NEFT/RTGS');
  const [paymentRef, setPaymentRef] = useState('');
  const [submittingPayment, setSubmittingPayment] = useState(false);

  const fetchInvoices = useCallback(async () => {
    try {
      setLoading(true);
      const [invData, mData] = await Promise.all([
        api.get<{ items: Invoice[]; total: number }>('/api/billing/invoices', {
          branch_key: branchFilter !== 'all' ? branchFilter : undefined,
          invoice_type: typeFilter !== 'all' ? typeFilter : undefined,
          status: statusFilter !== 'all' ? statusFilter : undefined,
          search: appliedSearch.trim() || undefined,
          page,
          limit: PAGE_SIZE,
        }),
        api.get<{ metrics: Metrics }>('/api/billing/dashboard/metrics'),
      ]);
      setInvoices(invData.items || []);
      setTotal(invData.total || 0);
      setMetrics(mData.metrics || null);
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Could not load invoices.', 'error');
    } finally {
      setLoading(false);
    }
  }, [branchFilter, typeFilter, statusFilter, appliedSearch, page, showToast]);

  useEffect(() => {
    fetchInvoices();
  }, [fetchInvoices]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    setAppliedSearch(search);
  };

  const resetFilters = () => {
    setSearch('');
    setAppliedSearch('');
    setBranchFilter('all');
    setTypeFilter('all');
    setStatusFilter('all');
    setPage(1);
  };

  const showPdf = (inv: Invoice, download: boolean) =>
    openBillingPdf(`/api/billing/invoices/${inv.id}/pdf`, `${inv.invoice_number.replace(/[^A-Za-z0-9_-]/g, '_')}.pdf`, download)
      .catch((err) => showToast(err instanceof ApiError ? err.message : 'Could not open the PDF', 'error'));

  const handleDelete = async (id: string, invNum: string) => {
    const ok = await confirm({ title: `Delete invoice ${invNum}?`, message: 'This cannot be undone.', confirmText: 'Delete', tone: 'danger' });
    if (!ok) return;
    try {
      await api.delete(`/api/billing/invoices/${id}`);
      showToast(`Invoice ${invNum} deleted`, 'success');
      fetchInvoices();
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Error deleting invoice', 'error');
    }
  };

  const handleRecordPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedInvoice) return;
    const amt = parseFloat(paymentAmount);
    if (isNaN(amt) || amt <= 0) {
      showToast('Please enter a valid payment amount', 'error');
      return;
    }
    if (amt > selectedInvoice.balance_amount + 0.005) {
      showToast(`The payment is more than the balance due (${money(selectedInvoice.balance_amount, true)})`, 'error');
      return;
    }
    try {
      setSubmittingPayment(true);
      await api.post('/api/billing/payments', {
        invoice_id: selectedInvoice.id,
        amount: amt,
        payment_method: paymentMethod,
        reference_number: paymentRef,
        payment_date: todayISO(),
      });
      showToast(`Payment of ₹${amt.toLocaleString('en-IN')} recorded for ${selectedInvoice.invoice_number}`, 'success');
      setSelectedInvoice(null);
      setPaymentAmount('');
      setPaymentRef('');
      fetchInvoices();
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Error recording payment', 'error');
    } finally {
      setSubmittingPayment(false);
    }
  };

  const isOverdue = (inv: Invoice) => inv.balance_amount > 0 && !!inv.due_date && inv.due_date < todayISO();
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const statusBadge = (inv: Invoice) => {
    const st = inv.status !== 'paid' && isOverdue(inv) ? 'overdue' : inv.status;
    switch (st) {
      case 'paid':
        return <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-600 dark:text-emerald-400"><CheckCircle2 size={12} /> Paid</span>;
      case 'partially_paid':
        return <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-600 dark:text-amber-400"><Clock size={12} /> Partial</span>;
      case 'overdue':
        return <span className="inline-flex items-center gap-1 rounded-full bg-rose-500/10 px-2 py-0.5 text-xs font-medium text-rose-600 dark:text-rose-400"><AlertCircle size={12} /> Overdue</span>;
      default:
        return <span className="inline-flex items-center gap-1 rounded-full bg-blue-500/10 px-2 py-0.5 text-xs font-medium text-blue-600 dark:text-blue-400"><Clock size={12} /> Issued</span>;
    }
  };

  return (
    <div className="space-y-6">
      {/* Metrics Row */}
      {metrics && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            icon={FileText}
            label="Total Invoiced"
            value={money(metrics.total_invoiced)}
            hint={`${metrics.invoices_count} total invoices issued`}
          />
          <StatCard
            icon={CheckCircle2}
            tone="success"
            label="Total Collected"
            value={money(metrics.total_collected)}
            hint="Received in bank accounts"
          />
          <StatCard
            icon={AlertCircle}
            tone="danger"
            label="Outstanding Balance"
            value={money(metrics.total_outstanding)}
            hint="Receivables pending settlement"
          />
          <StatCard
            icon={Banknote}
            tone="info"
            label="Active Invoices"
            value={metrics.invoices_count.toString()}
            hint="Across all branches"
          />
        </div>
      )}

      {/* Filter and Search Bar */}
      <Card className="p-4">
        <form onSubmit={handleSearchSubmit} className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-[220px] flex-1">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-text-muted" />
            <input
              type="text"
              placeholder="Search by Invoice #, Client name, GSTIN..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-md border border-border bg-surface pl-9 pr-3 py-1.5 text-sm text-text placeholder:text-text-muted focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>

          <select
            value={branchFilter}
            onChange={(e) => { setBranchFilter(e.target.value); setPage(1); }}
            className="rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-text focus:border-primary focus:outline-none"
          >
            <option value="all">All Branches</option>
            <option value="ahmedabad_y">Ahmedabad(Y) [AM1]</option>
            <option value="ahmedabad_a">Ahmedabad(A) [AM2]</option>
            <option value="baroda">Baroda [BRD]</option>
          </select>

          <select
            value={typeFilter}
            onChange={(e) => { setTypeFilter(e.target.value); setPage(1); }}
            className="rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-text focus:border-primary focus:outline-none"
          >
            <option value="all">All Types</option>
            <option value="invoice">Tax Invoice</option>
            <option value="proforma">Proforma Invoice</option>
          </select>

          <select
            value={statusFilter}
            onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
            className="rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-text focus:border-primary focus:outline-none"
          >
            <option value="all">All Statuses</option>
            <option value="issued">Issued / Unpaid</option>
            <option value="partially_paid">Partially Paid</option>
            <option value="paid">Paid</option>
            <option value="overdue">Overdue</option>
          </select>

          <button
            type="submit"
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3.5 py-1.5 text-sm font-medium text-on-primary hover:bg-primary-hover transition-colors"
          >
            <Filter size={14} /> Filter
          </button>
          <button
            type="button"
            onClick={resetFilters}
            className="inline-flex items-center gap-1 rounded-md border border-border bg-surface px-3 py-1.5 text-sm font-medium text-text-secondary hover:bg-surface-secondary"
          >
            <RefreshCw size={13} /> Reset
          </button>
          <button
            type="button"
            onClick={() => api.blob('/api/billing/export/invoices.csv').then((b) => saveBlob(b, 'invoices.csv')).catch((err) => showToast(err instanceof ApiError ? err.message : 'Export failed', 'error'))}
            className="inline-flex items-center gap-1 rounded-md border border-border bg-surface px-3 py-1.5 text-sm font-medium text-text-secondary hover:bg-surface-secondary"
          >
            <Download size={13} /> Export CSV
          </button>
        </form>
      </Card>

      {/* Invoices Table */}
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-text">
            <thead className="border-b border-border bg-surface-secondary text-xs uppercase text-text-muted font-semibold">
              <tr>
                <th className="px-4 py-3">Invoice #</th>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Client & GSTIN</th>
                <th className="px-4 py-3">Branch</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3 text-right">Total (₹)</th>
                <th className="px-4 py-3 text-right">Balance (₹)</th>
                <th className="px-4 py-3 text-center">Status</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {loading ? (
                <tr>
                  <td colSpan={9} className="px-4 py-12 text-center text-text-muted">
                    <RefreshCw className="mx-auto h-6 w-6 animate-spin mb-2" />
                    Loading invoices...
                  </td>
                </tr>
              ) : invoices.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-12 text-center text-text-muted">
                    <FileText className="mx-auto h-10 w-10 text-text-muted/50 mb-3" />
                    <p className="font-semibold text-text">No invoices found</p>
                    <p className="text-xs text-text-muted mt-1">Try changing search filters or create your first tax invoice.</p>
                    {can('billing.create') && (
                      <Link
                        to="/billing/create"
                        className="mt-4 inline-flex items-center gap-2 rounded-md bg-primary px-3.5 py-1.5 text-xs font-medium text-on-primary hover:bg-primary-hover"
                      >
                        <PlusCircle size={14} /> Create Invoice Now
                      </Link>
                    )}
                  </td>
                </tr>
              ) : (
                invoices.map((inv) => (
                  <tr key={inv.id} className="hover:bg-surface-secondary/50 transition-colors">
                    <td className="px-4 py-3 font-semibold text-primary">
                      {inv.invoice_number}
                    </td>
                    <td className="px-4 py-3 text-xs text-text-muted whitespace-nowrap">
                      {inv.invoice_date}
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-text">{inv.client?.name || inv.client?.company_name || 'Client'}</div>
                      <div className="text-xs text-text-muted font-mono">{inv.client?.gstin || 'Unregistered'}</div>
                    </td>
                    <td className="px-4 py-3 text-xs text-text-secondary">
                      {inv.branch_key === 'ahmedabad_y' ? 'Ahmedabad(Y)' : inv.branch_key === 'ahmedabad_a' ? 'Ahmedabad(A)' : 'Baroda'}
                    </td>
                    <td className="px-4 py-3 text-xs">
                      <span className={`px-2 py-0.5 rounded text-[11px] font-medium ${inv.invoice_type === 'proforma' ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300' : 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300'}`}>
                        {inv.invoice_type === 'proforma' ? 'Proforma' : 'Tax Inv'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-medium text-text">
                      ₹{inv.grand_total?.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold text-rose-600 dark:text-rose-400">
                      ₹{inv.balance_amount?.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {statusBadge(inv)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="inline-flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => showPdf(inv, false)}
                          title="View PDF"
                          aria-label={`View PDF of ${inv.invoice_number}`}
                          className="rounded p-1 text-text-muted hover:bg-surface-secondary hover:text-primary transition-colors"
                        >
                          <Eye size={15} />
                        </button>
                        <button
                          type="button"
                          onClick={() => showPdf(inv, true)}
                          title="Download PDF"
                          aria-label={`Download PDF of ${inv.invoice_number}`}
                          className="rounded p-1 text-text-muted hover:bg-surface-secondary hover:text-emerald-600 transition-colors"
                        >
                          <Download size={15} />
                        </button>
                        {can('billing.manage') && inv.balance_amount > 0 && (
                          <button
                            onClick={() => { setSelectedInvoice(inv); setPaymentAmount(inv.balance_amount.toString()); }}
                            title="Record Payment"
                            className="rounded p-1 text-text-muted hover:bg-surface-secondary hover:text-amber-600 transition-colors"
                          >
                            <Banknote size={15} />
                          </button>
                        )}
                        {can('billing.manage') && (
                          <button
                            onClick={() => handleDelete(inv.id, inv.invoice_number)}
                            title="Delete Invoice"
                            className="rounded p-1 text-text-muted hover:bg-surface-secondary hover:text-rose-600 transition-colors"
                          >
                            <Trash2 size={15} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {total > PAGE_SIZE && (
          <div className="flex items-center justify-between border-t border-border px-4 py-3 text-xs text-text-muted">
            <span>Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} of {total}</span>
            <div className="flex gap-2">
              <button type="button" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}
                className="rounded-md border border-border px-3 py-1 font-medium text-text disabled:opacity-40">Previous</button>
              <button type="button" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}
                className="rounded-md border border-border px-3 py-1 font-medium text-text disabled:opacity-40">Next</button>
            </div>
          </div>
        )}
      </Card>

      {/* Record Payment Modal */}
      {selectedInvoice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-lg border border-border bg-surface p-6 shadow-xl">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <h3 className="font-semibold text-text">Record Payment for {selectedInvoice.invoice_number}</h3>
              <button onClick={() => setSelectedInvoice(null)} className="text-text-muted hover:text-text">
                <X size={18} />
              </button>
            </div>
            <form onSubmit={handleRecordPayment} className="mt-4 space-y-4">
              <div>
                <p className="text-xs text-text-muted">Client</p>
                <p className="text-sm font-medium text-text">{selectedInvoice.client?.name || selectedInvoice.client?.company_name}</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-xs text-text-muted">Total Invoiced</p>
                  <p className="text-sm font-medium text-text">₹{selectedInvoice.grand_total.toLocaleString('en-IN')}</p>
                </div>
                <div>
                  <p className="text-xs text-text-muted">Current Balance</p>
                  <p className="text-sm font-bold text-rose-600">₹{selectedInvoice.balance_amount.toLocaleString('en-IN')}</p>
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-text mb-1">Payment Amount (₹) *</label>
                <input
                  type="number"
                  step="0.01"
                  required
                  value={paymentAmount}
                  onChange={(e) => setPaymentAmount(e.target.value)}
                  className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text focus:border-primary focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-text mb-1">Payment Method</label>
                <select
                  value={paymentMethod}
                  onChange={(e) => setPaymentMethod(e.target.value)}
                  className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text focus:border-primary focus:outline-none"
                >
                  <option value="NEFT/RTGS">NEFT / RTGS</option>
                  <option value="UPI">UPI / QR</option>
                  <option value="Cheque">Cheque</option>
                  <option value="Cash">Cash</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-text mb-1">Reference / UTR / Cheque #</label>
                <input
                  type="text"
                  placeholder="e.g. UTR12345678"
                  value={paymentRef}
                  onChange={(e) => setPaymentRef(e.target.value)}
                  className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text focus:border-primary focus:outline-none"
                />
              </div>
              <div className="flex items-center justify-end gap-2 border-t border-border pt-4">
                <button
                  type="button"
                  onClick={() => setSelectedInvoice(null)}
                  className="rounded-md border border-border bg-surface px-4 py-2 text-xs font-medium text-text hover:bg-surface-secondary"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingPayment}
                  className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-4 py-2 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                >
                  {submittingPayment ? 'Saving...' : 'Save Payment'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
