// IVR provider calls, all proxied through the CRM backend (/api/ivr/*). The IVR access token rides
// in X-IVR-Token; a 419 means the IVR rejected it, so the session is refreshed once and otherwise
// ended (the CRM sign-in is untouched). There is no mock fallback: what shows is what the IVR sent.
import { api, ApiError, qs, request } from '../lib/api';
import { clearIvrSession, isExpired, saveIvrSession, type IvrSession, type IvrTokens } from './ivrAuth';
import type { CampaignStatusKind, IvrCall, IvrCampaign, IvrDid, IvrResource, IvrRow } from './types';

// ---------------------------------------------------------------- session
let session: IvrSession | null = null;
const listeners = new Set<(s: IvrSession | null) => void>();

export const ivrSession = {
  get: () => session,
  /** Replace the session (persisted); null signs out of the IVR. */
  set(next: IvrSession | null) {
    session = next;
    if (next) saveIvrSession(next);
    else clearIvrSession();
    listeners.forEach((fn) => fn(next));
  },
  /** Take a session another tab already saved, without writing it back. */
  adopt(next: IvrSession | null) {
    session = next;
    listeners.forEach((fn) => fn(next));
  },
  subscribe(fn: (s: IvrSession | null) => void) {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  },
};

let refreshing: Promise<boolean> | null = null;

function refreshTokens(): Promise<boolean> {
  const current = session;
  if (!current?.refreshToken || isExpired(current.refreshToken, 0)) return Promise.resolve(false);
  refreshing ??= api
    .post<Partial<IvrTokens> & { accessToken: string }>('/api/ivr/refresh', { refreshToken: current.refreshToken })
    .then((t) => {
      ivrSession.set({
        ...current,
        accessToken: t.accessToken,
        refreshToken: t.refreshToken ?? current.refreshToken,
        user: t.user ?? current.user,
      });
      return true;
    })
    .catch(() => false)
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

const isIvrRejection = (err: unknown) => err instanceof ApiError && err.status === 419;

async function ivrRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const send = () => {
    const headers = new Headers(init.headers);
    if (session) headers.set('X-IVR-Token', session.accessToken);
    return request<T>(path, { ...init, headers });
  };
  if (session && isExpired(session.accessToken)) await refreshTokens();
  try {
    return await send();
  } catch (err) {
    if (!isIvrRejection(err)) throw err;
  }
  if (await refreshTokens()) {
    try {
      return await send();
    } catch (err) {
      if (!isIvrRejection(err)) throw err;
    }
  }
  ivrSession.set(null);
  throw new ApiError('Your IVR session has expired. Sign in again.', 419);
}

// ---------------------------------------------------------------- reading provider rows
const isObj = (v: unknown): v is IvrRow => !!v && typeof v === 'object' && !Array.isArray(v);
const LIST_KEYS = ['data', 'items', 'rows', 'records', 'results', 'list', 'docs'];

/** The list inside any common envelope: [..], {data: [..]}, {data: {items: [..]}}, {campaigns: [..]}. */
export function rowsOf(body: unknown): IvrRow[] {
  let cur: unknown = body;
  for (let depth = 0; depth < 4; depth++) {
    if (Array.isArray(cur)) return cur.filter(isObj);
    if (!isObj(cur)) return [];
    const obj = cur;
    const key = LIST_KEYS.find((k) => Array.isArray(obj[k])) ?? LIST_KEYS.find((k) => isObj(obj[k]));
    if (!key) {
      const arrays = Object.values(obj).filter(Array.isArray);
      return arrays.length === 1 ? (arrays[0] as unknown[]).filter(isObj) : [];
    }
    cur = obj[key];
  }
  return [];
}

