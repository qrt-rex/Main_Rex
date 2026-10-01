import { Users, Radio, Plus } from 'lucide-react';
import type { AgentGroup } from '../types';

interface AgentGroupsViewProps {
  groups: AgentGroup[];
}

export function AgentGroupsView({ groups }: AgentGroupsViewProps) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-bold text-text">Transfer Agent Groups</h2>
          <p className="text-xs text-text-muted">Live agent desks configured for instant IVR keypress transfers</p>
        </div>
        <button
          onClick={() => alert('Add agent group modal')}
          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3.5 py-1.5 text-xs font-bold text-on-primary shadow-[var(--shadow-card)] hover:bg-primary-hover transition-colors"
        >
          <Plus size={14} />
          <span>New Agent Group</span>
        </button>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {groups.map((group) => (
          <div key={group.id} className="rounded-xl border border-border bg-surface p-4 shadow-[var(--shadow-card)]">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-soft text-primary font-bold">
                  <Users size={16} />
                </div>
                <div>
                  <h3 className="text-xs font-bold text-text">{group.name}</h3>
                  <span className="text-[10px] text-text-muted font-mono">{group.transferDid}</span>
                </div>
              </div>
            </div>

            <p className="mt-2 text-xs text-text-secondary line-clamp-2">{group.description}</p>

            <div className="mt-4 flex items-center justify-between border-t border-border pt-3 text-xs">
              <div>
                <span className="text-text-muted">Agents:</span>{' '}
                <span className="font-bold text-text">{group.activeAgents} / {group.totalAgents} Online</span>
              </div>
              <span className="inline-flex items-center gap-1 rounded-full bg-success-bg border border-success/20 px-2 py-0.5 text-[10px] font-bold text-success">
                <Radio size={10} className="animate-pulse" /> {group.liveCallsCount} Active Calls
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
