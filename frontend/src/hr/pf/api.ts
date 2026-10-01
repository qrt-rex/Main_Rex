// PF / EPF endpoints. Every amount shown in the PF screens comes from these responses: the browser never
// works PF out itself (the backend's pf_engine is the only calculation).
import { api } from '../../lib/api';

export type PfStatus = 'CALCULATED' | 'EXEMPT' | 'NOT_APPLICABLE' | 'DISABLED' | 'ERROR';
export type PfBasis = 'BASIC' | 'BASIC_DA' | 'STATUTORY';

export interface PfRule {
  id: string;
  rule_name: string;
  minimum_pf_wage: number;
  maximum_pf_wage: number;
  employee_contribution_percent: number;
  employer_contribution_percent: number;
  eps_percent: number;
  eps_enabled: boolean;
  eps_wage_ceiling: number | null;
  calculation_basis: PfBasis;
  rounding: 'PAISE' | 'RUPEE';
  effective_from: string;
  effective_to: string;
  status: 'ACTIVE' | 'INACTIVE';
  applicability_notes?: string;
  created_by?: string;
  created_at?: string;
  updated_by?: string;
  updated_at?: string;
  used_until?: string | null;
  is_current?: boolean;
  is_future?: boolean;
}

export interface PfSettings {
  enabled: boolean;
  require_uan_to_finalize: boolean;
  require_member_id_to_finalize: boolean;
  updated_by?: string;
  updated_at?: string;
}

export interface PfConfig {
  settings: PfSettings;
  rules: PfRule[];
  current_rule: PfRule | null;
  bases: Record<PfBasis, string>;
  issues: string[];
  today: string;
}

export interface PfIssue { code: string; message: string; blocking: boolean }

/** One PF calculation (pf_engine.evaluate / calculate_pf). */
export interface PfCalculation {
  status?: PfStatus;
  reason?: string;
  issues?: PfIssue[];
  blocking?: boolean;
  steps?: string[];
  rule_id?: string;
  rule_name?: string;
  calculation_basis?: PfBasis;
  calculation_date?: string;
  basic_salary: number;
  da: number;
  pf_base?: number;
  minimum_pf_wage?: number;
  maximum_pf_wage?: number;
  pf_wage: number;
  wage_limited_by?: 'minimum' | 'maximum' | null;
  employee_pf_percent?: number;
  employer_pf_percent?: number;
  eps_percent?: number;
  eps_applicable?: boolean;
  employee_pf: number;
  employer_pf: number;
  eps: number;
  employer_epf: number;
  total_contribution: number;
}

export interface EmployeePfDetails {
  pf_applicable: boolean;
  eps_applicable: boolean;
  uan: string;
  pf_member_id: string;
  previous_pf_member_id: string;
  pf_joining_date: string;
  statutory_pf_wage: number | null;
  exemption_reason: string;
  effective_from: string;
  effective_to: string;
  is_default?: boolean;
  updated_by?: string;
  updated_at?: string;
}

export interface EmployeePfView {
  employee: { id: string; employee_code: string; full_name: string; department: string; branch: string; base_salary: number; da: number };
  details: EmployeePfDetails;
  calculation: PfCalculation;
  rule: PfRule | null;
  settings: PfSettings;
  history?: { month: string; year: number; calculation_date: string; pf_rule_name: string; basic_salary: number; pf_wage: number; employee_pf: number; employer_pf: number; eps_contribution: number; employer_epf: number; status: string }[];
}

export interface PfEmployeeRow {
  employee_id: string;
  employee_code: string;
  employee_name: string;
  department: string;
  branch: string;
  basic_salary: number;
  da: number;
  pf_wage: number;
  employee_pf: number;
  employer_pf: number;
  eps: number;
  employer_epf: number;
  total_contribution: number;
  pf_applicable: boolean;
  eps_applicable: boolean;
  uan: string;
  pf_member_id: string;
  pf_joining_date: string;
  exemption_reason: string;
  details_recorded: boolean;
  pf_status: PfStatus;
  reason: string;
  rule_name: string;
  wage_limited_by: 'minimum' | 'maximum' | null;
  issues: PfIssue[];
  source: 'payroll' | 'projected';
  payroll_finalized: boolean;
}

export interface PfPayrollRow {
  employee_id: string;
  employee_code: string;
  employee_name: string;
  department: string;
  payroll_id: string | null;
  payroll_status: string;
  net_salary: number | null;
  gross_salary: number | null;
  legacy: boolean;
  pf_status: PfStatus | null;
  reason: string | null;
  basic_salary: number;
  minimum_pf_wage: number | null;
  maximum_pf_wage: number | null;
  pf_wage: number;
  employee_pf_percent: number | null;
  employer_pf_percent: number | null;
  eps_percent: number | null;
  employee_pf: number;
  employer_pf: number;
  eps: number;
  employer_epf: number;
  rule_name: string;
  blocking: boolean;
  issues: PfIssue[];
}

