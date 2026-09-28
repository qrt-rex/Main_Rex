import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { ChevronRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Badge, StatusBadge, type BadgeTone } from '../components/common/Badge';
import { Card, CardHeader } from '../components/common/Card';
import { EmptyState } from '../components/common/EmptyState';
import { Table, type Column } from '../components/common/Table';
import { dateTime, relativeTime } from '../lib/format';
import { sections as navSections } from '../modules/registry';
import { useAuth } from '../auth/AuthContext';
import type { FeedItem } from './api';

/* Building blocks shared by every role dashboard. Which of them a dashboard renders is
   decided by the role's permissions — an entity a user can't access is never built. */

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-3 mt-6 flex items-end justify-between gap-3 first:mt-0">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-text-muted">{children}</h2>
      {action}
    </div>
  );
}

export function StatGrid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">{children}</div>;
}

export function EntityGrid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">{children}</div>;
}

interface EntityCardProps {
  icon: LucideIcon;
  title: string;
  description: string;
  to?: string;
  metric?: ReactNode;
  metricLabel?: string;
  badge?: { label: string; tone: BadgeTone };
  footer?: ReactNode;
}

/** One functional area of the role's control centre. Without `to` it is informational only. */
export function EntityCard({ icon: Icon, title, description, to, metric, metricLabel, badge, footer }: EntityCardProps) {
  const body = (
    <>
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary-soft text-primary">
          <Icon size={17} aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-sm font-semibold text-text">{title}</h3>
            {badge && <Badge tone={badge.tone}>{badge.label}</Badge>}
          </div>
          <p className="mt-0.5 text-xs text-text-muted">{description}</p>
        </div>
        {to && <ChevronRight size={16} className="mt-1 shrink-0 text-text-muted transition-transform group-hover:translate-x-0.5" aria-hidden="true" />}
      </div>
      {metric !== undefined && (
        <div className="mt-3 flex items-baseline gap-2">
          <span className="text-xl font-semibold tracking-tight text-text tabular-nums">{metric}</span>
          {metricLabel && <span className="text-xs text-text-muted">{metricLabel}</span>}
        </div>
      )}
      {footer && <div className="mt-3 border-t border-border pt-3 text-xs text-text-muted">{footer}</div>}
    </>
  );

  const cls = 'block rounded-lg border border-border bg-surface p-4 shadow-[var(--shadow-card)]';
  return to ? (
    <Link to={to} className={`group ${cls} transition-colors hover:border-border-strong hover:bg-surface-secondary`}>{body}</Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

interface PanelProps {
  title: string;
  description?: string;
  items: FeedItem[];
  emptyTitle: string;
  emptyDescription?: string;
  emptyIcon?: LucideIcon;
  link?: { to: string; label: string };
  showStatus?: boolean;
  limit?: number;
}

/** Pending work, approvals, announcements, personal tasks: a scannable list of records. */
export function TaskPanel({ title, description, items, emptyTitle, emptyDescription, emptyIcon, link, showStatus = true, limit = 8 }: PanelProps) {
  return (
    <Card>
      <CardHeader
        title={title}
        description={description}
        actions={link && items.length > 0 ? <Link to={link.to} className="text-xs font-medium text-primary hover:underline">{link.label}</Link> : undefined}
      />
      {items.length === 0 ? (
        <EmptyState compact icon={emptyIcon} title={emptyTitle} description={emptyDescription} />
      ) : (
        <ul className="divide-y divide-border">
          {items.slice(0, limit).map((item) => {
            const row = (
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-text">{item.title}</p>
                  {item.description && <p className="truncate text-xs text-text-muted">{item.description}</p>}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {showStatus && item.status && <StatusBadge status={item.status} />}
                  {item.timestamp && <span className="hidden text-xs text-text-muted sm:block">{relativeTime(item.timestamp)}</span>}
                </div>
              </div>
            );
            return (
              <li key={item.id}>
                {item.link ? (
                  <Link to={item.link} className="block px-4 py-3 transition-colors hover:bg-surface-secondary">{row}</Link>
                ) : (
                  <div className="px-4 py-3">{row}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

/** Budget / capacity style measure: one bar per row with its own scale. */
export function ProgressCard({ title, description, rows }: {
  title: string;
  description?: string;
  rows: { label: string; value: number; max: number; hint?: string; tone?: 'primary' | 'success' | 'warning' | 'danger' }[];
}) {
  const bar = { primary: 'bg-primary', success: 'bg-success', warning: 'bg-warning', danger: 'bg-danger' };
  return (
    <Card>
      <CardHeader title={title} description={description} />
      <div className="space-y-4 p-4">
        {rows.map((r) => {
          const pct = r.max > 0 ? Math.min(100, Math.round((r.value / r.max) * 100)) : 0;
          return (
            <div key={r.label}>
              <div className="mb-1.5 flex items-baseline justify-between gap-3 text-sm">
                <span className="truncate text-text-secondary">{r.label}</span>
                <span className="shrink-0 font-medium tabular-nums text-text">{r.hint ?? `${pct}%`}</span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-neutral-bg" role="img" aria-label={`${r.label}: ${pct}%`}>
                <div className={`h-full rounded-full ${bar[r.tone ?? 'primary']}`} style={{ width: `${pct}%` }} />
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

/** Recent activity / audit feed as a sortable table (scrolls horizontally on small screens). */
export function ActivityTable({ title, description, items, link }: {
  title: string;
  description?: string;
  items: FeedItem[];
  link?: { to: string; label: string };
}) {
  const columns: Column<FeedItem>[] = [
    { key: 'title', header: 'Event', render: (r) => <span className="font-medium text-text">{r.title}</span>, sortValue: (r) => r.title },
    { key: 'description', header: 'Details', render: (r) => <span className="text-text-secondary">{r.description || '—'}</span> },
    { key: 'timestamp', header: 'When', align: 'right', render: (r) => <span className="whitespace-nowrap text-text-muted">{dateTime(r.timestamp)}</span>, sortValue: (r) => r.timestamp || '' },
  ];
  return (
    <Card>
      <CardHeader
        title={title}
        description={description}
        actions={link ? <Link to={link.to} className="text-xs font-medium text-primary hover:underline">{link.label}</Link> : undefined}
      />
      <Table columns={columns} rows={items} rowKey={(r) => r.id} empty={<EmptyState compact title="No activity yet" description="Actions taken in the CRM appear here." />} />
    </Card>
  );
}

/** Label/value facts (infrastructure, deployment, database). */
export function DetailCard({ title, description, rows, actions }: {
  title: string;
  description?: string;
  rows: [string, ReactNode][];
  actions?: ReactNode;
}) {
  return (
    <Card>
      <CardHeader title={title} description={description} actions={actions} />
      <dl className="divide-y divide-border">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-center justify-between gap-3 px-4 py-2.5">
            <dt className="text-sm text-text-muted">{label}</dt>
            <dd className="min-w-0 truncate text-sm font-medium text-text">{value}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}

/** System / operational alerts. Nothing to report renders a calm "all clear" row. */
export function AlertPanel({ title, alerts }: { title: string; alerts: { id: string; message: string; tone: BadgeTone; detail?: string }[] }) {
  const border: Record<string, string> = {
    danger: 'border-l-danger', warning: 'border-l-warning', success: 'border-l-success',
    info: 'border-l-info', primary: 'border-l-primary', neutral: 'border-l-border-strong',
  };
  return (
    <Card>
      <CardHeader title={title} />
      <ul className="space-y-2 p-3">
        {alerts.map((a) => (
          <li key={a.id} className={`rounded-md border border-border border-l-[3px] bg-surface-secondary px-3 py-2.5 ${border[a.tone]}`}>
            <div className="flex items-start justify-between gap-3">
              <p className="text-sm text-text">{a.message}</p>
              <Badge tone={a.tone}>{a.tone === 'success' ? 'Healthy' : a.tone === 'danger' ? 'Critical' : a.tone === 'warning' ? 'Attention' : 'Info'}</Badge>
            </div>
            {a.detail && <p className="mt-0.5 text-xs text-text-muted">{a.detail}</p>}
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function TwoColumn({ main, side }: { main: ReactNode; side: ReactNode }) {
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="space-y-4 lg:col-span-2">{main}</div>
      <div className="space-y-4">{side}</div>
    </div>
  );
}

/**
 * Entity cards for the modules this user may open, read straight from the nav registry
 * so a role never sees an area it has no permission for.
 */
export function ModuleEntities({ ids }: { ids?: string[] }) {
  const { can } = useAuth();
  const permitted = navSections.flatMap((s) => s.items).filter((i) => can(i.permission));
  const items = ids
    ? ids.map((id) => permitted.find((i) => i.id === id)).filter((i): i is NonNullable<typeof i> => !!i)
    : permitted;
  if (items.length === 0) return null;
  return (
    <EntityGrid>
      {items.map((i) => (
        <EntityCard
          key={i.id}
          icon={i.icon}
          title={i.label}
          description={i.description ?? ''}
          to={i.path}
          badge={i.placeholder ? { label: 'Not configured', tone: 'neutral' } : undefined}
        />
      ))}
    </EntityGrid>
  );
}
