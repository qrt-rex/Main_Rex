import { useApi } from '../lib/useApi';
import { Card } from '../components/common/Card';
import { ErrorState } from '../components/common/ErrorState';
import { Skeleton } from '../components/common/Skeleton';
import { SectionTitle } from '../dashboards/components';
import { salesSummary } from './api';
import { DayCard, FlyersPostsCard, LeadsCard, ManageLink, SalesInfoCard, SchemesCard } from './SalesWidgets';
import { openDialer } from './openDialer';
import { useLive } from './useLive';

/** Top of the Sales dashboard: start or end the day, the leads to call, and the material to share. */
export function SalesToday() {
  const s = useApi(salesSummary);
  useLive(s.reload);

  if (s.status === 'error') return <Card><ErrorState onRetry={s.reload} message={s.error} /></Card>;
  if (!s.data) return <div className="grid gap-4 sm:grid-cols-2">{[0, 1].map((i) => <Skeleton key={i} className="h-28" />)}</div>;

  const d = s.data;

  return (
    <>
      <SectionTitle action={d.can_manage ? <ManageLink /> : undefined}>Today</SectionTitle>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <DayCard session={d.session} onChange={s.reload} />
        <div className="min-w-0 lg:col-span-2">
          <LeadsCard
            leads={d.leads}
            onChanged={s.reload}
            onOpenDialer={(lead) => openDialer(lead?.id)}
          />
        </div>
      </div>

      <SectionTitle>Things to share with clients</SectionTitle>
      <div className="grid gap-4 lg:grid-cols-3">
        <SchemesCard schemes={d.schemes} onChanged={s.reload} canManage={d.can_manage} />
        <FlyersPostsCard materials={d.materials} onChanged={s.reload} canManage={d.can_manage} />
        <SalesInfoCard materials={d.materials} onChanged={s.reload} canManage={d.can_manage} />
      </div>
    </>
  );
}
