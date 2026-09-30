import { useState, type FormEvent } from 'react';
import { Lock, Plus, Save, Trash2 } from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';
import { useApi } from '../../lib/useApi';
import { dateTime, money } from '../../lib/format';
import { Button } from '../../components/common/Button';
import { Card, CardHeader } from '../../components/common/Card';
import { ErrorState } from '../../components/common/ErrorState';
import { Checkbox, Input } from '../../components/common/Input';
import { PageSkeleton } from '../../components/common/Skeleton';
import { useToast } from '../../components/common/ToastContext';
import { PageHeader } from '../../components/layout/PageHeader';
import { getIncentiveConfig, saveDscAmount, saveIncentiveRules, type IncentiveConfig, type Slab } from '../../sales/performance';

type NumKey = 'daily_threshold' | 'daily_percent' | 'weekly_threshold' | 'weekly_percent' | 'eligibility_multiplier' | 'target_multiplier';
const FIELDS: { key: NumKey; label: string; hint: string }[][] = [
  [{ key: 'daily_threshold', label: 'Daily collection threshold (₹)', hint: 'A day at or above this earns the daily %' },
   { key: 'daily_percent', label: 'Daily incentive %', hint: 'Of that day\'s net collection' }],
  [{ key: 'weekly_threshold', label: 'Weekly collection threshold (₹)', hint: 'A Mon–Sun week at or above this earns the weekly %' },
   { key: 'weekly_percent', label: 'Weekly incentive %', hint: 'Of the whole week, on top of daily' }],
  [{ key: 'eligibility_multiplier', label: 'Monthly eligibility (× salary)', hint: 'Below this nothing is paid' },
   { key: 'target_multiplier', label: 'Monthly target (× salary)', hint: 'At or above this the slab % is paid on top' }],
];

/** HR edits the incentive rules; only a Super Admin edits the DSC amount (it is shown read-only to everyone else). */
export function IncentiveSettings() {
  const cfg = useApi(getIncentiveConfig, []);
  if (cfg.status === 'error') return <ErrorState message={cfg.error} onRetry={cfg.reload} />;
  if (!cfg.data) return <PageSkeleton />;
  // Keyed by version: every save returns the next version, so the form restarts from what was stored.
  return <Editor key={cfg.data.version} initial={cfg.data} onSaved={cfg.setData} />;
}

