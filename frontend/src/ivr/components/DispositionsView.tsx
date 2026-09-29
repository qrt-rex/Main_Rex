import { MessageSquare } from 'lucide-react';
import type { DispositionRule } from '../types';

interface DispositionsViewProps {
  dispositions: DispositionRule[];
}

export function DispositionsView({ dispositions }: DispositionsViewProps) {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-bold text-text">DTMF Keypress & Disposition Rules</h2>
        <p className="text-xs text-text-muted">Map caller telephone keypresses (0-9, #, *) to immediate dialer workflows</p>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-[var(--shadow-card)]">
        <table className="w-full text-left text-xs">
          <thead className="bg-surface-secondary text-text-muted font-bold uppercase tracking-wider border-b border-border">
            <tr>
              <th className="px-4 py-3">Keypad DTMF</th>
              <th className="px-4 py-3">Disposition Label</th>
              <th className="px-4 py-3">Engine Action</th>
              <th className="px-4 py-3">Target / Transfer Queue</th>
              <th className="px-4 py-3">SMS Follow-up</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border font-normal text-text">
            {dispositions.map((rule) => (
              <tr key={rule.key} className="hover:bg-surface-secondary/60 transition-colors">
                <td className="px-4 py-3">
                  <span className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-primary-soft font-mono font-bold text-primary text-xs shadow-2xs border border-primary/20">
                    {rule.key}
                  </span>
                </td>
                <td className="px-4 py-3 font-semibold text-text">{rule.label}</td>
                <td className="px-4 py-3">
                  <span className="rounded bg-neutral-bg border border-border px-2 py-0.5 font-mono text-[11px] font-medium text-text-secondary">
                    {rule.action}
                  </span>
                </td>
                <td className="px-4 py-3 text-text-secondary">
                  {rule.targetGroup ? (
                    <span className="font-medium text-text">{rule.targetGroup}</span>
                  ) : (
                    <span className="text-text-muted">Default Flow</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  {rule.smsFollowup ? (
                    <span className="inline-flex items-center gap-1 text-success font-medium">
                      <MessageSquare size={12} /> Enabled
                    </span>
                  ) : (
                    <span className="text-text-muted">Disabled</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
