import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { Download, Info, Pause, Play, PhoneIncoming, PhoneOutgoing, RefreshCw } from 'lucide-react';
import { Badge, type BadgeTone } from '../../components/common/Badge';
import { Button } from '../../components/common/Button';
import { Card } from '../../components/common/Card';
import { EmptyState } from '../../components/common/EmptyState';
import { ErrorState } from '../../components/common/ErrorState';
import { Input, SearchInput } from '../../components/common/Input';
import { Skeleton } from '../../components/common/Skeleton';
import { digits, samePhone } from '../../ivr/ivrApi';
import { cellText, columnsOf, humanize } from '../../ivr/components/IvrTable';
import type { IvrCall } from '../../ivr/types';
import type { Lead } from '../api';

const hms = (total: number | null) => {
  if (total === null) return '—';
  const t = Math.max(0, Math.floor(total));
  return [Math.floor(t / 3600), Math.floor((t % 3600) / 60), t % 60].map((n) => String(n).padStart(2, '0')).join(':');
};

const localDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function statusTone(s: string): BadgeTone {
  const v = s.toLowerCase();
  if (/complet|answer|connect|success/.test(v)) return 'success';
  if (/miss|fail|reject|no.?answer|unanswer|cancel/.test(v)) return 'danger';
  if (/busy|abandon|voicemail/.test(v)) return 'warning';
  return 'neutral';
}

const uniq = (values: string[]) => [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b));

interface CallHistoryViewProps {
  calls: IvrCall[] | null;
  status: 'loading' | 'success' | 'error';
  error?: string;
  loading: boolean;
  onReload: () => void;
  leads: Lead[];
}

