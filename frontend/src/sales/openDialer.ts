// The dialer lives in its own browser tab (/dialer). Every "Dialer" / "Log call" button goes through
// here so there is only ever one dialer tab: the first click opens it, later clicks hand it the lead.
export const DIALER_CHANNEL = 'rex-crm-dialer';
const WINDOW_NAME = 'rexera-dialer';

export interface DialerMessage {
  type: 'lead';
  leadId: string;
}

export function openDialer(leadId?: string) {
  const url = `/dialer${leadId ? `?lead=${encodeURIComponent(leadId)}` : ''}`;
  // An empty URL returns the existing named tab without reloading it (and its call in progress).
  const tab = window.open('', WINDOW_NAME);
  if (!tab) {
    window.open(url, '_blank');
    return;
  }
  let onDialer = false;
  try {
    onDialer = tab.location.pathname === '/dialer';
  } catch {
    onDialer = false;
  }
  if (!onDialer) {
    tab.location.href = url;
  } else if (leadId && 'BroadcastChannel' in window) {
    const channel = new BroadcastChannel(DIALER_CHANNEL);
    channel.postMessage({ type: 'lead', leadId } satisfies DialerMessage);
    channel.close();
  }
  tab.focus();
}
