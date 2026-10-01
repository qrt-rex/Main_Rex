import { currentMonth, currentYear, money } from '../../lib/format';

export const pfMoney = (v: unknown) => money(v, true);
export const pct = (v: unknown) => (v === null || v === undefined || v === '' ? '—' : `${Number(v)}%`);

export interface PfFilterState { month: string; year: number; department: string; branch: string; employee_id: string; pf_status: string; pf_applicable: string; eps_applicable: string }

export const defaultFilters = (): PfFilterState => ({
  month: currentMonth(), year: currentYear(), department: 'all', branch: 'all', employee_id: '', pf_status: 'all', pf_applicable: 'all', eps_applicable: 'all',
});

/** Query params for the PF endpoints ("all" means no filter). */
export function filterParams(f: PfFilterState) {
  const v = (x: string) => (x && x !== 'all' ? x : undefined);
  return {
    month: f.month, year: f.year, department: v(f.department), branch: v(f.branch), employee_id: v(f.employee_id),
    pf_status: v(f.pf_status), pf_applicable: v(f.pf_applicable), eps_applicable: v(f.eps_applicable),
  };
}
