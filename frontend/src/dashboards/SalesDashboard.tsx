import { useState } from 'react';
import { CalendarDays, FilePlus2, ListChecks, Megaphone, PhoneCall, PiggyBank, Plus, Target, Wallet } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { BigButtons, ModuleEntities, SectionTitle, TaskPanel, type BigButtonItem } from './components';
import { DashboardIntro } from './DashboardShell';
import { SalesToday } from '../sales/SalesToday';
import { QuickLeadModal } from '../sales/SalesWidgets';
import { openDialer } from '../sales/openDialer';
import { ClientDocumentFormModal, MyDocumentForms } from './ClientDocumentForm';
import { PayslipPreview } from '../hr/components';
import type { WorkspaceSummary } from './api';

/** Sales home: big buttons for the day's jobs, the leads to call, material to share, and your own work. */
export function SalesDashboard({ summary }: { summary: WorkspaceSummary }) {
  const { can } = useAuth();
  const { updates, me } = summary;
  const [docFormOpen, setDocFormOpen] = useState(false);
  const [quickLeadOpen, setQuickLeadOpen] = useState(false);
  const [slipOpen, setSlipOpen] = useState<string | null>(null);
  const [formsVersion, setFormsVersion] = useState(0);

  const canSales = can('sales.hub.view');
  const canSubmitDocs = can('documents.submit');

  const buttons: BigButtonItem[] = [
    ...(canSales ? [{ label: 'Call', icon: PhoneCall, onClick: () => openDialer(), tone: 'success' as const }] : []),
    { label: 'New lead', icon: Plus, onClick: () => setQuickLeadOpen(true) },
    ...(can('sales.leads.view') ? [{ label: 'My leads', icon: Target, to: '/sales/leads' }] : []),
    ...(canSubmitDocs ? [{ label: 'Client documents', icon: FilePlus2, onClick: () => setDocFormOpen(true), tone: 'info' as const }] : []),
    ...(can('hr.leave.view') ? [{ label: 'Leave', icon: CalendarDays, to: '/hr/leave', tone: 'warning' as const }] : []),
    ...(me.payslip ? [{ label: 'Payslip', icon: Wallet, onClick: () => setSlipOpen(me.payslip!.id), tone: 'info' as const }] : []),
    ...(me.employee ? [{ label: 'My PF', icon: PiggyBank, to: '/my/pf', tone: 'success' as const }] : []),
  ];

  return (
    <>
      <DashboardIntro subtitle="Start your day, then call your leads." />

      {quickLeadOpen && (
        <QuickLeadModal
          onClose={() => setQuickLeadOpen(false)}
          onSaved={() => window.location.reload()}
        />
      )}

      {docFormOpen && (
        <ClientDocumentFormModal
          onClose={() => setDocFormOpen(false)}
          onSubmitted={() => setFormsVersion((n) => n + 1)}
        />
      )}

      <PayslipPreview id={slipOpen} onClose={() => setSlipOpen(null)} />

      <BigButtons items={buttons} />

      {canSales && <SalesToday />}

      <SectionTitle>My work</SectionTitle>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <TaskPanel
          title="Tasks for me"
          items={me.tasks}
          emptyTitle="Nothing to do right now"
          emptyDescription="Work given to you shows up here."
          emptyIcon={ListChecks}
          limit={6}
        />
        <TaskPanel
          title="Company news"
          items={updates}
          emptyTitle="No news"
          emptyIcon={Megaphone}
          link={can('hr.broadcasts.view') ? { to: '/hr/broadcasts', label: 'See all' } : undefined}
          limit={5}
        />
      </div>

      {canSubmitDocs && (
        <div className="mt-4">
          <MyDocumentForms reloadKey={formsVersion} onCreate={() => setDocFormOpen(true)} />
        </div>
      )}

      <SectionTitle>Everything else</SectionTitle>
      <ModuleEntities ids={['sales-deals', 'sales-customers', 'hr-productivity', 'hr-broadcasts', 'hr-payslips']} />
    </>
  );
}
