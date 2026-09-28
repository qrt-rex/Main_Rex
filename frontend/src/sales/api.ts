// Sales workspace: leads & dialer, schemes, company material, team progress and day attendance.
import { api, request } from '../lib/api';

export interface Person { user_id: string; name: string; email: string }
export interface Lead {
  id: string;
  name: string;
  company: string;
  phone: string;
  email: string;
  city: string;
  source: string;
  service_interest: string;
  notes: string;
  status: string;
  follow_up_date: string | null;
  assigned_to: Person | null;
  call_count?: number;
  last_outcome?: string;
  last_note?: string;
  last_call_at?: string;
  created_at: string;
}
export interface Scheme { id: string; title: string; description: string; valid_from: string | null; valid_to: string | null; active: boolean; created_at: string }
export interface Material { id: string; title: string; kind: string; description: string; link: string; active: boolean; has_file: boolean; filename?: string; size?: number; created_at: string }
export interface ProgressRow {
  user_id: string; name: string; email: string; leads_assigned: number; leads_open: number; calls: number; connected: number;
  interested: number; converted: number; converted_total: number; follow_ups_due: number; day_status: string; hours_today: number;
}
export interface AttendanceRow {
  user_id: string; name: string; email: string; role_label: string; status: 'NOT_STARTED' | 'WORKING' | 'DAY_ENDED';
  started_at: string | null; ended_at: string | null; hours: number; last_login: string | null;
}
export interface DaySession { id: string; date: string; started_at: string; ended_at: string | null }
export interface SalesSummary {
  me: Person; can_manage: boolean; today: string; session: DaySession | null; leads: Lead[]; schemes: Scheme[];
  materials: Material[]; progress: ProgressRow[]; attendance: AttendanceRow[];
}
export interface Assignee { id: string; name: string; email: string; role: string; role_label: string }

export const LEAD_STATUSES = ['NEW', 'ATTEMPTED', 'CALL_BACK', 'INTERESTED', 'NOT_INTERESTED', 'CONVERTED', 'INVALID'];
export const OUTCOMES: [string, string][] = [
  ['NO_ANSWER', 'No answer'], ['BUSY', 'Busy / switched off'], ['CALL_BACK', 'Call back later'], ['INTERESTED', 'Interested'],
  ['NOT_INTERESTED', 'Not interested'], ['CONVERTED', 'Converted (sale)'], ['WRONG_NUMBER', 'Wrong number'],
];
export const MATERIAL_KINDS: [string, string][] = [
  ['POST', 'Social post'], ['FLYER', 'Flyer'], ['PDF', 'PDF / brochure'], ['SALES_INFO', 'Sales information'], ['VIDEO', 'Video'], ['OTHER', 'Other'],
];
export const kindLabel = (k: string) => MATERIAL_KINDS.find(([id]) => id === k)?.[1] ?? k;

export const salesSummary = () => api.get<SalesSummary>('/api/sales-hub/summary');
export const startDay = () => api.post<DaySession>('/api/sales-hub/day/start');
export const endDay = () => api.post<DaySession>('/api/sales-hub/day/end');
export const logCall = (leadId: string, body: { outcome: string; note: string; follow_up_date?: string }) =>
  api.post<{ lead: Lead }>(`/api/sales-hub/leads/${leadId}/calls`, body);
export const leadCalls = (leadId: string) =>
  api.get<{ items: { outcome: string; note: string; name: string; at: string; follow_up_date: string | null }[] }>(`/api/sales-hub/leads/${leadId}/calls`);
export const progress = (from: string, to: string) => api.get<{ rows: ProgressRow[] }>('/api/sales-hub/progress', { from, to });
export const attendance = (date: string) => api.get<{ board: AttendanceRow[] }>('/api/sales-hub/attendance', { date });
export const materialFile = (id: string) => api.blob(`/api/sales-hub/materials/${id}/file`);

// Management (Admin & Legal)
export const assignees = () => api.get<{ users: Assignee[] }>('/api/sales-hub/assignees');
export const listLeads = (p: { search?: string; status?: string; assigned?: string }) => api.get<{ items: Lead[]; total: number }>('/api/sales-hub/leads', p);
export const saveLead = (id: string | null, body: Record<string, unknown>) =>
  id ? api.put<Lead>(`/api/sales-hub/leads/${id}`, body) : api.post<Lead>('/api/sales-hub/leads', body);
export const deleteLead = (id: string) => api.delete(`/api/sales-hub/leads/${id}`);
export const importLeads = (rows: Record<string, unknown>[]) =>
  api.post<{ message: string; imported: number; errors: { row: number; error: string }[] }>('/api/sales-hub/leads/import', rows);
export const listSchemes = () => api.get<{ items: Scheme[] }>('/api/sales-hub/schemes');
export const saveScheme = (id: string | null, body: Record<string, unknown>) =>
  id ? api.put<Scheme>(`/api/sales-hub/schemes/${id}`, body) : api.post<Scheme>('/api/sales-hub/schemes', body);
export const deleteScheme = (id: string) => api.delete(`/api/sales-hub/schemes/${id}`);
export const listMaterials = () => api.get<{ items: Material[] }>('/api/sales-hub/materials');
export const saveMaterial = (id: string | null, form: FormData) =>
  id ? request<Material>(`/api/sales-hub/materials/${id}`, { method: 'PUT', body: form }) : api.post<Material>('/api/sales-hub/materials', form);
export const deleteMaterial = (id: string) => api.delete(`/api/sales-hub/materials/${id}`);

/** "09:42 am" from a naive-UTC timestamp. */
export const clock = (v?: string | null) => {
  if (!v) return '—';
  const d = new Date(/[zZ]|[+-]\d\d:\d\d$/.test(v) ? v : `${v}Z`);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
};
