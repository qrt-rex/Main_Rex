import { useState, type FormEvent } from 'react';
import { FilePlus2, FolderOpen, Paperclip, X } from 'lucide-react';
import { api } from '../lib/api';
import { useApi } from '../lib/useApi';
import { date } from '../lib/format';
import { StatusBadge } from '../components/common/Badge';
import { Button } from '../components/common/Button';
import { Card, CardHeader } from '../components/common/Card';
import { EmptyState } from '../components/common/EmptyState';
import { Input, Textarea } from '../components/common/Input';
import { Modal } from '../components/common/Modal';
import { useToast } from '../components/common/ToastContext';

export interface DocumentSubmission {
  id: string;
  reference: string;
  name: string;
  email: string;
  phone: string;
  company_name: string;
  status: string;
  file_count: number;
  created_at: string;
  submitted_by_name?: string;
  submitted_by_email?: string;
  legal_note?: string;
}

/** Document slots, in the order the form shows them. Keys match the API. */
const DOCUMENT_FIELDS: [string, string][] = [
  ['coi', 'Certificate of Incorporation (COI)'],
  ['gst_certificate', 'GST certificate'],
  ['msme_certificate', 'MSME / Udyam certificate'],
  ['aadhaar_card', 'Aadhaar card'],
  ['pan_card', 'PAN card'],
  ['company_pan_card', 'Company PAN card'],
  ['bank_statement', 'Bank statement'],
  ['itr', 'ITR'],
  ['pitch_deck', 'Pitch deck / financial report'],
];
const ACCEPT = '.pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,.xls,.xlsx,.csv,.ppt,.pptx';
const MAX_MB = 10;

const EMPTY = { name: '', email: '', phone: '', company_name: '', gst_number: '', msme_number: '', aadhaar_number: '', pan_number: '', company_pan_number: '', note: '' };

function FileSlot({ label, files, multiple, onChange }: { label: string; files: File[]; multiple?: boolean; onChange: (f: File[]) => void }) {
  return (
    <div className="rounded-md border border-dashed border-border p-3">
      <p className="text-sm font-medium text-text">{label}</p>
      {files.length > 0 && (
        <ul className="mt-2 space-y-1">
          {files.map((f, i) => (
            <li key={`${f.name}-${i}`} className="flex items-center justify-between gap-2 text-xs text-text-secondary">
              <span className="flex min-w-0 items-center gap-1.5"><Paperclip size={12} className="shrink-0" /><span className="truncate">{f.name}</span></span>
              <button type="button" aria-label={`Remove ${f.name}`} onClick={() => onChange(files.filter((_, j) => j !== i))} className="rounded p-0.5 text-text-muted hover:text-danger"><X size={13} /></button>
            </li>
          ))}
        </ul>
      )}
      {(multiple || files.length === 0) && (
        <label className="mt-2 inline-flex cursor-pointer items-center gap-1.5 text-xs font-medium text-primary hover:underline">
          <FilePlus2 size={13} /> {files.length ? 'Add another file' : 'Choose file'}
          <input type="file" accept={ACCEPT} multiple={multiple} className="sr-only"
            onChange={(e) => { onChange([...files, ...Array.from(e.target.files ?? [])]); e.target.value = ''; }} />
        </label>
      )}
    </div>
  );
}

