import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { History, Lock, Plus, Power } from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';
import { ApiError } from '../../lib/api';
import { useApi } from '../../lib/useApi';
import { date, money } from '../../lib/format';
import { Badge } from '../../components/common/Badge';
import { Button } from '../../components/common/Button';
import { Card, CardHeader } from '../../components/common/Card';
import { ErrorState } from '../../components/common/ErrorState';
import { Checkbox, Input, Select, Textarea } from '../../components/common/Input';
import { Modal } from '../../components/common/Modal';
import { Skeleton } from '../../components/common/Skeleton';
import { Table, type Column } from '../../components/common/Table';
import { useToast } from '../../components/common/ToastContext';
import { createPfRule, getPfConfig, setPfRuleStatus, updatePfRule, updatePfSettings, type PfBasis, type PfRule, type PfSettings } from './api';
import { pct } from './format';

const BASIS_LABEL: Record<PfBasis, string> = { BASIC: 'Basic salary', BASIC_DA: 'Basic + DA', STATUTORY: 'Statutory PF wage' };
// Fields frozen once finalized payroll has used a rule: changing them would rewrite history, so a new rule is needed.
const LOCKED = ['minimum_pf_wage', 'maximum_pf_wage', 'employee_contribution_percent', 'employer_contribution_percent', 'eps_percent', 'eps_enabled', 'eps_wage_ceiling', 'calculation_basis', 'rounding', 'effective_from'];

type RuleForm = Record<string, string | boolean>;
const blankRule = (): RuleForm => ({
  rule_name: '', minimum_pf_wage: '', maximum_pf_wage: '', employee_contribution_percent: '12', employer_contribution_percent: '12',
  eps_percent: '8.33', eps_enabled: true, eps_wage_ceiling: '', calculation_basis: 'BASIC', rounding: 'PAISE',
  effective_from: '', effective_to: '', status: 'ACTIVE', applicability_notes: '', close_previous: true, reason: '',
});
const fromRule = (r: PfRule): RuleForm => ({
  rule_name: r.rule_name, minimum_pf_wage: String(r.minimum_pf_wage), maximum_pf_wage: String(r.maximum_pf_wage),
  employee_contribution_percent: String(r.employee_contribution_percent), employer_contribution_percent: String(r.employer_contribution_percent),
  eps_percent: String(r.eps_percent), eps_enabled: r.eps_enabled !== false, eps_wage_ceiling: r.eps_wage_ceiling ? String(r.eps_wage_ceiling) : '',
  calculation_basis: r.calculation_basis, rounding: r.rounding, effective_from: r.effective_from, effective_to: r.effective_to || '',
  status: r.status, applicability_notes: r.applicability_notes ?? '', close_previous: false, reason: '',
});

function validateRule(f: RuleForm) {
  const e: Record<string, string> = {};
  const n = (k: string) => Number(f[k]);
  if (!String(f.rule_name).trim()) e.rule_name = 'Give the rule a name.';
  if (f.minimum_pf_wage === '' || n('minimum_pf_wage') < 0) e.minimum_pf_wage = 'Enter ₹0 or more.';
  if (!(n('maximum_pf_wage') > 0)) e.maximum_pf_wage = 'Enter more than ₹0.';
  else if (n('minimum_pf_wage') > n('maximum_pf_wage')) e.maximum_pf_wage = 'Must be at least the minimum PF wage.';
  for (const k of ['employee_contribution_percent', 'employer_contribution_percent']) if (!(n(k) > 0 && n(k) <= 100)) e[k] = 'More than 0 and at most 100.';
  if (f.eps_percent === '' || n('eps_percent') < 0 || n('eps_percent') > n('employer_contribution_percent')) e.eps_percent = 'Between 0 and the employer PF %.';
  if (f.eps_wage_ceiling !== '' && n('eps_wage_ceiling') < 0) e.eps_wage_ceiling = 'Enter ₹0 or more.';
  if (!f.effective_from) e.effective_from = 'Choose when the rule starts.';
  if (f.effective_to && String(f.effective_to) < String(f.effective_from)) e.effective_to = 'Can\'t be before effective from.';
  return e;
}

