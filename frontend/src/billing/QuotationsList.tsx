import { useState, useEffect, useCallback } from 'react';
import { ScrollText, Eye, ArrowRight, Trash2 } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { useToast } from '../components/common/ToastContext';
import { useConfirm } from '../components/common/ConfirmDialog';
import { Card } from '../components/common/Card';
import { api, ApiError } from '../lib/api';
import { openBillingPdf } from './pdf';

const PAGE_SIZE = 25;

interface Quotation {
  id: string;
  quotation_number: string;
  quotation_date: string;
  valid_until: string;
  client?: {
    name?: string;
    company_name?: string;
    gstin?: string;
  };
  grand_total: number;
  status: string;
}

export function QuotationsList() {
  const { can } = useAuth();
  const { showToast } = useToast();
  const confirm = useConfirm();
  const [quotations, setQuotations] = useState<Quotation[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);

  const fetchQuotations = useCallback(async () => {
    try {
      setLoading(true);
      const data = await api.get<{ items: Quotation[]; total: number }>('/api/billing/quotations', { page, limit: PAGE_SIZE });
      setQuotations(data.items || []);
      setTotal(data.total || 0);
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Could not load quotations', 'error');
    } finally {
      setLoading(false);
    }
  }, [page, showToast]);

  useEffect(() => {
    fetchQuotations();
  }, [fetchQuotations]);

  const handleConvert = async (id: string, qNum: string) => {
    const ok = await confirm({ title: `Convert quotation ${qNum}?`, message: 'A tax invoice is issued with the next invoice number for its branch.', confirmText: 'Convert to invoice' });
    if (!ok) return;
    try {
      const data = await api.post<{ message?: string }>(`/api/billing/quotations/${id}/convert`);
      showToast(data.message || 'Converted to Tax Invoice!', 'success');
      fetchQuotations();
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Error converting quotation', 'error');
    }
  };

  const handleDelete = async (id: string, qNum: string) => {
    const ok = await confirm({ title: `Delete quotation ${qNum}?`, message: 'This cannot be undone.', confirmText: 'Delete', tone: 'danger' });
    if (!ok) return;
    try {
      await api.delete(`/api/billing/quotations/${id}`);
      showToast('Quotation deleted', 'success');
      fetchQuotations();
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Error deleting quotation', 'error');
    }
  };

  const showPdf = (q: Quotation) =>
    openBillingPdf(`/api/billing/quotations/${q.id}/pdf`, `${q.quotation_number}.pdf`, false)
      .catch((err) => showToast(err instanceof ApiError ? err.message : 'Could not open the PDF', 'error'));

  return (
    <div className="space-y-6">
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-text">
            <thead className="border-b border-border bg-surface-secondary text-xs uppercase text-text-muted font-semibold">
              <tr>
                <th className="px-4 py-3">Quotation #</th>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Valid Until</th>
                <th className="px-4 py-3">Client</th>
                <th className="px-4 py-3 text-right">Grand Total (₹)</th>
                <th className="px-4 py-3 text-center">Status</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {loading ? (
                <tr><td colSpan={7} className="p-8 text-center text-text-muted">Loading quotations...</td></tr>
              ) : quotations.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-10 text-center text-text-muted">
                    <ScrollText className="mx-auto h-8 w-8 text-text-muted/50 mb-2" />
                    No quotations generated yet.
                  </td>
                </tr>
              ) : (
                quotations.map((q) => (
                  <tr key={q.id} className="hover:bg-surface-secondary/50">
                    <td className="px-4 py-3 font-semibold text-primary">{q.quotation_number}</td>
                    <td className="px-4 py-3 text-xs text-text-muted">{q.quotation_date}</td>
                    <td className="px-4 py-3 text-xs text-text-muted">{q.valid_until}</td>
                    <td className="px-4 py-3 font-medium text-text">{q.client?.name || q.client?.company_name}</td>
                    <td className="px-4 py-3 text-right font-medium text-text">₹{q.grand_total?.toLocaleString('en-IN')}</td>
                    <td className="px-4 py-3 text-center">
                      <span className={`px-2 py-0.5 rounded text-[11px] font-medium ${q.status === 'converted' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300' : 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300'}`}>
                        {q.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="inline-flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => showPdf(q)}
                          title="View PDF"
                          aria-label={`View PDF of ${q.quotation_number}`}
                          className="rounded p-1 text-text-muted hover:text-primary"
                        >
                          <Eye size={15} />
                        </button>
                        {can('billing.create') && q.status !== 'converted' && (
                          <button
                            onClick={() => handleConvert(q.id, q.quotation_number)}
                            title="Convert to Tax Invoice"
                            className="inline-flex items-center gap-1 rounded bg-emerald-600/10 px-2 py-0.5 text-xs font-medium text-emerald-700 hover:bg-emerald-600/20"
                          >
                            <ArrowRight size={13} /> Convert to Invoice
                          </button>
                        )}
                        {can('billing.manage') && (
                          <button
                            onClick={() => handleDelete(q.id, q.quotation_number)}
                            title="Delete Quotation"
                            className="rounded p-1 text-text-muted hover:text-rose-600"
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
              <button type="button" disabled={page * PAGE_SIZE >= total} onClick={() => setPage((p) => p + 1)}
                className="rounded-md border border-border px-3 py-1 font-medium text-text disabled:opacity-40">Next</button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
