import { useState } from 'react';
import { Award, Download, RefreshCw, Trophy } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { api, ApiError } from '../lib/api';
import { useApi } from '../lib/useApi';
import { MONTHS, money, todayISO } from '../lib/format';
import { Badge } from '../components/common/Badge';
import { Button } from '../components/common/Button';
import { Card } from '../components/common/Card';
import { useConfirm } from '../components/common/ConfirmDialog';
import { EmptyState } from '../components/common/EmptyState';
import { ErrorState } from '../components/common/ErrorState';
import { Input, Select } from '../components/common/Input';
import { Table, type Column } from '../components/common/Table';
import { Tabs } from '../components/common/Tabs';
import { useToast } from '../components/common/ToastContext';
import { PageHeader } from '../components/layout/PageHeader';
import { MyPerformanceCard } from './MyPerformance';
import { downloadScorecard, getScorecard, type Incentive, type Period, type ScoreRow } from './performance';

const PERIODS: { id: Period; label: string }[] = [{ id: 'day', label: 'Daily' }, { id: 'week', label: 'Weekly' }, { id: 'month', label: 'Monthly' }];

function Eligibility({ inc }: { inc: Incentive }) {
  return (
    <span title={inc.note} className="inline-flex flex-col items-end gap-0.5">
      <Badge tone={inc.eligible ? 'success' : 'warning'}>{inc.eligibility.status}</Badge>
      {!inc.eligible && inc.eligibility.required > 0 && <span className="text-[11px] text-text-muted">{money(inc.eligibility.remaining)} to go</span>}
    </span>
  );
}

