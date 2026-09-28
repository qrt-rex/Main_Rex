// Spreadsheet import/export (ported from Rexera-HR's importer.js). SheetJS is loaded on
// demand so it never weighs on the initial bundle.
type Row = Record<string, unknown>;

const loadXlsx = () => import('xlsx');

// Known column aliases -> the field names the HR API expects.
const FIELD_ALIASES: Record<string, string[]> = {
  full_name: ['full_name', 'fullname', 'name', 'employee_name', 'candidate_name', 'intern_name', 'person_name', 'emp_name', 'candidate', 'intern'],
  gender: ['gender', 'sex'],
  date_of_birth: ['date_of_birth', 'dob', 'birth_date', 'birthdate'],
  email: ['email', 'email_address', 'mail', 'e_mail', 'candidate_email', 'emp_email'],
  mobile_number: ['mobile_number', 'mobile', 'phone', 'contact_number', 'contact', 'phone_number', 'cell', 'telephone'],
  employee_code: ['employee_code', 'emp_code', 'code', 'emp_id'],
  intern_code: ['intern_code', 'intern_id', 'trainee_code'],
  department: ['department', 'dept', 'division', 'team', 'business_unit'],
  designation: ['designation', 'role', 'position', 'job_title', 'title'],
  position_applied: ['position_applied'],
  domain_role: ['domain_role'],
  reporting_manager: ['reporting_manager', 'manager', 'lead', 'supervisor'],
  assigned_mentor: ['assigned_mentor', 'mentor'],
  date_of_joining: ['date_of_joining', 'doj', 'joining_date', 'joined_date', 'appointment_date'],
  employee_status: ['employee_status', 'emp_status'],
  base_salary: ['base_salary', 'basic', 'basic_salary', 'base', 'salary', 'fixed_pay', 'fixed_salary'],
  hra: ['hra', 'house_rent_allowance', 'rent_allowance'],
  conveyance_allowance: ['conveyance_allowance', 'conveyance', 'travel_allowance'],
  special_allowance: ['special_allowance', 'special', 'allowances', 'other_allowance'],
  professional_tax: ['professional_tax', 'pt', 'prof_tax'],
  pf_opted: ['pf_opted', 'pf', 'provident_fund', 'epf', 'deduct_pf'],
  monthly_stipend: ['monthly_stipend', 'stipend', 'stipend_amount', 'intern_stipend'],
  bank_name: ['bank_name', 'bank'],
  account_no: ['account_no', 'account_number', 'bank_account', 'acc_no', 'account'],
  ifsc_code: ['ifsc_code', 'ifsc', 'branch_code'],
  college_university: ['college_university', 'college', 'university', 'institution', 'institute', 'campus'],
  degree: ['degree', 'course', 'qualification', 'program'],
  branch_specialization: ['branch_specialization', 'stream', 'specialization', 'field_of_study', 'major'],
  current_semester: ['current_semester', 'semester', 'sem', 'year_of_study'],
  roll_number: ['roll_number', 'roll_no', 'reg_no', 'registration_no', 'enrollment_no', 'student_id'],
  duration_months: ['duration_months', 'duration', 'months', 'internship_duration'],
  internship_type: ['internship_type', 'mode'],
  start_date: ['start_date', 'internship_start', 'commencement_date'],
  end_date: ['end_date', 'internship_end', 'completion_date'],
  current_company: ['current_company', 'company', 'employer', 'previous_company', 'present_company'],
  total_experience: ['total_experience', 'experience', 'exp', 'work_experience', 'total_exp'],
  current_ctc: ['current_ctc', 'present_ctc', 'current_salary'],
  expected_ctc: ['expected_ctc', 'exp_ctc', 'desired_salary'],
  notice_period: ['notice_period', 'notice', 'np'],
};

// Exact matches only: substring matching (as the old importer did) mis-mapped headers like "Start Date".
const ALIAS_LOOKUP = new Map(Object.entries(FIELD_ALIASES).flatMap(([key, aliases]) => aliases.map((a) => [a, key] as const)));

export function normalizeHeader(header: string) {
  const clean = String(header).toLowerCase().replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
  return ALIAS_LOOKUP.get(clean) ?? clean;
}

const DATE_FIELDS = new Set(['date_of_joining', 'date_of_birth', 'start_date', 'end_date', 'interview_date']);

/** Dates typed as text (CSV) follow the Indian dd/mm/yyyy convention; the API wants yyyy-mm-dd. */
export function normalizeDate(value: string): string {
  const v = value.trim();
  const dmy = v.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
  const ymd = v.match(/^(\d{4})[/.-](\d{1,2})[/.-](\d{1,2})/);
  if (ymd) return `${ymd[1]}-${ymd[2].padStart(2, '0')}-${ymd[3].padStart(2, '0')}`;
  return v;
}

