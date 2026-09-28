import { useEffect, useState } from 'react';
import { ArrowDownRight, ArrowRight, ArrowUpRight, Clock, FileDown, LineChart as LineIcon } from 'lucide-react';
import { useApi } from '../../lib/useApi';
import { ApiError, api, saveBlob } from '../../lib/api';
import { companyReport, exportReport, individualReport } from '../api';
import { EmployeeOptionList, useEmployeeOptions } from '../HrSection';
import { Badge } from '../../components/common/Badge';
import { Button } from '../../components/common/Button';
import { Card, CardHeader } from '../../components/common/Card';
import { EmptyState } from '../../components/common/EmptyState';
import { ErrorState } from '../../components/common/ErrorState';
import { Select } from '../../components/common/Input';
import { Skeleton } from '../../components/common/Skeleton';
import { useToast } from '../../components/common/ToastContext';
import { HBarChart, LineChart, type Datum } from '../../components/charts/Charts';
import { StatCard } from '../../components/dashboard/StatCard';
import { PageHeader } from '../../components/layout/PageHeader';

const PRESETS = [['THIS_MONTH', 'This month'], ['LAST_MONTH', 'Last month'], ['YEAR_TO_DATE', 'Year to date']] as const;

const toData = (c?: { labels: string[]; datasets: { data: number[] }[] }): Datum[] =>
  c ? c.labels.map((label, i) => ({ label, value: Number(c.datasets[0]?.data[i]) || 0 })) : [];

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function Individual({ employee, preset }: { employee: string; preset: string }) {
  const rep = useApi(() => individualReport(employee, preset), [employee, preset], !!employee);
  if (rep.status === 'error') return <Card><ErrorState onRetry={rep.reload} message={rep.error} /></Card>;
  const r = rep.data;
  if (!r || rep.loading) return <div className="grid gap-4 lg:grid-cols-3"><Skeleton className="h-40" /><Skeleton className="h-40 lg:col-span-2" /></div>;
  const t = r.productivity_trend;
  const TrendIcon = t.direction === 'UP' ? ArrowUpRight : t.direction === 'DOWN' ? ArrowDownRight : ArrowRight;
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card className="p-5">
        <p className="text-xs font-medium text-text-muted">Performance score</p>
        <p className="mt-1 text-sm font-semibold text-text">{r.employee_name}</p>
        <p className="text-xs text-text-muted">{r.designation} · {r.department} · {r.employee_id}</p>
        <div className="mt-5 flex items-end gap-2">
          <span className="text-5xl font-semibold tracking-tight text-text">{Math.round(r.score_card.overall_score)}</span>
          <span className="mb-1.5 text-sm text-text-muted">/ 100</span>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Badge tone="primary">Grade {r.score_card.grade}</Badge>
          <Badge tone={t.direction === 'UP' ? 'success' : t.direction === 'DOWN' ? 'danger' : 'neutral'}>
            <TrendIcon size={12} aria-hidden="true" /> {t.delta_percentage > 0 ? '+' : ''}{t.delta_percentage}% vs prior period
          </Badge>
        </div>
        <p className="mt-2 text-xs text-text-muted">Client hours {t.previous_value} h → {t.current_value} h</p>
      </Card>
      <Card className="lg:col-span-2">
        <CardHeader title="Daily client hours" />
        <div className="p-4"><LineChart data={toData(r.daily_hours_chart)} valueLabel="Hours" format={(v) => `${v} h`} /></div>
      </Card>
      <Card className="lg:col-span-3">
        <CardHeader title="Task distribution" description="Tasks by status in this period" />
        <div className="p-4"><HBarChart data={toData(r.task_distribution_chart)} valueLabel="Tasks" slot={2} emptyText="No tasks in this period" /></div>
      </Card>
    </div>
  );
}

