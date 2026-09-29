import { ChevronRight, Radio, RefreshCw, Users } from 'lucide-react';
import { Badge } from '../../components/common/Badge';
import { Card, CardHeader } from '../../components/common/Card';
import { Skeleton } from '../../components/common/Skeleton';
import type { IvrCampaign } from '../../ivr/types';

/** What the agent is dialling for: their own CRM leads, or one of their IVR campaigns. */
export interface DialerCampaign {
  /** 'crm' for the CRM lead queue, else the IVR campaign id (sent with each click-to-call). */
  id: string;
  name: string;
}

export const CRM_QUEUE: DialerCampaign = { id: 'crm', name: 'My CRM leads' };

interface CampaignPickerProps {
  campaigns: IvrCampaign[] | null;
  status: 'loading' | 'success' | 'error';
  error?: string;
  loading: boolean;
  onReload: () => void;
  openLeads: number;
  ivrCalling: boolean;
  onSelect: (c: DialerCampaign) => void;
}

export function CampaignPicker({ campaigns, status, error, loading, onReload, openLeads, ivrCalling, onSelect }: CampaignPickerProps) {
  const option = 'flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-secondary disabled:cursor-not-allowed disabled:opacity-50';
  return (
    <Card className="mx-auto max-w-3xl">
      <CardHeader
        title="Select a campaign"
        description="Choose what you are calling for. Your CRM leads are always in the queue."
        actions={
          <>
            {ivrCalling ? <Badge tone="success" dot>IVR connected</Badge> : <Badge tone="warning">Phone mode</Badge>}
            <button type="button" onClick={onReload} aria-label="Refresh campaigns" className="rounded p-1 text-text-muted hover:bg-neutral-bg hover:text-text">
              <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
            </button>
          </>
        }
      />
      <ul className="divide-y divide-border">
        <li>
          <button type="button" className={option} onClick={() => onSelect(CRM_QUEUE)}>
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary-soft text-primary"><Users size={16} /></span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium">{CRM_QUEUE.name}</span>
              <span className="block text-xs text-text-muted">{openLeads} open leads assigned to you</span>
            </span>
            <ChevronRight size={16} className="text-text-muted" aria-hidden="true" />
          </button>
        </li>
        {status === 'error' && !campaigns ? (
          <li className="px-4 py-4 text-sm text-danger">{error}</li>
        ) : !campaigns ? (
          <li className="p-4"><Skeleton className="h-10" /></li>
        ) : campaigns.length === 0 ? (
          <li className="px-4 py-6 text-center text-sm text-text-muted">No IVR campaigns assigned to you</li>
        ) : (
          campaigns.map((c) => {
            const closed = c.statusKind === 'stopped';
            return (
              <li key={c.id || c.name}>
                <button
                  type="button"
                  className={option}
                  disabled={closed || !c.id}
                  title={closed ? 'This campaign has ended' : undefined}
                  onClick={() => onSelect({ id: c.id, name: c.name })}
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-info-bg text-info"><Radio size={16} /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{c.name}</span>
                    <span className="block text-xs text-text-muted">
                      IVR campaign{c.progress !== null ? ` · ${c.progress}% dialed` : ''}{c.metrics.total !== undefined ? ` · ${c.metrics.total.toLocaleString('en-IN')} leads` : ''}
                    </span>
                  </span>
                  <Badge tone={c.statusKind === 'running' ? 'success' : c.statusKind === 'paused' ? 'warning' : 'neutral'} dot={c.statusKind === 'running'}>
                    {c.status}
                  </Badge>
                  {!closed && <ChevronRight size={16} className="text-text-muted" aria-hidden="true" />}
                </button>
              </li>
            );
          })
        )}
      </ul>
    </Card>
  );
}
