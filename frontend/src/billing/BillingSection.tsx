import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { FileSpreadsheet, FileText, PlusCircle, ScrollText, Users, Banknote, BarChart3, Inbox, FolderOpen } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';

const TABS = [
  { path: '/billing/invoices', label: 'Invoices', icon: FileText, perm: 'billing.view' },
  { path: '/billing/create', label: 'Create Invoice', icon: PlusCircle, perm: 'billing.create' },
  { path: '/billing/requests', label: 'Requests', icon: Inbox, perm: 'billing.view' },
  { path: '/billing/quotations', label: 'Quotations', icon: ScrollText, perm: 'billing.view' },
  { path: '/billing/clients', label: 'Clients', icon: Users, perm: 'billing.manage' },
  { path: '/billing/payments', label: 'Payments', icon: Banknote, perm: 'billing.manage' },
  { path: '/billing/reports', label: 'GSTR & Reports', icon: BarChart3, perm: 'billing.gstr' }, // Super Admin, Admin / Accounting, Legal
  { path: '/billing/documents', label: 'Documents', icon: FolderOpen, perm: 'billing.view' },
];

export function BillingSection() {
  const { can } = useAuth();
  const location = useLocation();
  const visibleTabs = TABS.filter((t) => can(t.perm));

  return (
    <div className="space-y-6">
      {/* Module Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border pb-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-600/10 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-400">
              <FileSpreadsheet size={20} />
            </span>
            <div>
              <h1 className="text-xl font-bold tracking-tight text-text">Rexera Billing & Invoicing</h1>
              <p className="text-xs text-text-muted">GST compliant Tax Invoices, Quotations, Multi-branch numbering & Collections</p>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {can('billing.create') && location.pathname !== '/billing/create' && (
            <NavLink
              to="/billing/create"
              className="inline-flex h-9 items-center gap-2 rounded-md bg-emerald-600 px-3.5 text-sm font-medium text-white shadow-sm hover:bg-emerald-700 transition-colors"
            >
              <PlusCircle size={15} /> Create Invoice
            </NavLink>
          )}
        </div>
      </div>

      {/* Subnavigation Tabs */}
      <div className="flex flex-wrap items-center gap-1.5 border-b border-border pb-2 overflow-x-auto">
        {visibleTabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = location.pathname === tab.path || (tab.path === '/billing/invoices' && location.pathname === '/billing');
          return (
            <NavLink
              key={tab.path}
              to={tab.path}
              className={`inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${
                isActive
                  ? 'bg-primary text-on-primary shadow-sm font-semibold'
                  : 'text-text-muted hover:bg-surface-secondary hover:text-text'
              }`}
            >
              <Icon size={14} />
              {tab.label}
            </NavLink>
          );
        })}
      </div>

      {/* Tab Content */}
      <div className="min-w-0 flex-1">
        <Outlet />
      </div>
    </div>
  );
}
