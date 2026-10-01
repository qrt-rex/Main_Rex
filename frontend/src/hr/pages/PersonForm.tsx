import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { phoneDigits, phoneInput } from '../../lib/phone';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Briefcase, Check, ChevronLeft, ChevronRight, Circle, Eye, EyeOff, FileSpreadsheet, GraduationCap, Upload, X } from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';
import { ApiError } from '../../lib/api';
import { money, todayISO } from '../../lib/format';
import { isStrongPassword, PASSWORD_RULES } from '../../lib/password';
import { useApi, useDebounced } from '../../lib/useApi';
import { calculatePf } from '../pf/api';
import { parseSpreadsheet, downloadTemplate } from '../../lib/spreadsheet';
import {
  BRANCHES, bulkEmployees, bulkInterns, createEmployee, createIntern, DEPARTMENTS, DESIGNATIONS, getEmployee, updateEmployee,
  type Employee,
} from '../api';
import { useEmployeeOptions } from '../HrSection';
import { Button } from '../../components/common/Button';
import { Card, CardHeader } from '../../components/common/Card';
import { useConfirm } from '../../components/common/ConfirmDialog';
import { Input, Select } from '../../components/common/Input';
import { ErrorState } from '../../components/common/ErrorState';
import { PageSkeleton } from '../../components/common/Skeleton';
import { useToast } from '../../components/common/ToastContext';
import { PageHeader } from '../../components/layout/PageHeader';

type Kind = 'employee' | 'intern';
type Values = Record<string, string | boolean>;
type Row = Record<string, unknown>;

const OTHER = '__other__';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Values older versions of this form stored when bank details were left blank.
const BANK_PLACEHOLDERS = new Set(['Not Provided', '0000000000', 'REX0001']);
const unplaceholder = (v: string | undefined | null) => (v && !BANK_PLACEHOLDERS.has(v) ? v : '');

/** Same rule as the API: an Indian mobile, optionally written with +91 / 0 / spaces / dashes. */
function isValidMobile(raw: string) {
  let d = raw.replace(/[\s+().-]/g, '');
  if (d.length === 12 && d.startsWith('91')) d = d.slice(2);
  else if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  return /^[6-9]\d{9}$/.test(d);
}

function addMonths(iso: string, months: number) {
  const d = new Date(`${iso}T00:00:00`);
  d.setMonth(d.getMonth() + months);
  return d.toLocaleDateString('en-CA');
}

const blank = (): Values => ({
  code: '', full_name: '', email: '', mobile_number: '', department: 'SALES', department_other: '', role: '', manager: '',
  // employee
  gender: 'MALE', branch: 'AMD', date_of_joining: todayISO(), date_of_exit: '', employee_status: 'Active', password: '',
  base_salary: '50000', da: '0', hra: '20000', conveyance_allowance: '2000', special_allowance: '5000', professional_tax: '200', pf_opted: true,
  // intern
  intern_gender: 'Other', date_of_birth: '', college_university: '', degree: '', branch_specialization: '', current_semester: '', roll_number: '',
  internship_type: 'Full-time', start_date: todayISO(), end_date: addMonths(todayISO(), 3), duration_months: '3', monthly_stipend: '15000',
  // banking
  bank_name: '', account_no: '', ifsc_code: '',
});

function fromEmployee(e: Employee): Values {
  const known = DEPARTMENTS.includes(e.department);
  return {
    ...blank(),
    code: e.employee_code, full_name: e.full_name, email: e.email, mobile_number: e.mobile_number,
    department: known ? e.department : OTHER, department_other: known ? '' : e.department,
    role: e.designation, manager: e.reporting_manager ?? '', gender: e.gender || 'MALE', branch: e.branch || 'AMD',
    date_of_joining: e.date_of_joining, date_of_exit: e.date_of_exit ?? '', employee_status: e.employee_status,
    base_salary: String(e.base_salary), da: String(e.da ?? 0), hra: String(e.hra), conveyance_allowance: String(e.conveyance_allowance),
    special_allowance: String(e.special_allowance), professional_tax: String(e.professional_tax), pf_opted: e.pf_opted,
    bank_name: unplaceholder(e.bank_name), account_no: unplaceholder(e.account_no), ifsc_code: unplaceholder(e.ifsc_code),
  };
}

