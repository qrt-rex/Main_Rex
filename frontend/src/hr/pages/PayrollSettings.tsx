import { useState, type FormEvent } from 'react';
import { Eye, PlugZap, Save } from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';
import { useApi } from '../../lib/useApi';
import { dateTime } from '../../lib/format';
import { getPayrollSettings, payrollAuditLogs, payrollEmailLogs, savePayrollSettings, testSmtp, type PayrollSettings as Settings } from '../api';
import { Badge, StatusBadge } from '../../components/common/Badge';
import { Button } from '../../components/common/Button';
import { Card, CardHeader } from '../../components/common/Card';
import { EmptyState } from '../../components/common/EmptyState';
import { ErrorState } from '../../components/common/ErrorState';
import { Checkbox, Input, Select, Textarea } from '../../components/common/Input';
import { Modal } from '../../components/common/Modal';
import { PageSkeleton } from '../../components/common/Skeleton';
import { Table, type Column } from '../../components/common/Table';
import { Tabs } from '../../components/common/Tabs';
import { useToast } from '../../components/common/ToastContext';
import { PageHeader } from '../../components/layout/PageHeader';

const TEMPLATE_VARS = ['employee_name', 'employee_code', 'department', 'month', 'year', 'net_salary', 'company_name', 'payslip_number'];
const SAMPLE: Record<string, string> = {
  employee_name: 'Aarav Sharma', employee_code: 'EMP-001', department: 'SALES', month: 'September', year: '2026',
  net_salary: '97,000.00', company_name: 'Rexera Technologies Inc.', payslip_number: 'REX-PAY-2026SEP-0001',
};
const fill = (t: string) => t.replace(/{{\s*(\w+)\s*}}/g, (_, k: string) => SAMPLE[k] ?? `{{${k}}}`);

