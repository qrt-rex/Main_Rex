import { useAuth } from '../auth/AuthContext';
import { PageHeader } from '../components/layout/PageHeader';
import { WorkBoard } from './WorkBoard';

/** `/client-work`: the filtered workspace the dashboard widget opens. Legal and Super Admin monitor everything; members see their queue. */
export function ClientWorkPage() {
  const { can } = useAuth();
  const monitor = can('clientwork.monitor');
  return (
    <>
      <PageHeader
        title={monitor ? 'Client Work' : 'My Client Work'}
        description={monitor
          ? 'Every client assigned by Legal, from first action to completion, updating live.'
          : 'Clients assigned to you by Legal. New assignments and client responses appear here without refreshing.'}
        breadcrumbs={[{ label: 'Dashboard', to: '/dashboard' }, { label: 'Client Work' }]}
      />
      <WorkBoard monitor={monitor} />
    </>
  );
}
