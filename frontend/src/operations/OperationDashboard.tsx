import { useState, type DragEvent } from 'react';
import { ArrowRight, Briefcase, CircleCheck, Download, FileCheck2, FileClock, FileText, History, UserRound } from 'lucide-react';
import { api, saveBlob } from '../lib/api';
import { useApi, useDebounced } from '../lib/useApi';
import { date, dateTime, number } from '../lib/format';
import { PageHeader } from '../components/layout/PageHeader';
import { Badge, StatusBadge } from '../components/common/Badge';
import { Button } from '../components/common/Button';
import { Card } from '../components/common/Card';
import { EmptyState } from '../components/common/EmptyState';
import { ErrorState } from '../components/common/ErrorState';
import { Checkbox, SearchInput, Select, Textarea } from '../components/common/Input';
import { Drawer } from '../components/common/Modal';
import { Skeleton } from '../components/common/Skeleton';
import { useToast } from '../components/common/ToastContext';
import { StatCard } from '../components/dashboard/StatCard';

interface Stage { key: string; label: string; count: number }
interface LegalDocument {
  id: string; label: string; filename: string; content_type?: string | null; size?: number | null;
  source: 'APPROVED' | 'PROVIDED'; by: string; at: string;
}
interface StageMove { from: string; from_label: string; to: string; to_label: string; by: string; at: string; note: string }
interface OpsCase {
  key: string; kind: 'record' | 'document'; id: string; reference: string; company_name: string;
  contact_name: string; contact_email: string; contact_phone: string; bdm: string; services: string[];
  legal_status: string; assigned_to?: { name: string } | null; created_at: string;
  stage: string; stage_label: string; stage_since: string; stage_by: string;
  documents: LegalDocument[]; pending_review: number; history?: StageMove[];
}
interface Board { stages: Stage[]; cases: OpsCase[]; total: number; documents_total: number; can_manage: boolean }

