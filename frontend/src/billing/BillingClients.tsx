import { useState, useEffect, useCallback } from 'react';
import { Plus, Trash2, X } from 'lucide-react';
import { useToast } from '../components/common/ToastContext';
import { useConfirm } from '../components/common/ConfirmDialog';
import { Card } from '../components/common/Card';
import { api, ApiError } from '../lib/api';

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
  contact_person?: string;
  outstanding_balance?: number;
}

export function BillingClients() {
  const { showToast } = useToast();
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({
    name: '',
    gstin: '',
    address: '',
    state: 'Gujarat',
    state_code: '24',
    phone: '',
    email: '',
    contact_person: '',
  });

  const confirm = useConfirm();

  const fetchClients = useCallback(async () => {
    try {
      setLoading(true);
      const data = await api.get<{ items: Client[] }>('/api/billing/clients');
      setClients(data.items || []);
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Could not load clients', 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    fetchClients();
  }, [fetchClients]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) {
      showToast('Enter the client name', 'error');
      return;
    }
    try {
      await api.post('/api/billing/clients', { ...form, gstin: form.gstin.trim().toUpperCase() });
      showToast('Client added successfully', 'success');
      setShowModal(false);
      setForm({ name: '', gstin: '', address: '', state: 'Gujarat', state_code: '24', phone: '', email: '', contact_person: '' });
      fetchClients();
    } catch (err) {
      // e.g. an invalid GSTIN: show the reason instead of silently doing nothing
      showToast(err instanceof ApiError ? err.message : 'Failed to add client', 'error');
    }
  };

  const handleDelete = async (id: string, name: string) => {
    const ok = await confirm({ title: `Delete ${name}?`, message: 'Existing invoices keep their copy of the client details.', confirmText: 'Delete', tone: 'danger' });
    if (!ok) return;
    try {
      await api.delete(`/api/billing/clients/${id}`);
      showToast('Client removed', 'success');
      fetchClients();
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Error removing client', 'error');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-text">Customer Directory</h2>
          <p className="text-xs text-text-muted">GSTIN numbers, registered billing addresses & tax states</p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3.5 py-1.5 text-xs font-medium text-on-primary hover:bg-primary-hover"
        >
          <Plus size={14} /> Add Customer
        </button>
      </div>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-text">
            <thead className="border-b border-border bg-surface-secondary text-xs uppercase text-text-muted font-semibold">
              <tr>
                <th className="px-4 py-3">Client / Company</th>
                <th className="px-4 py-3">GSTIN</th>
                <th className="px-4 py-3">State</th>
                <th className="px-4 py-3">Contact</th>
                <th className="px-4 py-3">Phone & Email</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {loading ? (
                <tr><td colSpan={6} className="p-8 text-center text-text-muted">Loading clients...</td></tr>
              ) : clients.length === 0 ? (
                <tr><td colSpan={6} className="p-10 text-center text-text-muted">No customers registered yet.</td></tr>
              ) : (
                clients.map((c) => (
                  <tr key={c.id} className="hover:bg-surface-secondary/50">
                    <td className="px-4 py-3 font-semibold text-text">
                      {c.name || c.company_name}
                      {c.address && <div className="text-xs font-normal text-text-muted truncate max-w-xs">{c.address}</div>}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-text">{c.gstin || 'Unregistered'}</td>
                    <td className="px-4 py-3 text-xs text-text-secondary">{c.state} ({c.state_code})</td>
                    <td className="px-4 py-3 text-xs text-text">{c.contact_person || '—'}</td>
                    <td className="px-4 py-3 text-xs text-text-muted">
                      <div>{c.phone}</div>
                      <div>{c.email}</div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => handleDelete(c.id, c.name || c.company_name)}
                        className="rounded p-1 text-text-muted hover:text-rose-600"
                        title="Delete"
                      >
                        <Trash2 size={15} />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Add Client Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-lg border border-border bg-surface p-6 shadow-xl">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <h3 className="font-semibold text-text">Add Customer Account</h3>
              <button onClick={() => setShowModal(false)} className="text-text-muted hover:text-text"><X size={18} /></button>
            </div>
            <form onSubmit={handleCreate} className="mt-4 space-y-4">
              <div>
                <label className="block text-xs font-medium text-text mb-1">Company / Customer Name *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Apex Global Solutions Pvt Ltd"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text focus:border-primary focus:outline-none"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-text mb-1">15-digit GSTIN</label>
                  <input
                    type="text"
                    placeholder="24ABCDE1234F1Z5"
                    value={form.gstin}
                    onChange={(e) => setForm({ ...form, gstin: e.target.value.toUpperCase() })}
                    className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text font-mono focus:border-primary focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-text mb-1">State / Supply Region</label>
                  <select
                    value={form.state}
                    onChange={(e) => setForm({ ...form, state: e.target.value, state_code: e.target.value === 'Gujarat' ? '24' : '27' })}
                    className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text focus:border-primary focus:outline-none"
                  >
                    <option value="Gujarat">Gujarat (24)</option>
                    <option value="Maharashtra">Maharashtra (27)</option>
                    <option value="Rajasthan">Rajasthan (08)</option>
                    <option value="Delhi">Delhi (07)</option>
                    <option value="Karnataka">Karnataka (29)</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-text mb-1">Full Billing Address</label>
                <input
                  type="text"
                  placeholder="Street, locality, city, pin code"
                  value={form.address}
                  onChange={(e) => setForm({ ...form, address: e.target.value })}
                  className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text focus:border-primary focus:outline-none"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-text mb-1">Phone</label>
                  <input
                    type="text"
                    value={form.phone}
                    onChange={(e) => setForm({ ...form, phone: e.target.value })}
                    className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text focus:border-primary focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-text mb-1">Email</label>
                  <input
                    type="email"
                    value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                    className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text focus:border-primary focus:outline-none"
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2 border-t border-border pt-4">
                <button type="button" onClick={() => setShowModal(false)} className="rounded border border-border px-4 py-2 text-xs font-medium text-text hover:bg-surface-secondary">Cancel</button>
                <button type="submit" className="rounded bg-primary px-4 py-2 text-xs font-medium text-on-primary hover:bg-primary-hover">Save Customer</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
