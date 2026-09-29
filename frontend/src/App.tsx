import { lazy, Suspense, type ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { ThemeProvider } from './theme/ThemeContext';
import { ToastProvider } from './components/common/ToastContext';
import { ConfirmProvider } from './components/common/ConfirmDialog';
import { AuthProvider } from './auth/AuthContext';
import { RequireAuth, RedirectIfAuthenticated } from './auth/RequireAuth';
import { LoginPage } from './auth/LoginPage';
import { AppLayout } from './components/layout/AppLayout';
import { PageSkeleton } from './components/common/Skeleton';
import { RequirePermission } from './permissions/RequirePermission';
import { navItem, sections } from './modules/registry';
import { DashboardShell } from './dashboards/DashboardShell';
import { DashboardHome, RoleDashboard } from './dashboards/RoleDashboard';
import { ModulePage } from './pages/ModulePage';
import { Notifications } from './pages/Notifications';
import { Settings } from './pages/Settings';
import { NotFound } from './pages/NotFound';
import { HrSection } from './hr/HrSection';

const Users = lazy(() => import('./pages/Users').then((m) => ({ default: m.Users })));
const Permissions = lazy(() => import('./pages/Permissions').then((m) => ({ default: m.Permissions })));
const AuditLogs = lazy(() => import('./pages/AuditLogs').then((m) => ({ default: m.AuditLogs })));
const Automations = lazy(() => import('./pages/Automations').then((m) => ({ default: m.Automations })));
const SalesHub = lazy(() => import('./sales/SalesHub').then((m) => ({ default: m.SalesHub })));
const HrDashboard = lazy(() => import('./hr/pages/HrDashboard').then((m) => ({ default: m.HrDashboard })));
const HrEmployees = lazy(() => import('./hr/pages/HrEmployees').then((m) => ({ default: m.HrEmployees })));
const PersonForm = lazy(() => import('./hr/pages/PersonForm').then((m) => ({ default: m.PersonForm })));
const Interns = lazy(() => import('./hr/pages/Interns').then((m) => ({ default: m.Interns })));
const Recruitment = lazy(() => import('./hr/pages/Recruitment').then((m) => ({ default: m.Recruitment })));
const HrAttendance = lazy(() => import('./hr/pages/HrAttendance').then((m) => ({ default: m.HrAttendance })));
const HrLeaves = lazy(() => import('./hr/pages/HrLeaves').then((m) => ({ default: m.HrLeaves })));
const Productivity = lazy(() => import('./hr/pages/Productivity').then((m) => ({ default: m.Productivity })));
const Performance = lazy(() => import('./hr/pages/Performance').then((m) => ({ default: m.Performance })));
const Payroll = lazy(() => import('./hr/pages/Payroll').then((m) => ({ default: m.Payroll })));
const Payslips = lazy(() => import('./hr/pages/Payslips').then((m) => ({ default: m.Payslips })));
const Advances = lazy(() => import('./hr/pages/Advances').then((m) => ({ default: m.Advances })));
const Broadcasts = lazy(() => import('./hr/pages/Broadcasts').then((m) => ({ default: m.Broadcasts })));
const DataImport = lazy(() => import('./hr/pages/DataImport').then((m) => ({ default: m.DataImport })));
const PayrollSettings = lazy(() => import('./hr/pages/PayrollSettings').then((m) => ({ default: m.PayrollSettings })));

const BillingSection = lazy(() => import('./billing/BillingSection').then((m) => ({ default: m.BillingSection })));
const InvoicesList = lazy(() => import('./billing/InvoicesList').then((m) => ({ default: m.InvoicesList })));
const InvoiceCreate = lazy(() => import('./billing/InvoiceCreate').then((m) => ({ default: m.InvoiceCreate })));
const QuotationsList = lazy(() => import('./billing/QuotationsList').then((m) => ({ default: m.QuotationsList })));
const BillingClients = lazy(() => import('./billing/BillingClients').then((m) => ({ default: m.BillingClients })));
const BillingPayments = lazy(() => import('./billing/BillingPayments').then((m) => ({ default: m.BillingPayments })));
const BillingReports = lazy(() => import('./billing/BillingReports').then((m) => ({ default: m.BillingReports })));
const BillingRequests = lazy(() => import('./billing/BillingRequests').then((m) => ({ default: m.BillingRequests })));
const BillingDocuments = lazy(() => import('./billing/BillingDocuments').then((m) => ({ default: m.BillingDocuments })));
const CandidateApply = lazy(() => import('./pages/public/CandidateApply').then((m) => ({ default: m.CandidateApply })));
const JoiningPortal = lazy(() => import('./pages/public/JoiningPortal').then((m) => ({ default: m.JoiningPortal })));
const LegalDashboard = lazy(() => import('./dashboards/LegalDashboard').then((m) => ({ default: m.LegalDashboard })));
const IvrApp = lazy(() => import('./ivr/IvrApp').then((m) => ({ default: m.IvrApp })));
const DialerPage = lazy(() => import('./sales/DialerPage').then((m) => ({ default: m.DialerPage })));

/** Full-screen pages that open in their own tab (no CRM shell). */
const standalone = (permission: string, element: ReactNode) => (
  <RequirePermission permission={permission}>
    <Suspense fallback={<PageSkeleton />}>{element}</Suspense>
  </RequirePermission>
);

/** Route element guarded by the same permission the registry uses for navigation. */
const guard = (id: string, element: ReactNode) => (
  <RequirePermission permission={navItem(id).permission}>
    <Suspense fallback={<PageSkeleton />}>{element}</Suspense>
  </RequirePermission>
);

const relative = (id: string, base: string) => navItem(id).path.slice(base.length + 1);

const placeholderRoutes = sections.flatMap((s) => s.items).filter((i) => i.placeholder);

export default function App() {
  return (
    <ThemeProvider>
      <ToastProvider>
        <ConfirmProvider>
          <AuthProvider>
            <BrowserRouter>
              <Routes>
                <Route path="/login" element={<RedirectIfAuthenticated><LoginPage /></RedirectIfAuthenticated>} />
                <Route path="/reset-password" element={<RedirectIfAuthenticated><LoginPage /></RedirectIfAuthenticated>} />
                {/* Public pages (no sign-in): candidate application and new-joiner onboarding. */}
                <Route path="/apply" element={<Suspense fallback={<PageSkeleton />}><CandidateApply /></Suspense>} />
                <Route path="/joining" element={<Suspense fallback={<PageSkeleton />}><JoiningPortal /></Suspense>} />
                {/* Addresses of the removed HTML portal, still in old emails and bookmarks. */}
                <Route path="/index.html" element={<Navigate to="/apply" replace />} />
                <Route path="/joining-login.html" element={<Navigate to="/joining" replace />} />
                <Route path="/joining-form.html" element={<Navigate to="/joining" replace />} />
                <Route path="/admin-login.html" element={<Navigate to="/login" replace />} />

                <Route element={<RequireAuth />}>
                  {/* IVR console and the sales dialer: own tab, IVR sign-in first */}
                  <Route path="/ivr" element={standalone('sales.hub.view', <IvrApp />)} />
                  <Route path="/dialer" element={standalone('sales.hub.view', <DialerPage />)} />

                  {/* Role dashboards: the control centre for each role, no module sidebar. */}
                  <Route element={<DashboardShell />}>
                    <Route path="/dashboard" element={<DashboardHome />} />
                    <Route path="/dashboard/:slug" element={<RoleDashboard />} />
                  </Route>

                  <Route element={<AppLayout />}>
                    <Route index element={<Navigate to="/dashboard" replace />} />
                    <Route path="/notifications" element={<Notifications />} />
                    <Route path="/settings" element={<Settings />} />

                    <Route path="/hr" element={<HrSection />}>
                      <Route index element={guard('hr-overview', <HrDashboard />)} />
                      <Route path={relative('hr-employees', '/hr')} element={guard('hr-employees', <HrEmployees />)} />
                      <Route path="employees/new" element={<RequirePermission permission={['hr.employees.create']}><Suspense fallback={<PageSkeleton />}><PersonForm kind="employee" /></Suspense></RequirePermission>} />
                      <Route path="employees/:id/edit" element={<RequirePermission permission={['hr.employees.edit']}><Suspense fallback={<PageSkeleton />}><PersonForm kind="employee" /></Suspense></RequirePermission>} />
                      <Route path="interns/new" element={<RequirePermission permission={['hr.interns.create']}><Suspense fallback={<PageSkeleton />}><PersonForm kind="intern" /></Suspense></RequirePermission>} />
                      <Route path={relative('hr-interns', '/hr')} element={guard('hr-interns', <Interns />)} />
                      <Route path={relative('hr-recruitment', '/hr')} element={guard('hr-recruitment', <Recruitment />)} />
                      <Route path={relative('hr-attendance', '/hr')} element={guard('hr-attendance', <HrAttendance />)} />
                      <Route path={relative('hr-leave', '/hr')} element={guard('hr-leave', <HrLeaves />)} />
                      <Route path={relative('hr-productivity', '/hr')} element={guard('hr-productivity', <Productivity />)} />
                      <Route path={relative('hr-performance', '/hr')} element={guard('hr-performance', <Performance />)} />
                      <Route path={relative('hr-payroll', '/hr')} element={guard('hr-payroll', <Payroll />)} />
                      <Route path={relative('hr-payslips', '/hr')} element={guard('hr-payslips', <Payslips />)} />
                      <Route path={relative('hr-advances', '/hr')} element={guard('hr-advances', <Advances />)} />
                      <Route path={relative('hr-broadcasts', '/hr')} element={guard('hr-broadcasts', <Broadcasts />)} />
                      <Route path={relative('hr-import', '/hr')} element={guard('hr-import', <DataImport />)} />
                      <Route path={relative('hr-payroll-settings', '/hr')} element={guard('hr-payroll-settings', <PayrollSettings />)} />
                      <Route path="*" element={<NotFound />} />
                    </Route>

                    {/* Billing & Invoices */}
                    <Route path="/billing" element={<Suspense fallback={<PageSkeleton />}><BillingSection /></Suspense>}>
                      <Route index element={guard('billing-invoices', <InvoicesList />)} />
                      <Route path="invoices" element={guard('billing-invoices', <InvoicesList />)} />
                      <Route path="create" element={guard('billing-create', <InvoiceCreate />)} />
                      <Route path="quotations" element={guard('billing-quotations', <QuotationsList />)} />
                      <Route path="clients" element={guard('billing-clients', <BillingClients />)} />
                      <Route path="payments" element={guard('billing-payments', <BillingPayments />)} />
                      <Route path="reports" element={guard('billing-reports', <BillingReports />)} />
                      <Route path="requests" element={guard('billing-requests', <BillingRequests />)} />
                      <Route path="documents" element={guard('billing-documents', <BillingDocuments />)} />
                      <Route path="*" element={<NotFound />} />
                    </Route>

                    {/* Legal Module */}
                    <Route path="/legal" element={guard('legal-matters', <LegalDashboard />)} />

                    {placeholderRoutes.map((item) => (
                      <Route key={item.id} path={item.path} element={guard(item.id, <ModulePage id={item.id} />)} />
                    ))}

                    <Route path="/admin/users" element={guard('admin-users', <Users />)} />
                    <Route path="/admin/permissions" element={guard('admin-permissions', <Permissions />)} />
                    <Route path="/admin/activity" element={guard('admin-activity', <AuditLogs />)} />
                    <Route path="/admin/automations" element={guard('admin-automations', <Automations />)} />
                    <Route path="/sales/hub" element={guard('sales-hub', <SalesHub />)} />
                    <Route path="*" element={<NotFound />} />
                  </Route>
                </Route>
              </Routes>
            </BrowserRouter>
          </AuthProvider>
        </ConfirmProvider>
      </ToastProvider>
    </ThemeProvider>
  );
}
