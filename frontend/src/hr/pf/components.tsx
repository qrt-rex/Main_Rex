import { useState, type FormEvent } from 'react';
import { Pencil } from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';
import { ApiError } from '../../lib/api';
import { useApi } from '../../lib/useApi';
import { date, money } from '../../lib/format';
import { pct, pfMoney } from './format';
import { Badge } from '../../components/common/Badge';
import { Button } from '../../components/common/Button';
import { ErrorState } from '../../components/common/ErrorState';
import { Input, Select, Textarea } from '../../components/common/Input';
import { Modal } from '../../components/common/Modal';
import { Skeleton } from '../../components/common/Skeleton';
import { useToast } from '../../components/common/ToastContext';
import {
  getEmployeePf, PF_STATUS_LABEL, PF_STATUS_TONE, saveEmployeePf,
  type EmployeePfDetails, type EmployeePfView, type PfCalculation, type PfStatus,
} from './api';


export function PfStatusBadge({ status }: { status?: PfStatus | null }) {
  if (!status) return <span className="text-text-muted">—</span>;
  return <Badge tone={PF_STATUS_TONE[status]} dot>{PF_STATUS_LABEL[status]}</Badge>;
}

/** Basic salary vs PF wage, then the contributions: why someone on ₹40,000 basic pays PF on ₹25,000. */
export function PfBreakdown({ calc }: { calc: PfCalculation }) {
  if (calc.status && calc.status !== 'CALCULATED') {
    return (
      <div className="rounded-md border border-border bg-surface-secondary p-3 text-sm">
        <PfStatusBadge status={calc.status} />
        <p className="mt-1.5 text-text-secondary">{calc.reason}</p>
      </div>
    );
  }
  const limited = calc.wage_limited_by === 'minimum' ? 'raised to the minimum PF wage' : calc.wage_limited_by === 'maximum' ? 'capped at the maximum PF wage' : 'within the PF wage limits';
  const rows: [string, string, string][] = [
    ['Employee PF', pct(calc.employee_pf_percent), pfMoney(calc.employee_pf)],
    ['Employer PF', pct(calc.employer_pf_percent), pfMoney(calc.employer_pf)],
    ['EPS', calc.eps_applicable === false ? 'Not applicable' : pct(calc.eps_percent), pfMoney(calc.eps)],
    ['Employer EPF (employer PF − EPS)', '', pfMoney(calc.employer_epf)],
  ];
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <div className="rounded-md border border-border p-3">
          <p className="text-xs text-text-muted">Actual basic salary</p>
          <p className="mt-0.5 text-lg font-semibold tabular-nums text-text">{money(calc.basic_salary)}</p>
          {calc.calculation_basis === 'BASIC_DA' && <p className="text-xs text-text-muted">+ DA {money(calc.da)} (rule uses Basic + DA)</p>}
          {calc.calculation_basis === 'STATUTORY' && <p className="text-xs text-text-muted">Rule uses the statutory PF wage {money(calc.pf_base)}</p>}
        </div>
        <div className="rounded-md border border-border p-3">
          <p className="text-xs text-text-muted">PF wage limits</p>
          <p className="mt-0.5 text-sm font-medium tabular-nums text-text">{money(calc.minimum_pf_wage)} – {money(calc.maximum_pf_wage)}</p>
          <p className="text-xs text-text-muted">{calc.rule_name}</p>
        </div>
        <div className="rounded-md border border-primary/40 bg-primary-soft p-3">
          <p className="text-xs text-primary">PF wage (calculation base)</p>
          <p className="mt-0.5 text-lg font-semibold tabular-nums text-text">{money(calc.pf_wage)}</p>
          <p className="text-xs text-text-muted">{limited}</p>
        </div>
      </div>
      <p className="text-xs text-text-muted">
        PF wage = MIN(MAX({money(calc.pf_base ?? calc.basic_salary)}, {money(calc.minimum_pf_wage)}), {money(calc.maximum_pf_wage)}) = <span className="font-medium text-text">{money(calc.pf_wage)}</span>
      </p>
      <dl className="divide-y divide-border rounded-md border border-border text-sm">
        {rows.map(([label, rate, amount]) => (
          <div key={label} className="flex items-center justify-between gap-3 px-3 py-2">
            <dt className="text-text-muted">{label}</dt>
            <dd className="flex items-center gap-3"><span className="text-xs text-text-muted">{rate}</span><span className="tabular-nums text-text">{amount}</span></dd>
          </div>
        ))}
        <div className="flex justify-between bg-surface-secondary px-3 py-2 font-medium">
          <dt className="text-text">Total PF (employee + employer)</dt><dd className="tabular-nums text-text">{pfMoney(calc.total_contribution)}</dd>
        </div>
      </dl>
      {!!calc.issues?.length && (
        <ul className="space-y-1 text-xs">
          {calc.issues.map((i) => <li key={i.code} className={i.blocking ? 'text-danger' : 'text-warning'}>{i.blocking ? 'Blocks payroll finalization: ' : ''}{i.message}</li>)}
        </ul>
      )}
    </div>
  );
}

