import { useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Download, Gift, History, Pencil, Plus, Target, Trash2, Upload } from 'lucide-react';
import { saveBlob } from '../lib/api';
import { useApi, useDebounced } from '../lib/useApi';
import { date, todayISO } from '../lib/format';
import { isPhoneOk, PHONE_ERROR, phoneDigits, phoneInput } from '../lib/phone';
import { exportCsv, parseSpreadsheet } from '../lib/spreadsheet';
import { Badge, StatusBadge } from '../components/common/Badge';
import { Button } from '../components/common/Button';
import { Card } from '../components/common/Card';
import { useConfirm } from '../components/common/ConfirmDialog';
import { EmptyState } from '../components/common/EmptyState';
import { ErrorState } from '../components/common/ErrorState';
import { Checkbox, Input, SearchInput, Select, Textarea } from '../components/common/Input';
import { Modal } from '../components/common/Modal';
import { Table, type Column } from '../components/common/Table';
import { Tabs } from '../components/common/Tabs';
import { useToast } from '../components/common/ToastContext';
import { PageHeader } from '../components/layout/PageHeader';
import {
  assignees, attendance, deleteLead, deleteMaterial, deleteScheme, importLeads, kindLabel, LEAD_STATUSES, leadCalls, listLeads,
  listMaterials, listSchemes, MATERIAL_KINDS, materialFile, OUTCOMES, progress, saveLead, saveMaterial, saveScheme,
  type Assignee, type Lead, type Material, type Scheme,
} from './api';
import { AttendanceBoardCard, TeamProgressCard } from './SalesWidgets';
import { useLive } from './useLive';

const TABS = [
  { id: 'leads', label: 'Leads' }, { id: 'schemes', label: 'Schemes' }, { id: 'material', label: 'Company material' },
  { id: 'progress', label: 'Team progress' }, { id: 'attendance', label: 'Attendance board' },
];
const Toolbar = ({ children }: { children: React.ReactNode }) => <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">{children}</div>;
const errText = (err: unknown, fallback: string) => (err instanceof Error ? err.message : fallback);

// ---------------------------------------------------------------- leads
const EMPTY_LEAD = { name: '', company: '', phone: '', email: '', city: '', address: '', state: '', gstin: '', source: '', service_interest: '', notes: '', status: 'NEW', follow_up_date: '', assigned_user_id: '' };

function LeadModal({ lead, people, onClose, onSaved }: { lead: Lead | null; people: Assignee[]; onClose: () => void; onSaved: () => void }) {
  const { showToast } = useToast();
  const [v, setV] = useState(() => lead ? {
    name: lead.name, company: lead.company, phone: lead.phone, email: lead.email, city: lead.city,
    address: lead.address ?? '', state: lead.state ?? '', gstin: lead.gstin ?? '', source: lead.source,
    service_interest: lead.service_interest, notes: lead.notes, status: lead.status, follow_up_date: lead.follow_up_date ?? '',
    assigned_user_id: lead.assigned_to?.user_id ?? '',
  } : EMPTY_LEAD);
  const [saving, setSaving] = useState(false);
  const set = (k: keyof typeof EMPTY_LEAD) => (e: { target: { value: string } }) =>
    setV((s) => ({ ...s, [k]: k === 'phone' ? phoneDigits(e.target.value) : k === 'gstin' ? e.target.value.toUpperCase() : e.target.value }));
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!isPhoneOk(v.phone)) {
      showToast(`Phone: ${PHONE_ERROR}`, 'error');
      return;
    }
    setSaving(true);
    try {
      await saveLead(lead?.id ?? null, { ...v, assigned_user_id: v.assigned_user_id || null });
      showToast(lead ? 'Lead updated' : 'Lead added', 'success');
      onSaved();
      onClose();
    } catch (err) {
      showToast(errText(err, 'Could not save the lead'), 'error');
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal open onClose={onClose} size="lg" title={lead ? 'Edit lead' : 'Add lead'} closeOnOverlay={false}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" form="lead-form" loading={saving}>Save lead</Button></>}>
      <form id="lead-form" onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
        <Input label="Name" value={v.name} onChange={set('name')} />
        <Input label="Company" value={v.company} onChange={set('company')} />
        <Input label="Phone" {...phoneInput} value={v.phone} onChange={set('phone')} />
        <Input label="Email" value={v.email} onChange={set('email')} />
        <Input label="City" value={v.city} onChange={set('city')} />
        <Input label="State" value={v.state} onChange={set('state')} placeholder="e.g. Gujarat" />
        <Input label="Address" value={v.address} onChange={set('address')} />
        <Input label="GSTIN" value={v.gstin} onChange={set('gstin')} maxLength={15} />
        <Input label="Source" value={v.source} onChange={set('source')} placeholder="e.g. Website, referral, expo" />
        <Input label="Service interest" value={v.service_interest} onChange={set('service_interest')} placeholder="e.g. GST registration" className="sm:col-span-2" />
        <Select label="Assign to" value={v.assigned_user_id} onChange={set('assigned_user_id')}>
          <option value="">— Unassigned —</option>
          {people.map((p) => <option key={p.id} value={p.id}>{p.name} · {p.role_label}</option>)}
        </Select>
        <Select label="Status" value={v.status} onChange={set('status')}>{LEAD_STATUSES.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}</Select>
        <Input label="Follow-up date" type="date" value={v.follow_up_date} onChange={set('follow_up_date')} />
        <Textarea label="Notes" rows={2} value={v.notes} onChange={set('notes')} className="sm:col-span-2" />
      </form>
    </Modal>
  );
}