/** Leaderboard for everyone (hrView adds each person's incentive breakdown, payroll status and recalculation). */
export function SalesScorecard({ hrView = false }: { hrView?: boolean }) {
  const { can } = useAuth();
  const { showToast } = useToast();
  const confirm = useConfirm();
  const [period, setPeriod] = useState<Period>('month');
  const [day, setDay] = useState(todayISO());
  const [department, setDepartment] = useState('');
  const [busy, setBusy] = useState('');
  const board = useApi(() => getScorecard(period, day, department), [period, day, department]);
  const data = board.data;

  const exportAs = async (format: 'xlsx' | 'pdf') => {
    setBusy(format);
    try {
      await downloadScorecard(period, day, department, format);
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Could not download the scorecard', 'error');
    } finally {
      setBusy('');
    }
  };

  const recalculate = async (r: ScoreRow) => {
    const [y, m] = day.split('-').map(Number);
    const month = MONTHS[m - 1];
    if (!(await confirm({ title: `Recalculate ${r.name}'s ${month} payroll?`, confirmText: 'Recalculate',
      message: 'Payroll is worked out again from the current collections and incentive rules. Manual edits to this payroll record are replaced. The previous and new incentive are kept in its history.' }))) return;
    setBusy(r.email);
    try {
      await api.post('/api/payroll/calculate', { employee_id: r.employee_id, month, year: y });
      showToast(`${r.name}'s payroll recalculated`, 'success');
      board.reload();
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Could not recalculate', 'error');
    } finally {
      setBusy('');
    }
  };

  const showIncentive = hrView || period === 'month';
  const columns: Column<ScoreRow>[] = [
    { key: 'rank', header: 'Rank', render: (r) => <span className="inline-flex items-center gap-1 font-semibold text-text">{r.rank <= 3 && r.net_collection > 0 && <Trophy size={14} className={r.rank === 1 ? 'text-warning' : 'text-text-muted'} />}{r.rank}</span>, sortValue: (r) => r.rank },
    { key: 'name', header: 'Employee', render: (r) => <span><span className="block font-medium text-text">{r.name}</span><span className="text-xs text-text-muted">{r.employee_code || r.email} · {r.department}</span></span>, sortValue: (r) => r.name },
    { key: 'gross', header: 'Gross collection', align: 'right', render: (r) => money(r.gross_collection), sortValue: (r) => r.gross_collection },
    { key: 'dsc', header: 'DSC', align: 'right', render: (r) => <span className="whitespace-nowrap">{r.dsc_deduction ? `− ${money(r.dsc_deduction)}` : '—'}</span>, sortValue: (r) => r.dsc_deduction },
    { key: 'net', header: 'Net eligible', align: 'right', render: (r) => <span className="font-semibold text-text">{money(r.net_collection)}</span>, sortValue: (r) => r.net_collection },
    { key: 'target', header: period === 'month' ? 'Target (salary ×)' : 'Target', align: 'right', render: (r) => (r.target == null ? '—' : money(r.target)) },
    { key: 'ach', header: 'Achievement', align: 'right', render: (r) => (r.achievement == null ? '—' : `${r.achievement}%`), sortValue: (r) => r.achievement ?? -1 },
  ];
  if (showIncentive) {
    columns.push(
      { key: 'elig', header: `Eligibility (${data?.month ?? 'month'})`, align: 'right', render: (r) => (r.incentive ? <Eligibility inc={r.incentive} /> : '—') },
    );
  }
  if (hrView) {
    columns.push(
      { key: 'daily', header: 'Daily', align: 'right', render: (r) => money(r.incentive?.daily_incentive) },
      { key: 'weekly', header: 'Weekly', align: 'right', render: (r) => money(r.incentive?.weekly_incentive) },
      { key: 'monthly', header: 'Monthly', align: 'right', render: (r) => <span>{money(r.incentive?.monthly_incentive)}{r.incentive?.slab_percent != null && <span className="block text-[11px] text-text-muted">{r.incentive.slab_percent}% slab</span>}</span> },
      { key: 'total', header: 'Total incentive', align: 'right', render: (r) => <span className="font-semibold text-success">{money(r.incentive?.incentive)}</span>, sortValue: (r) => r.incentive?.incentive ?? 0 },
      {
        key: 'payroll', header: 'Payroll', align: 'right', render: (r) => {
          if (!r.employee_id) return <span className="text-xs text-text-muted">No employee record</span>;
          const differs = r.payroll && r.incentive && Math.abs(r.payroll.incentive - r.incentive.incentive) > 0.005;
          return (
            <span className="inline-flex flex-col items-end gap-1">
              {r.payroll ? <span className="text-xs text-text-secondary">{r.payroll.status} · {money(r.payroll.incentive)}</span> : <span className="text-xs text-text-muted">Not calculated</span>}
              {differs && <Badge tone="warning">Differs</Badge>}
              {can('hr.payroll.process') && (
                <Button size="sm" variant="secondary" disabled={r.payroll?.locked || busy === r.email} loading={busy === r.email}
                  title={r.payroll?.locked ? 'Finalized: unlock it in HR > Payroll first' : undefined} onClick={() => recalculate(r)}>
                  <RefreshCw size={13} /> {r.payroll ? 'Recalculate' : 'Calculate'}
                </Button>
              )}
            </span>
          );
        },
      },
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title={hrView ? 'Sales incentives' : 'Sales scorecard'}
        description={hrView
          ? 'Every sales person\'s collections and incentive, worked out from client payments after DSC. Payroll takes the same figures.'
          : 'Collections after DSC, ranked. Targets and incentives come from the HR incentive rules.'}
        actions={data?.can_export ? (
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" loading={busy === 'xlsx'} onClick={() => exportAs('xlsx')}><Download size={14} /> Excel</Button>
            <Button variant="secondary" size="sm" loading={busy === 'pdf'} onClick={() => exportAs('pdf')}><Download size={14} /> PDF</Button>
          </div>
        ) : undefined}
      />

      {!hrView && <MyPerformanceCard />}

      <Card>
        <div className="flex flex-wrap items-end gap-3 border-b border-border p-4">
          <Tabs tabs={PERIODS} active={period} onChange={(id) => setPeriod(id as Period)} />
          <Input label="Date" type="date" value={day} onChange={(e) => e.target.value && setDay(e.target.value)} className="w-40" />
          {(data?.departments.length ?? 0) > 1 && (
            <Select label="Team / department" value={department} onChange={(e) => setDepartment(e.target.value)} className="w-48">
              <option value="">All</option>
              {data!.departments.map((d) => <option key={d}>{d}</option>)}
            </Select>
          )}
          {data && <p className="ml-auto self-center text-xs text-text-muted">{data.from === data.to ? data.from : `${data.from} to ${data.to}`}</p>}
        </div>
        {board.status === 'error' ? <ErrorState message={board.error} onRetry={board.reload} /> : (
          <Table
            columns={columns}
            rows={data?.rows ?? []}
            rowKey={(r) => r.email}
            loading={board.loading && !data}
            caption="Sales leaderboard"
            empty={<EmptyState compact icon={Award} title="No sales people yet" description="Accounts with the Employee / Sales Person role appear here." />}
          />
        )}
      </Card>
    </div>
  );
}

export function HrSalesIncentives() {
  return <SalesScorecard hrView />;
}