const UAN_RE = /^\d{12}$/;
const MEMBER_RE = /^[A-Z0-9/]{10,30}$/;

type FormState = Omit<EmployeePfDetails, 'statutory_pf_wage' | 'is_default' | 'updated_by' | 'updated_at'> & { statutory_pf_wage: string; reason: string };

function toForm(d: EmployeePfDetails): FormState {
  return {
    pf_applicable: d.pf_applicable, eps_applicable: d.eps_applicable, uan: d.uan ?? '', pf_member_id: d.pf_member_id ?? '',
    previous_pf_member_id: d.previous_pf_member_id ?? '', pf_joining_date: d.pf_joining_date ?? '',
    statutory_pf_wage: d.statutory_pf_wage === null || d.statutory_pf_wage === undefined ? '' : String(d.statutory_pf_wage),
    exemption_reason: d.exemption_reason ?? '', effective_from: d.effective_from ?? '', effective_to: d.effective_to ?? '', reason: '',
  };
}

function validatePf(f: FormState, isNew: boolean) {
  const e: Record<string, string> = {};
  if (f.uan && !UAN_RE.test(f.uan)) e.uan = 'UAN must be exactly 12 digits.';
  if (f.pf_member_id && !MEMBER_RE.test(f.pf_member_id.toUpperCase())) e.pf_member_id = 'Use 10 to 30 letters or digits, e.g. MHBAN00000640000000125.';
  if (f.previous_pf_member_id && !MEMBER_RE.test(f.previous_pf_member_id.toUpperCase())) e.previous_pf_member_id = 'Use 10 to 30 letters or digits.';
  if (!f.pf_applicable && f.exemption_reason.trim().length < 3) e.exemption_reason = 'An employee can only be made PF-exempt with a reason.';
  if (f.effective_from && f.effective_to && f.effective_to < f.effective_from) e.effective_to = 'Can\'t be before effective from.';
  if (f.statutory_pf_wage && !(Number(f.statutory_pf_wage) >= 0)) e.statutory_pf_wage = 'Enter a wage of ₹0 or more.';
  if (!isNew && f.reason.trim().length < 3) e.reason = 'Say why this is changing (it goes in the PF audit trail).';
  return e;
}

export function EmployeePfForm({ view, open, onClose, onSaved }: { view: EmployeePfView; open: boolean; onClose: () => void; onSaved: (v: EmployeePfView) => void }) {
  const { showToast } = useToast();
  const isNew = !!view.details.is_default;
  const [f, setF] = useState<FormState>(() => toForm(view.details));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const set = (k: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const v = e.target.value;
    setF((s) => ({ ...s, [k]: k === 'pf_applicable' || k === 'eps_applicable' ? v === 'yes' : v }));
    if (errors[k]) setErrors((er) => ({ ...er, [k]: '' }));
  };
  const field = (k: keyof FormState) => ({ id: `pf-${k}`, value: String(f[k] ?? ''), onChange: set(k), error: errors[k] || undefined });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const found = validatePf(f, isNew);
    setErrors(found);
    const first = Object.keys(found)[0];
    if (first) { document.getElementById(`pf-${first}`)?.focus(); return; }
    setSaving(true);
    try {
      const saved = await saveEmployeePf(view.employee.id, {
        ...f, uan: f.uan.trim(), pf_member_id: f.pf_member_id.trim().toUpperCase(), previous_pf_member_id: f.previous_pf_member_id.trim().toUpperCase(),
        statutory_pf_wage: f.statutory_pf_wage === '' ? null : f.statutory_pf_wage,
        exemption_reason: f.pf_applicable ? '' : f.exemption_reason.trim(), reason: f.reason.trim(),
      });
      showToast('PF details saved', 'success');
      onSaved(saved);
      onClose();
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Could not save PF details', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} size="lg" title={`PF details · ${view.employee.full_name}`}
      description="PF amounts are worked out from the PF rule in force; here you record membership and exemptions."
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" form="pf-details-form" loading={saving}>Save PF details</Button></>}>
      <form id="pf-details-form" onSubmit={submit} noValidate className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Select label="PF applicable" {...field('pf_applicable')} value={f.pf_applicable ? 'yes' : 'no'}>
          <option value="yes">Yes</option><option value="no">No (exempt)</option>
        </Select>
        <Select label="EPS applicable" {...field('eps_applicable')} value={f.eps_applicable ? 'yes' : 'no'} disabled={!f.pf_applicable}>
          <option value="yes">Yes</option><option value="no">No</option>
        </Select>
        {!f.pf_applicable && (
          <Textarea label="PF exemption reason" required {...field('exemption_reason')} className="sm:col-span-2" placeholder="e.g. Excluded employee under para 2(f): basic above the statutory limit at joining" />
        )}
        <Input label="UAN" {...field('uan')} inputMode="numeric" maxLength={12} inputClassName="font-mono" hint="12-digit Universal Account Number" />
        <Input label="PF Member ID" {...field('pf_member_id')} inputClassName="font-mono uppercase" maxLength={30} placeholder="MHBAN00000640000000125" />
        <Input label="Previous PF Member ID" {...field('previous_pf_member_id')} inputClassName="font-mono uppercase" maxLength={30} />
        <Input label="PF joining date" type="date" {...field('pf_joining_date')} />
        <Input label="Statutory PF wage (₹)" type="number" min={0} {...field('statutory_pf_wage')} hint="Only used when a PF rule's basis is the statutory PF wage" />
        <div className="hidden sm:block" />
        <Input label="PF effective from" type="date" {...field('effective_from')} hint="Blank: from the start of employment" />
        <Input label="PF effective to" type="date" {...field('effective_to')} hint="Blank: open-ended" />
        <Textarea label="Reason for this change" required={!isNew} {...field('reason')} className="sm:col-span-2" placeholder={isNew ? 'Optional for the first record' : 'e.g. UAN received from EPFO'} />
      </form>
    </Modal>
  );
}

