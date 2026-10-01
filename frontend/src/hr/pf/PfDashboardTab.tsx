import { useState } from 'react';
import { AlertTriangle, Banknote, BadgeCheck, ShieldOff, Sparkles, UserPlus, Users, Wallet } from 'lucide-react';
import { useApi } from '../../lib/useApi';
import { money, number } from '../../lib/format';
import { Card, CardHeader } from '../../components/common/Card';
import { ErrorState } from '../../components/common/ErrorState';
import { Skeleton } from '../../components/common/Skeleton';
import { Table, type Column } from '../../components/common/Table';
import { StatCard } from '../../components/dashboard/StatCard';
import { Toolbar } from '../components';
import { getPfDashboard, type PfDashboard } from './api';
import { pct, pfMoney } from './format';
import { PfFilterBar } from './filters';
import { defaultFilters, filterParams } from './format';

type Dept = PfDashboard['by_department'][number];

export function PfDashboardTab() {
  const [f, setF] = useState(defaultFilters);
  const dash = useApi(() => getPfDashboard(filterParams(f)), [f]);
  const d = dash.data;
  const m = d?.metrics;
  const rule = d?.current_rule;

  const deptColumns: Column<Dept>[] = [
    { key: 'department', header: 'Department', render: (r) => r.department, sortValue: (r) => r.department },
    { key: 'employees', header: 'PF members', align: 'right', render: (r) => number(r.employees), sortValue: (r) => r.employees },
    { key: 'pf_wage', header: 'PF wage', align: 'right', render: (r) => money(r.pf_wage), sortValue: (r) => r.pf_wage },
    { key: 'employee_pf', header: 'Employee PF', align: 'right', render: (r) => pfMoney(r.employee_pf), sortValue: (r) => r.employee_pf },
    { key: 'employer_pf', header: 'Employer PF', align: 'right', render: (r) => pfMoney(r.employer_pf), sortValue: (r) => r.employer_pf },
    { key: 'eps', header: 'EPS', align: 'right', render: (r) => pfMoney(r.eps), sortValue: (r) => r.eps },
    { key: 'employer_epf', header: 'Employer EPF', align: 'right', render: (r) => pfMoney(r.employer_epf), sortValue: (r) => r.employer_epf },
  ];

  return (
    <div className="space-y-4">
      <Card>
        <Toolbar>
          <PfFilterBar value={f} onChange={setF} show={{ month: true, year: true, department: true, branch: true, employee_id: true, pf_status: true, pf_applicable: true, eps_applicable: true }} />
        </Toolbar>
        {rule && (
          <p className="px-4 py-2.5 text-xs text-text-muted">
            Rule for {d?.period.month} {d?.period.year}: <span className="font-medium text-text">{rule.rule_name}</span> · PF wage {money(rule.minimum_pf_wage)} to {money(rule.maximum_pf_wage)} ·
            employee {pct(rule.employee_contribution_percent)}, employer {pct(rule.employer_contribution_percent)}, EPS {pct(rule.eps_percent)}
            {d && !d.pf_enabled && <span className="ml-2 font-medium text-warning">PF is disabled in configuration</span>}
          </p>
        )}
      </Card>

      {dash.status === 'error' ? <Card><ErrorState onRetry={dash.reload} message={dash.error} /></Card> : !m ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">{Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-28" />)}</div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard icon={Users} label="PF-covered employees" value={number(m.pf_covered)} hint={`of ${number(m.employees)} in view`} />
            <StatCard icon={ShieldOff} tone="info" label="PF-exempt employees" value={number(m.pf_exempt)} hint={`${number(m.not_applicable)} not applicable this month`} />
            <StatCard icon={UserPlus} tone="success" label="New PF members" value={number(m.new_members)} hint="PF joining date in this month" />
            <StatCard icon={Sparkles} label="PF wage set by the rule" value={number(m.affected_by_rule)} hint="Basic below the minimum or above the maximum" />
            <StatCard icon={BadgeCheck} tone="info" label="PF applicability changed" value={number(m.applicability_changed)} hint="Changed during this month" />
            <StatCard icon={AlertTriangle} tone="warning" label="Missing UAN" value={number(m.missing_uan)} hint="PF-covered employees without a UAN" to="/hr/pf?tab=reports" />
            <StatCard icon={AlertTriangle} tone="warning" label="Incomplete PF information" value={number(m.incomplete)} hint="Missing UAN / Member ID / details" to="/hr/pf?tab=reports" />
            <StatCard icon={AlertTriangle} tone="danger" label="PF calculation errors" value={number(m.errors)} hint="Block payroll finalization" to="/hr/pf?tab=reports" />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <StatCard icon={Wallet} label="Total PF wage" value={money(m.total_pf_wage)} />
            <StatCard icon={Banknote} label="Total employee PF" value={pfMoney(m.total_employee_pf)} />
            <StatCard icon={Banknote} label="Total employer PF" value={pfMoney(m.total_employer_pf)} hint={`EPS ${pfMoney(m.total_eps)} + EPF ${pfMoney(m.total_employer_epf)}`} />
            <StatCard icon={Banknote} tone="info" label="Total EPS contribution" value={pfMoney(m.total_eps)} />
            <StatCard icon={Banknote} tone="info" label="Total employer EPF" value={pfMoney(m.total_employer_epf)} />
            <StatCard icon={Wallet} tone="warning" label="Monthly PF liability" value={pfMoney(m.monthly_liability)} hint="Employee + employer PF" />
          </div>
          <p className="text-xs text-text-muted">
            {number(m.from_payroll)} employee(s) from payroll already calculated for this month; {number(m.projected)} projected from their current salary and PF details.
          </p>
          <Card>
            <CardHeader title="PF by department" description="PF-covered employees only" />
            <Table columns={deptColumns} rows={d.by_department} rowKey={(r) => r.department} caption="PF contribution by department" />
          </Card>
        </>
      )}
    </div>
  );
}