// SheetJS gives Excel dates as local-midnight Dates; toISOString() would shift them a day back in IST.
const localIso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const normalizeRow = (raw: Row): Row =>
  Object.fromEntries(
    Object.entries(raw)
      .map(([k, v]) => {
        const key = normalizeHeader(k);
        const value = v instanceof Date ? localIso(v) : typeof v === 'string' ? v.trim() : v;
        return [key, DATE_FIELDS.has(key) && typeof value === 'string' ? normalizeDate(value) : value] as const;
      })
      .filter(([k]) => k),
  );

// Cell values are read raw: formatted text turned long account numbers into "5.01005E+13"
// and dates into "9/1/26". For CSV, raw also keeps "01/09/2026" as typed instead of
// letting SheetJS guess US month/day order.
const readBook = async (file: File) => {
  const XLSX = await loadXlsx();
  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true, raw: file.name.toLowerCase().endsWith('.csv') });
  const rows = (sheet: string) => XLSX.utils.sheet_to_json<Row>(wb.Sheets[sheet], { defval: '', raw: true });
  return { wb, rows };
};

export async function parseSpreadsheet(file: File): Promise<Row[]> {
  const name = file.name.toLowerCase();
  if (!/\.(csv|xlsx|xls)$/.test(name)) throw new Error('Upload a .csv, .xlsx or .xls file.');
  const { wb, rows } = await readBook(file);
  const records = rows(wb.SheetNames[0]).map(normalizeRow).filter((r) => Object.values(r).some((v) => v !== '' && v !== null && v !== undefined));
  if (records.length === 0) throw new Error('The file has no data rows.');
  return records;
}

/** Every sheet, keyed by lower-cased sheet name (used by full backup restore). */
export async function parseAllSheets(file: File): Promise<Record<string, Row[]>> {
  const { wb, rows } = await readBook(file);
  return Object.fromEntries(wb.SheetNames.map((n) => [n.toLowerCase(), rows(n).map(normalizeRow)]));
}

export async function exportExcel(sheets: Record<string, Row[]>, filename: string) {
  const XLSX = await loadXlsx();
  const wb = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows.length ? rows : [{ Status: 'No records' }]), name.slice(0, 31));
  }
  XLSX.writeFile(wb, filename);
}

export function exportCsv(rows: Row[], filename: string) {
  if (rows.length === 0) return;
  const headers = Object.keys(rows[0]);
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
    // Leading =,+,-,@ would be evaluated as a formula when opened in Excel.
    return `"${(/^[=+\-@]/.test(s) ? `'${s}` : s).replace(/"/g, '""')}"`;
  };
  const csv = [headers.map(esc).join(','), ...rows.map((r) => headers.map((h) => esc(r[h])).join(','))].join('\n');
  const url = URL.createObjectURL(new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const TEMPLATES: Record<'employee' | 'intern' | 'candidate', Row[]> = {
  employee: [{
    full_name: 'Aditi Rao', email: 'aditi.rao@rexera.co.in', mobile_number: '9876543210', department: 'SALES',
    designation: 'BDM', reporting_manager: 'Vikram Malhotra', date_of_joining: '2026-09-01', base_salary: 60000,
    hra: 24000, conveyance_allowance: 2000, special_allowance: 5000, professional_tax: 200, pf_opted: 'Yes',
    bank_name: 'HDFC Bank', account_no: '50100492817264', ifsc_code: 'HDFC0001024',
  }],
  intern: [{
    full_name: 'Sneha Reddy', email: 'sneha.reddy@college.edu', mobile_number: '9877112233', department: 'SALES',
    domain_role: 'Sales Intern', assigned_mentor: 'Aarav Sharma', college_university: 'Nirma University, Ahmedabad',
    degree: 'BBA', branch_specialization: 'Marketing', current_semester: '7th Semester', roll_number: '21BBA089',
    start_date: '2026-09-01', end_date: '2026-12-31', duration_months: 4, monthly_stipend: 18000, internship_type: 'Full-time',
  }],
  candidate: [{
    candidate_name: 'Rohan Deshmukh', position_applied: 'BDM', email: 'rohan.d@example.com', contact_number: '9765432109',
    current_company: 'Infosys', total_experience: '4.5 Years', current_ctc: '14 LPA', expected_ctc: '20 LPA', notice_period: '30 Days',
  }],
};

export const downloadTemplate = (type: keyof typeof TEMPLATES) =>
  exportExcel({ [`${type} template`]: TEMPLATES[type] }, `Rexera_${type}_template.xlsx`);