export interface PfDashboard {
  period: { month: string; year: number; on: string };
  current_rule: PfRule | null;
  pf_enabled: boolean;
  metrics: Record<
    'employees' | 'pf_covered' | 'pf_exempt' | 'not_applicable' | 'errors' | 'new_members' | 'affected_by_rule' |
    'applicability_changed' | 'total_pf_wage' | 'total_employee_pf' | 'total_employer_pf' | 'total_eps' |
    'total_employer_epf' | 'monthly_liability' | 'missing_uan' | 'incomplete' | 'from_payroll' | 'projected', number>;
  by_department: { department: string; employees: number; pf_wage: number; employee_pf: number; employer_pf: number; eps: number; employer_epf: number }[];
}

export type PfReportKind = 'monthly' | 'department' | 'history' | 'impact' | 'exceptions';
export interface PfReport { kind: PfReportKind; rows: Record<string, unknown>[]; totals: Record<string, number>; rule?: PfRule | null }

export interface PfAuditRow {
  id: string;
  entity: string;
  entity_id: string;
  employee_id: string;
  employee_code: string;
  employee_name: string;
  field_name: string;
  old_value: unknown;
  new_value: unknown;
  changed_by: string;
  changed_by_name: string;
  changed_by_role: string;
  reason: string;
  ip_address: string;
  created_at: string;
}

export interface PfFilters { month?: string; year?: number; department?: string; branch?: string; employee_id?: string; pf_status?: string; pf_applicable?: string; eps_applicable?: string }

export const getPfConfig = () => api.get<PfConfig>('/api/pf/config');
export const updatePfSettings = (body: Partial<PfSettings> & { reason?: string }) => api.put<PfSettings>('/api/pf/settings', body);
export const createPfRule = (body: Record<string, unknown>) => api.post<PfRule>('/api/pf/rules', body);
export const updatePfRule = (id: string, body: Record<string, unknown>) => api.put<PfRule>(`/api/pf/rules/${id}`, body);
export const setPfRuleStatus = (id: string, status: 'ACTIVE' | 'INACTIVE', reason: string) =>
  api.post<PfRule>(`/api/pf/rules/${id}/status`, { status, reason });

export const getEmployeePf = (id: string) => api.get<EmployeePfView>(`/api/employees/${id}/pf`);
export const saveEmployeePf = (id: string, body: Record<string, unknown>) => api.put<EmployeePfView>(`/api/employees/${id}/pf`, body);
export const getMyPf = () => api.get<EmployeePfView>('/api/pf/me');

export const calculatePf = (body: { basic_salary: number; da?: number; employee_id?: string; on_date?: string; rule_id?: string; eps_applicable?: boolean }) =>
  api.post<PfCalculation>('/api/pf/calculate', body);
export const getPfDashboard = (f: PfFilters) => api.get<PfDashboard>('/api/pf/dashboard', f as Record<string, string | number | undefined>);
export const getPfEmployees = (f: PfFilters & { include_inactive?: boolean }) =>
  api.get<{ rows: PfEmployeeRow[] }>('/api/pf/employees', f as Record<string, string | number | boolean | undefined>);
export const getPfPayroll = (f: { month: string; year: number; department?: string }) => api.get<{ rows: PfPayrollRow[] }>('/api/pf/payroll', f);
export const getPfReport = (p: { kind: PfReportKind; start?: string; end?: string; department?: string; branch?: string; employee_id?: string; rule_id?: string; finalized_only?: boolean }) =>
  api.get<PfReport>('/api/pf/reports', p);
export const getPfAudit = (p: { employee_id?: string; entity?: string; start?: string; end?: string }) =>
  api.get<{ rows: PfAuditRow[] }>('/api/pf/audit-logs', p);

export const PF_STATUS_LABEL: Record<PfStatus, string> = {
  CALCULATED: 'PF applicable', EXEMPT: 'Exempt', NOT_APPLICABLE: 'Not applicable', DISABLED: 'PF disabled', ERROR: 'Needs attention',
};
export const PF_STATUS_TONE: Record<PfStatus, 'success' | 'warning' | 'danger' | 'neutral' | 'info'> = {
  CALCULATED: 'success', EXEMPT: 'neutral', NOT_APPLICABLE: 'info', DISABLED: 'neutral', ERROR: 'danger',
};
