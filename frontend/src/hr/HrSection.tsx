import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { Outlet } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { useApi } from '../lib/useApi';
import { listEmployees, type Employee } from './api';

interface EmployeeOptions {
  employees: Employee[];
  loading: boolean;
  /** False when the user lacks hr.employees.view, so pickers can explain why they're empty. */
  available: boolean;
  reload: () => void;
}

const EmployeeOptionsContext = createContext<EmployeeOptions | null>(null);

/** Layout route for /hr/*: shares one employee list for every picker on HR pages. */
export function HrSection() {
  const { can } = useAuth();
  const available = can('hr.employees.view');
  const list = useApi(() => listEmployees({ limit: 2000 }), [], available);

  const value = useMemo<EmployeeOptions>(() => ({
    employees: list.data?.employees ?? [],
    loading: list.loading,
    available,
    reload: () => void list.reload(),
  }), [list.data, list.loading, available, list.reload]);

  return (
    <EmployeeOptionsContext.Provider value={value}>
      <Outlet />
    </EmployeeOptionsContext.Provider>
  );
}

export function useEmployeeOptions() {
  const ctx = useContext(EmployeeOptionsContext);
  if (!ctx) throw new Error('useEmployeeOptions must be used under /hr');
  return ctx;
}

/** Employee <select> options; `valueKey` matches what each HR endpoint expects. */
export function EmployeeOptionList({ valueKey = 'id' }: { valueKey?: 'id' | 'employee_code' }): ReactNode {
  const { employees } = useEmployeeOptions();
  return employees.map((e) => (
    <option key={e.id} value={e[valueKey]}>{e.full_name} · {e.employee_code}</option>
  ));
}
