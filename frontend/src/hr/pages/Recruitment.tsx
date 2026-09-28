import { useEffect, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ExternalLink, Eye, KeyRound, MoreHorizontal, RefreshCw, Trash2, UserPlus } from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';
import { API_BASE } from '../../lib/api';
import { useApi, useDebounced } from '../../lib/useApi';
import { date } from '../../lib/format';
import {
  bulkCandidates, CANDIDATE_STATUSES, deleteCandidate, DEPARTMENTS, generateJoiningToken, getCandidate, listCandidates,
  updateCandidateStatus, type Candidate,
} from '../api';
import { DetailList, ExportMenu, ImportButton, Section, Toolbar } from '../components';
import { Avatar } from '../../components/common/Avatar';
import { Badge, StatusBadge } from '../../components/common/Badge';
import { Button } from '../../components/common/Button';
import { Card } from '../../components/common/Card';
import { useConfirm } from '../../components/common/ConfirmDialog';
import { Dropdown, DropdownItem, DropdownSeparator } from '../../components/common/Dropdown';
import { EmptyState } from '../../components/common/EmptyState';
import { ErrorState } from '../../components/common/ErrorState';
import { Input, SearchInput, Select, Textarea } from '../../components/common/Input';
import { Drawer, Modal } from '../../components/common/Modal';
import { Skeleton } from '../../components/common/Skeleton';
import { Pagination, Table, type Column } from '../../components/common/Table';
import { useToast } from '../../components/common/ToastContext';
import { PageHeader } from '../../components/layout/PageHeader';

const PAGE_SIZE = 15;
const OTHER = '__other__';

function StatusModal({ candidate, onClose, onDone }: { candidate: Candidate; onClose: () => void; onDone: () => void }) {
  const { showToast } = useToast();
  const [status, setStatus] = useState(candidate.status);
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const needsReason = status === 'On Hold' || status === 'Rejected';

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (needsReason && !notes.trim()) {
      setError(`Give a reason before marking the candidate ${status}.`);
      return;
    }
    setSaving(true);
    try {
      await updateCandidateStatus(candidate.id, status, notes.trim());
      showToast(`${candidate.candidate_name} moved to ${status}`, 'success');
      onDone();
      onClose();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not update status', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open onClose={onClose} title="Update pipeline status" description={`${candidate.candidate_name} · ${candidate.position_applied}`}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" form="status-form" loading={saving}>Update status</Button></>}>
      <form id="status-form" onSubmit={submit} noValidate className="space-y-4">
        <Select label="Status" value={status} onChange={(e) => { setStatus(e.target.value); setError(''); }}>
          {CANDIDATE_STATUSES.map((s) => <option key={s}>{s}</option>)}
        </Select>
        <Textarea label={needsReason ? `Reason for ${status}` : 'Interview or decision notes'} required={needsReason} value={notes} onChange={(e) => { setNotes(e.target.value); setError(''); }} error={error || undefined} placeholder="Feedback, next steps or reason…" />
      </form>
    </Modal>
  );
}

