import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Eye, EyeOff, FileText, MoreHorizontal, Pencil, Trash2, UserPlus, Users } from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';
import { useApi, useDebounced } from '../../lib/useApi';
import { date, money } from '../../lib/format';
import { bulkEmployees, deleteEmployee, DEPARTMENTS, EMPLOYEE_STATUSES, getEmployee, listEmployees, type Employee } from '../api';
import { useEmployeeOptions } from '../HrSection';
import { DetailList, ExportMenu, ImportButton, Section, Toolbar } from '../components';
import { EmployeePfCard } from '../pf/components';
import { Avatar } from '../../components/common/Avatar';
import { StatusBadge } from '../../components/common/Badge';
import { Button } from '../../components/common/Button';
import { Card } from '../../components/common/Card';
import { useConfirm } from '../../components/common/ConfirmDialog';
import { Dropdown, DropdownItem, DropdownSeparator } from '../../components/common/Dropdown';
import { EmptyState } from '../../components/common/EmptyState';
import { ErrorState } from '../../components/common/ErrorState';
import { SearchInput, Select } from '../../components/common/Input';
import { Drawer } from '../../components/common/Modal';
import { Skeleton } from '../../components/common/Skeleton';
import { Pagination, Table, type Column } from '../../components/common/Table';
import { useToast } from '../../components/common/ToastContext';
import { PageHeader } from '../../components/layout/PageHeader';

const PAGE_SIZE = 15;

function BankAccount({ employee }: { employee: Employee }) {
  const { can } = useAuth();
  const { showToast } = useToast();
  const [full, setFull] = useState<string | null>(null);
  if (!can('hr.employees.bank')) return <span className="font-mono text-xs text-text-muted">{employee.account_no}</span>;
  const toggle = async () => {
    if (full) return setFull(null);
    try {
      setFull((await getEmployee(employee.id, true)).account_no);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not reveal the account', 'error');
    }
  };
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="font-mono text-xs text-text-secondary">{full ?? employee.account_no}</span>
      <button onClick={(e) => { e.stopPropagation(); toggle(); }} aria-label={full ? 'Hide account number' : 'Reveal account number'} className="rounded p-0.5 text-text-muted hover:text-text">
        {full ? <EyeOff size={13} /> : <Eye size={13} />}
      </button>
    </span>
  );
}