const LEGAL_STATUSES = ['PENDING', 'UNDER REVIEW', 'APPROVED', 'HOLD', 'REJECTED'];
const kb = (n?: number | null) => (!n ? '' : n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const caseUrl = (c: Pick<OpsCase, 'kind' | 'id'>) => `/api/operations/cases/${c.kind}/${encodeURIComponent(c.id)}`;

function SourceBadge({ source }: { source: LegalDocument['source'] }) {
  return source === 'APPROVED' ? <Badge tone="success">Approved by Legal</Badge> : <Badge tone="info">Provided by Legal</Badge>;
}

/** `/operations`: every client case on the operation stages, with the documents Legal provided or approved. */
export function OperationDashboard() {
  const { showToast } = useToast();
  const [search, setSearch] = useState('');
  const [legalStatus, setLegalStatus] = useState('');
  const [withDocs, setWithDocs] = useState(false);
  const [openCase, setOpenCase] = useState<OpsCase | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const q = useDebounced(search);
  const board = useApi(() => api.get<Board>('/api/operations/board', { search: q, legal_status: legalStatus, with_documents: withDocs || undefined }),
    [q, legalStatus, withDocs]);
  const data = board.data;
  const awaitingLegal = data?.cases.reduce((n, c) => n + c.pending_review, 0) ?? 0;
  const lastStage = data?.stages[data.stages.length - 1];

  const move = async (c: OpsCase, stage: string, note = '') => {
    try {
      const updated = await api.put<OpsCase>(`${caseUrl(c)}/stage`, { stage, note });
      showToast(`${c.company_name} moved to ${updated.stage_label}`, 'success');
      board.reload();
      return updated;
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not move the case', 'error');
      return null;
    }
  };

  const drop = (e: DragEvent, stage: string) => {
    e.preventDefault();
    const c = data?.cases.find((x) => x.key === e.dataTransfer.getData('text/plain'));
    setDragging(null);
    if (c && c.stage !== stage) move(c, stage);
  };

  return (
    <>
      <PageHeader
        title="Operation dashboard"
        description="Every client case by stage, with the documents the Legal team provided or approved."
        breadcrumbs={[{ label: 'Dashboard', to: '/dashboard' }, { label: 'Operation dashboard' }]}
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={Briefcase} label="Client cases" value={data ? number(data.total) : <Skeleton className="h-7 w-10" />} hint="Across all stages" />
        <StatCard icon={FileCheck2} tone="success" label="Documents from Legal" value={data ? number(data.documents_total) : <Skeleton className="h-7 w-10" />} hint="Provided or approved" />
        <StatCard icon={FileClock} tone={awaitingLegal ? 'warning' : 'info'} label="Awaiting Legal approval" value={data ? number(awaitingLegal) : <Skeleton className="h-7 w-10" />} hint="Client files not yet approved" />
        <StatCard icon={CircleCheck} tone="info" label={lastStage ? `At ${lastStage.label}` : 'Last stage'} value={lastStage ? number(lastStage.count) : <Skeleton className="h-7 w-10" />} hint="Final stage so far" />
      </div>

      <Card className="mb-4 flex flex-wrap items-end gap-3 p-3">
        <SearchInput value={search} onChange={setSearch} label="Search cases" placeholder="Search company, reference, BDM, service…" />
        <Select aria-label="Legal status" value={legalStatus} onChange={(e) => setLegalStatus(e.target.value)} selectClassName="w-44">
          <option value="">All legal statuses</option>
          {LEGAL_STATUSES.map((s) => <option key={s} value={s}>{s.charAt(0) + s.slice(1).toLowerCase()}</option>)}
        </Select>
        <Checkbox className="pb-2" label="Only cases with Legal documents" checked={withDocs} onChange={(e) => setWithDocs(e.target.checked)} />
        {data?.can_manage && <p className="ml-auto pb-2 text-xs text-text-muted">Drag a card to another stage, or open it to move it.</p>}
      </Card>

      {board.status === 'error' ? (
        <Card><ErrorState onRetry={board.reload} message={board.error} /></Card>
      ) : !data ? (
        <div className="flex gap-3 overflow-hidden">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-72 w-72 shrink-0" />)}</div>
      ) : data.total === 0 ? (
        <Card><EmptyState icon={Briefcase} title="No client cases" description="Clients added in the Legal module appear here, starting at Onboarding." /></Card>
      ) : (
        <div className="-mx-1 flex gap-3 overflow-x-auto px-1 pb-3">
          {data.stages.map((s, i) => {
            const cases = data.cases.filter((c) => c.stage === s.key);
            return (
              <section
                key={s.key}
                aria-label={s.label}
                onDragOver={data.can_manage ? (e) => e.preventDefault() : undefined}
                onDrop={data.can_manage ? (e) => drop(e, s.key) : undefined}
                className={`flex w-72 shrink-0 flex-col rounded-lg border bg-surface-secondary ${dragging ? 'border-dashed border-border-strong' : 'border-border'}`}
              >
                <header className="flex items-center justify-between gap-2 border-b border-border px-3 py-2.5">
                  <h2 className="truncate text-sm font-semibold text-text"><span className="mr-1.5 text-text-muted">{i + 1}.</span>{s.label}</h2>
                  <span className="rounded-full bg-neutral-bg px-2 py-0.5 text-xs font-medium text-text-secondary tabular-nums">{s.count}</span>
                </header>
                <div className="flex max-h-[65vh] min-h-24 flex-col gap-2 overflow-y-auto p-2">
                  {cases.length === 0 && <p className="px-1 py-6 text-center text-xs text-text-muted">No cases at this stage</p>}
                  {cases.map((c) => (
                    <button
                      key={c.key}
                      type="button"
                      draggable={data.can_manage}
                      onDragStart={(e) => { e.dataTransfer.setData('text/plain', c.key); setDragging(c.key); }}
                      onDragEnd={() => setDragging(null)}
                      onClick={() => setOpenCase(c)}
                      className={`rounded-md border border-border bg-surface p-3 text-left shadow-[var(--shadow-card)] transition-colors hover:border-border-strong ${dragging === c.key ? 'opacity-50' : ''}`}
                    >
                      <span className="flex items-center justify-between gap-2">
                        <span className="font-mono text-xs font-semibold text-primary">{c.reference || '—'}</span>
                        <StatusBadge status={c.legal_status} />
                      </span>
                      <span className="mt-1.5 block truncate text-sm font-medium text-text">{c.company_name}</span>
                      {(c.services.length > 0 || c.bdm) && (
                        <span className="mt-0.5 block truncate text-xs text-text-muted">{c.services.join(', ') || c.bdm}</span>
                      )}
                      <span className="mt-2 flex items-center justify-between gap-2 text-xs text-text-muted">
                        <span className={`inline-flex items-center gap-1 ${c.documents.length ? 'text-success' : ''}`}>
                          <FileText size={12} aria-hidden="true" />
                          {c.documents.length} {c.documents.length === 1 ? 'document' : 'documents'}
                          {c.pending_review > 0 && <span className="text-warning">· {c.pending_review} awaiting</span>}
                        </span>
                        <span>since {date(c.stage_since?.slice(0, 10))}</span>
                      </span>
                      {c.assigned_to?.name && (
                        <span className="mt-1 flex items-center gap-1 truncate text-xs text-text-muted"><UserRound size={12} aria-hidden="true" />{c.assigned_to.name}</span>
                      )}
                    </button>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}

      {openCase && data && (
        <CaseDrawer key={openCase.key} initial={openCase} stages={data.stages} canManage={data.can_manage} onClose={() => setOpenCase(null)} onMove={move} />
      )}
    </>
  );
}

function CaseDrawer({ initial, stages, canManage, onClose, onMove }: {
  initial: OpsCase; stages: Stage[]; canManage: boolean; onClose: () => void;
  onMove: (c: OpsCase, stage: string, note?: string) => Promise<OpsCase | null>;
}) {
  const { showToast } = useToast();
  const detail = useApi(() => api.get<OpsCase>(caseUrl(initial)), [initial.key]);
  const c = detail.data ?? initial;
  const [stage, setStage] = useState(initial.stage);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const index = stages.findIndex((s) => s.key === c.stage);
  const next = stages[index + 1];

  const save = async (to: string) => {
    setSaving(true);
    const updated = await onMove(c, to, note);
    setSaving(false);
    if (updated) {
      detail.setData(updated);
      setStage(updated.stage);
      setNote('');
    }
  };

  const download = async (d: LegalDocument) => {
    try {
      saveBlob(await api.blob(`${caseUrl(c)}/documents/${d.id}`), d.filename);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Download failed', 'error');
    }
  };

  const facts: [string, string][] = [
    ['Reference', c.reference], ['Legal status', c.legal_status.charAt(0) + c.legal_status.slice(1).toLowerCase()],
    ['Contact', [c.contact_name, c.contact_email, c.contact_phone].filter(Boolean).join(' · ')],
    [c.kind === 'record' ? 'BDM' : 'Submitted by', c.bdm], ['Services', c.services.join(', ')],
    ['Assigned to', c.assigned_to?.name ?? ''], ['Added', date(c.created_at?.slice(0, 10))],
  ];

  return (
    <Drawer open onClose={onClose} title={c.company_name}>
      <div className="space-y-6">
        <div>
          <p className="text-xs text-text-muted">Current stage</p>
          <p className="mt-0.5 text-base font-semibold text-text">{index + 1}. {c.stage_label}</p>
          <p className="text-xs text-text-muted">Since {dateTime(c.stage_since)}{c.stage_by ? ` · moved by ${c.stage_by}` : ''}</p>
          {canManage && (
            <div className="mt-3 space-y-2 rounded-md border border-border p-3">
              <Select label="Move to stage" value={stage} onChange={(e) => setStage(e.target.value)}>
                {stages.map((s, i) => <option key={s.key} value={s.key}>{i + 1}. {s.label}</option>)}
              </Select>
              <Textarea label="Note (optional)" rows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
              <div className="flex flex-wrap justify-end gap-2">
                {next && <Button variant="secondary" size="sm" loading={saving} onClick={() => save(next.key)}>Next: {next.label} <ArrowRight size={13} /></Button>}
                <Button size="sm" loading={saving} disabled={stage === c.stage} onClick={() => save(stage)}>Move</Button>
              </div>
            </div>
          )}
        </div>

        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">Documents from Legal ({c.documents.length})</p>
          {c.documents.length === 0 ? (
            <p className="text-text-muted">Nothing provided or approved by Legal yet.</p>
          ) : (
            <ul className="divide-y divide-border rounded-md border border-border">
              {c.documents.map((d) => (
                <li key={d.id} className="flex items-center justify-between gap-3 px-3 py-2">
                  <span className="min-w-0">
                    <span className="block text-text">{d.label}</span>
                    <span className="block truncate text-xs text-text-muted">{[d.filename, kb(d.size)].filter(Boolean).join(' · ')}</span>
                    <span className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-text-muted"><SourceBadge source={d.source} />{d.by}{d.at ? `, ${dateTime(d.at)}` : ''}</span>
                  </span>
                  <Button size="sm" variant="secondary" onClick={() => download(d)} aria-label={`Download ${d.label}`}><Download size={13} /></Button>
                </li>
              ))}
            </ul>
          )}
          {c.pending_review > 0 && (
            <p className="mt-2 text-xs text-warning">{c.pending_review} client {c.pending_review === 1 ? 'file is' : 'files are'} waiting for Legal approval.</p>
          )}
        </div>

        <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
          {facts.map(([k, v]) => (
            <div key={k}><dt className="text-xs text-text-muted">{k}</dt><dd className="break-words text-text">{v || '—'}</dd></div>
          ))}
        </dl>

        <div>
          <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-text-muted"><History size={13} aria-hidden="true" />Stage history</p>
          {!c.history ? (
            <Skeleton className="h-10 w-full" />
          ) : c.history.length === 0 ? (
            <p className="text-text-muted">Not moved yet: started at {stages[0]?.label}.</p>
          ) : (
            <ol className="space-y-2">
              {c.history.map((h, i) => (
                <li key={`${h.at}-${i}`} className="rounded-md border border-border px-3 py-2">
                  <p className="text-text">{h.from_label} <ArrowRight size={12} className="inline" aria-hidden="true" /> {h.to_label}</p>
                  <p className="text-xs text-text-muted">{h.by} · {dateTime(h.at)}</p>
                  {h.note && <p className="mt-1 whitespace-pre-line text-xs text-text-secondary">{h.note}</p>}
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
    </Drawer>
  );
}
