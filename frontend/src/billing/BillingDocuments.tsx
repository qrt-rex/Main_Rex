import { useState, useEffect, useCallback, useRef } from 'react';
import { Download, FolderOpen, Trash2, Upload } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { Card } from '../components/common/Card';
import { useConfirm } from '../components/common/ConfirmDialog';
import { useToast } from '../components/common/ToastContext';
import { api, ApiError, saveBlob } from '../lib/api';
import { date } from '../lib/format';

interface Doc { id: string; filename: string; size: number; uploaded_by: string; created_at: string }

const sizeLabel = (b: number) => (b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

/** Shared billing files (rate cards, brochures, templates): everyone with billing access downloads, managers upload and delete. */
export function BillingDocuments() {
  const { can } = useAuth();
  const confirm = useConfirm();
  const { showToast } = useToast();
  const input = useRef<HTMLInputElement>(null);
  const manage = can('billing.manage');
  const [docs, setDocs] = useState<Doc[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api.get<{ items: Doc[] }>('/api/billing/documents')
      .then((d) => setDocs(d.items || []))
      .catch((err) => showToast(err instanceof ApiError ? err.message : 'Could not load documents', 'error'))
      .finally(() => setLoading(false));
  }, [showToast]);

  useEffect(load, [load]);

  const upload = async (file: File | undefined) => {
    if (!file) return;
    const body = new FormData();
    body.append('file', file);
    setBusy(true);
    try {
      await api.post('/api/billing/documents', body);
      showToast(`${file.name} uploaded`, 'success');
      load();
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Upload failed', 'error');
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };

  const download = async (d: Doc) => {
    try {
      saveBlob(await api.blob(`/api/billing/documents/${d.id}/download`), d.filename);
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Download failed', 'error');
    }
  };

  const remove = async (d: Doc) => {
    if (!(await confirm({ title: `Delete ${d.filename}?`, tone: 'danger', confirmText: 'Delete', message: 'Everyone loses access to this file.' }))) return;
    try {
      await api.delete(`/api/billing/documents/${d.id}`);
      load();
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Could not delete the file', 'error');
    }
  };

  return (
    <div className="space-y-6">
      <Card className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-text">Documents</h2>
            <p className="text-xs text-text-muted">Shared billing resources: brochures, rate cards, templates (up to 5 MB each).</p>
          </div>
          {manage && (
            <>
              <input ref={input} type="file" className="sr-only" aria-label="Choose a file to upload" onChange={(e) => upload(e.target.files?.[0])} />
              <button type="button" disabled={busy} onClick={() => input.current?.click()}
                className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3.5 py-1.5 text-sm font-medium text-on-primary hover:bg-primary-hover disabled:opacity-50 transition-colors">
                <Upload size={14} /> {busy ? 'Uploading…' : 'Upload File'}
              </button>
            </>
          )}
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-text">
            <thead className="border-b border-border bg-surface-secondary text-xs uppercase text-text-muted font-semibold">
              <tr>
                <th className="px-4 py-3">File</th>
                <th className="px-4 py-3 text-right">Size</th>
                <th className="px-4 py-3">Uploaded By</th>
                <th className="px-4 py-3">Uploaded</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {loading ? (
                <tr><td colSpan={5} className="p-8 text-center text-text-muted">Loading documents...</td></tr>
              ) : docs.length === 0 ? (
                <tr>
                  <td colSpan={5} className="p-10 text-center text-text-muted">
                    <FolderOpen className="mx-auto h-8 w-8 text-text-muted/50 mb-2" />
                    No documents yet.
                  </td>
                </tr>
              ) : (
                docs.map((d) => (
                  <tr key={d.id} className="hover:bg-surface-secondary/50">
                    <td className="px-4 py-3 font-medium text-text">{d.filename}</td>
                    <td className="px-4 py-3 text-right text-xs text-text-muted">{sizeLabel(d.size)}</td>
                    <td className="px-4 py-3 text-xs text-text-secondary">{d.uploaded_by || '—'}</td>
                    <td className="px-4 py-3 text-xs text-text-muted whitespace-nowrap">{date(d.created_at)}</td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex justify-end gap-1">
                        <button type="button" onClick={() => download(d)} title="Download" aria-label={`Download ${d.filename}`}
                          className="rounded-md p-1.5 text-text-muted hover:bg-surface-secondary hover:text-text"><Download size={15} /></button>
                        {manage && (
                          <button type="button" onClick={() => remove(d)} title="Delete" aria-label={`Delete ${d.filename}`}
                            className="rounded-md p-1.5 text-rose-600 hover:bg-rose-500/10"><Trash2 size={15} /></button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
