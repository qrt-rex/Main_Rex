import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { todayISO } from '../lib/format';
import { Button } from '../components/common/Button';
import { Input, Select, Textarea } from '../components/common/Input';
import { Modal } from '../components/common/Modal';
import { PRIORITIES } from './api';
import { title } from './ui';

interface ClientLike { kind: string; id: string; company_name: string; reference: string; services: string[]; documents: string[] }
interface MemberLike { id: string; name: string; role_label: string }

const plusDays = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toLocaleDateString('en-CA'); };

/**
 * Legal dashboard → "Assign Admin Member". Creates the client's work record in the member's Need Action
 * (or hands open work to the new member) and tells them at once.
 */
export function AssignClientModal<T>({ client, member, onClose, onAssigned }: {
  client: ClientLike | null; member: MemberLike | null; onClose: () => void; onAssigned: (updated: T) => void;
}) {
  const [workType, setWorkType] = useState('');
  const [priority, setPriority] = useState('MEDIUM');
  const [deadline, setDeadline] = useState(plusDays(7));
  const [action, setAction] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const open = !!client && !!member;

  useEffect(() => {
    if (!client) return;
    setWorkType((client.services.length ? client.services : client.documents).join(', ').slice(0, 120));
    setPriority('MEDIUM'); setDeadline(plusDays(7)); setAction(''); setNotes(''); setError('');
  }, [client]);

  const submit = async () => {
    if (!client || !member) return;
    setBusy(true);
    setError('');
    try {
      const updated = await api.put<T>(`/api/legal/clients/${client.kind}/${client.id}/assign`, {
        user_id: member.id, work_type: workType.trim(), priority, deadline, required_action: action.trim(), notes: notes.trim(),
      });
      onAssigned(updated);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not assign this client.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} closeOnOverlay={false} size="lg" title={`Assign ${client?.company_name ?? 'client'}`}
      description={member ? `To ${member.name} · ${member.role_label}. It appears in their Need Action list immediately.` : undefined}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} disabled={!deadline} onClick={submit}>Assign client</Button></>}>
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (!busy && deadline) submit(); }}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Input label="Work type" value={workType} onChange={(e) => setWorkType(e.target.value)} placeholder="GST Compliance" hint="Defaults to the client's services" />
          <Select label="Priority" value={priority} onChange={(e) => setPriority(e.target.value)}>{PRIORITIES.map((p) => <option key={p} value={p}>{title(p)}</option>)}</Select>
        </div>
        <Input label="Deadline" required type="date" min={todayISO()} value={deadline} onChange={(e) => setDeadline(e.target.value)} />
        <Textarea label="Required action" rows={2} value={action} onChange={(e) => setAction(e.target.value)} placeholder="Collect GST documents and file the registration" hint="Becomes the member's first task" />
        <Textarea label="Notes for the member" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        {error && <p role="alert" className="rounded-md border border-danger/30 bg-danger-bg px-3 py-2 text-sm text-danger">{error}</p>}
      </form>
    </Modal>
  );
}
