/**
 * IT Command Center — Enterprise dashboard.
 *
 * This replaces the basic ItDashboard with a full multi-section command centre.
 * Each section is loaded on-demand when the user navigates to it via the tab bar.
 * The home tab shows live system health cards, alerts, and activity stream.
 */
import { useState, useCallback, type ReactNode } from 'react';
import {
  Activity, AlertTriangle, Archive, BarChart3, Bell, Clock, Database,
  FileText, Globe, HardDrive, KeyRound, LayoutDashboard, RefreshCw,
  Search, Shield, ShieldAlert, Terminal, TrendingUp, Upload, Users, Zap,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { useApi } from '../lib/useApi';
import { dateTime, number, relativeTime } from '../lib/format';
import { Badge, type BadgeTone } from '../components/common/Badge';
import { Card, CardHeader } from '../components/common/Card';
import { EmptyState } from '../components/common/EmptyState';
import { ErrorState } from '../components/common/ErrorState';
import { PageSkeleton } from '../components/common/Skeleton';
import { DashboardIntro } from '../dashboards/DashboardShell';
import type { WorkspaceSummary } from '../dashboards/api';
import {
  itDashboard, itHealth, itActivityStream, itSecurity, itDatabase, itCRM,
  itIncidents, itTasks, itAlerts, itSessions, itDeployments, itBackups, itEmergencyAccess,
  itSearch,
  type ActivityItem, type SearchResults,
} from './api';

/* ------------------------------------------------------------------ */
/*  Shared helpers                                                     */
/* ------------------------------------------------------------------ */
const STATUS_TONE: Record<string, BadgeTone> = {
  healthy: 'success', warning: 'warning', critical: 'danger', offline: 'danger', unknown: 'neutral',
  active: 'success', acknowledged: 'warning', resolved: 'neutral',
  open: 'danger', investigating: 'warning', identified: 'warning', mitigating: 'info',
  monitoring: 'info', closed: 'neutral',
  in_progress: 'primary', on_hold: 'warning', completed: 'success', cancelled: 'neutral',
  requested: 'warning', approved: 'success', expired: 'neutral', revoked: 'danger', denied: 'danger',
};

const SEVERITY_TONE: Record<string, BadgeTone> = { critical: 'danger', high: 'danger', medium: 'warning', low: 'info', info: 'neutral' };
const severityTone = (s: string): BadgeTone => SEVERITY_TONE[s] ?? 'neutral';

/* ------------------------------------------------------------------ */
/*  Tabs                                                               */
/* ------------------------------------------------------------------ */
interface Tab { id: string; label: string; icon: LucideIcon; permission?: string }

const TABS: Tab[] = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'health', label: 'System Health', icon: Activity },
  { id: 'activity', label: 'Activity', icon: Globe },
  { id: 'incidents', label: 'Incidents', icon: AlertTriangle },
  { id: 'tasks', label: 'IT Tasks', icon: Terminal },
  { id: 'alerts', label: 'Alerts', icon: Bell },
  { id: 'security', label: 'Security', icon: Shield, permission: 'it.security.view' },
  { id: 'sessions', label: 'Sessions', icon: Users, permission: 'it.security.view' },
  { id: 'database', label: 'Database', icon: Database },
  { id: 'crm', label: 'CRM Monitor', icon: TrendingUp, permission: 'it.crm.monitor' },
  { id: 'deployments', label: 'Deployments', icon: Upload, permission: 'it.deployment.view' },
  { id: 'backups', label: 'Backups', icon: Archive, permission: 'it.backup.manage' },
  { id: 'emergency', label: 'Emergency', icon: KeyRound, permission: 'it.emergency.manage' },
  { id: 'search', label: 'Search', icon: Search },
];

