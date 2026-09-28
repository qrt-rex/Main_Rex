import { useState } from 'react';
import {
  CalendarClock, CalendarDays, FilePlus2, IdCard, ListChecks, Megaphone,
  PhoneCall, Plus, Target, Trophy, Wallet,
} from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { useApi } from '../lib/useApi';
import { date, money, number, todayISO } from '../lib/format';
import { Button } from '../components/common/Button';
import { Card, CardHeader } from '../components/common/Card';
import { EmptyState } from '../components/common/EmptyState';
import { StatusBadge } from '../components/common/Badge';
import { StatCard } from '../components/dashboard/StatCard';
import { Skeleton } from '../components/common/Skeleton';
import { ClientDocumentFormModal, MyDocumentForms } from './ClientDocumentForm';
import {
  ActivityTable, DetailCard, ModuleEntities, SectionTitle, StatGrid, TaskPanel, TwoColumn,
} from './components';
import { DashboardIntro } from './DashboardShell';
import {
  AttendanceBoardCard, DayCard, LeadsCard, MaterialsCard, QuickLeadModal, SchemesCard, TeamProgressCard,
} from '../sales/SalesWidgets';
import { salesSummary } from '../sales/api';
import { useLive } from '../sales/useLive';
import type { WorkspaceSummary } from './api';

