import { useState, type ReactNode, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import {
  CalendarClock, Check, Copy, Download, ExternalLink, Eye, FileText, Gift,
  Image as ImageIcon, Info, LogIn, LogOut, Phone, PhoneCall, PhoneForwarded,
  Plus, Radio, SkipForward, Sparkles, Trash2, Trophy, Users, Video,
} from 'lucide-react';
import { saveBlob } from '../lib/api';
import { date, number, todayISO } from '../lib/format';
import { Badge, StatusBadge, type BadgeTone } from '../components/common/Badge';
import { Button } from '../components/common/Button';
import { Card, CardHeader } from '../components/common/Card';
import { EmptyState } from '../components/common/EmptyState';
import { Checkbox, Input, SearchInput, Select, Textarea } from '../components/common/Input';
import { Modal } from '../components/common/Modal';
import { useToast } from '../components/common/ToastContext';
import { useConfirm } from '../components/common/ConfirmDialog';
import {
  clock, deleteMaterial, deleteScheme, endDay, kindLabel, LEAD_STATUSES, logCall,
  materialFile, OUTCOMES, saveLead, saveMaterial, saveScheme, startDay,
  type AttendanceRow, type DaySession, type Lead, type Material, type ProgressRow, type Scheme,
} from './api';

const OPEN = new Set(['NEW', 'ATTEMPTED', 'CALL_BACK', 'INTERESTED']);
const dayTone: Record<string, BadgeTone> = { WORKING: 'success', DAY_ENDED: 'neutral', NOT_STARTED: 'warning' };
const dayLabel: Record<string, string> = { WORKING: 'Working', DAY_ENDED: 'Day ended', NOT_STARTED: 'Not started' };
const telHref = (phone: string) => `tel:${phone.replace(/[^\d+]/g, '')}`;
const kindIcon = (k: string) => {
  if (k === 'POST' || k === 'FLYER') return ImageIcon;
  if (k === 'VIDEO') return Video;
  if (k === 'SALES_INFO') return Info;
  return FileText;
};

// ---------------------------------------------------------------- start / end your day
export function DayCard({ session, onChange }: { session: DaySession | null; onChange: () => void }) {
  const { showToast } = useToast();
  const [busy, setBusy] = useState(false);
  const working = !!session && !session.ended_at;
  const act = async () => {
    setBusy(true);
    try {
      await (working ? endDay() : startDay());
      showToast(working ? 'Day ended. See you tomorrow!' : 'Your day has started. Good luck!', 'success');
      onChange();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not update your day', 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card className="flex flex-col justify-between p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-text">{working ? 'Your day is running' : session ? 'Your day has ended' : 'Start your day'}</p>
          <p className="mt-1 text-xs text-text-muted">
            {session ? <>Started {clock(session.started_at)}{session.ended_at ? ` · ended ${clock(session.ended_at)}` : ''}</> : 'Tap start when you begin work. It shows on the attendance board.'}
          </p>
        </div>
        <Badge tone={working ? 'success' : session ? 'neutral' : 'warning'} dot>{working ? 'Working' : session ? 'Day ended' : 'Not started'}</Badge>
      </div>
      <Button className="mt-4 w-full" variant={working ? 'secondary' : 'primary'} onClick={act} loading={busy}>
        {working ? <><LogOut size={15} /> End day</> : <><LogIn size={15} /> {session ? 'Resume day' : 'Start your day'}</>}
      </Button>
    </Card>
  );
}

// ---------------------------------------------------------------- dialer
export function DialerModal({ leads, onClose, onLogged }: { leads: Lead[]; onClose: () => void; onLogged: () => void }) {
  const { showToast } = useToast();
  const [index, setIndex] = useState(0);
  const [outcome, setOutcome] = useState('');
  const [note, setNote] = useState('');
  const [followUp, setFollowUp] = useState('');
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(0);
  const lead = leads[index];

  const next = (loggedNow = false) => {
    const logged = done + (loggedNow ? 1 : 0);
    setOutcome('');
    setNote('');
    setFollowUp('');
    if (index + 1 >= leads.length) {
      showToast(`Dialer finished: ${logged} call(s) logged`, 'success');
      onClose();
    } else setIndex((i) => i + 1);
  };

  const save = async () => {
    if (!outcome) {
      showToast('Choose how the call went.', 'error');
      return;
    }
    setSaving(true);
    try {
      await logCall(lead.id, { outcome, note, follow_up_date: followUp || undefined });
      setDone((n) => n + 1);
      onLogged();
      next(true);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not save the call', 'error');
    } finally {
      setSaving(false);
    }
  };

  if (!lead) return null;
  return (
    <Modal open onClose={onClose} size="lg" closeOnOverlay={false} title={`Dialer · lead ${index + 1} of ${leads.length}`}
      description="Call the lead, then record how it went. Each call is saved as a CRM entry on the lead."
      footer={<><Button variant="ghost" onClick={() => next()}><SkipForward size={15} /> Skip</Button><Button onClick={save} loading={saving}>Save & next</Button></>}>
      <div className="space-y-4">
        <div className="rounded-lg border border-border bg-surface-secondary p-4">
          <p className="text-base font-semibold text-text">{lead.name || lead.company || 'Lead'}</p>
          <p className="text-sm text-text-muted">{[lead.company && lead.name ? lead.company : '', lead.city, lead.service_interest].filter(Boolean).join(' · ') || '—'}</p>
          {lead.last_outcome && <p className="mt-2 text-xs text-text-muted">Last call: {OUTCOMES.find(([k]) => k === lead.last_outcome)?.[1]}{lead.last_note ? ` — “${lead.last_note}”` : ''}</p>}
          {lead.notes && <p className="mt-1 text-xs text-text-secondary">Notes: {lead.notes}</p>}
          {lead.phone ? (
            <a href={telHref(lead.phone)} className="mt-3 inline-flex h-10 items-center gap-2 rounded-md bg-success px-4 text-sm font-semibold text-white hover:opacity-90">
              <PhoneCall size={16} /> Call {lead.phone}
            </a>
          ) : <p className="mt-3 text-sm text-warning">No phone number on this lead.</p>}
        </div>
        <fieldset>
          <legend className="mb-2 text-sm font-medium text-text">How did the call go?</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {OUTCOMES.map(([id, label]) => (
              <label key={id} className={`flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm ${outcome === id ? 'border-primary bg-primary-soft text-text' : 'border-border text-text-secondary hover:bg-neutral-bg'}`}>
                <input type="radio" name="outcome" value={id} checked={outcome === id} onChange={() => setOutcome(id)} className="accent-[var(--color-primary)]" /> {label}
              </label>
            ))}
          </div>
        </fieldset>
        {(outcome === 'CALL_BACK' || outcome === 'INTERESTED') && (
          <Input label="Follow-up date" type="date" min={todayISO()} value={followUp} onChange={(e) => setFollowUp(e.target.value)} />
        )}
        <Textarea label="Note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What was discussed?" />
      </div>
    </Modal>
  );
}

export function QuickLeadModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { showToast } = useToast();
  const [saving, setSaving] = useState(false);
  const [v, setV] = useState({
    name: '', company: '', phone: '', email: '', city: '', source: 'CRM Entry',
    service_interest: '', status: 'NEW', follow_up_date: '', notes: '',
  });
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setV((prev) => ({ ...prev, [k]: e.target.value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!v.name && !v.company && !v.phone) {
      showToast('Enter at least a name, company, or phone number', 'error');
      return;
    }
    setSaving(true);
    try {
      await saveLead(null, v);
      showToast('CRM Lead successfully added', 'success');
      onSaved();
      onClose();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not save lead', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open onClose={onClose} size="lg" title="New CRM Lead / Client Entry" closeOnOverlay={false}
      description="Add a new client lead to your call list and CRM pipeline."
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" form="quick-lead-form" loading={saving}>Save Lead</Button></>}>
      <form id="quick-lead-form" onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
        <Input label="Client Name" value={v.name} onChange={set('name')} placeholder="Full name" />
        <Input label="Company Name" value={v.company} onChange={set('company')} placeholder="Company / Org" />
        <Input label="Phone Number *" type="tel" value={v.phone} onChange={set('phone')} placeholder="+91 98765 43210" required />
        <Input label="Email" type="email" value={v.email} onChange={set('email')} placeholder="name@client.com" />
        <Input label="City" value={v.city} onChange={set('city')} placeholder="City" />
        <Input label="Lead Source" value={v.source} onChange={set('source')} placeholder="e.g. Inbound, Website, Direct" />
        <Input label="Service / Product Interest" value={v.service_interest} onChange={set('service_interest')} placeholder="e.g. Legal, HR, Compliance" className="sm:col-span-2" />
        <Select label="Initial Status" value={v.status} onChange={set('status')}>
          {LEAD_STATUSES.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
        </Select>
        <Input label="Follow-up Date" type="date" min={todayISO()} value={v.follow_up_date} onChange={set('follow_up_date')} />
        <Textarea label="Notes & Requirement Details" rows={3} value={v.notes} onChange={set('notes')} placeholder="Requirement summary, discussion notes..." className="sm:col-span-2" />
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------- Quick Scheme Modal
export function QuickSchemeModal({ scheme, onClose, onSaved }: { scheme?: Scheme | null; onClose: () => void; onSaved: () => void }) {
  const { showToast } = useToast();
  const [v, setV] = useState({
    title: scheme?.title ?? '',
    description: scheme?.description ?? '',
    valid_from: scheme?.valid_from ?? '',
    valid_to: scheme?.valid_to ?? '',
    active: scheme?.active ?? true,
  });
  const [saving, setSaving] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!v.title.trim()) {
      showToast('Please enter a scheme title', 'error');
      return;
    }
    setSaving(true);
    try {
      await saveScheme(scheme?.id ?? null, { ...v, valid_from: v.valid_from || null, valid_to: v.valid_to || null });
      showToast(scheme ? 'Scheme updated successfully' : 'New scheme added to Sales Dashboard', 'success');
      onSaved();
      onClose();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not save scheme', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open onClose={onClose} size="lg" title={scheme ? 'Edit Sales Scheme' : 'Add New Sales Scheme / Offer'} closeOnOverlay={false}
      description="Create a client discount, promotional offer, or seasonal bundle."
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" form="quick-scheme-form" loading={saving}>{scheme ? 'Update Scheme' : 'Add Scheme'}</Button></>}>
      <form id="quick-scheme-form" onSubmit={submit} className="space-y-4">
        <Input label="Scheme / Offer Title *" required value={v.title} onChange={(e) => setV((s) => ({ ...s, title: e.target.value }))} placeholder="e.g. 20% Off Corporate Retainer or Festive Bundle" />
        <Textarea label="Offer Details & Terms *" required rows={4} value={v.description} onChange={(e) => setV((s) => ({ ...s, description: e.target.value }))} placeholder="Terms of offer, eligibility criteria, talking pitch, discount mechanics..." />
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Valid From" type="date" value={v.valid_from} onChange={(e) => setV((s) => ({ ...s, valid_from: e.target.value }))} />
          <Input label="Valid To (Expiry Date)" type="date" value={v.valid_to} onChange={(e) => setV((s) => ({ ...s, valid_to: e.target.value }))} />
        </div>
        <Checkbox label="Make active and show immediately on Sales Dashboard" checked={v.active} onChange={(e) => setV((s) => ({ ...s, active: e.target.checked }))} />
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------- Quick Flyer / Post Modal
export function QuickFlyerPostModal({ material, onClose, onSaved }: { material?: Material | null; onClose: () => void; onSaved: () => void }) {
  const { showToast } = useToast();
  const [v, setV] = useState({
    title: material?.title ?? '',
    kind: material?.kind && material.kind !== 'SALES_INFO' ? material.kind : 'FLYER',
    description: material?.description ?? '',
    link: material?.link ?? '',
    active: material?.active ?? true,
  });
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);

  const allowedKinds: [string, string][] = [
    ['FLYER', 'Marketing Flyer'],
    ['POST', 'Social Media Post / Banner'],
    ['PDF', 'PDF Brochure / Document'],
    ['VIDEO', 'Video / Demo'],
    ['OTHER', 'Other Promotional Material'],
  ];

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!v.title.trim()) {
      showToast('Please enter a title for the flyer or post', 'error');
      return;
    }
    const form = new FormData();
    Object.entries(v).forEach(([k, val]) => form.append(k, String(val)));
    if (file) form.append('file', file);
    setSaving(true);
    try {
      await saveMaterial(material?.id ?? null, form);
      showToast(material ? 'Material updated' : 'Flyer / Post published to Sales Dashboard', 'success');
      onSaved();
      onClose();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not save flyer/post', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open onClose={onClose} size="lg" title={material ? 'Edit Flyer / Post' : 'Add New Flyer or Social Post'} closeOnOverlay={false}
      description="Upload promotional flyers, banners, social posts or client brochures for the sales team."
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" form="quick-flyer-form" loading={saving}>{material ? 'Save Changes' : 'Upload Flyer / Post'}</Button></>}>
      <form id="quick-flyer-form" onSubmit={submit} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Flyer / Post Title *" required value={v.title} onChange={(e) => setV((s) => ({ ...s, title: e.target.value }))} placeholder="e.g. Summer Business Launch Flyer" />
          <Select label="Material Type" value={v.kind} onChange={(e) => setV((s) => ({ ...s, kind: e.target.value }))}>
            {allowedKinds.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          </Select>
        </div>
        <Textarea label="Caption / Description" rows={3} value={v.description} onChange={(e) => setV((s) => ({ ...s, description: e.target.value }))} placeholder="Social media caption, hashtags, instructions for sharing with clients..." />
        <Input label="External Link / Drive Link (Optional)" value={v.link} onChange={(e) => setV((s) => ({ ...s, link: e.target.value }))} placeholder="https://..." />
        <div className="rounded-lg border border-dashed border-border bg-surface-secondary p-4">
          <label className="flex cursor-pointer flex-col items-center gap-1 text-center">
            <ImageIcon size={22} className="text-primary" />
            <span className="text-sm font-medium text-text">Upload Image, PDF or Video File</span>
            <span className="text-xs text-text-muted">{file ? `Selected: ${file.name} (${(file.size / 1024).toFixed(0)} KB)` : material?.filename ? `Current file: ${material.filename} (click to replace)` : 'JPG, PNG, WEBP, PDF, MP4 up to 10 MB'}</span>
            <input type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,.gif,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.mp4" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="sr-only" />
          </label>
        </div>
        <Checkbox label="Show immediately to all sales staff" checked={v.active} onChange={(e) => setV((s) => ({ ...s, active: e.target.checked }))} />
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------- Quick Sales Info Modal
export function QuickSalesInfoModal({ material, onClose, onSaved }: { material?: Material | null; onClose: () => void; onSaved: () => void }) {
  const { showToast } = useToast();
  const [v, setV] = useState({
    title: material?.title ?? '',
    kind: 'SALES_INFO',
    description: material?.description ?? '',
    link: material?.link ?? '',
    active: material?.active ?? true,
  });
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!v.title.trim()) {
      showToast('Please enter an information title', 'error');
      return;
    }
    if (!v.description.trim() && !v.link && !file) {
      showToast('Please add the knowledge text, talking points, link, or file', 'error');
      return;
    }
    const form = new FormData();
    Object.entries(v).forEach(([k, val]) => form.append(k, String(val)));
    if (file) form.append('file', file);
    setSaving(true);
    try {
      await saveMaterial(material?.id ?? null, form);
      showToast(material ? 'Sales information updated' : 'Sales information added to Sales Dashboard', 'success');
      onSaved();
      onClose();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not save sales info', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open onClose={onClose} size="lg" title={material ? 'Edit Sales Information' : 'Add Sales Information / Knowledge'} closeOnOverlay={false}
      description="Add pricing packages, product knowledge, elevator pitches, FAQs, or objection handling scripts."
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" form="quick-info-form" loading={saving}>{material ? 'Save Changes' : 'Save Sales Information'}</Button></>}>
      <form id="quick-info-form" onSubmit={submit} className="space-y-4">
        <Input label="Topic / Header Title *" required value={v.title} onChange={(e) => setV((s) => ({ ...s, title: e.target.value }))} placeholder="e.g. GST Registration Pricing & Deliverables" />
        <Textarea label="Sales Information, Pitch Scripts & Talking Points *" required rows={6} value={v.description}
          onChange={(e) => setV((s) => ({ ...s, description: e.target.value }))} placeholder="Key selling points, standard pricing tiers, deliverables timeline, common customer objections & answers..." />
        <Input label="Knowledge Base / Documentation Link (Optional)" value={v.link} onChange={(e) => setV((s) => ({ ...s, link: e.target.value }))} placeholder="https://..." />
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-text">Attach Reference Sheet / PDF (Optional)</span>
          <input type="file" accept=".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.png,.jpg" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="text-xs text-text-secondary" />
          <span className="text-xs text-text-muted">{file?.name || material?.filename || 'Optional pricing matrix or sales deck'}</span>
        </label>
        <Checkbox label="Show immediately to all sales staff" checked={v.active} onChange={(e) => setV((s) => ({ ...s, active: e.target.checked }))} />
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------- leads to call
export function LeadsCard({
  leads,
  onChanged,
  onOpenDialer,
}: {
  leads: Lead[];
  onChanged: () => void;
  onOpenDialer?: (lead?: Lead) => void;
}) {
  const [dialer, setDialer] = useState<Lead[] | null>(null);
  const [addLeadOpen, setAddLeadOpen] = useState(false);
  const open = leads.filter((l) => OPEN.has(l.status));
  const today = todayISO();
  return (
    <Card>
      <CardHeader title="Your leads to call" description={`${open.length} open · ${leads.length} assigned to you`}
        actions={
          <div className="flex items-center gap-2">
            <Button size="sm" variant="secondary" onClick={() => setAddLeadOpen(true)}><Plus size={14} /> Add lead</Button>
            {open.length > 0 && (
              <Button
                size="sm"
                onClick={() => {
                  if (onOpenDialer) onOpenDialer();
                  else setDialer(open);
                }}
              >
                <PhoneForwarded size={14} /> Start dialer
              </Button>
            )}
          </div>
        } />
      {open.length === 0 ? (
        <EmptyState
          compact
          icon={Phone}
          title="No leads to call"
          description="Leads assigned to you or added via CRM will appear here."
          action={<Button size="sm" onClick={() => setAddLeadOpen(true)}><Plus size={14} /> Create first lead</Button>}
        />
      ) : (
        <ul className="max-h-[380px] divide-y divide-border overflow-y-auto">
          {open.map((l) => {
            const due = l.follow_up_date && l.follow_up_date <= today;
            return (
              <li key={l.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-text">{l.name || l.company}</span>
                  <span className="block truncate text-xs text-text-muted">{[l.name ? l.company : '', l.service_interest, l.city].filter(Boolean).join(' · ') || l.phone}</span>
                  {l.follow_up_date && <span className={`mt-0.5 block text-xs ${due ? 'font-medium text-warning' : 'text-text-muted'}`}><CalendarClock size={11} className="mr-1 inline" />Follow up {date(l.follow_up_date)}</span>}
                </span>
                <span className="flex items-center gap-2">
                  <StatusBadge status={l.status} />
                  {l.phone && <a href={telHref(l.phone)} aria-label={`Call ${l.name || l.company}`} className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border text-success hover:bg-neutral-bg"><Phone size={14} /></a>}
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      if (onOpenDialer) onOpenDialer(l);
                      else setDialer([l]);
                    }}
                  >
                    Log call
                  </Button>
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {dialer && <DialerModal leads={dialer} onClose={() => setDialer(null)} onLogged={onChanged} />}
      {addLeadOpen && <QuickLeadModal onClose={() => setAddLeadOpen(false)} onSaved={onChanged} />}
    </Card>
  );
}


// ---------------------------------------------------------------- 1. Schemes Box
/** canManage comes from the server (Admin, Legal, Super Admin); everyone else only views. */
export function SchemesCard({ schemes, onChanged, canManage = false }: { schemes: Scheme[]; onChanged?: () => void; canManage?: boolean }) {
  const { showToast } = useToast();
  const confirm = useConfirm();
  const [modalOpen, setModalOpen] = useState(false);
  const [editingScheme, setEditingScheme] = useState<Scheme | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const today = todayISO();

  const copyPitch = (s: Scheme) => {
    const text = `🎉 *Special Offer: ${s.title}*\n${s.description}${s.valid_to ? `\n⏳ Valid until: ${date(s.valid_to)}` : ''}`;
    navigator.clipboard.writeText(text);
    setCopiedId(s.id);
    showToast('Scheme offer details copied to clipboard!', 'success');
    setTimeout(() => setCopiedId(null), 2000);
  };

  const remove = async (s: Scheme) => {
    if (!(await confirm({ title: `Delete scheme "${s.title}"?`, message: 'This offer will be removed from all sales dashboards.', confirmText: 'Delete', tone: 'danger' }))) return;
    try {
      await deleteScheme(s.id);
      showToast('Scheme deleted', 'success');
      onChanged?.();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not delete', 'error');
    }
  };

  return (
    <Card className="flex flex-col h-full">
      <CardHeader
        title="Current Schemes & Offers"
        description={`${schemes.length} active client discount & bundle schemes`}
        actions={canManage && (
          <Button size="sm" onClick={() => { setEditingScheme(null); setModalOpen(true); }}>
            <Plus size={14} /> Add scheme
          </Button>
        )}
      />
      {schemes.length === 0 ? (
        <EmptyState
          compact
          icon={Gift}
          title="No active schemes"
          description={canManage ? 'Create client discount packages and seasonal incentives.' : 'New offers from your managers appear here, and in your notifications.'}
          action={canManage ? <Button size="sm" variant="secondary" onClick={() => { setEditingScheme(null); setModalOpen(true); }}><Plus size={14} /> Add first scheme</Button> : undefined}
        />
      ) : (
        <ul className="max-h-[360px] divide-y divide-border overflow-y-auto">
          {schemes.map((s) => {
            const isLive = s.active && (!s.valid_to || s.valid_to >= today);
            return (
              <li key={s.id} className="p-4 transition-colors hover:bg-surface-secondary/40">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <Gift size={15} className="text-primary shrink-0" />
                      <span className="font-semibold text-sm text-text truncate">{s.title}</span>
                      {isLive ? <Badge tone="success" dot>Live</Badge> : <Badge tone="neutral">Expired</Badge>}
                    </div>
                    {s.description && (
                      <p className="mt-1.5 whitespace-pre-line text-xs text-text-secondary line-clamp-3">
                        {s.description}
                      </p>
                    )}
                    <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-text-muted">
                      {(s.valid_from || s.valid_to) && (
                        <span>Valid: {s.valid_from ? date(s.valid_from) : 'Now'} – {s.valid_to ? date(s.valid_to) : 'until further notice'}</span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button size="sm" variant="ghost" onClick={() => copyPitch(s)} title="Copy offer pitch for client">
                      {copiedId === s.id ? <Check size={14} className="text-success" /> : <Copy size={14} />}
                      <span className="sr-only">Copy</span>
                    </Button>
                    {canManage && (
                      <>
                        <Button size="sm" variant="ghost" onClick={() => { setEditingScheme(s); setModalOpen(true); }} title="Edit scheme">
                          <Sparkles size={14} />
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => remove(s)} title="Delete scheme">
                          <Trash2 size={14} />
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {modalOpen && (
        <QuickSchemeModal
          scheme={editingScheme}
          onClose={() => { setModalOpen(false); setEditingScheme(null); }}
          onSaved={() => { onChanged?.(); }}
        />
      )}
    </Card>
  );
}

// ---------------------------------------------------------------- 2. Flyers & Posts Box
export function FlyersPostsCard({ materials, onChanged, canManage = false }: { materials: Material[]; onChanged?: () => void; canManage?: boolean }) {
  const { showToast } = useToast();
  const confirm = useConfirm();
  const [modalOpen, setModalOpen] = useState(false);
  const [previewItem, setPreviewItem] = useState<Material | null>(null);

  // Filter for marketing posts, flyers, brochures, videos (everything except raw SALES_INFO)
  const items = materials.filter((m) => m.kind !== 'SALES_INFO');

  const download = async (m: Material) => {
    try {
      saveBlob(await materialFile(m.id), m.filename || m.title);
      showToast(`Downloaded ${m.filename || m.title}`, 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Download failed', 'error');
    }
  };

  const remove = async (m: Material) => {
    if (!(await confirm({ title: `Delete "${m.title}"?`, message: 'This flyer/post file and description will be deleted.', confirmText: 'Delete', tone: 'danger' }))) return;
    try {
      await deleteMaterial(m.id);
      showToast('Material removed', 'success');
      onChanged?.();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not delete', 'error');
    }
  };

  return (
    <Card className="flex flex-col h-full">
      <CardHeader
        title="Flyers & Social Posts"
        description={`${items.length} marketing posters, social graphics & brochures`}
        actions={canManage && (
          <Button size="sm" onClick={() => setModalOpen(true)}>
            <Plus size={14} /> Add flyer / post
          </Button>
        )}
      />
      {items.length === 0 ? (
        <EmptyState
          compact
          icon={ImageIcon}
          title="No flyers or posts yet"
          description={canManage ? 'Upload marketing images, flyers and social media banners for your team.' : 'Flyers and posts shared with the team appear here.'}
          action={canManage ? <Button size="sm" variant="secondary" onClick={() => setModalOpen(true)}><Plus size={14} /> Add first flyer</Button> : undefined}
        />
      ) : (
        <ul className="max-h-[360px] divide-y divide-border overflow-y-auto">
          {items.map((m) => {
            const Icon = kindIcon(m.kind);
            return (
              <li key={m.id} className="p-3.5 transition-colors hover:bg-surface-secondary/40">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3 min-w-0 flex-1">
                    <div className="h-10 w-10 shrink-0 rounded-lg bg-primary-soft text-primary flex items-center justify-center">
                      <Icon size={18} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-sm text-text truncate">{m.title}</span>
                        <Badge tone="info">{kindLabel(m.kind)}</Badge>
                      </div>
                      {m.description && (
                        <p className="mt-1 text-xs text-text-secondary line-clamp-2">{m.description}</p>
                      )}
                      <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-text-muted">
                        {m.filename && <span className="truncate">📎 {m.filename}</span>}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {m.has_file && (
                      <Button size="sm" variant="secondary" onClick={() => setPreviewItem(m)} title="View / Preview">
                        <Eye size={14} /> View
                      </Button>
                    )}
                    {m.has_file && (
                      <Button size="sm" variant="ghost" onClick={() => download(m)} title="Download File">
                        <Download size={14} />
                      </Button>
                    )}
                    {m.link && (
                      <a href={m.link} target="_blank" rel="noopener noreferrer" className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border text-text-secondary hover:bg-neutral-bg" title="Open Link">
                        <ExternalLink size={14} />
                      </a>
                    )}
                    {canManage && (
                      <Button size="sm" variant="ghost" onClick={() => remove(m)} title="Delete">
                        <Trash2 size={14} />
                      </Button>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {modalOpen && (
        <QuickFlyerPostModal
          onClose={() => setModalOpen(false)}
          onSaved={() => { onChanged?.(); }}
        />
      )}
      {previewItem && (
        <Modal open onClose={() => setPreviewItem(null)} size="lg" title={previewItem.title} description={`${kindLabel(previewItem.kind)} · ${previewItem.filename || 'Material preview'}`}
          footer={<><Button variant="secondary" onClick={() => setPreviewItem(null)}>Close</Button>{previewItem.has_file && <Button onClick={() => download(previewItem)}><Download size={15} /> Download File</Button>}</>}>
          <div className="space-y-4">
            {previewItem.description && (
              <div className="rounded-lg bg-surface-secondary p-3 text-sm text-text whitespace-pre-line">
                {previewItem.description}
              </div>
            )}
            {previewItem.filename && (
              <div className="flex items-center justify-between rounded-lg border border-border p-3 text-sm">
                <span className="font-medium text-text flex items-center gap-2"><FileText size={16} className="text-primary" /> {previewItem.filename}</span>
                <Button size="sm" onClick={() => download(previewItem)}><Download size={14} /> Download</Button>
              </div>
            )}
            {previewItem.link && (
              <a href={previewItem.link} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline font-medium">
                <ExternalLink size={14} /> Open external link: {previewItem.link}
              </a>
            )}
          </div>
        </Modal>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------- 3. Sales Information Box
export function SalesInfoCard({ materials, onChanged, canManage = false }: { materials: Material[]; onChanged?: () => void; canManage?: boolean }) {
  const { showToast } = useToast();
  const confirm = useConfirm();
  const [modalOpen, setModalOpen] = useState(false);
  const [editingInfo, setEditingInfo] = useState<Material | null>(null);
  const [search, setSearch] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Filter for SALES_INFO
  const items = materials.filter((m) => m.kind === 'SALES_INFO');
  const filtered = items.filter((m) =>
    !search || m.title.toLowerCase().includes(search.toLowerCase()) || m.description.toLowerCase().includes(search.toLowerCase())
  );

  const copyScript = (m: Material) => {
    navigator.clipboard.writeText(`📌 *${m.title}*\n${m.description}`);
    setCopiedId(m.id);
    showToast('Sales information copied to clipboard!', 'success');
    setTimeout(() => setCopiedId(null), 2000);
  };

  const remove = async (m: Material) => {
    if (!(await confirm({ title: `Delete "${m.title}"?`, message: 'This sales knowledge entry will be removed.', confirmText: 'Delete', tone: 'danger' }))) return;
    try {
      await deleteMaterial(m.id);
      showToast('Sales info deleted', 'success');
      onChanged?.();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not delete', 'error');
    }
  };

  return (
    <Card className="flex flex-col h-full">
      <CardHeader
        title="Sales Information & FAQs"
        description={`${items.length} pricing sheets, pitches & product knowledge`}
        actions={canManage && (
          <Button size="sm" onClick={() => { setEditingInfo(null); setModalOpen(true); }}>
            <Plus size={14} /> Add sales info
          </Button>
        )}
      />
      {items.length > 3 && (
        <div className="px-4 py-2 border-b border-border bg-surface-secondary/30">
          <SearchInput value={search} onChange={setSearch} placeholder="Search pitch scripts, pricing, FAQs..." label="Search sales info" />
        </div>
      )}
      {filtered.length === 0 ? (
        <EmptyState
          compact
          icon={Info}
          title={search ? 'No matching info found' : 'No sales information yet'}
          description={canManage ? 'Add pricing guides, talking points, objection handling and FAQs for client calls.' : 'Pricing guides, talking points and FAQs shared with the team appear here.'}
          action={canManage ? <Button size="sm" variant="secondary" onClick={() => { setEditingInfo(null); setModalOpen(true); }}><Plus size={14} /> Add first sales info</Button> : undefined}
        />
      ) : (
        <ul className="max-h-[360px] divide-y divide-border overflow-y-auto">
          {filtered.map((m) => {
            const isExpanded = expandedId === m.id;
            return (
              <li key={m.id} className="p-3.5 transition-colors hover:bg-surface-secondary/40">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <button type="button" className="text-left w-full group" onClick={() => setExpandedId(isExpanded ? null : m.id)}>
                      <div className="flex items-center gap-2">
                        <Info size={15} className="text-primary shrink-0" />
                        <span className="font-semibold text-sm text-text group-hover:text-primary transition-colors">{m.title}</span>
                      </div>
                      <p className={`mt-1.5 whitespace-pre-line text-xs text-text-secondary ${isExpanded ? '' : 'line-clamp-2'}`}>
                        {m.description}
                      </p>
                    </button>
                    {m.link && (
                      <div className="mt-2">
                        <a href={m.link} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-primary hover:underline font-medium">
                          <ExternalLink size={12} /> Reference Link
                        </a>
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button size="sm" variant="ghost" onClick={() => copyScript(m)} title="Copy talking points">
                      {copiedId === m.id ? <Check size={14} className="text-success" /> : <Copy size={14} />}
                      <span className="sr-only">Copy</span>
                    </Button>
                    {canManage && (
                      <Button size="sm" variant="ghost" onClick={() => remove(m)} title="Delete">
                        <Trash2 size={14} />
                      </Button>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {modalOpen && (
        <QuickSalesInfoModal
          material={editingInfo}
          onClose={() => { setModalOpen(false); setEditingInfo(null); }}
          onSaved={() => { onChanged?.(); }}
        />
      )}
    </Card>
  );
}

// ---------------------------------------------------------------- Backward compatibility
export function MaterialsCard({ materials, onChanged, canManage = false }: { materials: Material[]; onChanged?: () => void; canManage?: boolean }) {
  return (
    <div className="space-y-4">
      <FlyersPostsCard materials={materials} onChanged={onChanged} canManage={canManage} />
      <SalesInfoCard materials={materials} onChanged={onChanged} canManage={canManage} />
    </div>
  );
}

// ---------------------------------------------------------------- team progress & attendance
export function TeamProgressCard({ rows, title = 'Sales team progress', description = 'Today', actions }: { rows: ProgressRow[]; title?: string; description?: string; actions?: ReactNode }) {
  const best = Math.max(1, ...rows.map((r) => r.calls));
  return (
    <Card>
      <CardHeader title={title} description={description} actions={actions} />
      {rows.length === 0 ? <EmptyState compact icon={Users} title="No sales team yet" description="Users with the Sales Person role appear here." /> : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-border text-left text-xs text-text-muted">
              <th className="px-4 py-2 font-medium">Employee</th><th className="px-3 py-2 font-medium">Day</th><th className="px-3 py-2 font-medium">Calls</th>
              <th className="px-3 py-2 text-right font-medium">Interested</th><th className="px-3 py-2 text-right font-medium">Converted</th>
              <th className="px-3 py-2 text-right font-medium">Open leads</th><th className="px-4 py-2 text-right font-medium">Follow-ups due</th>
            </tr></thead>
            <tbody className="divide-y divide-border">
              {rows.map((r, i) => (
                <tr key={r.user_id}>
                  <td className="px-4 py-2.5"><span className="flex items-center gap-1.5 font-medium text-text">{i === 0 && r.converted > 0 && <Trophy size={13} className="text-warning" />}{r.name}</span></td>
                  <td className="px-3 py-2.5">{r.day_status ? <><Badge tone={dayTone[r.day_status]} dot>{dayLabel[r.day_status]}</Badge>{r.hours_today > 0 && <span className="ml-1 text-xs text-text-muted">{r.hours_today.toFixed(1)} h</span>}</> : <span className="text-text-muted" title="Only HR and Admin see other people's attendance">—</span>}</td>
                  <td className="px-3 py-2.5">
                    <span className="flex items-center gap-2"><span className="w-6 tabular-nums text-text">{number(r.calls)}</span>
                      <span className="h-1.5 w-20 overflow-hidden rounded-full bg-neutral-bg"><span className="block h-full rounded-full bg-primary" style={{ width: `${(r.calls / best) * 100}%` }} /></span></span>
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{number(r.interested)}</td>
                  <td className="px-3 py-2.5 text-right font-semibold tabular-nums text-success">{number(r.converted)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{number(r.leads_open)}<span className="text-text-muted"> / {number(r.leads_assigned)}</span></td>
                  <td className={`px-4 py-2.5 text-right tabular-nums ${r.follow_ups_due ? 'font-medium text-warning' : ''}`}>{number(r.follow_ups_due)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

export function AttendanceBoardCard({ rows, live = true, title = 'Attendance board', description }: { rows: AttendanceRow[]; live?: boolean; title?: string; description?: string }) {
  const working = rows.filter((r) => r.status === 'WORKING').length;
  return (
    <Card>
      <CardHeader title={title} description={description ?? `${working} of ${rows.length} working now`}
        actions={live && <span className="inline-flex items-center gap-1.5 text-xs font-medium text-success"><Radio size={13} className="animate-pulse" /> Live</span>} />
      {rows.length === 0 ? <EmptyState compact icon={Users} title="No one on the board yet" /> : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-border text-left text-xs text-text-muted">
              <th className="px-4 py-2 font-medium">Employee</th><th className="px-3 py-2 font-medium">Status</th><th className="px-3 py-2 font-medium">Day started</th>
              <th className="px-3 py-2 font-medium">Day ended</th><th className="px-3 py-2 text-right font-medium">Hours</th><th className="px-4 py-2 font-medium">Last CRM login</th>
            </tr></thead>
            <tbody className="divide-y divide-border">
              {rows.map((r) => (
                <tr key={r.user_id}>
                  <td className="px-4 py-2.5"><span className="block font-medium text-text">{r.name}</span><span className="block text-xs text-text-muted">{r.role_label}</span></td>
                  <td className="px-3 py-2.5"><Badge tone={dayTone[r.status]} dot>{dayLabel[r.status]}</Badge></td>
                  <td className="px-3 py-2.5 tabular-nums">{clock(r.started_at)}</td>
                  <td className="px-3 py-2.5 tabular-nums">{clock(r.ended_at)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{r.hours ? r.hours.toFixed(1) : '—'}</td>
                  <td className="px-4 py-2.5 text-xs text-text-muted">{r.last_login ? `${date(r.last_login.slice(0, 10))} ${clock(r.last_login)}` : 'Never'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

export function ManageLink() {
  return <Link to="/sales/hub" className="text-xs font-medium text-primary hover:underline">Manage in Sales workspace</Link>;
}