/** Maps a normalized spreadsheet row onto the form (port of Importer.autofill*Form). */
function fromRow(row: Row, kind: Kind, base: Values): Values {
  const s = (k: string) => (row[k] === undefined || row[k] === null || row[k] === '' ? undefined : String(row[k]));
  const dept = s('department');
  const next: Values = { ...base };
  const set = (field: string, value?: string) => { if (value !== undefined) next[field] = value; };
  set('full_name', s('full_name'));
  set('email', s('email'));
  set('mobile_number', s('mobile_number'));
  set('code', kind === 'intern' ? s('intern_code') ?? s('employee_code') : s('employee_code'));
  set('role', s('designation') ?? s('domain_role') ?? s('position_applied'));
  set('manager', s('reporting_manager') ?? s('assigned_mentor'));
  if (dept) {
    const known = DEPARTMENTS.find((d) => d.toLowerCase() === dept.toLowerCase());
    next.department = known ?? OTHER;
    next.department_other = known ? '' : dept;
  }
  set('bank_name', s('bank_name'));
  set('account_no', s('account_no'));
  set('ifsc_code', s('ifsc_code'));
  if (kind === 'employee') {
    set('date_of_joining', s('date_of_joining'));
    set('base_salary', s('base_salary'));
    const base = Number(next.base_salary) || 0;
    next.hra = s('hra') ?? String(Math.round(base * 0.4));
    set('conveyance_allowance', s('conveyance_allowance'));
    set('special_allowance', s('special_allowance'));
    set('professional_tax', s('professional_tax'));
    const pf = s('pf_opted');
    if (pf !== undefined) next.pf_opted = !['false', 'no', '0'].includes(pf.toLowerCase());
  } else {
    for (const f of ['college_university', 'degree', 'branch_specialization', 'current_semester', 'roll_number', 'end_date', 'duration_months', 'monthly_stipend', 'internship_type', 'date_of_birth']) set(f, s(f));
    set('start_date', s('start_date') ?? s('date_of_joining'));
  }
  return next;
}

function toPayload(kind: Kind, v: Values) {
  const dept = v.department === OTHER ? String(v.department_other).trim() : String(v.department);
  const n = (k: string) => Number(v[k]) || 0;
  if (kind === 'employee') {
    return {
      employee_code: String(v.code).trim(), full_name: String(v.full_name).trim(), email: String(v.email).trim(),
      mobile_number: String(v.mobile_number).trim(), department: dept, designation: String(v.role).trim(),
      gender: v.gender, branch: v.branch, reporting_manager: String(v.manager).trim(), date_of_joining: v.date_of_joining,
      date_of_exit: v.date_of_exit, base_salary: n('base_salary'), da: n('da'), hra: n('hra'), conveyance_allowance: n('conveyance_allowance'),
      special_allowance: n('special_allowance'), professional_tax: n('professional_tax'), pf_opted: !!v.pf_opted,
      bank_name: String(v.bank_name).trim(), account_no: String(v.account_no).trim(),
      ifsc_code: String(v.ifsc_code).trim().toUpperCase(), employee_status: v.employee_status,
      ...(v.password ? { password: String(v.password) } : {}),
    };
  }
  return {
    intern_code: String(v.code).trim(), full_name: String(v.full_name).trim(), email: String(v.email).trim(),
    mobile_number: String(v.mobile_number).trim(), gender: v.intern_gender, date_of_birth: v.date_of_birth, department: dept,
    domain_role: String(v.role).trim(), assigned_mentor: String(v.manager).trim() || 'HR Lead',
    college_university: String(v.college_university).trim(), degree: String(v.degree).trim(),
    branch_specialization: String(v.branch_specialization).trim(), current_semester: v.current_semester, roll_number: v.roll_number,
    internship_type: v.internship_type, start_date: v.start_date, end_date: v.end_date,
    duration_months: Math.max(1, n('duration_months')), monthly_stipend: n('monthly_stipend'),
    bank_name: v.bank_name, account_no: v.account_no, ifsc_code: String(v.ifsc_code).trim().toUpperCase(), status: 'Ongoing',
  };
}

