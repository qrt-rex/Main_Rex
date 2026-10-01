import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from './api';
import { useAuth } from '../auth/AuthContext';
import { useClientWorkLive } from '../clientwork/live';

export interface NotificationItem {
  id: string;
  /** approval: waiting on you to decide · update: the outcome of your own request */
  type: 'approval' | 'update' | 'recruitment' | 'onboarding' | 'broadcast';
  title: string;
  description: string;
  timestamp: string | null;
  link: string;
  /** Broadcasts: the message and whether this user still has to acknowledge it. */
  broadcast_id?: string;
  needs_ack?: boolean;
  body?: string;
}

interface NotificationsValue {
  items: NotificationItem[];
  loading: boolean;
  error: boolean;
  unreadCount: number;
  isUnread: (n: NotificationItem) => boolean;
  markAllRead: () => void;
  reload: () => void;
}

const NotificationsContext = createContext<NotificationsValue | null>(null);
const toMs = (v: string | null) => (v ? new Date(/[zZ]|[+-]\d\d:\d\d$/.test(v) ? v : `${v}Z`).getTime() || 0 : 0);

/** Server-filtered feed; "read" state is a per-browser convenience (last-seen timestamp per user). */
export function NotificationsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const seenKey = `rex-crm-notifications-seen:${user?.id ?? ''}`;
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [lastSeen, setLastSeen] = useState(0);

  useEffect(() => {
    try {
      setLastSeen(Number(localStorage.getItem(seenKey)) || 0);
    } catch {
      setLastSeen(0);
    }
  }, [seenKey]);

  const reload = useCallback(() => {
    setError(false);
    api.get<{ items: NotificationItem[] }>('/api/notifications')
      .then((r) => setItems(r.items))
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, []);

  // Permissions decide what the feed contains, so refetch when they change.
  const permissionKey = user?.permissions.join(',');
  useEffect(() => {
    reload();
    const t = window.setInterval(reload, 120_000);
    return () => window.clearInterval(t);
  }, [reload, permissionKey]);

  const markAllRead = useCallback(() => {
    const now = Date.now();
    setLastSeen(now);
    try {
      localStorage.setItem(seenKey, String(now));
    } catch {
      // storage unavailable
    }
  }, [seenKey]);

  const value = useMemo<NotificationsValue>(() => {
    const isUnread = (n: NotificationItem) => toMs(n.timestamp) > lastSeen;
    return { items, loading, error, unreadCount: items.filter(isUnread).length, isUnread, markAllRead, reload };
  }, [items, loading, error, lastSeen, markAllRead, reload]);

  return (
    <NotificationsContext.Provider value={value}>
      {user?.permissions.includes('clientwork.view') && <ClientWorkBellSync userId={user.id} reload={reload} />}
      {children}
    </NotificationsContext.Provider>
  );
}

/** Client work events that notify this user refresh the bell at once (the 2-minute poll stays as a fallback). */
function ClientWorkBellSync({ userId, reload }: { userId: string; reload: () => void }) {
  useClientWorkLive(reload, (e) => (e.notified ?? []).includes(userId));
  return null;
}

export function useNotifications() {
  const ctx = useContext(NotificationsContext);
  if (!ctx) throw new Error('useNotifications must be used within NotificationsProvider');
  return ctx;
}
