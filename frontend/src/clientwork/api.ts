import { api, request, qs } from '../lib/api';

export type WorkStatus = 'NEED_ACTION' | 'IN_PROGRESS' | 'ON_HOLD' | 'COMPLETED' | 'CANCELLED';
export type Priority = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
export type TaskStatus = 'PENDING' | 'IN_PROGRESS' | 'WAITING_FOR_CLIENT' | 'COMPLETED' | 'CANCELLED';
export type HoldType = 'WAITING_FOR_CLIENT' | 'INTERNAL_BLOCKER';
export type Bucket = 'need_action' | 'on_hold' | 'completed';

export const PRIORITIES: Priority[] = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];
export const TASK_STATUSES: TaskStatus[] = ['PENDING', 'IN_PROGRESS', 'WAITING_FOR_CLIENT', 'COMPLETED', 'CANCELLED'];

interface Person { user_id: string; name: string; email: string; role?: string }

export interface HoldInfo {
  hold_id: string; type: HoldType; label: string; reason: string; required_from_client: string; pending_items: string[];
  expected_response_date: string | null; internal_note: string; started_at: string; started_by: string;
  days_waiting: number; seconds_waiting: number;
}

export interface ClientRequest {
  id: string; kind: 'DOCUMENT' | 'INFORMATION'; label: string; status: 'PENDING' | 'RECEIVED' | 'WAIVED'; mandatory: boolean;
  requested_at: string; requested_by: string; expected_date: string | null; note: string; received_at: string | null;
  received_by: string | null; response_note: string; task_id?: string | null;
}

export interface Work {
  id: string; work_no: string; client_kind: 'record' | 'document'; client_id: string; client_ref: string; client_name: string;
  client: Record<string, unknown> & { reference?: string; company_name?: string; contact_name?: string; contact_email?: string; contact_phone?: string; gstin?: string; bdm?: string; services?: string[]; documents?: string[]; legal_status?: string };
  assigned_by: Person; assigned_to: Person; assignee_id: string; legal_owner_id: string;
  work_type: string; priority: Priority; status: WorkStatus; required_action: string;
  created_at: string; started_at: string | null; completed_at: string | null; deadline: string | null;
  total_tasks: number; completed_tasks: number; pending_tasks: number; client_pending_tasks: number; progress: number;
  hold_count: number; completion_notes: string; completed_by?: { user_id: string; name: string } | null;
  total_duration?: number; active_duration?: number; hold_duration?: number;
  last_activity_at: string; version: number;
  durations: { total: number; hold: number; active: number };
  deadline_info: { state: 'NO_DEADLINE' | 'CLOSED' | 'OVERDUE' | 'DUE_TODAY' | 'DUE_SOON' | 'ON_TRACK'; days_left: number | null; label: string };
  hold: HoldInfo | null; hold_label: string | null; bucket: Bucket | null; pending_items_count: number;
  days_open: number; days_on_hold: number; time_elapsed_seconds: number; next_action: string;
  pending_requests: ClientRequest[];
  completion_history?: { completed_by: string; completed_at: string; total_duration: number; active_duration: number; hold_duration: number; total_tasks: number; completed_tasks: number; notes: string }[];
}

export interface Task {
  id: string; work_id: string; name: string; description: string; assigned_to: Person; created_by: string; created_at: string;
  due_date: string | null; status: TaskStatus; priority: Priority; completion_pct: number; required: boolean;
  completed_at: string | null; version: number; overdue: boolean;
  comments?: Comment[]; attachments?: WorkFile[]; history?: Activity[];
}

export interface WorkDetail extends Work {
  tasks: Task[]; blockers: string[]; ready_to_complete: boolean; can_act: boolean; can_manage: boolean; can_override: boolean;
  allowed_transitions: WorkStatus[]; previous_works: { id: string; work_no: string; status: WorkStatus; created_at: string; completed_at: string | null }[];
}

