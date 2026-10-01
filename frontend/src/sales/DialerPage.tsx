import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  CalendarClock, CircleCheck, Clock, History, LayoutDashboard, LogOut, Phone, PhoneCall, PhoneOff,
  PhoneOutgoing, Play, Radio, RefreshCw, SkipForward, Timer, TrendingUp, TriangleAlert, User, X,
  type LucideIcon,
} from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { useToast } from '../components/common/ToastContext';
import { Button } from '../components/common/Button';
import { Badge, StatusBadge, type BadgeTone } from '../components/common/Badge';
import { Card, CardHeader } from '../components/common/Card';
import { EmptyState } from '../components/common/EmptyState';
import { Input, Textarea } from '../components/common/Input';
import { ErrorState } from '../components/common/ErrorState';
import { Skeleton } from '../components/common/Skeleton';
import { StatCard } from '../components/dashboard/StatCard';
import { Header } from '../components/navigation/Header';
import { DashboardIntro } from '../dashboards/DashboardShell';
import { StatGrid } from '../dashboards/components';
import { ApiError } from '../lib/api';
import { NotificationsProvider } from '../lib/notifications';
import { useApi } from '../lib/useApi';
import { date, number, todayISO } from '../lib/format';
import { IvrGate, useIvr } from '../ivr/IvrGate';
import { ivrApi, samePhone } from '../ivr/ivrApi';
import { cellText } from '../ivr/components/IvrTable';
import { logCall, OUTCOMES, salesSummary, type Lead } from './api';
import { CallHistoryView } from './dialer/CallHistoryView';
import { CallbacksView, scheduledCallbacks } from './dialer/CallbacksView';
import { CampaignPicker, CRM_QUEUE, type DialerCampaign } from './dialer/CampaignPicker';
import { DIALER_CHANNEL, type DialerMessage } from './openDialer';
import { useLive } from './useLive';

type TabType = 'dashboard' | 'dialer' | 'callbacks' | 'history';
type AgentStatus = 'AVAILABLE' | 'ON_CALL' | 'WRAP_UP' | 'BREAK' | 'OFFLINE';
type Phase = 'idle' | 'placing' | 'on_call' | 'wrap_up';

const OPEN = new Set(['NEW', 'ATTEMPTED', 'CALL_BACK', 'INTERESTED']);
const STATUSES: AgentStatus[] = ['AVAILABLE', 'ON_CALL', 'WRAP_UP', 'BREAK', 'OFFLINE'];
/** Time that counts as working (Total duration); OFFLINE is not. */
const WORKING: AgentStatus[] = ['AVAILABLE', 'ON_CALL', 'WRAP_UP', 'BREAK'];
const STATUS_LABEL: Record<AgentStatus, string> = { AVAILABLE: 'Available', ON_CALL: 'On call', WRAP_UP: 'Wrap up', BREAK: 'Break / away', OFFLINE: 'Offline' };
const STATUS_TONE: Record<AgentStatus, BadgeTone> = { AVAILABLE: 'success', ON_CALL: 'info', WRAP_UP: 'primary', BREAK: 'warning', OFFLINE: 'neutral' };
const STATUS_TILE: Record<AgentStatus, string> = {
  AVAILABLE: 'bg-success-bg text-success',
  ON_CALL: 'bg-info-bg text-info',
  WRAP_UP: 'bg-primary-soft text-primary',
  BREAK: 'bg-warning-bg text-warning',
  OFFLINE: 'bg-neutral-bg text-text-secondary',
};
const OUTCOME_LABEL = Object.fromEntries(OUTCOMES) as Record<string, string>;
const OUTCOME_BAR: Record<string, string> = {
  CONVERTED: 'bg-success', INTERESTED: 'bg-info', CALL_BACK: 'bg-warning', NOT_INTERESTED: 'bg-danger',
};

interface LoggedCall {
  id: string;
  leadName: string;
  phone: string;
  outcome: string;
  durationSeconds: number;
  note: string;
  timestamp: string;
  via: 'ivr' | 'phone';
}

/** Today's agent time and calls, kept per CRM user so a reload or reopened tab carries on. */
interface DayLog {
  date: string;
  /** The status the agent last chose, restored when the dialer reopens. */
  status: AgentStatus;
  time: Record<AgentStatus, number>;
  breaks: number;
  firstSeen: number;
  calls: LoggedCall[];
  /** The campaign picked on the Dialer page; null until the agent picks one. */
  campaign: DialerCampaign | null;
}

const dayKey = (userId: string) => `rex-crm-dialer-day:${userId}`;