/* ------------------------------------------------------------------ */
/*  Root Component                                                     */
/* ------------------------------------------------------------------ */
export function ItCommandCenter({ summary: _summary }: { summary: WorkspaceSummary }) {
  const { can } = useAuth();
  const [activeTab, setActiveTab] = useState('overview');
  const visibleTabs = TABS.filter(t => !t.permission || can(t.permission));

  return (
    <>
      <DashboardIntro
        subtitle="Check that everything works."
      />

      {/* Tab Navigation */}
      <div className="mb-6 -mx-4 sm:-mx-6 lg:-mx-8">
        <div className="overflow-x-auto px-4 sm:px-6 lg:px-8">
          <div className="flex gap-1 border-b border-border pb-px min-w-max">
            {visibleTabs.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`group flex items-center gap-1.5 whitespace-nowrap rounded-t-md px-3 py-2 text-xs font-medium transition-colors ${activeTab === tab.id
                    ? 'border-b-2 border-primary bg-primary-soft text-primary'
                    : 'text-text-muted hover:bg-surface-secondary hover:text-text'
                  }`}
              >
                <tab.icon size={14} />
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Tab Content */}
      {activeTab === 'overview' && <OverviewTab />}
      {activeTab === 'health' && <HealthTab />}
      {activeTab === 'activity' && <ActivityTab />}
      {activeTab === 'incidents' && <IncidentsTab />}
      {activeTab === 'tasks' && <TasksTab />}
      {activeTab === 'alerts' && <AlertsTab />}
      {activeTab === 'security' && <SecurityTab />}
      {activeTab === 'sessions' && <SessionsTab />}
      {activeTab === 'database' && <DatabaseTab />}
      {activeTab === 'crm' && <CRMTab />}
      {activeTab === 'deployments' && <DeploymentsTab />}
      {activeTab === 'backups' && <BackupsTab />}
      {activeTab === 'emergency' && <EmergencyTab />}
      {activeTab === 'search' && <SearchTab />}
    </>
  );
}

