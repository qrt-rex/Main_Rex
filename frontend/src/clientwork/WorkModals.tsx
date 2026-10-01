import { useEffect, useState, type ReactNode } from 'react';
import { api } from '../lib/api';
import { todayISO } from '../lib/format';
import { Button } from '../components/common/Button';
import { Input, Select, Textarea, Checkbox } from '../components/common/Input';
import { Modal } from '../components/common/Modal';
import { useToast } from '../components/common/ToastContext';
import { PRIORITIES, cw, type ClientRequest, type HoldType, type Priority, type Task, type WorkDetail } from './api';
import { title } from './ui';

/** Shared behaviour of every action dialog: busy state, server errors shown inline and as a toast, close on success. */
function useAction(onDone: () => void) {
  const { showToast } = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const run = async (fn: () => Promise<{ message?: string } | unknown>, fallback: string) => {
    setBusy(true);
    setError('');
    try {
      const r = (await fn()) as { message?: string } | undefined;
      showToast(r?.message ?? fallback, 'success');
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, run, setError };
}

function Dialog({ open, onClose, title: t, description, error, busy, submitLabel, tone = 'primary', disabled, onSubmit, children, size = 'md' }: {
  open: boolean; onClose: () => void; title: string; description?: ReactNode; error?: string; busy?: boolean; submitLabel: string;
  tone?: 'primary' | 'danger'; disabled?: boolean; onSubmit: () => void; children: ReactNode; size?: 'sm' | 'md' | 'lg';
}) {
  return (
    <Modal open={open} onClose={onClose} title={t} description={description} size={size} closeOnOverlay={false}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button variant={tone === 'danger' ? 'danger' : 'primary'} loading={busy} disabled={disabled} onClick={onSubmit}>{submitLabel}</Button></>}>
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (!disabled && !busy) onSubmit(); }}>
        {children}
        {error && <p role="alert" className="rounded-md border border-danger/30 bg-danger-bg px-3 py-2 text-sm text-danger">{error}</p>}
      </form>
    </Modal>
  );
}

interface Common { work: WorkDetail; open: boolean; onClose: () => void; onDone: () => void }

