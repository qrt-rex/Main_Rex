import { api } from '../lib/api';

export interface Datum { label: string; value: number }

export interface FeedItem {
  id: string;
  title: string;
  description?: string;
  timestamp?: string | null;
  status?: string | null;
  link?: string;
}

export interface TaskItem {
  id: string;
  title: string;
  client: string;
  project: string;
  owner: string;
  status: string;
  reason?: string | null;
  timestamp?: string | null;
}

export interface WorkspaceSummary {
  role: string;
  role_label: string;
  username: string;
  generated_at: string;
  me: {
    employee: {
      full_name?: string; employee_code?: string; designation?: string;
      department?: string; joining_date?: string; status?: string;
    } | null;
    tasks: FeedItem[];
    leaves: FeedItem[];
    payslip: { id: string; period: string; net_salary: number } | null;
  };
  updates: FeedItem[];
  activity: FeedItem[];
  /** Present only when the caller's role grants the matching permission. */
  workforce?: {
    active_employees: number; active_interns: number; present_today: number; late_today: number;
    absent_today: number; pending_leave: number; on_leave_today: number; departments: Datum[];
  };
  payroll?: {
    total_net_disbursed: number; slips_total: number; slips_this_month: number;
    pending_payroll: number; approved_payroll: number;
  };
  recruitment?: {
    total_candidates: number; pending_onboarding: number; by_status: Datum[];
    interviews: { id: string; title: string; description: string; date: string; status: string }[];
  };
  approvals?: FeedItem[];
  clients?: {
    total_clients: number; active_projects: number; open_tasks: number; blocked_tasks: number;
    logged_hours: number; budget_hours: number; by_client: Datum[]; tasks: TaskItem[];
  };
  users?: { total: number; active: number; disabled: number; by_role: Datum[] };
}

export interface SystemStatus {
  infrastructure: {
    app_name: string; version: string; environment: string; python: string;
    platform: string; uptime_seconds: number; debug: boolean;
  };
  database: {
    engine: string; connected: boolean; schema: string; latency_ms: number;
    error: string | null; collections: Datum[];
  };
  monitoring: {
    email_mode: string; session_timeout_minutes: number; token_expiry_minutes: number;
    events_24h: number; sign_ins_24h: number; session_timeouts_24h: number; permission_changes_24h: number;
  };
  deployment?: {
    version: string; environment: string; started_at: string;
    uptime_seconds: number; frontend: string; backend: string;
  };
  security?: {
    accounts_total: number; accounts_active: number; accounts_disabled: number;
    superadmins: number; two_factor: string;
    events: (FeedItem & { ip?: string })[];
  };
  backup?: { last_backup: string | null; last_backup_by: string | null; total_backups_logged: number };
}

export interface SupportDesk {
  total_open: number;
  open_requests: {
    id: string; title: string; client: string; project: string; owner: string;
    category: string; reason: string; raised_by: string; timestamp: string | null;
  }[];
}

export const workspaceSummary = () => api.get<WorkspaceSummary>('/api/workspace/summary');
export const systemStatus = () => api.get<SystemStatus>('/api/workspace/system');
export const supportDesk = () => api.get<SupportDesk>('/api/workspace/desk');
