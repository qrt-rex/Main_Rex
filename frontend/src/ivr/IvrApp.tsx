import { useState } from 'react';
import { FileText, List, LogOut, PhoneCall, PhoneForwarded, Radio, RefreshCw, Shield, Users, type LucideIcon } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { Header } from '../components/navigation/Header';
import { NotificationsProvider } from '../lib/notifications';
import { useApi } from '../lib/useApi';
import { ApiError } from '../lib/api';
import { useToast } from '../components/common/ToastContext';
import { useConfirm } from '../components/common/ConfirmDialog';
import { Button } from '../components/common/Button';
import { EmptyState } from '../components/common/EmptyState';
import { ErrorState } from '../components/common/ErrorState';
import { Skeleton } from '../components/common/Skeleton';
import { IvrGate, useIvr } from './IvrGate';
import { ivrApi } from './ivrApi';
import { IvrCard } from './components/IvrCard';
import { IvrTable } from './components/IvrTable';
import type { IvrCampaign, IvrResource } from './types';

const TABS: { id: IvrResource; label: string; title: string; description: string; icon: LucideIcon }[] = [
  { id: 'campaigns', label: 'IVR Blasts', title: 'IVR voice blasts', description: 'Campaigns running on your IVR account.', icon: Radio },
  { id: 'cdr', label: 'Call records', title: 'Call detail records', description: 'Every call attempt the IVR logged.', icon: FileText },
  { id: 'lead-lists', label: 'Lead lists', title: 'Lead lists', description: 'Number lists uploaded to the IVR.', icon: List },
  { id: 'agent-groups', label: 'Agent groups', title: 'Agent groups', description: 'Agent desks that IVR calls transfer to.', icon: Users },
  { id: 'dispositions', label: 'Dispositions', title: 'Dispositions', description: 'Keypress and outcome rules configured in the IVR.', icon: Shield },
  { id: 'dids', label: 'DIDs', title: 'Caller numbers (DIDs)', description: 'Numbers your IVR account dials out from.', icon: PhoneForwarded },
];

export function IvrApp() {
  return (
    <IvrGate title="Connect IVR">
      <IvrConsole />
    </IvrGate>
  );
}

