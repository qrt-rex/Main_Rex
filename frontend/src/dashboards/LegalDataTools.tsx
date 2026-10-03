import { useMemo, useState } from 'react';
import { AlertTriangle, Clock, Download, FileSpreadsheet, Upload, UserX } from 'lucide-react';
import { api } from '../lib/api';
import { useApi } from '../lib/useApi';
import { money, todayISO } from '../lib/format';
import { exportCsv, exportExcel, parseSpreadsheet } from '../lib/spreadsheet';
import { Button } from '../components/common/Button';
import { Checkbox, Input, Select } from '../components/common/Input';
import { Modal } from '../components/common/Modal';
import { useToast } from '../components/common/ToastContext';
import type { LegalClient } from './LegalClients';

type Row = Record<string, unknown>;
type Client = LegalClient & { pdf_available?: boolean };

const fetchAll = () => api.get<{ items: Client[] }>('/api/legal/clients').then((r) => r.items as Client[]);
const day = (c: Client) => (c.created_at || '').slice(0, 10);

// ---------------------------------------------------------------- overview
const tile = 'rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900';

/** The few numbers Legal acts on: what to check, what to assign, what is stuck. */
export function LegalOverview({ refreshKey }: { refreshKey: string }) {
  const all = useApi(fetchAll, [refreshKey]);
  const s = useMemo(() => {
    const items = all.data ?? [];
    const count = (st: string[]) => items.filter((c) => st.includes(c.status)).length;
    return {
      waiting: count(['PENDING', 'UNDER REVIEW']),
      blocked: count(['HOLD', 'REJECTED']),
      unassigned: items.filter((c) => !c.assigned_to).length,
    };
  }, [all.data]);

  // Only what needs someone to act. Totals and amounts live in the records and exports.
  const tiles = [
    { label: 'To check', value: s.waiting, hint: 'Waiting for your review', icon: Clock, tone: 'text-amber-600 bg-amber-50 dark:bg-amber-950/50 dark:text-amber-300' },
    { label: 'Give to someone', value: s.unassigned, hint: 'No one is handling these yet', icon: UserX, tone: 'text-slate-600 bg-slate-100 dark:bg-slate-800 dark:text-slate-300' },
    { label: 'Stuck', value: s.blocked, hint: 'On hold or rejected', icon: AlertTriangle, tone: 'text-rose-600 bg-rose-50 dark:bg-rose-950/50 dark:text-rose-300' },
  ];

  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {tiles.map(({ label, value, hint, icon: Icon, tone }) => (
        <div key={label} className={tile}>
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">{label}</p>
            <span className={`flex h-9 w-9 items-center justify-center rounded-full ${tone}`}><Icon size={18} /></span>
          </div>
          <p className="mt-2 text-3xl font-bold tabular-nums text-slate-900 dark:text-white">{all.data ? value : '…'}</p>
          <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">{hint}</p>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- export
const monthStart = (offset = 0) => {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() + offset);
  return d.toLocaleDateString('en-CA');
};
const monthEnd = (offset = 0) => {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() + offset + 1);
  d.setDate(0);
  return d.toLocaleDateString('en-CA');
};
const PRESETS: Record<string, () => [string, string]> = {
  'This month': () => [monthStart(), todayISO()],
  'Last month': () => [monthStart(-1), monthEnd(-1)],
  'Last 3 months': () => [monthStart(-2), todayISO()],
  'This year': () => [`${new Date().getFullYear()}-01-01`, todayISO()],
  'All time': () => ['', ''],
};

function toRow(c: Client): Row {
  return {
    'CRM ID': c.reference,
    Type: c.kind === 'record' ? 'Legal record' : 'Document form',
    'Company Name': c.company_name,
    'BDM Name': c.kind === 'record' ? c.bdm : '',
    'Submitted By': c.kind === 'document' ? c.bdm : '',
    'Contact Name': c.contact_name,
    Email: c.contact_email,
    Phone: c.contact_phone,
    GSTIN: c.gstin,
    Services: c.services.join(', '),
    Documents: c.documents.join(', '),
    'Amount Paid': c.amount ?? '',
    Status: c.status,
    'PDF Available': c.kind === 'record' ? (c.pdf_available ? 'Yes' : 'No') : '',
    'Assigned To': c.assigned_to?.name ?? '',
    Date: day(c),
  };
}

function printPdf(rows: Row[], title: string) {
  const esc = (v: unknown) => String(v ?? '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]!));
  const cols = ['CRM ID', 'Type', 'Company Name', 'BDM Name', 'Services', 'Amount Paid', 'Status', 'Assigned To', 'Date'];
  const w = window.open('', '_blank');
  if (!w) return false;
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>
    body{font-family:Segoe UI,Arial,sans-serif;margin:24px;color:#0f172a}h1{font-size:18px;margin:0 0 4px}p{margin:0 0 14px;color:#64748b;font-size:12px}
    table{border-collapse:collapse;width:100%;font-size:11px}th,td{border:1px solid #cbd5e1;padding:5px 6px;text-align:left;vertical-align:top}
    th{background:#f1f5f9}@page{size:A4 landscape;margin:12mm}</style></head><body>
    <h1>${esc(title)}</h1><p>${rows.length} record(s) · generated ${esc(new Date().toLocaleString('en-IN'))}</p>
    <table><thead><tr>${cols.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead>
    <tbody>${rows.map((r) => `<tr>${cols.map((c) => `<td>${esc(c === 'Amount Paid' && r[c] !== '' ? money(Number(r[c])) : r[c])}</td>`).join('')}</tr>`).join('')}</tbody></table>
    <script>window.onload=()=>{window.print()}</script></body></html>`);
  w.document.close();
  return true;
}

export function LegalExportButton() {
  const { showToast } = useToast();
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(todayISO());
  const [kind, setKind] = useState('');
  const [status, setStatus] = useState('');
  const [missingPdf, setMissingPdf] = useState(false);
  const [format, setFormat] = useState<'xlsx' | 'csv' | 'pdf'>('xlsx');
  const [busy, setBusy] = useState(false);

  const run = async () => {
    if (from && to && to < from) {
      showToast('The "to" date is before the "from" date.', 'error');
      return;
    }
    setBusy(true);
    try {
      const rows = (await fetchAll())
        .filter((c) => (!from || day(c) >= from) && (!to || day(c) <= to))
        .filter((c) => !kind || c.kind === kind)
        .filter((c) => !status || c.status === status)
        .filter((c) => !missingPdf || (c.kind === 'record' && !c.pdf_available))
        .map(toRow);
      if (!rows.length) {
        showToast('Nothing to export for these dates and filters.', 'info');
        return;
      }
      const range = from || to ? `${from || 'start'}_to_${to || todayISO()}` : 'all-time';
      const name = `Legal_${missingPdf ? 'missing-pdf_' : ''}${range}`;
      if (format === 'xlsx') await exportExcel({ 'Legal data': rows }, `${name}.xlsx`);
      else if (format === 'csv') exportCsv(rows, `${name}.csv`);
      else if (!printPdf(rows, `Legal data ${from || to ? `${from || '…'} to ${to || '…'}` : '(all time)'}`)) {
        showToast('Allow pop-ups for this site to save the PDF.', 'error');
        return;
      }
      showToast(`Exported ${rows.length} record(s)${format === 'pdf' ? ' — choose "Save as PDF" in the print window' : ''}`, 'success');
      setOpen(false);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Export failed', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}><Download size={15} /> Export</Button>
      {open && (
        <Modal open onClose={() => setOpen(false)} title="Export legal data" description="Download legal records and client document forms for the dates you choose."
          footer={<><Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button><Button onClick={run} loading={busy}><Download size={15} /> Download</Button></>}>
          <div className="space-y-4">
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(PRESETS).map(([label, get]) => (
                <button key={label} type="button" onClick={() => { const [f, t] = get(); setFrom(f); setTo(t); }}
                  className="rounded-full border border-border px-3 py-1 text-xs font-medium text-text-secondary hover:bg-neutral-bg hover:text-text">{label}</button>
              ))}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Input label="From date" type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} hint="Leave empty for the beginning" />
              <Input label="To date" type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} hint="Leave empty for today" />
              <Select label="Data" value={kind} onChange={(e) => setKind(e.target.value)}>
                <option value="">Legal records and document forms</option><option value="record">Legal records only</option><option value="document">Client document forms only</option>
              </Select>
              <Select label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="">All statuses</option>{['PENDING', 'UNDER REVIEW', 'APPROVED', 'HOLD', 'REJECTED'].map((s) => <option key={s}>{s}</option>)}
              </Select>
              <Select label="Format" value={format} onChange={(e) => setFormat(e.target.value as 'xlsx' | 'csv' | 'pdf')}>
                <option value="xlsx">Excel (.xlsx)</option><option value="csv">CSV</option><option value="pdf">PDF (print / save as PDF)</option>
              </Select>
            </div>
            <Checkbox label="Only legal records without a PDF" description="The old “Export Missing PDF” report" checked={missingPdf} onChange={(e) => setMissingPdf(e.target.checked)} />
          </div>
        </Modal>
      )}
    </>
  );
}

// ---------------------------------------------------------------- import
const TEMPLATE: Row[] = [{ 'CRM ID': '#3800', 'Company Name': 'Example Traders Pvt Ltd', 'BDM Name': 'Ahmedabad (A)', Services: 'GST Registration, MSME Registration', 'Amount Paid': 5000, Status: 'PENDING', 'PDF Available': 'No', Date: todayISO() }];
const pick = (r: Row, ...keys: string[]) => keys.map((k) => r[k]).find((v) => v !== undefined && v !== '') ?? '';

export function LegalImportButton({ onImported }: { onImported: () => void }) {
  const { showToast } = useToast();
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [fileName, setFileName] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ message: string; errors: { row: number; error: string }[] } | null>(null);

  const close = () => { setOpen(false); setRows(null); setFileName(''); setResult(null); };

  const choose = async (file?: File) => {
    if (!file) return;
    try {
      const parsed = await parseSpreadsheet(file);
      setRows(parsed.map((r) => ({
        crm_id: String(pick(r, 'crm_id', 'crm', 'crm_no', 'id')),
        company_name: String(pick(r, 'company_name', 'current_company', 'company', 'client', 'client_name')),
        bdm_name: String(pick(r, 'bdm_name', 'bdm', 'branch')),
        services: String(pick(r, 'services', 'service')),
        amount_paid: pick(r, 'amount_paid', 'amount_paid_with_gst', 'amount'),
        status: String(pick(r, 'status') || 'PENDING'),
        pdf_available: String(pick(r, 'pdf_available', 'pdf')),
        created_at: String(pick(r, 'date', 'created_at', 'created_on')),
      })));
      setFileName(file.name);
      setResult(null);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not read the file', 'error');
    }
  };

  const run = async () => {
    if (!rows) return;
    setBusy(true);
    try {
      const res = await api.post<{ message: string; imported: number; errors: { row: number; error: string }[] }>('/api/legal/records/import', rows);
      setResult(res);
      showToast(res.message, res.errors.length ? 'warning' : 'success');
      if (res.imported) onImported();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Import failed', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}><Upload size={15} /> Import</Button>
      {open && (
        <Modal open onClose={close} title="Import legal records" description="Add legal records from an Excel or CSV file. Rows whose CRM ID already exists are skipped."
          footer={result ? <Button onClick={close}>Done</Button> : <><Button variant="secondary" onClick={close}>Cancel</Button><Button onClick={run} loading={busy} disabled={!rows}><Upload size={15} /> Import {rows ? rows.length : ''} row{rows?.length === 1 ? '' : 's'}</Button></>}>
          <div className="space-y-4">
            <p>Columns: <b>CRM ID</b>, <b>Company Name</b>, BDM Name, Services (comma separated), Amount Paid, Status, PDF Available (Yes/No), Date. A file downloaded with Export can be imported back.</p>
            <Button variant="ghost" size="sm" onClick={() => exportExcel({ 'Legal records': TEMPLATE }, 'Legal_records_template.xlsx')}><FileSpreadsheet size={14} /> Download template</Button>
            <label className="flex cursor-pointer flex-col items-center gap-1 rounded-lg border border-dashed border-border px-4 py-6 text-center hover:bg-neutral-bg">
              <Upload size={18} className="text-text-muted" />
              <span className="text-sm font-medium text-text">{fileName || 'Choose a .xlsx, .xls or .csv file'}</span>
              {rows && <span className="text-xs text-text-muted">{rows.length} row(s) ready to import</span>}
              <input type="file" accept=".xlsx,.xls,.csv" className="sr-only" onChange={(e) => { choose(e.target.files?.[0]); e.target.value = ''; }} />
            </label>
            {result && (
              <div className="rounded-md border border-border p-3">
                <p className="font-medium text-text">{result.message}</p>
                {result.errors.length > 0 && (
                  <ul className="mt-2 max-h-40 space-y-0.5 overflow-y-auto text-xs text-danger">
                    {result.errors.map((e) => <li key={e.row}>Row {e.row}: {e.error}</li>)}
                  </ul>
                )}
              </div>
            )}
          </div>
        </Modal>
      )}
    </>
  );
}
