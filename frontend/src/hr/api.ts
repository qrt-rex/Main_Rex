// Typed access to the integrated Rexera-HR endpoints. Every call goes through lib/api
// (bearer token, 401 handling); the backend enforces the matching RBAC permission.
import { api } from '../lib/api';
import type { IncentiveDetail } from '../sales/performance';

export const DEPARTMENTS = ['SALES', 'ADMIN', 'HR/ADMIN'];
export const BRANCHES = ['AMD', 'BRD'];
export const DESIGNATIONS = ['SALES TL', 'SALES MGR', 'BDM', 'TEAM LEADER', 'SR. TEAM LEADER', 'IT HEAD', 'IT EXECUTIVE', 'ADMIN', 'PEON', 'COO', 'Sr. Financial Analytics'];
export const EMPLOYEE_STATUSES = ['Active', 'Probation', 'Inactive', 'Resigned', 'Terminated'];
export const INTERN_STATUSES = ['Ongoing', 'Under Review', 'Completed', 'Converted to Full-Time', 'Discontinued'];
export const CANDIDATE_STATUSES = ['Applied', 'Screening', 'Interview Scheduled', 'Interviewed', 'Selected', 'Joined', 'On Hold', 'Rejected'];

// ---------- Dashboard ----------
export interface DashboardMetrics {
  total_candidates: number;
  active_employees: number;
  active_interns: number;
  pending_onboarding: number;
  total_payroll_processed: number;
  candidates_by_status: { status: string; count: number }[];
  recent_activities: { id: string; type: string; title: string; description: string; timestamp: string; status: string }[];
  upcoming_interviews: { candidate_name: string; email: string; position: string; interview_date: string; status: string }[];
  my_total_candidates: number;
  my_onboarding: number;
  my_pending_onboarding: number;
  hr_name: string;
  attendance_summary: { today_date: string; present_count: number; late_count: number; half_day_count: number; absent_count: number; total_punched_in: number };
  leaves_summary: { pending_requests_count: number; on_leave_today_count: number };
  productivity_summary: { billed_hours_today: number; active_projects_count: number; red_zone_blockers_count: number };
  broadcasts_summary: { active_broadcasts_count: number; latest_title: string };
  advances_summary: { active_loans_count: number; active_advances_count: number };
}
export const getDashboardMetrics = () => api.get<DashboardMetrics>('/api/dashboard/metrics');

// ---------- Employees ----------
export interface Employee {
  id: string;
  employee_code: string;
  full_name: string;
  email: string;
  mobile_number: string;
  department: string;
  designation: string;
  gender?: string;
  branch?: string;
  reporting_manager?: string;
  date_of_joining: string;
  /** Last working day; payroll leaves the days after it unpaid. */
  date_of_exit?: string;
  base_salary: number;
  hra: number;
  conveyance_allowance: number;
  special_allowance: number;
  professional_tax: number;
  pf_opted: boolean;
  bank_name: string;
  account_no: string;
  ifsc_code: string;
  employee_status: string;
  joining_status: string;
  gross_salary: number;
  estimated_net_salary: number;
}
export interface EmployeeList { total: number; page: number; limit: number; employees: Employee[] }

export const listEmployees = (p: { search?: string; department?: string; status?: string; page?: number; limit?: number }) =>
  api.get<EmployeeList>('/api/employees', p);
export const getEmployee = (id: string, unmask = false) => api.get<Employee>(`/api/employees/${id}`, { unmask: unmask || undefined });
export const createEmployee = (body: Record<string, unknown>) => api.post<Employee>('/api/employees', body);
export const updateEmployee = (id: string, body: Record<string, unknown>) => api.put<Employee>(`/api/employees/${id}`, body);
export const deleteEmployee = (id: string) => api.delete(`/api/employees/${id}`);
export const bulkEmployees = (rows: Record<string, unknown>[]) =>
  api.post<{ inserted_count: number; failed_count: number; message: string }>('/api/employees/bulk', rows);

