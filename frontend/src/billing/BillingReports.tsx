import { useState, useEffect } from 'react';
import { BarChart3, TrendingUp, AlertTriangle, FileSpreadsheet } from 'lucide-react';
import { Card, CardHeader } from '../components/common/Card';
import { StatCard } from '../components/dashboard/StatCard';
import { useToast } from '../components/common/ToastContext';
import { api, ApiError } from '../lib/api';
import { money } from '../lib/format';

interface Gstr1 {
  summary?: { total_taxable_amount: number; total_tax: number; total_cgst: number; total_sgst: number; total_igst: number;
    b2b_invoices_count: number; b2c_invoices_count: number };
}
interface Aging { total_overdue?: number; total_outstanding?: number }

export function BillingReports() {
  const { showToast } = useToast();
  const [gstr, setGstr] = useState<Gstr1 | null>(null);
  const [aging, setAging] = useState<Aging | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([api.get<Gstr1>('/api/billing/reports/gstr1'), api.get<Aging>('/api/billing/reports/aging')])
      .then(([g, a]) => {
        if (cancelled) return;
        setGstr(g);
        setAging(a);
      })
      .catch((err) => showToast(err instanceof ApiError ? err.message : 'Could not load billing reports', 'error'));
    return () => { cancelled = true; };
  }, [showToast]);

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
    </div>
  );
}
