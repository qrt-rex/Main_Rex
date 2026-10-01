import { useState } from 'react';
import { Download, FolderOpen, Search } from 'lucide-react';
import { api, saveBlob } from '../lib/api';
import { useApi, useDebounced } from '../lib/useApi';
import { date, dateTime } from '../lib/format';
import { Button } from '../components/common/Button';
import { StatusBadge } from '../components/common/Badge';
import { Select, Textarea } from '../components/common/Input';
import { Modal } from '../components/common/Modal';
import { useToast } from '../components/common/ToastContext';
import type { DocumentSubmission } from './ClientDocumentForm';

interface SubmissionFile { file_id: string; field: string; label: string; filename: string; size: number }
interface SubmissionDetail extends DocumentSubmission {
  gst_number?: string; msme_number?: string; aadhaar_number?: string; pan_number?: string; company_pan_number?: string;
  note?: string; files: SubmissionFile[]; reviewed_by?: string; reviewed_at?: string;
}

const STATUSES = ['PENDING', 'UNDER REVIEW', 'APPROVED', 'HOLD', 'REJECTED'];
const PAGE = 25;
const inputCls = 'w-full rounded-xl border border-slate-200 bg-slate-50/50 px-3 py-2 text-xs font-semibold text-slate-700 focus:border-indigo-500 focus:bg-white dark:focus:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 dark:border-slate-700 dark:bg-slate-800/80 dark:text-slate-200';
const kb = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
// Stored in UTC without a zone marker.
const utc = (s?: string) => (s ? `${s}${/[zZ]|[+-]\d\d:\d\d$/.test(s) ? '' : 'Z'}` : '');