// ---------- Interns ----------
export interface Intern {
  id: string;
  intern_code: string;
  full_name: string;
  email: string;
  mobile_number: string;
  gender?: string;
  date_of_birth?: string;
  college_university: string;
  degree: string;
  branch_specialization: string;
  current_semester?: string;
  roll_number?: string;
  department: string;
  domain_role: string;
  assigned_mentor: string;
  start_date: string;
  end_date: string;
  duration_months: number;
  internship_type: string;
  monthly_stipend: number;
  bank_name?: string;
  account_no?: string;
  ifsc_code?: string;
  status: string;
  performance_rating?: number | null;
  mentor_feedback?: string;
}
export const listInterns = (p: { search?: string; department?: string; status?: string; page?: number; limit?: number }) =>
  api.get<{ total: number; page: number; limit: number; interns: Intern[] }>('/api/interns', p);
export const getIntern = (id: string, unmask = false) => api.get<Intern>(`/api/interns/${id}`, { unmask: unmask || undefined });
export const createIntern = (body: Record<string, unknown>) => api.post<Intern>('/api/interns', body);
export const deleteIntern = (id: string) => api.delete(`/api/interns/${id}`);
export const convertIntern = (id: string, body: Record<string, unknown>) => api.post<{ message: string }>(`/api/interns/${id}/convert`, body);
export const bulkInterns = (rows: Record<string, unknown>[]) =>
  api.post<{ inserted_count: number; message: string }>('/api/interns/bulk', rows);

// ---------- Recruitment ----------
export interface Candidate {
  id: string;
  candidate_name: string;
  position_applied: string;
  email: string;
  contact_number: string;
  current_company?: string;
  total_experience?: string;
  current_ctc?: string;
  expected_ctc?: string;
  notice_period?: string;
  status: string;
  interview_date?: string;
  interview_notes?: string;
  application_date?: string;
  created_at?: string;
  has_joining_token?: boolean;
  joining_token?: string;
  education?: { degree: string; institution: string; year: string; grade: string }[];
  work_experience?: { company: string; role: string; duration: string; responsibilities: string }[];
  skills?: { name: string; proficiency: string }[];
  languages_known?: string;
  strengths?: string;
  hobbies?: string;
}
export const listCandidates = (p: { search?: string; status?: string; position?: string; page?: number; limit?: number }) =>
  api.get<{ total: number; page: number; limit: number; candidates: Candidate[] }>('/api/candidates', p);
export const getCandidate = (id: string) => api.get<Candidate>(`/api/candidates/${id}`);
export const updateCandidateStatus = (id: string, status: string, interview_notes: string) =>
  api.patch(`/api/candidates/${id}/status`, { status, interview_notes });
export const deleteCandidate = (id: string) => api.delete(`/api/candidates/${id}`);
export const bulkCandidates = (rows: Record<string, unknown>[]) =>
  api.post<{ inserted_count: number; message: string }>('/api/candidates/bulk', rows);
export const generateJoiningToken = (body: { candidate_id: string; full_name: string; email: string; department: string; designation: string }) =>
  api.post<{ token: string }>('/api/joining/generate-token', { ...body, token_type: 'employee', expires_in_days: 7 });

// ---------- Attendance ----------
export interface AttendanceRecord {
  id: string;
  employee_id: string;
  employee_name?: string;
  department?: string;
  attendance_date: string;
  punch_in_local?: string;
  punch_out_local?: string;
  total_work_hours?: number;
  status: string;
  late_minutes?: number;
  penalty_details?: string;
  half_day_reason?: string;
  remarks?: string;
}
export interface AttendanceConfig {
  shift_start_time: string;
  grace_cutoff_time: string;
  late_cutoff_time: string;
  early_logout_cutoff_time: string;
  penalty_type: string;
  hr_notification_email: string;
  [key: string]: unknown;
}
export interface AttendanceSummary {
  records: number;
  employees: number;
  totals: Record<string, number>;
  by_employee: { employee_id: string; employee_name?: string; department?: string; hours: number; [status: string]: string | number | undefined }[];
}
export const listAttendance = (p: { date_str?: string; month?: string; date_from?: string; date_to?: string; employee_id?: string }) =>
  api.get<{ data: AttendanceRecord[]; summary: AttendanceSummary }>('/api/attendance', p);
export const getAttendanceConfig = () => api.get<AttendanceConfig>('/api/attendance/config');
export const saveAttendanceConfig = (cfg: AttendanceConfig) => api.put('/api/attendance/config', cfg);

