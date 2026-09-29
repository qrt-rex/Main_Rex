import { useState } from 'react';
import { ChevronDown, Pause, Play, Radio, Square } from 'lucide-react';
import { Button } from '../../components/common/Button';
import type { IvrCampaign } from '../types';
import { cellText, columnsOf, humanize } from './IvrTable';

const METRIC_LABELS: [keyof IvrCampaign['metrics'], string][] = [
  ['total', 'Total leads'],
  ['dialed', 'Dialed'],
  ['queued', 'Queued'],
  ['dialing', 'Dialing now'],
  ['completed', 'Completed'],
  ['interested', 'Interested'],
  ['concurrency', 'Concurrency'],
];

const tone: Record<IvrCampaign['statusKind'], string> = {
  running: 'bg-success-bg text-success border-success/20',
  paused: 'bg-warning-bg text-warning border-warning/20',
  stopped: 'bg-neutral-bg text-text-secondary border-border',
  other: 'bg-info-bg text-info border-info/20',
};

interface IvrCardProps {
  campaign: IvrCampaign;
  /** Pause / resume / stop; omitted for users who can only view. */
  onAction?: (campaign: IvrCampaign, action: 'pause' | 'resume' | 'stop') => Promise<void>;
}

export function IvrCard({ campaign, onAction }: IvrCardProps) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const metrics = METRIC_LABELS.filter(([k]) => campaign.metrics[k] !== undefined);

  const act = async (action: 'pause' | 'resume' | 'stop') => {
    if (!onAction) return;
    setBusy(action);
    try {
      await onAction(campaign, action);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="rounded-xl border border-border bg-surface p-5 shadow-[var(--shadow-card)]">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary">
              <Radio size={17} aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="truncate text-base font-bold tracking-tight">{campaign.name}</h3>
                <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${tone[campaign.statusKind]}`}>
                  {campaign.statusKind === 'running' && <span className="mr-1.5 h-1.5 w-1.5 animate-pulse rounded-full bg-success" />}
                  {campaign.status}
                </span>
              </div>
              {campaign.createdAt && <p className="mt-0.5 text-xs text-text-muted">Created {cellText(campaign.createdAt)}</p>}
            </div>
          </div>

          {campaign.progress !== null && (
            <div className="mt-4">
              <div className="flex items-center justify-between text-[11px]">
                <span className="font-semibold uppercase tracking-wider text-text-muted">Dial progress</span>
                <span className="font-medium text-text-secondary">{campaign.progress}%</span>
              </div>
              <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-neutral-bg">
                <div className="h-full rounded-full bg-success" style={{ width: `${Math.min(100, Math.max(0, campaign.progress))}%` }} />
              </div>
            </div>
          )}

          {metrics.length > 0 && (
            <dl className="mt-4 grid grid-cols-2 gap-3 rounded-lg border border-border/60 bg-surface-secondary/60 p-3 sm:grid-cols-4 lg:grid-cols-7">
              {metrics.map(([k, label]) => (
                <div key={k}>
                  <dt className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">{label}</dt>
                  <dd className={`mt-0.5 text-base font-bold ${k === 'interested' ? 'text-success' : 'text-text'}`}>
                    {campaign.metrics[k]!.toLocaleString('en-IN')}
                  </dd>
                </div>
              ))}
            </dl>
          )}

          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-text-secondary hover:text-primary"
          >
            <ChevronDown size={14} className={`transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
            {open ? 'Hide' : 'Show'} all fields from the IVR
          </button>
          {open && (
            <dl className="mt-2 grid gap-x-6 gap-y-1.5 rounded-lg border border-border p-3 text-xs sm:grid-cols-2">
              {columnsOf([campaign.raw]).map((k) => (
                <div key={k} className="flex min-w-0 justify-between gap-3">
                  <dt className="shrink-0 text-text-muted">{humanize(k)}</dt>
                  <dd className="truncate text-right font-medium" title={cellText(campaign.raw[k])}>{cellText(campaign.raw[k])}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>

        {onAction && campaign.statusKind !== 'stopped' && campaign.id && (
          <div className="flex shrink-0 gap-2 lg:w-36 lg:flex-col">
            {campaign.statusKind === 'paused' ? (
              <Button size="sm" onClick={() => act('resume')} loading={busy === 'resume'} disabled={!!busy} className="flex-1 lg:w-full">
                <Play size={13} aria-hidden="true" /> Resume
              </Button>
            ) : (
              <Button size="sm" variant="secondary" onClick={() => act('pause')} loading={busy === 'pause'} disabled={!!busy} className="flex-1 lg:w-full">
                <Pause size={13} aria-hidden="true" /> Pause
              </Button>
            )}
            <Button size="sm" variant="danger" onClick={() => act('stop')} loading={busy === 'stop'} disabled={!!busy} className="flex-1 lg:w-full">
              <Square size={11} aria-hidden="true" /> Stop
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