function loadDay(userId: string): DayLog {
  const fresh: DayLog = {
    date: todayISO(), status: 'AVAILABLE', time: { AVAILABLE: 0, ON_CALL: 0, WRAP_UP: 0, BREAK: 0, OFFLINE: 0 },
    breaks: 0, firstSeen: Date.now(), calls: [], campaign: null,
  };
  try {
    const saved = JSON.parse(localStorage.getItem(dayKey(userId)) ?? 'null') as Partial<DayLog> | null;
    if (saved?.date === todayISO() && saved.time) {
      // A call never survives a reload, so an agent who was mid-call comes back available.
      const status = saved.status && saved.status !== 'ON_CALL' && saved.status !== 'WRAP_UP' ? saved.status : 'AVAILABLE';
      return { ...fresh, ...saved, status, time: { ...fresh.time, ...saved.time } } as DayLog;
    }
  } catch {
    // ignore unreadable storage
  }
  return fresh;
}

const hms = (total: number) => {
  const t = Math.max(0, Math.floor(total));
  return [Math.floor(t / 3600), Math.floor((t % 3600) / 60), t % 60].map((n) => String(n).padStart(2, '0')).join(':');
};

const telHref = (phone: string) => `tel:${phone.replace(/[^\d+]/g, '')}`;

/** Standalone dialer tab: IVR sign-in first, then the agent dialer in the CRM's own look. */
export function DialerPage() {
  return (
    <IvrGate title="Rexera Dialer">
      <DialerConsole />
    </IvrGate>
  );
}