function DetailModal({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const { showToast } = useToast();
  const detail = useApi(() => api.get<SubmissionDetail>(`/api/client-documents/${id}`), [id]);
  const d = detail.data;
  const [status, setStatus] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const download = async (f: SubmissionFile) => {
    try {
      saveBlob(await api.blob(`/api/client-documents/${id}/files/${f.file_id}`), f.filename);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Download failed', 'error');
    }
  };

  const save = async () => {
    if (!d) return;
    setSaving(true);
    try {
      await api.patch(`/api/client-documents/${id}/status`, { status: status ?? d.status, legal_note: note ?? d.legal_note ?? '' });
      showToast('Review saved', 'success');
      onChanged();
      onClose();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not save', 'error');
    } finally {
      setSaving(false);
    }
  };

  const rows: [string, string | undefined][] = d ? [
    ['Name', d.name], ['Company', d.company_name], ['Email', d.email], ['Number', d.phone],
    ['GST number', d.gst_number], ['MSME / Udyam', d.msme_number], ['Aadhaar', d.aadhaar_number],
    ['PAN', d.pan_number], ['Company PAN', d.company_pan_number],
    ['Submitted by', `${d.submitted_by_name ?? ''}${d.submitted_by_email ? ` (${d.submitted_by_email})` : ''}`],
    ['Submitted', dateTime(utc(d.created_at))],
  ] : [];

  return (
    <Modal open onClose={onClose} size="lg" title={d ? `${d.reference} · ${d.company_name || d.name || 'Unnamed client'}` : 'Client document form'}
      footer={d && <><Button variant="secondary" onClick={onClose}>Close</Button><Button onClick={save} loading={saving}>Save review</Button></>}>
      {detail.status === 'error' ? <p className="text-danger">{detail.error}</p> : !d ? <p>Loading…</p> : (
        <div className="space-y-5">
          <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
            {rows.map(([k, val]) => (
              <div key={k}><dt className="text-xs text-text-muted">{k}</dt><dd className="break-words text-text">{val || '—'}</dd></div>
            ))}
          </dl>
          {d.note && <div><p className="text-xs text-text-muted">Note from submitter</p><p className="whitespace-pre-line text-text">{d.note}</p></div>}
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">Documents ({d.files.length})</p>
            {d.files.length === 0 ? <p className="text-text-muted">No documents attached.</p> : (
              <ul className="divide-y divide-border rounded-md border border-border">
                {d.files.map((f) => (
                  <li key={f.file_id} className="flex items-center justify-between gap-3 px-3 py-2">
                    <span className="min-w-0"><span className="block text-text">{f.label}</span><span className="block truncate text-xs text-text-muted">{f.filename} · {kb(f.size)}</span></span>
                    <Button size="sm" variant="secondary" onClick={() => download(f)}><Download size={13} /> Download</Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="grid gap-3 sm:grid-cols-[200px_1fr]">
            <Select label="Review status" value={status ?? d.status} onChange={(e) => setStatus(e.target.value)}>
              {STATUSES.map((s) => <option key={s}>{s}</option>)}
            </Select>
            <Textarea label="Legal note" rows={2} value={note ?? d.legal_note ?? ''} onChange={(e) => setNote(e.target.value)} />
          </div>
          {d.reviewed_by && <p className="text-xs text-text-muted">Last reviewed by {d.reviewed_by}{d.reviewed_at ? `, ${dateTime(utc(d.reviewed_at))}` : ''}</p>}
        </div>
      )}
    </Modal>
  );
}

/** Legal dashboard section: client document forms submitted by staff. */
export function LegalClientDocuments() {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<string | null>(null);
  const q = useDebounced(search);
  const list = useApi(() => api.get<{ items: DocumentSubmission[]; total: number }>('/api/client-documents',
    { search: q, status, skip: (page - 1) * PAGE, limit: PAGE }), [q, status, page]);
  const items = list.data?.items ?? [];
  const total = list.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE));

  return (
    <div className="rounded-2xl border border-slate-200/80 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900 overflow-hidden">
      <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="flex h-6 w-6 items-center justify-center rounded-md bg-indigo-50 text-indigo-600 dark:bg-indigo-950 dark:text-indigo-400"><FolderOpen size={13} /></div>
          <h3 className="font-bold text-sm text-slate-800 dark:text-slate-100">Client document forms</h3>
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-600 dark:bg-slate-800 dark:text-slate-300">{total}</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-64">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input aria-label="Search document forms" placeholder="Search company, name, reference…" value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }} className={`${inputCls} pl-9`} />
          </div>
          <select aria-label="Filter document forms by status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className={`${inputCls} w-40`}>
            <option value="">All Status</option>
            {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-slate-100 dark:border-slate-800/80 bg-slate-50/60 dark:bg-slate-800/30 text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
              <th className="py-3.5 pl-6 pr-4">Reference</th>
              <th className="py-3.5 px-4">Company</th>
              <th className="py-3.5 px-4">Client contact</th>
              <th className="py-3.5 px-4">Submitted by</th>
              <th className="py-3.5 px-4">Files</th>
              <th className="py-3.5 px-4">Date</th>
              <th className="py-3.5 px-4">Status</th>
              <th className="py-3.5 pl-4 pr-6 text-right">Review</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 text-xs">
            {list.status === 'error' ? (
              <tr><td colSpan={8} className="py-10 text-center text-rose-600">{list.error}</td></tr>
            ) : items.length === 0 ? (
              <tr><td colSpan={8} className="py-10 text-center text-slate-400">{list.loading ? 'Loading document forms…' : 'No client document forms yet.'}</td></tr>
            ) : items.map((s) => (
              <tr key={s.id} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/30">
                <td className="py-3.5 pl-6 pr-4 font-mono font-bold text-indigo-600 dark:text-indigo-400">{s.reference}</td>
                <td className="py-3.5 px-4 font-semibold text-slate-800 dark:text-slate-100">{s.company_name || <span className="font-normal italic text-slate-400">No company name</span>}</td>
                <td className="py-3.5 px-4 text-slate-600 dark:text-slate-300"><span className="block">{s.name || '—'}</span><span className="block text-slate-400">{[s.email, s.phone].filter(Boolean).join(' · ') || '—'}</span></td>
                <td className="py-3.5 px-4 text-slate-600 dark:text-slate-300">{s.submitted_by_name || s.submitted_by_email}</td>
                <td className="py-3.5 px-4 text-slate-600 dark:text-slate-300">{s.file_count}</td>
                <td className="py-3.5 px-4 whitespace-nowrap text-slate-500">{date(s.created_at.slice(0, 10))}</td>
                <td className="py-3.5 px-4"><StatusBadge status={s.status} /></td>
                <td className="py-3.5 pl-4 pr-6 text-right">
                  <button type="button" onClick={() => setOpenId(s.id)} className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-1 text-xs font-bold text-indigo-700 hover:bg-indigo-100 dark:border-indigo-900 dark:bg-indigo-950/50 dark:text-indigo-300">View</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pages > 1 && (
        <div className="px-6 py-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-xs text-slate-500">
          <span>Page {page} of {pages}</span>
          <span className="flex gap-2">
            <button type="button" disabled={page === 1} onClick={() => setPage((p) => p - 1)} className="rounded-lg border border-slate-200 px-3 py-1 disabled:opacity-40 dark:border-slate-700">Previous</button>
            <button type="button" disabled={page >= pages} onClick={() => setPage((p) => p + 1)} className="rounded-lg border border-slate-200 px-3 py-1 disabled:opacity-40 dark:border-slate-700">Next</button>
          </span>
        </div>
      )}
      {openId && <DetailModal id={openId} onClose={() => setOpenId(null)} onChanged={list.reload} />}
    </div>
  );
}