function TokenModal({ candidate, onClose, onDone }: { candidate: Candidate; onClose: () => void; onDone: () => void }) {
  const { showToast } = useToast();
  const [department, setDepartment] = useState('SALES');
  const [other, setOther] = useState('');
  const [designation, setDesignation] = useState(candidate.position_applied || '');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const dept = department === OTHER ? other.trim() : department;
    if (!dept || !designation.trim()) {
      setError('Department and designation are required.');
      return;
    }
    setSaving(true);
    try {
      const res = await generateJoiningToken({ candidate_id: candidate.id, full_name: candidate.candidate_name, email: candidate.email, department: dept, designation: designation.trim() });
      showToast(`Joining token ${res.token} sent to ${candidate.email}`, 'success');
      onDone();
      onClose();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not generate a token', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open onClose={onClose} title="Send onboarding invitation" description="Creates a one-time joining token (valid 7 days) and emails it to the candidate."
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" form="token-form" loading={saving}><KeyRound size={15} /> Generate & send</Button></>}>
      <form id="token-form" onSubmit={submit} noValidate className="grid gap-4 sm:grid-cols-2">
        <Input label="Candidate" value={candidate.candidate_name} disabled />
        <Input label="Email" value={candidate.email} disabled />
        <Select label="Department" value={department} onChange={(e) => setDepartment(e.target.value)}>
          {DEPARTMENTS.map((d) => <option key={d}>{d}</option>)}<option value={OTHER}>Other…</option>
        </Select>
        {department === OTHER && <Input label="Department name" required value={other} onChange={(e) => setOther(e.target.value)} />}
        <Input label="Designation" required value={designation} onChange={(e) => setDesignation(e.target.value)} className={department === OTHER ? '' : 'sm:col-span-1'} />
        {error && <p role="alert" className="text-sm text-danger sm:col-span-2">{error}</p>}
      </form>
    </Modal>
  );
}

function CandidateDrawer({ id, onClose }: { id: string | null; onClose: () => void }) {
  const cand = useApi(() => getCandidate(id!), [id], !!id);
  const c = cand.data;
  return (
    <Drawer open={!!id} onClose={onClose} title="Candidate profile">
      {cand.status === 'error' ? <ErrorState compact onRetry={cand.reload} message={cand.error} /> : !c || cand.loading ? (
        <div className="space-y-3"><Skeleton className="h-12" /><Skeleton className="h-40" /></div>
      ) : (
        <div className="space-y-5">
          <div className="flex items-center gap-3">
            <Avatar name={c.candidate_name} size={48} />
            <div className="min-w-0">
              <p className="truncate text-base font-semibold text-text">{c.candidate_name}</p>
              <p className="flex items-center gap-2 truncate text-sm text-text-muted">{c.position_applied} <StatusBadge status={c.status} /></p>
            </div>
          </div>
          <Section title="Contact & compensation">
            <DetailList items={[
              ['Email', c.email], ['Phone', c.contact_number], ['Current company', c.current_company], ['Experience', c.total_experience],
              ['Current CTC', c.current_ctc], ['Expected CTC', c.expected_ctc], ['Notice period', c.notice_period], ['Interview date', c.interview_date],
            ]} />
          </Section>
          <Section title="Skills">
            {c.skills?.length ? <div className="flex flex-wrap gap-1.5">{c.skills.map((s) => <Badge key={s.name} tone="primary">{s.name} · {s.proficiency}</Badge>)}</div> : <p className="text-sm text-text-muted">No skills listed.</p>}
          </Section>
          <Section title="Education">
            {c.education?.length ? (
              <ul className="space-y-2">{c.education.map((e, i) => <li key={i} className="rounded-md border border-border px-3 py-2"><p className="text-sm font-medium text-text">{e.degree} · {e.grade}</p><p className="text-xs text-text-muted">{e.institution} ({e.year})</p></li>)}</ul>
            ) : <p className="text-sm text-text-muted">No education details.</p>}
          </Section>
          <Section title="Work experience">
            {c.work_experience?.length ? (
              <ul className="space-y-2">{c.work_experience.map((w, i) => <li key={i} className="rounded-md border border-border px-3 py-2"><p className="text-sm font-medium text-text">{w.role} · {w.company}</p><p className="text-xs text-text-muted">{w.duration}</p>{w.responsibilities && <p className="mt-1 text-xs text-text-secondary">{w.responsibilities}</p>}</li>)}</ul>
            ) : <p className="text-sm text-text-muted">No work experience listed.</p>}
          </Section>
          <Section title="About">
            <DetailList items={[['Languages', c.languages_known], ['Strengths', c.strengths], ['Hobbies', c.hobbies]]} />
          </Section>
          <Section title="Interview notes">
            <p className="whitespace-pre-wrap text-sm text-text-secondary">{c.interview_notes || 'No notes yet.'}</p>
          </Section>
        </div>
      )}
    </Drawer>
  );
}

