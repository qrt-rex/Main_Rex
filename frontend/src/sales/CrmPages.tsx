// Sales > Leads, Customers and Deals. The server decides whose records each person sees (a sales person:
// their own; Admin / HR / Super Admin: everyone's), so these pages just show what the API returns.
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Banknote, Building2, FilePlus2, Handshake, Plus, Target, UserCheck } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { api, ApiError } from '../lib/api';
import { useApi, useDebounced } from '../lib/useApi';
import { date, money, number } from '../lib/format';
import { GST_STATES, GSTIN_RE } from '../lib/gst';
import { isPhoneOk, PHONE_ERROR, phoneDigits, phoneInput } from '../lib/phone';
import { Badge, StatusBadge, type BadgeTone } from '../components/common/Badge';
import { Button } from '../components/common/Button';
import { Card } from '../components/common/Card';
import { EmptyState } from '../components/common/EmptyState';
import { ErrorState } from '../components/common/ErrorState';
import { Input, SearchInput, Select } from '../components/common/Input';
import { Modal } from '../components/common/Modal';
import { Table, type Column } from '../components/common/Table';
import { useToast } from '../components/common/ToastContext';
import { StatCard } from '../components/dashboard/StatCard';
import { PageHeader } from '../components/layout/PageHeader';
import { LEAD_STATUSES, type Lead } from './api';
import { QuickLeadModal } from './SalesWidgets';

const errText = (err: unknown, fallback: string) => (err instanceof ApiError ? err.message : fallback);