/** First non-empty text among the keys (nested objects give their name / number). */
export function text(row: IvrRow, ...keys: string[]): string {
  for (const k of keys) {
    const v = row[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
    if (typeof v === 'number' && Number.isFinite(v)) return String(v);
    if (isObj(v)) {
      const inner = text(v, 'name', 'title', 'label', 'number', 'phone_number');
      if (inner) return inner;
    }
  }
  return '';
}

export function num(row: IvrRow, ...keys: string[]): number | undefined {
  for (const k of keys) {
    const v = row[k];
    const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

export const digits = (phone: string) => phone.replace(/\D/g, '');
/** Same number regardless of country code / formatting (last 10 digits). */
export const samePhone = (a: string, b: string) => {
  const x = digits(a).slice(-10);
  return x.length >= 6 && x === digits(b).slice(-10);
};

function statusKind(status: string): CampaignStatusKind {
  const s = status.toLowerCase();
  if (/inactive|stop|cancel|complet|finish|done|end|archiv|fail/.test(s)) return 'stopped';
  if (/pause|hold/.test(s)) return 'paused';
  if (/run|active|live|progress|start|dial/.test(s)) return 'running';
  return 'other';
}

export function toCampaign(row: IvrRow): IvrCampaign {
  const status = text(row, 'status', 'state', 'campaign_status');
  const metric = (...keys: string[]) => num(row, ...keys);
  const metrics: IvrCampaign['metrics'] = {};
  const entries: [keyof IvrCampaign['metrics'], number | undefined][] = [
    ['total', metric('total_leads', 'totalLeads', 'total_contacts', 'leads_count', 'total_numbers', 'total')],
    ['dialed', metric('dialed', 'dialed_leads', 'dialedLeads', 'attempted', 'calls_made', 'total_calls')],
    ['queued', metric('queued', 'pending', 'remaining', 'queued_leads')],
    ['dialing', metric('dialing', 'active_calls', 'live_calls', 'in_progress')],
    ['completed', metric('completed', 'completed_calls', 'answered', 'connected')],
    ['interested', metric('interested', 'interested_count', 'transferred', 'key1')],
    ['concurrency', metric('concurrency', 'max_concurrent_calls', 'channels', 'cps')],
  ];
  for (const [k, v] of entries) if (v !== undefined) metrics[k] = v;
  const reported = num(row, 'progress', 'progress_percentage', 'progressPercentage');
  const progress = reported ?? (metrics.total && metrics.dialed !== undefined ? Math.round((metrics.dialed / metrics.total) * 100) : null);
  return {
    id: text(row, 'id', 'uuid', 'campaign_id', '_id'),
    name: text(row, 'name', 'campaign_name', 'title') || 'Untitled campaign',
    status: status || 'unknown',
    statusKind: statusKind(status),
    metrics,
    progress,
    createdAt: text(row, 'created_at', 'createdAt', 'start_date') || null,
    raw: row,
  };
}

export function toDid(row: IvrRow): IvrDid {
  const number = text(row, 'number', 'did', 'did_number', 'phone_number', 'phone', 'caller_id');
  return { id: text(row, 'id', 'uuid', 'did_id') || number, number, label: text(row, 'name', 'label', 'description', 'alias'), raw: row };
}

function direction(row: IvrRow): IvrCall['direction'] {
  const d = text(row, 'direction', 'call_direction', 'dir').toLowerCase();
  if (/^in/.test(d)) return 'in';
  if (/^out/.test(d)) return 'out';
  return null;
}

export function toCall(row: IvrRow, index: number): IvrCall {
  const disposition = text(row, 'disposition', 'disposition_name', 'disposition_label');
  const callStatus = text(row, 'status', 'call_status', 'result');
  const talkSeconds = num(row, 'talk_time', 'talk_duration', 'talk_seconds', 'billsec') ?? null;
  return {
    id: text(row, 'id', 'uuid', 'call_id', 'unique_id', 'uniqueid') || `row-${index}`,
    phone: text(row, 'destination_number', 'destination', 'customer_number', 'lead_phone', 'callee', 'to', 'phone', 'number', 'mobile', 'caller_number'),
    status: disposition || callStatus || text(row, 'hangup_cause'),
    direction: direction(row),
    callType: text(row, 'call_type', 'type', 'mode', 'source'),
    callStatus,
    reason: text(row, 'hangup_reason', 'end_reason', 'status_reason', 'hangup_cause'),
    disposition,
    leadName: text(row, 'lead_name', 'customer_name', 'contact_name', 'lead'),
    durationSeconds: num(row, 'duration', 'call_duration', 'duration_seconds', 'total_duration') ?? null,
    talkSeconds,
    at: text(row, 'start_time', 'started_at', 'call_time', 'created_at', 'createdAt', 'date', 'timestamp') || null,
    campaign: text(row, 'campaign_name', 'campaign'),
    agent: text(row, 'agent_name', 'agent', 'user_name'),
    recordingUrl: text(row, 'recording_url', 'recording', 'audio_url') || null,
    recordingSeconds: num(row, 'recording_duration', 'recording_length') ?? talkSeconds,
    raw: row,
  };
}

// ---------------------------------------------------------------- calls
export const ivrApi = {
  status: () => api.get<{ configured: boolean }>('/api/ivr/status'),
  login: (email: string, password: string) => api.post<IvrTokens>('/api/ivr/login', { email, password }),

  rows: (resource: IvrResource, params: Record<string, string> = {}) =>
    ivrRequest<unknown>(`/api/ivr/data/${resource}${qs(params)}`).then(rowsOf),
  campaigns: () => ivrApi.rows('campaigns').then((rows) => rows.map(toCampaign)),
  dids: () => ivrApi.rows('dids').then((rows) => rows.map(toDid).filter((d) => d.number)),
  calls: () => ivrApi.rows('cdr').then((rows) => rows.map(toCall)),

  /** Click-to-call: the IVR rings the agent, then connects the number. */
  call: (destinationNumber: string, callerDid?: string, campaignId?: string) =>
    ivrRequest<unknown>('/api/ivr/call', {
      method: 'POST',
      body: JSON.stringify({ destination_number: destinationNumber, caller_did: callerDid || undefined, campaign_id: campaignId || undefined }),
    }),
  campaignAction: (id: string, action: 'pause' | 'resume' | 'stop') =>
    ivrRequest<unknown>(`/api/ivr/campaigns/${encodeURIComponent(id)}/${action}`, { method: 'POST' }),
};
