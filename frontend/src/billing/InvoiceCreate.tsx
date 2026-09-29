import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Plus, Trash2, CheckCircle2, ArrowLeft, Sparkles } from 'lucide-react';
import { useToast } from '../components/common/ToastContext';
import { Card, CardHeader } from '../components/common/Card';
import { useAuth } from '../auth/AuthContext';
import { api, ApiError } from '../lib/api';
import { todayISO } from '../lib/format';
import type { InvoiceRequest } from './BillingRequests';

const GST_RATES = [0, 5, 12, 18, 28];
// GSTIN state code -> the state options this form offers.
const GST_STATES: Record<string, string> = { '24': 'Gujarat', '27': 'Maharashtra', '08': 'Rajasthan', '07': 'Delhi', '29': 'Karnataka', '36': 'Telangana' };

function addDaysISO(iso: string, days: number) {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + days);
  return d.toLocaleDateString('en-CA'); // YYYY-MM-DD in local time
}

interface LineItem {
  id: string;
  name: string;
  description: string;
  hsn_sac: string;
  quantity: number;
  unit: string;
  unit_price: number;
  discount: number;
  gst_rate: number;
  amount: number;
}

interface Client {
  id: string;
  name: string;
  company_name: string;
  email: string;
  phone: string;
  address: string;
  gstin: string;
  state: string;
  state_code: string;
}

interface Product {
  id: string;
  name: string;
  sku: string;
  hsn_sac: string;
  description: string;
  unit_price: number;
  unit: string;
  default_gst_rate: number;
}

