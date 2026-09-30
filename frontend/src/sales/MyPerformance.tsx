import { CalendarDays, Target, Wallet } from 'lucide-react';
import { useApi } from '../lib/useApi';
import { money } from '../lib/format';
import { Badge } from '../components/common/Badge';
import { Card, CardHeader } from '../components/common/Card';
import { StatCard } from '../components/dashboard/StatCard';
import { getMyPerformance } from './performance';

/** The signed-in sales person's own numbers; renders nothing for anyone who isn't a sales person. */
export function MyPerformanceCard() {
  const { data } = useApi(() => getMyPerformance(), []);
  if (!data?.is_sales || !data.incentive || !data.today || !data.week || !data.month_totals) return null;
  const inc = data.incentive;
  const dsc = (t: { dsc_deduction: number; gross_collection: number }) => (t.dsc_deduction > 0 ? `${money(t.gross_collection)} before ${money(t.dsc_deduction)} DSC` : 'No DSC deducted');
  return (
    <Card>
      <CardHeader title="My performance" description={`${data.month} · net collection after DSC`}
        actions={<Badge tone={inc.eligible ? 'success' : 'warning'}>{inc.eligibility.status}</Badge>} />
      <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={CalendarDays} label="Today" value={money(data.today.net_collection)} hint={dsc(data.today)} />
        <StatCard icon={CalendarDays} tone="info" label="This week" value={money(data.week.net_collection)} hint={dsc(data.week)} />
        <StatCard icon={Target} tone="warning" label="This month" value={money(data.month_totals.net_collection)}
          hint={`${inc.target_achievement}% of ${money(inc.target_amount)} target`} />
        <StatCard icon={Wallet} tone="success" label="Incentive so far" value={money(inc.incentive)}
          hint={`Daily ${money(inc.daily_incentive)} · Weekly ${money(inc.weekly_incentive)} · Monthly ${money(inc.monthly_incentive)}`} />
      </div>
      <p className="border-t border-border px-4 py-3 text-xs text-text-muted">{inc.note}</p>
    </Card>
  );
}
