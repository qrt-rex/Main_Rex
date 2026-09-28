import { useEffect, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Eye, GraduationCap, MoreHorizontal, Rocket, Trash2 } from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';
import { useApi, useDebounced } from '../../lib/useApi';
import { date, money, todayISO } from '../../lib/format';
import { bulkInterns, convertIntern, deleteIntern, DEPARTMENTS, getIntern, INTERN_STATUSES, listInterns, type Intern } from '../api';
import { useEmployeeOptions } from '../HrSection';
import { DetailList, ExportMenu, ImportButton, Section, Toolbar } from '../components';
import { Avatar } from '../../components/common/Avatar';
import { StatusBadge } from '../../components/common/Badge';
import { Button } from '../../components/common/Button';
import { Card } from '../../components/common/Card';
import { useConfirm } from '../../components/common/ConfirmDialog';
import { Dropdown, DropdownItem, DropdownSeparator } from '../../components/common/Dropdown';
import { EmptyState } from '../../components/common/EmptyState';
import { ErrorState } from '../../components/common/ErrorState';
import { Checkbox, Input, SearchInput, Select } from '../../components/common/Input';
import { Drawer, Modal } from '../../components/common/Modal';
import { Skeleton } from '../../components/common/Skeleton';
import { Pagination, Table, type Column } from '../../components/common/Table';
import { useToast } from '../../components/common/ToastContext';
import { PageHeader } from '../../components/layout/PageHeader';

const PAGE_SIZE = 15;
const OTHER = '__other__';

