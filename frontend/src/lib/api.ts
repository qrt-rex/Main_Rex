// Single client for the CRM backend (the integrated Rexera-HR FastAPI service).
// Authorization is enforced server-side; the UI's permission checks are only for
// what to render.
// Dev server (npm run dev): the API on port 8000. A production build is served by the backend itself,
// so it calls its own origin. VITE_API_BASE_URL overrides both.
export const API_BASE = import.meta.env.VITE_API_BASE_URL ?? (import.meta.env.DEV ? 'http://localhost:8000' : '');

const TOKEN_KEY = 'rex-crm-token';

export const tokenStore = {
  get(): string | null {
    try {
      return localStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  },
  set(token: string | null) {
    try {
      if (token) localStorage.setItem(TOKEN_KEY, token);
      else localStorage.removeItem(TOKEN_KEY);
    } catch {
      // Storage blocked: the session still lives in memory for this tab.
    }
  },
  key: TOKEN_KEY,
};

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

// AuthContext registers this so any 401 ends the session everywhere in the app.
let onUnauthorized: (() => void) | null = null;
export const setUnauthorizedHandler = (fn: (() => void) | null) => {
  onUnauthorized = fn;
};

function friendlyMessage(status: number, detail: unknown): string {
  if (typeof detail === 'string' && detail) return detail;
  if (Array.isArray(detail) && detail[0]?.msg) {
    const d = detail[0];
    const msg = String(d.msg).replace(/^(Value error|Assertion failed), /, '');
    const field = Array.isArray(d.loc) && d.loc.length > 1 ? d.loc[d.loc.length - 1] : '';
    return field ? `${String(field).replace(/_/g, ' ')}: ${msg}` : msg;
  }
  if (status === 403) return "You don't have permission to do that.";
  if (status === 404) return 'The requested record was not found.';
  if (status >= 500) return 'The server ran into a problem. Please try again.';
  return 'Something went wrong. Please try again.';
}

async function raw(path: string, init: RequestInit = {}): Promise<Response> {
  const token = tokenStore.get();
  const headers = new Headers(init.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (init.body && !(init.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, { ...init, headers });
  } catch {
    throw new ApiError("Can't reach the server. Check your connection and try again.", 0);
  }

  if (res.status === 401 && token) onUnauthorized?.();
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(friendlyMessage(res.status, body.detail ?? body.message), res.status);
  }
  return res;
}

export async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await raw(path, init);
  if (res.status === 204) return undefined as T;
  const type = res.headers.get('content-type') ?? '';
  return (type.includes('application/json') ? res.json() : res.text()) as Promise<T>;
}

type Query = Record<string, string | number | boolean | null | undefined>;

export function qs(params: Query): string {
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') search.set(k, String(v));
  }
  const s = search.toString();
  return s ? `?${s}` : '';
}

export const api = {
  get: <T>(path: string, params: Query = {}) => request<T>(path + qs(params)),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: body instanceof FormData ? body : JSON.stringify(body ?? {}) }),
  put: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PUT', body: JSON.stringify(body ?? {}) }),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PATCH', body: JSON.stringify(body ?? {}) }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
  /** Authenticated fetch of a file; returns the Blob (plain links can't carry the bearer token). */
  blob: async (path: string, params: Query = {}) => (await raw(path + qs(params))).blob(),
  text: async (path: string) => (await raw(path)).text(),
};

export function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