export function InvoiceCreate() {
  const navigate = useNavigate();
  const { showToast } = useToast();
  // Opened from a Legal-approved client (Legal > Approvals or "Clients assigned to you"): prefill it.
  const [params] = useSearchParams();

  const [branchKey, setBranchKey] = useState('ahmedabad_y');
  // Tax invoices are HR-only; everyone else with billing access issues proforma invoices.
  const { can } = useAuth();
  const canTax = can('billing.tax_invoice');
  const [invoiceType, setInvoiceType] = useState(canTax ? 'invoice' : 'proforma');
  const [invoiceNumberPreview, setInvoiceNumberPreview] = useState('Loading...');
  // Local dates: toISOString() gave the UTC date, i.e. "yesterday" in India before 5:30 am.
  const [invoiceDate, setInvoiceDate] = useState(todayISO);
  const [dueDate, setDueDate] = useState(() => addDaysISO(todayISO(), 15));
  const [isReverseCharge, setIsReverseCharge] = useState(false);
  const [applyGst, setApplyGst] = useState(true);
  const [notes, setNotes] = useState('1. Payment due within 15 days of invoice date.\n2. Interest @ 18% p.a. will be charged for delayed payments.\n3. Subject to Ahmedabad jurisdiction.');

  // Clients & Products catalogs
  const [clients, setClients] = useState<Client[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [selectedClientId, setSelectedClientId] = useState('');
  // Who the collections on this invoice are credited to (sales incentive); sales users default to themselves.
  const [salesPeople, setSalesPeople] = useState<{ email: string; name: string }[]>([]);
  const [salesPersonEmail, setSalesPersonEmail] = useState('');

  // Selected client details
  const [clientName, setClientName] = useState('');
  const [clientGstin, setClientGstin] = useState('');
  const [clientAddress, setClientAddress] = useState('');
  const [clientState, setClientState] = useState('Gujarat');
  const [clientStateCode, setClientStateCode] = useState('24');
  const [clientPhone, setClientPhone] = useState('');
  const [clientEmail, setClientEmail] = useState('');

  // Line Items
  const [items, setItems] = useState<LineItem[]>([
    {
      id: 'item-1',
      name: 'Financial Advisory Services',
      description: 'Corporate financial consulting and compliance advisory',
      hsn_sac: '997159',
      quantity: 1,
      unit: 'NOS',
      unit_price: 25000,
      discount: 0,
      gst_rate: 18,
      amount: 25000,
    }
  ]);

  const [submitting, setSubmitting] = useState(false);
  const requestId = params.get('request');

  const applyClient = (cl: Client | undefined) => {
    if (!cl) return;
    setSelectedClientId(cl.id);
    setClientName(cl.name || cl.company_name || '');
    setClientGstin(cl.gstin || '');
    setClientAddress(cl.address || '');
    setClientState(cl.state || 'Gujarat');
    setClientStateCode(cl.state_code || '24');
    setClientPhone(cl.phone || '');
    setClientEmail(cl.email || '');
  };
  const handleClientSelect = (cid: string) => applyClient(clients.find((c) => c.id === cid));

  // Load next number preview and master data (through the shared API client: the old raw fetch
  // read a token key that never existed and called the dev server instead of the API, so every call 401'd).
  useEffect(() => {
    let cancelled = false;
    api.get<{ invoice_number: string }>('/api/billing/invoices/next-number', { branch_key: branchKey, invoice_type: invoiceType })
      .then((data) => { if (!cancelled) setInvoiceNumberPreview(data.invoice_number); })
      .catch(() => { if (!cancelled) setInvoiceNumberPreview('—'); });
    return () => { cancelled = true; };
  }, [branchKey, invoiceType]);

  useEffect(() => {
    api.get<{ items: { email: string; name: string }[] }>('/api/billing/sales-people')
      .then((d) => setSalesPeople(d.items || []))
      .catch(() => setSalesPeople([]));
  }, []);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      api.get<{ items: Client[] }>('/api/billing/clients'),
      api.get<{ items: Product[] }>('/api/billing/products'),
      requestId ? api.get<{ request: InvoiceRequest }>(`/api/billing/requests/${requestId}`) : Promise.resolve(null),
    ])
      .then(([cData, pData, reqData]) => {
        if (cancelled) return;
        setClients(cData.items || []);
        setProducts(pData.items || []);
        const req = reqData?.request;
        if (req) {
          // An invoice request: fill the form from it so the reviewer only checks and saves.
          if (req.status !== 'pending') showToast(`${req.request_number} has already been ${req.status}`, 'warning');
          const stateCode = Object.entries(GST_STATES).find(([, name]) => name === req.client_state)?.[0] || req.client_gstin.slice(0, 2) || '99';
          setSelectedClientId('');
          setBranchKey(req.branch_key);
          setSalesPersonEmail(req.sales_person_email || '');
          setClientName(req.billing_name);
          setClientGstin(req.client_gstin);
          setClientAddress(req.billing_address);
          setClientPhone(req.billing_phone);
          setClientState(req.client_state || 'Gujarat');
          setClientStateCode(stateCode);
          setItems(req.items.map((it, i) => ({
            id: `item-${i + 1}`, name: it.particulars, description: '', hsn_sac: '997159', quantity: it.quantity, unit: 'NOS',
            unit_price: it.rate, discount: 0, gst_rate: 18, amount: it.quantity * it.rate,
          })));
          if (req.remark) setNotes((n) => `${n}\nRemark: ${req.remark}`);
          showToast(`Invoice pre-filled from ${req.request_number}`, 'info');
          return;
        }
        const fromLegal = params.get('client_name');
        if (!fromLegal) {
          applyClient(cData.items?.[0]);
          return;
        }
        const gstin = (params.get('gstin') || '').toUpperCase();
        const saved = cData.items?.find((c) => (gstin && c.gstin === gstin) || (c.name || c.company_name || '').toLowerCase() === fromLegal.toLowerCase());
        if (saved) applyClient(saved);
        else {
          setSelectedClientId('');
          setClientName(fromLegal);
          setClientGstin(gstin);
          setClientAddress('');
          setClientEmail(params.get('email') || '');
          setClientPhone(params.get('phone') || '');
          if (gstin) {
            setClientStateCode(gstin.slice(0, 2));
            setClientState(GST_STATES[gstin.slice(0, 2)] ?? 'Other State');
          }
        }
        const services = params.getAll('service');
        if (services.length) {
          setItems(services.map((name, i) => ({
            id: `item-${i + 1}`, name, description: params.get('from') ? `Ref. ${params.get('from')}` : '',
            hsn_sac: '997159', quantity: 1, unit: 'NOS', unit_price: 0, discount: 0, gst_rate: 18, amount: 0,
          })));
        }
        showToast(`Invoice pre-filled for ${fromLegal}${services.length ? ': enter the rate for each service' : ''}`, 'info');
      })
      .catch((err) => showToast(err instanceof ApiError ? err.message : 'Could not load clients and products', 'error'));
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load the catalogs once
  }, []);

  const addItem = () => {
    const newItem: LineItem = {
      id: `item-${Date.now()}`,
      name: '',
      description: '',
      hsn_sac: '997159',
      quantity: 1,
      unit: 'NOS',
      unit_price: 0,
      discount: 0,
      gst_rate: 18,
      amount: 0,
    };
    setItems([...items, newItem]);
  };

  const removeItem = (id: string) => {
    if (items.length <= 1) {
      showToast('Invoice must have at least one line item', 'warning');
      return;
    }
    setItems(items.filter((i) => i.id !== id));
  };

  const updateItem = (id: string, field: keyof LineItem, value: any) => {
    setItems(items.map((i) => {
      if (i.id !== id) return i;
      const updated = { ...i, [field]: value };
      const qty = parseFloat(updated.quantity as any) || 0;
      const price = parseFloat(updated.unit_price as any) || 0;
      const disc = parseFloat(updated.discount as any) || 0;
      updated.amount = Math.max(qty * price - disc, 0);
      return updated;
    }));
  };

  const handleProductSelect = (itemId: string, prodId: string) => {
    const prod = products.find((p) => p.id === prodId);
    if (prod) {
      setItems(items.map((i) => {
        if (i.id !== itemId) return i;
        const qty = i.quantity || 1;
        const price = prod.unit_price || 0;
        return {
          ...i,
          name: prod.name,
          description: prod.description,
          hsn_sac: prod.hsn_sac,
          unit_price: price,
          unit: prod.unit,
          gst_rate: prod.default_gst_rate,
          amount: Math.max(qty * price - (i.discount || 0), 0)
        };
      }));
    }
  };

  // Calculations (same rules as the API: each line is taxed at its own GST rate)
  const subTotal = items.reduce((sum, i) => sum + (i.amount || 0), 0);
  const taxableAmount = subTotal;

  const isIntraState = clientState.trim().toLowerCase() === 'gujarat' || clientStateCode === '24' || clientGstin.startsWith('24');
  const round2 = (n: number) => Math.round(n * 100) / 100;
  const lineTax = applyGst ? items.reduce((sum, i) => sum + (i.amount || 0) * (Number(i.gst_rate) || 0) / 100, 0) : 0;
  const cgstAmount = applyGst && isIntraState ? round2(lineTax / 2) : 0;
  const sgstAmount = cgstAmount;
  const igstAmount = applyGst && !isIntraState ? round2(lineTax) : 0;
  const rates = new Set(items.map((i) => Number(i.gst_rate) || 0));
  const rateLabel = (divisor: number) => (rates.size === 1 ? `${[...rates][0] / divisor}%` : 'mixed rates');

  const grandTotal = taxableAmount + cgstAmount + sgstAmount + igstAmount;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!clientName.trim()) {
      showToast('Client name is required', 'error');
      return;
    }
    if (items.some((i) => !i.name.trim() || !(Number(i.unit_price) > 0) || !(Number(i.quantity) > 0))) {
      showToast('Please ensure all items have a name, a quantity and a price', 'error');
      return;
    }
    if (dueDate < invoiceDate) {
      showToast('The due date cannot be before the invoice date', 'error');
      return;
    }
    if (clientGstin && !/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(clientGstin)) {
      showToast('The GSTIN should be 15 characters, e.g. 24ABCDE1234F1Z5', 'error');
      return;
    }

    try {
      setSubmitting(true);
      const payload = {
        branch_key: branchKey,
        invoice_type: invoiceType,
        invoice_date: invoiceDate,
        due_date: dueDate,
        is_reverse_charge: isReverseCharge,
        apply_gst: applyGst,
        client: {
          id: selectedClientId,
          name: clientName,
          company_name: clientName,
          gstin: clientGstin,
          address: clientAddress,
          state: clientState,
          state_code: clientStateCode,
          phone: clientPhone,
          email: clientEmail,
        },
        items: items.map((i) => ({
          name: i.name,
          description: i.description,
          hsn_sac: i.hsn_sac,
          quantity: parseFloat(i.quantity as any) || 1,
          unit: i.unit,
          unit_price: parseFloat(i.unit_price as any) || 0,
          discount: parseFloat(i.discount as any) || 0,
          gst_rate: Number(i.gst_rate) || 0, // a 0% line used to be sent as 18%
          amount: i.amount
        })),
        notes,
        sales_person_email: salesPersonEmail || undefined,
      };

      const data = await api.post<{ invoice?: { id?: string; invoice_number?: string } }>('/api/billing/invoices', payload);
      showToast(`Invoice ${data.invoice?.invoice_number || ''} generated successfully!`, 'success');
      if (requestId && data.invoice?.id) {
        try {
          await api.post(`/api/billing/requests/${requestId}/approve`, { invoice_id: data.invoice.id });
        } catch (err) {
          showToast(err instanceof ApiError ? err.message : 'The invoice was saved but the request could not be marked approved', 'warning');
        }
      }
      navigate('/billing/invoices');
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Error generating invoice', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <button
          onClick={() => navigate('/billing/invoices')}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-text-muted hover:text-text transition-colors"
        >
          <ArrowLeft size={16} /> Back to Invoices
        </button>
        <div className="inline-flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-700 dark:text-emerald-400">
          <Sparkles size={14} /> Next Sequential Number: <span className="font-mono">{invoiceNumberPreview}</span>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Document Setup & Branch */}
        <Card className="p-5">
          <CardHeader title="Document & Branch Setup" description="Select document class, issuing branch and date terms" />
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <label className="block text-xs font-medium text-text mb-1">Invoice Type *</label>
              <select
                value={invoiceType}
                onChange={(e) => setInvoiceType(e.target.value)}
                className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text focus:border-primary focus:outline-none"
              >
                {canTax && <option value="invoice">Tax Invoice (Standard GST)</option>}
                <option value="proforma">Proforma Invoice</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-text mb-1">Issuing Branch *</label>
              <select
                value={branchKey}
                onChange={(e) => setBranchKey(e.target.value)}
                className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text focus:border-primary focus:outline-none"
              >
                <option value="ahmedabad_y">Ahmedabad(Y) [AM1 - Ghatlodia]</option>
                <option value="ahmedabad_a">Ahmedabad(A) [AM2 - Navrangpura]</option>
                <option value="baroda">Baroda [BRD - Race Course Rd]</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-text mb-1">Sales Person</label>
              <select
                value={salesPersonEmail}
                onChange={(e) => setSalesPersonEmail(e.target.value)}
                className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text focus:border-primary focus:outline-none"
              >
                <option value="">{can('billing.tax_invoice') ? 'None (no incentive)' : 'Myself'}</option>
                {salesPeople.map((p) => <option key={p.email} value={p.email}>{p.name}</option>)}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-text mb-1">Invoice Date *</label>
              <input
                type="date"
                required
                value={invoiceDate}
                onChange={(e) => setInvoiceDate(e.target.value)}
                className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text focus:border-primary focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-text mb-1">Payment Due Date *</label>
              <input
                type="date"
                required
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text focus:border-primary focus:outline-none"
              />
            </div>
          </div>
        </Card>

        {/* Client & Billing Address */}
        <Card className="p-5">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-3">
            <div>
              <h3 className="font-semibold text-text">Billed To (Client Details)</h3>
              <p className="text-xs text-text-muted">Customer details and Place of Supply</p>
            </div>
            {clients.length > 0 && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-text-muted">Choose Saved Client:</span>
                <select
                  value={selectedClientId}
                  onChange={(e) => handleClientSelect(e.target.value)}
                  className="rounded-md border border-border bg-surface px-2.5 py-1 text-xs text-text focus:border-primary focus:outline-none"
                >
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>{c.name || c.company_name}</option>
                  ))}
                </select>
              </div>
            )}
          </div>

          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <label className="block text-xs font-medium text-text mb-1">Client / Company Name *</label>
              <input
                type="text"
                required
                placeholder="e.g. Apex Global Solutions Pvt Ltd"
                value={clientName}
                onChange={(e) => setClientName(e.target.value)}
                className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text focus:border-primary focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-text mb-1">GSTIN Number</label>
              <input
                type="text"
                placeholder="15-digit GSTIN (e.g. 24ABCDE1234F1Z5)"
                value={clientGstin}
                onChange={(e) => setClientGstin(e.target.value.toUpperCase())}
                className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text font-mono focus:border-primary focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-text mb-1">Place of Supply (State) *</label>
              <select
                value={clientState}
                onChange={(e) => {
                  setClientState(e.target.value);
                  setClientStateCode(e.target.value === 'Gujarat' ? '24' : e.target.value === 'Maharashtra' ? '27' : '99');
                }}
                className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text focus:border-primary focus:outline-none"
              >
                <option value="Gujarat">Gujarat (24) - Intra-State (CGST+SGST)</option>
                <option value="Maharashtra">Maharashtra (27) - Inter-State (IGST)</option>
                <option value="Rajasthan">Rajasthan (08) - Inter-State (IGST)</option>
                <option value="Delhi">Delhi (07) - Inter-State (IGST)</option>
                <option value="Karnataka">Karnataka (29) - Inter-State (IGST)</option>
                <option value="Telangana">Telangana (36) - Inter-State (IGST)</option>
                <option value="Other State">Other State - Inter-State (IGST)</option>
              </select>
            </div>

            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-text mb-1">Billing Address</label>
              <input
                type="text"
                placeholder="Full address"
                value={clientAddress}
                onChange={(e) => setClientAddress(e.target.value)}
                className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text focus:border-primary focus:outline-none"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs font-medium text-text mb-1">Contact Phone</label>
                <input
                  type="text"
                  placeholder="Phone"
                  value={clientPhone}
                  onChange={(e) => setClientPhone(e.target.value)}
                  className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text focus:border-primary focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-text mb-1">Contact Email</label>
                <input
                  type="email"
                  placeholder="Email"
                  value={clientEmail}
                  onChange={(e) => setClientEmail(e.target.value)}
                  className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text focus:border-primary focus:outline-none"
                />
              </div>
            </div>
          </div>
        </Card>

        {/* Line Items Table */}
        <Card className="p-5">
          <div className="flex items-center justify-between border-b border-border pb-3">
            <div>
              <h3 className="font-semibold text-text">Line Items & Services</h3>
              <p className="text-xs text-text-muted">Specify services, HSN/SAC codes, quantities and rates</p>
            </div>
            <button
              type="button"
              onClick={addItem}
              className="inline-flex items-center gap-1.5 rounded-md bg-surface-secondary border border-border px-3 py-1.5 text-xs font-medium text-text hover:bg-surface transition-colors"
            >
              <Plus size={14} /> Add Line Item
            </button>
          </div>

          <div className="mt-4 space-y-3">
            {items.map((item, idx) => (
              <div key={item.id} className="rounded-lg border border-border bg-surface-secondary/40 p-3 space-y-3">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-12 items-center">
                  <div className="sm:col-span-1 text-center font-bold text-text-muted text-xs">
                    #{idx + 1}
                  </div>
                  <div className="sm:col-span-3">
                    <div className="flex items-center justify-between mb-0.5">
                      <label className="block text-[11px] font-medium text-text-muted">Item / Service Name *</label>
                      {products.length > 0 && (
                        <select
                          onChange={(e) => handleProductSelect(item.id, e.target.value)}
                          className="text-[10px] text-primary bg-transparent border-0 cursor-pointer hover:underline focus:outline-none"
                          defaultValue=""
                        >
                          <option value="" disabled>From Catalog...</option>
                          {products.map((p) => (
                            <option key={p.id} value={p.id}>{p.name}</option>
                          ))}
                        </select>
                      )}
                    </div>
                    <input
                      type="text"
                      required
                      placeholder="e.g. Financial Consulting"
                      value={item.name}
                      onChange={(e) => updateItem(item.id, 'name', e.target.value)}
                      className="w-full rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm text-text focus:border-primary focus:outline-none"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block text-[11px] font-medium text-text-muted mb-0.5">HSN/SAC</label>
                    <input
                      type="text"
                      value={item.hsn_sac}
                      onChange={(e) => updateItem(item.id, 'hsn_sac', e.target.value)}
                      className="w-full rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm text-text font-mono focus:border-primary focus:outline-none"
                    />
                  </div>
                  <div className="sm:col-span-1">
                    <label className="block text-[11px] font-medium text-text-muted mb-0.5">Qty</label>
                    <input
                      type="number"
                      step="0.1"
                      min="0.1"
                      value={item.quantity}
                      onChange={(e) => updateItem(item.id, 'quantity', e.target.value)}
                      className="w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-text focus:border-primary focus:outline-none"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block text-[11px] font-medium text-text-muted mb-0.5">Rate (₹) *</label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={item.unit_price}
                      onChange={(e) => updateItem(item.id, 'unit_price', e.target.value)}
                      className="w-full rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm text-text focus:border-primary focus:outline-none"
                    />
                  </div>
                  <div className="sm:col-span-1">
                    <label className="block text-[11px] font-medium text-text-muted mb-0.5">GST %</label>
                    <select
                      value={item.gst_rate}
                      onChange={(e) => updateItem(item.id, 'gst_rate', Number(e.target.value))}
                      aria-label={`GST rate for line ${idx + 1}`}
                      className="w-full min-w-[3.75rem] rounded-md border border-border bg-surface px-1 py-1.5 text-xs text-text focus:border-primary focus:outline-none"
                    >
                      {GST_RATES.map((r) => <option key={r} value={r}>{r}%</option>)}
                    </select>
                  </div>
                  <div className="sm:col-span-1 text-right font-semibold text-text text-sm">
                    ₹{item.amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                  </div>
                  <div className="sm:col-span-1 text-right">
                    <button
                      type="button"
                      onClick={() => removeItem(item.id)}
                      className="rounded p-1.5 text-text-muted hover:bg-rose-500/10 hover:text-rose-600 transition-colors"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
                <div className="pl-8">
                  <input
                    type="text"
                    placeholder="Description / detailed notes for this line item (optional)"
                    value={item.description}
                    onChange={(e) => updateItem(item.id, 'description', e.target.value)}
                    className="w-full rounded-md border border-border bg-surface px-2.5 py-1 text-xs text-text-secondary focus:border-primary focus:outline-none"
                  />
                </div>
              </div>
            ))}
          </div>
        </Card>

        {/* GST & Financial Summary */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* Notes & Options */}
          <Card className="p-5 space-y-4">
            <CardHeader title="Terms & Statutory Declarations" />
            <div className="space-y-3">
              <label className="flex items-center gap-2 cursor-pointer text-sm text-text">
                <input
                  type="checkbox"
                  checked={applyGst}
                  onChange={(e) => setApplyGst(e.target.checked)}
                  className="rounded border-border text-primary focus:ring-primary"
                />
                Apply GST (at each line's rate)
              </label>

              <label className="flex items-center gap-2 cursor-pointer text-sm text-text">
                <input
                  type="checkbox"
                  checked={isReverseCharge}
                  onChange={(e) => setIsReverseCharge(e.target.checked)}
                  className="rounded border-border text-primary focus:ring-primary"
                />
                Reverse Charge Mechanism (RCM) Applicable
              </label>

              <div>
                <label className="block text-xs font-medium text-text mb-1">Terms & Notes on Invoice</label>
                <textarea
                  rows={4}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="w-full rounded-md border border-border bg-surface p-2.5 text-xs text-text focus:border-primary focus:outline-none"
                />
              </div>
            </div>
          </Card>

          {/* Totals Summary */}
          <Card className="p-5 bg-surface-secondary/40 border border-border space-y-3">
            <h3 className="font-semibold text-text border-b border-border pb-2">Financial Calculation Summary</h3>
            <div className="space-y-2 text-sm text-text-secondary">
              <div className="flex justify-between">
                <span>Taxable Amount:</span>
                <span className="font-medium text-text">₹{taxableAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
              </div>
              {applyGst && isIntraState && (
                <>
                  <div className="flex justify-between text-xs">
                    <span>CGST ({rateLabel(2)}):</span>
                    <span className="font-medium text-text">₹{cgstAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span>SGST ({rateLabel(2)}):</span>
                    <span className="font-medium text-text">₹{sgstAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                  </div>
                </>
              )}
              {applyGst && !isIntraState && (
                <div className="flex justify-between text-xs">
                  <span>IGST ({rateLabel(1)}):</span>
                  <span className="font-medium text-text">₹{igstAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                </div>
              )}
              <div className="border-t border-border pt-3 flex justify-between items-center text-lg font-bold text-primary">
                <span>Grand Total:</span>
                <span>₹{grandTotal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
              </div>
            </div>

            <div className="pt-4 flex items-center justify-end gap-3 border-t border-border">
              <button
                type="button"
                onClick={() => navigate('/billing/invoices')}
                className="rounded-md border border-border bg-surface px-4 py-2 text-sm font-medium text-text hover:bg-surface-secondary transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="inline-flex items-center gap-2 rounded-md bg-emerald-600 px-5 py-2 text-sm font-medium text-white shadow hover:bg-emerald-700 disabled:opacity-50 transition-colors"
              >
                <CheckCircle2 size={16} />
                {submitting ? 'Generating...' : 'Save & Issue Tax Invoice'}
              </button>
            </div>
          </Card>
        </div>
      </form>
    </div>
  );
}