function validate(kind: Kind, v: Values, editing = false) {
  const e: Record<string, string> = {};
  if (String(v.full_name).trim().length < 2) e.full_name = 'Enter the full name.';
  if (!EMAIL_RE.test(String(v.email).trim())) e.email = 'Enter a valid email address.';
  if (!isValidMobile(String(v.mobile_number).trim())) e.mobile_number = 'Enter a valid 10-digit Indian mobile number.';
  if (v.department === OTHER && !String(v.department_other).trim()) e.department_other = 'Enter the department name.';
  if (!String(v.role).trim()) e.role = kind === 'employee' ? 'Enter a designation.' : 'Enter the internship role.';
  if (kind === 'employee') {
    if (!v.date_of_joining) e.date_of_joining = 'Choose the joining date.';
    if (v.date_of_exit && v.date_of_joining && v.date_of_exit < v.date_of_joining) e.date_of_exit = 'The exit date can\'t be before the joining date.';
    if (!(Number(v.base_salary) > 0)) e.base_salary = 'Enter the basic salary.';
    if (!editing && !v.password) e.password = 'Set a password for the employee\'s login.';
    else if (v.password && !isStrongPassword(String(v.password))) e.password = 'The password doesn\'t meet every rule below.';
    for (const k of ['da', 'hra', 'conveyance_allowance', 'special_allowance', 'professional_tax']) {
      if (Number(v[k]) < 0) e[k] = 'Amounts cannot be negative.';
    }
  } else {
    if (Number(v.monthly_stipend) < 0) e.monthly_stipend = 'The stipend cannot be negative.';
  }
  if (String(v.ifsc_code).trim() && !/^[A-Za-z]{4}0[A-Za-z0-9]{6}$/.test(String(v.ifsc_code).trim())) e.ifsc_code = 'IFSC codes look like HDFC0001234.';
  if (kind !== 'employee') {
    if (!String(v.college_university).trim()) e.college_university = 'Enter the college or university.';
    if (!String(v.degree).trim()) e.degree = 'Enter the degree.';
    if (!String(v.branch_specialization).trim()) e.branch_specialization = 'Enter the specialization.';
    if (!v.start_date) e.start_date = 'Choose a start date.';
    if (!v.end_date || String(v.end_date) < String(v.start_date)) e.end_date = 'End date must be after the start date.';
  }
  return e;
}