function CallHistory({ lead, onClose }: { lead: Lead; onClose: () => void }) {
  const calls = useApi(() => leadCalls(lead.id), [lead.id]);
  return (
    <Modal open onClose={onClose} title={`Call history · ${lead.name || lead.company}`}>
      {calls.status === 'error' ? <p className="text-danger">{calls.error}</p> : !calls.data ? <p>Loading…</p> : calls.data.items.length === 0 ? <p>No calls logged yet.</p> : (
        <ul className="space-y-3">
          {calls.data.items.map((c, i) => (
            <li key={i} className="rounded-md border border-border p-3">
              <p className="flex items-center justify-between gap-2 text-sm"><span className="font-medium text-text">{OUTCOMES.find(([k]) => k === c.outcome)?.[1] ?? c.outcome}</span><span className="text-xs text-text-muted">{c.name} · {date(c.at.slice(0, 10))}</span></p>
              {c.note && <p className="mt-1 text-xs text-text-secondary">{c.note}</p>}
              {c.follow_up_date && <p className="mt-1 text-xs text-warning">Follow up {date(c.follow_up_date)}</p>}
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

function ImportLeads({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { showToast } = useToast();
  const [rows, setRows] = useState<Record<string, unknown>[] | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const run = async () => {
    if (!rows) return;
    setBusy(true);
    try {
      const res = await importLeads(rows);
      setResult(res.message + (res.errors.length ? ` ${res.errors.slice(0, 5).map((e) => `Row ${e.row}: ${e.error}`).join(' ')}` : ''));
      if (res.imported) onDone();
    } catch (err) {
      showToast(errText(err, 'Import failed'), 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open onClose={onClose} title="Import leads" description="Excel or CSV. Columns: Name, Company, Phone, Email, City, Source, Service, Notes, Assigned To (the user's email). Phone numbers already in the list are skipped."
      footer={result ? <Button onClick={onClose}>Done</Button> : <><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={run} loading={busy} disabled={!rows}>Import {rows?.length ?? ''}</Button></>}>
      <label className="flex cursor-pointer flex-col items-center gap-1 rounded-lg border border-dashed border-border px-4 py-6 text-center hover:bg-neutral-bg">
        <Upload size={18} className="text-text-muted" />
        <span className="text-sm font-medium text-text">{name || 'Choose a .xlsx, .xls or .csv file'}</span>
        {rows && <span className="text-xs text-text-muted">{rows.length} row(s) ready</span>}
        <input type="file" accept=".xlsx,.xls,.csv" className="sr-only" onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (!f) return;
          try { setRows(await parseSpreadsheet(f)); setName(f.name); } catch (err) { showToast(errText(err, 'Could not read the file'), 'error'); }
        }} />
      </label>
      {result && <p className="mt-3 text-sm text-text">{result}</p>}
    </Modal>
  );
}

function LeadsTab() {
  const { showToast } = useToast();
  const confirm = useConfirm();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [assigned, setAssigned] = useState('');
  const q = useDebounced(search);
  const list = useApi(() => listLeads({ search: q, status, assigned }), [q, status, assigned]);
  const people = useApi(assignees);
  const [editing, setEditing] = useState<Lead | 'new' | null>(null);
  const [history, setHistory] = useState<Lead | null>(null);
  const [importing, setImporting] = useState(false);
  const users = people.data?.users ?? [];

  const reassign = async (l: Lead, userId: string) => {
    try {
      await saveLead(l.id, { ...l, follow_up_date: l.follow_up_date ?? '', assigned_user_id: userId || null });
      showToast(userId ? `Assigned to ${users.find((u) => u.id === userId)?.name}` : 'Unassigned', 'success');
      list.reload();
    } catch (err) {
      showToast(errText(err, 'Could not assign'), 'error');
    }
  };
  const remove = async (l: Lead) => {
    if (!(await confirm({ title: `Delete ${l.name || l.company}?`, message: 'The lead and its place in reports are removed.', confirmText: 'Delete lead', tone: 'danger' }))) return;
    try { await deleteLead(l.id); showToast('Lead deleted', 'success'); list.reload(); } catch (err) { showToast(errText(err, 'Could not delete'), 'error'); }
  };

  const columns: Column<Lead>[] = [
    { key: 'name', header: 'Lead', sortValue: (l) => (l.name || l.company).toLowerCase(), render: (l) => <span><span className="block font-medium text-text">{l.name || l.company || '—'}</span><span className="block text-xs text-text-muted">{[l.name ? l.company : '', l.city].filter(Boolean).join(' · ')}</span></span> },
    { key: 'phone', header: 'Phone', render: (l) => l.phone || '—' },
    { key: 'service', header: 'Service', render: (l) => l.service_interest || '—' },
    { key: 'status', header: 'Status', sortValue: (l) => l.status, render: (l) => <StatusBadge status={l.status} /> },
    {
      key: 'assigned', header: 'Assigned to', render: (l) => (
        <Select aria-label={`Assign ${l.name || l.company}`} value={l.assigned_to?.user_id ?? ''} onChange={(e) => reassign(l, e.target.value)} selectClassName="w-44" onClick={(e) => e.stopPropagation()}>
          <option value="">— Unassigned —</option>{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </Select>
      ),
    },
    { key: 'follow', header: 'Follow-up', sortValue: (l) => l.follow_up_date ?? '', render: (l) => (l.follow_up_date ? date(l.follow_up_date) : '—') },
    { key: 'calls', header: 'Calls', align: 'right', sortValue: (l) => l.call_count ?? 0, render: (l) => l.call_count ?? 0 },
    {
      key: 'actions', header: <span className="sr-only">Actions</span>, align: 'right', render: (l) => (
        <span className="flex justify-end gap-1">
          <Button size="icon" variant="ghost" aria-label="Call history" onClick={() => setHistory(l)}><History size={15} /></Button>
          <Button size="icon" variant="ghost" aria-label="Edit lead" onClick={() => setEditing(l)}><Pencil size={15} /></Button>
          <Button size="icon" variant="ghost" aria-label="Delete lead" onClick={() => remove(l)}><Trash2 size={15} /></Button>
        </span>
      ),
    },
  ];

  return (
    <Card>
      <Toolbar>
        <SearchInput value={search} onChange={setSearch} placeholder="Search name, company, phone…" label="Search leads" />
        <Select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)} selectClassName="w-40"><option value="">All statuses</option>{LEAD_STATUSES.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}</Select>
        <Select aria-label="Assigned to" value={assigned} onChange={(e) => setAssigned(e.target.value)} selectClassName="w-44"><option value="">Everyone</option><option value="unassigned">Unassigned</option>{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select>
        <span className="ml-auto flex gap-2">
          <Button variant="secondary" onClick={() => setImporting(true)}><Upload size={15} /> Import</Button>
          <Button onClick={() => setEditing('new')}><Plus size={15} /> Add lead</Button>
        </span>
      </Toolbar>
      {list.status === 'error' ? <ErrorState onRetry={list.reload} message={list.error} /> : (
        <Table caption="Leads" columns={columns} rows={list.data?.items ?? []} rowKey={(l) => l.id} loading={list.loading}
          empty={<EmptyState icon={Target} title="No leads" description="Add leads or import a spreadsheet, then assign them to sales staff to call." />} />
      )}
      {editing && <LeadModal lead={editing === 'new' ? null : editing} people={users} onClose={() => setEditing(null)} onSaved={list.reload} />}
      {history && <CallHistory lead={history} onClose={() => setHistory(null)} />}
      {importing && <ImportLeads onClose={() => setImporting(false)} onDone={list.reload} />}
    </Card>
  );
}

// ---------------------------------------------------------------- schemes
function SchemeModal({ scheme, onClose, onSaved }: { scheme: Scheme | null; onClose: () => void; onSaved: () => void }) {
  const { showToast } = useToast();
  const [v, setV] = useState({ title: scheme?.title ?? '', description: scheme?.description ?? '', valid_from: scheme?.valid_from ?? '', valid_to: scheme?.valid_to ?? '', active: scheme?.active ?? true });
  const [saving, setSaving] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await saveScheme(scheme?.id ?? null, { ...v, valid_from: v.valid_from || null, valid_to: v.valid_to || null });
      showToast('Scheme saved', 'success');
      onSaved();
      onClose();
    } catch (err) {
      showToast(errText(err, 'Could not save'), 'error');
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal open onClose={onClose} title={scheme ? 'Edit scheme' : 'Add scheme'}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" form="scheme-form" loading={saving}>Save</Button></>}>
      <form id="scheme-form" onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
        <Input label="Title" required value={v.title} onChange={(e) => setV((s) => ({ ...s, title: e.target.value }))} className="sm:col-span-2" />
        <Textarea label="Details" rows={4} value={v.description} onChange={(e) => setV((s) => ({ ...s, description: e.target.value }))} className="sm:col-span-2" />
        <Input label="Valid from" type="date" value={v.valid_from} onChange={(e) => setV((s) => ({ ...s, valid_from: e.target.value }))} />
        <Input label="Valid to" type="date" value={v.valid_to} onChange={(e) => setV((s) => ({ ...s, valid_to: e.target.value }))} />
        <Checkbox label="Show to sales staff" checked={v.active} onChange={(e) => setV((s) => ({ ...s, active: e.target.checked }))} />
      </form>
    </Modal>
  );
}

function SchemesTab() {
  const { showToast } = useToast();
  const confirm = useConfirm();
  const list = useApi(listSchemes);
  const [editing, setEditing] = useState<Scheme | 'new' | null>(null);
  const today = todayISO();
  const columns: Column<Scheme>[] = [
    { key: 'title', header: 'Scheme', render: (s) => <span><span className="block font-medium text-text">{s.title}</span><span className="line-clamp-1 block text-xs text-text-muted">{s.description}</span></span> },
    { key: 'valid', header: 'Valid', render: (s) => `${s.valid_from ? date(s.valid_from) : 'Now'} – ${s.valid_to ? date(s.valid_to) : 'open'}` },
    { key: 'state', header: 'Shown', render: (s) => (s.active && (!s.valid_to || s.valid_to >= today) ? <Badge tone="success" dot>Live</Badge> : <Badge>Hidden / expired</Badge>) },
    {
      key: 'actions', header: <span className="sr-only">Actions</span>, align: 'right', render: (s) => (
        <span className="flex justify-end gap-1">
          <Button size="icon" variant="ghost" aria-label="Edit scheme" onClick={() => setEditing(s)}><Pencil size={15} /></Button>
          <Button size="icon" variant="ghost" aria-label="Delete scheme" onClick={async () => {
            if (!(await confirm({ title: `Delete ${s.title}?`, message: 'Sales staff will no longer see it.', confirmText: 'Delete', tone: 'danger' }))) return;
            try { await deleteScheme(s.id); list.reload(); } catch (err) { showToast(errText(err, 'Could not delete'), 'error'); }
          }}><Trash2 size={15} /></Button>
        </span>
      ),
    },
  ];
  return (
    <Card>
      <Toolbar><span className="ml-auto"><Button onClick={() => setEditing('new')}><Plus size={15} /> Add scheme</Button></span></Toolbar>
      {list.status === 'error' ? <ErrorState onRetry={list.reload} message={list.error} /> : (
        <Table caption="Schemes" columns={columns} rows={list.data?.items ?? []} rowKey={(s) => s.id} loading={list.loading}
          empty={<EmptyState icon={Gift} title="No schemes" description="Offers you add here show on every sales dashboard." />} />
      )}
      {editing && <SchemeModal scheme={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={list.reload} />}
    </Card>
  );
}

// ---------------------------------------------------------------- material
function MaterialModal({ material, onClose, onSaved }: { material: Material | null; onClose: () => void; onSaved: () => void }) {
  const { showToast } = useToast();
  const [v, setV] = useState({ title: material?.title ?? '', kind: material?.kind ?? 'FLYER', description: material?.description ?? '', link: material?.link ?? '', active: material?.active ?? true });
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const form = new FormData();
    Object.entries(v).forEach(([k, val]) => form.append(k, String(val)));
    if (file) form.append('file', file);
    setSaving(true);
    try {
      await saveMaterial(material?.id ?? null, form);
      showToast('Material saved', 'success');
      onSaved();
      onClose();
    } catch (err) {
      showToast(errText(err, 'Could not save'), 'error');
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal open onClose={onClose} size="lg" title={material ? 'Edit material' : 'Add company material'}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" form="material-form" loading={saving}>Save</Button></>}>
      <form id="material-form" onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
        <Input label="Title" required value={v.title} onChange={(e) => setV((s) => ({ ...s, title: e.target.value }))} />
        <Select label="Type" value={v.kind} onChange={(e) => setV((s) => ({ ...s, kind: e.target.value }))}>{MATERIAL_KINDS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</Select>
        <Textarea label={v.kind === 'SALES_INFO' ? 'Sales information' : 'Description'} rows={v.kind === 'SALES_INFO' ? 6 : 3} value={v.description}
          onChange={(e) => setV((s) => ({ ...s, description: e.target.value }))} className="sm:col-span-2" placeholder={v.kind === 'SALES_INFO' ? 'Prices, talking points, FAQs…' : ''} />
        <Input label="Link (optional)" value={v.link} onChange={(e) => setV((s) => ({ ...s, link: e.target.value }))} placeholder="https://…" />
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-text">File {material?.has_file ? '(replace)' : '(optional)'}</span>
          <input type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,.gif,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.mp4" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="text-xs text-text-secondary" />
          <span className="text-xs text-text-muted">{file?.name || material?.filename || 'PDF, image, video, Word, Excel or PowerPoint up to 10 MB'}</span>
        </label>
        <Checkbox label="Show to sales staff" checked={v.active} onChange={(e) => setV((s) => ({ ...s, active: e.target.checked }))} />
      </form>
    </Modal>
  );
}

function MaterialTab() {
  const { showToast } = useToast();
  const confirm = useConfirm();
  const list = useApi(listMaterials);
  const [editing, setEditing] = useState<Material | 'new' | null>(null);
  const columns: Column<Material>[] = [
    { key: 'title', header: 'Material', render: (m) => <span><span className="block font-medium text-text">{m.title}</span><span className="line-clamp-1 block text-xs text-text-muted">{m.description}</span></span> },
    { key: 'kind', header: 'Type', render: (m) => kindLabel(m.kind) },
    { key: 'file', header: 'File / link', render: (m) => (
      <span className="flex flex-wrap gap-2 text-xs">
        {m.has_file && <button type="button" className="inline-flex items-center gap-1 text-primary hover:underline" onClick={async () => { try { saveBlob(await materialFile(m.id), m.filename || m.title); } catch (err) { showToast(errText(err, 'Download failed'), 'error'); } }}><Download size={12} /> {m.filename}</button>}
        {m.link && <a className="text-primary hover:underline" href={m.link} target="_blank" rel="noopener noreferrer">Open link</a>}
        {!m.has_file && !m.link && <span className="text-text-muted">Text only</span>}
      </span>
    ) },
    { key: 'state', header: 'Shown', render: (m) => (m.active ? <Badge tone="success" dot>Live</Badge> : <Badge>Hidden</Badge>) },
    {
      key: 'actions', header: <span className="sr-only">Actions</span>, align: 'right', render: (m) => (
        <span className="flex justify-end gap-1">
          <Button size="icon" variant="ghost" aria-label="Edit material" onClick={() => setEditing(m)}><Pencil size={15} /></Button>
          <Button size="icon" variant="ghost" aria-label="Delete material" onClick={async () => {
            if (!(await confirm({ title: `Delete ${m.title}?`, message: 'The file is removed too.', confirmText: 'Delete', tone: 'danger' }))) return;
            try { await deleteMaterial(m.id); list.reload(); } catch (err) { showToast(errText(err, 'Could not delete'), 'error'); }
          }}><Trash2 size={15} /></Button>
        </span>
      ),
    },
  ];
  return (
    <Card>
      <Toolbar><span className="ml-auto"><Button onClick={() => setEditing('new')}><Plus size={15} /> Add material</Button></span></Toolbar>
      {list.status === 'error' ? <ErrorState onRetry={list.reload} message={list.error} /> : (
        <Table caption="Company material" columns={columns} rows={list.data?.items ?? []} rowKey={(m) => m.id} loading={list.loading}
          empty={<EmptyState icon={Upload} title="No material yet" description="Upload posts, flyers, PDFs or write sales information for the team." />} />
      )}
      {editing && <MaterialModal material={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={list.reload} />}
    </Card>
  );
}

// ---------------------------------------------------------------- progress & attendance
const monthStart = () => `${todayISO().slice(0, 8)}01`;
const weekStart = () => { const d = new Date(); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d.toLocaleDateString('en-CA'); };

function ProgressTab() {
  const [range, setRange] = useState<[string, string]>([todayISO(), todayISO()]);
  const data = useApi(() => progress(range[0], range[1]), [range[0], range[1]]);
  useLive(data.reload);
  const presets: [string, () => [string, string]][] = [['Today', () => [todayISO(), todayISO()]], ['This week', () => [weekStart(), todayISO()]], ['This month', () => [monthStart(), todayISO()]]];
  return (
    <div className="space-y-3">
      <Card>
        <Toolbar>
          {presets.map(([label, get]) => <Button key={label} size="sm" variant="secondary" onClick={() => setRange(get())}>{label}</Button>)}
          <Input aria-label="From" type="date" value={range[0]} max={range[1]} onChange={(e) => setRange(([, t]) => [e.target.value, t])} inputClassName="w-40" />
          <Input aria-label="To" type="date" value={range[1]} min={range[0]} onChange={(e) => setRange(([f]) => [f, e.target.value])} inputClassName="w-40" />
          <span className="ml-auto"><Button variant="secondary" disabled={!data.data?.rows.length} onClick={() => exportCsv((data.data?.rows ?? []).map((r) => ({
            Employee: r.name, Email: r.email, Calls: r.calls, Connected: r.connected, Interested: r.interested, Converted: r.converted,
            'Leads assigned': r.leads_assigned, 'Open leads': r.leads_open, 'Follow-ups due': r.follow_ups_due,
          })), `Sales_progress_${range[0]}_to_${range[1]}.csv`)}><Download size={15} /> Export CSV</Button></span>
        </Toolbar>
      </Card>
      {data.status === 'error' ? <Card><ErrorState onRetry={data.reload} message={data.error} /></Card>
        : <TeamProgressCard rows={data.data?.rows ?? []} description={range[0] === range[1] ? date(range[0]) : `${date(range[0])} – ${date(range[1])}`} />}
    </div>
  );
}

function AttendanceTab() {
  const [day, setDay] = useState(todayISO());
  const data = useApi(() => attendance(day), [day]);
  useLive(data.reload);
  return (
    <div className="space-y-3">
      <Card><Toolbar><Input label="Date" type="date" max={todayISO()} value={day} onChange={(e) => setDay(e.target.value || todayISO())} inputClassName="w-44" /></Toolbar></Card>
      {data.status === 'error' ? <Card><ErrorState onRetry={data.reload} message={data.error} /></Card>
        : <AttendanceBoardCard rows={data.data?.board ?? []} live={day === todayISO()} description={day === todayISO() ? undefined : date(day)} />}
    </div>
  );
}

export function SalesHub() {
  const [params, setParams] = useSearchParams();
  const tab = TABS.some((t) => t.id === params.get('tab')) ? params.get('tab')! : 'leads';
  return (
    <>
      <PageHeader title="Sales workspace" description="Leads to call, schemes, company material, the team's progress and attendance. Sales staff see these on their dashboard."
        breadcrumbs={[{ label: 'Sales' }, { label: 'Sales workspace' }]} />
      <Tabs tabs={TABS} active={tab} onChange={(id) => setParams(id === 'leads' ? {} : { tab: id }, { replace: true })} className="mb-4" />
      {tab === 'leads' && <LeadsTab />}
      {tab === 'schemes' && <SchemesTab />}
      {tab === 'material' && <MaterialTab />}
      {tab === 'progress' && <ProgressTab />}
      {tab === 'attendance' && <AttendanceTab />}
    </>
  );
}
