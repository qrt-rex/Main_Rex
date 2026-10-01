import { useEffect, useRef, useSyncExternalStore } from 'react';
import { API_BASE, tokenStore } from '../lib/api';

/**
 * Real-time client work updates over Server-Sent Events.
 *
 * EventSource can't send the bearer token, so the stream is read with fetch(). One connection is
 * shared by every component on the page (opened with the first listener, closed with the last), it
 * reconnects with back-off, and every (re)connect fires an "open" event so views refetch whatever they
 * missed. A 30 s poll runs underneath as a safety net (another server worker, a blocked proxy).
 */
export interface LiveEvent { type: 'open' | 'work' | 'resync' | 'ready' | 'reconnect'; event?: string; work_id?: string; status?: string; client_name?: string; notified?: string[] }

type Listener = (e: LiveEvent) => void;
const listeners = new Set<Listener>();
const stateSubs = new Set<() => void>();
let connected = false;
let abort: AbortController | null = null;
let retryTimer: number | undefined;
let backoff = 1000;

const setConnected = (v: boolean) => {
  if (connected !== v) {
    connected = v;
    stateSubs.forEach((f) => f());
  }
};
const emit = (e: LiveEvent) => listeners.forEach((l) => l(e));

function parseFrames(buffer: string): { frames: LiveEvent[]; rest: string } {
  const parts = buffer.split(/\r?\n\r?\n/);
  const rest = parts.pop() ?? '';
  const frames: LiveEvent[] = [];
  for (const part of parts) {
    let name = 'message';
    let data = '';
    for (const line of part.split(/\r?\n/)) {
      if (line.startsWith('event:')) name = line.slice(6).trim();
      else if (line.startsWith('data:')) data += line.slice(5).trim();
    }
    if (!data) continue;
    try {
      frames.push({ ...JSON.parse(data), type: name } as LiveEvent);
    } catch {
      // ignore a malformed frame
    }
  }
  return { frames, rest };
}

async function connect() {
  const token = tokenStore.get();
  if (!token || listeners.size === 0) return;
  abort = new AbortController();
  try {
    const res = await fetch(`${API_BASE}/api/client-work/stream`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'text/event-stream' },
      signal: abort.signal,
    });
    if (!res.ok || !res.body) throw new Error(`stream ${res.status}`);
    backoff = 1000;
    setConnected(true);
    emit({ type: 'open' });
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const { frames, rest } = parseFrames(buffer);
      buffer = rest;
      frames.forEach((f) => (f.type === 'work' || f.type === 'resync') && emit(f));
    }
  } catch {
    // aborted or dropped: fall through to the reconnect below
  }
  setConnected(false);
  if (listeners.size > 0) {
    retryTimer = window.setTimeout(connect, backoff);
    backoff = Math.min(backoff * 2, 15_000);
  }
}

function subscribe(l: Listener) {
  listeners.add(l);
  if (listeners.size === 1) void connect();
  return () => {
    listeners.delete(l);
    if (listeners.size === 0) {
      window.clearTimeout(retryTimer);
      abort?.abort();
      setConnected(false);
    }
  };
}

/** Is the live stream currently connected? (for the "Live" indicator) */
export function useLiveConnected() {
  return useSyncExternalStore(
    (cb) => { stateSubs.add(cb); return () => { stateSubs.delete(cb); }; },
    () => connected,
    () => false,
  );
}

/**
 * Call `reload` whenever client work changes. `match` narrows it to events for one work (a detail page);
 * "open"/"resync" always reload, because the page may have missed events.
 */
export function useClientWorkLive(reload: () => void, match?: (e: LiveEvent) => boolean) {
  const reloadRef = useRef(reload);
  const matchRef = useRef(match);
  useEffect(() => {
    reloadRef.current = reload;
    matchRef.current = match;
  });

  useEffect(() => {
    let timer: number | undefined;
    let first = true;
    const schedule = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => reloadRef.current(), 250);   // coalesce bursts into one refetch
    };
    const off = subscribe((e) => {
      if (e.type === 'open' && first) { first = false; return; }    // the page just loaded its own data
      if (e.type === 'work' && matchRef.current && !matchRef.current(e)) return;
      schedule();
    });
    const poll = window.setInterval(() => document.visibilityState === 'visible' && reloadRef.current(), 30_000);
    return () => { off(); window.clearTimeout(timer); window.clearInterval(poll); };
  }, []);
}
