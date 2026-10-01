import { currentYear, MONTHS } from '../../lib/format';
import type { PfFilterState } from './format';
import { Select } from '../../components/common/Input';
import { BRANCHES, DEPARTMENTS } from '../api';
import { EmployeeOptionList } from '../HrSection';

const YEARS = Array.from({ length: 6 }, (_, i) => currentYear() - 4 + i);

/** Month / year and the PF filters (each one optional per screen). */
export function PfFilterBar({ value, onChange, show }: {
  value: PfFilterState;
  onChange: (next: PfFilterState) => void;
  show: Partial<Record<keyof PfFilterState, boolean>>;
}) {
  const set = (k: keyof PfFilterState) => (e: React.ChangeEvent<HTMLSelectElement>) =>
    onChange({ ...value, [k]: k === 'year' ? Number(e.target.value) : e.target.value });
  return (
    <>
      {show.month && <Select aria-label="Month" value={value.month} onChange={set('month')} selectClassName="w-32">{MONTHS.map((m) => <option key={m}>{m}</option>)}</Select>}
      {show.year && <Select aria-label="Year" value={value.year} onChange={set('year')} selectClassName="w-24">{YEARS.map((y) => <option key={y}>{y}</option>)}</Select>}
      {show.department && (
        <Select aria-label="Department" value={value.department} onChange={set('department')} selectClassName="w-36">
          <option value="all">All departments</option>{DEPARTMENTS.map((d) => <option key={d}>{d}</option>)}
        </Select>
      )}
      {show.branch && (
        <Select aria-label="Branch" value={value.branch} onChange={set('branch')} selectClassName="w-32">
          <option value="all">All branches</option>{BRANCHES.map((b) => <option key={b}>{b}</option>)}
        </Select>
      )}
      {show.employee_id && (
        <Select aria-label="Employee" value={value.employee_id} onChange={set('employee_id')} selectClassName="w-52">
          <option value="">All employees</option><EmployeeOptionList />
        </Select>
      )}
      {show.pf_status && (
        <Select aria-label="PF status" value={value.pf_status} onChange={set('pf_status')} selectClassName="w-40">
          <option value="all">Any PF status</option>
          <option value="CALCULATED">PF applicable</option><option value="EXEMPT">Exempt</option>
          <option value="NOT_APPLICABLE">Not applicable</option><option value="ERROR">Needs attention</option>
        </Select>
      )}
      {show.pf_applicable && (
        <Select aria-label="PF applicable" value={value.pf_applicable} onChange={set('pf_applicable')} selectClassName="w-40">
          <option value="all">PF applicable: any</option><option value="yes">PF applicable: yes</option><option value="no">PF applicable: no</option>
        </Select>
      )}
      {show.eps_applicable && (
        <Select aria-label="EPS applicable" value={value.eps_applicable} onChange={set('eps_applicable')} selectClassName="w-40">
          <option value="all">EPS: any</option><option value="yes">EPS: yes</option><option value="no">EPS: no</option>
        </Select>
      )}
    </>
  );
}
