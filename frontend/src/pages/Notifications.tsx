import { useNavigate } from 'react-router-dom';
import { Bell, CalendarCheck, Megaphone, PartyPopper, UserPlus } from 'lucide-react';
import { useNotifications, type NotificationItem } from '../lib/notifications';
import { relativeTime } from '../lib/format';
import { Button } from '../components/common/Button';
import { Card } from '../components/common/Card';
import { EmptyState } from '../components/common/EmptyState';
import { ErrorState } from '../components/common/ErrorState';
import { Skeleton } from '../components/common/Skeleton';
import { PageHeader } from '../components/layout/PageHeader';

const icons: Record<NotificationItem['type'], typeof Bell> = {
  approval: CalendarCheck,
  recruitment: UserPlus,
  onboarding: PartyPopper,
  broadcast: Megaphone,
};

export function Notifications() {
  const navigate = useNavigate();
  const { items, loading, error, unreadCount, isUnread, markAllRead, reload } = useNotifications();

  return (
    <>
      <PageHeader
        title="Notifications"
        description="Updates from the modules you have access to."
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
              const Icon = icons[n.type];
              const unread = isUnread(n);
              return (
                <li key={n.id}>
                  <button onClick={() => navigate(n.link)} className="flex w-full items-start gap-3 px-4 py-3.5 text-left transition-colors hover:bg-surface-secondary">
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
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </>
  );
}