export interface Comment {
  id: string; work_id: string; task_id: string | null; kind: 'COMMENT' | 'NOTE' | 'ISSUE'; text: string; critical: boolean; resolved: boolean;
  user_name: string; role: string; created_at: string;
}

export interface WorkFile {
  id: string; work_id: string; task_id: string | null; request_id: string | null; label: string; filename: string; size: number;
  uploaded_by: string; uploaded_at: string; note: string;
}

export interface Activity {
  id: string; work_id: string; task_id: string | null; at: string; user_name: string; role: string; action: string; summary: string;
  old_value: unknown; new_value: unknown; comment: string;
}

export interface Facets { assignees: { id: string; name: string }[]; legal: { id: string; name: string }[]; work_types: string[] }
export interface WorkList { items: Work[]; total: number; skip: number; limit: number; facets: Facets }

export interface WaitingItem {
  id: string; work_id: string; client_name: string; client_ref: string; assigned_to: string; required_action: string; required_document: string;
  kind: string; requested_at: string; days_waiting: number; expected_date: string | null; overdue: boolean; work_status: WorkStatus;
  hold_label: string | null; status: string;
}

export interface Counters {
  need_action: number; in_progress: number; on_hold: number; completed: number; total_active: number; my_clients: number;
  overdue: number; due_today: number; due_soon: number; completed_today: number; completed_this_week: number; completed_this_month: number;
  waiting_for_client: number; internal_blocker: number;
}
export interface Summary { scope: 'all' | 'mine'; counters: Counters; generated_at: string }

export interface Datum { label: string; value: number }
export interface Stats extends Summary {
  status_chart: Datum[];
  performance: { total_clients: number; avg_completion_seconds: number; avg_active_seconds: number; avg_hold_seconds: number; avg_response_seconds: number; completed_work: number; pending_work: number; overdue_work: number };
  trend: { daily: Datum[]; weekly: Datum[]; monthly: Datum[] };
  hold_analysis: { total_on_hold: number; waiting_for_client: number; internal_blocker: number; avg_hold_seconds: number; chart: Datum[] };
  members?: { user_id: string; name: string; assigned: number; completed: number; pending: number; overdue: number; avg_completion_seconds: number }[];
}

export interface WorkHistory {
  status_history: { id: string; from_status: string | null; to_status: string; at: string; user_name: string; role: string; reason: string }[];
  holds: { id: string; type: HoldType; reason: string; required_from_client: string; pending_items: string[]; expected_response_date: string | null; internal_note: string;
    started_at: string; started_by: string; ended_at: string | null; ended_by: string | null; resume_reason: string; duration_seconds: number | null; auto_resumed: boolean; open?: boolean }[];
  time_logs: { id: string; event: string; at: string; user_name: string; note: string }[];
  durations: { total: number; hold: number; active: number };
  summary: { assigned_at: string; started_at: string | null; completed_at: string | null; hold_count: number };
}

export interface Filters {
  bucket?: Bucket | ''; status?: string; priority?: string; work_type?: string; assignee?: string; legal?: string; search?: string;
  deadline_from?: string; deadline_to?: string; created_from?: string; created_to?: string; overdue?: boolean; waiting_for_client?: boolean;
  due?: string; sort?: string; order?: 'asc' | 'desc'; skip?: number; limit?: number;
}

interface Mutation<T = Work> { success: boolean; message: string; work: T }

