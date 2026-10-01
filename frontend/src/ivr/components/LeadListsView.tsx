import { useState } from 'react';
import { UploadCloud, FileSpreadsheet } from 'lucide-react';
import type { LeadList } from '../types';

interface LeadListsViewProps {
  leadLists: LeadList[];
}

export function LeadListsView({ leadLists }: LeadListsViewProps) {
  const [lists, setLists] = useState<LeadList[]>(leadLists);

  const handleUploadSim = () => {
    const listName = prompt('Enter name for the new lead list:');
    if (!listName) return;
    const newList: LeadList = {
      id: `list-${Date.now()}`,
      name: listName,
      totalCount: 100000,
      validCount: 98400,
      dncFilteredCount: 1600,
      uploadedAt: 'Today',
      status: 'Ready',
    };
    setLists([newList, ...lists]);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-bold text-text">Lead Lists & Number Datasets</h2>
          <p className="text-xs text-text-muted">Manage uploaded CSVs, automatic DNC scrubbing and carrier validation</p>
        </div>
        <button
          onClick={handleUploadSim}
          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3.5 py-1.5 text-xs font-bold text-on-primary shadow-[var(--shadow-card)] hover:bg-primary-hover transition-colors"
        >
          <UploadCloud size={14} />
          <span>Upload New Leads CSV</span>
        </button>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {lists.map((list) => (
          <div key={list.id} className="rounded-xl border border-border bg-surface p-4 shadow-[var(--shadow-card)]">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-soft text-primary">
                  <FileSpreadsheet size={16} />
                </div>
                <div>
                  <h3 className="text-xs font-bold text-text">{list.name}</h3>
                  <span className="text-[10px] text-text-muted">Uploaded {list.uploadedAt}</span>
                </div>
              </div>
              <span
                className={`rounded-full px-2 py-0.5 text-[10px] font-semibold border ${
                  list.status === 'In Use'
                    ? 'bg-warning-bg text-warning border-warning/20'
                    : 'bg-success-bg text-success border-success/20'
                }`}
              >
                {list.status}
              </span>
            </div>

            <div className="mt-4 grid grid-cols-3 gap-2 border-t border-border pt-3 text-center">
              <div>
                <span className="block text-[10px] font-bold text-text-muted uppercase">Total</span>
                <span className="text-xs font-bold text-text">{list.totalCount.toLocaleString()}</span>
              </div>
              <div>
                <span className="block text-[10px] font-bold text-text-muted uppercase">Valid</span>
                <span className="text-xs font-bold text-success">{list.validCount.toLocaleString()}</span>
              </div>
              <div>
                <span className="block text-[10px] font-bold text-text-muted uppercase">DNC Filtered</span>
                <span className="text-xs font-bold text-danger">{list.dncFilteredCount.toLocaleString()}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