/** Personal workspace: leads to call, dialer, CRM entries, schemes, company material, progress, attendance board and personal records. */
export function EmployeeDashboard({ summary }: { summary: WorkspaceSummary }) {
  const { user, can } = useAuth();
  const { me, updates, activity } = summary;
  const openLeave = me.leaves.filter((l) => (l.status ?? '').toUpperCase() === 'PENDING').length;
  const canSubmitDocs = can('documents.submit');
  const [formOpen, setFormOpen] = useState(false);
  const [formsVersion, setFormsVersion] = useState(0);
  const [quickLeadOpen, setQuickLeadOpen] = useState(false);

  // Real-time sales, leads, dialer, schemes & attendance data
  const s = useApi(salesSummary);
  useLive(s.reload);

  const salesData = s.data;
  const myProgress = salesData?.progress?.find((r) => r.user_id === salesData.me.user_id);
  const today = todayISO();
  const openLeads = salesData?.leads?.filter((l) => ['NEW', 'ATTEMPTED', 'CALL_BACK', 'INTERESTED'].includes(l.status)) ?? [];
  const dueFollowUps = openLeads.filter((l) => l.follow_up_date && l.follow_up_date <= today).length;

  return (
    <>
      <DashboardIntro
        subtitle="Your day, assigned leads to call, active schemes, company material, and team attendance."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" onClick={() => setQuickLeadOpen(true)}>
              <Plus size={15} /> New CRM lead
            </Button>
            {canSubmitDocs && (
              <Button onClick={() => setFormOpen(true)}>
                <FilePlus2 size={15} /> Create form
              </Button>
            )}
          </div>
        }
      />

      {formOpen && (
        <ClientDocumentFormModal
          onClose={() => setFormOpen(false)}
          onSubmitted={() => setFormsVersion((n) => n + 1)}
        />
      )}

      {quickLeadOpen && (
        <QuickLeadModal
          onClose={() => setQuickLeadOpen(false)}
          onSaved={() => s.reload()}
        />
      )}

      {/* Primary KPI & Day Status Bar */}
      {salesData ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <DayCard session={salesData.session} onChange={s.reload} />
          <StatCard
            icon={Target}
            label="Leads to call"
            value={number(openLeads.length)}
            hint={`${salesData.leads.length} assigned to you`}
          />
          <StatCard
            icon={CalendarClock}
            tone="warning"
            label="Follow-ups due"
            value={number(dueFollowUps)}
            hint="Due today or pending"
          />
          <StatCard
            icon={PhoneCall}
            tone="success"
            label="Calls logged today"
            value={number(myProgress?.calls ?? 0)}
            hint={`${myProgress?.converted ?? 0} converted · ${myProgress?.interested ?? 0} interested`}
          />
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
      )}

      {/* Main Calling, CRM, Schemes & Materials Workspace */}
      <SectionTitle>Client calling & sales hub</SectionTitle>
      <TwoColumn
        main={
          <>
            {salesData && <LeadsCard leads={salesData.leads} onChanged={s.reload} />}
            {salesData && (
              <TeamProgressCard
                rows={salesData.progress.filter((r) => r.user_id === salesData.me.user_id)}
                title="Your calling & progress"
                description="Your live call outcomes & conversions today"
                actions={<Trophy size={16} className="text-warning" />}
              />
            )}
            {salesData && (
              <AttendanceBoardCard
                rows={salesData.attendance.filter((r) => r.user_id === salesData.me.user_id)}
                title="Your attendance"
                description="Your login time, logout time & active working hours"
              />
            )}
          </>
        }
        side={
          <>
            {salesData && <SchemesCard schemes={salesData.schemes} />}
            {salesData && <MaterialsCard materials={salesData.materials} />}
          </>
        }
      />

      {/* Personal Tasks, HR & Employee Records */}
      <SectionTitle>Your tasks & HR records</SectionTitle>
      <StatGrid>
        <StatCard icon={ListChecks} label="Open assigned tasks" value={number(me.tasks.length)} hint="Work items assigned" />
        <StatCard icon={CalendarDays} tone="warning" label="Leave requests pending" value={number(openLeave)} hint={`${me.leaves.length} request(s) on record`} />
        {me.payslip && <StatCard icon={Wallet} tone="info" label="Latest payslip" value={money(me.payslip.net_salary)} hint={me.payslip.period || 'Most recent'} />}
        <StatCard icon={Megaphone} label="Company updates" value={number(updates.length)} hint="Active announcements" />
      </StatGrid>

      <TwoColumn
        main={
          <>
            <TaskPanel
              title="Tasks and pending work"
              description="Everything currently assigned to you"
              items={me.tasks}
              emptyTitle="Nothing assigned"
              emptyDescription="Tasks assigned to your account will appear here."
              emptyIcon={ListChecks}
            />
            <TaskPanel
              title="Company announcements"
              description="Broadcast updates & notices"
              items={updates}
              emptyTitle="No announcements"
              emptyDescription="Company broadcasts will appear here."
              emptyIcon={Megaphone}
            />
          </>
        }
        side={
          <>
            {canSubmitDocs && <MyDocumentForms reloadKey={formsVersion} onCreate={() => setFormOpen(true)} />}
            {me.employee ? (
              <DetailCard
                title="Employee details"
                rows={[
                  ['Name', me.employee.full_name || user?.username || '—'],
                  ['Employee code', me.employee.employee_code || '—'],
                  ['Designation', me.employee.designation || '—'],
                  ['Department', me.employee.department || '—'],
                  ['Joined', me.employee.joining_date ? date(me.employee.joining_date) : '—'],
                  ['Status', <StatusBadge key="s" status={me.employee.status} />],
                ]}
              />
            ) : (
              <Card>
                <CardHeader title="Employee details" />
                <EmptyState
                  compact
                  icon={IdCard}
                  title="No employee profile linked"
                  description={`No employee profile matches ${user?.email}. Contact HR to have it linked.`}
                />
              </Card>
            )}
            <TaskPanel
              title="Your leave"
              description="Most recent requests"
              items={me.leaves}
              emptyTitle="No leave requests"
              emptyDescription="Requests you submit appear here with their status."
              emptyIcon={CalendarDays}
              limit={5}
            />
            {me.payslip && (
              <DetailCard
                title="Documents"
                description="Issued to you"
                rows={[
                  ['Latest payslip', me.payslip.period || 'Most recent'],
                  ['Net pay', money(me.payslip.net_salary)],
                ]}
              />
            )}
          </>
        }
      />

      <ModuleEntitiesSection />

      <SectionTitle>Your recent activity</SectionTitle>
      <ActivityTable title="Actions on your account" description="Sign-ins and changes you made" items={activity} />
    </>
  );
}

/** Only rendered when the employee has at least one module they may open. */
function ModuleEntitiesSection() {
  const { can } = useAuth();
  const hasAny = ['hr.broadcasts.view', 'hr.leave.view', 'hr.payroll.view', 'hr.attendance.view'].some(can);
  if (!hasAny) return null;
  return (
    <>
      <SectionTitle>Available to you</SectionTitle>
      <ModuleEntities ids={['hr-broadcasts', 'hr-leave', 'hr-attendance', 'hr-payslips']} />
    </>
  );
}