const key = () => (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`);
const send = <T>(method: string, path: string, body?: unknown) =>
  request<T>(path, { method, body: JSON.stringify(body ?? {}), headers: { 'Idempotency-Key': key() } });

const B = '/api/client-work';
export const cw = {
  summary: (mine = false) => api.get<Summary>(`${B}/summary`, mine ? { mine: true } : {}),
  stats: () => api.get<Stats>(`${B}/stats`),
  list: (f: Filters, mine = false) => api.get<WorkList>(`${B}/work${mine ? '/mine' : ''}`, f as Record<string, string | number | boolean>),
  waiting: (f: Filters) => api.get<{ items: WaitingItem[]; total: number }>(`${B}/waiting`, f as Record<string, string | number | boolean>),
  detail: (id: string) => api.get<WorkDetail>(`${B}/work/${id}`),
  history: (id: string) => api.get<WorkHistory>(`${B}/work/${id}/history`),
  timeline: (id: string) => api.get<{ items: Activity[] }>(`${B}/work/${id}/timeline`),
  comments: (id: string) => api.get<{ items: Comment[] }>(`${B}/work/${id}/comments`),
  documents: (id: string) => api.get<{ requests: ClientRequest[]; files: WorkFile[] }>(`${B}/work/${id}/documents`),
  notifications: () => api.get<{ items: { id: string; title: string; message: string; created_at: string; read: boolean; link: string }[]; unread: number }>(`${B}/notifications`),

  start: (id: string) => send<Mutation>('POST', `${B}/work/${id}/start`),
  hold: (id: string, body: { hold_type: HoldType; reason: string; required_from_client: string; pending_documents: string[]; expected_response_date: string | null; internal_note: string }) =>
    send<Mutation>('POST', `${B}/work/${id}/hold`, body),
  resume: (id: string, note: string) => send<Mutation>('POST', `${B}/work/${id}/resume`, { note }),
  complete: (id: string, note: string) => send<Mutation>('POST', `${B}/work/${id}/complete`, { note }),
  setStatus: (id: string, status: WorkStatus, reason: string) => send<Mutation>('PATCH', `${B}/work/${id}/status`, { status, reason }),
  update: (id: string, body: { priority?: Priority; deadline?: string; required_action?: string; work_type?: string; note?: string }) =>
    send<Mutation>('PATCH', `${B}/work/${id}`, body),
  reassign: (id: string, user_id: string, note: string) => send<Mutation>('PUT', `${B}/work/${id}/assign`, { user_id, note }),

  createTask: (id: string, body: { name: string; description?: string; due_date?: string | null; priority?: Priority; required?: boolean }) =>
    send<Mutation & { task: Task }>('POST', `${B}/work/${id}/tasks`, body),
  updateTask: (taskId: string, body: Partial<Pick<Task, 'name' | 'description' | 'due_date' | 'priority' | 'status' | 'completion_pct'>> & { comment?: string; version?: number }) =>
    send<Mutation & { task: Task }>('PATCH', `${B}/tasks/${taskId}`, body),
  completeTask: (taskId: string, note = '') => send<Mutation & { task: Task }>('POST', `${B}/tasks/${taskId}/complete`, { note }),

  comment: (id: string, body: { text: string; kind: 'COMMENT' | 'NOTE' | 'ISSUE'; task_id?: string | null; critical?: boolean }) =>
    send<{ success: boolean; comment: Comment }>('POST', `${B}/work/${id}/comments`, body),
  resolveIssue: (commentId: string) => send<{ success: boolean }>('POST', `${B}/comments/${commentId}/resolve`),
  requestFromClient: (id: string, body: { kind: 'DOCUMENT' | 'INFORMATION'; label: string; expected_date?: string | null; note?: string; mandatory?: boolean }) =>
    send<Mutation & { request: ClientRequest }>('POST', `${B}/work/${id}/document-requests`, body),
  clientResponse: (id: string, body: { note: string; request_ids?: string[]; resolve_all?: boolean }) =>
    send<{ success: boolean; work: Work; resolved: number }>('POST', `${B}/work/${id}/client-response`, body),
  upload: (id: string, file: File, extra: { label?: string; request_id?: string; task_id?: string; note?: string }) => {
    const fd = new FormData();
    fd.append('file', file);
    Object.entries(extra).forEach(([k, v]) => v && fd.append(k, v));
    return api.post<{ success: boolean; document: WorkFile; work: Work }>(`${B}/work/${id}/documents`, fd);
  },
  download: (docId: string) => api.blob(`${B}/documents/${docId}/file`),
  markRead: () => send<{ success: boolean }>('POST', `${B}/notifications/read`, {}),
};

export const filterQs = (f: Filters) => qs(f as Record<string, string | number | boolean>);
