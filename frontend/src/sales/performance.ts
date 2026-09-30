// Sales performance: collection scorecard / leaderboard, my performance, incentive rules and DSC.
import { api, saveBlob } from '../lib/api';

export type Period = 'day' | 'week' | 'month';

export interface Incentive {
  eligible: boolean;
  target_met: boolean;
  eligibility: { status: 'Eligible' | 'Not eligible'; required: number; current: number; remaining: number };
  slab_percent: number | null;
  daily_incentive: number;
  weekly_incentive: number;
  monthly_incentive: number;
  incentive: number;
  gate_amount: number;
  target_amount: number;
  target_achievement: number;
  note: string;
}
export interface IncentiveDetail extends Incentive {
  monthly_salary: number;
  gross_collection: number;
  dsc_deduction: number;
  net_collection: number;
  days: { date: string; collection: number; incentive: number }[];
  weeks: { from: string; to: string; collection: number; incentive: number }[];
}
export interface Totals { gross_collection: number; dsc_deduction: number; net_collection: number; payments: number }
export interface ScoreRow extends Totals {
  rank: number;
  email: string;
  name: string;
  employee_id: string;
  employee_code: string;
  department: string;
  /** null for other people's monthly target when you can't see salaries. */
  target: number | null;
  achievement: number | null;
  /** The month's incentive; null for other people when you can't see salaries. */
  incentive: Incentive | null;
  /** HR only: where this person's payroll for the month stands. */
  payroll?: { id: string; status: string; locked: boolean; incentive: number } | null;
}
export interface Scorecard {
  period: Period; from: string; to: string; month: string; rows: ScoreRow[]; departments: string[]; can_export: boolean;
}
export interface MyPerformance {
  is_sales: boolean;
  name?: string;
  month?: string;
  today?: Totals;
  week?: Totals;
  month_totals?: Totals;
  incentive?: IncentiveDetail;
  rules?: Pick<IncentiveConfig, 'daily_threshold' | 'daily_percent' | 'weekly_threshold' | 'weekly_percent' | 'eligibility_multiplier' | 'target_multiplier' | 'dsc_amount'>;
}
export interface Slab { min: number; max: number | null; percent: number; active: boolean }
export interface IncentiveConfig {
  dsc_amount: number;
  daily_threshold: number;
  daily_percent: number;
  weekly_threshold: number;
  weekly_percent: number;
  eligibility_multiplier: number;
  target_multiplier: number;
  slabs: Slab[];
  version: number;
  updated_by?: string;
  updated_at?: string;
}
export type IncentiveRules = Omit<IncentiveConfig, 'dsc_amount' | 'version' | 'updated_by' | 'updated_at'>;

export const getScorecard = (period: Period, date: string, department = '') =>
  api.get<Scorecard>('/api/sales-performance/scorecard', { period, date, department });
export const getMyPerformance = (date?: string) => api.get<MyPerformance>('/api/sales-performance/me', { date });
export const getIncentiveConfig = () => api.get<IncentiveConfig>('/api/sales-performance/config');
export const saveIncentiveRules = (rules: IncentiveRules) => api.put<IncentiveConfig>('/api/sales-performance/config', rules);
export const saveDscAmount = (dsc_amount: number) => api.put<IncentiveConfig>('/api/sales-performance/config/dsc', { dsc_amount });
export async function downloadScorecard(period: Period, date: string, department: string, format: 'xlsx' | 'pdf') {
  const blob = await api.blob('/api/sales-performance/export', { period, date, department, format });
  saveBlob(blob, `sales-scorecard-${period}-${date}.${format}`);
}
