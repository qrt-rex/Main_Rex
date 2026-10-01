import { PiggyBank } from 'lucide-react';
import { useApi } from '../lib/useApi';
import { date, money } from '../lib/format';
import { Card, CardHeader } from '../components/common/Card';
import { EmptyState } from '../components/common/EmptyState';
import { ErrorState } from '../components/common/ErrorState';
import { PageSkeleton } from '../components/common/Skeleton';
import { Table, type Column } from '../components/common/Table';
import { PageHeader } from '../components/layout/PageHeader';
import { getMyPf, type EmployeePfView } from '../hr/pf/api';
import { PfBreakdown, PfStatusBadge } from '../hr/pf/components';
import { pfMoney } from '../hr/pf/format';

type History = NonNullable<EmployeePfView['history']>[number];

/** An employee's own provident fund: read-only (the API serves only the signed-in person's PF). */
export function MyPf() {
  const pf = useApi(getMyPf);
  if (pf.status === 'error') return <><PageHeader title="My provident fund" /><Card><ErrorState message={pf.error} onRetry={pf.reload} /></Card></>;
  const v = pf.data;
  if (!v) return <PageSkeleton />;
  const d = v.details;
  const columns: Column<History>[] = [
    { key: 'month', header: 'Month', render: (h) => `${h.month} ${h.year}`, sortValue: (h) => h.calculation_date },
    { key: 'basic', header: 'Basic salary', align: 'right', render: (h) => money(h.basic_salary) },
    { key: 'wage', header: 'PF wage', align: 'right', render: (h) => money(h.pf_wage) },
    { key: 'emp', header: 'Your PF', align: 'right', render: (h) => pfMoney(h.employee_pf) },
    { key: 'er', header: 'Employer PF', align: 'right', render: (h) => pfMoney(h.employer_pf) },
    { key: 'eps', header: 'EPS', align: 'right', render: (h) => pfMoney(h.eps_contribution) },
    { key: 'epf', header: 'Employer EPF', align: 'right', render: (h) => pfMoney(h.employer_epf) },
  ];
  return (
    <>
      <PageHeader title="My provident fund" description="Your PF details and contributions. Ask HR if anything here needs correcting." />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="min-w-0 lg:col-span-2">
          <CardHeader title="This month's PF" description={v.rule ? `Under ${v.rule.rule_name}` : undefined} />
          <div className="p-4"><PfBreakdown calc={v.calculation} /></div>
        </Card>
        <Card className="min-w-0">
          <CardHeader title="PF details" />
          <dl className="divide-y divide-border text-sm">
            {([
              ['PF status', <PfStatusBadge key="s" status={v.calculation.status} />], ['PF applicable', d.pf_applicable ? 'Yes' : 'No'],
              ['EPS applicable', d.eps_applicable ? 'Yes' : 'No'], ['UAN', d.uan || 'Not on record yet'], ['PF Member ID', d.pf_member_id || 'Not on record yet'],
              ['PF joining date', d.pf_joining_date ? date(d.pf_joining_date) : '—'],
              ...(!d.pf_applicable && d.exemption_reason ? [['Exemption', d.exemption_reason]] as [string, React.ReactNode][] : []),
            ] as [string, React.ReactNode][]).map(([k, val]) => (
              <div key={k} className="flex justify-between gap-3 px-4 py-2"><dt className="text-text-muted">{k}</dt><dd className="text-right text-text">{val}</dd></div>
            ))}
          </dl>
        </Card>
      </div>
      <Card className="mt-4">
        <CardHeader title="PF history" description="From your finalized payslips" />
        <Table columns={columns} rows={v.history ?? []} rowKey={(h) => h.calculation_date} caption="Your PF history"
          empty={<EmptyState compact icon={PiggyBank} title="No PF history yet" description="Your PF appears here once a payslip is finalized." />} />
      </Card>
    </>
  );
}
