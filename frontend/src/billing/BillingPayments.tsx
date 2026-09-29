import { useState, useEffect } from 'react';
import { Banknote, Trash2 } from 'lucide-react';
import { Card } from '../components/common/Card';
import { useToast } from '../components/common/ToastContext';
import { useConfirm } from '../components/common/ConfirmDialog';
import { api, ApiError } from '../lib/api';

interface Payment {
  id: string;
  invoice_number: string;
  client_name: string;
  amount: number;
  payment_method: string;
  reference_number: string;
  payment_date: string;
  recorded_by: string;
}

export function BillingPayments() {
  const { showToast } = useToast();
  const confirm = useConfirm();
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let cancelled = false;
    api.get<{ items: Payment[] }>('/api/billing/payments')
      .then((data) => { if (!cancelled) setPayments(data.items || []); })
      .catch((err) => showToast(err instanceof ApiError ? err.message : 'Could not load payments', 'error'))
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [showToast, reload]);

  const reverse = async (p: Payment) => {
    if (!(await confirm({ title: `Remove payment on ${p.invoice_number}?`, tone: 'danger', confirmText: 'Remove', message: `₹${p.amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })} goes back onto the invoice balance.` }))) return;
    try {
      await api.delete(`/api/billing/payments/${p.id}`);
      showToast('Payment removed', 'success');
      setReload((n) => n + 1);
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Could not remove the payment', 'error');
    }
  };

  return (
    <div className="space-y-6">
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-text">
            <thead className="border-b border-border bg-surface-secondary text-xs uppercase text-text-muted font-semibold">
              <tr>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Invoice #</th>
                <th className="px-4 py-3">Customer</th>
                <th className="px-4 py-3">Method</th>
                <th className="px-4 py-3">Reference / UTR</th>
                <th className="px-4 py-3 text-right">Amount Received (₹)</th>
                <th className="px-4 py-3 text-right">Recorded By</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {loading ? (
                <tr><td colSpan={8} className="p-8 text-center text-text-muted">Loading payment ledger...</td></tr>
              ) : payments.length === 0 ? (
                <tr>
                  <td colSpan={8} className="p-10 text-center text-text-muted">
                    <Banknote className="mx-auto h-8 w-8 text-text-muted/50 mb-2" />
                    No payments recorded yet.
                  </td>
                </tr>
              ) : (
                payments.map((p) => (
                  <tr key={p.id} className="hover:bg-surface-secondary/50">
                    <td className="px-4 py-3 text-xs text-text-muted">{p.payment_date}</td>
                    <td className="px-4 py-3 font-semibold text-primary">{p.invoice_number}</td>
                    <td className="px-4 py-3 font-medium text-text">{p.client_name}</td>
                    <td className="px-4 py-3 text-xs text-text-secondary">
                      <span className="rounded bg-surface-secondary px-2 py-0.5 border border-border">{p.payment_method}</span>
                    </td>
                    <td className="px-4 py-3 text-xs font-mono text-text">{p.reference_number || '—'}</td>
                    <td className="px-4 py-3 text-right font-bold text-emerald-600 dark:text-emerald-400">
                      ₹{p.amount?.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </td>
                    <td className="px-4 py-3 text-right text-xs text-text-muted">{p.recorded_by}</td>
                    <td className="px-4 py-3 text-right">
                      <button type="button" onClick={() => reverse(p)} title="Remove payment" aria-label={`Remove payment on ${p.invoice_number}`}
                        className="rounded-md p-1.5 text-rose-600 hover:bg-rose-500/10"><Trash2 size={15} /></button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
