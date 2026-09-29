import { useState, useEffect } from 'react';
import {
  ArrowUpRight, Award, CalendarClock, Check, CheckCircle2,
  Clock, Headphones, Mic, MicOff,
  Pause, Phone, PhoneCall, PhoneForwarded, PhoneMissed, PhoneOff,
  Play, Radio, SkipForward, User, X,
} from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { useToast } from '../components/common/ToastContext';
import { Button } from '../components/common/Button';
import { Badge, StatusBadge } from '../components/common/Badge';
import { Input, SearchInput, Textarea } from '../components/common/Input';
import { date, number, todayISO } from '../lib/format';
import {
  clock, logCall, OUTCOMES, type Lead, type ProgressRow, type SalesSummary,
} from './api';

type TabType = 'dashboard' | 'dialer' | 'callbacks' | 'history';
type AgentStatus = 'AVAILABLE' | 'ON_CALL' | 'WRAP_UP' | 'BREAK' | 'OFFLINE';

interface CallRecord {
  id: string;
  leadId?: string;
  leadName: string;
  company?: string;
  phone: string;
  outcome: string;
  durationSeconds: number;
  note: string;
  timestamp: string;
  followUpDate?: string;
}

interface ConnectDialerModalProps {
  summary: SalesSummary | null;
  initialLead?: Lead | null;
  onClose: () => void;
  onReloadSummary: () => void;
}