// ---------- Leave ----------
export interface LeaveRequest {
  id: string;
  _id?: string;
  employee_id: string;
  employee_name: string;
  department?: string;
  leave_type: string;
  start_date: string;
  end_date: string;
  total_days: number;
  status: string;
  reason: string;
  is_loss_of_pay?: boolean;
  lop_days?: number;
  action_by_name?: string;
  approval_level?: 'HR' | 'ADMIN' | 'SUPERADMIN';
  applicant_role?: string;
  created_at?: string;
  conflict_warning?: { has_conflict: boolean; conflict_count: number; conflicting_colleagues: { employee_name: string }[] };
  balances?: { casual_leave_available: number; sick_leave_available: number; earned_leave_available: number };
}
export interface LeaveBalances {
  balances: {
    casual_leave: { available: number };
    sick_leave: { available: number };
    earned_leave: { available: number };
    loss_of_pay_days_ytd: number;
  };
}
export const listLeaves = () => api.get<{ data: LeaveRequest[] }>('/api/leaves');
export const pendingLeaves = () => api.get<{ data: LeaveRequest[] }>('/api/leaves/pending-dashboard');
export const leaveBalances = (employeeId: string) => api.get<LeaveBalances>(`/api/leaves/balances/${encodeURIComponent(employeeId)}`);
export const applyLeave = (body: Record<string, unknown>) => api.post('/api/leaves/apply', body);
/** Your own leave: goes to HR (staff, sales), Admin (HR's) or Super Admin (an admin's). */
export const applyOwnLeave = (body: Record<string, unknown>) => api.post<{ message: string }>('/api/leaves/apply-own', body);
export const decideLeave = (leave_request_id: string, action: 'APPROVE' | 'REJECT', remarks: string) =>
  api.post('/api/leaves/decision', { leave_request_id, action, remarks });

// ---------- Productivity ----------
export interface BirdsEye {
  summary_metrics?: { active_projects_count: number; underutilized_count: number; burnout_risk_count: number };
  employee_efficiency?: { employee_id: string; employee_name: string; department: string; attendance_status: string; present_hours: number; logged_hours: number; efficiency_pct: number; health_status: string }[];
  red_zone_bottlenecks?: { task_title: string; client_name: string; project_name: string; assigned_to: string; blocker_category: string; blocker_reason: string; stuck_duration_hours: number }[];
  active_projects?: { project_name: string; client_name: string; project_manager: string; completed_tasks: number; total_tasks: number; blocked_tasks: number; completion_percentage: number; logged_hours_total: number; budget_hours: number }[];
}
export interface ProjectTask { _id?: string; id?: string; task_title: string; client_name?: string; project_name?: string; }
export const birdsEye = (date: string) => api.get<{ data?: BirdsEye } & BirdsEye>('/api/productivity/dashboard/birds-eye', { date_str: date });
export const listTasks = () => api.get<{ data?: ProjectTask[] } | ProjectTask[]>('/api/productivity/tasks');
export const quickTask = (body: Record<string, unknown>) => api.post('/api/productivity/tasks/quick', body);
export const logTimesheet = (body: Record<string, unknown>) => api.post<{ message?: string }>('/api/productivity/timesheet/log', body);
export const flagBlocker = (body: Record<string, unknown>) => api.post<{ message?: string }>('/api/productivity/tasks/flag-blocker', body);

// ---------- Performance ----------
export interface ChartData { labels: string[]; datasets: { data: number[] }[] }
export interface IndividualReport {
  employee_name: string;
  employee_id: string;
  department: string;
  designation: string;
  score_card: { overall_score: number; grade: string };
  productivity_trend: { direction: 'UP' | 'DOWN' | 'FLAT'; delta_percentage: number; previous_value: number; current_value: number };
  daily_hours_chart: ChartData;
  task_distribution_chart: ChartData;
}
export interface CompanyReport {
  date_range_label: string;
  total_hours_billed_clients: number;
  client_billing_chart: ChartData;
  blocker_categories_chart: ChartData;
}
export const individualReport = (employeeId: string, preset: string) =>
  api.get<IndividualReport>(`/api/reports/preview/individual/${encodeURIComponent(employeeId)}`, { preset });
export const companyReport = (preset: string) => api.get<CompanyReport>('/api/reports/preview/company', { preset });
export const exportReport = (body: { scope: string; export_format: string; employee_id: string | null; preset: string }) =>
  api.post<{ job_id: string; message: string }>('/api/reports/export-async', body);

