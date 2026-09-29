// The IVR provider session (separate from the CRM sign-in). The user signs in to the IVR with their
// own IVR email and password; the session is kept for this CRM user only and cleared on CRM sign-out.

export interface IvrCompany {
  id: number;
  uuid: string;
  name: string;
  code: string;
  ivr_enabled: boolean;
  webhooks_enabled: boolean;
  outbound_caller_name_enabled: boolean;
  click_to_call_api_enabled: boolean;
  agent_recordings_visible: boolean;
  agent_profile_edit_enabled: boolean;
}

export interface IvrUser {
  id: number;
  uuid: string;
  name: string;
  email: string;
  role: string;
  avatar: string | null;
  employee_id: string | null;
  company: IvrCompany | null;
  module_access: string[] | null;
  manual_dialer_enabled: boolean;
  manual_dialer_did_id: string | number | null;
  sip_extension: string | null;
  sip_password: string | null;
  sip_wss_url: string | null;
}

export interface IvrTokens {
  user: IvrUser;
  accessToken: string;
  refreshToken: string | null;
}

export interface IvrSession extends IvrTokens {
  /** The CRM user who signed in; another CRM user in this browser never inherits it. */
  crmUserId: string;
}

export const IVR_SESSION_KEY = 'rex-crm-ivr-session';
const KEY = IVR_SESSION_KEY;
// An earlier build stored a hard-coded IVR session under this key; never read it, always drop it.
const LEGACY_KEY = 'rexera_ivr_dialer_session';

export function loadIvrSession(crmUserId: string): IvrSession | null {
  try {
    localStorage.removeItem(LEGACY_KEY);
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as IvrSession;
    if (s?.crmUserId !== crmUserId || !s.accessToken || !s.user) return null;
    return s;
  } catch {
    return null;
  }
}

export function saveIvrSession(s: IvrSession) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // Storage blocked: the session still lives in memory for this tab.
  }
}

export function clearIvrSession() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // storage unavailable
  }
}

/** Seconds-since-epoch expiry of a JWT, or null when it isn't a readable JWT. */
export function tokenExpiry(token: string): number | null {
  try {
    const part = token.split('.')[1];
    const json = JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/')));
    return typeof json.exp === 'number' ? json.exp : null;
  } catch {
    return null;
  }
}

export const isExpired = (token: string | null | undefined, skewSeconds = 30) => {
  if (!token) return true;
  const exp = tokenExpiry(token);
  return exp !== null && exp - skewSeconds <= Date.now() / 1000;
};

/** A session from the IVR's own login response (`{success, message, data: {user, accessToken, refreshToken}}`). */
export function parseLoginResponse(text: string): IvrTokens {
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error("That isn't valid JSON. Paste the whole login response.");
  }
  const root = body as Record<string, unknown>;
  const data = (root?.data ?? root) as Record<string, unknown>;
  const clean = (v: unknown) => (typeof v === 'string' ? v.replace(/\s+/g, '') : '');
  const accessToken = clean(data?.accessToken ?? data?.access_token);
  const refreshToken = clean(data?.refreshToken ?? data?.refresh_token) || null;
  const user = data?.user as IvrUser | undefined;
  if (!accessToken || !user || typeof user !== 'object') {
    throw new Error('The response needs data.user and data.accessToken.');
  }
  if (isExpired(accessToken, 0) && isExpired(refreshToken, 0)) {
    throw new Error('This IVR session has expired. Sign in with your IVR email and password.');
  }
  return { user, accessToken, refreshToken };
}
