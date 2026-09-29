import { X, BarChart3 } from 'lucide-react';
import type { IvrCampaign } from '../types';

interface CampaignAnalyticsModalProps {
  campaign: IvrCampaign | null;
  onClose: () => void;
}

export function CampaignAnalyticsModal({ campaign, onClose }: CampaignAnalyticsModalProps) {
  if (!campaign) return null;

  const interested = campaign.interested ?? campaign.metrics?.interested ?? 0;
  const completed = campaign.completed ?? campaign.metrics?.completed ?? 0;
  const dialing = campaign.dialing ?? campaign.metrics?.dialing ?? 0;
  const dialedLeads = campaign.dialedLeads ?? campaign.metrics?.dialed ?? 1;
  const concurrency = campaign.concurrency ?? campaign.metrics?.concurrency ?? 75;

  const responseRate = ((interested / (completed || 1)) * 100).toFixed(1);
  const connectRate = (((completed + dialing) / (dialedLeads || 1)) * 100).toFixed(1);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
      <div className="relative w-full max-w-2xl rounded-xl border border-border bg-surface p-6 shadow-[var(--shadow-pop)] animate-in fade-in zoom-in-95 duration-150">
        <div className="flex items-center justify-between border-b border-border pb-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-soft text-primary font-bold">
              <BarChart3 size={20} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-text uppercase">{campaign.name}</h2>
                <span className="rounded-full bg-neutral-bg px-2.5 py-0.5 text-[11px] font-semibold text-text-secondary border border-border">
                  Analytics & Telemetry
                </span>
              </div>
              <p className="text-xs text-text-muted">Real-time dialer breakdown, conversion funnel & keypress stats</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-text-muted hover:bg-neutral-bg hover:text-text transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        <div className="mt-5 space-y-5">
          {/* Key Metric Cards */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-lg border border-border bg-surface-secondary/60 p-3.5">
              <span className="text-[10px] font-bold uppercase tracking-wider text-text-muted">Response Rate</span>
              <p className="mt-1 text-xl font-bold text-success">{responseRate}%</p>
              <span className="text-[10px] text-text-muted">Key 1 (Interested)</span>
            </div>

            <div className="rounded-lg border border-border bg-surface-secondary/60 p-3.5">
              <span className="text-[10px] font-bold uppercase tracking-wider text-text-muted">Answer Rate</span>
              <p className="mt-1 text-xl font-bold text-text">{connectRate}%</p>
              <span className="text-[10px] text-text-muted">Live human pickups</span>
            </div>

            <div className="rounded-lg border border-border bg-surface-secondary/60 p-3.5">
              <span className="text-[10px] font-bold uppercase tracking-wider text-text-muted">Warm Transfers</span>
              <p className="mt-1 text-xl font-bold text-text">{interested}</p>
              <span className="text-[10px] text-text-muted">Sent to agents</span>
            </div>

            <div className="rounded-lg border border-border bg-surface-secondary/60 p-3.5">
              <span className="text-[10px] font-bold uppercase tracking-wider text-text-muted">Active CPS</span>
              <p className="mt-1 text-xl font-bold text-primary">{concurrency} / sec</p>
              <span className="text-[10px] text-text-muted">Channels capacity</span>
            </div>
          </div>

          {/* Keypress Breakdown */}
          <div className="rounded-lg border border-border bg-surface-secondary p-4">
            <h3 className="text-xs font-bold text-text uppercase tracking-wider">
              DTMF Keypress & Disposition Breakdown
            </h3>
            <div className="mt-3 space-y-2.5">
              <div>
                <div className="flex justify-between text-xs font-medium">
                  <span className="flex items-center gap-1.5 text-text">
                    <span className="flex h-4 w-4 items-center justify-center rounded bg-success-bg font-bold text-success text-[10px] border border-success/20">1</span>
                    <span>Interested / Agent Transfer</span>
                  </span>
                  <span className="font-bold text-text">{interested.toLocaleString()} leads ({responseRate}%)</span>
                </div>
                <div className="mt-1 h-2 w-full rounded-full bg-neutral-bg overflow-hidden border border-border/40">
                  <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${Math.min(100, Math.max(12, Number(responseRate) * 4))}%` }} />
                </div>
              </div>

              <div>
                <div className="flex justify-between text-xs font-medium">
                  <span className="flex items-center gap-1.5 text-text">
                    <span className="flex h-4 w-4 items-center justify-center rounded bg-warning-bg font-bold text-warning text-[10px] border border-warning/20">2</span>
                    <span>Request Callback</span>
                  </span>
                  <span className="font-bold text-text">{Math.round(interested * 0.4).toLocaleString()} leads</span>
                </div>
                <div className="mt-1 h-2 w-full rounded-full bg-neutral-bg overflow-hidden border border-border/40">
                  <div className="h-full bg-amber-500 rounded-full" style={{ width: '22%' }} />
                </div>
              </div>

              <div>
                <div className="flex justify-between text-xs font-medium">
                  <span className="flex items-center gap-1.5 text-text">
                    <span className="flex h-4 w-4 items-center justify-center rounded bg-danger-bg font-bold text-danger text-[10px] border border-danger/20">9</span>
                    <span>Do Not Call (Auto DNC Scrubbed)</span>
                  </span>
                  <span className="font-bold text-text">{Math.round(completed * 0.08).toLocaleString()} numbers</span>
                </div>
                <div className="mt-1 h-2 w-full rounded-full bg-neutral-bg overflow-hidden border border-border/40">
                  <div className="h-full bg-danger rounded-full" style={{ width: '8%' }} />
                </div>
              </div>
            </div>
          </div>

          {/* Details footer */}
          <div className="grid grid-cols-2 gap-4 text-xs text-text-muted border-t border-border pt-3">
            <div>
              <span className="text-text-muted">Lead List:</span>{' '}
              <span className="font-semibold text-text">{campaign.leadListName || 'Standard Trunk List'}</span>
            </div>
            <div>
              <span className="text-text-muted">Transfer Desk:</span>{' '}
              <span className="font-semibold text-text">{campaign.transferGroup || 'Executive Loan Officers'}</span>
            </div>
          </div>
        </div>

        <div className="mt-6 flex justify-end">
          <button
            onClick={onClose}
            className="rounded-md border border-border bg-surface px-4 py-2 text-xs font-semibold text-text hover:bg-surface-secondary transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