function IvrConsole() {
  const { session, signOut } = useIvr();
  const [tab, setTab] = useState<IvrResource>('campaigns');
  const active = TABS.find((t) => t.id === tab)!;
  const user = session.user;

  return (
    <NotificationsProvider>
      <div className="flex min-h-screen flex-col bg-bg text-text antialiased">
        <Header />
        <div className="flex flex-1">
          <aside className="sticky top-14 hidden h-[calc(100vh-3.5rem)] w-60 shrink-0 flex-col justify-between border-r border-border bg-surface px-3 py-5 md:flex">
            <div>
              <div className="mb-5 flex items-center gap-2.5 px-2">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary-soft text-primary">
                  <PhoneCall size={18} aria-hidden="true" />
                </div>
                <div>
                  <span className="block text-sm font-bold tracking-tight">Connect IVR</span>
                  <span className="block text-[10px] font-medium uppercase tracking-wider text-text-muted">{user.company?.code || 'IVR'}</span>
                </div>
              </div>
              <nav className="space-y-1 text-sm font-medium" aria-label="IVR sections">
                {TABS.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setTab(t.id)}
                    aria-current={tab === t.id ? 'page' : undefined}
                    className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 transition-colors ${
                      tab === t.id ? 'bg-primary-soft font-semibold text-primary' : 'text-text-secondary hover:bg-neutral-bg hover:text-text'
                    }`}
                  >
                    <t.icon size={16} aria-hidden="true" />
                    {t.label}
                  </button>
                ))}
              </nav>
            </div>
            <div className="border-t border-border px-1 pt-4">
              <p className="truncate text-xs font-bold">{user.name}</p>
              <p className="truncate text-[11px] text-text-muted">{user.email} · {user.role}</p>
              <button type="button" onClick={signOut} className="mt-2.5 inline-flex items-center gap-1.5 text-xs font-medium text-text-muted hover:text-danger">
                <LogOut size={13} aria-hidden="true" /> Sign out of IVR
              </button>
            </div>
          </aside>

          <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8">
            <div className="mx-auto max-w-[1400px]">
              {/* Section picker on small screens */}
              <div className="mb-4 flex gap-1 overflow-x-auto md:hidden">
                {TABS.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setTab(t.id)}
                    className={`shrink-0 rounded-full border px-3 py-1 text-xs font-medium ${
                      tab === t.id ? 'border-primary bg-primary text-on-primary' : 'border-border bg-surface text-text-secondary'
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>

              <div className="mb-5">
                <h1 className="text-xl font-bold tracking-tight">{active.title}</h1>
                <p className="mt-1 text-xs text-text-muted">{active.description}</p>
              </div>

              {tab === 'campaigns' ? (
                <CampaignsPanel />
              ) : (
                <ResourcePanel key={tab} resource={tab} emptyTitle={`No ${active.label.toLowerCase()} yet`} />
              )}
            </div>
          </main>
        </div>
      </div>
    </NotificationsProvider>
  );
}

function ResourcePanel({ resource, emptyTitle }: { resource: IvrResource; emptyTitle: string }) {
  const data = useApi(() => ivrApi.rows(resource), [resource]);
  return (
    <IvrTable
      rows={data.data}
      status={data.status}
      error={data.error}
      onRetry={data.reload}
      emptyTitle={emptyTitle}
      filename={`ivr-${resource}`}
      actions={
        <Button size="sm" variant="ghost" onClick={data.reload} aria-label="Refresh">
          <RefreshCw size={13} className={data.loading ? 'animate-spin' : ''} aria-hidden="true" />
        </Button>
      }
    />
  );
}

function CampaignsPanel() {
  const { can } = useAuth();
  const { showToast } = useToast();
  const confirm = useConfirm();
  const campaigns = useApi(ivrApi.campaigns);
  const list = campaigns.data ?? [];
  const live = list.filter((c) => c.statusKind === 'running').length;
  const interested = list.reduce((n, c) => n + (c.metrics.interested ?? 0), 0);
  const hasInterested = list.some((c) => c.metrics.interested !== undefined);

  const onAction = async (c: IvrCampaign, action: 'pause' | 'resume' | 'stop') => {
    if (action === 'stop' && !(await confirm({ title: `Stop ${c.name}?`, message: 'The IVR stops dialing this campaign.', confirmText: 'Stop campaign', tone: 'danger' }))) {
      return;
    }
    try {
      await ivrApi.campaignAction(c.id, action);
      showToast(`${c.name}: ${action === 'resume' ? 'resumed' : action === 'pause' ? 'paused' : 'stopped'}`, 'success');
      campaigns.reload();
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'The IVR did not accept that.', 'error');
    }
  };

  if (campaigns.status === 'error') {
    return (
      <div className="rounded-xl border border-border bg-surface">
        <ErrorState message={campaigns.error} onRetry={campaigns.reload} />
      </div>
    );
  }
  if (!campaigns.data) {
    return <div className="space-y-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-40" />)}</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="rounded-full border border-border bg-surface px-3 py-1 font-semibold">{list.length} campaigns</span>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1 font-semibold">
            <span className="h-2 w-2 rounded-full bg-success" /> {live} live
          </span>
          {hasInterested && (
            <span className="rounded-full border border-border bg-surface px-3 py-1 font-semibold">
              {interested.toLocaleString('en-IN')} interested
            </span>
          )}
        </div>
        <Button size="sm" variant="secondary" onClick={campaigns.reload}>
          <RefreshCw size={13} className={campaigns.loading ? 'animate-spin' : ''} aria-hidden="true" /> Refresh
        </Button>
      </div>
      {list.length === 0 ? (
        <div className="rounded-xl border border-border bg-surface">
          <EmptyState icon={Radio} title="No campaigns yet" description="Campaigns created in your IVR account show up here." />
        </div>
      ) : (
        list.map((c) => <IvrCard key={c.id || c.name} campaign={c} onAction={can('sales.hub.manage') ? onAction : undefined} />)
      )}
    </div>
  );
}