function EmployeeDrawer({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { can } = useAuth();
  const emp = useApi(() => getEmployee(id!, can('hr.employees.bank')), [id], !!id);
  const e = emp.data;
  return (
    <Drawer
      open={!!id}
      onClose={onClose}
      title="Employee profile"
      footer={e && can('hr.employees.edit') ? <Link to={`/hr/employees/${e.id}/edit`} className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-3.5 text-sm font-medium text-on-primary hover:bg-primary-hover"><Pencil size={15} /> Edit</Link> : undefined}
    >
      {emp.status === 'error' ? (
        <ErrorState compact onRetry={emp.reload} message={emp.error} />
      ) : !e || emp.loading ? (
        <div className="space-y-3"><Skeleton className="h-12" /><Skeleton className="h-32" /><Skeleton className="h-32" /></div>
      ) : (
        <div className="space-y-5">
          <div className="flex items-center gap-3">
            <Avatar name={e.full_name} size={48} />
            <div className="min-w-0">
              <p className="truncate text-base font-semibold text-text">{e.full_name}</p>
              <p className="truncate text-sm text-text-muted">{e.employee_code} · {e.designation} · {e.department}</p>
            </div>
          </div>
          <Section title="Details">
            <DetailList items={[
              ['Email', e.email], ['Mobile', e.mobile_number], ['Branch', e.branch], ['Gender', e.gender],
              ['Reporting manager', e.reporting_manager], ['Date of joining', date(e.date_of_joining)],
              ...(e.date_of_exit ? [['Date of exit', date(e.date_of_exit)] as [string, string]] : []),
              ['Status', <StatusBadge status={e.employee_status} />], ['Onboarding', e.joining_status],
            ]} />
          </Section>
          <Section title="Salary structure (monthly)">
            <dl className="divide-y divide-border rounded-md border border-border text-sm">
              {([['Basic', e.base_salary], ['DA', e.da ?? 0], ['HRA', e.hra], ['Conveyance', e.conveyance_allowance], ['Special allowance', e.special_allowance], ['Professional tax', e.professional_tax]] as const).map(([k, v]) => (
                <div key={k} className="flex justify-between px-3 py-2"><dt className="text-text-muted">{k}</dt><dd className="tabular-nums text-text">{money(v)}</dd></div>
              ))}
              <div className="flex justify-between px-3 py-2"><dt className="text-text-muted">Provident fund</dt><dd className="text-text">{can('hr.pf.view') ? 'See PF details below' : e.pf_opted ? 'Applicable' : 'Not applicable'}</dd></div>
              <div className="flex justify-between bg-surface-secondary px-3 py-2 font-medium"><dt className="text-text">Gross salary</dt><dd className="tabular-nums text-text">{money(e.gross_salary)}</dd></div>
              <div className="flex justify-between bg-surface-secondary px-3 py-2 font-medium"><dt className="text-text">Estimated net</dt><dd className="tabular-nums text-success">{money(e.estimated_net_salary)}</dd></div>
            </dl>
          </Section>
          {can('hr.pf.view') && (
            <Section title="PF details">
              <EmployeePfCard employeeId={e.id} compact />
            </Section>
          )}
          <Section title="Banking">
            <DetailList items={[['Bank', e.bank_name], ['Account number', <span className="font-mono">{e.account_no}</span>], ['IFSC', <span className="font-mono">{e.ifsc_code}</span>]]} />
            {!can('hr.employees.bank') && <p className="mt-2 text-xs text-text-muted">Account number is masked for your role.</p>}
          </Section>
        </div>
      )}
    </Drawer>
  );
}

export function HrEmployees() {
  const { can } = useAuth();
  const { showToast } = useToast();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const { reload: reloadOptions } = useEmployeeOptions();
  const [params, setParams] = useSearchParams();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [department, setDepartment] = useState('');
  const [status, setStatus] = useState('');
  const q = useDebounced(search);
  const openId = params.get('open');

  const list = useApi(() => listEmployees({ search: q, department, status, page, limit: PAGE_SIZE }), [q, department, status, page]);
  useEffect(() => setPage(1), [q, department, status]);

  const refresh = () => {
    list.reload();
    reloadOptions();
  };

  const remove = async (e: Employee) => {
    const ok = await confirm({ title: `Delete ${e.full_name}?`, message: 'This permanently removes the employee record. This cannot be undone.', confirmText: 'Delete employee', tone: 'danger' });
    if (!ok) return;
    try {
      await deleteEmployee(e.id);
      showToast('Employee deleted', 'success');
      refresh();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not delete', 'error');
    }
  };

  const columns: Column<Employee>[] = [
    {
      key: 'name', header: 'Employee', sortValue: (e) => e.full_name.toLowerCase(),
      render: (e) => (
        <span className="flex min-w-0 items-center gap-3">
          <Avatar name={e.full_name} size={30} />
          <span className="min-w-0">
            <span className="block truncate font-medium text-text">{e.full_name}</span>
            <span className="block truncate text-xs text-text-muted">{e.employee_code} · {e.email}</span>
          </span>
        </span>
      ),
    },
    { key: 'dept', header: 'Department', sortValue: (e) => e.department, render: (e) => <span><span className="block text-text">{e.department}</span><span className="block text-xs text-text-muted">{e.designation}</span></span> },
    { key: 'branch', header: 'Branch', sortValue: (e) => e.branch ?? '', render: (e) => e.branch || '—' },
    { key: 'bank', header: 'Bank account', render: (e) => <BankAccount employee={e} /> },
    { key: 'gross', header: 'Gross / month', align: 'right', sortValue: (e) => e.gross_salary, render: (e) => <span className="tabular-nums">{money(e.gross_salary)}</span> },
    { key: 'status', header: 'Status', sortValue: (e) => e.employee_status, render: (e) => <StatusBadge status={e.employee_status} /> },
    { key: 'joined', header: 'Joined', sortValue: (e) => e.date_of_joining, render: (e) => <span className="whitespace-nowrap text-text-muted">{date(e.date_of_joining)}</span> },
    {
      key: 'actions', header: <span className="sr-only">Actions</span>, align: 'right',
      render: (e) => (
        <span onClick={(ev) => ev.stopPropagation()}>
          <Dropdown label={`Actions for ${e.full_name}`} width="w-52" triggerClassName="h-8 w-8 justify-center text-text-muted hover:bg-neutral-bg hover:text-text" trigger={<MoreHorizontal size={16} />}>
            <DropdownItem icon={<Eye size={15} />} onClick={() => setParams({ open: e.id })}>View profile</DropdownItem>
            {can('hr.employees.edit') && <DropdownItem icon={<Pencil size={15} />} onClick={() => navigate(`/hr/employees/${e.id}/edit`)}>Edit</DropdownItem>}
            {can('hr.payroll.process') && <DropdownItem icon={<FileText size={15} />} onClick={() => navigate(`/hr/payslips?tab=generate&emp=${e.id}`)}>Generate payslip</DropdownItem>}
            {can('hr.employees.delete') && (
              <>
                <DropdownSeparator />
                <DropdownItem icon={<Trash2 size={15} />} tone="danger" onClick={() => remove(e)}>Delete</DropdownItem>
              </>
            )}
          </Dropdown>
        </span>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Employees"
        description="Full-time staff, compensation and banking details."
        breadcrumbs={[{ label: 'HR', to: can('hr.dashboard.view') ? '/hr' : undefined }, { label: 'Employees' }]}
        actions={<>
          {can('hr.employees.create') && (
            <ImportButton
              noun="employees"
              columns={[
                { header: 'Name', value: (r) => String(r.full_name ?? '') },
                { header: 'Email', value: (r) => String(r.email ?? '') },
                { header: 'Mobile', value: (r) => String(r.mobile_number ?? '') },
                { header: 'Department', value: (r) => String(r.department ?? '') },
                { header: 'Designation', value: (r) => String(r.designation ?? '') },
                { header: 'Basic', value: (r) => money(r.base_salary) },
              ]}
              onImport={async (rows) => { const res = await bulkEmployees(rows); refresh(); return res; }}
            />
          )}
          <ExportMenu
            filename="employees"
            sheet="Employees"
            template={can('hr.employees.create') ? 'employee' : undefined}
            fetchRows={async () => (await listEmployees({ limit: 2000 })).employees.map((e) => ({
              'Employee code': e.employee_code, 'Full name': e.full_name, Email: e.email, Mobile: e.mobile_number,
              Department: e.department, Designation: e.designation, Gender: e.gender ?? '', Branch: e.branch ?? '',
              'Reporting manager': e.reporting_manager ?? '', 'Date of joining': e.date_of_joining, Status: e.employee_status,
              Basic: e.base_salary, HRA: e.hra, Conveyance: e.conveyance_allowance, 'Special allowance': e.special_allowance,
              Gross: e.gross_salary, 'PF opted': e.pf_opted ? 'Yes' : 'No', 'Professional tax': e.professional_tax,
              Bank: e.bank_name, 'Account number': e.account_no, IFSC: e.ifsc_code,
            }))}
          />
          {can('hr.employees.create') && <Link to="/hr/employees/new" className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-3.5 text-sm font-medium text-on-primary shadow-[var(--shadow-card)] hover:bg-primary-hover"><UserPlus size={15} /> Add employee</Link>}
        </>}
      />
      <Card>
        <Toolbar count={list.data ? `${list.data.total} employees` : undefined}>
          <SearchInput value={search} onChange={setSearch} placeholder="Search name, code, email…" label="Search employees" />
          <Select aria-label="Department" value={department} onChange={(e) => setDepartment(e.target.value)} selectClassName="w-40">
            <option value="">All departments</option>
            {DEPARTMENTS.map((d) => <option key={d}>{d}</option>)}
          </Select>
          <Select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)} selectClassName="w-36">
            <option value="">All statuses</option>
            {EMPLOYEE_STATUSES.map((s) => <option key={s}>{s}</option>)}
          </Select>
        </Toolbar>
        {list.status === 'error' ? (
          <ErrorState onRetry={list.reload} message={list.error} />
        ) : (
          <>
            <Table
              caption="Employees"
              columns={columns}
              rows={list.data?.employees ?? []}
              rowKey={(e) => e.id}
              loading={list.loading}
              onRowClick={(e) => setParams({ open: e.id })}
              empty={
                q || department || status
                  ? <EmptyState compact icon={Users} title="No employees match" description="Try a different search or filter." />
                  : <EmptyState icon={Users} title="No employees yet" description="Employees added to your HR system will appear here." action={can('hr.employees.create') ? <Button onClick={() => navigate('/hr/employees/new')}><UserPlus size={15} /> Add employee</Button> : undefined} />
              }
            />
            {list.data && list.data.total > PAGE_SIZE && <Pagination page={page} pageSize={PAGE_SIZE} total={list.data.total} onChange={setPage} noun="employees" />}
          </>
        )}
      </Card>
      <EmployeeDrawer id={openId} onClose={() => setParams({}, { replace: true })} />
    </>
  );
}
