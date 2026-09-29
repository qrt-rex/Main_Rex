import { CalendarClock, PhoneCall, Sparkles, Target, Trophy } from 'lucide-react';
import { useApi } from '../lib/useApi';
import { number, todayISO } from '../lib/format';
import { Button } from '../components/common/Button';
import { Card } from '../components/common/Card';
import { ErrorState } from '../components/common/ErrorState';
import { Skeleton } from '../components/common/Skeleton';
import { StatCard } from '../components/dashboard/StatCard';
import { SectionTitle, TwoColumn } from '../dashboards/components';
import { salesSummary } from './api';
import {
  AttendanceBoardCard, DayCard, FlyersPostsCard, LeadsCard, ManageLink,
  SalesInfoCard, SchemesCard, TeamProgressCard,
} from './SalesWidgets';
import { openDialer } from './openDialer';
import { useLive } from './useLive';

/** Admin / Super Admin dashboard: every sales employee's progress and the live attendance board. */
export function SalesTeamOverview() {
  const s = useApi(salesSummary);
  useLive(s.reload);
  if (s.status === 'error' || !s.data) return null;
  return (
    <>
      <SectionTitle action={s.data.can_manage ? <ManageLink /> : undefined}>Sales team</SectionTitle>
      <div className="grid gap-4 xl:grid-cols-2">
        <TeamProgressCard rows={s.data.progress} description="Every sales employee, today" />
        <AttendanceBoardCard rows={s.data.attendance} />
      </div>
    </>
  );
}

/** Top of the Sales dashboard: the day, leads to call, schemes, flyers/posts, sales information, team progress and attendance. */
export function SalesToday() {
  const s = useApi(salesSummary);
  useLive(s.reload); // attendance and progress stay live

  if (s.status === 'error') return <Card><ErrorState onRetry={s.reload} message={s.error} /></Card>;
  if (!s.data) return <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-28" />)}</div>;

  const d = s.data;
  const mine = d.progress.find((r) => r.user_id === d.me.user_id);
  const today = todayISO();
  const open = d.leads.filter((l) => ['NEW', 'ATTEMPTED', 'CALL_BACK', 'INTERESTED'].includes(l.status));
  const dueToday = open.filter((l) => l.follow_up_date && l.follow_up_date <= today).length;

  return (
    <>
      <SectionTitle
        action={
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={() => openDialer()} title="Opens the dialer in a new tab">
              <PhoneCall size={14} /> Dialer
            </Button>
            {d.can_manage && <ManageLink />}
          </div>
        }
      >
        Today's sales overview
      </SectionTitle>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <DayCard session={d.session} onChange={s.reload} />
        <StatCard icon={Target} label="Leads to call" value={number(open.length)} hint={`${d.leads.length} assigned to you`} />
        <StatCard icon={CalendarClock} tone="warning" label="Follow-ups due" value={number(dueToday)} hint="Today or overdue" />
        <StatCard icon={PhoneCall} tone="success" label="Your calls today" value={number(mine?.calls ?? 0)} hint={`${mine?.converted ?? 0} converted · ${mine?.interested ?? 0} interested`} />
      </div>

      <SectionTitle>
        <span className="flex items-center gap-2">
          <Sparkles size={18} className="text-primary" /> Schemes, Flyers / Posts & Sales Information
        </span>
      </SectionTitle>
      <div className="grid gap-4 lg:grid-cols-3">
        <SchemesCard schemes={d.schemes} onChanged={s.reload} canManage={d.can_manage} />
        <FlyersPostsCard materials={d.materials} onChanged={s.reload} canManage={d.can_manage} />
        <SalesInfoCard materials={d.materials} onChanged={s.reload} canManage={d.can_manage} />
      </div>

      <SectionTitle>Leads & Team activity</SectionTitle>
      <TwoColumn
        main={<>
          <LeadsCard
            leads={d.leads}
            onChanged={s.reload}
            onOpenDialer={(lead) => openDialer(lead?.id)}
          />
          <TeamProgressCard rows={d.progress} description="Every sales employee, today" actions={<Trophy size={15} className="text-warning" />} />
        </>}
        side={<>
          <AttendanceBoardCard rows={d.attendance} />
        </>}
      />

    </>
  );
}
