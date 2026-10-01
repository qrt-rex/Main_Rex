import { ShieldCheck, Plus } from 'lucide-react';
import type { DidNumber } from '../types';

interface DidsViewProps {
  dids: DidNumber[];
}

export function DidsView({ dids }: DidsViewProps) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-bold text-text">Direct Inward Dialing (DID) Pool</h2>
          <p className="text-xs text-text-muted">Carrier telephone trunks, reputation score and daily call distribution</p>
        </div>
        <button
          onClick={() => alert('Purchase / Provision DIDs modal')}
          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3.5 py-1.5 text-xs font-bold text-on-primary shadow-[var(--shadow-card)] hover:bg-primary-hover transition-colors"
        >
          <Plus size={14} />
          <span>Provision New DIDs</span>
        </button>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-[var(--shadow-card)]">
        <table className="w-full text-left text-xs">
          <thead className="bg-surface-secondary text-text-muted font-bold uppercase tracking-wider border-b border-border">
            <tr>
              <th className="px-4 py-3">Phone Number</th>
              <th className="px-4 py-3">Telecom Carrier</th>
              <th className="px-4 py-3">Region / Scope</th>
              <th className="px-4 py-3">Assigned Campaign</th>
              <th className="px-4 py-3">Calls Today</th>
              <th className="px-4 py-3">Spam / Attestation</th>
              <th className="px-4 py-3">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border font-normal text-text">
            {dids.map((did) => (
              <tr key={did.id} className="hover:bg-surface-secondary/60 transition-colors">
                <td className="px-4 py-3 font-mono font-bold text-text">{did.number}</td>
                <td className="px-4 py-3 text-text-secondary">{did.carrier}</td>
                <td className="px-4 py-3 text-text-muted">{did.state}</td>
                <td className="px-4 py-3">
                  {did.assignedCampaign ? (
                    <span className="font-semibold text-text uppercase">{did.assignedCampaign}</span>
                  ) : (
                    <span className="text-text-muted">Unassigned (Standby)</span>
                  )}
                </td>
                <td className="px-4 py-3 font-semibold text-text">{did.callsToday.toLocaleString()}</td>
                <td className="px-4 py-3">
                  <span className="inline-flex items-center gap-1 text-success font-bold">
                    <ShieldCheck size={13} /> Clean (STIR/SHAKEN A)
                  </span>
                </td>
                <td className="px-4 py-3">
                  <span className="rounded-full bg-success-bg border border-success/20 px-2 py-0.5 text-[10px] font-bold text-success">
                    {did.status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