/** PF Details for one employee (Employee profile and PF management). Editing needs hr.pf.manage. */
export function EmployeePfCard({ employeeId, compact = false }: { employeeId: string; compact?: boolean }) {
  const { can } = useAuth();
  const pf = useApi(() => getEmployeePf(employeeId), [employeeId]);
  const [editing, setEditing] = useState(false);
  const v = pf.data;
  if (pf.status === 'error') return <ErrorState compact onRetry={pf.reload} message={pf.error} />;
  if (!v) return <div className="space-y-2"><Skeleton className="h-20" /><Skeleton className="h-28" /></div>;
  const d = v.details;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <PfStatusBadge status={v.calculation.status} />
          {d.is_default && <Badge tone="warning">PF details not recorded</Badge>}
        </div>
        {can('hr.pf.manage') && <Button size="sm" variant="secondary" onClick={() => setEditing(true)}><Pencil size={14} /> {d.is_default ? 'Add PF details' : 'Edit PF details'}</Button>}
      </div>
      <dl className={`grid grid-cols-1 gap-x-4 gap-y-3 ${compact ? 'sm:grid-cols-2' : 'sm:grid-cols-3'}`}>
        {([
          ['PF applicable', d.pf_applicable ? 'Yes' : 'No'], ['EPS applicable', d.eps_applicable ? 'Yes' : 'No'],
          ['UAN', d.uan ? <span key="uan" className="font-mono">{d.uan}</span> : <span key="uan" className="text-warning">Missing</span>],
          ['PF Member ID', d.pf_member_id ? <span key="mid" className="font-mono">{d.pf_member_id}</span> : <span key="mid" className="text-warning">Missing</span>],
          ['Previous PF Member ID', d.previous_pf_member_id ? <span key="pmid" className="font-mono">{d.previous_pf_member_id}</span> : '—'],
          ['PF joining date', d.pf_joining_date ? date(d.pf_joining_date) : '—'],
          ['Effective from', d.effective_from ? date(d.effective_from) : '—'], ['Effective to', d.effective_to ? date(d.effective_to) : 'Open-ended'],
          ...(!d.pf_applicable ? [['PF exemption reason', d.exemption_reason || <span key="ex" className="text-danger">Not recorded</span>]] as [string, React.ReactNode][] : []),
        ] as [string, React.ReactNode][]).map(([k, val]) => (
          <div key={k} className="min-w-0"><dt className="text-xs text-text-muted">{k}</dt><dd className="mt-0.5 break-words text-sm text-text">{val}</dd></div>
        ))}
      </dl>
      <PfBreakdown calc={v.calculation} />
      {d.updated_at && <p className="text-xs text-text-muted">Last changed {date(d.updated_at)} by {d.updated_by}</p>}
      {editing && <EmployeePfForm view={v} open={editing} onClose={() => setEditing(false)} onSaved={(saved) => pf.setData(saved)} />}
    </div>
  );
}