/* ================================================================== */
/*  Section: System Overview                                           */
/* ================================================================== */
function OverviewTab() {
  const { data, status, error, reload } = useApi(itDashboard);

  if (status === 'error') return <Card><ErrorState onRetry={reload} message={error} /></Card>;
  if (!data) return <PageSkeleton />;

  const d = data;
  const overall = d.health.overall;

  // Only what tells IT whether to act. Details live in the other tabs.
  const broken = Object.entries(d.health.services).filter(([, svc]) => (svc as { status?: string }).status !== 'healthy');

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard icon={Activity} label="Is everything OK?" value={overall === 'healthy' ? 'Yes' : 'No, check it'} tone={STATUS_TONE[overall] ?? 'neutral'} />
        <MetricCard icon={AlertTriangle} label="Problems open" value={number(d.open_incidents)} tone={d.open_incidents > 0 ? 'danger' : 'success'} />
        <MetricCard icon={Terminal} label="IT jobs to do" value={number(d.pending_it_tasks)} tone={d.pending_it_tasks > 0 ? 'warning' : 'success'} />
        <MetricCard icon={ShieldAlert} label="Failed sign-ins today" value={number(d.failed_logins_24h)} tone={d.failed_logins_24h > 0 ? 'warning' : 'success'} />
      </div>

      {broken.length > 0 && (
        <>
          <SectionHeader title="Needs fixing" icon={Activity} action={<RefreshButton onClick={reload} />} />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {broken.map(([name, svc]) => (
              <HealthServiceCard key={name} name={name} service={svc} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/* ================================================================== */
/*  Section: Full System Health                                        */
/* ================================================================== */
function HealthTab() {
  const { data, status, error, reload } = useApi(itHealth);
  if (status === 'error') return <Card><ErrorState onRetry={reload} message={error} /></Card>;
  if (!data) return <PageSkeleton />;

  return (
    <div className="space-y-6">
      <SectionHeader title="Service Health Checks" icon={Activity} action={<RefreshButton onClick={reload} />} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {Object.entries(data.services).map(([name, svc]) => (
          <HealthServiceCard key={name} name={name} service={svc} />
        ))}
      </div>
      <div className="text-xs text-text-muted">Last checked: {dateTime(data.checked_at)}</div>
    </div>
  );
}

/* ================================================================== */
/*  Section: Global Activity Stream                                    */
/* ================================================================== */
function ActivityTab() {
  const { data, status, error, reload } = useApi(() => itActivityStream(80));
  if (status === 'error') return <Card><ErrorState onRetry={reload} message={error} /></Card>;
  if (!data) return <PageSkeleton />;

  return (
    <div className="space-y-4">
      <SectionHeader title="Global Activity Stream" icon={Globe} action={<RefreshButton onClick={reload} />} />
      <Card>
        {data.length === 0 ? (
          <EmptyState compact title="No activity recorded" />
        ) : (
          <div className="divide-y divide-border">
            {data.map(item => <ActivityRow key={item.id} item={item} />)}
          </div>
        )}
      </Card>
    </div>
  );
}

/* ================================================================== */
/*  Section: Incidents                                                 */
/* ================================================================== */
function IncidentsTab() {
  const { data, status, error, reload } = useApi(() => itIncidents());
  if (status === 'error') return <Card><ErrorState onRetry={reload} message={error} /></Card>;
  if (!data) return <PageSkeleton />;

  return (
    <div className="space-y-4">
      <SectionHeader title="IT Incidents" icon={AlertTriangle} count={data.total} />
      <Card>
        {data.items.length === 0 ? (
          <EmptyState compact icon={AlertTriangle} title="No incidents" description="No active incidents in the system." />
        ) : (
          <div className="divide-y divide-border">
            {data.items.map(inc => (
              <div key={inc.incident_id} className="flex items-start justify-between gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono text-text-muted">{inc.incident_id}</span>
                    <Badge tone={severityTone(inc.severity)}>{inc.severity}</Badge>
                    <Badge tone={STATUS_TONE[inc.status] ?? 'neutral'}>{inc.status}</Badge>
                  </div>
                  <p className="mt-1 text-sm font-medium text-text">{inc.title}</p>
                  {inc.affected_service && <p className="text-xs text-text-muted">Affected: {inc.affected_service}</p>}
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-xs text-text-muted">{relativeTime(inc.created_at)}</p>
                  {inc.assigned_to_name && <p className="text-xs text-text-secondary">{inc.assigned_to_name}</p>}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

/* ================================================================== */
/*  Section: IT Tasks                                                  */
/* ================================================================== */
function TasksTab() {
  const { data, status, error, reload } = useApi(() => itTasks());
  if (status === 'error') return <Card><ErrorState onRetry={reload} message={error} /></Card>;
  if (!data) return <PageSkeleton />;

  return (
    <div className="space-y-4">
      <SectionHeader title="IT Task Center" icon={Terminal} count={data.total} />
      <Card>
        {data.items.length === 0 ? (
          <EmptyState compact icon={Terminal} title="No tasks" description="All IT tasks are completed." />
        ) : (
          <div className="divide-y divide-border">
            {data.items.map(task => (
              <div key={task.task_id} className="flex items-start justify-between gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono text-text-muted">{task.task_id}</span>
                    <Badge tone={STATUS_TONE[task.status] ?? 'neutral'}>{task.status.replace('_', ' ')}</Badge>
                    <Badge tone={severityTone(task.priority)}>{task.priority}</Badge>
                    <span className="text-xs text-text-muted capitalize">{task.task_type.replace('_', ' ')}</span>
                  </div>
                  <p className="mt-1 text-sm font-medium text-text">{task.title}</p>
                  {task.assigned_to_name && <p className="text-xs text-text-muted">Assigned: {task.assigned_to_name}</p>}
                </div>
                <div className="shrink-0 text-right">
                  {task.due_date && <p className="text-xs text-text-muted">Due: {dateTime(task.due_date)}</p>}
                  <p className="text-xs text-text-muted">{task.progress}%</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

/* ================================================================== */
/*  Section: Alerts                                                    */
/* ================================================================== */
function AlertsTab() {
  const { data, status, error, reload } = useApi(() => itAlerts());
  if (status === 'error') return <Card><ErrorState onRetry={reload} message={error} /></Card>;
  if (!data) return <PageSkeleton />;

  return (
    <div className="space-y-4">
      <SectionHeader title="Real-Time Alerts" icon={Bell} count={data.total} />
      <Card>
        {data.items.length === 0 ? (
          <EmptyState compact icon={Bell} title="No alerts" description="All clear — no active alerts." />
        ) : (
          <div className="space-y-2 p-3">
            {data.items.map(alert => {
              const border: Record<string, string> = {
                critical: 'border-l-danger', high: 'border-l-danger', medium: 'border-l-warning',
                low: 'border-l-info', info: 'border-l-primary',
              };
              return (
                <div key={alert.alert_id} className={`rounded-md border border-border border-l-[3px] bg-surface-secondary px-3 py-2.5 ${border[alert.severity] ?? 'border-l-border-strong'}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <Badge tone={severityTone(alert.severity)}>{alert.severity}</Badge>
                        <Badge tone={STATUS_TONE[alert.status] ?? 'neutral'}>{alert.status}</Badge>
                      </div>
                      <p className="text-sm font-medium text-text">{alert.title}</p>
                      <p className="text-xs text-text-muted mt-0.5">{alert.message}</p>
                    </div>
                    <span className="text-xs text-text-muted shrink-0">{relativeTime(alert.created_at)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}

/* ================================================================== */
/*  Section: Security                                                  */
/* ================================================================== */
function SecurityTab() {
  const { data, status, error, reload } = useApi(itSecurity);
  if (status === 'error') return <Card><ErrorState onRetry={reload} message={error} /></Card>;
  if (!data) return <PageSkeleton />;

  return (
    <div className="space-y-4">
      <SectionHeader title="Security Operations" icon={Shield} action={<RefreshButton onClick={reload} />} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
        <MetricCard icon={ShieldAlert} label="Failed Logins (24h)" value={number(data.failed_logins_24h)} tone={data.failed_logins_24h > 5 ? 'danger' : data.failed_logins_24h > 0 ? 'warning' : 'success'} />
        <MetricCard icon={KeyRound} label="Locked Accounts" value={number(data.locked_accounts)} tone={data.locked_accounts > 0 ? 'danger' : 'success'} />
        <MetricCard icon={Users} label="Active Accounts" value={number(data.active_accounts)} hint={`${data.superadmins} super admin(s)`} />
        <MetricCard icon={Shield} label="Permission Changes" value={number(data.permission_changes_24h)} tone={data.permission_changes_24h > 0 ? 'warning' : 'success'} hint="last 24h" />
      </div>
      <Card>
        <CardHeader title="Security Events" description="Sign-ins, account changes, and permission updates" />
        {data.events.length === 0 ? (
          <EmptyState compact title="No security events" />
        ) : (
          <div className="divide-y divide-border max-h-[500px] overflow-y-auto">
            {data.events.map((evt, i) => (
              <div key={i} className="flex items-start justify-between gap-3 px-4 py-2.5">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-text">{String(evt.action ?? '').replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c: string) => c.toUpperCase())}</p>
                  <p className="text-xs text-text-muted">{String(evt.performed_by ?? '')} {evt.target ? `→ ${evt.target}` : ''}</p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-xs text-text-muted">{relativeTime(String(evt.timestamp ?? ''))}</p>
                  {!!evt.ip_address && <p className="text-xs text-text-muted">{String(evt.ip_address)}</p>}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

/* ================================================================== */
/*  Section: Sessions                                                  */
/* ================================================================== */
function SessionsTab() {
  const { data, status, error, reload } = useApi(itSessions);
  if (status === 'error') return <Card><ErrorState onRetry={reload} message={error} /></Card>;
  if (!data) return <PageSkeleton />;

  return (
    <div className="space-y-4">
      <SectionHeader title="Active Sessions" icon={Users} action={<RefreshButton onClick={reload} />} />
      <Card>
        {data.length === 0 ? (
          <EmptyState compact icon={Users} title="No active sessions" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-text-muted">
                  <th className="px-4 py-2 font-medium">User</th>
                  <th className="px-4 py-2 font-medium">Role</th>
                  <th className="px-4 py-2 font-medium">Login Time</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data.map(session => (
                  <tr key={session.user_id} className="hover:bg-surface-secondary transition-colors">
                    <td className="px-4 py-2.5">
                      <p className="font-medium text-text">{session.user_name}</p>
                      <p className="text-xs text-text-muted">{session.user_email}</p>
                    </td>
                    <td className="px-4 py-2.5 text-text-secondary capitalize">{session.role}</td>
                    <td className="px-4 py-2.5 text-text-muted">{dateTime(session.login_time)}</td>
                    <td className="px-4 py-2.5"><Badge tone={session.status === 'active' ? 'success' : 'warning'}>{session.status}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

/* ================================================================== */
/*  Section: Database                                                  */
/* ================================================================== */
function DatabaseTab() {
  const { data, status, error, reload } = useApi(itDatabase);
  if (status === 'error') return <Card><ErrorState onRetry={reload} message={error} /></Card>;
  if (!data) return <PageSkeleton />;

  return (
    <div className="space-y-4">
      <SectionHeader title="Database Operations" icon={Database} action={<RefreshButton onClick={reload} />} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <MetricCard icon={Database} label="Status" value={data.connected ? 'Online' : 'Offline'} tone={data.connected ? 'success' : 'danger'} />
        <MetricCard icon={Clock} label="Latency" value={`${data.latency_ms} ms`} tone={data.latency_ms < 500 ? 'success' : data.latency_ms < 1500 ? 'warning' : 'danger'} />
        <MetricCard icon={HardDrive} label="Total Records" value={number(data.total_records)} />
        <MetricCard icon={Zap} label="Connections" value={number(data.active_connections)} />
      </div>
      <Card>
        <CardHeader title="Collections" description={`Records per collection in ${data.schema}`} />
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-text-muted">
                <th className="px-4 py-2 font-medium">Collection</th>
                <th className="px-4 py-2 font-medium text-right">Records</th>
                <th className="px-4 py-2 font-medium">Volume</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data.collections.map(col => {
                const pct = data.total_records > 0 ? (col.count / data.total_records) * 100 : 0;
                return (
                  <tr key={col.name} className="hover:bg-surface-secondary transition-colors">
                    <td className="px-4 py-2 text-text">{col.name.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}</td>
                    <td className="px-4 py-2 text-right font-mono tabular-nums text-text-secondary">{number(col.count)}</td>
                    <td className="px-4 py-2 w-48">
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-neutral-bg">
                        <div className="h-full rounded-full bg-primary" style={{ width: `${Math.max(1, pct)}%` }} />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

/* ================================================================== */
/*  Section: CRM Monitor                                               */
/* ================================================================== */
function CRMTab() {
  const { data, status, error, reload } = useApi(itCRM);
  if (status === 'error') return <Card><ErrorState onRetry={reload} message={error} /></Card>;
  if (!data) return <PageSkeleton />;

  return (
    <div className="space-y-4">
      <SectionHeader title="CRM Monitoring" icon={TrendingUp} action={<RefreshButton onClick={reload} />} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
        <MetricCard icon={Users} label="Total Clients" value={number(data.total_clients)} />
        <MetricCard icon={Activity} label="Active" value={number(data.active_clients)} tone="success" />
        <MetricCard icon={Clock} label="Pending Work" value={number(data.pending_work)} tone={data.pending_work > 0 ? 'warning' : 'success'} />
        <MetricCard icon={AlertTriangle} label="Overdue" value={number(data.overdue)} tone={data.overdue > 0 ? 'danger' : 'success'} />
        <MetricCard icon={FileText} label="On Hold" value={number(data.on_hold)} tone={data.on_hold > 0 ? 'warning' : 'neutral'} />
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <QuickCard title="Work Summary" icon={BarChart3} rows={[
          ['Completed', number(data.completed)],
          ['Pending', number(data.pending_work)],
          ['On Hold', number(data.on_hold)],
          ['Overdue', number(data.overdue)],
        ]} />
        <QuickCard title="Tasks" icon={Terminal} rows={[
          ['Open Tasks', number(data.open_tasks)],
          ['New (30 days)', number(data.new_clients_30d)],
        ]} />
        <QuickCard title="Legal" icon={Shield} rows={[
          ['Legal Records', number(data.total_legal_records)],
          ['Active Clients', number(data.active_clients)],
        ]} />
      </div>
    </div>
  );
}

/* ================================================================== */
/*  Section: Deployments                                               */
/* ================================================================== */
function DeploymentsTab() {
  const { data, status, error, reload } = useApi(() => itDeployments());
  if (status === 'error') return <Card><ErrorState onRetry={reload} message={error} /></Card>;
  if (!data) return <PageSkeleton />;

  return (
    <div className="space-y-4">
      <SectionHeader title="Deployment Center" icon={Upload} count={data.total} />
      <Card>
        {data.items.length === 0 ? (
          <EmptyState compact icon={Upload} title="No deployments" description="No deployment history recorded." />
        ) : (
          <div className="divide-y divide-border">
            {data.items.map((dep, i) => (
              <div key={i} className="flex items-start justify-between gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono text-text-muted">{String(dep.deployment_id ?? '')}</span>
                    <Badge tone="primary">v{String(dep.version ?? '')}</Badge>
                    <Badge tone={String(dep.status) === 'deployed' ? 'success' : 'warning'}>{String(dep.status ?? '')}</Badge>
                  </div>
                  <p className="mt-1 text-sm text-text-secondary">{String(dep.environment ?? '')} — by {String(dep.deployed_by_name ?? '')}</p>
                  {!!dep.release_notes && <p className="text-xs text-text-muted mt-0.5">{String(dep.release_notes)}</p>}
                </div>
                <span className="text-xs text-text-muted shrink-0">{dateTime(String(dep.deployed_at ?? ''))}</span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

/* ================================================================== */
/*  Section: Backups                                                   */
/* ================================================================== */
function BackupsTab() {
  const { data, status, error, reload } = useApi(() => itBackups());
  if (status === 'error') return <Card><ErrorState onRetry={reload} message={error} /></Card>;
  if (!data) return <PageSkeleton />;

  return (
    <div className="space-y-4">
      <SectionHeader title="Backup & Recovery" icon={Archive} count={data.total} />
      <Card>
        {data.items.length === 0 ? (
          <EmptyState compact icon={Archive} title="No backups" description="No backup records found." />
        ) : (
          <div className="divide-y divide-border">
            {data.items.map((bkp, i) => (
              <div key={i} className="flex items-start justify-between gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono text-text-muted">{String(bkp.backup_id ?? '')}</span>
                    <Badge tone={String(bkp.status) === 'completed' ? 'success' : String(bkp.status) === 'running' ? 'primary' : 'danger'}>{String(bkp.status ?? '')}</Badge>
                    <span className="text-xs text-text-muted capitalize">{String(bkp.backup_type ?? 'full')}</span>
                  </div>
                  <p className="mt-1 text-sm text-text-secondary">By {String(bkp.initiated_by_name ?? '')}</p>
                </div>
                <span className="text-xs text-text-muted shrink-0">{dateTime(String(bkp.created_at ?? ''))}</span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

/* ================================================================== */
/*  Section: Emergency Access                                          */
/* ================================================================== */
function EmergencyTab() {
  const { data, status, error, reload } = useApi(itEmergencyAccess);
  if (status === 'error') return <Card><ErrorState onRetry={reload} message={error} /></Card>;
  if (!data) return <PageSkeleton />;

  return (
    <div className="space-y-4">
      <SectionHeader title="Emergency / Break-Glass Access" icon={KeyRound} count={data.total} />
      <div className="rounded-lg border border-danger/20 bg-danger/5 p-3 text-sm text-danger">
        <strong>⚠ Emergency access only.</strong> For critical production incidents requiring elevated privileges. All access is time-limited, logged, and subject to post-incident review.
      </div>
      <Card>
        {data.items.length === 0 ? (
          <EmptyState compact icon={KeyRound} title="No emergency access records" description="No emergency access has been requested." />
        ) : (
          <div className="divide-y divide-border">
            {data.items.map(ea => (
              <div key={ea.access_id} className="flex items-start justify-between gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono text-text-muted">{ea.access_id}</span>
                    <Badge tone={STATUS_TONE[ea.status] ?? 'neutral'}>{ea.status}</Badge>
                  </div>
                  <p className="mt-1 text-sm font-medium text-text">{ea.reason}</p>
                  <p className="text-xs text-text-muted">By {ea.requested_by_name} · {ea.duration_minutes} min · {ea.access_scope.replace(/_/g, ' ')}</p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-xs text-text-muted">{relativeTime(ea.created_at)}</p>
                  {ea.expires_at && <p className="text-xs text-text-muted">Expires: {dateTime(ea.expires_at)}</p>}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

/* ================================================================== */
/*  Section: Global Search                                             */
/* ================================================================== */
function SearchTab() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResults | null>(null);
  const [searching, setSearching] = useState(false);

  const doSearch = useCallback(async () => {
    if (query.length < 2) return;
    setSearching(true);
    try {
      const r = await itSearch(query);
      setResults(r);
    } catch { /* handled by api client */ }
    setSearching(false);
  }, [query]);

  return (
    <div className="space-y-4">
      <SectionHeader title="Global IT Search" icon={Search} />
      <div className="flex gap-2">
        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && doSearch()}
          placeholder="Search users, incidents, tasks, alerts..."
          className="flex-1 rounded-md border border-border bg-surface px-3 py-2 text-sm text-text placeholder:text-text-muted focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
        />
        <button onClick={doSearch} disabled={searching || query.length < 2} className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-50 transition-colors">
          {searching ? 'Searching...' : 'Search'}
        </button>
      </div>
      {results && (
        <div className="space-y-4">
          {Object.entries(results).map(([category, items]) => (
            items && items.length > 0 && (
              <Card key={category}>
                <CardHeader title={category.replace(/^\w/, c => c.toUpperCase())} />
                <div className="divide-y divide-border">
                  {items.map((item: { id: string; title: string; subtitle: string; type: string; status?: string; severity?: string }) => (
                    <div key={item.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-text">{item.title}</p>
                        <p className="text-xs text-text-muted">{item.subtitle}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        {item.status && <Badge tone={STATUS_TONE[item.status] ?? 'neutral'}>{item.status}</Badge>}
                        {item.severity && <Badge tone={severityTone(item.severity)}>{item.severity}</Badge>}
                        <Badge tone="neutral">{item.type}</Badge>
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            )
          ))}
          {Object.values(results).every(v => !v || v.length === 0) && (
            <EmptyState icon={Search} title="No results" description={`No matches found for "${query}".`} />
          )}
        </div>
      )}
    </div>
  );
}

/* ================================================================== */
/*  Shared Building Blocks                                             */
/* ================================================================== */

function MetricCard({ icon: Icon, label, value, hint, tone = 'neutral' }: {
  icon: LucideIcon; label: string; value: string | number; hint?: string; tone?: BadgeTone;
}) {
  const bg: Record<string, string> = {
    success: 'bg-success/10 text-success', danger: 'bg-danger/10 text-danger',
    warning: 'bg-warning/10 text-warning', info: 'bg-info/10 text-info',
    primary: 'bg-primary/10 text-primary', neutral: 'bg-surface-secondary text-text-muted',
  };
  return (
    <div className="rounded-lg border border-border bg-surface p-3 shadow-[var(--shadow-card)]">
      <div className="flex items-center gap-2 mb-2">
        <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${bg[tone]}`}>
          <Icon size={14} />
        </span>
        <span className="text-xs text-text-muted">{label}</span>
      </div>
      <p className="text-lg font-semibold tracking-tight text-text tabular-nums">{value}</p>
      {hint && <p className="text-xs text-text-muted mt-0.5">{hint}</p>}
    </div>
  );
}

function HealthServiceCard({ name, service }: { name: string; service: Record<string, unknown> }) {
  const st = String(service.status ?? 'unknown');
  const dot: Record<string, string> = {
    healthy: 'bg-success', warning: 'bg-warning', critical: 'bg-danger', offline: 'bg-danger', unknown: 'bg-neutral-bg',
  };
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-surface p-3 shadow-[var(--shadow-card)]">
      <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${dot[st] ?? 'bg-neutral-bg'}`} />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-text capitalize">{name.replace(/_/g, ' ')}</p>
        <p className="text-xs text-text-muted">{service.latency_ms ? `${service.latency_ms} ms` : ''} {service.error ? `· ${service.error}` : ''}</p>
      </div>
      <Badge tone={STATUS_TONE[st] ?? 'neutral'}>{st === 'healthy' ? 'Healthy' : st}</Badge>
    </div>
  );
}

function SectionHeader({ title, icon: Icon, count, action }: { title: string; icon?: LucideIcon; count?: number; action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-2">
        {Icon && <Icon size={16} className="text-text-muted" />}
        <h2 className="text-sm font-semibold uppercase tracking-wider text-text-muted">{title}</h2>
        {count !== undefined && <span className="rounded-full bg-surface-secondary px-2 py-0.5 text-xs font-medium text-text-secondary">{count}</span>}
      </div>
      {action}
    </div>
  );
}

function RefreshButton({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex items-center gap-1 text-xs text-text-muted hover:text-primary transition-colors" title="Refresh">
      <RefreshCw size={12} /> Refresh
    </button>
  );
}

function ActivityRow({ item }: { item: ActivityItem }) {
  const riskBorder: Record<string, string> = {
    critical: 'border-l-danger', high: 'border-l-danger', medium: 'border-l-warning', low: 'border-l-transparent',
  };
  return (
    <div className={`flex items-start gap-3 px-4 py-2.5 border-l-2 ${riskBorder[item.risk_level] ?? 'border-l-transparent'} hover:bg-surface-secondary transition-colors`}>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-mono text-text-muted">{item.timestamp ? new Date(item.timestamp.includes('Z') ? item.timestamp : item.timestamp + 'Z').toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : ''}</span>
          <span className="text-sm font-medium text-text">{item.user_name}</span>
          {item.user_role && <span className="text-xs text-text-muted capitalize">{item.user_role}</span>}
        </div>
        <p className="text-sm text-text-secondary mt-0.5">{item.action}</p>
        {item.target && <p className="text-xs text-text-muted">{item.module} → {item.target}</p>}
      </div>
      <div className="shrink-0 text-right">
        {item.ip_address && <p className="text-xs text-text-muted font-mono">{item.ip_address}</p>}
        {item.result !== 'SUCCESS' && <Badge tone="danger" >{item.result}</Badge>}
      </div>
    </div>
  );
}

function QuickCard({ title, icon: _icon, rows, actions }: {
  title: string; icon?: LucideIcon; rows: [string, string | ReactNode][];
  actions?: ReactNode;
}) {
  return (
    <Card>
      <CardHeader title={title} actions={actions} />
      <dl className="divide-y divide-border">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-center justify-between gap-3 px-4 py-2">
            <dt className="text-xs text-text-muted">{label}</dt>
            <dd className="min-w-0 truncate text-sm font-medium text-text">{value}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}
