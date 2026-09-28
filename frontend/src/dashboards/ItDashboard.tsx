import { Link } from 'react-router-dom';
import {
  Activity, DatabaseBackup, Database, GaugeCircle, KeyRound, ListChecks, Rocket, ScrollText,
  ServerCog, ShieldAlert, ShieldCheck, Users,
} from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { useApi } from '../lib/useApi';
import { dateTime, number } from '../lib/format';
import { Badge, type BadgeTone } from '../components/common/Badge';
import { Card, CardHeader } from '../components/common/Card';
import { ErrorState } from '../components/common/ErrorState';
import { PageSkeleton } from '../components/common/Skeleton';
import { StatCard } from '../components/dashboard/StatCard';
import { HBarChart } from '../components/charts/Charts';
import {
  ActivityTable, AlertPanel, DetailCard, EntityCard, EntityGrid, SectionTitle, StatGrid, TaskPanel, TwoColumn,
} from './components';
import { DashboardIntro } from './DashboardShell';
import { systemStatus, type WorkspaceSummary } from './api';

function uptime(seconds: number) {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  return `${m}m`;
}

/** Technical control centre: infrastructure, database, security, deployment and backups. */
export function ItDashboard({ summary }: { summary: WorkspaceSummary }) {
  const { can } = useAuth();
  const { data: sys, status, error, reload } = useApi(systemStatus);

  if (status === 'error') {
    return (
      <>
        <DashboardIntro subtitle="Systems, security and technical operations." />
        <Card><ErrorState onRetry={reload} message={error} /></Card>
      </>
    );
  }
  if (!sys) return <><DashboardIntro subtitle="Systems, security and technical operations." /><PageSkeleton /></>;

  const dbUp = sys.database.connected;
  const alerts: { id: string; message: string; tone: BadgeTone; detail?: string }[] = [];
  if (!dbUp) {
    alerts.push({ id: 'db', message: 'Database connection is down', tone: 'danger', detail: sys.database.error ?? 'The API cannot reach PostgreSQL.' });
  } else if (sys.database.latency_ms > 800) {
    alerts.push({ id: 'lat', message: `Database responding slowly (${sys.database.latency_ms} ms)`, tone: 'warning', detail: `Schema ${sys.database.schema}` });
  }
  if (sys.infrastructure.debug) {
    alerts.push({ id: 'debug', message: 'Debug mode is enabled', tone: 'warning', detail: 'Disable DEBUG before running in production.' });
  }
  if (sys.monitoring.email_mode.startsWith('Simulated')) {
    alerts.push({ id: 'mail', message: 'Outbound email is simulated', tone: 'info', detail: 'Payslip and broadcast emails are logged, not delivered.' });
  }
  if (sys.security && sys.security.accounts_disabled > 0) {
    alerts.push({ id: 'disabled', message: `${sys.security.accounts_disabled} account(s) disabled`, tone: 'info', detail: 'Disabled accounts cannot sign in.' });
  }
  if (sys.monitoring.permission_changes_24h > 0) {
    alerts.push({ id: 'perm', message: `${sys.monitoring.permission_changes_24h} permission change(s) in the last 24 hours`, tone: 'warning', detail: 'Review them in the security events feed.' });
  }
  if (sys.backup && !sys.backup.last_backup) {
    alerts.push({ id: 'backup', message: 'No backup has been recorded yet', tone: 'warning', detail: 'Run an export from the HR overview to create one.' });
  }
  if (alerts.length === 0) {
    alerts.push({ id: 'ok', message: 'All monitored systems are operating normally', tone: 'success', detail: `Checked ${dateTime(new Date().toISOString())}` });
  }

  return (
    <>
      <DashboardIntro
        subtitle="Systems, security and technical operations."
        actions={<Badge tone={dbUp ? 'success' : 'danger'} dot>{dbUp ? 'All systems operational' : 'Service degraded'}</Badge>}
      />

      <StatGrid>
        <StatCard icon={Database} tone={dbUp ? 'success' : 'danger'} label="Database" value={dbUp ? 'Online' : 'Offline'} hint={`${sys.database.engine} · ${sys.database.latency_ms} ms`} />
        <StatCard icon={ServerCog} label="API uptime" value={uptime(sys.infrastructure.uptime_seconds)} hint={`v${sys.infrastructure.version} · ${sys.infrastructure.environment}`} />
        <StatCard icon={Activity} tone="info" label="Events (24h)" value={number(sys.monitoring.events_24h)} hint={`${sys.monitoring.sign_ins_24h} sign-ins · ${sys.monitoring.session_timeouts_24h} timeouts`} />
        {sys.security && (
          <StatCard icon={Users} tone="warning" label="Active accounts" to={can('users.manage') ? '/admin/users' : undefined} value={number(sys.security.accounts_active)} hint={`${sys.security.superadmins} super admin(s) · ${sys.security.accounts_disabled} disabled`} />
        )}
      </StatGrid>

      <SectionTitle>System status</SectionTitle>
      <TwoColumn
        main={<>
          <AlertPanel title="Alerts" alerts={alerts} />
          <Card>
            <CardHeader title="Database volume" description={`Records per collection in ${sys.database.schema}`} />
            <div className="p-4"><HBarChart data={sys.database.collections} valueLabel="Records" slot={2} /></div>
          </Card>
        </>}
        side={<>
          <DetailCard
            title="Infrastructure"
            rows={[
              ['Application', sys.infrastructure.app_name],
              ['Version', sys.infrastructure.version],
              ['Environment', sys.infrastructure.environment],
              ['Runtime', `Python ${sys.infrastructure.python}`],
              ['Host platform', sys.infrastructure.platform],
              ['Debug mode', <Badge key="d" tone={sys.infrastructure.debug ? 'warning' : 'neutral'}>{sys.infrastructure.debug ? 'On' : 'Off'}</Badge>],
            ]}
          />
          <DetailCard
            title="Database"
            rows={[
              ['Engine', sys.database.engine],
              ['Status', <Badge key="s" tone={dbUp ? 'success' : 'danger'} dot>{dbUp ? 'Connected' : 'Disconnected'}</Badge>],
              ['Schema', sys.database.schema],
              ['Response time', `${sys.database.latency_ms} ms`],
              ['Total records', number(sys.database.collections.reduce((n, c) => n + c.value, 0))],
            ]}
          />
          <DetailCard
            title="Monitoring"
            rows={[
              ['Email delivery', sys.monitoring.email_mode],
              ['Session timeout', `${sys.monitoring.session_timeout_minutes} min`],
              ['Token lifetime', `${sys.monitoring.token_expiry_minutes} min`],
              ['Sign-ins (24h)', number(sys.monitoring.sign_ins_24h)],
              ['Permission changes (24h)', number(sys.monitoring.permission_changes_24h)],
            ]}
          />
          {sys.deployment && (
            <DetailCard
              title="Deployment"
              rows={[
                ['Release', `v${sys.deployment.version}`],
                ['Environment', sys.deployment.environment],
                ['Backend', sys.deployment.backend],
                ['Frontend', sys.deployment.frontend],
                ['Started', dateTime(sys.deployment.started_at)],
                ['Uptime', uptime(sys.deployment.uptime_seconds)],
              ]}
            />
          )}
          {sys.backup && (
            <DetailCard
              title="Backup"
              description="Full dataset exports"
              rows={[
                ['Last backup', sys.backup.last_backup ? dateTime(sys.backup.last_backup) : 'Never'],
                ['Run by', sys.backup.last_backup_by || '—'],
                ['Backups logged', number(sys.backup.total_backups_logged)],
              ]}
              actions={can('hr.backup.manage') ? <Link to="/hr" className="text-xs font-medium text-primary hover:underline">Run a backup</Link> : undefined}
            />
          )}
        </>}
      />

      <SectionTitle>Technical operations</SectionTitle>
      <EntityGrid>
        <EntityCard icon={ServerCog} title="Infrastructure" description="Runtime, environment and release information" metric={uptime(sys.infrastructure.uptime_seconds)} metricLabel="uptime" />
        <EntityCard icon={Database} title="Database" description={`PostgreSQL · schema ${sys.database.schema}`} metric={`${sys.database.latency_ms} ms`} metricLabel="response" badge={{ label: dbUp ? 'Online' : 'Offline', tone: dbUp ? 'success' : 'danger' }} />
        <EntityCard icon={GaugeCircle} title="Monitoring" description="Session, delivery and event telemetry" metric={number(sys.monitoring.events_24h)} metricLabel="events in 24h" />
        {sys.deployment && (
          <EntityCard icon={Rocket} title="Deployment" description={`${sys.deployment.backend} and ${sys.deployment.frontend}`} metric={`v${sys.deployment.version}`} metricLabel={sys.deployment.environment} />
        )}
        {sys.security && (
          <EntityCard icon={ShieldCheck} title="Security" description={sys.security.two_factor} metric={number(sys.security.accounts_active)} metricLabel="active accounts" />
        )}
        {sys.backup && (
          <EntityCard icon={DatabaseBackup} title="Backup and restore" description="Export or restore the full dataset" to={can('hr.backup.manage') ? '/hr' : undefined} metric={sys.backup.last_backup ? dateTime(sys.backup.last_backup) : 'Never'} metricLabel="last run" />
        )}
        {can('users.manage') && (
          <EntityCard icon={KeyRound} title="Emergency technical access" description="Reset credentials, enable or disable an account" to="/admin/users" metric={number(sys.security?.accounts_total ?? 0)} metricLabel="accounts" />
        )}
        {can('permissions.manage') && (
          <EntityCard icon={ShieldAlert} title="Access management" description="Change what each role can reach" to="/admin/permissions" />
        )}
        {can('audit.view') && (
          <EntityCard icon={ScrollText} title="All user logs" description="Every sign-in and change across the CRM" to="/admin/activity" metric={number(sys.monitoring.events_24h)} metricLabel="in the last 24h" />
        )}
      </EntityGrid>

      <SectionTitle>Work and audit</SectionTitle>
      <TwoColumn
        main={sys.security ? (
          <ActivityTable
            title="Security events"
            description="Sign-ins, account changes and permission updates"
            items={sys.security.events}
            link={can('audit.view') ? { to: '/admin/activity', label: 'Full activity log' } : undefined}
          />
        ) : (
          <ActivityTable title="Recent activity" items={summary.activity} link={can('audit.view') ? { to: '/admin/activity', label: 'Full activity log' } : undefined} />
        )}
        side={<>
          <TaskPanel
            title="Pending technical tasks"
            description="Assigned to you"
            items={summary.me.tasks}
            emptyTitle="No tasks assigned"
            emptyDescription="Delivery tasks assigned to your account appear here."
            emptyIcon={ListChecks}
          />
          <TaskPanel
            title="Company updates"
            items={summary.updates}
            emptyTitle="No announcements"
            emptyIcon={ScrollText}
          />
        </>}
      />
    </>
  );
}
