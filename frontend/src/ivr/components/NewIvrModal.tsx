import { useState } from 'react';
import { X, PhoneCall, Volume2, ArrowRight } from 'lucide-react';
import type { IvrCampaign } from '../types';

interface NewIvrModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (campaign: Omit<IvrCampaign, 'id' | 'createdAt'>) => void;
}

export function NewIvrModal({ isOpen, onClose, onSave }: NewIvrModalProps) {
  const [name, setName] = useState('');
  const [concurrency, setConcurrency] = useState(75);
  const [totalLeads, setTotalLeads] = useState(150000);
  const audioPrompt = 'Rexera_PreApproval_Audio_v2.mp3';
  const [didPool, setDidPool] = useState('Direct Line Pool A (24 DIDs)');
  const [transferGroup, setTransferGroup] = useState('Executive Loan Officers');
  const [leadListName, setLeadListName] = useState('US Financial Pre-Approved Leads Q1');

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    onSave({
      name: name.trim().toUpperCase(),
      subtitle: `Concurrency ${concurrency}`,
      status: 'running',
      state: 'active',
      concurrency,
      progressPercentage: 1,
      dialedLeads: 120,
      totalLeads,
      queued: totalLeads - 120,
      dialing: Math.min(concurrency, 35),
      completed: 85,
      interested: 4,
      audioPrompt,
      didPool,
      transferGroup,
      leadListName,
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
      <div className="relative w-full max-w-xl rounded-xl border border-border bg-surface p-6 shadow-[var(--shadow-pop)] animate-in fade-in zoom-in-95 duration-150">
        <div className="flex items-center justify-between border-b border-border pb-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-soft text-primary font-bold">
              <PhoneCall size={18} />
            </div>
            <div>
              <h2 className="text-base font-bold text-text">Create New IVR Voice Blast</h2>
              <p className="text-xs text-text-muted">Configure outbound dialer parameters, audio message & queue</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-text-muted hover:bg-neutral-bg hover:text-text transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-5 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-text-secondary uppercase tracking-wider">
              Campaign Name
            </label>
            <input
              type="text"
              required
              placeholder="e.g. MASTER SMIT 8"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-1.5 w-full rounded-md border border-border bg-surface px-3.5 py-2 text-sm text-text placeholder:text-text-muted focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 uppercase font-medium shadow-xs"
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-semibold text-text-secondary uppercase tracking-wider">
                Select Lead List
              </label>
              <select
                value={leadListName}
                onChange={(e) => setLeadListName(e.target.value)}
                className="mt-1.5 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 shadow-xs"
              >
                <option value="US Financial Pre-Approved Leads Q1">US Financial Pre-Approved Leads (505.8k)</option>
                <option value="SMB Funding Verified List March">SMB Funding Verified List (213.8k)</option>
                <option value="Commercial Real Estate Leads">Commercial Real Estate Leads (472.0k)</option>
                <option value="Mortgage Refinance Homeowners 2026">Mortgage Refinance Homeowners (350.0k)</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-text-secondary uppercase tracking-wider">
                Outbound DID Trunk Pool
              </label>
              <select
                value={didPool}
                onChange={(e) => setDidPool(e.target.value)}
                className="mt-1.5 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 shadow-xs"
              >
                <option value="Direct Line Pool A (24 DIDs)">Direct Line Pool A (24 DIDs)</option>
                <option value="High Concurrency Trunk 1">High Concurrency Trunk 1 (50 DIDs)</option>
                <option value="Tier-1 Telecom Pool">Tier-1 Telecom Pool (100 DIDs)</option>
              </select>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-text-secondary uppercase tracking-wider">
                Concurrency (Simultaneous Channels: {concurrency})
              </label>
              <span className="text-xs font-bold text-primary">{concurrency} CPS</span>
            </div>
            <input
              type="range"
              min="10"
              max="250"
              step="5"
              value={concurrency}
              onChange={(e) => setConcurrency(Number(e.target.value))}
              className="mt-2 w-full accent-primary"
            />
            <div className="flex justify-between text-[10px] text-text-muted">
              <span>10 channels</span>
              <span>75 channels (Recommended)</span>
              <span>250 channels</span>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-semibold text-text-secondary uppercase tracking-wider">
                Transfer Agent Group (Key 1)
              </label>
              <select
                value={transferGroup}
                onChange={(e) => setTransferGroup(e.target.value)}
                className="mt-1.5 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 shadow-xs"
              >
                <option value="Executive Loan Officers">Executive Loan Officers (18 online)</option>
                <option value="Business Loan Specialists">Business Loan Specialists (12 online)</option>
                <option value="Senior Underwriting Desk">Senior Underwriting Desk (8 online)</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-text-secondary uppercase tracking-wider">
                Total Leads to Dial
              </label>
              <input
                type="number"
                value={totalLeads}
                onChange={(e) => setTotalLeads(Number(e.target.value))}
                className="mt-1.5 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 font-medium shadow-xs"
              />
            </div>
          </div>

          <div className="rounded-lg bg-surface-secondary border border-border p-3.5">
            <div className="flex items-center gap-2 text-xs font-bold text-text">
              <Volume2 size={15} className="text-primary" />
              <span>IVR Audio Broadcast Configuration</span>
            </div>
            <p className="mt-1 text-xs text-text-secondary">
              Prompt: <span className="font-mono font-medium text-text">{audioPrompt}</span>
            </p>
            <div className="mt-2.5 flex items-center gap-2 text-[11px] text-text-muted">
              <span className="rounded bg-surface px-2 py-0.5 font-semibold text-text border border-border">Key 1 → Live Agent</span>
              <span className="rounded bg-surface px-2 py-0.5 font-semibold text-text border border-border">Key 2 → Callback</span>
              <span className="rounded bg-surface px-2 py-0.5 font-semibold text-text border border-border">Key 9 → DNC</span>
            </div>
          </div>

          <div className="flex items-center justify-end gap-2.5 pt-3">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-border px-4 py-2 text-xs font-semibold text-text hover:bg-surface-secondary transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="inline-flex items-center gap-2 rounded-md bg-primary px-5 py-2 text-xs font-bold text-on-primary shadow-[var(--shadow-card)] hover:bg-primary-hover transition-colors"
            >
              <span>Launch Voice Blast</span>
              <ArrowRight size={14} />
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
