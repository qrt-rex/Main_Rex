import {
  Banknote, BarChart3, Briefcase, CalendarClock, CalendarDays, Contact, FileSpreadsheet,
  FileText, FolderKanban, GraduationCap, Handshake, HandCoins, LayoutDashboard, LineChart, Megaphone,
  PlusCircle, ScrollText, Scale, ShieldCheck, SlidersHorizontal, Target, TrendingUp, Upload, UserPlus,
  Users, UsersRound, Wallet, Workflow,
} from 'lucide-react';
import type { NavItem, NavSection } from '../types';

// Central registry of every CRM entity. Sidebar, dashboard, search and route guards all
// read from here, so adding a module is one entry (plus its permission in the backend's
// rbac_service catalog).
export const sections: NavSection[] = [
  {
    id: 'hr',
    label: 'HR',
    icon: UsersRound,
    description: 'People, time, payroll and engagement',
    items: [
      { id: 'hr-overview', label: 'Overview', path: '/hr', icon: LayoutDashboard, permission: 'hr.dashboard.view', end: true, description: 'Workforce metrics and HR activity' },
      { id: 'hr-employees', label: 'Employees', path: '/hr/employees', icon: Users, permission: 'hr.employees.view', description: 'Employee directory and profiles' },
      { id: 'hr-interns', label: 'Interns', path: '/hr/interns', icon: GraduationCap, permission: 'hr.interns.view', description: 'Interns, trainees and conversions' },
      { id: 'hr-recruitment', label: 'Recruitment', path: '/hr/recruitment', icon: UserPlus, permission: 'hr.recruitment.view', description: 'Candidate pipeline and onboarding' },
      { id: 'hr-attendance', label: 'Attendance', path: '/hr/attendance', icon: CalendarClock, permission: 'hr.attendance.view', description: 'Punch records and shift rules' },
      { id: 'hr-leave', label: 'Leave', path: '/hr/leave', icon: CalendarDays, permission: 'hr.leave.view', description: 'Leave requests, approvals and balances' },
      { id: 'hr-productivity', label: 'Productivity', path: '/hr/productivity', icon: Briefcase, permission: 'hr.productivity.view', description: 'Client tasks, timesheets and blockers' },
      { id: 'hr-performance', label: 'Performance', path: '/hr/performance', icon: LineChart, permission: 'hr.performance.view', description: 'Individual and company scorecards' },
      { id: 'hr-payroll', label: 'Payroll', path: '/hr/payroll', icon: Banknote, permission: 'hr.payroll.view', description: 'Monthly payroll runs and approvals' },
      { id: 'hr-payslips', label: 'Payslips', path: '/hr/payslips', icon: FileText, permission: 'hr.payroll.view', description: 'Salary register and payslip generation' },
      { id: 'hr-advances', label: 'Advances & loans', path: '/hr/advances', icon: HandCoins, permission: 'hr.advances.view', description: 'Advances, loans, bonuses and overtime' },
      { id: 'hr-broadcasts', label: 'Broadcasts', path: '/hr/broadcasts', icon: Megaphone, permission: 'hr.broadcasts.view', description: 'Company announcements and read receipts' },
      { id: 'hr-import', label: 'Data import', path: '/hr/import', icon: Upload, permission: 'hr.import.manage', description: 'Smart spreadsheet imports' },
      { id: 'hr-payroll-settings', label: 'Payroll settings', path: '/hr/payroll-settings', icon: SlidersHorizontal, permission: 'hr.settings.manage', description: 'Payroll rules, email delivery and templates' },
    ],
  },
  {
    id: 'sales',
    label: 'Sales',
    icon: TrendingUp,
    description: 'Customers, pipeline and contacts',
    items: [
      { id: 'sales-hub', label: 'Sales workspace', path: '/sales/hub', icon: Target, permission: 'sales.hub.manage', description: 'Leads, schemes, material, team progress and attendance' },
      { id: 'sales-customers', label: 'Customers', path: '/sales/customers', icon: Users, permission: 'sales.customers.view', placeholder: true, description: 'Customer accounts' },
      { id: 'sales-leads', label: 'Leads', path: '/sales/leads', icon: Target, permission: 'sales.leads.view', placeholder: true, description: 'Lead capture and qualification' },
      { id: 'sales-deals', label: 'Deals', path: '/sales/deals', icon: Handshake, permission: 'sales.deals.view', placeholder: true, description: 'Sales pipeline' },
      { id: 'sales-contacts', label: 'Contacts', path: '/sales/contacts', icon: Contact, permission: 'sales.contacts.view', placeholder: true, description: 'Contact directory' },
    ],
  },
  {
    id: 'legal',
    label: 'Legal',
    icon: Scale,
    description: 'Contracts, compliance and legal matters',
    items: [
      { id: 'legal-matters', label: 'Contracts & cases', path: '/legal', icon: Scale, permission: 'legal.view', description: 'Legal document review, compliance and contracts' },
    ],
  },
  {
    id: 'billing',
    label: 'Bill & Invoice',
    icon: FileSpreadsheet,
    description: 'Tax invoices, proforma, quotations, GST and collections',
    items: [
      { id: 'billing-invoices', label: 'Invoices', path: '/billing/invoices', icon: FileText, permission: 'billing.view', description: 'Search, filter and manage tax invoices' },
      { id: 'billing-create', label: 'Create Invoice', path: '/billing/create', icon: PlusCircle, permission: 'billing.create', description: 'GST compliant tax invoice generator' },
      { id: 'billing-quotations', label: 'Quotations', path: '/billing/quotations', icon: ScrollText, permission: 'billing.view', description: 'Draft, send and convert quotations' },
      { id: 'billing-clients', label: 'Billing Clients', path: '/billing/clients', icon: Users, permission: 'billing.manage', description: 'Customer CRM directory and GSTIN lookup' },
      { id: 'billing-payments', label: 'Payments', path: '/billing/payments', icon: Banknote, permission: 'billing.manage', description: 'Collections and receivables tracker' },
      { id: 'billing-reports', label: 'Billing Reports', path: '/billing/reports', icon: BarChart3, permission: 'billing.view', description: 'Financial, GSTR-1 and aging reports' },
    ],
  },
  {
    id: 'operations',
    label: 'Operations',
    icon: FolderKanban,
    description: 'Finance, projects and reporting',
    items: [
      { id: 'ops-finance', label: 'Finance', path: '/finance', icon: Wallet, permission: 'finance.view', placeholder: true, description: 'Invoicing and revenue' },
      { id: 'ops-projects', label: 'Projects', path: '/projects', icon: FolderKanban, permission: 'projects.view', placeholder: true, description: 'Client project delivery' },
      { id: 'ops-reports', label: 'Reports', path: '/reports', icon: BarChart3, permission: 'reports.view', placeholder: true, description: 'Cross-module analytics' },
    ],
  },
  {
    id: 'admin',
    label: 'Administration',
    icon: ShieldCheck,
    description: 'Users, access control and audit',
    items: [
      { id: 'admin-users', label: 'Users', path: '/admin/users', icon: Users, permission: 'users.manage', description: 'Accounts and roles' },
      { id: 'admin-permissions', label: 'Roles & permissions', path: '/admin/permissions', icon: ShieldCheck, permission: 'permissions.manage', description: 'What each role can access' },
      { id: 'admin-activity', label: 'Activity log', path: '/admin/activity', icon: ScrollText, permission: 'audit.view', description: 'Sign-ins and changes across the CRM' },
      { id: 'admin-automations', label: 'Automations', path: '/admin/automations', icon: Workflow, permission: 'automations.manage', description: 'Scheduled payroll, reminders and follow-up emails' },
    ],
  },
];

const byId = new Map(sections.flatMap((s) => s.items.map((i) => [i.id, i] as const)));

export const navItem = (id: string): NavItem => {
  const item = byId.get(id);
  if (!item) throw new Error(`Unknown nav item: ${id}`);
  return item;
};

/** Sections as a given user sees them: unauthorized items removed, empty sections dropped. */
export function visibleSections(can: (permission: string) => boolean): NavSection[] {
  return sections
    .map((s) => ({ ...s, items: s.items.filter((i) => can(i.permission)) }))
    .filter((s) => s.items.length > 0);
}