function Company({ preset }: { preset: string }) {
  const rep = useApi(() => companyReport(preset), [preset]);
  if (rep.status === 'error') return <Card><ErrorState onRetry={rep.reload} message={rep.error} /></Card>;
  const r = rep.data;
  if (!r || rep.loading) return <div className="grid gap-4 lg:grid-cols-2"><Skeleton className="h-48" /><Skeleton className="h-48" /></div>;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="lg:col-span-2"><StatCard icon={Clock} tone="info" label={`Client hours billed · ${r.date_range_label}`} value={`${r.total_hours_billed_clients} h`} /></div>
      <Card>
        <CardHeader title="Hours by client" />
        <div className="p-4"><HBarChart data={toData(r.client_billing_chart)} valueLabel="Hours" format={(v) => `${v} h`} emptyText="No client hours logged" /></div>
      </Card>
      <Card>
        <CardHeader title="Blocker root causes" />
        <div className="p-4"><HBarChart data={toData(r.blocker_categories_chart)} valueLabel="Blockers" slot={3} emptyText="No blockers flagged" /></div>
      </Card>
    </div>
  );
}

export function Performance() {
  const { showToast } = useToast();
  const { employees, available } = useEmployeeOptions();
  const [scope, setScope] = useState<'INDIVIDUAL' | 'COMPANY'>(available ? 'INDIVIDUAL' : 'COMPANY');
  const [employee, setEmployee] = useState('');
  const [preset, setPreset] = useState('THIS_MONTH');
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    if (!employee && employees[0]) setEmployee(employees[0].employee_code);
  }, [employees, employee]);

  // Individual reports export as PDF, company reports as Excel (what the report engine produces).
  const download = async () => {
    setExporting(true);
    try {
      const individual = scope === 'INDIVIDUAL';
      const job = await exportReport({ scope: individual ? 'INDIVIDUAL' : 'COMPANY_WIDE', export_format: individual ? 'PDF' : 'EXCEL', employee_id: individual ? employee : null, preset });
      const params = individual ? { ext: 'pdf', emp: employee } : { ext: 'xlsx' };
      for (let attempt = 0; attempt < 30; attempt++) {
        await wait(2000);
        try {
          const blob = await api.blob(`/api/reports/download/${job.job_id}`, params);
          saveBlob(blob, individual ? `performance-${employee}-${preset.toLowerCase()}.pdf` : `company-performance-${preset.toLowerCase()}.xlsx`);
          showToast('Report downloaded', 'success');
          return;
        } catch (err) {
          if (!(err instanceof ApiError && err.status === 404)) throw err;
        }
      }
      showToast('The report is taking longer than expected. It will also be emailed to you when ready.', 'info');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Export failed', 'error');
    } finally {
      setExporting(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Performance"
        description="100-point scorecards from attendance, timesheets and task delivery."
        breadcrumbs={[{ label: 'HR' }, { label: 'Performance' }]}
        actions={<Button variant="secondary" onClick={download} loading={exporting} disabled={scope === 'INDIVIDUAL' && !employee}><FileDown size={15} /> {scope === 'INDIVIDUAL' ? 'Download PDF' : 'Download Excel'}</Button>}
      />
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div role="tablist" aria-label="Report scope" className="inline-flex rounded-lg border border-border bg-surface p-1">
          {([['INDIVIDUAL', 'Individual'], ['COMPANY', 'Company-wide']] as const).map(([id, label]) => (
            <button key={id} role="tab" aria-selected={scope === id} disabled={id === 'INDIVIDUAL' && !available} onClick={() => setScope(id)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-40 ${scope === id ? 'bg-primary-soft text-primary' : 'text-text-muted hover:text-text'}`}>
              {label}
            </button>
          ))}
        </div>
        {scope === 'INDIVIDUAL' && (
          <Select aria-label="Employee" value={employee} onChange={(e) => setEmployee(e.target.value)} selectClassName="w-60">
            <EmployeeOptionList valueKey="employee_code" />
          </Select>
        )}
        <Select aria-label="Period" value={preset} onChange={(e) => setPreset(e.target.value)} selectClassName="w-40">
          {PRESETS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
        </Select>
      </div>
      {scope === 'INDIVIDUAL'
        ? employee ? <Individual employee={employee} preset={preset} /> : <Card><EmptyState icon={LineIcon} title="No employees yet" description="Add employees to see their scorecards." /></Card>
        : <Company preset={preset} />}
    </>
  );
}