export function ClientDocumentFormModal({ onClose, onSubmitted }: { onClose: () => void; onSubmitted: () => void }) {
  const { showToast } = useToast();
  const [v, setV] = useState(EMPTY);
  const [files, setFiles] = useState<Record<string, File[]>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const set = (k: keyof typeof EMPTY) => (e: { target: { value: string } }) => setV((s) => ({ ...s, [k]: e.target.value }));
  const setSlot = (key: string) => (f: File[]) => setFiles((s) => ({ ...s, [key]: f }));

  // Every field is optional; these only warn when something looks unusual (it is still saved as typed).
  const looksOff = (value: string, ok: RegExp, message: string) => (value.trim() && !ok.test(value.replace(/[\s-]/g, '').toUpperCase()) ? message : undefined);
  const warn = {
    email: looksOff(v.email, /^[^@]+@[^@]+\.[^@]+$/, "This doesn't look like an email address."),
    phone: looksOff(v.phone, /^(\+?91)?[6-9]\d{9}$/, "This doesn't look like a 10-digit mobile number."),
    gst_number: looksOff(v.gst_number, /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/, 'GST numbers are 15 characters, e.g. 24ABCDE1234F1Z5.'),
    msme_number: looksOff(v.msme_number, /^UDYAM[A-Z]{2}\d{9}$/, 'Udyam numbers look like UDYAM-GJ-01-0012345.'),
    aadhaar_number: looksOff(v.aadhaar_number, /^\d{12}$/, 'Aadhaar numbers have 12 digits.'),
    pan_number: looksOff(v.pan_number, /^[A-Z]{5}\d{4}[A-Z]$/, 'PAN looks like ABCDE1234F.'),
    company_pan_number: looksOff(v.company_pan_number, /^[A-Z]{5}\d{4}[A-Z]$/, 'PAN looks like AABCR1234D.'),
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const er: Record<string, string> = {};
    const hasFiles = Object.values(files).some((list) => list.length > 0);
    if (!hasFiles && !Object.values(v).some((val) => val.trim())) er.form = 'The form is empty. Fill in at least one field or attach a document.';
    const tooBig = Object.values(files).flat().find((f) => f.size > MAX_MB * 1024 * 1024);
    if (tooBig) er.form = `${tooBig.name} is larger than ${MAX_MB} MB.`;
    setErrors(er);
    if (Object.keys(er).length) return;

    const body = new FormData();
    Object.entries(v).forEach(([k, val]) => body.append(k, val.trim()));
    Object.entries(files).forEach(([k, list]) => list.forEach((f) => body.append(k, f)));
    setSaving(true);
    try {
      const res = await api.post<{ message: string }>('/api/client-documents', body);
      showToast(res.message, 'success');
      onSubmitted();
      onClose();
    } catch (err) {
      setErrors({ form: err instanceof Error ? err.message : 'Could not submit the form' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open onClose={onClose} size="xl" closeOnOverlay={false} title="Client document form"
      description="Collect the client's details and documents. The Legal team reviews them on the Legal dashboard."
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" form="client-doc-form" loading={saving}>Submit to Legal</Button></>}>
      <form id="client-doc-form" onSubmit={submit} noValidate className="space-y-5">
        <p className="text-xs text-text-muted">Every field is optional. Fill in whatever you have.</p>
        <fieldset className="grid gap-4 sm:grid-cols-2">
          <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">Contact & company</legend>
          <Input label="Name" value={v.name} onChange={set('name')} />
          <Input label="Company name" value={v.company_name} onChange={set('company_name')} />
          <Input label="Email" type="text" inputMode="email" value={v.email} onChange={set('email')} hint={warn.email} />
          <Input label="Number" type="tel" value={v.phone} onChange={set('phone')} hint={warn.phone} placeholder="10-digit mobile" />
        </fieldset>
        <fieldset className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">Registration numbers</legend>
          <Input label="GST number" value={v.gst_number} onChange={set('gst_number')} hint={warn.gst_number} placeholder="24ABCDE1234F1Z5" />
          <Input label="MSME / Udyam number" value={v.msme_number} onChange={set('msme_number')} hint={warn.msme_number} placeholder="UDYAM-GJ-01-0012345" />
          <Input label="Aadhaar number" value={v.aadhaar_number} onChange={set('aadhaar_number')} hint={warn.aadhaar_number} placeholder="1234 5678 9012" />
          <Input label="PAN" value={v.pan_number} onChange={set('pan_number')} hint={warn.pan_number} placeholder="ABCDE1234F" />
          <Input label="Company PAN" value={v.company_pan_number} onChange={set('company_pan_number')} hint={warn.company_pan_number} placeholder="AABCR1234D" />
        </fieldset>
        <fieldset>
          <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">Documents (PDF, image, Word, Excel or PowerPoint, up to {MAX_MB} MB each)</legend>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {DOCUMENT_FIELDS.map(([key, label]) => <FileSlot key={key} label={label} files={files[key] ?? []} onChange={setSlot(key)} />)}
            <FileSlot label="Other documents" multiple files={files.other_documents ?? []} onChange={setSlot('other_documents')} />
          </div>
        </fieldset>
        <Textarea label="Note" rows={3} value={v.note} onChange={set('note')} placeholder="Anything the Legal team should know" />
        {errors.form && <p role="alert" className="text-sm text-danger">{errors.form}</p>}
      </form>
    </Modal>
  );
}

/** Employee dashboard card: the forms this user has submitted and their review status. */
export function MyDocumentForms({ reloadKey, onCreate }: { reloadKey: number; onCreate: () => void }) {
  const mine = useApi(() => api.get<{ items: DocumentSubmission[] }>('/api/client-documents/mine'), [reloadKey]);
  const items = mine.data?.items ?? [];
  return (
    <Card>
      <CardHeader title="Client document forms" description="Forms you sent to Legal" actions={<Button size="sm" variant="secondary" onClick={onCreate}><FilePlus2 size={14} /> Create form</Button>} />
      {items.length === 0 ? (
        <EmptyState compact icon={FolderOpen} title={mine.loading ? 'Loading…' : 'No forms yet'} description="Use Create form to collect a client's documents." />
      ) : (
        <ul className="divide-y divide-border">
          {items.slice(0, 6).map((s) => (
            <li key={s.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
              <span className="min-w-0">
                <span className="block truncate font-medium text-text">{s.company_name || s.name || s.email || 'Unnamed client'}</span>
                <span className="block text-xs text-text-muted">{s.reference} · {s.file_count} file{s.file_count === 1 ? '' : 's'} · {date(s.created_at.slice(0, 10))}</span>
              </span>
              <StatusBadge status={s.status} />
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