// ---------------------------------------------------------------- Leads
function ConvertModal({ lead, onClose, onDone }: { lead: Lead; onClose: () => void; onDone: () => void }) {
  const { showToast } = useToast();
  const knownState = Object.entries(GST_STATES).find(([, n]) => n.toLowerCase() === (lead.state || 'Gujarat').toLowerCase());
  // Everything the lead already knows is filled in; the sales person only checks it and adds what's missing.
  const [v, setV] = useState({
    name: lead.company || lead.name, contact_person: lead.name, phone: phoneDigits(lead.phone || ''), email: lead.email,
    address: lead.address || lead.city, gstin: (lead.gstin || '').toUpperCase(),
    state_code: knownState?.[0] ?? '', state: knownState?.[1] ?? (lead.state || ''),
  });
  const [saving, setSaving] = useState(false);
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) =>
    setV((s) => ({ ...s, [k]: k === 'phone' ? phoneDigits(e.target.value) : k === 'gstin' ? e.target.value.toUpperCase() : e.target.value }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!v.name.trim()) return showToast('Enter the customer name.', 'error');
    if (!isPhoneOk(v.phone)) return showToast(`Phone: ${PHONE_ERROR}`, 'error');
    if (v.gstin && !GSTIN_RE.test(v.gstin)) return showToast('The GSTIN should be 15 characters, e.g. 24ABCDE1234F1Z5.', 'error');
    setSaving(true);
    try {
      await api.post(`/api/billing/clients/from-lead/${lead.id}`, { ...v, company_name: v.name });
      showToast(`${v.name} is now a customer`, 'success');
      onDone();
      onClose();
    } catch (err) {
      showToast(errText(err, 'Could not create the customer'), 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open onClose={onClose} size="lg" title="Convert lead to customer" closeOnOverlay={false}
      description="Filled in from the lead. Check the details and add anything missing."
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" form="convert-form" loading={saving}>Create customer</Button></>}>
      <form id="convert-form" onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
        <Input label="Customer / company name" required value={v.name} onChange={set('name')} />
        <Input label="Contact person" value={v.contact_person} onChange={set('contact_person')} />
        <Input label="Phone" {...phoneInput} value={v.phone} onChange={set('phone')} />
        <Input label="Email" type="email" value={v.email} onChange={set('email')} />
        <Input label="Address" value={v.address} onChange={set('address')} className="sm:col-span-2" />
        <Input label="GSTIN" value={v.gstin} onChange={set('gstin')} maxLength={15} hint="Sets the state from its first two digits" />
        <Select label="State (place of supply)" value={v.state_code}
          onChange={(e) => setV((s) => ({ ...s, state_code: e.target.value, state: GST_STATES[e.target.value] ?? s.state }))}>
          <option value="">{v.state || 'Other state'}</option>
          {Object.entries(GST_STATES).map(([code, name]) => <option key={code} value={code}>{name} ({code})</option>)}
        </Select>
      </form>
    </Modal>
  );
}

export function SalesLeads() {
  const { can } = useAuth();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [adding, setAdding] = useState(false);
  const [converting, setConverting] = useState<Lead | null>(null);
  const q = useDebounced(search, 250);
  const leads = useApi(() => api.get<{ items: Lead[]; total: number; can_manage: boolean }>('/api/sales-hub/leads', { search: q, status }), [q, status]);
  const all = leads.data?.can_manage;

  const columns: Column<Lead>[] = [
    { key: 'lead', header: 'Lead', sortValue: (l) => (l.company || l.name).toLowerCase(), render: (l) => (
      <span><span className="block font-medium text-text">{l.company || l.name}</span>{l.company && l.name && <span className="text-xs text-text-muted">{l.name}</span>}</span>
    ) },
    { key: 'contact', header: 'Contact', render: (l) => <span className="text-xs text-text-secondary">{[l.phone, l.email].filter(Boolean).join(' · ') || '—'}</span> },
    { key: 'place', header: 'City / state', render: (l) => <span className="text-xs text-text-secondary">{[l.city, l.state].filter(Boolean).join(', ') || '—'}</span> },
    ...(all ? [{ key: 'owner', header: 'Assigned to', render: (l: Lead) => <span className="text-xs text-text-secondary">{l.assigned_to?.name ?? 'Unassigned'}</span> }] : []),
    { key: 'follow', header: 'Follow-up', sortValue: (l) => l.follow_up_date ?? '9999', render: (l) => <span className="whitespace-nowrap text-xs text-text-muted">{l.follow_up_date ? date(l.follow_up_date) : '—'}</span> },
    { key: 'status', header: 'Status', render: (l) => <StatusBadge status={l.status} />, sortValue: (l) => l.status },
    { key: 'action', header: '', align: 'right', render: (l) => l.customer_id ? (
      <Link to="/sales/customers" className="inline-flex items-center gap-1 text-xs font-medium text-success"><UserCheck size={13} /> Customer</Link>
    ) : can('billing.create') ? (
      <Button size="sm" variant="secondary" onClick={() => setConverting(l)}><Building2 size={13} /> Convert to customer</Button>
    ) : null },
  ];

  return (
    <div className="space-y-5">
      <PageHeader title="Leads" description={all ? 'Every lead, with who it is assigned to.' : 'Leads assigned to you, and ones you added.'}
        actions={<Button onClick={() => setAdding(true)}><Plus size={15} /> Add lead</Button>} />
      <Card>
        <div className="flex flex-wrap items-end gap-3 border-b border-border p-4">
          <div className="w-72 max-w-full"><SearchInput value={search} onChange={setSearch} placeholder="Search name, company, phone…" label="Search leads" /></div>
          <Select label="Status" value={status} onChange={(e) => setStatus(e.target.value)} className="w-44">
            <option value="">All</option>
            {LEAD_STATUSES.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
          </Select>
        </div>
        {leads.status === 'error' ? <ErrorState message={leads.error} onRetry={leads.reload} /> : (
          <Table columns={columns} rows={leads.data?.items ?? []} rowKey={(l) => l.id} loading={leads.loading && !leads.data} caption="Leads"
            empty={<EmptyState compact icon={Target} title="No leads yet" description="Leads assigned to you by your manager, and ones you add, appear here." />} />
        )}
      </Card>
      {adding && <QuickLeadModal onClose={() => setAdding(false)} onSaved={leads.reload} />}
      {converting && <ConvertModal lead={converting} onClose={() => setConverting(null)} onDone={leads.reload} />}
    </div>
  );
}

// ---------------------------------------------------------------- Customers
interface Customer {
  id: string; name: string; company_name?: string; contact_person?: string; phone?: string; email?: string;
  gstin?: string; state?: string; lead_id?: string; owner_name?: string; created_at?: string;
}

export function SalesCustomers() {
  const { can } = useAuth();
  const [search, setSearch] = useState('');
  const q = useDebounced(search, 250);
  const list = useApi(() => api.get<{ items: Customer[] }>('/api/billing/clients', { search: q }), [q]);
  const columns: Column<Customer>[] = [
    { key: 'name', header: 'Customer', sortValue: (c) => c.name.toLowerCase(), render: (c) => (
      <span><span className="block font-medium text-text">{c.name}</span>{c.contact_person && <span className="text-xs text-text-muted">{c.contact_person}</span>}</span>
    ) },
    { key: 'contact', header: 'Contact', render: (c) => <span className="text-xs text-text-secondary">{[c.phone, c.email].filter(Boolean).join(' · ') || '—'}</span> },
    { key: 'gstin', header: 'GSTIN / state', render: (c) => <span className="text-xs text-text-secondary">{[c.gstin, c.state].filter(Boolean).join(' · ') || '—'}</span> },
    { key: 'from', header: 'From', render: (c) => (c.lead_id ? <Badge tone="info">Lead</Badge> : <span className="text-xs text-text-muted">Added in billing</span>) },
    { key: 'owner', header: 'Owner', render: (c) => <span className="text-xs text-text-secondary">{c.owner_name || '—'}</span> },
    { key: 'action', header: '', align: 'right', render: (c) => can('billing.create') ? (
      <Link to={`/billing/create?client=${encodeURIComponent(c.id)}`} className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"><FilePlus2 size={13} /> Create invoice</Link>
    ) : null },
  ];
  return (
    <div className="space-y-5">
      <PageHeader title="Customers" description="Customers converted from leads. Their invoices link back to the customer and the lead." />
      <Card>
        <div className="border-b border-border p-4"><div className="w-72 max-w-full"><SearchInput value={search} onChange={setSearch} placeholder="Search name, GSTIN…" label="Search customers" /></div></div>
        {list.status === 'error' ? <ErrorState message={list.error} onRetry={list.reload} /> : (
          <Table columns={columns} rows={list.data?.items ?? []} rowKey={(c) => c.id} loading={list.loading && !list.data} caption="Customers"
            empty={<EmptyState compact icon={Building2} title="No customers yet" description="Convert a lead into a customer from the Leads page." />} />
        )}
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------- Deals
interface Deal {
  id: string; invoice_number: string; invoice_type: string; invoice_date: string; client_name: string; owner_name: string;
  value: number; collected: number; balance: number; payments: number; collection_status: 'fully_collected' | 'partly_collected' | 'not_collected';
}
const COLLECTION: Record<Deal['collection_status'], [string, BadgeTone]> = {
  fully_collected: ['Fully collected', 'success'], partly_collected: ['Partly collected', 'warning'], not_collected: ['Not collected', 'neutral'],
};

export function SalesDeals() {
  const [filter, setFilter] = useState('');
  const deals = useApi(() => api.get<{ items: Deal[]; summary: Record<string, number> }>('/api/billing/deals'), []);
  const s = deals.data?.summary;
  const rows = (deals.data?.items ?? []).filter((d) => !filter || d.collection_status === filter);
  const columns: Column<Deal>[] = [
    { key: 'inv', header: 'Invoice', sortValue: (d) => d.invoice_number, render: (d) => (
      <span><span className="block font-medium text-text">{d.invoice_number}</span><span className="text-xs text-text-muted">{d.invoice_type === 'invoice' ? 'Tax invoice' : 'Proforma'} · {date(d.invoice_date)}</span></span>
    ) },
    { key: 'client', header: 'Customer', sortValue: (d) => d.client_name.toLowerCase(), render: (d) => <span className="text-text-secondary">{d.client_name}</span> },
    { key: 'owner', header: 'Owner', render: (d) => <span className="text-xs text-text-secondary">{d.owner_name}</span> },
    { key: 'value', header: 'Deal value', align: 'right', sortValue: (d) => d.value, render: (d) => money(d.value) },
    { key: 'paid', header: 'Collected', align: 'right', sortValue: (d) => d.collected, render: (d) => <span>{money(d.collected)}<span className="block text-[11px] text-text-muted">{d.payments} payment(s)</span></span> },
    { key: 'balance', header: 'Balance', align: 'right', sortValue: (d) => d.balance, render: (d) => money(d.balance) },
    { key: 'status', header: 'Collection', align: 'right', sortValue: (d) => d.collection_status, render: (d) => <Badge tone={COLLECTION[d.collection_status][1]}>{COLLECTION[d.collection_status][0]}</Badge> },
  ];
  return (
    <div className="space-y-5">
      <PageHeader title="Deals" description="Each invoice is a deal. Collected is the sum of the recorded client payments; a deal is fully collected only when they reach its value." />
      {s && (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard icon={Handshake} label="Deals" value={number(deals.data!.items.length)} hint={`${money(s.value)} in value`} />
          <StatCard icon={Banknote} tone="success" label="Fully collected" value={number(s.fully_collected)} hint={`${money(s.collected)} collected in all`} />
          <StatCard icon={Banknote} tone="warning" label="Partly collected" value={number(s.partly_collected)} />
          <StatCard icon={Banknote} tone="info" label="Not collected" value={number(s.not_collected)} />
        </div>
      )}
      <Card>
        <div className="border-b border-border p-4">
          <Select label="Collection" value={filter} onChange={(e) => setFilter(e.target.value)} className="w-52">
            <option value="">All deals</option>
            {Object.entries(COLLECTION).map(([k, [label]]) => <option key={k} value={k}>{label}</option>)}
          </Select>
        </div>
        {deals.status === 'error' ? <ErrorState message={deals.error} onRetry={deals.reload} /> : (
          <Table columns={columns} rows={rows} rowKey={(d) => d.id} loading={deals.loading && !deals.data} caption="Deals"
            empty={<EmptyState compact icon={Handshake} title="No deals yet" description="Invoices you create, or that are issued for your requests, appear here." />} />
        )}
      </Card>
    </div>
  );
}