export function ConnectDialerModal({
  summary,
  initialLead = null,
  onClose,
  onReloadSummary,
}: ConnectDialerModalProps) {
  const { user } = useAuth();
  const { showToast } = useToast();

  const [activeTab, setActiveTab] = useState<TabType>(initialLead ? 'dialer' : 'dashboard');
  const [agentStatus, setAgentStatus] = useState<AgentStatus>('AVAILABLE');
  const [micMuted, setMicMuted] = useState(false);
  const [statusTimer, setStatusTimer] = useState(0);

  // Status duration counters (in seconds)
  const [durations, setDurations] = useState<{ [key in AgentStatus]: number }>({
    AVAILABLE: 4036, // ~01:07:16 start for realistic display or live
    ON_CALL: 0,
    WRAP_UP: 0,
    BREAK: 0,
    OFFLINE: 9087, // ~02:31:27
  });

  // Call state
  const [activeCall, setActiveCall] = useState<boolean>(false);
  const [callRinging, setCallRinging] = useState<boolean>(false);
  const [callDuration, setCallDuration] = useState<number>(0);
  const [callMuted, setCallMuted] = useState<boolean>(false);
  const [callOnHold, setCallOnHold] = useState<boolean>(false);
  const [inputPhone, setInputPhone] = useState<string>(initialLead?.phone ?? '');
  const [selectedLead, setSelectedLead] = useState<Lead | null>(initialLead);
  const [leadIndex, setLeadIndex] = useState<number>(0);

  // Outcome / Log state
  const [selectedOutcome, setSelectedOutcome] = useState<string>('');
  const [callNote, setCallNote] = useState<string>('');
  const [followUpDate, setFollowUpDate] = useState<string>('');
  const [savingCall, setSavingCall] = useState<boolean>(false);

  // Local call history session
  const [history, setHistory] = useState<CallRecord[]>([]);

  // Search & Filters in Callbacks & History
  const [searchFilter, setSearchFilter] = useState('');

  const leads = summary?.leads ?? [];
  const openLeads = leads.filter((l) => ['NEW', 'ATTEMPTED', 'CALL_BACK', 'INTERESTED'].includes(l.status));
  const callbacks = leads.filter((l) => l.status === 'CALL_BACK' || (l.follow_up_date && l.follow_up_date <= todayISO()));

  // Active user progress
  const myProgress: ProgressRow | undefined = summary?.progress.find(
    (p) => p.user_id === summary?.me?.user_id
  );

  const callsTodayCount = (myProgress?.calls ?? 0) + history.length;
  const completedCount = (myProgress?.connected ?? 0) + history.filter((h) => ['INTERESTED', 'CONVERTED', 'CALL_BACK'].includes(h.outcome)).length;
  const totalTalkSeconds = durations.ON_CALL + (myProgress?.hours_today ? Math.round(myProgress.hours_today * 3600 * 0.4) : 0);

  // Ticking timers
  useEffect(() => {
    const timer = setInterval(() => {
      setStatusTimer((s) => s + 1);
      setDurations((prev) => ({
        ...prev,
        [agentStatus]: prev[agentStatus] + 1,
      }));

      if (activeCall && !callOnHold) {
        setCallDuration((cd) => cd + 1);
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [agentStatus, activeCall, callOnHold]);

  // Set initial lead if provided
  useEffect(() => {
    if (initialLead) {
      setSelectedLead(initialLead);
      setInputPhone(initialLead.phone);
      const idx = openLeads.findIndex((l) => l.id === initialLead.id);
      if (idx !== -1) setLeadIndex(idx);
    } else if (openLeads.length > 0 && !selectedLead) {
      setSelectedLead(openLeads[0]);
      setInputPhone(openLeads[0].phone);
      setLeadIndex(0);
    }
  }, [initialLead, openLeads.length]);

  const formatHMS = (totalSeconds: number) => {
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  const handleStatusChange = (newStatus: AgentStatus) => {
    setAgentStatus(newStatus);
    setStatusTimer(0);
    showToast(`Status changed to ${newStatus.replace('_', ' ')}`, 'info');
  };

  // Dialpad Actions
  const handleKeypadPress = (val: string) => {
    setInputPhone((p) => p + val);
  };

  const handleStartCall = (targetLead?: Lead | null, customNumber?: string) => {
    const leadToCall = targetLead !== undefined ? targetLead : selectedLead;
    const phoneToCall = customNumber || leadToCall?.phone || inputPhone;

    if (!phoneToCall) {
      showToast('Please enter a phone number or select a lead to call', 'error');
      return;
    }

    if (leadToCall) {
      setSelectedLead(leadToCall);
      setInputPhone(leadToCall.phone);
    }

    setCallRinging(true);
    setAgentStatus('ON_CALL');
    setSelectedOutcome('');
    setCallNote('');
    setFollowUpDate('');

    // Simulate ringing connect after 1.5s
    setTimeout(() => {
      setCallRinging(false);
      setActiveCall(true);
      setCallDuration(0);
      showToast(`Connected to ${leadToCall?.name || phoneToCall}`, 'success');
    }, 1500);
  };

  const handleEndCall = () => {
    setActiveCall(false);
    setCallRinging(false);
    setAgentStatus('WRAP_UP');
    showToast('Call ended. Select disposition & log call notes.', 'info');
  };

  const handleSaveAndNext = async (skip = false) => {
    if (!skip && !selectedOutcome) {
      showToast('Please select a disposition outcome for the call', 'error');
      return;
    }

    if (selectedLead && !skip) {
      setSavingCall(true);
      try {
        await logCall(selectedLead.id, {
          outcome: selectedOutcome,
          note: callNote,
          follow_up_date: followUpDate || undefined,
        });

        // Add to local history
        const rec: CallRecord = {
          id: String(Date.now()),
          leadId: selectedLead.id,
          leadName: selectedLead.name || selectedLead.company || 'Unknown Lead',
          company: selectedLead.company,
          phone: selectedLead.phone,
          outcome: selectedOutcome,
          durationSeconds: callDuration || 14,
          note: callNote,
          timestamp: new Date().toISOString(),
          followUpDate: followUpDate || undefined,
        };
        setHistory((prev) => [rec, ...prev]);

        showToast('Call logged successfully', 'success');
        onReloadSummary();
      } catch (err) {
        showToast(err instanceof Error ? err.message : 'Could not log call', 'error');
      } finally {
        setSavingCall(false);
      }
    }

    // Reset call state
    setActiveCall(false);
    setCallDuration(0);
    setSelectedOutcome('');
    setCallNote('');
    setFollowUpDate('');
    setAgentStatus('AVAILABLE');

    // Advance to next lead in queue
    if (openLeads.length > 0) {
      const nextIdx = (leadIndex + 1) % openLeads.length;
      setLeadIndex(nextIdx);
      const nextLead = openLeads[nextIdx];
      setSelectedLead(nextLead);
      setInputPhone(nextLead.phone);
    }
  };

  const handleSelectLeadToDial = (l: Lead, idx?: number) => {
    setSelectedLead(l);
    setInputPhone(l.phone);
    if (typeof idx === 'number') setLeadIndex(idx);
    setActiveTab('dialer');
  };

  const agentName = summary?.me?.name || user?.username || 'Agent';

  // Calculate disposition breakdown
  const outcomeCounts: Record<string, number> = {
    INTERESTED: (myProgress?.interested ?? 0) + history.filter((h) => h.outcome === 'INTERESTED').length,
    CONVERTED: (myProgress?.converted ?? 0) + history.filter((h) => h.outcome === 'CONVERTED').length,
    CALL_BACK: history.filter((h) => h.outcome === 'CALL_BACK').length,
    ATTEMPTED: history.filter((h) => h.outcome === 'ATTEMPTED' || h.outcome === 'NO_ANSWER' || h.outcome === 'BUSY').length,
    NOT_INTERESTED: history.filter((h) => h.outcome === 'NOT_INTERESTED').length,
    INVALID: history.filter((h) => h.outcome === 'WRONG_NUMBER' || h.outcome === 'INVALID').length,
  };
  const totalLogged = Object.values(outcomeCounts).reduce((a, b) => a + b, 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-2 sm:p-4 animate-fade-in">
      <div className="relative flex h-full max-h-[92vh] w-full max-w-7xl flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl">
        {/* Top Header Bar */}
        <header className="flex shrink-0 items-center justify-between border-b border-border bg-surface px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-white shadow-xs">
              <Headphones size={19} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-base font-bold tracking-tight text-text">Rexera Connect</span>
                <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary uppercase">Dialer v2.5</span>
              </div>
              <p className="text-xs text-text-muted">Cloud Auto-Dialer & Telephony Suite</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 sm:gap-4">
            {/* SIP Status Badge */}
            <div className="flex items-center gap-1.5 rounded-full border border-success/30 bg-success/10 px-3 py-1 text-xs font-medium text-success">
              <span className="h-2 w-2 rounded-full bg-success animate-pulse" />
              <span>SIP: Ready</span>
            </div>

            {/* Agent State Dropdown Selector */}
            <div className="flex items-center gap-2 rounded-lg border border-border bg-surface-secondary px-2.5 py-1">
              <div
                className={`h-2.5 w-2.5 rounded-full ${
                  agentStatus === 'AVAILABLE'
                    ? 'bg-success'
                    : agentStatus === 'ON_CALL'
                    ? 'bg-info animate-pulse'
                    : agentStatus === 'WRAP_UP'
                    ? 'bg-warning'
                    : agentStatus === 'BREAK'
                    ? 'bg-amber-500'
                    : 'bg-neutral-400'
                }`}
              />
              <select
                aria-label="Agent status"
                value={agentStatus}
                onChange={(e) => handleStatusChange(e.target.value as AgentStatus)}
                className="bg-transparent text-xs font-semibold text-text focus:outline-hidden cursor-pointer"
              >
                <option value="AVAILABLE">Available</option>
                <option value="ON_CALL">On Call</option>
                <option value="WRAP_UP">Wrap Up</option>
                <option value="BREAK">Break / Away</option>
                <option value="OFFLINE">Offline</option>
              </select>
              <span className="text-[11px] font-mono font-medium text-text-muted pl-1 border-l border-border">
                {formatHMS(statusTimer)}
              </span>
            </div>

            {/* Mic Toggle Button */}
            <button
              onClick={() => {
                setMicMuted(!micMuted);
                showToast(micMuted ? 'Microphone enabled' : 'Microphone muted', 'info');
              }}
              title={micMuted ? 'Unmute microphone' : 'Mute microphone'}
              className={`flex h-8 w-8 items-center justify-center rounded-lg border transition-colors ${
                micMuted
                  ? 'border-danger/30 bg-danger/10 text-danger'
                  : 'border-border bg-surface hover:bg-neutral-bg text-text-secondary'
              }`}
            >
              {micMuted ? <MicOff size={15} /> : <Mic size={15} />}
            </button>

            {/* Close Modal Button */}
            <button
              onClick={onClose}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-border text-text-muted hover:bg-neutral-bg hover:text-text transition-colors"
              title="Exit Dialer"
            >
              <X size={16} />
            </button>
          </div>
        </header>

        {/* Main Body with Sidebar + Content */}
        <div className="flex flex-1 overflow-hidden">
          {/* Left Navigation Sidebar */}
          <aside className="flex w-52 shrink-0 flex-col justify-between border-r border-border bg-surface p-3 max-sm:hidden">
            <nav className="space-y-1">
              <button
                onClick={() => setActiveTab('dashboard')}
                className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-xs font-semibold transition-colors ${
                  activeTab === 'dashboard'
                    ? 'bg-primary-soft text-primary shadow-xs'
                    : 'text-text-secondary hover:bg-neutral-bg hover:text-text'
                }`}
              >
                <Award size={16} />
                <span>Dashboard</span>
              </button>

              <button
                onClick={() => setActiveTab('dialer')}
                className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-xs font-semibold transition-colors ${
                  activeTab === 'dialer'
                    ? 'bg-primary-soft text-primary shadow-xs'
                    : 'text-text-secondary hover:bg-neutral-bg hover:text-text'
                }`}
              >
                <span className="flex items-center gap-2.5">
                  <PhoneCall size={16} />
                  <span>Dialer</span>
                </span>
                {activeCall && <span className="h-2 w-2 rounded-full bg-danger animate-ping" />}
              </button>

              <button
                onClick={() => setActiveTab('callbacks')}
                className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-xs font-semibold transition-colors ${
                  activeTab === 'callbacks'
                    ? 'bg-primary-soft text-primary shadow-xs'
                    : 'text-text-secondary hover:bg-neutral-bg hover:text-text'
                }`}
              >
                <span className="flex items-center gap-2.5">
                  <CalendarClock size={16} />
                  <span>Callbacks</span>
                </span>
                {callbacks.length > 0 && (
                  <span className="rounded-full bg-warning/20 px-1.5 py-0.2 text-[10px] font-bold text-warning">
                    {callbacks.length}
                  </span>
                )}
              </button>

              <button
                onClick={() => setActiveTab('history')}
                className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-xs font-semibold transition-colors ${
                  activeTab === 'history'
                    ? 'bg-primary-soft text-primary shadow-xs'
                    : 'text-text-secondary hover:bg-neutral-bg hover:text-text'
                }`}
              >
                <Clock size={16} />
                <span>Call History</span>
              </button>
            </nav>

            {/* Agent Info Pill */}
            <div className="rounded-xl border border-border bg-surface-secondary p-2.5">
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-500 font-bold text-white text-xs">
                  {agentName.charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-semibold text-text uppercase tracking-tight">{agentName}</p>
                  <p className="text-[10px] text-text-muted">Agent · Online</p>
                </div>
              </div>
              <button
                onClick={onClose}
                className="mt-2.5 flex w-full items-center justify-center gap-1.5 text-[11px] font-medium text-text-muted hover:text-danger transition-colors pt-1 border-t border-border"
              >
                <PhoneOff size={12} /> Exit Dialer
              </button>
            </div>
          </aside>

          {/* Main Scrollable Content */}
          <main className="flex-1 overflow-y-auto bg-surface-secondary/50 p-4 sm:p-6">
            {/* Mobile Tab Pill Selector */}
            <div className="mb-4 flex sm:hidden gap-1 rounded-lg border border-border bg-surface p-1 text-xs">
              <button
                onClick={() => setActiveTab('dashboard')}
                className={`flex-1 rounded-md py-1.5 font-medium ${activeTab === 'dashboard' ? 'bg-primary text-white' : 'text-text-secondary'}`}
              >
                Dashboard
              </button>
              <button
                onClick={() => setActiveTab('dialer')}
                className={`flex-1 rounded-md py-1.5 font-medium ${activeTab === 'dialer' ? 'bg-primary text-white' : 'text-text-secondary'}`}
              >
                Dialer
              </button>
              <button
                onClick={() => setActiveTab('callbacks')}
                className={`flex-1 rounded-md py-1.5 font-medium ${activeTab === 'callbacks' ? 'bg-primary text-white' : 'text-text-secondary'}`}
              >
                Callbacks ({callbacks.length})
              </button>
              <button
                onClick={() => setActiveTab('history')}
                className={`flex-1 rounded-md py-1.5 font-medium ${activeTab === 'history' ? 'bg-primary text-white' : 'text-text-secondary'}`}
              >
                History
              </button>
            </div>

            {/* TAB 1: DASHBOARD (Matching Reference Image) */}
            {activeTab === 'dashboard' && (
              <div className="space-y-6">
                {/* Greeting & Start Dialing Header */}
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-text">
                      Welcome back, <span className="uppercase text-primary">{agentName}</span>!
                    </h1>
                    <p className="mt-0.5 text-xs sm:text-sm text-text-secondary">
                      Here's your performance summary for today
                    </p>
                  </div>

                  <Button
                    onClick={() => {
                      setActiveTab('dialer');
                      if (!activeCall && openLeads.length > 0) {
                        handleStartCall(selectedLead || openLeads[0]);
                      }
                    }}
                    className="bg-amber-500 hover:bg-amber-600 text-white font-semibold shadow-md flex items-center gap-2 px-5 py-2.5"
                  >
                    <Play size={16} className="fill-white" />
                    <span>Start Dialing</span>
                  </Button>
                </div>

                {/* 4 KPI Cards (Matching Image) */}
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  {/* Calls Today */}
                  <div className="flex items-center justify-between rounded-xl border border-border bg-surface p-4 shadow-xs">
                    <div>
                      <p className="text-xs font-semibold text-text-muted">Calls Today</p>
                      <p className="mt-1 text-2xl font-extrabold tracking-tight text-text">{number(callsTodayCount)}</p>
                    </div>
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-500/10 text-blue-600">
                      <PhoneCall size={20} />
                    </div>
                  </div>

                  {/* Completed */}
                  <div className="flex items-center justify-between rounded-xl border border-border bg-surface p-4 shadow-xs">
                    <div>
                      <p className="text-xs font-semibold text-text-muted">Completed</p>
                      <p className="mt-1 text-2xl font-extrabold tracking-tight text-text">{number(completedCount)}</p>
                    </div>
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600">
                      <CheckCircle2 size={20} />
                    </div>
                  </div>

                  {/* Talk Time */}
                  <div className="flex items-center justify-between rounded-xl border border-border bg-surface p-4 shadow-xs">
                    <div>
                      <p className="text-xs font-semibold text-text-muted">Talk Time</p>
                      <p className="mt-1 text-2xl font-extrabold font-mono tracking-tight text-text">{formatHMS(totalTalkSeconds)}</p>
                    </div>
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-purple-500/10 text-purple-600">
                      <Clock size={20} />
                    </div>
                  </div>

                  {/* Total Duration */}
                  <div className="flex items-center justify-between rounded-xl border border-border bg-surface p-4 shadow-xs">
                    <div>
                      <p className="text-xs font-semibold text-text-muted">Total Duration</p>
                      <p className="mt-1 text-2xl font-extrabold font-mono tracking-tight text-text">
                        {formatHMS(durations.AVAILABLE + durations.ON_CALL + durations.WRAP_UP)}
                      </p>
                    </div>
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500/10 text-amber-600">
                      <ArrowUpRight size={20} />
                    </div>
                  </div>
                </div>

                {/* Middle Row: Disposition Breakdown & Campaigns / Callbacks */}
                <div className="grid gap-6 lg:grid-cols-3">
                  {/* Left (2 cols): Disposition Breakdown */}
                  <div className="lg:col-span-2 rounded-xl border border-border bg-surface p-5 shadow-xs flex flex-col justify-between">
                    <div>
                      <h3 className="text-sm font-bold text-text">Disposition Breakdown</h3>
                      <p className="mt-0.5 text-xs text-text-muted">Outcomes of client interactions recorded today</p>
                    </div>

                    {totalLogged === 0 ? (
                      <div className="my-10 flex flex-col items-center justify-center text-center">
                        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-neutral-bg text-text-muted mb-2">
                          <PhoneMissed size={20} />
                        </div>
                        <p className="text-sm font-medium text-text-secondary">No calls yet today</p>
                        <p className="text-xs text-text-muted mt-1">Start dialing to log call outcomes and dispositions</p>
                      </div>
                    ) : (
                      <div className="my-4 space-y-3">
                        {Object.entries(outcomeCounts).map(([k, cnt]) => {
                          const pct = totalLogged > 0 ? Math.round((cnt / totalLogged) * 100) : 0;
                          return (
                            <div key={k} className="space-y-1">
                              <div className="flex justify-between text-xs">
                                <span className="font-medium text-text">{k.replace('_', ' ')}</span>
                                <span className="text-text-muted">{cnt} ({pct}%)</span>
                              </div>
                              <div className="h-2 w-full overflow-hidden rounded-full bg-neutral-bg">
                                <div
                                  className={`h-full rounded-full transition-all ${
                                    k === 'CONVERTED'
                                      ? 'bg-success'
                                      : k === 'INTERESTED'
                                      ? 'bg-info'
                                      : k === 'CALL_BACK'
                                      ? 'bg-warning'
                                      : 'bg-neutral-400'
                                  }`}
                                  style={{ width: `${pct}%` }}
                                />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    <div className="flex items-center justify-between pt-3 border-t border-border text-xs text-text-muted">
                      <span>Total logged calls: <strong className="text-text">{totalLogged}</strong></span>
                      <button
                        onClick={() => setActiveTab('dialer')}
                        className="text-primary hover:underline font-medium"
                      >
                        Open dialer console →
                      </button>
                    </div>
                  </div>

                  {/* Right (1 col): Campaigns & Callbacks */}
                  <div className="space-y-4">
                    {/* Your Campaigns */}
                    <div className="rounded-xl border border-border bg-surface p-4 shadow-xs">
                      <h3 className="text-xs font-bold text-text uppercase tracking-wider">Your Campaigns</h3>
                      <div className="mt-3 space-y-2">
                        <div className="rounded-lg border border-border bg-surface-secondary/50 p-2.5">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-semibold text-text">Direct CRM Pipeline</span>
                            <Badge tone="success" dot>Active</Badge>
                          </div>
                          <p className="mt-1 text-[11px] text-text-muted">
                            {openLeads.length} open leads · {leads.length} assigned
                          </p>
                        </div>
                        <div className="rounded-lg border border-border bg-surface-secondary/50 p-2.5">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-semibold text-text">Legal & GST Inquiries</span>
                            <Badge tone="info">Priority</Badge>
                          </div>
                          <p className="mt-1 text-[11px] text-text-muted">Inbound lead pool</p>
                        </div>
                      </div>
                    </div>

                    {/* Upcoming Callbacks */}
                    <div className="rounded-xl border border-border bg-surface p-4 shadow-xs">
                      <div className="flex items-center justify-between">
                        <h3 className="text-xs font-bold text-text uppercase tracking-wider">Upcoming Callbacks</h3>
                        <button
                          onClick={() => setActiveTab('callbacks')}
                          className="text-[11px] font-medium text-primary hover:underline"
                        >
                          View all
                        </button>
                      </div>

                      {callbacks.length === 0 ? (
                        <div className="py-6 text-center">
                          <p className="text-xs text-text-muted">No pending callbacks</p>
                        </div>
                      ) : (
                        <ul className="mt-2 divide-y divide-border">
                          {callbacks.slice(0, 3).map((cb) => (
                            <li key={cb.id} className="py-2 flex items-center justify-between gap-2">
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-xs font-semibold text-text">{cb.name || cb.company}</p>
                                <p className="text-[10px] text-warning flex items-center gap-1">
                                  <CalendarClock size={11} /> {cb.follow_up_date ? date(cb.follow_up_date) : 'Today'}
                                </p>
                              </div>
                              <Button
                                size="sm"
                                variant="secondary"
                                onClick={() => handleSelectLeadToDial(cb)}
                                className="h-7 px-2 text-[11px]"
                              >
                                <Phone size={11} /> Call
                              </Button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                </div>

                {/* Bottom Section: Today's Activity (Matching Image) */}
                <div className="rounded-xl border border-border bg-surface p-5 shadow-xs">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <Radio size={15} className="text-primary animate-pulse" />
                      <h3 className="text-sm font-bold text-text">Today's Activity</h3>
                    </div>
                    <div className="flex items-center gap-1.5 text-xs text-text-muted">
                      <span className="h-2 w-2 rounded-full bg-neutral-400" />
                      <span>{agentStatus}: {formatHMS(statusTimer)}</span>
                    </div>
                  </div>

                  <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-5">
                    {/* Available */}
                    <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-3.5">
                      <p className="text-sm sm:text-base font-extrabold font-mono text-emerald-700 dark:text-emerald-400">
                        {formatHMS(durations.AVAILABLE)}
                      </p>
                      <p className="mt-1 text-xs font-semibold text-emerald-800 dark:text-emerald-300">Available</p>
                    </div>

                    {/* On Call */}
                    <div className="rounded-xl border border-blue-500/20 bg-blue-500/10 p-3.5">
                      <p className="text-sm sm:text-base font-extrabold font-mono text-blue-700 dark:text-blue-400">
                        {formatHMS(durations.ON_CALL)}
                      </p>
                      <p className="mt-1 text-xs font-semibold text-blue-800 dark:text-blue-300">On Call</p>
                    </div>

                    {/* Wrap Up */}
                    <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-3.5">
                      <p className="text-sm sm:text-base font-extrabold font-mono text-amber-700 dark:text-amber-400">
                        {formatHMS(durations.WRAP_UP)}
                      </p>
                      <p className="mt-1 text-xs font-semibold text-amber-800 dark:text-amber-300">Wrap Up</p>
                    </div>

                    {/* Breaks / Away */}
                    <div className="rounded-xl border border-orange-500/20 bg-orange-500/10 p-3.5">
                      <p className="text-sm sm:text-base font-extrabold font-mono text-orange-700 dark:text-orange-400">
                        0x · {formatHMS(durations.BREAK)}
                      </p>
                      <p className="mt-1 text-xs font-semibold text-orange-800 dark:text-orange-300">Breaks / Away</p>
                    </div>

                    {/* Offline */}
                    <div className="rounded-xl border border-neutral-300 dark:border-neutral-700 bg-neutral-100 dark:bg-neutral-800/60 p-3.5 col-span-2 sm:col-span-1">
                      <p className="text-sm sm:text-base font-extrabold font-mono text-text-secondary">
                        {formatHMS(durations.OFFLINE)}
                      </p>
                      <p className="mt-1 text-xs font-semibold text-text-muted">Offline</p>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* TAB 2: DIALER CONSOLE */}
            {activeTab === 'dialer' && (
              <div className="grid gap-6 lg:grid-cols-12">
                {/* Left Col (Dialpad & Call Controls) */}
                <div className="lg:col-span-5 space-y-4">
                  {/* Calling Display */}
                  <div className="rounded-2xl border border-border bg-surface p-5 shadow-xs">
                    {/* Active call header banner */}
                    {activeCall || callRinging ? (
                      <div className="mb-4 flex flex-col items-center justify-center rounded-xl bg-primary/10 border border-primary/20 p-4 text-center animate-pulse">
                        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary text-white mb-2 shadow-md">
                          <PhoneCall size={22} className="animate-bounce" />
                        </div>
                        <p className="text-xs font-semibold text-primary uppercase tracking-wider">
                          {callRinging ? 'Ringing...' : 'Call in progress'}
                        </p>
                        <p className="text-base font-bold text-text mt-0.5">
                          {selectedLead?.name || inputPhone}
                        </p>
                        {selectedLead?.company && (
                          <p className="text-xs text-text-muted">{selectedLead.company}</p>
                        )}
                        <p className="mt-2 font-mono text-xl font-extrabold text-primary">
                          {formatHMS(callDuration)}
                        </p>
                      </div>
                    ) : (
                      <div className="mb-4">
                        <label className="block text-xs font-semibold text-text-muted uppercase mb-1">Phone Number</label>
                        <div className="relative">
                          <input
                            type="tel"
                            value={inputPhone}
                            onChange={(e) => setInputPhone(e.target.value)}
                            placeholder="Enter number or pick lead..."
                            className="w-full rounded-xl border border-border bg-surface-secondary px-4 py-3 text-lg font-mono font-bold text-text tracking-wide focus:border-primary focus:outline-hidden"
                          />
                          {inputPhone && (
                            <button
                              onClick={() => setInputPhone('')}
                              className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-text-muted hover:text-text"
                            >
                              Clear
                            </button>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Dialpad Buttons */}
                    <div className="grid grid-cols-3 gap-2.5 my-3">
                      {[
                        { num: '1', sub: ' ' },
                        { num: '2', sub: 'ABC' },
                        { num: '3', sub: 'DEF' },
                        { num: '4', sub: 'GHI' },
                        { num: '5', sub: 'JKL' },
                        { num: '6', sub: 'MNO' },
                        { num: '7', sub: 'PQRS' },
                        { num: '8', sub: 'TUV' },
                        { num: '9', sub: 'WXYZ' },
                        { num: '*', sub: ' ' },
                        { num: '0', sub: '+' },
                        { num: '#', sub: ' ' },
                      ].map(({ num, sub }) => (
                        <button
                          key={num}
                          type="button"
                          onClick={() => handleKeypadPress(num)}
                          className="flex flex-col items-center justify-center rounded-xl border border-border bg-surface-secondary/60 py-2.5 hover:bg-neutral-bg active:scale-95 transition-all text-text shadow-2xs"
                        >
                          <span className="text-lg font-bold leading-none">{num}</span>
                          <span className="text-[9px] font-semibold text-text-muted mt-0.5">{sub}</span>
                        </button>
                      ))}
                    </div>

                    {/* In-Call Actions or Start Call Button */}
                    {activeCall || callRinging ? (
                      <div className="space-y-3 mt-4">
                        <div className="grid grid-cols-3 gap-2">
                          <button
                            type="button"
                            onClick={() => setCallMuted(!callMuted)}
                            className={`flex flex-col items-center justify-center rounded-xl border p-2 text-xs font-semibold ${
                              callMuted ? 'border-danger bg-danger/10 text-danger' : 'border-border bg-surface-secondary text-text'
                            }`}
                          >
                            {callMuted ? <MicOff size={16} /> : <Mic size={16} />}
                            <span className="mt-1">{callMuted ? 'Muted' : 'Mute'}</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => setCallOnHold(!callOnHold)}
                            className={`flex flex-col items-center justify-center rounded-xl border p-2 text-xs font-semibold ${
                              callOnHold ? 'border-amber-500 bg-amber-500/10 text-amber-600' : 'border-border bg-surface-secondary text-text'
                            }`}
                          >
                            <Pause size={16} />
                            <span className="mt-1">{callOnHold ? 'On Hold' : 'Hold'}</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => showToast('Call transfer options ready', 'info')}
                            className="flex flex-col items-center justify-center rounded-xl border border-border bg-surface-secondary p-2 text-xs font-semibold text-text"
                          >
                            <PhoneForwarded size={16} />
                            <span className="mt-1">Transfer</span>
                          </button>
                        </div>

                        <Button
                          variant="danger"
                          onClick={handleEndCall}
                          className="w-full py-3 text-sm font-bold flex items-center justify-center gap-2 shadow-lg"
                        >
                          <PhoneOff size={18} />
                          <span>End Call</span>
                        </Button>
                      </div>
                    ) : (
                      <div className="mt-4 flex gap-2">
                        <Button
                          onClick={() => handleStartCall()}
                          disabled={!inputPhone}
                          className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-3 text-sm flex items-center justify-center gap-2 shadow-md"
                        >
                          <Phone size={18} />
                          <span>Call Number</span>
                        </Button>
                        <Button
                          variant="secondary"
                          onClick={() => handleSaveAndNext(true)}
                          title="Skip to next lead"
                        >
                          <SkipForward size={18} />
                        </Button>
                      </div>
                    )}
                  </div>
                </div>

                {/* Right Col (Lead Details, Dispositions & Notes) */}
                <div className="lg:col-span-7 space-y-4">
                  {/* Lead Context Header */}
                  <div className="rounded-2xl border border-border bg-surface p-5 shadow-xs">
                    <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-border">
                      <div className="flex items-center gap-2">
                        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary font-bold">
                          <User size={18} />
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <h2 className="text-base font-bold text-text">
                              {selectedLead?.name || selectedLead?.company || 'Select or add a lead'}
                            </h2>
                            {selectedLead && <StatusBadge status={selectedLead.status} />}
                          </div>
                          <p className="text-xs text-text-muted">
                            {[selectedLead?.company, selectedLead?.city, selectedLead?.service_interest].filter(Boolean).join(' · ') || 'Direct Dialing'}
                          </p>
                        </div>
                      </div>

                      {openLeads.length > 0 && (
                        <div className="flex items-center gap-1.5 text-xs text-text-muted">
                          <span>Lead {leadIndex + 1} of {openLeads.length}</span>
                          <button
                            onClick={() => {
                              const prev = (leadIndex - 1 + openLeads.length) % openLeads.length;
                              setLeadIndex(prev);
                              setSelectedLead(openLeads[prev]);
                              setInputPhone(openLeads[prev].phone);
                            }}
                            className="h-6 w-6 rounded border border-border flex items-center justify-center hover:bg-neutral-bg"
                          >
                            ‹
                          </button>
                          <button
                            onClick={() => {
                              const nxt = (leadIndex + 1) % openLeads.length;
                              setLeadIndex(nxt);
                              setSelectedLead(openLeads[nxt]);
                              setInputPhone(openLeads[nxt].phone);
                            }}
                            className="h-6 w-6 rounded border border-border flex items-center justify-center hover:bg-neutral-bg"
                          >
                            ›
                          </button>
                        </div>
                      )}
                    </div>

                    {/* Quick Lead Meta */}
                    {selectedLead && (
                      <div className="mt-3 grid gap-2 sm:grid-cols-2 text-xs">
                        <div className="rounded-lg bg-surface-secondary p-2.5">
                          <span className="text-text-muted block">Phone</span>
                          <span className="font-semibold text-text font-mono">{selectedLead.phone || '—'}</span>
                        </div>
                        <div className="rounded-lg bg-surface-secondary p-2.5">
                          <span className="text-text-muted block">Email</span>
                          <span className="font-semibold text-text truncate block">{selectedLead.email || '—'}</span>
                        </div>
                        {selectedLead.notes && (
                          <div className="sm:col-span-2 rounded-lg bg-surface-secondary p-2.5 text-text-secondary">
                            <span className="text-text-muted block font-semibold mb-0.5">Previous Notes:</span>
                            {selectedLead.notes}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Outcome / Disposition Section */}
                    <div className="mt-5 space-y-4">
                      <div>
                        <label className="block text-xs font-bold uppercase tracking-wider text-text mb-2">
                          Call Disposition / Outcome *
                        </label>
                        <div className="grid gap-2 grid-cols-2 sm:grid-cols-3">
                          {OUTCOMES.map(([id, label]) => (
                            <button
                              key={id}
                              type="button"
                              onClick={() => setSelectedOutcome(id)}
                              className={`flex items-center justify-center rounded-xl border px-3 py-2.5 text-xs font-semibold transition-all ${
                                selectedOutcome === id
                                  ? 'border-primary bg-primary text-white shadow-xs'
                                  : 'border-border bg-surface-secondary/50 text-text hover:bg-neutral-bg'
                              }`}
                            >
                              {label}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Follow-up Date if interested / call back */}
                      {(selectedOutcome === 'CALL_BACK' || selectedOutcome === 'INTERESTED') && (
                        <div className="animate-fade-in">
                          <Input
                            label="Schedule Follow-up Date"
                            type="date"
                            min={todayISO()}
                            value={followUpDate}
                            onChange={(e) => setFollowUpDate(e.target.value)}
                          />
                        </div>
                      )}

                      {/* Notes Textarea */}
                      <div>
                        <Textarea
                          label="Call Discussion Notes"
                          rows={3}
                          value={callNote}
                          onChange={(e) => setCallNote(e.target.value)}
                          placeholder="Client requirement details, objections, agreed price, next steps..."
                        />
                      </div>

                      {/* Bottom Save Action */}
                      <div className="flex items-center justify-end gap-2 pt-3 border-t border-border">
                        <Button
                          variant="ghost"
                          onClick={() => handleSaveAndNext(true)}
                        >
                          <SkipForward size={14} /> Skip
                        </Button>
                        <Button
                          onClick={() => handleSaveAndNext(false)}
                          loading={savingCall}
                          disabled={!selectedOutcome}
                          className="bg-primary hover:bg-primary-hover text-white font-bold px-5"
                        >
                          <Check size={16} /> Save & Next Lead
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* TAB 3: CALLBACKS */}
            {activeTab === 'callbacks' && (
              <div className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="text-base font-bold text-text">Scheduled Callbacks</h2>
                    <p className="text-xs text-text-muted">Leads requesting follow-up calls or callbacks today</p>
                  </div>
                  <div className="w-64">
                    <SearchInput
                      value={searchFilter}
                      onChange={setSearchFilter}
                      placeholder="Search callbacks..."
                      label="Search callbacks"
                    />
                  </div>
                </div>

                <div className="rounded-xl border border-border bg-surface overflow-hidden shadow-xs">
                  {callbacks.length === 0 ? (
                    <div className="p-8 text-center text-text-muted">
                      <CalendarClock size={28} className="mx-auto mb-2 text-text-muted" />
                      <p className="text-sm font-semibold">No callbacks scheduled</p>
                      <p className="text-xs mt-1">When you mark calls as "Call back later", they appear here.</p>
                    </div>
                  ) : (
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-border bg-surface-secondary text-left text-text-muted">
                          <th className="px-4 py-3 font-semibold">Lead Name & Company</th>
                          <th className="px-4 py-3 font-semibold">Phone</th>
                          <th className="px-4 py-3 font-semibold">Scheduled Date</th>
                          <th className="px-4 py-3 font-semibold">Last Discussion</th>
                          <th className="px-4 py-3 font-semibold text-right">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {callbacks
                          .filter((c) => !searchFilter || (c.name + c.company + c.phone).toLowerCase().includes(searchFilter.toLowerCase()))
                          .map((cb) => (
                            <tr key={cb.id} className="hover:bg-neutral-bg/50 transition-colors">
                              <td className="px-4 py-3">
                                <span className="font-semibold text-text block">{cb.name || cb.company}</span>
                                <span className="text-text-muted text-[11px]">{cb.service_interest || '—'}</span>
                              </td>
                              <td className="px-4 py-3 font-mono font-medium text-text">{cb.phone}</td>
                              <td className="px-4 py-3">
                                <Badge tone="warning">
                                  <CalendarClock size={11} className="mr-1" />
                                  {cb.follow_up_date ? date(cb.follow_up_date) : 'Today'}
                                </Badge>
                              </td>
                              <td className="px-4 py-3 text-text-secondary max-w-xs truncate">
                                {cb.last_note || cb.notes || '—'}
                              </td>
                              <td className="px-4 py-3 text-right">
                                <Button
                                  size="sm"
                                  onClick={() => handleSelectLeadToDial(cb)}
                                  className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold"
                                >
                                  <Phone size={13} /> Call Now
                                </Button>
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            )}

            {/* TAB 4: CALL HISTORY */}
            {activeTab === 'history' && (
              <div className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="text-base font-bold text-text">Call History Log</h2>
                    <p className="text-xs text-text-muted">Calls placed and logged during your active session</p>
                  </div>
                </div>

                <div className="rounded-xl border border-border bg-surface overflow-hidden shadow-xs">
                  {history.length === 0 ? (
                    <div className="p-8 text-center text-text-muted">
                      <Clock size={28} className="mx-auto mb-2 text-text-muted" />
                      <p className="text-sm font-semibold">No calls logged in this session</p>
                      <p className="text-xs mt-1">Calls you complete and record will be listed here.</p>
                    </div>
                  ) : (
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-border bg-surface-secondary text-left text-text-muted">
                          <th className="px-4 py-3 font-semibold">Time</th>
                          <th className="px-4 py-3 font-semibold">Lead Contact</th>
                          <th className="px-4 py-3 font-semibold">Outcome</th>
                          <th className="px-4 py-3 font-semibold">Duration</th>
                          <th className="px-4 py-3 font-semibold">Notes</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {history.map((h) => (
                          <tr key={h.id} className="hover:bg-neutral-bg/50">
                            <td className="px-4 py-3 font-mono text-text-muted">{clock(h.timestamp)}</td>
                            <td className="px-4 py-3">
                              <span className="font-semibold text-text block">{h.leadName}</span>
                              <span className="font-mono text-text-muted text-[11px]">{h.phone}</span>
                            </td>
                            <td className="px-4 py-3">
                              <StatusBadge status={h.outcome} />
                            </td>
                            <td className="px-4 py-3 font-mono">{formatHMS(h.durationSeconds)}</td>
                            <td className="px-4 py-3 text-text-secondary max-w-sm truncate">{h.note || '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            )}
          </main>
        </div>
      </div>
    </div>
  );
}