export function HoldModal({ work, open, onClose, onDone }: Common) {
  const a = useAction(() => { onDone(); onClose(); });
  const [type, setType] = useState<HoldType>('WAITING_FOR_CLIENT');
  const [reason, setReason] = useState('');
  const [required, setRequired] = useState('');
  const [items, setItems] = useState('');
  const [expected, setExpected] = useState('');
  const [note, setNote] = useState('');
  useEffect(() => { if (open) { setType('WAITING_FOR_CLIENT'); setReason(''); setRequired(''); setItems(''); setExpected(''); setNote(''); a.setError(''); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const waiting = type === 'WAITING_FOR_CLIENT';
  const list = items.split('\n').map((s) => s.trim()).filter(Boolean);
  const valid = reason.trim() && note.trim() && (!waiting || (required.trim() && list.length > 0 && expected));
  return (
    <Dialog open={open} onClose={onClose} title="Put work on hold" size="lg" busy={a.busy} error={a.error} submitLabel="Put on hold" disabled={!valid}
      description={`${work.client_name} · work stops here until it is resumed. Time on hold is tracked separately from working time.`}
      onSubmit={() => a.run(() => cw.hold(work.id, { hold_type: type, reason: reason.trim(), required_from_client: required.trim(), pending_documents: list, expected_response_date: expected || null, internal_note: note.trim() }), 'Work put on hold.')}>
      <fieldset className="grid gap-2 sm:grid-cols-2">
        <legend className="mb-1.5 text-[13px] font-medium text-text-secondary">What is blocking the work?</legend>
        {([['WAITING_FOR_CLIENT', 'Waiting for client', 'A document, information or action only the client can provide'], ['INTERNAL_BLOCKER', 'Internal blocker', 'Something inside the company is stopping progress']] as [HoldType, string, string][]).map(([v, l, d]) => (
          <label key={v} className={`cursor-pointer rounded-md border p-3 ${type === v ? 'border-primary bg-primary-soft' : 'border-border hover:border-border-strong'}`}>
            <input type="radio" name="hold-type" className="sr-only" checked={type === v} onChange={() => setType(v)} />
            <span className="block text-sm font-medium text-text">{l}</span><span className="block text-xs text-text-muted">{d}</span>
          </label>
        ))}
      </fieldset>
      <Textarea label="Hold reason" required rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={waiting ? "Waiting for client's bank statement." : 'GST portal is down for maintenance.'} />
      {waiting && (
        <>
          <Input label="Required from client" required value={required} onChange={(e) => setRequired(e.target.value)} placeholder="Bank Statement - April to September" />
          <Textarea label="Pending documents / items" required rows={3} value={items} onChange={(e) => setItems(e.target.value)} hint={`One per line (${list.length} listed). Each becomes a request the client owes; when all are answered the work returns to Need Action by itself.`} placeholder={'Bank Statement\nPAN Copy'} />
          <Input label="Expected client response date" required type="date" min={todayISO()} value={expected} onChange={(e) => setExpected(e.target.value)} />
        </>
      )}
      <Textarea label="Internal note" required rows={2} value={note} onChange={(e) => setNote(e.target.value)} hint="Visible to your Legal team and administrators." />
    </Dialog>
  );
}

export function NoteDialog({ work, open, onClose, onDone, kind, taskId }: Common & { kind: 'NOTE' | 'COMMENT' | 'ISSUE'; taskId?: string | null }) {
  const a = useAction(() => { onDone(); onClose(); });
  const [text, setText] = useState('');
  const [critical, setCritical] = useState(false);
  useEffect(() => { if (open) { setText(''); setCritical(false); a.setError(''); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const label = { NOTE: 'Internal note', COMMENT: 'Comment', ISSUE: 'Issue' }[kind];
  return (
    <Dialog open={open} onClose={onClose} title={`Add ${label.toLowerCase()}`} busy={a.busy} error={a.error} submitLabel={`Add ${label.toLowerCase()}`} disabled={!text.trim()}
      description={kind === 'ISSUE' ? 'An unresolved critical issue stops the work from being marked completed.' : work.client_name}
      onSubmit={() => a.run(() => cw.comment(work.id, { text: text.trim(), kind, task_id: taskId ?? null, critical }), `${label} added.`)}>
      <Textarea label={label} required rows={4} value={text} onChange={(e) => setText(e.target.value)} />
      {kind === 'ISSUE' && <Checkbox checked={critical} onChange={(e) => setCritical(e.target.checked)} label="Critical issue" description="Blocks completion until it is resolved" />}
    </Dialog>
  );
}

export function RequestDialog({ work, open, onClose, onDone, kind }: Common & { kind: 'DOCUMENT' | 'INFORMATION' }) {
  const a = useAction(() => { onDone(); onClose(); });
  const [label, setLabel] = useState('');
  const [expected, setExpected] = useState('');
  const [note, setNote] = useState('');
  const [mandatory, setMandatory] = useState(true);
  useEffect(() => { if (open) { setLabel(''); setExpected(''); setNote(''); setMandatory(true); a.setError(''); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const doc = kind === 'DOCUMENT';
  return (
    <Dialog open={open} onClose={onClose} title={doc ? 'Request document from client' : 'Request information'} busy={a.busy} error={a.error} submitLabel="Send request" disabled={!label.trim()}
      description="It is added to this client's Waiting for Client list until it is received."
      onSubmit={() => a.run(() => cw.requestFromClient(work.id, { kind, label: label.trim(), expected_date: expected || null, note: note.trim(), mandatory }), 'Requested from the client.')}>
      <Input label={doc ? 'Document needed' : 'Information needed'} required value={label} onChange={(e) => setLabel(e.target.value)} placeholder={doc ? 'PAN Copy' : 'Date of incorporation'} />
      <Input label="Expected response date" type="date" min={todayISO()} value={expected} onChange={(e) => setExpected(e.target.value)} />
      <Textarea label="Note to the client (optional)" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
      <Checkbox checked={mandatory} onChange={(e) => setMandatory(e.target.checked)} label="Required to complete the work" description="Completion is blocked until it is received" />
    </Dialog>
  );
}

export function UploadDialog({ work, open, onClose, onDone, requests, taskId, requestId }: Common & { requests: ClientRequest[]; taskId?: string | null; requestId?: string }) {
  const a = useAction(() => { onDone(); onClose(); });
  const [file, setFile] = useState<File | null>(null);
  const [label, setLabel] = useState('');
  const [req, setReq] = useState('');
  const [note, setNote] = useState('');
  useEffect(() => { if (open) { setFile(null); setLabel(''); setReq(requestId ?? ''); setNote(''); a.setError(''); } }, [open, requestId]); // eslint-disable-line react-hooks/exhaustive-deps
  const pending = requests.filter((r) => r.status === 'PENDING' && r.kind === 'DOCUMENT');
  return (
    <Dialog open={open} onClose={onClose} title="Upload document" busy={a.busy} error={a.error} submitLabel="Upload" disabled={!file}
      description="PDF, image, Word, Excel, PowerPoint, CSV or text, up to 10 MB."
      onSubmit={() => file && a.run(() => cw.upload(work.id, file, { label: label.trim(), request_id: req, task_id: taskId ?? undefined, note: note.trim() }), 'Document uploaded.')}>
      <div>
        <label htmlFor="cw-file" className="mb-1.5 block text-[13px] font-medium text-text-secondary">File <span className="text-danger">*</span></label>
        <input id="cw-file" type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="block w-full text-sm text-text file:mr-3 file:rounded-md file:border file:border-border file:bg-surface file:px-3 file:py-1.5 file:text-sm file:font-medium hover:file:bg-surface-secondary" />
      </div>
      {pending.length > 0 && (
        <Select label="This answers a client request" value={req} onChange={(e) => setReq(e.target.value)} hint="Choosing one marks it received; a work waiting only on these returns to Need Action by itself.">
          <option value="">— Not a requested document —</option>
          {pending.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
        </Select>
      )}
      <Input label="Label" value={label} onChange={(e) => setLabel(e.target.value)} placeholder={pending.find((r) => r.id === req)?.label ?? 'Defaults to the file name'} />
      <Input label="Note" value={note} onChange={(e) => setNote(e.target.value)} />
    </Dialog>
  );
}

export function ResponseDialog({ work, open, onClose, onDone, requests }: Common & { requests: ClientRequest[] }) {
  const a = useAction(() => { onDone(); onClose(); });
  const pending = requests.filter((r) => r.status === 'PENDING');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [note, setNote] = useState('');
  useEffect(() => { if (open) { setPicked(new Set(pending.map((r) => r.id))); setNote(''); a.setError(''); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const toggle = (id: string) => setPicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  return (
    <Dialog open={open} onClose={onClose} title="Record client response" busy={a.busy} error={a.error} submitLabel="Record response" disabled={!note.trim() || picked.size === 0}
      description="Use this when the client answered by email, phone or WhatsApp. If nothing is left to wait for, the work returns to Need Action."
      onSubmit={() => a.run(() => cw.clientResponse(work.id, { note: note.trim(), request_ids: [...picked] }), 'Client response recorded.')}>
      <fieldset className="space-y-2">
        <legend className="mb-1 text-[13px] font-medium text-text-secondary">What did the client provide?</legend>
        {pending.map((r) => <Checkbox key={r.id} checked={picked.has(r.id)} onChange={() => toggle(r.id)} label={r.label} description={r.kind === 'DOCUMENT' ? 'Document' : 'Information'} />)}
      </fieldset>
      <Textarea label="Response note" required rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Client emailed the PAN copy on 3 Oct." />
    </Dialog>
  );
}

export function DetailsDialog({ work, open, onClose, onDone, focus }: Common & { focus?: 'priority' | 'deadline' }) {
  const a = useAction(() => { onDone(); onClose(); });
  const [priority, setPriority] = useState<Priority>(work.priority);
  const [deadline, setDeadline] = useState(work.deadline ?? '');
  const [action, setAction] = useState(work.required_action);
  const [type, setType] = useState(work.work_type);
  const [note, setNote] = useState('');
  useEffect(() => { if (open) { setPriority(work.priority); setDeadline(work.deadline ?? ''); setAction(work.required_action); setType(work.work_type); setNote(''); a.setError(''); } }, [open, work]); // eslint-disable-line react-hooks/exhaustive-deps
  const changed = priority !== work.priority || deadline !== (work.deadline ?? '') || action !== work.required_action || type !== work.work_type;
  const heading = focus === 'priority' ? 'Change priority' : focus === 'deadline' ? 'Change deadline' : 'Edit work details';
  return (
    <Dialog open={open} onClose={onClose} title={heading} busy={a.busy} error={a.error} submitLabel="Save changes" disabled={!changed}
      description="Every change is recorded in the activity timeline with the old and new value."
      onSubmit={() => a.run(() => cw.update(work.id, {
        ...(priority !== work.priority ? { priority } : {}), ...(deadline !== (work.deadline ?? '') ? { deadline } : {}),
        ...(action !== work.required_action ? { required_action: action } : {}), ...(type !== work.work_type ? { work_type: type } : {}), note: note.trim(),
      }), 'Work updated.')}>
      {(!focus || focus === 'priority') && (
        <Select label="Priority" value={priority} onChange={(e) => setPriority(e.target.value as Priority)}>{PRIORITIES.map((p) => <option key={p} value={p}>{title(p)}</option>)}</Select>
      )}
      {(!focus || focus === 'deadline') && <Input label="Deadline" type="date" min={todayISO()} value={deadline} onChange={(e) => setDeadline(e.target.value)} />}
      {!focus && (
        <>
          <Input label="Work type" value={type} onChange={(e) => setType(e.target.value)} />
          <Textarea label="Required action" rows={2} value={action} onChange={(e) => setAction(e.target.value)} />
        </>
      )}
      <Input label="Reason (optional)" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Client escalated the request" />
    </Dialog>
  );
}

export function TaskDialog({ work, open, onClose, onDone, task }: Common & { task?: Task | null }) {
  const a = useAction(() => { onDone(); onClose(); });
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [due, setDue] = useState('');
  const [priority, setPriority] = useState<Priority>('MEDIUM');
  const [required, setRequired] = useState(true);
  useEffect(() => {
    if (open) { setName(task?.name ?? ''); setDesc(task?.description ?? ''); setDue(task?.due_date ?? ''); setPriority(task?.priority ?? 'MEDIUM'); setRequired(task?.required ?? true); a.setError(''); }
  }, [open, task]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Dialog open={open} onClose={onClose} title={task ? 'Edit task' : 'Add task'} busy={a.busy} error={a.error} submitLabel={task ? 'Save task' : 'Add task'} disabled={!name.trim()}
      description={task ? undefined : `Assigned to ${work.assigned_to.name}`}
      onSubmit={() => a.run(() => (task
        ? cw.updateTask(task.id, { name: name.trim(), description: desc.trim(), due_date: due || null, priority, version: task.version })
        : cw.createTask(work.id, { name: name.trim(), description: desc.trim(), due_date: due || null, priority, required })), task ? 'Task updated.' : 'Task created.')}>
      <Input label="Task name" required value={name} onChange={(e) => setName(e.target.value)} placeholder="Collect GST documents" />
      <Textarea label="Description" rows={3} value={desc} onChange={(e) => setDesc(e.target.value)} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Input label="Due date" type="date" value={due} onChange={(e) => setDue(e.target.value)} />
        <Select label="Priority" value={priority} onChange={(e) => setPriority(e.target.value as Priority)}>{PRIORITIES.map((p) => <option key={p} value={p}>{title(p)}</option>)}</Select>
      </div>
      {!task && <Checkbox checked={required} onChange={(e) => setRequired(e.target.checked)} label="Required to complete the work" description="Optional tasks never block completion" />}
    </Dialog>
  );
}

export function NoteOnlyDialog({ open, onClose, heading, description, label, submitLabel, tone = 'primary', required = true, onSubmit, children }: {
  open: boolean; onClose: () => void; heading: string; description?: ReactNode; label: string; submitLabel: string; tone?: 'primary' | 'danger'; required?: boolean;
  onSubmit: (note: string) => Promise<unknown>; children?: ReactNode;
}) {
  const a = useAction(onClose);
  const [note, setNote] = useState('');
  useEffect(() => { if (open) { setNote(''); a.setError(''); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Dialog open={open} onClose={onClose} title={heading} description={description} busy={a.busy} error={a.error} submitLabel={submitLabel} tone={tone} disabled={required && !note.trim()}
      onSubmit={() => a.run(() => onSubmit(note.trim()), 'Done.')}>
      {children}
      <Textarea label={label} required={required} rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
    </Dialog>
  );
}

interface Staff { id: string; name: string; email: string; role_label: string }
export function ReassignDialog({ work, open, onClose, onDone }: Common) {
  const a = useAction(() => { onDone(); onClose(); });
  const [staff, setStaff] = useState<Staff[]>([]);
  const [user, setUser] = useState('');
  const [note, setNote] = useState('');
  useEffect(() => {
    if (!open) return;
    setUser(''); setNote(''); a.setError('');
    api.get<{ staff: Staff[] }>('/api/legal/staff').then((r) => setStaff(r.staff)).catch(() => a.setError('Could not load the staff list.'));
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Dialog open={open} onClose={onClose} title="Reassign client work" busy={a.busy} error={a.error} submitLabel="Reassign" disabled={!user}
      description={`${work.client_name} is currently handled by ${work.assigned_to.name}. Tasks, history and time tracking stay with the work.`}
      onSubmit={() => a.run(() => cw.reassign(work.id, user, note.trim()), 'Work reassigned.')}>
      <Select label="New member" required value={user} onChange={(e) => setUser(e.target.value)}>
        <option value="">Select a member…</option>
        {staff.filter((s) => s.id !== work.assignee_id).map((s) => <option key={s.id} value={s.id}>{s.name} · {s.role_label}</option>)}
      </Select>
      <Input label="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
    </Dialog>
  );
}
