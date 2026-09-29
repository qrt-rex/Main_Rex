import { useState } from 'react';
import { CalendarCheck, CalendarClock, CalendarDays, Phone } from 'lucide-react';
import { Badge } from '../../components/common/Badge';
import { Button } from '../../components/common/Button';
import { Card } from '../../components/common/Card';
import { EmptyState } from '../../components/common/EmptyState';
import { StatCard } from '../../components/dashboard/StatCard';
import { date, number, todayISO } from '../../lib/format';
import type { Lead } from '../api';

const OPEN = new Set(['NEW', 'ATTEMPTED', 'CALL_BACK', 'INTERESTED']);
type View = 'all' | 'due' | 'upcoming';

/** Open leads waiting on a callback: marked "call back", or with a follow-up date. */
export function scheduledCallbacks(leads: Lead[]) {
  const today = todayISO();
  const all = leads.filter((l) => OPEN.has(l.status) && (l.status === 'CALL_BACK' || !!l.follow_up_date));
  const isDue = (l: Lead) => !l.follow_up_date || l.follow_up_date <= today;
  return { all, due: all.filter(isDue), upcoming: all.filter((l) => !isDue(l)) };
}

export function CallbacksView({ leads, disabled, onCall }: { leads: Lead[]; disabled: boolean; onCall: (lead: Lead) => void }) {
  const [view, setView] = useState<View>('all');
  const groups = scheduledCallbacks(leads);
  const today = todayISO();
  const rows = (view === 'all' ? groups.all : view === 'due' ? groups.due : groups.upcoming)
    .slice()
    .sort((a, b) => (a.follow_up_date ?? '').localeCompare(b.follow_up_date ?? ''));

  const tabs: [View, string][] = [['all', 'All'], ['due', 'Due now'], ['upcoming', 'Upcoming']];

  return (
    <>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">All callbacks</h1>
          <p className="mt-1 text-sm text-text-muted">All your scheduled callback leads (past, present and future)</p>
        </div>
        <div role="tablist" aria-label="Callback filter" className="inline-flex rounded-md border border-border bg-surface p-0.5 shadow-[var(--shadow-card)]">
          {tabs.map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={view === id}
              onClick={() => setView(id)}
              className={`rounded px-3 py-1.5 text-[13px] font-medium transition-colors ${
                view === id ? 'bg-primary-soft text-primary' : 'text-text-secondary hover:text-text'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <StatCard icon={CalendarDays} tone="primary" label="Total" value={number(groups.all.length)} />
        <StatCard icon={CalendarClock} tone="danger" label="Due now" value={number(groups.due.length)} hint="Today or overdue" />
        <StatCard icon={CalendarCheck} tone="success" label="Upcoming" value={number(groups.upcoming.length)} hint="Later dates" />
      </div>

      <Card className="overflow-hidden">
        {rows.length === 0 ? (
          <EmptyState
            icon={CalendarDays}
            title="No callbacks"
            description={view === 'all' ? 'You have no scheduled callbacks.' : view === 'due' ? 'Nothing is due right now.' : 'No callbacks are scheduled for later dates.'}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-border bg-surface-secondary text-left text-[11px] font-semibold uppercase tracking-wider text-text-muted">
                  <th className="px-4 py-2.5">Lead</th>
                  <th className="px-3 py-2.5">Phone</th>
                  <th className="px-3 py-2.5">Callback</th>
                  <th className="px-3 py-2.5">Last note</th>
                  <th className="px-4 py-2.5"><span className="sr-only">Call</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((l) => {
                  const overdue = !!l.follow_up_date && l.follow_up_date < today;
                  const due = !l.follow_up_date || l.follow_up_date <= today;
                  return (
                    <tr key={l.id} className="hover:bg-surface-secondary/60">
                      <td className="px-4 py-2.5">
                        <span className="block font-medium">{l.name || l.company}</span>
                        <span className="text-xs text-text-muted">{[l.name ? l.company : '', l.service_interest].filter(Boolean).join(' · ') || '—'}</span>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 tabular-nums">{l.phone || '—'}</td>
                      <td className="whitespace-nowrap px-3 py-2.5">
                        <Badge tone={overdue ? 'danger' : due ? 'warning' : 'success'}>
                          {l.follow_up_date ? `${overdue ? 'Overdue · ' : ''}${date(l.follow_up_date)}` : 'Due now'}
                        </Badge>
                      </td>
                      <td className="max-w-xs truncate px-3 py-2.5 text-text-secondary">{l.last_note || l.notes || '—'}</td>
                      <td className="px-4 py-2.5 text-right">
                        <Button size="sm" onClick={() => onCall(l)} disabled={disabled || !l.phone}>
                          <Phone size={12} aria-hidden="true" /> Call
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
