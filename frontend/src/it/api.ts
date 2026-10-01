/**
 * IT Command Center API client.
 *
 * All requests go through the central `api` client which handles
 * authentication and error reporting automatically.
 */
import { api } from '../lib/api';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface ServiceHealth {
  status: 'healthy' | 'warning' | 'critical' | 'offline' | 'unknown';
  latency_ms: number;
  last_check: string;
  error?: string;
  [key: string]: unknown;
}

export interface HealthCheck {
  overall: string;
  services: Record<string, ServiceHealth>;
  checked_at: string;
}

export interface ITDashboardData {
  health: HealthCheck;
  active_users: number;
  online_users: number;
  failed_logins_24h: number;
  security_alerts: number;
  pending_it_tasks: number;
  open_incidents: number;
  latest_backup: Record<string, unknown> | null;
  latest_deployment: Record<string, unknown> | null;
  application_errors_24h: number;
  events_24h: number;
  sign_ins_24h: number;
  infrastructure: {
    app_name: string;
    version: string;
    environment: string;
    python: string;
    platform: string;
    uptime_seconds: number;
    debug: boolean;
  };
}

export interface ActivityItem {
  id: string;
  timestamp: string;
  user_name: string;
  user_role: string;
  action: string;
  action_raw: string;
  module: string;
  target: string;
  ip_address: string;
  details: Record<string, unknown>;
  result: string;
  risk_level: string;
  source: string;
}

export interface Incident {
  id?: string;
  _id?: string;
  incident_id: string;
  severity: string;
  title: string;
  description: string;
  affected_service: string;
  affected_users: number;
  assigned_to: string;
  assigned_to_name: string;
  status: string;
  created_by: string;
  created_by_name: string;
  created_at: string;
  started_at: string | null;
  resolved_at: string | null;
  root_cause: string;
  resolution: string;
  postmortem: string;
  timeline: { action: string; by: string; at: string; note: string }[];
}

export interface ITTask {
  id?: string;
  _id?: string;
  task_id: string;
  title: string;
  description: string;
  task_type: string;
  priority: string;
  assigned_to: string;
  assigned_to_name: string;
  due_date: string | null;
  status: string;
  progress: number;
  created_by: string;
  created_by_name: string;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface Alert {
  id?: string;
  _id?: string;
  alert_id: string;
  title: string;
  message: string;
  severity: string;
  category: string;
  status: string;
  acknowledged_by: string | null;
  acknowledged_at: string | null;
  resolved_by: string | null;
  resolved_at: string | null;
  created_at: string;
}

export interface SessionInfo {
  user_id: string;
  user_name: string;
  user_email: string;
  role: string;
  login_time: string;
  last_activity: string;
  status: string;
}

export interface EmergencyAccess {
  id?: string;
  _id?: string;
  access_id: string;
  reason: string;
  access_scope: string;
  duration_minutes: number;
  requested_by: string;
  requested_by_name: string;
  status: string;
  created_at: string;
  approved_at: string | null;
  approved_by: string | null;
  expires_at: string | null;
  revoked_at: string | null;
}

export interface SecurityOverview {
  failed_logins_24h: number;
  locked_accounts: number;
  disabled_accounts: number;
  permission_changes_24h: number;
  role_changes_24h: number;
  total_accounts: number;
  active_accounts: number;
  superadmins: number;
  two_factor: string;
  events: Record<string, unknown>[];
}

export interface DatabaseStatus {
  connected: boolean;
  engine: string;
  schema: string;
  latency_ms: number;
  error: string | null;
  total_records: number;
  collections: { name: string; count: number }[];
  active_connections: number;
}

export interface CRMOverview {
  total_clients: number;
  active_clients: number;
  new_clients_30d: number;
  pending_work: number;
  on_hold: number;
  completed: number;
  overdue: number;
  open_tasks: number;
  total_legal_records: number;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  limit?: number;
}

export interface SearchResults {
  users?: { id: string; title: string; subtitle: string; type: string }[];
  incidents?: { id: string; title: string; subtitle: string; type: string; status?: string }[];
  tasks?: { id: string; title: string; subtitle: string; type: string; status?: string }[];
  alerts?: { id: string; title: string; subtitle: string; type: string; severity?: string }[];
}

/* ------------------------------------------------------------------ */
/*  API Functions                                                      */
/* ------------------------------------------------------------------ */

export const itDashboard = () => api.get<ITDashboardData>('/api/it/dashboard');
export const itHealth = () => api.get<HealthCheck>('/api/it/health');
export const itActivityStream = (limit = 50) => api.get<ActivityItem[]>('/api/it/activity-stream', { limit });
export const itAuditLogs = (params: Record<string, unknown> = {}) => api.get<Paginated<Record<string, unknown>>>('/api/it/audit-logs', params as Record<string, string>);

export const itIncidents = (params: Record<string, string> = {}) => api.get<Paginated<Incident>>('/api/it/incidents', params);
export const itIncident = (id: string) => api.get<Incident>(`/api/it/incidents/${id}`);
export const createIncident = (data: Record<string, unknown>) => api.post<Incident>('/api/it/incidents', data);
export const updateIncident = (id: string, data: Record<string, unknown>) => api.patch<Incident>(`/api/it/incidents/${id}`, data);

export const itTasks = (params: Record<string, string> = {}) => api.get<Paginated<ITTask>>('/api/it/tasks', params);
export const itTask = (id: string) => api.get<ITTask>(`/api/it/tasks/${id}`);
export const createITTask = (data: Record<string, unknown>) => api.post<ITTask>('/api/it/tasks', data);
export const updateITTask = (id: string, data: Record<string, unknown>) => api.patch<ITTask>(`/api/it/tasks/${id}`, data);

export const itAlerts = (params: Record<string, string> = {}) => api.get<Paginated<Alert>>('/api/it/alerts', params);
export const acknowledgeAlert = (id: string) => api.post<Alert>(`/api/it/alerts/${id}/acknowledge`);
export const resolveAlert = (id: string) => api.post<Alert>(`/api/it/alerts/${id}/resolve`);

export const itSecurity = () => api.get<SecurityOverview>('/api/it/security');
export const itSessions = () => api.get<SessionInfo[]>('/api/it/sessions');
export const revokeSession = (userId: string) => api.post(`/api/it/sessions/${userId}/revoke`);

export const itDeployments = (params: Record<string, string> = {}) => api.get<Paginated<Record<string, unknown>>>('/api/it/deployments', params);
export const recordDeployment = (data: Record<string, unknown>) => api.post('/api/it/deployments', data);

export const itBackups = (params: Record<string, string> = {}) => api.get<Paginated<Record<string, unknown>>>('/api/it/backups', params);
export const createBackup = (data: Record<string, unknown>) => api.post('/api/it/backups', data);

export const itDatabase = () => api.get<DatabaseStatus>('/api/it/database');
export const itCRM = () => api.get<CRMOverview>('/api/it/crm');

export const requestEmergencyAccess = (data: Record<string, unknown>) => api.post<EmergencyAccess>('/api/it/emergency-access/request', data);
export const approveEmergencyAccess = (id: string) => api.post<EmergencyAccess>(`/api/it/emergency-access/${id}/approve`);
export const revokeEmergencyAccess = (id: string) => api.post<EmergencyAccess>(`/api/it/emergency-access/${id}/revoke`);
export const itEmergencyAccess = () => api.get<Paginated<EmergencyAccess>>('/api/it/emergency-access');

export const itUserActivity = (userId: string) => api.get<Record<string, unknown>>(`/api/it/users/${userId}/activity`);
export const itSearch = (q: string) => api.get<SearchResults>('/api/it/search', { q });
