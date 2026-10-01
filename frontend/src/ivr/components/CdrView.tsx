import { useState } from 'react';
import { Search, Download } from 'lucide-react';
import type { CallRecord } from '../types';

interface CdrViewProps {
  records: CallRecord[];
}

export function CdrView({ records }: CdrViewProps) {
  const [query, setQuery] = useState('');
  const [filterDisp, setFilterDisp] = useState('ALL');

  const filtered = records.filter((r) => {
    const matchesSearch =
      r.leadPhone.includes(query) ||
      (r.leadName && r.leadName.toLowerCase().includes(query.toLowerCase())) ||
      r.campaignName.toLowerCase().includes(query.toLowerCase());
    const matchesDisp = filterDisp === 'ALL' || r.disposition === filterDisp;
    return matchesSearch && matchesDisp;
  });

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        <div className="relative flex-1 max-w-md">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
          <input
            type="text"
            placeholder="Search by phone, name or campaign..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full rounded-md border border-border bg-surface pl-9 pr-3.5 py-1.5 text-xs text-text placeholder:text-text-muted focus:border-primary focus:outline-none shadow-xs"
          />
        </div>

        <div className="flex items-center gap-2">
          <select
            value={filterDisp}
            onChange={(e) => setFilterDisp(e.target.value)}
            className="rounded-md border border-border bg-surface px-3 py-1.5 text-xs font-medium text-text focus:border-primary focus:outline-none shadow-xs"
          >
            <option value="ALL">All Dispositions</option>
            <option value="Interested">Interested (Key 1)</option>
            <option value="Transferred">Transferred</option>
            <option value="No Answer">No Answer</option>
            <option value="DNC">DNC (Key 9)</option>
          </select>

          <button
            onClick={() => alert('Exporting CDR log to CSV...')}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-3.5 py-1.5 text-xs font-semibold text-text hover:bg-surface-secondary shadow-[var(--shadow-card)] transition-colors"
          >
            <Download size={13} />
            <span>Export CSV</span>
          </button>
        </div>
      </div>

      {/* CDR Table */}
      <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-[var(--shadow-card)]">
        <table className="w-full text-left text-xs">
          <thead className="bg-surface-secondary text-text-muted font-bold uppercase tracking-wider border-b border-border">
            <tr>
              <th className="px-4 py-3">Lead Phone</th>
              <th className="px-4 py-3">Contact</th>
              <th className="px-4 py-3">Campaign</th>
              <th className="px-4 py-3">Caller DID</th>
              <th className="px-4 py-3">Keypress</th>
              <th className="px-4 py-3">Disposition</th>
              <th className="px-4 py-3">Duration</th>
              <th className="px-4 py-3">Agent / Rec</th>
              <th className="px-4 py-3 text-right">Time</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border font-normal text-text">
            {filtered.map((row) => (
              <tr key={row.id} className="hover:bg-surface-secondary/60 transition-colors">
                <td className="px-4 py-3 font-semibold text-text">{row.leadPhone}</td>
                <td className="px-4 py-3 text-text-secondary">{row.leadName || '—'}</td>
                <td className="px-4 py-3">
                  <span className="font-medium text-text uppercase">{row.campaignName}</span>
                </td>
                <td className="px-4 py-3 text-text-muted">{row.callerId}</td>
                <td className="px-4 py-3">
                  {row.dtmfKey ? (
                    <span className="inline-flex h-5 w-5 items-center justify-center rounded bg-primary-soft font-bold text-primary text-[10px]">
                      {row.dtmfKey}
                    </span>
                  ) : (
                    <span className="text-text-muted">—</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ${
                      row.disposition === 'Interested'
                        ? 'bg-success-bg text-success border border-success/20'
                        : row.disposition === 'Transferred'
                        ? 'bg-info-bg text-info border border-info/20'
                        : row.disposition === 'DNC'
                        ? 'bg-danger-bg text-danger border border-danger/20'
                        : 'bg-neutral-bg text-text-secondary border border-border'
                    }`}
                  >
                    {row.disposition}
                  </span>
                </td>
                <td className="px-4 py-3 text-text-muted">{row.durationSeconds}s</td>
                <td className="px-4 py-3">
                  {row.agentName ? (
                    <span className="text-text font-medium">{row.agentName}</span>
                  ) : (
                    <span className="text-text-muted">IVR Engine</span>
                  )}
                </td>
                <td className="px-4 py-3 text-right text-text-muted">{row.callTime}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