// ---------- Broadcasts ----------
export interface Broadcast {
  broadcast_id?: string;
  title: string;
  priority: string;
  audience_type: string;
  target_departments?: string[];
  target_branches?: string[];
  total_recipients: number;
  read_count: number;
  read_percentage: number;
  acknowledged_count: number;
  acknowledged_percentage: number;
  created_at?: string;
}
export const listBroadcasts = () => api.get<{ data: Broadcast[] }>('/api/broadcasts');
export const publishBroadcast = (body: Record<string, unknown>) => api.post<{ message: string }>('/api/broadcasts/publish', body);

// ---------- Bulk import ----------
export interface ImportPreview {
  file_id: string;
  file_name: string;
  total_rows_detected: number;
  target_entity: string;
  mappings: { file_header: string; sample_values: string[]; suggested_db_field: string; confidence_score: number; is_required: boolean }[];
  available_db_fields: { field: string; label: string; required: boolean }[];
}
export interface ImportJob {
  status: string;
  progress_percentage?: number;
  total_rows?: number;
  inserted_count?: number;
  updated_count?: number;
  failed_count?: number;
  error_report_file_url?: string;
}
export const previewImport = (file: File, target: string) => {
  const form = new FormData();
  form.append('file', file);
  form.append('target_entity', target);
  return api.post<ImportPreview>('/api/bulk-import/preview-and-map', form);
};
export const executeImport = (body: Record<string, unknown>) => api.post<{ job_id: string }>('/api/bulk-import/execute', body);
export const importJob = (id: string) => api.get<ImportJob>(`/api/bulk-import/jobs/${id}`);

// ---------- Payroll ----------
export interface PayrollRecord {
  id: string;
  _id?: string;
  employee_id: string;
  employee_code: string;
  employee_name: string;
  department: string;
  designation: string;
  month: string;
  year: number;
  status: string;
  is_locked?: boolean;
  gross_salary: number;
  total_deductions: number;
  net_salary: number;
  remarks?: string;
  attendance?: Record<string, number>;
  earnings?: Record<string, number>;
  deductions?: Record<string, number>;
}
export interface PayrollMetrics { total_employees: number; processed_count: number; pending_count: number; total_gross_payroll: number; total_deductions: number; total_net_payroll: number }
export const listPayroll = (p: { month: string; year: number; department?: string; status?: string }) => api.get<PayrollRecord[]>('/api/payroll', p);
export const payrollMetrics = (month: string, year: number) => api.get<PayrollMetrics>('/api/payroll/dashboard-metrics', { month, year });
export const editPayroll = (id: string, body: Record<string, unknown>) => api.put<PayrollRecord>(`/api/payroll/record/${id}`, body);
export const payrollAction = (id: string, action: 'approve' | 'finalize' | 'mark-paid' | 'send-email', body: Record<string, unknown> = {}) =>
  api.post<{ success?: boolean; email?: string; message?: string }>(`/api/payroll/record/${id}/${action}`, body);
export const unlockPayroll = (id: string, reason: string) => api.post(`/api/payroll/record/${id}/unlock`, { reason });
export const calculateBulk = (body: Record<string, unknown>) =>
  api.post<{ total_processed: number; successful_count: number; failed_count: number; failed: { employee_code: string; employee_name: string; reason: string }[] }>('/api/payroll/calculate-bulk', body);
export const sendBulkPayslips = (ids: string[]) => api.post<{ sent_count: number; failed_count: number }>('/api/payroll/send-bulk-email', ids);
export const bankExport = (month: string, year: number) =>
  api.get<{ records: { employee_code: string; employee_name: string; department: string; bank_name: string; account_no: string; ifsc_code: string; net_salary: number; payment_reference: string }[] }>('/api/payroll/bank-export', { month, year });
export const printablePayslip = (id: string) => api.text(`/api/payroll/slip/${id}/printable`);

// ---------- Payslips (salary register) ----------
export interface SalarySlip {
  id: string;
  slip_number: string;
  employee_name: string;
  employee_code: string;
  department: string;
  designation: string;
  month: string;
  year: number;
  net_salary: number;
  earnings: { basic: number; gross_earnings: number };
  deductions: { pf: number; pt: number };
}
export interface SalaryCalc {
  gross_salary: number;
  net_salary: number;
  net_salary_words: string;
  deductions: { pf: number; pt: number; lop_deduction: number; gross_deductions: number };
}
export const salarySummary = (month: string, year: number) =>
  api.get<{ total_slips: number; total_gross_disbursed: number; total_pf_deducted: number; total_pt_deducted: number; total_net_disbursed: number }>('/api/payroll/summary', { month, year });