export function Recruitment() {
  const { can } = useAuth();
  const { showToast } = useToast();
  const confirm = useConfirm();
  const [params, setParams] = useSearchParams();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [statusFor, setStatusFor] = useState<Candidate | null>(null);
  const [tokenFor, setTokenFor] = useState<Candidate | null>(null);
  const q = useDebounced(search);

  const list = useApi(() => listCandidates({ search: q, status, page, limit: PAGE_SIZE }), [q, status, page]);
  useEffect(() => setPage(1), [q, status]);

  const remove = async (c: Candidate) => {
    const ok = await confirm({ title: `Delete ${c.candidate_name}?`, message: 'This permanently deletes the application.', confirmText: 'Delete candidate', tone: 'danger' });
    if (!ok) return;
    try {
      await deleteCandidate(c.id);
      showToast('Candidate deleted', 'success');
      list.reload();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not delete', 'error');
    }
  };

  const columns: Column<Candidate>[] = [
    {
      key: 'name', header: 'Candidate', sortValue: (c) => c.candidate_name.toLowerCase(),
      render: (c) => (
        <span className="flex min-w-0 items-center gap-3">
          <Avatar name={c.candidate_name} size={30} />
          <span className="min-w-0"><span className="block truncate font-medium text-text">{c.candidate_name}</span><span className="block truncate text-xs text-text-muted">{c.email}</span></span>
        </span>
      ),
    },
    { key: 'position', header: 'Position', sortValue: (c) => c.position_applied, render: (c) => c.position_applied },
    { key: 'contact', header: 'Phone', render: (c) => <span className="whitespace-nowrap">{c.contact_number}</span> },
    { key: 'exp', header: 'Experience', render: (c) => c.total_experience || '—' },
    { key: 'interview', header: 'Interview', sortValue: (c) => c.interview_date ?? '', render: (c) => <span className="whitespace-nowrap text-text-muted">{c.interview_date ? date(c.interview_date) : 'Not scheduled'}</span> },
    {
      key: 'status', header: 'Status', sortValue: (c) => c.status,
      render: (c) => <span className="flex flex-col items-start gap-1"><StatusBadge status={c.status} />{c.has_joining_token && <span className="font-mono text-[11px] text-text-muted">Token {c.joining_token}</span>}</span>,
    },
    { key: 'applied', header: 'Applied', sortValue: (c) => c.created_at ?? '', render: (c) => <span className="whitespace-nowrap text-text-muted">{date(c.created_at?.slice(0, 10))}</span> },
    {
      key: 'actions', header: <span className="sr-only">Actions</span>, align: 'right',
      render: (c) => (
        <span onClick={(e) => e.stopPropagation()}>
          <Dropdown label={`Actions for ${c.candidate_name}`} width="w-56" triggerClassName="h-8 w-8 justify-center text-text-muted hover:bg-neutral-bg hover:text-text" trigger={<MoreHorizontal size={16} />}>
            <DropdownItem icon={<Eye size={15} />} onClick={() => setParams({ open: c.id })}>View profile</DropdownItem>
            {can('hr.recruitment.manage') && <DropdownItem icon={<RefreshCw size={15} />} onClick={() => setStatusFor(c)}>Update status</DropdownItem>}
            {can('hr.recruitment.manage') && !c.has_joining_token && <DropdownItem icon={<KeyRound size={15} />} onClick={() => setTokenFor(c)}>Send onboarding invite</DropdownItem>}
            {can('hr.recruitment.delete') && <><DropdownSeparator /><DropdownItem icon={<Trash2 size={15} />} tone="danger" onClick={() => remove(c)}>Delete</DropdownItem></>}
          </Dropdown>
        </span>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Recruitment"
        description="Candidate pipeline from application to onboarding."
        breadcrumbs={[{ label: 'HR' }, { label: 'Recruitment' }]}
        actions={<>
          <Dropdown label="Public portals" width="w-60" triggerClassName="h-9 gap-1.5 border border-border bg-surface px-3 text-sm font-medium text-text shadow-[var(--shadow-card)] hover:bg-surface-secondary" trigger={<><ExternalLink size={15} /> Portals</>}>
            <DropdownItem icon={<ExternalLink size={15} />} onClick={() => window.open(`${API_BASE}/index.html`, '_blank', 'noopener')}>Candidate application form</DropdownItem>
            <DropdownItem icon={<ExternalLink size={15} />} onClick={() => window.open(`${API_BASE}/joining-login.html`, '_blank', 'noopener')}>Onboarding portal</DropdownItem>
          </Dropdown>
          {can('hr.recruitment.manage') && (
            <ImportButton
              noun="candidates"
              columns={[
                { header: 'Name', value: (r) => String(r.full_name ?? r.candidate_name ?? '') },
                { header: 'Position', value: (r) => String(r.position_applied ?? r.designation ?? '') },
                { header: 'Email', value: (r) => String(r.email ?? '') },
                { header: 'Phone', value: (r) => String(r.mobile_number ?? r.contact_number ?? '') },
                { header: 'Experience', value: (r) => String(r.total_experience ?? '') },
              ]}
              onImport={async (rows) => { const res = await bulkCandidates(rows); list.reload(); return res; }}
            />
          )}
          <ExportMenu
            filename="candidates" sheet="Candidates" template={can('hr.recruitment.manage') ? 'candidate' : undefined}
            fetchRows={async () => (await listCandidates({ limit: 2000 })).candidates.map((c) => ({
              Name: c.candidate_name, Position: c.position_applied, Email: c.email, Phone: c.contact_number,
              'Current company': c.current_company ?? '', Experience: c.total_experience ?? '', 'Current CTC': c.current_ctc ?? '',
              'Expected CTC': c.expected_ctc ?? '', 'Notice period': c.notice_period ?? '', Status: c.status,
              'Applied on': c.application_date ?? c.created_at ?? '', 'Interview date': c.interview_date ?? '', 'Joining token': c.joining_token ?? '',
            }))}
          />
        </>}
      />
      <Card>
        <Toolbar count={list.data ? `${list.data.total} candidates` : undefined}>
          <SearchInput value={search} onChange={setSearch} placeholder="Search name, email, phone, role…" label="Search candidates" />
          <Select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)} selectClassName="w-48">
            <option value="">All stages</option>{CANDIDATE_STATUSES.map((s) => <option key={s}>{s}</option>)}
          </Select>
        </Toolbar>
        {list.status === 'error' ? <ErrorState onRetry={list.reload} message={list.error} /> : (
          <>
            <Table caption="Candidates" columns={columns} rows={list.data?.candidates ?? []} rowKey={(c) => c.id} loading={list.loading} onRowClick={(c) => setParams({ open: c.id })}
              empty={q || status
                ? <EmptyState compact icon={UserPlus} title="No candidates match" description="Try a different search or stage." />
                : <EmptyState icon={UserPlus} title="No candidates yet" description="Applications from the public form will appear here." />} />
            {list.data && list.data.total > PAGE_SIZE && <Pagination page={page} pageSize={PAGE_SIZE} total={list.data.total} onChange={setPage} noun="candidates" />}
          </>
        )}
      </Card>
      <CandidateDrawer id={params.get('open')} onClose={() => setParams({}, { replace: true })} />
      {statusFor && <StatusModal candidate={statusFor} onClose={() => setStatusFor(null)} onDone={list.reload} />}
      {tokenFor && <TokenModal candidate={tokenFor} onClose={() => setTokenFor(null)} onDone={list.reload} />}
    </>
  );
}