function ConvertModal({ intern, onClose, onDone }: { intern: Intern; onClose: () => void; onDone: () => void }) {
  const { showToast } = useToast();
  const suggested = Math.max(35000, Math.round(intern.monthly_stipend * 2.2));
  const known = DEPARTMENTS.includes(intern.department);
  const [v, setV] = useState({
    designation: intern.domain_role.replace(/intern/i, 'Associate').trim(), department: known ? intern.department : OTHER,
    department_other: known ? '' : intern.department, reporting_manager: intern.assigned_mentor ?? '', date_of_joining: todayISO(),
    base_salary: String(suggested), hra: String(Math.round(suggested * 0.4)), conveyance_allowance: '2000', special_allowance: '5000', pf_opted: true,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setV((s) => ({ ...s, [k]: e.target.type === 'checkbox' ? (e.target as HTMLInputElement).checked : e.target.value }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const er: Record<string, string> = {};
    if (!v.designation.trim()) er.designation = 'Enter the full-time designation.';
    if (v.department === OTHER && !v.department_other.trim()) er.department_other = 'Enter the department name.';
    if (!(Number(v.base_salary) > 0)) er.base_salary = 'Enter the basic salary.';
    setErrors(er);
    if (Object.keys(er).length) return;
    setSaving(true);
    try {
      const res = await convertIntern(intern.id, {
        designation: v.designation.trim(), department: v.department === OTHER ? v.department_other.trim() : v.department,
        reporting_manager: v.reporting_manager, date_of_joining: v.date_of_joining, base_salary: Number(v.base_salary) || 0,
        hra: Number(v.hra) || 0, conveyance_allowance: Number(v.conveyance_allowance) || 0,
        special_allowance: Number(v.special_allowance) || 0, professional_tax: 200, pf_opted: v.pf_opted,
      });
      showToast(res.message || `${intern.full_name} converted to full-time`, 'success');
      onDone();
      onClose();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Conversion failed', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      closeOnOverlay={false}
      title={`Convert ${intern.full_name} to full-time`}
      description="Personal and bank details carry over; a new employee code is assigned."
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" form="convert-form" loading={saving}>Convert to employee</Button></>}
    >
      <form id="convert-form" onSubmit={submit} noValidate className="grid gap-4 sm:grid-cols-2">
        <Input label="Designation" required value={v.designation} onChange={set('designation')} error={errors.designation} />
        <Select label="Department" value={v.department} onChange={set('department')}>
          {DEPARTMENTS.map((d) => <option key={d}>{d}</option>)}
          <option value={OTHER}>Other…</option>
        </Select>
        {v.department === OTHER && <Input label="Department name" required value={v.department_other} onChange={set('department_other')} error={errors.department_other} />}
        <Input label="Reporting manager" value={v.reporting_manager} onChange={set('reporting_manager')} />
        <Input label="Joining date" type="date" required value={v.date_of_joining} onChange={set('date_of_joining')} />
        <Input label="Basic salary (₹/month)" type="number" min={0} required value={v.base_salary} onChange={set('base_salary')} error={errors.base_salary} hint={`Suggested from stipend: ${money(suggested)}`} />
        <Input label="HRA" type="number" min={0} value={v.hra} onChange={set('hra')} />
        <Input label="Conveyance" type="number" min={0} value={v.conveyance_allowance} onChange={set('conveyance_allowance')} />
        <Input label="Special allowance" type="number" min={0} value={v.special_allowance} onChange={set('special_allowance')} />
        <Checkbox label="Deduct provident fund" description="12% of basic" checked={v.pf_opted} onChange={set('pf_opted')} className="sm:col-span-2" />
      </form>
    </Modal>
  );
}

function InternDrawer({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { can } = useAuth();
  const showBank = can('hr.employees.bank');
  const intern = useApi(() => getIntern(id!, showBank), [id, showBank], !!id);
  const i = intern.data;
  return (
    <Drawer open={!!id} onClose={onClose} title="Intern profile">
      {intern.status === 'error' ? <ErrorState compact onRetry={intern.reload} message={intern.error} /> : !i || intern.loading ? (
        <div className="space-y-3"><Skeleton className="h-12" /><Skeleton className="h-40" /></div>
      ) : (
        <div className="space-y-5">
          <div className="flex items-center gap-3">
            <Avatar name={i.full_name} size={48} />
            <div className="min-w-0">
              <p className="truncate text-base font-semibold text-text">{i.full_name}</p>
              <p className="truncate text-sm text-text-muted">{i.intern_code} · {i.domain_role} · {i.department}</p>
            </div>
          </div>
          <Section title="Contact">
            <DetailList items={[['Email', i.email], ['Mobile', i.mobile_number], ['Mentor', i.assigned_mentor], ['Status', <StatusBadge status={i.status} />]]} />
          </Section>
          <Section title="Academics">
            <DetailList items={[['College / university', i.college_university], ['Degree', `${i.degree} · ${i.branch_specialization}`], ['Semester', i.current_semester], ['Roll number', i.roll_number]]} />
          </Section>
          <Section title="Internship">
            <DetailList items={[
              ['Duration', `${i.duration_months} months`], ['Dates', `${date(i.start_date)} – ${date(i.end_date)}`], ['Type', i.internship_type],
              ['Monthly stipend', money(i.monthly_stipend)], ['Performance rating', i.performance_rating ? `${i.performance_rating} / 5` : ''], ['Mentor feedback', i.mentor_feedback],
            ]} />
          </Section>
          <Section title="Banking">
            <DetailList items={[['Bank', i.bank_name], ['Account number', i.account_no], ['IFSC', i.ifsc_code]]} />
          </Section>
        </div>
      )}
    </Drawer>
  );
}

export function Interns() {
  const { can } = useAuth();
  const { showToast } = useToast();
  const confirm = useConfirm();
  const { reload: reloadEmployees } = useEmployeeOptions();
  const [params, setParams] = useSearchParams();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [department, setDepartment] = useState('');
  const [status, setStatus] = useState('');
  const [converting, setConverting] = useState<Intern | null>(null);
  const q = useDebounced(search);

  const list = useApi(() => listInterns({ search: q, department, status, page, limit: PAGE_SIZE }), [q, department, status, page]);
  useEffect(() => setPage(1), [q, department, status]);

  const remove = async (i: Intern) => {
    const ok = await confirm({ title: `Delete ${i.full_name}?`, message: 'This permanently removes the intern record.', confirmText: 'Delete intern', tone: 'danger' });
    if (!ok) return;
    try {
      await deleteIntern(i.id);
      showToast('Intern deleted', 'success');
      list.reload();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not delete', 'error');
    }
  };

  const columns: Column<Intern>[] = [
    {
      key: 'name', header: 'Intern', sortValue: (i) => i.full_name.toLowerCase(),
      render: (i) => (
        <span className="flex min-w-0 items-center gap-3">
          <Avatar name={i.full_name} size={30} />
          <span className="min-w-0"><span className="block truncate font-medium text-text">{i.full_name}</span><span className="block truncate text-xs text-text-muted">{i.intern_code} · {i.email}</span></span>
        </span>
      ),
    },
    { key: 'college', header: 'College', sortValue: (i) => i.college_university, render: (i) => <span className="block max-w-56"><span className="block truncate text-text">{i.college_university}</span><span className="block truncate text-xs text-text-muted">{i.degree} · {i.branch_specialization}</span></span> },
    { key: 'role', header: 'Role & mentor', render: (i) => <span><span className="block text-text">{i.domain_role}</span><span className="block text-xs text-text-muted">{i.assigned_mentor}</span></span> },
    { key: 'duration', header: 'Duration', sortValue: (i) => i.start_date, render: (i) => <span className="whitespace-nowrap text-text-muted">{i.duration_months} mo · from {date(i.start_date)}</span> },
    { key: 'stipend', header: 'Stipend', align: 'right', sortValue: (i) => i.monthly_stipend, render: (i) => <span className="tabular-nums">{money(i.monthly_stipend)}</span> },
    { key: 'status', header: 'Status', sortValue: (i) => i.status, render: (i) => <StatusBadge status={i.status} /> },
    {
      key: 'actions', header: <span className="sr-only">Actions</span>, align: 'right',
      render: (i) => (
        <span onClick={(e) => e.stopPropagation()}>
          <Dropdown label={`Actions for ${i.full_name}`} width="w-56" triggerClassName="h-8 w-8 justify-center text-text-muted hover:bg-neutral-bg hover:text-text" trigger={<MoreHorizontal size={16} />}>
            <DropdownItem icon={<Eye size={15} />} onClick={() => setParams({ open: i.id })}>View profile</DropdownItem>
            {can('hr.interns.edit') && can('hr.employees.create') && i.status !== 'Converted to Full-Time' && (
              <DropdownItem icon={<Rocket size={15} />} onClick={() => setConverting(i)}>Convert to full-time</DropdownItem>
            )}
            {can('hr.interns.delete') && <><DropdownSeparator /><DropdownItem icon={<Trash2 size={15} />} tone="danger" onClick={() => remove(i)}>Delete</DropdownItem></>}
          </Dropdown>
        </span>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Interns"
        description="Interns and trainees, their academics, stipends and conversions."
        breadcrumbs={[{ label: 'HR' }, { label: 'Interns' }]}
        actions={<>
          {can('hr.interns.create') && (
            <ImportButton
              noun="interns"
              columns={[
                { header: 'Name', value: (r) => String(r.full_name ?? '') },
                { header: 'Email', value: (r) => String(r.email ?? '') },
                { header: 'College', value: (r) => String(r.college_university ?? '') },
                { header: 'Role', value: (r) => String(r.domain_role ?? r.designation ?? '') },
                { header: 'Stipend', value: (r) => money(r.monthly_stipend) },
              ]}
              onImport={async (rows) => { const res = await bulkInterns(rows); list.reload(); return res; }}
            />
          )}
          <ExportMenu
            filename="interns" sheet="Interns" template={can('hr.interns.create') ? 'intern' : undefined}
            fetchRows={async () => (await listInterns({ limit: 2000 })).interns.map((i) => ({
              'Intern code': i.intern_code, 'Full name': i.full_name, Email: i.email, Mobile: i.mobile_number, Department: i.department,
              Role: i.domain_role, Mentor: i.assigned_mentor, College: i.college_university, Degree: i.degree, Specialization: i.branch_specialization,
              Semester: i.current_semester ?? '', 'Roll number': i.roll_number ?? '', Start: i.start_date, End: i.end_date,
              'Duration (months)': i.duration_months, Stipend: i.monthly_stipend, Status: i.status,
              Bank: i.bank_name ?? '', 'Account number': i.account_no ?? '', IFSC: i.ifsc_code ?? '',
            }))}
          />
          {can('hr.interns.create') && <Link to="/hr/interns/new" className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-3.5 text-sm font-medium text-on-primary shadow-[var(--shadow-card)] hover:bg-primary-hover"><GraduationCap size={15} /> Onboard intern</Link>}
        </>}
      />
      <Card>
        <Toolbar count={list.data ? `${list.data.total} interns` : undefined}>
          <SearchInput value={search} onChange={setSearch} placeholder="Search name, college, mentor…" label="Search interns" />
          <Select aria-label="Department" value={department} onChange={(e) => setDepartment(e.target.value)} selectClassName="w-40">
            <option value="">All departments</option>{DEPARTMENTS.map((d) => <option key={d}>{d}</option>)}
          </Select>
          <Select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)} selectClassName="w-52">
            <option value="">All statuses</option>{INTERN_STATUSES.map((s) => <option key={s}>{s}</option>)}
          </Select>
        </Toolbar>
        {list.status === 'error' ? <ErrorState onRetry={list.reload} message={list.error} /> : (
          <>
            <Table caption="Interns" columns={columns} rows={list.data?.interns ?? []} rowKey={(i) => i.id} loading={list.loading} onRowClick={(i) => setParams({ open: i.id })}
              empty={q || department || status
                ? <EmptyState compact icon={GraduationCap} title="No interns match" description="Try a different search or filter." />
                : <EmptyState icon={GraduationCap} title="No interns yet" description="Interns you onboard will appear here." />} />
            {list.data && list.data.total > PAGE_SIZE && <Pagination page={page} pageSize={PAGE_SIZE} total={list.data.total} onChange={setPage} noun="interns" />}
          </>
        )}
      </Card>
      <InternDrawer id={params.get('open')} onClose={() => setParams({}, { replace: true })} />
      {converting && <ConvertModal intern={converting} onClose={() => setConverting(null)} onDone={() => { list.reload(); reloadEmployees(); }} />}
    </>
  );
}
