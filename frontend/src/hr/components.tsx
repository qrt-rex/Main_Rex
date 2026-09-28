import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronDown, Download, FileSpreadsheet, Printer, Upload } from 'lucide-react';
import { printablePayslip } from './api';
import { API_BASE } from '../lib/api';
import { downloadTemplate, exportCsv, exportExcel, parseSpreadsheet } from '../lib/spreadsheet';
import { Button } from '../components/common/Button';
import { Dropdown, DropdownItem, DropdownSeparator } from '../components/common/Dropdown';
import { Modal } from '../components/common/Modal';
import { useToast } from '../components/common/ToastContext';

type Row = Record<string, unknown>;

/** Export current records (fetched on demand) to Excel/CSV, plus the import template. */
export function ExportMenu({ fetchRows, filename, sheet, template }: {
  fetchRows: () => Promise<Row[]>;
  filename: string;
  sheet: string;
  template?: 'employee' | 'intern' | 'candidate';
}) {
  const { showToast } = useToast();
  const run = async (format: 'xlsx' | 'csv') => {
    try {
      const rows = await fetchRows();
      if (!rows.length) {
        showToast('There are no records to export', 'info');
        return;
      }
      const name = `${filename}-${new Date().toISOString().slice(0, 10)}.${format}`;
      if (format === 'csv') exportCsv(rows, name);
      else await exportExcel({ [sheet]: rows }, name);
      showToast(`Exported ${rows.length} records`, 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Export failed', 'error');
    }
  };
  return (
    <Dropdown
      label="Export"
      width="w-52"
      triggerClassName="h-9 gap-1.5 border border-border bg-surface px-3 text-sm font-medium text-text shadow-[var(--shadow-card)] hover:bg-surface-secondary"
      trigger={<><Download size={15} /> Export <ChevronDown size={14} className="text-text-muted" /></>}
    >
      <DropdownItem icon={<FileSpreadsheet size={15} />} onClick={() => run('xlsx')}>Excel (.xlsx)</DropdownItem>
      <DropdownItem icon={<Download size={15} />} onClick={() => run('csv')}>CSV (.csv)</DropdownItem>
      {template && (
        <>
          <DropdownSeparator />
          <DropdownItem icon={<FileSpreadsheet size={15} />} onClick={() => downloadTemplate(template)}>Download import template</DropdownItem>
        </>
      )}
    </Dropdown>
  );
}

interface PreviewColumn { header: string; value: (r: Row) => ReactNode }

/** "Import" button → parse file → preview up to 50 rows → confirm → bulk endpoint. */
export function ImportButton({ noun, columns, onImport }: {
  noun: string;
  columns: PreviewColumn[];
  onImport: (rows: Row[]) => Promise<{ message?: string }>;
}) {
  const { showToast } = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [fileName, setFileName] = useState('');
  const [saving, setSaving] = useState(false);

  const pick = async (file: File) => {
    try {
      setRows(await parseSpreadsheet(file));
      setFileName(file.name);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not read that file', 'error');
    } finally {
      if (input.current) input.current.value = '';
    }
  };

  const confirmImport = async () => {
    if (!rows) return;
    setSaving(true);
    try {
      const res = await onImport(rows);
      showToast(res.message || `Imported ${rows.length} ${noun}`, 'success');
      setRows(null);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Import failed', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <input ref={input} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(e) => e.target.files?.[0] && pick(e.target.files[0])} />
      <Button variant="secondary" onClick={() => input.current?.click()}><Upload size={15} /> Import</Button>
      <Modal
        open={!!rows}
        onClose={() => setRows(null)}
        size="xl"
        closeOnOverlay={false}
        title={`Import ${noun}`}
        description={rows ? `${rows.length} records found in ${fileName}. Review before importing.` : undefined}
        footer={<>
          <Button variant="secondary" onClick={() => setRows(null)}>Cancel</Button>
          <Button onClick={confirmImport} loading={saving}>Import {rows?.length} {noun}</Button>
        </>}
      >
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-surface-secondary text-left text-xs text-text-muted">
                {columns.map((c) => <th key={c.header} className="px-3 py-2 font-medium">{c.header}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows?.slice(0, 50).map((r, i) => (
                <tr key={i} className="border-t border-border">
                  {columns.map((c) => <td key={c.header} className="whitespace-nowrap px-3 py-2 text-text">{c.value(r) || '—'}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {rows && rows.length > 50 && <p className="mt-2 text-xs text-text-muted">…and {rows.length - 50} more rows</p>}
      </Modal>
    </>
  );
}

/**
 * Printable payslip fetched with the user's session. Rendered in a sandbox without
 * `allow-scripts`, so the server-generated HTML can't run code, while `allow-same-origin`
 * + `allow-modals` still let us call print() on it.
 */
export function PayslipPreview({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { showToast } = useToast();
  const frame = useRef<HTMLIFrameElement>(null);
  const [html, setHtml] = useState<string | null>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!id) return;
    setHtml(null);
    printablePayslip(id)
      // <base>: the payslip's assets (logo) are root-relative to the API host.
      // The template's own print bar is hidden — this modal provides that action.
      .then((doc) => {
        const inject = `<base href="${API_BASE}/"><style>.no-print-bar{display:none!important}</style>`;
        setHtml(/<head[^>]*>/i.test(doc) ? doc.replace(/<head[^>]*>/i, (m) => m + inject) : inject + doc);
      })
      .catch((err) => {
        showToast(err instanceof Error ? err.message : 'Could not load the payslip', 'error');
        closeRef.current();
      });
  }, [id, showToast]);

  return (
    <Modal
      open={!!id}
      onClose={onClose}
      size="xl"
      title="Payslip"
      footer={<><Button variant="secondary" onClick={onClose}>Close</Button><Button onClick={() => frame.current?.contentWindow?.print()} disabled={!html}><Printer size={15} /> Print or save as PDF</Button></>}
    >
      {html === null ? (
        <div className="h-[60vh] animate-pulse rounded-md bg-neutral-bg" />
      ) : (
        <iframe ref={frame} title="Payslip preview" srcDoc={html} sandbox="allow-same-origin allow-modals" className="h-[65vh] w-full rounded-md border border-border bg-white" />
      )}
    </Modal>
  );
}

/** Label/value grid used by profile drawers. */
export function DetailList({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
      {items.map(([label, value]) => (
        <div key={label} className="min-w-0">
          <dt className="text-xs text-text-muted">{label}</dt>
          <dd className="mt-0.5 break-words text-sm text-text">{value || '—'}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-t border-border pt-4 first:border-0 first:pt-0">
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-text-muted">{title}</h3>
      {children}
    </section>
  );
}

/** Toolbar row above a table: filters left, count right. */
export function Toolbar({ children, count }: { children: ReactNode; count?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
      {children}
      {count !== undefined && <span className="ml-auto text-xs text-text-muted">{count}</span>}
    </div>
  );
}