export function PersonForm({ kind: routeKind }: { kind: Kind }) {
  const { id } = useParams();
  const editing = !!id;
  const { can } = useAuth();
  const { showToast } = useToast();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const { reload: reloadOptions } = useEmployeeOptions();
  const kind = routeKind;

  const [values, setValues] = useState<Values>(() => blank());
  const [original, setOriginal] = useState<Record<string, unknown> | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [records, setRecords] = useState<Row[]>([]);
  const [recordIndex, setRecordIndex] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!editing) return;
    getEmployee(id!, can('hr.employees.bank'))
      .then((e) => {
        const v = fromEmployee(e);
        setValues(v);
        setOriginal(toPayload('employee', v));
      })
      .catch((err) => setLoadError(err instanceof ApiError ? err.message : 'Could not load the employee.'));
  }, [editing, id, can]);

  const set = (field: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const value = e.target.type === 'checkbox' ? (e.target as HTMLInputElement).checked : e.target.value;
    setValues((v) => {
      const next = { ...v, [field]: value };
      if ((field === 'start_date' || field === 'end_date') && next.start_date && next.end_date) {
        const [a, b] = [new Date(String(next.start_date)), new Date(String(next.end_date))];
        const months = (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
        if (months > 0) next.duration_months = String(months);
      }
      return next;
    });
    if (errors[field]) setErrors((er) => ({ ...er, [field]: '' }));
  };

  // PF comes from the backend PF engine (the rule in force today, and this employee's PF details when editing).
  const canSeePf = can('hr.pf.view');
  const pfBasic = useDebounced(Number(values.base_salary) || 0, 400);
  const pfDa = useDebounced(Number(values.da) || 0, 400);
  const pfCalc = useApi(() => calculatePf({ basic_salary: pfBasic, da: pfDa, employee_id: editing ? id : undefined }),
    [pfBasic, pfDa, editing, id], kind === 'employee' && canSeePf && pfBasic > 0);
  const pf = pfCalc.data && pfBasic > 0 ? pfCalc.data : null;

  const preview = useMemo(() => {
    const n = (k: string) => Number(values[k]) || 0;
    const allowances = n('conveyance_allowance') + n('special_allowance');
    const gross = n('base_salary') + n('da') + n('hra') + allowances;
    const employeePf = pf?.employee_pf ?? 0;
    const deductions = employeePf + n('professional_tax');
    return { allowances, gross, deductions, net: Math.max(0, gross - deductions), ctc: gross + (pf?.employer_pf ?? 0) };
  }, [values, pf]);

  const loadFile = async (file: File) => {
    try {
      const rows = await parseSpreadsheet(file);
      setRecords(rows);
      setRecordIndex(0);
      setValues(fromRow(rows[0], kind, blank()));
      showToast(rows.length > 1 ? `Loaded ${rows.length} records from ${file.name}` : `Form filled from ${file.name}`, 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not read that file', 'error');
    } finally {
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  const showRecord = (i: number) => {
    setRecordIndex(i);
    setValues(fromRow(records[i], kind, blank()));
    setErrors({});
  };

  const bulkSave = async () => {
    const noun = kind === 'employee' ? 'employees' : 'interns';
    const ok = await confirm({ title: `Save all ${records.length} ${noun}?`, message: 'Every record in the file is created as-is. Rows with problems are skipped and reported.', confirmText: `Save ${records.length} ${noun}` });
    if (!ok) return;
    setSaving(true);
    try {
      const res = await (kind === 'employee' ? bulkEmployees(records) : bulkInterns(records));
      showToast(res.message, 'success');
      reloadOptions();
      navigate(kind === 'employee' ? '/hr/employees' : '/hr/interns');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Bulk save failed', 'error');
    } finally {
      setSaving(false);
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const found = validate(kind, values, editing);
    setErrors(found);
    const firstError = Object.keys(found).find((k) => found[k]);
    if (firstError) {
      document.getElementById(`f-${firstError}`)?.focus();
      return;
    }
    setSaving(true);
    try {
      const payload = toPayload(kind, values);
      if (editing) {
        // Only changed fields: an unrevealed (masked) account number is never written back.
        const changes = Object.fromEntries(Object.entries(payload).filter(([k, v]) => original?.[k] !== v && k !== 'employee_code'));
        if (Object.keys(changes).length === 0) {
          showToast('No changes to save', 'info');
          return;
        }
        await updateEmployee(id!, changes);
        showToast(`${payload.full_name} updated`, 'success');
      } else if (kind === 'employee') {
        const res = await createEmployee(payload);
        showToast(`${res.full_name} (${res.employee_code}) added with a login`, 'success');
      } else {
        const res = await createIntern(payload);
        showToast(`${res.full_name} (${res.intern_code}) enrolled`, 'success');
      }
      reloadOptions();
      navigate(kind === 'employee' ? '/hr/employees' : '/hr/interns');
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Could not save', 'error');
    } finally {
      setSaving(false);
    }
  };

  if (loadError) return <><PageHeader title="Edit employee" /><Card><ErrorState message={loadError} /></Card></>;
  if (editing && !original) return <PageSkeleton />;

  const listPath = kind === 'employee' ? '/hr/employees' : '/hr/interns';
  const title = editing ? `Edit ${values.full_name || 'employee'}` : kind === 'employee' ? 'Add employee' : 'Onboard intern';
  const field = (name: string) => ({ id: `f-${name}`, value: String(values[name] ?? ''), onChange: set(name), error: errors[name] || undefined });

  return (
    <>
      <PageHeader
        title={title}
        description={kind === 'employee' ? 'Identity, compensation and payout details for a full-time employee.' : 'Academic details, internship scope and stipend.'}
        breadcrumbs={[{ label: 'HR' }, { label: kind === 'employee' ? 'Employees' : 'Interns', to: listPath }, { label: editing ? 'Edit' : 'New' }]}
      />

      {!editing && (can('hr.employees.create') && can('hr.interns.create')) && (
        <div role="tablist" aria-label="Record type" className="mb-4 inline-flex rounded-lg border border-border bg-surface p-1">
          {([['employee', 'Full-time employee', Briefcase, '/hr/employees/new'], ['intern', 'Intern / trainee', GraduationCap, '/hr/interns/new']] as const).map(([k, label, Icon, to]) => (
            <Link key={k} to={to} role="tab" aria-selected={kind === k} replace
              className={`inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${kind === k ? 'bg-primary-soft text-primary' : 'text-text-muted hover:text-text'}`}>
              <Icon size={15} aria-hidden="true" /> {label}
            </Link>
          ))}
        </div>
      )}

      {!editing && (
        <Card className="mb-4">
          <div
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => { e.preventDefault(); setDragging(false); if (e.dataTransfer.files[0]) loadFile(e.dataTransfer.files[0]); }}
            className={`flex flex-wrap items-center gap-3 rounded-lg p-4 transition-colors ${dragging ? 'bg-primary-soft' : ''}`}
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-md bg-neutral-bg text-text-muted"><FileSpreadsheet size={18} aria-hidden="true" /></span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-text">Fill from a spreadsheet</p>
              <p className="text-xs text-text-muted">Drop a .xlsx, .xls or .csv file here. Column names are matched automatically.</p>
            </div>
            <input ref={fileInput} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(e) => e.target.files?.[0] && loadFile(e.target.files[0])} />
            <Button variant="ghost" size="sm" onClick={() => downloadTemplate(kind)}>Template</Button>
            <Button variant="secondary" size="sm" onClick={() => fileInput.current?.click()}><Upload size={14} /> Choose file</Button>
          </div>
          {records.length > 1 && (
            <div className="flex flex-wrap items-center gap-2 border-t border-border px-4 py-2.5">
              <span className="text-sm text-text">Record {recordIndex + 1} of {records.length}</span>
              <span className="truncate text-xs text-text-muted">{values.full_name || 'Unnamed'}</span>
              <div className="ml-auto flex items-center gap-1">
                <Button variant="ghost" size="icon-sm" aria-label="Previous record" disabled={recordIndex === 0} onClick={() => showRecord(recordIndex - 1)}><ChevronLeft size={16} /></Button>
                <Button variant="ghost" size="icon-sm" aria-label="Next record" disabled={recordIndex === records.length - 1} onClick={() => showRecord(recordIndex + 1)}><ChevronRight size={16} /></Button>
                <Button size="sm" onClick={bulkSave} loading={saving}>Save all {records.length}</Button>
                <Button variant="ghost" size="icon-sm" aria-label="Clear loaded records" onClick={() => setRecords([])}><X size={15} /></Button>
              </div>
            </div>
          )}
        </Card>
      )}

      <form onSubmit={submit} noValidate className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader title="Basic details" />
            <div className="grid gap-4 p-4 sm:grid-cols-2">
              <Input label={kind === 'employee' ? 'Employee code' : 'Intern code'} {...field('code')} disabled={editing} hint={editing ? undefined : 'Leave blank to auto-generate'} />
              <Input label="Full name" required {...field('full_name')} placeholder="e.g. Aditi Rao" />
              <Input label="Email" type="email" required {...field('email')} placeholder="name@company.com" />
              <Input label="Mobile number" required {...field('mobile_number')} {...phoneInput}
                onChange={(e) => setValues((s) => ({ ...s, mobile_number: phoneDigits(e.target.value) }))} />
              <Select label="Department" required {...field('department')}>
                {DEPARTMENTS.map((d) => <option key={d}>{d}</option>)}
                <option value={OTHER}>Other…</option>
              </Select>
              {values.department === OTHER && <Input label="Department name" required {...field('department_other')} placeholder="Custom department" />}
              <Input label={kind === 'employee' ? 'Designation' : 'Internship role'} required {...field('role')} list={kind === 'employee' ? 'designations' : undefined} placeholder={kind === 'employee' ? 'Select or type' : 'e.g. Sales Intern'} />
              <datalist id="designations">{DESIGNATIONS.map((d) => <option key={d} value={d} />)}</datalist>
              <Input label={kind === 'employee' ? 'Reporting manager' : 'Assigned mentor'} {...field('manager')} placeholder="e.g. Vikram Malhotra" />
              {kind === 'employee' ? (
                <>
                  <Select label="Gender" {...field('gender')}><option>MALE</option><option>FEMALE</option></Select>
                  <Select label="Branch" {...field('branch')}>{BRANCHES.map((b) => <option key={b}>{b}</option>)}</Select>
                  <Input label="Date of joining" type="date" required {...field('date_of_joining')} />
                  {editing && <Input label="Date of exit" type="date" hint="Last working day. Payroll leaves the days after it unpaid." {...field('date_of_exit')} />}
                  <Select label="Status" {...field('employee_status')}>
                    {['Active', 'Probation', 'Inactive', ...(editing ? ['Resigned', 'Terminated'] : [])].map((s) => <option key={s}>{s}</option>)}
                  </Select>
                </>
              ) : (
                <>
                  <Select label="Gender" {...field('intern_gender')}><option>Male</option><option>Female</option><option>Other</option></Select>
                  <Input label="Date of birth" type="date" {...field('date_of_birth')} />
                </>
              )}
            </div>
          </Card>

          {kind === 'employee' && !editing && (
            <Card>
              <CardHeader title="Login access" description="The employee signs in with their email and this password, as an Employee / Sales Person." />
              <div className="space-y-3 p-4">
                <div className="flex flex-col gap-1.5">
                  {/* Label outside the row so the toggle stays level with the box when an error shows under it. */}
                  <label htmlFor="f-password" className="text-[13px] font-medium text-text-secondary">
                    Password<span className="ml-0.5 text-danger" aria-hidden="true">*</span>
                  </label>
                  <div className="flex items-start gap-2">
                    <Input type={showPassword ? 'text' : 'password'} autoComplete="new-password" maxLength={16} required
                      {...field('password')} className="flex-1" inputClassName="font-mono" />
                    <Button variant="secondary" size="icon" aria-label={showPassword ? 'Hide password' : 'Show password'}
                      aria-pressed={showPassword} onClick={() => setShowPassword((s) => !s)}>
                      {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                    </Button>
                  </div>
                </div>
                {values.password ? (
                  <ul className="grid gap-1 text-xs sm:grid-cols-2" aria-label="Password rules">
                    {PASSWORD_RULES.map((r) => {
                      const ok = r.test(String(values.password));
                      return (
                        <li key={r.label} className={`flex items-center gap-1.5 ${ok ? 'text-success' : 'text-text-muted'}`}>
                          {ok ? <Check size={13} aria-hidden="true" /> : <Circle size={13} aria-hidden="true" />}
                          {r.label}<span className="sr-only">{ok ? ' (met)' : ' (missing)'}</span>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="text-xs text-text-muted">8 to 16 characters, with an uppercase letter, a lowercase letter, a number and a special symbol.</p>
                )}
              </div>
            </Card>
          )}

          {kind === 'intern' ? (
            <Card>
              <CardHeader title="Academic details & internship" />
              <div className="grid gap-4 p-4 sm:grid-cols-2">
                <Input label="College / university" required {...field('college_university')} className="sm:col-span-2" />
                <Input label="Degree" required {...field('degree')} placeholder="e.g. B.Tech" />
                <Input label="Specialization" required {...field('branch_specialization')} placeholder="e.g. Computer Engineering" />
                <Input label="Current semester" {...field('current_semester')} />
                <Input label="Roll / registration no." {...field('roll_number')} />
                <Select label="Internship type" {...field('internship_type')}>
                  {['Full-time', 'Part-time', 'Summer Intern', 'Research Trainee'].map((t) => <option key={t}>{t}</option>)}
                </Select>
                <Input label="Monthly stipend (₹)" type="number" min={0} {...field('monthly_stipend')} />
                <Input label="Start date" type="date" required {...field('start_date')} />
                <Input label="End date" type="date" required {...field('end_date')} />
                <Input label="Duration (months)" type="number" min={1} max={24} {...field('duration_months')} hint="Calculated from the dates" />
              </div>
            </Card>
          ) : (
            <Card>
              <CardHeader title="Compensation (₹ per month)" />
              <div className="grid gap-4 p-4 sm:grid-cols-2">
                <Input label="Basic salary" type="number" min={0} required {...field('base_salary')} />
                <Input label="Dearness allowance (DA)" type="number" min={0} {...field('da')} />
                <div className="flex items-end gap-2">
                  <Input label="HRA" type="number" min={0} {...field('hra')} className="flex-1" />
                  <Button variant="secondary" onClick={() => setValues((v) => ({ ...v, hra: String(Math.round((Number(v.base_salary) || 0) * 0.5)) }))}>50% of basic</Button>
                </div>
                <Input label="Conveyance allowance" type="number" min={0} {...field('conveyance_allowance')} />
                <Input label="Special allowance" type="number" min={0} {...field('special_allowance')} />
                <Input label="Professional tax" type="number" min={0} {...field('professional_tax')} />
                <p className="self-end pb-1.5 text-xs text-text-muted">Provident fund is worked out from the PF rules (HR → PF management). Exemptions are recorded, with a reason, in the employee's PF details.</p>
              </div>
            </Card>
          )}

          <Card>
            <CardHeader title={kind === 'employee' ? 'Salary payout' : 'Stipend payout'} description={editing && !can('hr.employees.bank') ? 'The account number is masked for your role and is left unchanged unless you replace it.' : undefined} />
            <div className="grid gap-4 p-4 sm:grid-cols-3">
              <Input label="Bank name" {...field('bank_name')} placeholder="e.g. HDFC Bank" />
              <Input label="Account number" {...field('account_no')} inputClassName="font-mono" />
              <Input label="IFSC code" {...field('ifsc_code')} inputClassName="font-mono uppercase" placeholder="HDFC0001234" />
            </div>
          </Card>
        </div>

        <div className="space-y-4">
          {kind === 'employee' && (
            <Card className="lg:fixed lg:top-20 lg:right-8 lg:w-[380px]">
              <CardHeader title="Salary preview" description="Per month, before TDS and LOP" />
              <dl className="text-sm">
                {([
                  ['Earnings', null],
                  ['Basic salary', money(values.base_salary)],
                  ...(Number(values.da) > 0 ? [['DA', money(values.da)]] : []),
                  ['HRA', money(values.hra)], ['Allowances', money(preview.allowances)],
                  ['Gross salary', <span key="g" className="font-medium">{money(preview.gross)}</span>],
                  ['Statutory deductions', null],
                  ['Employee PF', !canSeePf ? <span key="p" className="text-xs text-text-muted">Worked out at payroll</span> : pf ? `− ${money(pf.employee_pf, true)}` : '…'],
                  ['Professional tax', `− ${money(values.professional_tax)}`],
                  ['Employer contributions', null],
                  ['Employer PF', pf ? money(pf.employer_pf, true) : '—'], ['EPS', pf ? money(pf.eps, true) : '—'], ['Employer EPF', pf ? money(pf.employer_epf, true) : '—'],
                ] as [string, React.ReactNode][]).map(([k, v]) => v === null
                  ? <dt key={k} className="border-t border-border bg-surface-secondary px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-text-muted first:border-0">{k}</dt>
                  : <div key={k} className="flex justify-between px-4 py-1.5"><dt className="text-text-muted">{k}</dt><dd className="tabular-nums text-text">{v}</dd></div>)}
                {pf && pf.status !== undefined && pf.status !== 'CALCULATED' && <p className="px-4 pb-1.5 text-xs text-warning">{pf.reason}</p>}
                {pf && (pf.status === undefined || pf.status === 'CALCULATED') && (
                  <p className="px-4 pb-1.5 text-xs text-text-muted">PF wage {money(pf.pf_wage)}{pf.wage_limited_by ? ` (basic ${pf.wage_limited_by === 'maximum' ? 'capped at the maximum' : 'raised to the minimum'})` : ''} · {pf.rule_name}</p>
                )}
                <div className="flex justify-between border-t border-border bg-surface-secondary px-4 py-2"><dt className="text-text-muted">Total employee deductions</dt><dd className="tabular-nums text-text">{money(preview.deductions, true)}</dd></div>
                <div className="flex justify-between bg-surface-secondary px-4 py-2"><dt className="font-medium text-text">Estimated net salary</dt><dd className="tabular-nums text-base font-semibold text-success">{money(preview.net, true)}</dd></div>
                <div className="flex justify-between bg-surface-secondary px-4 py-2"><dt className="text-text-muted">CTC (gross + employer PF)</dt><dd className="tabular-nums text-text">{money(preview.ctc, true)}</dd></div>
              </dl>
            </Card>
          )}
          <div className="flex gap-2 lg:justify-end">
            <Button variant="secondary" onClick={() => navigate(listPath)}>Cancel</Button>
            <Button type="submit" loading={saving}>{editing ? 'Save changes' : kind === 'employee' ? 'Save employee' : 'Save intern'}</Button>
          </div>
        </div>
      </form>
    </>
  );
}