function useSave(settings: Settings, onSaved: (s: Settings) => void) {
  const { showToast } = useToast();
  const [saving, setSaving] = useState(false);
  const save = async (patch: Partial<Settings>, message: string) => {
    setSaving(true);
    try {
      onSaved(await savePayrollSettings({ ...settings, ...patch }));
      showToast(message, 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not save settings', 'error');
    } finally {
      setSaving(false);
    }
  };
  return { save, saving };
}

function Rules({ settings, onSaved }: { settings: Settings; onSaved: (s: Settings) => void }) {
  const [v, setV] = useState(settings);
  const { save, saving } = useSave(settings, onSaved);
  const set = (k: keyof Settings, numeric = false) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setV((s) => ({ ...s, [k]: numeric ? Number(e.target.value) : e.target.value }));
  const submit = (e: FormEvent) => {
    e.preventDefault();
    save({
      company_name: v.company_name, company_email: v.company_email, company_phone: v.company_phone, currency: v.currency,
      company_address: v.company_address, standard_working_days: v.standard_working_days, salary_proration_method: v.salary_proration_method,
      late_deduction_rule: v.late_deduction_rule, default_pt_amount: v.default_pt_amount, overtime_rate_multiplier: v.overtime_rate_multiplier,
      payslip_prefix: v.payslip_prefix,
    }, 'Payroll rules saved');
  };
  return (
    <form onSubmit={submit} className="space-y-4">
      <Card>
        <CardHeader title="Company details" description="Printed on payslips and used in emails." />
        <div className="grid gap-4 p-4 sm:grid-cols-2">
          <Input label="Legal name" required value={v.company_name} onChange={set('company_name')} />
          <Input label="Official email" type="email" required value={v.company_email} onChange={set('company_email')} />
          <Input label="Phone" value={v.company_phone} onChange={set('company_phone')} />
          <Input label="Currency" value={v.currency} onChange={set('currency')} />
          <Input label="Registered address" value={v.company_address} onChange={set('company_address')} className="sm:col-span-2" />
        </div>
      </Card>
      <Card>
        <CardHeader title="Calculation rules" />
        <div className="grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-3">
          <Input label="Standard working days" type="number" min={20} max={31} value={v.standard_working_days} onChange={set('standard_working_days', true)} />
          <Select label="Salary proration" value={v.salary_proration_method} onChange={set('salary_proration_method')}>
            <option value="calendar_days">Calendar days</option><option value="actual_working_days">Actual working days</option><option value="standard_30">Fixed 30-day month</option>
          </Select>
          <Select label="Late mark deduction" value={v.late_deduction_rule} onChange={set('late_deduction_rule')}>
            <option value="count_tiers">3 late marks = 0.5 day</option><option value="fixed">₹100 per late mark</option><option value="none">No deduction</option>
          </Select>
          <Input label="Default professional tax (₹)" type="number" min={0} value={v.default_pt_amount} onChange={set('default_pt_amount', true)} />
          <Input label="Overtime multiplier" type="number" min={1} step={0.1} value={v.overtime_rate_multiplier} onChange={set('overtime_rate_multiplier', true)} />
          <Input label="Payslip number prefix" value={v.payslip_prefix} onChange={set('payslip_prefix')} />
        </div>
      </Card>
      <div className="flex justify-end"><Button type="submit" loading={saving}><Save size={15} /> Save rules</Button></div>
    </form>
  );
}

function Delivery({ settings, onSaved }: { settings: Settings; onSaved: (s: Settings) => void }) {
  const { user } = useAuth();
  const { showToast } = useToast();
  const smtp = settings.smtp ?? { smtp_host: '', smtp_port: 587, smtp_user: '', smtp_password: '', from_name: '', from_email: '', email_dev_mode: false };
  const [v, setV] = useState(smtp);
  const [testing, setTesting] = useState(false);
  const { save, saving } = useSave(settings, onSaved);
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setV((s) => ({ ...s, [k]: e.target.type === 'checkbox' ? e.target.checked : k === 'smtp_port' ? Number(e.target.value) : e.target.value }));

  const test = async () => {
    setTesting(true);
    try {
      const res = await testSmtp(user?.email ?? '');
      showToast(res.message || `Test email sent to ${user?.email}`, 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'SMTP test failed', 'error');
    } finally {
      setTesting(false);
    }
  };

  return (
    <form onSubmit={(e) => { e.preventDefault(); save({ smtp: { ...v, smtp_encryption: 'TLS' } }, 'Email delivery settings saved'); }}>
      <Card>
        <CardHeader title="Email delivery (SMTP)" description="Used to send payslips to employees." />
        <div className="grid gap-4 p-4 sm:grid-cols-2">
          <Input label="SMTP host" required value={v.smtp_host} onChange={set('smtp_host')} placeholder="smtp.example.com" />
          <Input label="Port" type="number" required value={v.smtp_port} onChange={set('smtp_port')} />
          <Input label="Username" value={v.smtp_user} onChange={set('smtp_user')} autoComplete="off" />
          <Input label="App password" type="password" value={v.smtp_password} onChange={set('smtp_password')} autoComplete="new-password" />
          <Input label="Sender name" value={v.from_name} onChange={set('from_name')} />
          <Input label="Sender email" type="email" value={v.from_email} onChange={set('from_email')} />
          <Checkbox label="Simulation mode" description="Log emails on the server instead of sending them. The server's EMAIL_DEV_MODE setting takes precedence." checked={v.email_dev_mode} onChange={set('email_dev_mode')} className="sm:col-span-2" />
        </div>
        <div className="flex flex-wrap justify-end gap-2 border-t border-border px-4 py-3">
          <Button variant="secondary" onClick={test} loading={testing}><PlugZap size={15} /> Send test to {user?.email}</Button>
          <Button type="submit" loading={saving}><Save size={15} /> Save</Button>
        </div>
      </Card>
    </form>
  );
}

function Template({ settings, onSaved }: { settings: Settings; onSaved: (s: Settings) => void }) {
  const [subject, setSubject] = useState(settings.email_template?.subject_template ?? 'Salary Payslip - {{month}} {{year}} - {{employee_code}}');
  const [body, setBody] = useState(settings.email_template?.body_template ?? '');
  const [previewing, setPreviewing] = useState(false);
  const { save, saving } = useSave(settings, onSaved);
  return (
    <>
      <form onSubmit={(e) => { e.preventDefault(); save({ email_template: { subject_template: subject, body_template: body } }, 'Email template saved'); }}>
        <Card>
          <CardHeader title="Payslip email template" />
          <div className="space-y-4 p-4">
            <div className="flex flex-wrap gap-1.5">
              <span className="text-xs text-text-muted">Variables:</span>
              {TEMPLATE_VARS.map((t) => <code key={t} className="rounded bg-neutral-bg px-1.5 py-0.5 text-[11px] text-text-secondary">{`{{${t}}}`}</code>)}
            </div>
            <Input label="Subject" required value={subject} onChange={(e) => setSubject(e.target.value)} />
            <Textarea label="Body" required rows={10} value={body} onChange={(e) => setBody(e.target.value)} />
          </div>
          <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
            <Button variant="secondary" onClick={() => setPreviewing(true)}><Eye size={15} /> Preview</Button>
            <Button type="submit" loading={saving}><Save size={15} /> Save template</Button>
          </div>
        </Card>
      </form>
      <Modal open={previewing} onClose={() => setPreviewing(false)} size="lg" title="Email preview" description="With sample values filled in">
        <p className="mb-3 text-sm"><span className="text-text-muted">Subject: </span><span className="font-medium text-text">{fill(subject)}</span></p>
        <pre className="whitespace-pre-wrap rounded-md border border-border bg-surface-secondary p-4 font-sans text-sm text-text">{fill(body) || 'The body is empty.'}</pre>
      </Modal>
    </>
  );
}

function Logs() {
  const audit = useApi(payrollAuditLogs);
  const emails = useApi(payrollEmailLogs);
  type Audit = NonNullable<typeof audit.data>[number];
  type Email = NonNullable<typeof emails.data>[number];
  const auditCols: Column<Audit>[] = [
    { key: 't', header: 'When', render: (l) => <span className="whitespace-nowrap text-text-muted">{dateTime(l.timestamp)}</span> },
    { key: 'u', header: 'User', render: (l) => <span><span className="block text-text">{l.user_email}</span><span className="block text-xs text-text-muted">{l.user_role}</span></span> },
    { key: 'a', header: 'Action', render: (l) => <Badge tone="neutral">{l.action}</Badge> },
    { key: 'e', header: 'Entity', render: (l) => <code className="text-xs text-text-secondary">{l.entity_type}</code> },
    { key: 'emp', header: 'Employee', render: (l) => l.employee_name || 'System / batch' },
  ];
  const emailCols: Column<Email>[] = [
    { key: 't', header: 'Sent', render: (l) => <span className="whitespace-nowrap text-text-muted">{dateTime(l.sent_at)}</span> },
    { key: 'emp', header: 'Employee', render: (l) => <span><span className="block text-text">{l.employee_name}</span><span className="block text-xs text-text-muted">{l.employee_code}</span></span> },
    { key: 'to', header: 'Recipient', render: (l) => <span className="text-text-secondary">{l.email}</span> },
    { key: 'slip', header: 'Payslip', render: (l) => <span className="font-mono text-xs">{l.payslip_number}</span> },
    { key: 'period', header: 'Period', render: (l) => `${l.month} ${l.year}` },
    { key: 'status', header: 'Status', render: (l) => <StatusBadge status={l.status} /> },
    { key: 'msg', header: 'Details', className: 'max-w-60', render: (l) => <span className="line-clamp-2 text-xs text-text-muted">{l.error_message || 'Delivered'}</span> },
  ];
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title="Payroll audit trail" description="Sensitive payroll changes" actions={<Button size="sm" variant="ghost" onClick={audit.reload}>Refresh</Button>} />
        {audit.status === 'error' ? <ErrorState compact onRetry={audit.reload} message={audit.error} /> : (
          <Table caption="Payroll audit trail" columns={auditCols} rows={audit.data ?? []} rowKey={(l) => `${l.timestamp}-${l.action}-${l.employee_name}`} loading={audit.loading} empty={<EmptyState compact title="No payroll changes recorded yet" />} />
        )}
      </Card>
      <Card>
        <CardHeader title="Payslip email history" actions={<Button size="sm" variant="ghost" onClick={emails.reload}>Refresh</Button>} />
        {emails.status === 'error' ? <ErrorState compact onRetry={emails.reload} message={emails.error} /> : (
          <Table caption="Payslip email history" columns={emailCols} rows={emails.data ?? []} rowKey={(l) => `${l.sent_at}-${l.payslip_number}`} loading={emails.loading} empty={<EmptyState compact title="No payslip emails sent yet" />} />
        )}
      </Card>
    </div>
  );
}

export function PayrollSettings() {
  const settings = useApi(getPayrollSettings);
  const [tab, setTab] = useState('rules');
  if (settings.status === 'error') return <><PageHeader title="Payroll settings" /><Card><ErrorState onRetry={settings.reload} message={settings.error} /></Card></>;
  if (!settings.data) return <PageSkeleton />;
  const onSaved = (s: Settings) => settings.setData(s);
  return (
    <>
      <PageHeader title="Payroll settings" description="Calculation rules, payslip email delivery and audit history." breadcrumbs={[{ label: 'HR' }, { label: 'Payroll settings' }]} />
      <Tabs tabs={[{ id: 'rules', label: 'Rules' }, { id: 'delivery', label: 'Email delivery' }, { id: 'template', label: 'Email template' }, { id: 'logs', label: 'Audit & delivery logs' }]} active={tab} onChange={setTab} className="mb-4" />
      {tab === 'rules' && <Rules settings={settings.data} onSaved={onSaved} />}
      {tab === 'delivery' && <Delivery settings={settings.data} onSaved={onSaved} />}
      {tab === 'template' && <Template settings={settings.data} onSaved={onSaved} />}
      {tab === 'logs' && <Logs />}
    </>
  );
}