function DialerConsole() {
  const { user: crmUser, can } = useAuth();
  const { session, signOut } = useIvr();
  const { showToast } = useToast();
  const [params, setParams] = useSearchParams();
  const crmUserId = crmUser?.id ?? 'me';

  const summary = useApi(salesSummary);
  useLive(summary.reload);
  const campaigns = useApi(ivrApi.campaigns);
  const dids = useApi(ivrApi.dids);
  const cdr = useApi(ivrApi.calls);

  const ivrUser = session.user;
  const ivrCalling = !!ivrUser.company?.click_to_call_api_enabled;

  const [tab, setTab] = useState<TabType>(params.get('lead') ? 'dialer' : 'dashboard');
  const [day, setDay] = useState<DayLog>(() => loadDay(crmUserId));
  const [agentStatus, setAgentStatus] = useState<AgentStatus>(() => day.status);
  const [statusSince, setStatusSince] = useState(0);

  const [phase, setPhase] = useState<Phase>('idle');
  const [callVia, setCallVia] = useState<'ivr' | 'phone'>('phone');
  const [callSeconds, setCallSeconds] = useState(0);
  const [inputPhone, setInputPhone] = useState('');
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [callerDid, setCallerDid] = useState('');

  const [outcome, setOutcome] = useState('');
  const [note, setNote] = useState('');
  const [followUp, setFollowUp] = useState('');
  const [saving, setSaving] = useState(false);
  const [phoneNoticeHidden, setPhoneNoticeHidden] = useState(false);

  const leads = summary.data?.leads ?? [];
  const openLeads = leads.filter((l) => OPEN.has(l.status));
  const scheduled = scheduledCallbacks(leads);
  const callbacks = [...scheduled.due, ...scheduled.upcoming];
  const campaign = day.campaign;
  const chooseCampaign = (c: DialerCampaign | null) => setDay((d) => ({ ...d, campaign: c }));
  const me = summary.data?.progress.find((p) => p.user_id === summary.data?.me.user_id);
  const leadIndex = selectedLead ? openLeads.findIndex((l) => l.id === selectedLead.id) : -1;
  const inCall = phase === 'placing' || phase === 'on_call';

  // One tick a second: time in the current status, and the call timer.
  useEffect(() => {
    const t = window.setInterval(() => {
      setStatusSince((s) => s + 1);
      setDay((d) => (d.date === todayISO() ? { ...d, time: { ...d.time, [agentStatus]: d.time[agentStatus] + 1 } } : loadDay(crmUserId)));
      if (phase === 'on_call') setCallSeconds((s) => s + 1);
    }, 1000);
    return () => window.clearInterval(t);
  }, [agentStatus, phase, crmUserId]);

  useEffect(() => {
    try {
      localStorage.setItem(dayKey(crmUserId), JSON.stringify(day));
    } catch {
      // storage full or blocked: today's figures still live in this tab
    }
  }, [day, crmUserId]);

  const changeStatus = (s: AgentStatus) => {
    setDay((d) => ({ ...d, status: s, breaks: s === 'BREAK' && agentStatus !== 'BREAK' ? d.breaks + 1 : d.breaks }));
    setAgentStatus(s);
    setStatusSince(0);
  };

  // A number that no longer matches the lead is a direct call, never logged against that lead.
  const editNumber = (value: string) => {
    setInputPhone(value);
    if (selectedLead && !samePhone(value, selectedLead.phone)) setSelectedLead(null);
  };

  const pickLead = (lead: Lead) => {
    // Calling a CRM lead directly (callback, or "Log call" in the CRM) dials from the CRM queue.
    if (!day.campaign) chooseCampaign(CRM_QUEUE);
    setSelectedLead(lead);
    setInputPhone(lead.phone);
    setTab('dialer');
  };

  // Default caller ID: the DID the IVR assigned to this user, else the first one.
  useEffect(() => {
    if (callerDid || !dids.data?.length) return;
    const assignedId = String(ivrUser.manual_dialer_did_id ?? '');
    const assigned = assignedId ? dids.data.find((d) => d.id === assignedId || d.number === assignedId) : undefined;
    setCallerDid((assigned ?? dids.data[0]).number);
  }, [dids.data, callerDid, ivrUser.manual_dialer_did_id]);

  // ?lead=<id> from the CRM, else the first open lead.
  const wantedLead = params.get('lead');
  useEffect(() => {
    if (!summary.data) return;
    if (wantedLead) {
      const lead = summary.data.leads.find((l) => l.id === wantedLead);
      if (lead) pickLead(lead);
      else showToast('That lead is no longer assigned to you.', 'error');
      setParams({}, { replace: true });
    } else if (!selectedLead && openLeads.length) {
      setSelectedLead(openLeads[0]);
      setInputPhone(openLeads[0].phone);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [summary.data, wantedLead]);

  // Leads sent from the CRM tab while this dialer is already open.
  const inCallRef = useRef(inCall);
  inCallRef.current = inCall;
  useEffect(() => {
    if (!('BroadcastChannel' in window)) return;
    const channel = new BroadcastChannel(DIALER_CHANNEL);
    channel.onmessage = (e: MessageEvent<DialerMessage>) => {
      if (e.data?.type !== 'lead') return;
      if (inCallRef.current) {
        showToast('Finish the current call before switching leads.', 'error');
        return;
      }
      setParams({ lead: e.data.leadId }, { replace: true });
      summary.reload();
    };
    return () => channel.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startCall = async (lead?: Lead) => {
    const phone = (lead ? lead.phone : inputPhone).trim();
    if (!phone) {
      showToast('Enter a number or pick a lead to call.', 'error');
      return;
    }
    if (lead) pickLead(lead);
    setOutcome('');
    setNote('');
    setFollowUp('');
    setCallSeconds(0);
    changeStatus('ON_CALL');

    if (ivrCalling) {
      setPhase('placing');
      try {
        await ivrApi.call(phone, callerDid || undefined, campaign && campaign.id !== 'crm' ? campaign.id : undefined);
        setCallVia('ivr');
        setPhase('on_call');
        showToast('The IVR is connecting the call. Answer when your phone rings.', 'success');
      } catch (err) {
        setPhase('idle');
        changeStatus('AVAILABLE');
        showToast(err instanceof ApiError ? err.message : 'The IVR could not place the call.', 'error');
      }
      return;
    }
    // Click-to-call is off for this IVR account: hand the number to the phone / softphone app.
    setCallVia('phone');
    setPhase('on_call');
    const a = document.createElement('a');
    a.href = telHref(phone);
    a.click();
  };

  const endCall = () => {
    setPhase('wrap_up');
    changeStatus('WRAP_UP');
  };

  const nextLead = () => {
    if (!openLeads.length) return;
    const next = openLeads[(leadIndex + 1) % openLeads.length];
    setSelectedLead(next);
    setInputPhone(next.phone);
  };

  const resetCall = () => {
    setPhase('idle');
    setCallSeconds(0);
    setOutcome('');
    setNote('');
    setFollowUp('');
    changeStatus('AVAILABLE');
  };

  const remember = (leadName: string, phone: string) =>
    setDay((d) => ({
      ...d,
      calls: [{ id: String(Date.now()), leadName, phone, outcome, durationSeconds: callSeconds, note, timestamp: new Date().toISOString(), via: callVia }, ...d.calls],
    }));

  const saveAndNext = async () => {
    if (!outcome) {
      showToast('Pick the call outcome first.', 'error');
      return;
    }
    if (!selectedLead) {
      // A typed number with no CRM lead: nothing to log against in the CRM.
      remember('Direct number', inputPhone);
      resetCall();
      return;
    }
    setSaving(true);
    try {
      await logCall(selectedLead.id, { outcome, note, follow_up_date: followUp || undefined });
      remember(selectedLead.name || selectedLead.company || 'Lead', selectedLead.phone);
      showToast('Call logged to the CRM', 'success');
      resetCall();
      nextLead();
      summary.reload();
      cdr.reload();
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Could not log the call.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const leadIvrCalls = selectedLead ? (cdr.data ?? []).filter((c) => samePhone(c.phone, selectedLead.phone)).slice(0, 5) : [];

  // Total duration: working time today. Offline: time set to Offline, plus time since the working day
  // began (CRM "start day", or first time in the dialer) that the dialer wasn't open at all.
  const tracked = WORKING.reduce((n, s) => n + day.time[s], 0);
  const startedAt = summary.data?.session?.started_at;
  const dayStartMs = Math.min(day.firstSeen, startedAt ? Date.parse(/[zZ]|[+-]\d\d:\d\d$/.test(startedAt) ? startedAt : `${startedAt}Z`) || day.firstSeen : day.firstSeen);
  const offline = Math.max(day.time.OFFLINE, (Date.now() - dayStartMs) / 1000 - tracked);

  const nav: { id: TabType; label: string; icon: LucideIcon; badge?: number }[] = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'dialer', label: 'Dialer', icon: Phone },
    { id: 'callbacks', label: 'Callbacks', icon: Clock, badge: scheduled.due.length },
    { id: 'history', label: 'Call history', icon: History },
  ];

  const byOutcome = OUTCOMES.map(([id]) => [id, day.calls.filter((c) => c.outcome === id).length] as const).filter(([, n]) => n > 0);

  const statusControl = (
    <label className="flex items-center gap-2">
      <span className="sr-only">Your status</span>
      <select
        value={agentStatus}
        onChange={(e) => changeStatus(e.target.value as AgentStatus)}
        disabled={inCall || phase === 'wrap_up'}
        className="h-8 w-full rounded-md border border-border bg-surface px-2 text-[13px] font-medium text-text shadow-[var(--shadow-card)] focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/25 disabled:opacity-60"
      >
        {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
      </select>
    </label>
  );

  return (
    <NotificationsProvider>
      <div className="flex min-h-screen flex-col bg-bg text-text">
        <Header />
        <div className="flex flex-1">
          {/* Dialer navigation, in the CRM sidebar's style */}
          <aside className="sticky top-14 hidden h-[calc(100vh-3.5rem)] w-60 shrink-0 flex-col border-r border-border bg-surface md:flex">
            <div className="flex items-center gap-3 border-b border-border px-4 py-3.5">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-soft text-primary">
                <PhoneCall size={17} aria-hidden="true" />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold tracking-tight">Dialer</span>
                <span className="block truncate text-[11px] text-text-muted">IVR · {ivrUser.company?.code || ivrUser.name}</span>
              </span>
            </div>
            <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-3" aria-label="Dialer sections">
              {nav.map((n) => (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => setTab(n.id)}
                  aria-current={tab === n.id ? 'page' : undefined}
                  className={`flex h-8 w-full items-center justify-between rounded-md px-2.5 text-[13px] font-medium transition-colors ${
                    tab === n.id ? 'bg-primary-soft text-primary' : 'text-text-secondary hover:bg-neutral-bg hover:text-text'
                  }`}
                >
                  <span className="flex items-center gap-2.5"><n.icon size={16} aria-hidden="true" /> {n.label}</span>
                  {n.id === 'dialer' && inCall && <span className="h-2 w-2 animate-ping rounded-full bg-danger" />}
                  {!!n.badge && <span className="rounded-full bg-warning-bg px-1.5 text-[11px] font-semibold text-warning">{n.badge}</span>}
                </button>
              ))}
            </nav>
            <div className="space-y-2.5 border-t border-border p-3">
              <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-text-muted">
                <span>Your status</span>
                <span className="font-mono normal-case tracking-normal">{hms(statusSince)}</span>
              </div>
              {statusControl}
              <div className="flex items-center justify-between gap-2 pt-1">
                {ivrCalling ? <Badge tone="success" dot>Calls via IVR</Badge> : <Badge tone="warning">Phone mode</Badge>}
                <button
                  type="button"
                  onClick={signOut}
                  disabled={inCall}
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-text-muted hover:text-danger disabled:opacity-40"
                >
                  <LogOut size={13} aria-hidden="true" /> IVR sign out
                </button>
              </div>
            </div>
          </aside>

          <main id="main" className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8">
            <div className="mx-auto max-w-[1400px]">
              {/* Sections and status on small screens */}
              <div className="mb-4 space-y-2 md:hidden">
                <div className="flex gap-1 rounded-lg border border-border bg-surface p-1 text-xs">
                  {nav.map((n) => (
                    <button
                      key={n.id}
                      type="button"
                      onClick={() => setTab(n.id)}
                      className={`flex-1 rounded-md py-1.5 font-medium ${tab === n.id ? 'bg-primary-soft text-primary' : 'text-text-secondary'}`}
                    >
                      {n.label.split(' ')[0]}
                    </button>
                  ))}
                </div>
                {statusControl}
              </div>

              {summary.status === 'error' && !summary.data ? (
                <Card><ErrorState message={summary.error} onRetry={summary.reload} /></Card>
              ) : !summary.data ? (
                <StatGrid>{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-24" />)}</StatGrid>
              ) : tab === 'dashboard' ? (
                <>
                  <DashboardIntro
                    subtitle="Your calling performance today"
                    actions={
                      <Button onClick={() => (campaign && openLeads.length ? startCall(selectedLead ?? openLeads[0]) : setTab('dialer'))} disabled={inCall}>
                        <Play size={15} aria-hidden="true" /> Start dialing
                      </Button>
                    }
                  />

                  <StatGrid>
                    <StatCard icon={PhoneCall} tone="info" label="Calls today" value={number(me?.calls ?? 0)} hint="Logged in the CRM" />
                    <StatCard icon={CircleCheck} tone="success" label="Completed" value={number(me?.connected ?? 0)} hint={`${me?.interested ?? 0} interested · ${me?.converted ?? 0} converted`} />
                    <StatCard icon={Timer} tone="primary" label="Talk time" value={hms(day.time.ON_CALL)} hint="On call today" />
                    <StatCard icon={TrendingUp} tone="warning" label="Total duration" value={hms(tracked)} hint="Working time today" />
                  </StatGrid>

                  <div className="mt-6 grid gap-4 lg:grid-cols-3">
                    <Card className="flex flex-col lg:col-span-2">
                      <CardHeader title="Disposition breakdown" description="Outcomes you logged from the dialer today" />
                      {byOutcome.length === 0 ? (
                        <div className="flex flex-1 items-center justify-center">
                          <EmptyState icon={PhoneCall} title="No calls yet today" description="Outcomes appear here as you log calls." compact />
                        </div>
                      ) : (
                        <div className="space-y-3.5 p-4">
                          {byOutcome.map(([id, n]) => {
                            const pct = Math.round((n / day.calls.length) * 100);
                            return (
                              <div key={id}>
                                <div className="flex justify-between text-[13px]">
                                  <span className="font-medium">{OUTCOME_LABEL[id]}</span>
                                  <span className="text-text-muted tabular-nums">{n} · {pct}%</span>
                                </div>
                                <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-neutral-bg">
                                  <div className={`h-full rounded-full ${OUTCOME_BAR[id] ?? 'bg-text-muted/40'}`} style={{ width: `${pct}%` }} />
                                </div>
                              </div>
                            );
                          })}
                          <p className="pt-1 text-xs text-text-muted">{day.calls.length} calls logged from the dialer today</p>
                        </div>
                      )}
                    </Card>

                    <div className="space-y-4">
                      <Card>
                        <CardHeader
                          title="Your campaigns"
                          description="From your IVR account"
                          actions={
                            <>
                              {can('sales.hub.manage') && <Link to="/ivr" target="_blank" className="text-xs font-medium text-primary hover:underline">Open IVR</Link>}
                              <button type="button" onClick={campaigns.reload} aria-label="Refresh campaigns" className="rounded p-1 text-text-muted hover:bg-neutral-bg hover:text-text">
                                <RefreshCw size={13} className={campaigns.loading ? 'animate-spin' : ''} />
                              </button>
                            </>
                          }
                        />
                        {campaigns.status === 'error' ? (
                          <p className="px-4 py-6 text-center text-sm text-danger">{campaigns.error}</p>
                        ) : !campaigns.data ? (
                          <div className="p-4"><Skeleton className="h-16" /></div>
                        ) : campaigns.data.length === 0 ? (
                          <EmptyState icon={Radio} title="No campaigns assigned" compact />
                        ) : (
                          <ul className="divide-y divide-border">
                            {campaigns.data.slice(0, 5).map((c) => (
                              <li key={c.id || c.name} className="flex items-center justify-between gap-3 px-4 py-2.5 text-[13px]">
                                <span className="truncate font-medium">{c.name}</span>
                                <span className="flex shrink-0 items-center gap-2">
                                  {c.progress !== null && <span className="text-xs text-text-muted tabular-nums">{c.progress}%</span>}
                                  <Badge tone={c.statusKind === 'running' ? 'success' : c.statusKind === 'paused' ? 'warning' : 'neutral'} dot={c.statusKind === 'running'}>
                                    {c.status}
                                  </Badge>
                                </span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </Card>

                      <Card>
                        <CardHeader
                          title="Upcoming callbacks"
                          actions={<button type="button" onClick={() => setTab('callbacks')} className="text-xs font-medium text-primary hover:underline">View all</button>}
                        />
                        {callbacks.length === 0 ? (
                          <EmptyState icon={CalendarClock} title="No pending callbacks" compact />
                        ) : (
                          <ul className="divide-y divide-border">
                            {callbacks.slice(0, 4).map((cb) => (
                              <li key={cb.id} className="flex items-center justify-between gap-2 px-4 py-2.5">
                                <span className="min-w-0">
                                  <span className="block truncate text-[13px] font-medium">{cb.name || cb.company}</span>
                                  <span className="text-xs text-warning">{cb.follow_up_date ? date(cb.follow_up_date) : 'Today'}</span>
                                </span>
                                <Button size="sm" variant="secondary" onClick={() => pickLead(cb)} disabled={inCall}>
                                  <Phone size={12} aria-hidden="true" /> Call
                                </Button>
                              </li>
                            ))}
                          </ul>
                        )}
                      </Card>
                    </div>
                  </div>

                  <Card className="mt-4">
                    <CardHeader
                      title="Today's activity"
                      description="Time in each status today"
                      actions={<Badge tone={STATUS_TONE[agentStatus]} dot>{STATUS_LABEL[agentStatus]} · {hms(statusSince)}</Badge>}
                    />
                    <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-3 lg:grid-cols-5">
                      <Tile value={hms(day.time.AVAILABLE)} label="Available" className={STATUS_TILE.AVAILABLE} />
                      <Tile value={hms(day.time.ON_CALL)} label="On call" className={STATUS_TILE.ON_CALL} />
                      <Tile value={hms(day.time.WRAP_UP)} label="Wrap up" className={STATUS_TILE.WRAP_UP} />
                      <Tile value={`${day.breaks}× · ${hms(day.time.BREAK)}`} label="Breaks / away" className={STATUS_TILE.BREAK} />
                      <Tile value={hms(offline)} label="Offline" className={`col-span-2 sm:col-span-1 ${STATUS_TILE.OFFLINE}`} />
                    </div>
                  </Card>
                </>
              ) : tab === 'dialer' && !campaign ? (
                <CampaignPicker
                  campaigns={campaigns.data}
                  status={campaigns.status}
                  error={campaigns.error}
                  loading={campaigns.loading}
                  onReload={campaigns.reload}
                  openLeads={openLeads.length}
                  ivrCalling={ivrCalling}
                  onSelect={chooseCampaign}
                />
              ) : tab === 'dialer' ? (
                <>
                  <PageTitle
                    title="Dialer"
                    subtitle={openLeads.length ? `${openLeads.length} open leads in your queue` : 'No open leads: dial any number'}
                    actions={
                      <span className="flex items-center gap-2">
                        <Badge tone={campaign!.id === 'crm' ? 'primary' : 'info'}>Campaign: {campaign!.name}</Badge>
                        <Button size="sm" variant="secondary" onClick={() => chooseCampaign(null)} disabled={inCall || phase === 'wrap_up'}>
                          Change
                        </Button>
                      </span>
                    }
                  />
                  {!ivrCalling && !phoneNoticeHidden && (
                    <div className="mb-4 flex gap-2.5 rounded-lg border border-warning/30 bg-warning-bg p-3 text-[13px] text-text">
                      <TriangleAlert size={16} className="mt-0.5 shrink-0 text-warning" aria-hidden="true" />
                      <p className="flex-1">
                        Click-to-call is turned off for your IVR account, so <strong>Call</strong> opens the number in your phone app.
                        Calls are still logged to the CRM. Ask your IVR provider to enable click-to-call to dial through the IVR.
                      </p>
                      <button type="button" onClick={() => setPhoneNoticeHidden(true)} aria-label="Dismiss" className="text-text-muted hover:text-text">
                        <X size={14} />
                      </button>
                    </div>
                  )}

                  <div className="grid gap-4 lg:grid-cols-12">
                    {/* Number, keypad and call controls */}
                    <Card className="p-4 lg:col-span-5">
                      {ivrCalling && (dids.data?.length ?? 0) > 0 && (
                        <label className="mb-4 flex items-center justify-between gap-2 rounded-md bg-surface-secondary px-3 py-2 text-[13px]">
                          <span className="text-text-muted">Caller ID</span>
                          <select
                            value={callerDid}
                            onChange={(e) => setCallerDid(e.target.value)}
                            disabled={inCall}
                            className="bg-transparent text-right font-medium text-text focus:outline-none"
                          >
                            {dids.data!.map((d) => (
                              <option key={d.id} value={d.number}>{d.label ? `${d.number} · ${d.label}` : d.number}</option>
                            ))}
                          </select>
                        </label>
                      )}
                      {phase === 'idle' ? (
                        <>
                          <label htmlFor="dial-number" className="mb-1.5 block text-[13px] font-medium text-text-secondary">Phone number</label>
                          <div className="relative">
                            <input
                              id="dial-number"
                              type="tel"
                              value={inputPhone}
                              onChange={(e) => editNumber(e.target.value)}
                              placeholder="Enter a number or pick a lead"
                              className="h-12 w-full rounded-md border border-border bg-surface px-3 text-lg font-semibold tracking-wide text-text shadow-[var(--shadow-card)] focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/25"
                            />
                            {inputPhone && (
                              <button type="button" onClick={() => { setInputPhone(''); setSelectedLead(null); }} className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-text-muted hover:text-text">
                                Clear
                              </button>
                            )}
                          </div>
                          <div className="my-4 grid grid-cols-3 gap-2">
                            {['1', '2', '3', '4', '5', '6', '7', '8', '9', '+', '0', '#'].map((k) => (
                              <button
                                key={k}
                                type="button"
                                onClick={() => editNumber(inputPhone + k)}
                                className="h-12 rounded-md border border-border bg-surface text-lg font-semibold text-text transition hover:bg-neutral-bg active:scale-95"
                              >
                                {k}
                              </button>
                            ))}
                          </div>
                          <div className="flex gap-2">
                            <Button onClick={() => startCall()} disabled={!inputPhone.trim()} className="h-10 flex-1">
                              <Phone size={16} aria-hidden="true" /> Call
                            </Button>
                            <Button variant="secondary" onClick={nextLead} disabled={!openLeads.length} title="Skip to the next lead" aria-label="Skip to the next lead" className="h-10">
                              <SkipForward size={16} />
                            </Button>
                          </div>
                        </>
                      ) : (
                        <div className="flex flex-col items-center rounded-lg bg-surface-secondary p-6 text-center">
                          <span className={`mb-3 flex h-12 w-12 items-center justify-center rounded-full ${phase === 'wrap_up' ? 'bg-warning-bg text-warning' : 'bg-info-bg text-info'}`}>
                            {phase === 'wrap_up' ? <PhoneOff size={22} /> : <PhoneOutgoing size={22} className={phase === 'placing' ? 'animate-pulse' : ''} />}
                          </span>
                          <p className="text-xs font-semibold uppercase tracking-wider text-text-muted">
                            {phase === 'placing' ? 'Asking the IVR to connect…' : phase === 'on_call' ? (callVia === 'ivr' ? 'Call placed via IVR' : 'Calling from your phone') : 'Call ended: log the outcome'}
                          </p>
                          <p className="mt-1 text-base font-semibold">{selectedLead?.name || selectedLead?.company || inputPhone}</p>
                          <p className="text-[13px] text-text-muted">{selectedLead?.phone || inputPhone}</p>
                          <p className="mt-3 text-3xl font-semibold tracking-tight tabular-nums">{hms(callSeconds)}</p>
                          {phase === 'on_call' && (
                            <Button variant="danger" onClick={endCall} className="mt-5 h-10 w-full">
                              <PhoneOff size={16} aria-hidden="true" /> End call
                            </Button>
                          )}
                          {phase === 'wrap_up' && (
                            <button type="button" onClick={resetCall} className="mt-3 text-[13px] text-text-muted hover:text-text">
                              Discard without logging
                            </button>
                          )}
                        </div>
                      )}
                    </Card>

                    {/* Lead context, outcome and notes */}
                    <Card className="lg:col-span-7">
                      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
                        <div className="flex items-center gap-3">
                          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-neutral-bg text-text-muted"><User size={17} /></span>
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <h2 className="truncate text-sm font-semibold">{selectedLead?.name || selectedLead?.company || (inputPhone ? 'Direct number' : 'Pick a lead')}</h2>
                              {selectedLead && <StatusBadge status={selectedLead.status} />}
                            </div>
                            <p className="text-xs text-text-muted">
                              {[selectedLead?.company, selectedLead?.city, selectedLead?.service_interest].filter(Boolean).join(' · ') || 'Not a CRM lead'}
                            </p>
                          </div>
                        </div>
                        {openLeads.length > 0 && (
                          <div className="flex items-center gap-1.5 text-xs text-text-muted">
                            <span>{leadIndex >= 0 ? `Lead ${leadIndex + 1} of ${openLeads.length}` : `${openLeads.length} open leads`}</span>
                            {(['‹', '›'] as const).map((arrow, i) => (
                              <button
                                key={arrow}
                                type="button"
                                disabled={inCall || phase === 'wrap_up'}
                                aria-label={i ? 'Next lead' : 'Previous lead'}
                                onClick={() => {
                                  const next = openLeads[(Math.max(leadIndex, 0) + (i ? 1 : -1) + openLeads.length) % openLeads.length];
                                  setSelectedLead(next);
                                  setInputPhone(next.phone);
                                }}
                                className="flex h-7 w-7 items-center justify-center rounded-md border border-border hover:bg-neutral-bg disabled:opacity-40"
                              >
                                {arrow}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>

                      <div className="space-y-4 p-4">
                        {selectedLead && (
                          <div className="grid gap-2 text-[13px] sm:grid-cols-2">
                            <Field label="Phone">{selectedLead.phone || '—'}</Field>
                            <Field label="Email">{selectedLead.email || '—'}</Field>
                            {(selectedLead.last_note || selectedLead.notes) && (
                              <Field label="Previous notes" wide>{selectedLead.last_note || selectedLead.notes}</Field>
                            )}
                            <div className="rounded-md border border-border p-3 sm:col-span-2">
                              <span className="mb-1.5 block text-xs font-medium text-text-muted">IVR calls with this number</span>
                              {cdr.status === 'error' ? (
                                <span className="text-danger">{cdr.error}</span>
                              ) : !cdr.data ? (
                                <span className="text-text-muted">Loading…</span>
                              ) : leadIvrCalls.length === 0 ? (
                                <span className="text-text-muted">None in the IVR's call records.</span>
                              ) : (
                                <ul className="space-y-1">
                                  {leadIvrCalls.map((c) => (
                                    <li key={c.id} className="flex justify-between gap-3">
                                      <span className="text-text-secondary">{c.at ? cellText(c.at) : '—'}{c.campaign ? ` · ${c.campaign}` : ''}</span>
                                      <span className="font-medium">{c.status || '—'}{c.durationSeconds !== null ? ` · ${c.durationSeconds}s` : ''}</span>
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </div>
                          </div>
                        )}

                        <fieldset>
                          <legend className="mb-2 text-[13px] font-medium text-text-secondary">Call outcome</legend>
                          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                            {OUTCOMES.map(([id, label]) => (
                              <button
                                key={id}
                                type="button"
                                onClick={() => setOutcome(id)}
                                aria-pressed={outcome === id}
                                className={`h-9 rounded-md border px-3 text-[13px] font-medium transition-colors ${
                                  outcome === id ? 'border-primary bg-primary-soft text-primary' : 'border-border text-text-secondary hover:bg-neutral-bg hover:text-text'
                                }`}
                              >
                                {label}
                              </button>
                            ))}
                          </div>
                        </fieldset>
                        {(outcome === 'CALL_BACK' || outcome === 'INTERESTED') && (
                          <Input label="Follow-up date" type="date" min={todayISO()} value={followUp} onChange={(e) => setFollowUp(e.target.value)} />
                        )}
                        <Textarea label="Call notes" rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Requirement, objections, price discussed, next step…" />
                        <div className="flex items-center justify-end gap-2 border-t border-border pt-4">
                          <Button variant="ghost" onClick={() => { resetCall(); nextLead(); }} disabled={inCall}>
                            <SkipForward size={14} aria-hidden="true" /> Skip
                          </Button>
                          <Button onClick={saveAndNext} loading={saving} disabled={!outcome || inCall}>
                            <CircleCheck size={15} aria-hidden="true" /> {selectedLead ? 'Save & next lead' : 'Save'}
                          </Button>
                        </div>
                      </div>
                    </Card>
                  </div>
                </>
              ) : tab === 'callbacks' ? (
                <CallbacksView leads={leads} disabled={inCall || phase === 'wrap_up'} onCall={pickLead} />
              ) : (
                <CallHistoryView calls={cdr.data} status={cdr.status} error={cdr.error} loading={cdr.loading} onReload={cdr.reload} leads={leads} />
              )}
            </div>
          </main>
        </div>
      </div>
    </NotificationsProvider>
  );
}

function PageTitle({ title, subtitle, actions }: { title: string; subtitle: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight text-text">{title}</h1>
        <p className="mt-1 text-sm text-text-muted">{subtitle}</p>
      </div>
      {actions}
    </div>
  );
}

function Tile({ value, label, className }: { value: string; label: string; className: string }) {
  return (
    <div className={`rounded-lg p-3.5 ${className}`}>
      <p className="text-base font-semibold tracking-tight tabular-nums">{value}</p>
      <p className="mt-1 text-xs font-medium opacity-80">{label}</p>
    </div>
  );
}

function Field({ label, wide = false, children }: { label: string; wide?: boolean; children: ReactNode }) {
  return (
    <div className={`rounded-md bg-surface-secondary p-3 ${wide ? 'sm:col-span-2' : ''}`}>
      <span className="block text-xs text-text-muted">{label}</span>
      <span className={`block font-medium ${wide ? 'whitespace-pre-line' : 'truncate'}`}>{children}</span>
    </div>
  );
}