/** Every call record in the IVR account, with the IVR's own fields and recordings. */
export function CallHistoryView({ calls, status, error, loading, onReload, leads }: CallHistoryViewProps) {
  const [q, setQ] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [campaign, setCampaign] = useState('');
  const [dir, setDir] = useState('');
  const [type, setType] = useState('');
  const [callStatus, setCallStatus] = useState('');
  const [disposition, setDisposition] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);

  useEffect(() => () => audio.current?.pause(), []);

  const all = calls ?? [];
  const options = useMemo(() => ({
    campaigns: uniq(all.map((c) => c.campaign)),
    types: uniq(all.map((c) => c.callType)),
    statuses: uniq(all.map((c) => c.callStatus)),
    dispositions: uniq(all.map((c) => c.disposition)),
  }), [all]);

  const qDigits = digits(q);
  const shown = all.filter((c) => {
    if (q && !(qDigits ? digits(c.phone).includes(qDigits) : c.phone.toLowerCase().includes(q.toLowerCase()))) return false;
    if (from || to) {
      const d = c.at ? new Date(c.at) : null;
      if (!d || Number.isNaN(d.getTime())) return false;
      const day = localDay(d);
      if (from && day < from) return false;
      if (to && day > to) return false;
    }
    if (campaign && c.campaign !== campaign) return false;
    if (dir && c.direction !== dir) return false;
    if (type && c.callType !== type) return false;
    if (callStatus && c.callStatus !== callStatus) return false;
    if (disposition && c.disposition !== disposition) return false;
    return true;
  });

  const togglePlay = (c: IvrCall) => {
    if (!c.recordingUrl) return;
    if (playing === c.id) {
      audio.current?.pause();
      setPlaying(null);
      return;
    }
    audio.current?.pause();
    const player = new Audio(c.recordingUrl);
    player.onended = () => setPlaying(null);
    player.onerror = () => setPlaying(null);
    audio.current = player;
    player.play().then(() => setPlaying(c.id)).catch(() => setPlaying(null));
  };

  const leadName = (c: IvrCall) => c.leadName || leads.find((l) => samePhone(l.phone, c.phone))?.name || '';
  const filtersOn = !!(q || from || to || campaign || dir || type || callStatus || disposition);

  return (
    <>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Call history</h1>
          <p className="mt-1 text-sm text-text-muted">
            Your complete call records {calls ? `(${filtersOn ? `${shown.length} of ${all.length}` : all.length} calls)` : ''}
          </p>
        </div>
        <Button variant="secondary" onClick={onReload} aria-label="Refresh call records">
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} aria-hidden="true" /> Refresh
        </Button>
      </div>

      <Card className="mb-4 space-y-3 p-4">
        <SearchInput value={q} onChange={setQ} placeholder="Search by phone number…" label="Search by phone number" />
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 2xl:grid-cols-7">
          <Input label="Date from" type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
          <Input label="Date to" type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
          <Filter label="Campaign" value={campaign} onChange={setCampaign} all="All campaigns" options={options.campaigns} />
          <Filter label="Direction" value={dir} onChange={setDir} all="All" options={['in', 'out']} labels={{ in: 'Inbound', out: 'Outbound' }} />
          <Filter label="Call type" value={type} onChange={setType} all="All types" options={options.types} />
          <Filter label="Status" value={callStatus} onChange={setCallStatus} all="All status" options={options.statuses} />
          <Filter label="Disposition" value={disposition} onChange={setDisposition} all="All dispositions" options={options.dispositions} />
        </div>
        {filtersOn && (
          <button
            type="button"
            onClick={() => { setQ(''); setFrom(''); setTo(''); setCampaign(''); setDir(''); setType(''); setCallStatus(''); setDisposition(''); }}
            className="text-xs font-medium text-primary hover:underline"
          >
            Clear filters
          </button>
        )}
      </Card>

      <Card className="overflow-hidden">
        {status === 'error' && !calls ? (
          <ErrorState message={error} onRetry={onReload} />
        ) : !calls ? (
          <div className="space-y-2 p-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-12" />)}</div>
        ) : all.length === 0 ? (
          <EmptyState title="No calls yet" description="Calls made or received on your IVR account appear here." />
        ) : shown.length === 0 ? (
          <EmptyState title="No matching calls" description="Try different filters." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-border bg-surface-secondary text-left text-[11px] font-semibold uppercase tracking-wider text-text-muted">
                  <th className="px-4 py-2.5">Date &amp; time</th>
                  <th className="px-3 py-2.5">Dir</th>
                  <th className="px-3 py-2.5">Type</th>
                  <th className="px-3 py-2.5">Phone</th>
                  <th className="px-3 py-2.5">Lead</th>
                  <th className="px-3 py-2.5">Campaign</th>
                  <th className="px-3 py-2.5">Duration</th>
                  <th className="px-3 py-2.5">Status</th>
                  <th className="px-3 py-2.5">Disposition</th>
                  <th className="px-3 py-2.5">Recording</th>
                  <th className="px-3 py-2.5"><span className="sr-only">Details</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {shown.map((c) => {
                  const when = c.at ? new Date(c.at) : null;
                  const valid = when && !Number.isNaN(when.getTime());
                  return (
                    <Fragment key={c.id}>
                      <tr className="hover:bg-surface-secondary/60">
                        <td className="whitespace-nowrap px-4 py-2.5">
                          {valid ? (
                            <>
                              <span className="block font-medium">{when!.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
                              <span className="text-xs text-text-muted">{when!.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
                            </>
                          ) : '—'}
                        </td>
                        <td className="px-3 py-2.5">
                          {c.direction === 'in' ? (
                            <Badge tone="success"><PhoneIncoming size={11} className="mr-1" aria-hidden="true" />In</Badge>
                          ) : c.direction === 'out' ? (
                            <Badge tone="info"><PhoneOutgoing size={11} className="mr-1" aria-hidden="true" />Out</Badge>
                          ) : '—'}
                        </td>
                        <td className="px-3 py-2.5">{c.callType ? <Badge tone="info">{c.callType}</Badge> : '—'}</td>
                        <td className="whitespace-nowrap px-3 py-2.5 tabular-nums">{c.phone || '—'}</td>
                        <td className="max-w-[160px] truncate px-3 py-2.5 font-medium">{leadName(c) || '—'}</td>
                        <td className="max-w-[180px] truncate px-3 py-2.5 text-text-secondary" title={c.campaign}>{c.campaign || '—'}</td>
                        <td className="whitespace-nowrap px-3 py-2.5">
                          <span className="block font-mono tabular-nums">{hms(c.durationSeconds)}</span>
                          {c.talkSeconds !== null && <span className="text-xs text-text-muted">Talk: {hms(c.talkSeconds)}</span>}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5">
                          {c.callStatus ? <Badge tone={statusTone(c.callStatus)}>{c.callStatus}</Badge> : '—'}
                          {c.reason && <span className="mt-0.5 block text-xs text-text-muted">{c.reason}</span>}
                        </td>
                        <td className="px-3 py-2.5">{c.disposition ? <Badge tone={statusTone(c.disposition)}>{c.disposition}</Badge> : <span className="text-text-muted">—</span>}</td>
                        <td className="whitespace-nowrap px-3 py-2.5">
                          {c.recordingUrl ? (
                            <span className="flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => togglePlay(c)}
                                aria-label={playing === c.id ? 'Pause recording' : 'Play recording'}
                                className="flex h-7 w-7 items-center justify-center rounded-full bg-primary-soft text-primary hover:opacity-80"
                              >
                                {playing === c.id ? <Pause size={12} /> : <Play size={12} className="ml-0.5" />}
                              </button>
                              <a
                                href={c.recordingUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                download
                                aria-label="Download recording"
                                className="flex h-7 w-7 items-center justify-center rounded-full bg-primary-soft text-primary hover:opacity-80"
                              >
                                <Download size={12} />
                              </a>
                              <span className="text-xs text-text-muted tabular-nums">{hms(c.recordingSeconds)}</span>
                            </span>
                          ) : <span className="text-text-muted">—</span>}
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          <button
                            type="button"
                            onClick={() => setOpenId(openId === c.id ? null : c.id)}
                            aria-expanded={openId === c.id}
                            aria-label="All details from the IVR"
                            className="rounded p-1 text-text-muted hover:bg-neutral-bg hover:text-text"
                          >
                            <Info size={15} />
                          </button>
                        </td>
                      </tr>
                      {openId === c.id && (
                        <tr className="bg-surface-secondary/50">
                          <td colSpan={11} className="px-4 py-3">
                            <dl className="grid gap-x-6 gap-y-1.5 text-xs sm:grid-cols-2 lg:grid-cols-3">
                              {columnsOf([c.raw]).map((k) => (
                                <div key={k} className="flex min-w-0 justify-between gap-3">
                                  <dt className="shrink-0 text-text-muted">{humanize(k)}</dt>
                                  <dd className="truncate text-right font-medium" title={cellText(c.raw[k])}>{cellText(c.raw[k])}</dd>
                                </div>
                              ))}
                            </dl>
                          </td>
                        </tr>
                      )}
                    </Fragment>
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

function Filter({ label, value, onChange, all, options, labels = {} }: {
  label: string; value: string; onChange: (v: string) => void; all: string; options: string[]; labels?: Record<string, string>;
}) {
  return (
    <label className="flex min-w-0 flex-col gap-1.5">
      <span className="text-[13px] font-medium text-text-secondary">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 w-full rounded-md border border-border bg-surface px-2.5 text-sm text-text shadow-[var(--shadow-card)] focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/25"
      >
        <option value="">{all}</option>
        {options.map((o) => <option key={o} value={o}>{labels[o] ?? o}</option>)}
      </select>
    </label>
  );
}