function RuleModal({ rule, open, onClose, onSaved }: { rule: PfRule | null; open: boolean; onClose: () => void; onSaved: () => void }) {
  const { showToast } = useToast();
  const [f, setF] = useState<RuleForm>(() => (rule ? fromRule(rule) : blankRule()));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const locked = !!rule?.used_until;
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const v = e.target.type === 'checkbox' ? (e.target as HTMLInputElement).checked : e.target.value;
    setF((s) => ({ ...s, [k]: v }));
    if (errors[k]) setErrors((er) => ({ ...er, [k]: '' }));
  };
  const field = (k: string) => ({ id: `rule-${k}`, value: String(f[k] ?? ''), onChange: set(k), error: errors[k] || undefined, disabled: locked && LOCKED.includes(k) });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const found = validateRule(f);
    setErrors(found);
    const first = Object.keys(found)[0];
    if (first) { document.getElementById(`rule-${first}`)?.focus(); return; }
    const body: Record<string, unknown> = {
      ...f, eps_wage_ceiling: f.eps_wage_ceiling === '' ? null : f.eps_wage_ceiling, rule_name: String(f.rule_name).trim(),
    };
    setSaving(true);
    try {
      if (rule) {
        const changes = Object.fromEntries(Object.entries(body).filter(([k, v]) => k !== 'close_previous' && (k === 'reason' || String(v ?? '') !== String((fromRule(rule) as RuleForm)[k] ?? ''))));
        await updatePfRule(rule.id, changes);
      } else {
        await createPfRule(body);
      }
      showToast(rule ? 'PF rule updated' : 'PF rule added', 'success');
      onSaved();
      onClose();
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Could not save the rule', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} size="lg" title={rule ? `Edit ${rule.rule_name}` : 'Add a new PF rule'}
      description={locked ? `Used for finalized payroll up to ${date(rule!.used_until)}: only the name, end date and status can change. Create a new effective-dated rule for new wages or rates.` : 'Rules are effective-dated: payroll uses the rule in force on the last day of each month.'}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" form="pf-rule-form" loading={saving}>{rule ? 'Save rule' : 'Add rule'}</Button></>}>
      <form id="pf-rule-form" onSubmit={submit} noValidate className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Input label="Rule name" required {...field('rule_name')} className="sm:col-span-2" placeholder="e.g. PF Rule 2027" />
        <Input label="Minimum PF wage (₹)" type="number" min={0} required {...field('minimum_pf_wage')} />
        <Input label="Maximum PF wage / ceiling (₹)" type="number" min={0} required {...field('maximum_pf_wage')} />
        <Input label="Employee PF %" type="number" step="0.01" min={0} max={100} required {...field('employee_contribution_percent')} />
        <Input label="Employer PF %" type="number" step="0.01" min={0} max={100} required {...field('employer_contribution_percent')} />
        <Input label="EPS %" type="number" step="0.01" min={0} max={100} required {...field('eps_percent')} hint="Part of the employer PF that goes to EPS" />
        <Input label="EPS wage ceiling (₹)" type="number" min={0} {...field('eps_wage_ceiling')} hint="Blank: EPS on the full PF wage" />
        <Select label="PF wage calculation basis" {...field('calculation_basis')}>
          {Object.entries(BASIS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Select>
        <Select label="Rounding" {...field('rounding')}>
          <option value="PAISE">To the paisa (half up)</option><option value="RUPEE">To the rupee (half up)</option>
        </Select>
        <Input label="Effective from" type="date" required {...field('effective_from')} />
        <Input label="Effective to" type="date" {...field('effective_to')} hint="Blank: open-ended" />
        <Select label="Rule status" {...field('status')}><option value="ACTIVE">Active</option><option value="INACTIVE">Inactive</option></Select>
        <Checkbox label="EPS applies under this rule" checked={!!f.eps_enabled} onChange={set('eps_enabled')} disabled={locked} className="self-end pb-1.5" />
        <Textarea label="PF / EPS applicability and exemption notes" {...field('applicability_notes')} className="sm:col-span-2" placeholder="e.g. Applies to all employees unless exempted with a reason in PF details." />
        {!rule && <Checkbox label="End the current open-ended rule the day before this one starts" checked={!!f.close_previous} onChange={set('close_previous')} className="sm:col-span-2" />}
        <Textarea label="Reason (for the audit trail)" {...field('reason')} className="sm:col-span-2" />
      </form>
    </Modal>
  );
}

function SettingsCard({ settings, canEdit, onSaved }: { settings: PfSettings; canEdit: boolean; onSaved: () => void }) {
  const { showToast } = useToast();
  const [pending, setPending] = useState<Partial<PfSettings> | null>(null);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    try {
      await updatePfSettings({ ...pending, reason });
      showToast('PF configuration updated', 'success');
      setPending(null); setReason('');
      onSaved();
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Could not update', 'error');
    } finally { setSaving(false); }
  };
  const toggles: [keyof PfSettings, string, string][] = [
    ['enabled', 'PF status', settings.enabled ? 'Enabled: payroll calculates PF' : 'Disabled: payroll deducts no PF'],
    ['require_uan_to_finalize', 'UAN required to finalize payroll', settings.require_uan_to_finalize ? 'Yes' : 'No: a missing UAN is a warning'],
    ['require_member_id_to_finalize', 'PF Member ID required to finalize payroll', settings.require_member_id_to_finalize ? 'Yes' : 'No: a missing Member ID is a warning'],
  ];
  return (
    <Card>
      <CardHeader title="PF status and payroll checks" description={settings.updated_by ? `Last changed by ${settings.updated_by} · ${date(settings.updated_at)}` : undefined} />
      <dl className="divide-y divide-border text-sm">
        {toggles.map(([k, label, state]) => (
          <div key={k} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
            <div><dt className="font-medium text-text">{label}</dt><dd className="text-xs text-text-muted">{state}</dd></div>
            {canEdit && <Button size="sm" variant="secondary" onClick={() => setPending({ [k]: !settings[k] })}>{settings[k] ? 'Turn off' : 'Turn on'}</Button>}
          </div>
        ))}
      </dl>
      <Modal open={!!pending} onClose={() => setPending(null)} title="Change PF configuration" size="sm"
        footer={<><Button variant="secondary" onClick={() => setPending(null)}>Cancel</Button><Button onClick={save} loading={saving} disabled={reason.trim().length < 3}>Confirm</Button></>}>
        <Textarea label="Reason (for the audit trail)" required value={reason} onChange={(e) => setReason(e.target.value)} />
      </Modal>
    </Card>
  );
}