export const listSlips = (month: string, year: number) => api.get<{ slips: SalarySlip[] }>('/api/payroll/slips', { month, year });
export const deleteSlip = (id: string) => api.delete(`/api/payroll/slip/${id}`);
export const calculateSalary = (body: Record<string, unknown>) => api.post<SalaryCalc>('/api/payroll/calculate-salary', body);
export const generateSlip = (body: Record<string, unknown>) => api.post<SalarySlip>('/api/payroll/generate-slip', body);

/** Sales staff: attendance from Start/End Day and the collection incentive payroll will use. */
export interface SalesPayrollPreview {
  is_sales: boolean;
  attendance: { working_days: number; full_days: number; half_days: number; absent_days: number; paid_leave_days: number; unpaid_leave_days: number; late_count: number; missed_end_day: number; before_joining_days: number; after_exit_days: number } | null;
  incentive: IncentiveDetail | null;
}
export const salesPayrollPreview = (employee_id: string, month: string, year: number) =>
  api.get<SalesPayrollPreview>('/api/payroll/sales-preview', { employee_id, month, year });

// ---------- Advances, loans, bonuses, overtime ----------
export interface Advance { id: string; advance_id: string; employee_name: string; employee_code: string; department: string; request_date: string; advance_amount: number; monthly_deduction_amount: number; paid_amount: number; remaining_balance: number; status: string }
export interface Loan { id: string; loan_id: string; employee_name: string; employee_code: string; department: string; start_date: string; principal_amount: number; interest_rate_percent: number; total_payable: number; monthly_emi: number; remaining_amount: number; status: string }
export interface Bonus { id: string; bonus_id: string; employee_name: string; type: string; reason: string; month: string; year: number; amount: number; status: string }
export interface Overtime { id: string; employee_name: string; date: string; hours: number; rate_per_hour: number; amount: number; approved_by?: string; status: string }
export const listAdvances = () => api.get<Advance[]>('/api/advances');
export const approveAdvance = (id: string) => api.post(`/api/advances/${id}/approve`);
export const listLoans = () => api.get<Loan[]>('/api/loans');
export const listBonuses = () => api.get<Bonus[]>('/api/bonuses');
export const listOvertime = () => api.get<Overtime[]>('/api/overtime');
export const createAdjustment = (kind: 'advances' | 'loans' | 'bonuses' | 'overtime', body: Record<string, unknown>) => api.post(`/api/${kind}`, body);

// ---------- Payroll settings ----------
export interface PayrollSettings {
  company_name: string;
  company_email: string;
  company_phone: string;
  currency: string;
  company_address: string;
  standard_working_days: number;
  salary_proration_method: string;
  late_deduction_rule: string;
  default_pt_amount: number;
  overtime_rate_multiplier: number;
  payslip_prefix: string;
  smtp?: { smtp_host: string; smtp_port: number; smtp_user: string; smtp_password: string; from_name: string; from_email: string; email_dev_mode: boolean; smtp_encryption?: string };
  email_template?: { subject_template: string; body_template: string };
  [key: string]: unknown;
}
export const getPayrollSettings = () => api.get<PayrollSettings>('/api/payroll-settings');
export const savePayrollSettings = (s: PayrollSettings) => api.put<PayrollSettings>('/api/payroll-settings', s);
export const testSmtp = (recipient: string) => api.post<{ message: string }>(`/api/payroll-settings/test-smtp?test_recipient=${encodeURIComponent(recipient)}`);
export const payrollAuditLogs = () => api.get<{ timestamp: string; user_email: string; user_role: string; action: string; entity_type: string; employee_name?: string }[]>('/api/payroll-settings/audit-logs');
export const payrollEmailLogs = () => api.get<{ sent_at: string; employee_name: string; employee_code: string; email: string; payslip_number: string; month: string; year: number; status: string; error_message?: string }[]>('/api/payroll-settings/email-logs');

// ---------- Backup ----------
export const exportAll = () => api.get<Record<string, Record<string, unknown>[]>>('/api/dashboard/export-all');
export const importAll = (payload: Record<string, unknown[]>) => api.post<{ message: string }>('/api/dashboard/import-all', payload);
