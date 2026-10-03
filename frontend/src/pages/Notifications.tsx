import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, Briefcase, CalendarCheck, CircleCheck, Megaphone, PartyPopper, UserPlus } from 'lucide-react';
import { useNotifications, type NotificationItem } from '../lib/notifications';
import { api, ApiError } from '../lib/api';
import { useToast } from '../components/common/ToastContext';
import { relativeTime } from '../lib/format';
import { Button } from '../components/common/Button';
import { Card } from '../components/common/Card';
import { EmptyState } from '../components/common/EmptyState';
import { ErrorState } from '../components/common/ErrorState';
import { Skeleton } from '../components/common/Skeleton';
import { PageHeader } from '../components/layout/PageHeader';

const icons: Partial<Record<NotificationItem['type'], typeof Bell>> = {
  approval: CalendarCheck,
  update: CircleCheck,
  recruitment: UserPlus,
  onboarding: PartyPopper,
  broadcast: Megaphone,
  operations: Briefcase,
};

/** Broadcast text as plain text: the HTML is written by HR, so it is never injected into the page. */
const plain = (html = '') => new DOMParser().parseFromString(html, 'text/html').body.textContent?.trim() ?? '';

export function Notifications() {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const { items, loading, error, unreadCount, isUnread, markAllRead, reload } = useNotifications();
  const [acking, setAcking] = useState<string | null>(null);

  const acknowledge = async (n: NotificationItem) => {
    setAcking(n.id);
    try {
      await api.post(`/api/broadcasts/acknowledge/${encodeURIComponent(n.broadcast_id ?? '')}`);
      showToast('Acknowledged. HR can see that you have read it.', 'success');
      reload();
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Could not acknowledge', 'error');
    } finally {
      setAcking(null);
    }
  };

  return (
    <>
      <PageHeader
        title="Notifications"
        description="Requests waiting on your decision, the outcome of your own requests, and updates from your modules."
        actions={unreadCount > 0 && <Button variant="secondary" onClick={markAllRead}>Mark all as read</Button>}
      />
      <Card>
        {loading && items.length === 0 ? (
          <div className="space-y-3 p-4">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
        ) : error && items.length === 0 ? (
          <ErrorState onRetry={reload} message="We couldn't load your notifications." />
        ) : items.length === 0 ? (
          <EmptyState icon={Bell} title="You're all caught up" description="Approvals, recruitment updates and announcements will appear here." />
        ) : (
          <ul className="divide-y divide-border">
            {items.map((n) => {
              const Icon = icons[n.type] ?? Bell;
              const unread = isUnread(n);
              return (
                <li key={n.id} className="flex flex-col">
                  <button onClick={() => n.type !== 'broadcast' && navigate(n.link)} className="flex w-full items-start gap-3 px-4 py-3.5 text-left transition-colors hover:bg-surface-secondary">
                    <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-neutral-bg text-text-muted">
                      <Icon size={15} aria-hidden="true" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className={`block text-sm ${unread ? 'font-semibold text-text' : 'text-text-secondary'}`}>{n.title}</span>
                      <span className="block truncate text-xs text-text-muted">{n.description}</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-2 text-xs text-text-muted">
                      {relativeTime(n.timestamp)}
                      {unread && <span className="h-2 w-2 rounded-full bg-primary" aria-label="Unread" />}
                    </span>
                  </button>
                  {n.type === 'broadcast' && (n.body || n.needs_ack) && (
                    <div className="-mt-1 space-y-2 px-4 pb-3.5 pl-15">
                      {n.body && <p className="whitespace-pre-line text-sm text-text-secondary">{plain(n.body)}</p>}
                      {n.needs_ack && <Button size="sm" loading={acking === n.id} onClick={() => acknowledge(n)}><CircleCheck size={14} /> Acknowledge</Button>}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </>
  );
}