export function PfConfigTab() {
  const { can } = useAuth();
  const canEdit = can('hr.pf.configure');
  const { showToast } = useToast();
  const cfg = useApi(getPfConfig);
  const [editing, setEditing] = useState<PfRule | 'new' | null>(null);
  const [history, setHistory] = useState(false);
  const [statusFor, setStatusFor] = useState<PfRule | null>(null);
  const [reason, setReason] = useState('');
  const c = cfg.data;

  if (cfg.status === 'error') return <Card><ErrorState onRetry={cfg.reload} message={cfg.error} /></Card>;
  if (!c) return <div className="space-y-3"><Skeleton className="h-40" /><Skeleton className="h-40" /></div>;
  const cur = c.current_rule;
  const future = c.rules.filter((r) => r.is_future);

  const flipStatus = async () => {
    if (!statusFor) return;
    try {
      await setPfRuleStatus(statusFor.id, statusFor.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE', reason);
      showToast('Rule status changed', 'success');
      setStatusFor(null); setReason('');
      cfg.reload();
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Could not change the status', 'error');
    }
  };

  const columns: Column<PfRule>[] = [
    { key: 'rule_name', header: 'Rule', render: (r) => <span className="font-medium text-text">{r.rule_name} {r.is_current && <Badge tone="success">Current</Badge>} {r.is_future && <Badge tone="info">Future</Badge>}</span>, sortValue: (r) => r.rule_name },
    { key: 'wages', header: 'PF wage', render: (r) => `${money(r.minimum_pf_wage)} – ${money(r.maximum_pf_wage)}` },
    { key: 'rates', header: 'Employee / employer / EPS', render: (r) => `${pct(r.employee_contribution_percent)} / ${pct(r.employer_contribution_percent)} / ${pct(r.eps_percent)}` },
    { key: 'basis', header: 'Basis', render: (r) => BASIS_LABEL[r.calculation_basis] },
    { key: 'from', header: 'Effective', render: (r) => `${date(r.effective_from)} → ${r.effective_to ? date(r.effective_to) : 'open-ended'}`, sortValue: (r) => r.effective_from },
    { key: 'status', header: 'Status', render: (r) => <Badge tone={r.status === 'ACTIVE' ? 'success' : 'neutral'}>{r.status === 'ACTIVE' ? 'Active' : 'Inactive'}</Badge> },
    { key: 'used', header: 'Finalized payroll', render: (r) => r.used_until ? <span className="inline-flex items-center gap-1 text-xs text-text-muted"><Lock size={12} /> up to {date(r.used_until)}</span> : <span className="text-xs text-text-muted">Not used</span> },
    { key: 'by', header: 'Created / updated', render: (r) => <span className="text-xs text-text-muted">{r.created_by} · {date(r.created_at)}{r.updated_by && r.updated_at !== r.created_at ? ` / ${r.updated_by} · ${date(r.updated_at)}` : ''}</span> },
    ...(canEdit ? [{ key: 'actions', header: '', align: 'right' as const, render: (r: PfRule) => (
      <div className="flex justify-end gap-1">
        <Button size="sm" variant="ghost" onClick={() => setEditing(r)}>Edit</Button>
        <Button size="sm" variant="ghost" onClick={() => setStatusFor(r)}><Power size={13} /> {r.status === 'ACTIVE' ? 'Deactivate' : 'Activate'}</Button>
        <Link to={`/hr/pf?tab=reports&kind=impact&rule=${r.id}`} className="inline-flex h-8 items-center rounded-md px-2.5 text-sm text-primary hover:bg-surface-secondary">Impact</Link>
      </div>
    ) }] : []),
  ];

  return (
    <div className="space-y-4">
      {c.issues.length > 0 && (
        <Card className="border-warning/50 p-4 text-sm">
          <p className="font-medium text-warning">Configuration needs attention</p>
          <ul className="mt-1 list-disc pl-5 text-text-secondary">{c.issues.map((i) => <li key={i}>{i}</li>)}</ul>
        </Card>
      )}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Current PF rule" description={cur ? `In force today (${date(c.today)})` : undefined}
            actions={canEdit ? <Button size="sm" onClick={() => setEditing('new')}><Plus size={14} /> Add new rule</Button> : undefined} />
          {cur ? (
            <dl className="divide-y divide-border text-sm">
              {([
                ['PF status', c.settings.enabled ? <Badge key="s" tone="success" dot>Enabled</Badge> : <Badge key="s" tone="neutral" dot>Disabled</Badge>],
                ['Rule', cur.rule_name],
                ['Minimum PF wage', money(cur.minimum_pf_wage)], ['Maximum PF wage', money(cur.maximum_pf_wage)],
                ['Employee PF', pct(cur.employee_contribution_percent)], ['Employer PF', pct(cur.employer_contribution_percent)],
                ['EPS', cur.eps_enabled === false ? 'Not applied' : `${pct(cur.eps_percent)}${cur.eps_wage_ceiling ? ` (on wage up to ${money(cur.eps_wage_ceiling)})` : ''}`],
                ['PF wage basis', BASIS_LABEL[cur.calculation_basis]],
                ['Effective from', date(cur.effective_from)], ['Effective to', cur.effective_to ? date(cur.effective_to) : 'Open-ended'],
                ['Status', cur.status === 'ACTIVE' ? 'Active' : 'Inactive'],
              ] as [string, React.ReactNode][]).map(([k, v]) => (
                <div key={k} className="flex justify-between gap-3 px-4 py-2"><dt className="text-text-muted">{k}</dt><dd className="text-right text-text">{v}</dd></div>
              ))}
            </dl>
          ) : <p className="p-4 text-sm text-danger">No active PF rule covers today. Payroll can't calculate PF until one does.</p>}
          {cur?.applicability_notes && <p className="border-t border-border px-4 py-2.5 text-xs text-text-muted">{cur.applicability_notes}</p>}
          <div className="flex flex-wrap gap-2 border-t border-border px-4 py-3">
            <Button size="sm" variant="secondary" onClick={() => setHistory((h) => !h)}><History size={14} /> {history ? 'Hide rule history' : 'View rule history'}</Button>
            {canEdit && future.length > 0 && <Button size="sm" variant="secondary" onClick={() => setEditing(future[future.length - 1])}>Edit future rule</Button>}
            {canEdit && cur && <Button size="sm" variant="secondary" onClick={() => setStatusFor(cur)}><Power size={14} /> Deactivate rule</Button>}
          </div>
        </Card>
        <SettingsCard settings={c.settings} canEdit={canEdit} onSaved={cfg.reload} />
      </div>
      {!canEdit && <p className="text-xs text-text-muted">You can view the PF configuration. Changing rules, rates and wage limits needs the "Configure PF rules" permission (Super Admin).</p>}

      {(history || future.length > 0) && (
        <Card>
          <CardHeader title={history ? 'Rule history' : 'Upcoming rules'} description="Rules are never overwritten once payroll has been finalized with them; add a new effective-dated rule instead." />
          <Table columns={columns} rows={history ? c.rules : future} rowKey={(r) => r.id} caption="PF rules" />
        </Card>
      )}

      {editing && <RuleModal rule={editing === 'new' ? null : editing} open={!!editing} onClose={() => setEditing(null)} onSaved={cfg.reload} />}
      <Modal open={!!statusFor} onClose={() => setStatusFor(null)} size="sm"
        title={statusFor?.status === 'ACTIVE' ? `Deactivate ${statusFor?.rule_name}?` : `Activate ${statusFor?.rule_name}?`}
        description={statusFor?.status === 'ACTIVE' ? 'Payroll in this rule\'s dates will have no PF rule (and can\'t be finalized) until another rule covers them. Finalized payroll is unaffected.' : 'The rule must not overlap another active rule.'}
        footer={<><Button variant="secondary" onClick={() => setStatusFor(null)}>Cancel</Button><Button onClick={flipStatus} disabled={reason.trim().length < 3}>Confirm</Button></>}>
        <Textarea label="Reason (for the audit trail)" required value={reason} onChange={(e) => setReason(e.target.value)} />
      </Modal>
    </div>
  );
}