function Editor({ initial, onSaved }: { initial: IncentiveConfig; onSaved: (c: IncentiveConfig) => void }) {
  const { can } = useAuth();
  const { showToast } = useToast();
  const [form, setForm] = useState(initial);
  const [dsc, setDsc] = useState(String(initial.dsc_amount));
  const [saving, setSaving] = useState('');
  const canRules = can('sales.incentives.configure');
  const canDsc = can('sales.dsc.manage');

  const setSlab = (i: number, patch: Partial<Slab>) => setForm({ ...form, slabs: form.slabs.map((s, j) => (j === i ? { ...s, ...patch } : s)) });
  const num = (v: string) => (v.trim() === '' ? NaN : Number(v));

  const run = async (what: string, fn: () => Promise<IncentiveConfig>, message: string) => {
    setSaving(what);
    try {
      onSaved(await fn());
      showToast(message, 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not save', 'error');
    } finally {
      setSaving('');
    }
  };

  const saveRules = (e: FormEvent) => {
    e.preventDefault();
    const { slabs, daily_threshold, daily_percent, weekly_threshold, weekly_percent, eligibility_multiplier, target_multiplier } = form;
    run('rules', () => saveIncentiveRules({ slabs, daily_threshold, daily_percent, weekly_threshold, weekly_percent, eligibility_multiplier, target_multiplier }),
      'Incentive rules saved. They apply to calculations from now on; finalized payroll keeps its incentive.');
  };

  return (
    <div className="space-y-5">
      <PageHeader title="Sales incentive settings"
        description={`Rules version ${form.version}${form.updated_at ? ` · last changed ${dateTime(form.updated_at)} by ${form.updated_by}` : ' · defaults'}`} />

      <Card>
        <CardHeader title="DSC deduction" description="Taken off a client payment when “DSC deducted” is ticked while recording it. Each payment keeps the amount it was recorded with."
          actions={!canDsc ? <span className="inline-flex items-center gap-1 text-xs text-text-muted"><Lock size={13} /> Super Admin only</span> : undefined} />
        <form className="flex flex-wrap items-end gap-3 p-4" onSubmit={(e) => { e.preventDefault(); run('dsc', () => saveDscAmount(num(dsc)), `DSC deduction set to ${money(num(dsc))}`); }}>
          <Input label="DSC deduction amount (₹)" type="number" min={0} step="0.01" value={dsc} onChange={(e) => setDsc(e.target.value)} disabled={!canDsc} className="w-56" />
          {canDsc && <Button type="submit" loading={saving === 'dsc'} disabled={!(num(dsc) >= 0)}><Save size={15} /> Save DSC</Button>}
        </form>
      </Card>

      <form onSubmit={saveRules} className="space-y-5">
        <Card>
          <CardHeader title="Incentive rules" description="Worked out on net collection (after DSC). Daily and weekly need the monthly eligibility; the monthly slab also needs the monthly target. All three add up."
            actions={!canRules ? <span className="inline-flex items-center gap-1 text-xs text-text-muted"><Lock size={13} /> HR and above</span> : undefined} />
          <div className="grid gap-4 p-4 sm:grid-cols-2">
            {FIELDS.flat().map((f) => (
              <Input key={f.key} label={f.label} hint={f.hint} type="number" min={0} step="any" required disabled={!canRules}
                value={Number.isNaN(form[f.key]) ? '' : form[f.key]} onChange={(e) => setForm({ ...form, [f.key]: num(e.target.value) })} />
            ))}
          </div>
        </Card>

        <Card>
          <CardHeader title="Monthly incentive slabs" description="The % of the whole month's net collection. A slab covers from its lower limit up to (not including) its upper limit; leave the upper limit empty for “and above”." />
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-surface-secondary text-left text-xs text-text-muted">
                <tr><th className="px-4 py-2 font-medium">From (₹)</th><th className="px-4 py-2 font-medium">Up to (₹)</th><th className="px-4 py-2 font-medium">Incentive %</th><th className="px-4 py-2 font-medium">Active</th><th className="px-4 py-2" /></tr>
              </thead>
              <tbody className="divide-y divide-border">
                {form.slabs.map((s, i) => (
                  <tr key={i}>
                    <td className="px-4 py-2"><Input aria-label={`Slab ${i + 1} from`} type="number" min={0} value={Number.isNaN(s.min) ? '' : s.min} disabled={!canRules} onChange={(e) => setSlab(i, { min: num(e.target.value) })} /></td>
                    <td className="px-4 py-2"><Input aria-label={`Slab ${i + 1} up to`} type="number" min={0} placeholder="and above" value={s.max ?? ''} disabled={!canRules} onChange={(e) => setSlab(i, { max: e.target.value === '' ? null : num(e.target.value) })} /></td>
                    <td className="px-4 py-2"><Input aria-label={`Slab ${i + 1} percent`} type="number" min={0} max={100} step="any" value={Number.isNaN(s.percent) ? '' : s.percent} disabled={!canRules} onChange={(e) => setSlab(i, { percent: num(e.target.value) })} /></td>
                    <td className="px-4 py-2"><Checkbox label="" aria-label={`Slab ${i + 1} active`} checked={s.active} disabled={!canRules} onChange={(e) => setSlab(i, { active: e.target.checked })} /></td>
                    <td className="px-4 py-2 text-right">{canRules && form.slabs.length > 1 && (
                      <Button variant="danger-ghost" size="icon-sm" aria-label={`Remove slab ${i + 1}`} onClick={() => setForm({ ...form, slabs: form.slabs.filter((_, j) => j !== i) })}><Trash2 size={14} /></Button>
                    )}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {canRules && (
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border p-4">
              <Button variant="secondary" size="sm" onClick={() => {
                const last = form.slabs[form.slabs.length - 1];
                setForm({ ...form, slabs: [...form.slabs, { min: last?.max ?? 0, max: null, percent: 0, active: true }] });
              }}><Plus size={14} /> Add slab</Button>
              <Button type="submit" loading={saving === 'rules'}><Save size={15} /> Save incentive rules</Button>
            </div>
          )}
        </Card>
      </form>
    </div>
  );
}
