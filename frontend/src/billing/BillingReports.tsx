import { useState, useEffect } from 'react';
import { BarChart3, TrendingUp, AlertTriangle, FileSpreadsheet, Download } from 'lucide-react';
import { Card, CardHeader } from '../components/common/Card';
import { StatCard } from '../components/dashboard/StatCard';
import { useToast } from '../components/common/ToastContext';
import { api, ApiError, saveBlob } from '../lib/api';
import { money } from '../lib/format';

interface Gstr1 {
  summary?: { total_taxable_amount: number; total_tax: number; total_cgst: number; total_sgst: number; total_igst: number;
    b2b_invoices_count: number; b2c_invoices_count: number };
}
interface Aging { total_overdue?: number; total_outstanding?: number }
interface Month { month: string; invoices: number; taxable: number; tax: number; invoiced: number; collected: number }

export function BillingReports() {
  const { showToast } = useToast();
  const [gstr, setGstr] = useState<Gstr1 | null>(null);
  const [aging, setAging] = useState<Aging | null>(null);
  const [months, setMonths] = useState<Month[]>([]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([api.get<Gstr1>('/api/billing/reports/gstr1'), api.get<Aging>('/api/billing/reports/aging'), api.get<{ items: Month[] }>('/api/billing/reports/monthly')])
      .then(([g, a, m]) => {
        if (cancelled) return;
        setGstr(g);
        setAging(a);
        setMonths(m.items || []);
      })
      .catch((err) => showToast(err instanceof ApiError ? err.message : 'Could not load billing reports', 'error'));
    return () => { cancelled = true; };
  }, [showToast]);

  const exportRegister = (month?: string) =>
    api.blob('/api/billing/reports/gst-register.csv', { month })
      .then((b) => saveBlob(b, `gst-register${month ? `-${month}` : ''}.csv`))
      .catch((err) => showToast(err instanceof ApiError ? err.message : 'Export failed', 'error'));

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          icon={FileSpreadsheet}
          label="Total Taxable Value"
          value={money(gstr?.summary?.total_taxable_amount || 0)}
          hint="Gross revenue subject to GST"
        />
        <StatCard
          icon={TrendingUp}
          tone="info"
          label="Total GST Liability"
          value={money(gstr?.summary?.total_tax || 0)}
          hint={`CGST: ₹${(gstr?.summary?.total_cgst || 0).toLocaleString()} | SGST: ₹${(gstr?.summary?.total_sgst || 0).toLocaleString()}`}
        />
        <StatCard
          icon={AlertTriangle}
          tone="danger"
          label="Overdue Receivables"
          value={money(aging?.total_overdue || 0)}
          hint={`Past due date · ${money(aging?.total_outstanding || 0)} outstanding in total`}
        />
        <StatCard
          icon={BarChart3}
          label="B2B Registered Invoices"
          value={(gstr?.summary?.b2b_invoices_count || 0).toString()}
          hint={`B2C: ${gstr?.summary?.b2c_invoices_count || 0} unregistered`}
        />
      </div>

      {/* GSTR-1 Breakdown */}
      <Card className="p-5">
        <CardHeader title="GSTR-1 Statutory Return Preparation" description="Tax liability split between Gujarat intra-state (CGST + SGST) and inter-state (IGST) supplies" />
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="rounded-lg border border-border bg-surface-secondary/40 p-4">
            <p className="text-xs text-text-muted">Central GST (CGST)</p>
            <p className="mt-1 text-xl font-bold text-text">₹{(gstr?.summary?.total_cgst || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</p>
          </div>
          <div className="rounded-lg border border-border bg-surface-secondary/40 p-4">
            <p className="text-xs text-text-muted">State GST (SGST)</p>
            <p className="mt-1 text-xl font-bold text-text">₹{(gstr?.summary?.total_sgst || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</p>
          </div>
          <div className="rounded-lg border border-border bg-surface-secondary/40 p-4">
            <p className="text-xs text-text-muted">Integrated GST (IGST)</p>
            <p className="mt-1 text-xl font-bold text-text">₹{(gstr?.summary?.total_igst || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</p>
          </div>
        </div>
      </Card>

      {/* Monthly summary */}
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 p-5 pb-3">
          <CardHeader title="Monthly Summary" description="Tax invoices raised and money collected in each month" />
          <button type="button" onClick={() => exportRegister()}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 text-sm font-medium text-text-secondary hover:bg-surface-secondary">
            <Download size={13} /> GST Register CSV
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-text">
            <thead className="border-y border-border bg-surface-secondary text-xs uppercase text-text-muted font-semibold">
              <tr>
                <th className="px-4 py-3">Month</th>
                <th className="px-4 py-3 text-right">Invoices</th>
                <th className="px-4 py-3 text-right">Taxable (₹)</th>
                <th className="px-4 py-3 text-right">GST (₹)</th>
                <th className="px-4 py-3 text-right">Invoiced (₹)</th>
                <th className="px-4 py-3 text-right">Collected (₹)</th>
                <th className="px-4 py-3 text-right">Register</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {months.length === 0 ? (
                <tr><td colSpan={7} className="p-8 text-center text-text-muted">No invoices yet.</td></tr>
              ) : months.map((m) => (
                <tr key={m.month} className="hover:bg-surface-secondary/50">
                  <td className="px-4 py-3 font-semibold">{m.month}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{m.invoices}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{m.taxable.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{m.tax.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                  <td className="px-4 py-3 text-right font-semibold tabular-nums">{m.invoiced.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                  <td className="px-4 py-3 text-right font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">{m.collected.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                  <td className="px-4 py-3 text-right">
                    <button type="button" onClick={() => exportRegister(m.month)} title={`GST register for ${m.month}`} aria-label={`Download GST register for ${m.month}`}
                      className="rounded-md p-1.5 text-text-muted hover:bg-surface-secondary hover:text-text"><Download size={15} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
