import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Download, FileUp, RotateCcw, Upload } from 'lucide-react';
import { api, saveBlob } from '../../lib/api';
import { executeImport, importJob, previewImport, type ImportJob, type ImportPreview } from '../api';
import { Badge } from '../../components/common/Badge';
import { Button } from '../../components/common/Button';
import { Card, CardHeader } from '../../components/common/Card';
import { Checkbox, Select } from '../../components/common/Input';
import { useToast } from '../../components/common/ToastContext';
import { PageHeader } from '../../components/layout/PageHeader';

const TARGETS = [['EMPLOYEES', 'Employee directory'], ['LEAVE_BALANCES', 'Leave balances & quotas']] as const;
const IGNORE = 'IGNORE';

function Step({ n, title, active, done }: { n: number; title: string; active: boolean; done: boolean }) {
  return (
    <li className="flex items-center gap-2">
      <span className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold ${done ? 'bg-success text-white' : active ? 'bg-primary text-on-primary' : 'bg-neutral-bg text-text-muted'}`}>
        {done ? <CheckCircle2 size={14} aria-hidden="true" /> : n}
      </span>
      <span className={`text-sm ${active || done ? 'font-medium text-text' : 'text-text-muted'}`}>{title}</span>
    </li>
  );
}

export function DataImport() {
  const { showToast } = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [target, setTarget] = useState<string>('EMPLOYEES');
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [dryRun, setDryRun] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [job, setJob] = useState<ImportJob | null>(null);
  const [running, setRunning] = useState(false);

  const step = job && ['COMPLETED', 'FAILED'].includes(job.status) ? 4 : jobId ? 3 : preview ? 2 : 1;

  const upload = async (file: File) => {
    if (!/\.(csv|xlsx|xls)$/i.test(file.name)) {
      showToast('Upload a .csv, .xlsx or .xls file', 'error');
      return;
    }
    setUploading(true);
    try {
      const p = await previewImport(file, target);
      setPreview(p);
      setMapping(Object.fromEntries(p.mappings.map((m) => [m.file_header, m.suggested_db_field || IGNORE])));
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not analyse the file', 'error');
    } finally {
      setUploading(false);
      if (input.current) input.current.value = '';
    }
  };

  const missingRequired = preview?.available_db_fields.filter((f) => f.required && !Object.values(mapping).includes(f.field)) ?? [];

  const run = async () => {
    if (!preview) return;
    setRunning(true);
    try {
      const res = await executeImport({
        file_id: preview.file_id, target_entity: preview.target_entity, confirmed_mappings: mapping, dry_run_only: dryRun,
        unique_key_field: preview.target_entity === 'EMPLOYEES' ? 'employee_code' : 'employee_id',
      });
      setJobId(res.job_id);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Import could not start', 'error');
    } finally {
      setRunning(false);
    }
  };

  useEffect(() => {
    if (!jobId) return;
    let stop = false;
    const tick = async () => {
      try {
        const j = await importJob(jobId);
        if (stop) return;
        setJob(j);
        if (['COMPLETED', 'FAILED'].includes(j.status)) {
          showToast(j.status === 'COMPLETED' ? `${dryRun ? 'Dry run' : 'Import'} finished` : 'Import failed', j.status === 'COMPLETED' ? 'success' : 'error');
          return;
        }
      } catch {
        if (stop) return;
      }
      setTimeout(tick, 1000);
    };
    tick();
    return () => { stop = true; };
  }, [jobId, dryRun, showToast]);

  const reset = () => {
    setPreview(null);
    setMapping({});
    setJobId(null);
    setJob(null);
  };

  const downloadErrors = async () => {
    if (!job?.error_report_file_url) return;
    try {
      saveBlob(await api.blob(job.error_report_file_url.replace(/^https?:\/\/[^/]+/, '')), `import-errors-${jobId?.slice(0, 8)}.xlsx`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not download the error report', 'error');
    }
  };

  return (
    <>
      <PageHeader title="Data import" description="Import spreadsheets with any column names: headers are matched to fields automatically." breadcrumbs={[{ label: 'HR' }, { label: 'Data import' }]} />
      <ol className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-2" aria-label="Import progress">
        <Step n={1} title="Upload" active={step === 1} done={step > 1} />
        <Step n={2} title="Review mapping" active={step === 2} done={step > 2} />
        <Step n={3} title="Import" active={step === 3} done={step > 3} />
      </ol>

      {step === 1 && (
        <Card>
          <CardHeader title="Upload a file" />
          <div className="space-y-4 p-4">
            <Select label="Import into" value={target} onChange={(e) => setTarget(e.target.value)} selectClassName="max-w-sm">
              {TARGETS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
            </Select>
            <button
              type="button"
              onClick={() => input.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => { e.preventDefault(); setDragging(false); if (e.dataTransfer.files[0]) upload(e.dataTransfer.files[0]); }}
              className={`flex w-full flex-col items-center rounded-lg border-2 border-dashed px-6 py-12 text-center transition-colors ${dragging ? 'border-primary bg-primary-soft' : 'border-border hover:border-border-strong hover:bg-surface-secondary'}`}
            >
              <FileUp size={28} className="mb-3 text-text-muted" aria-hidden="true" />
              <span className="text-sm font-medium text-text">{uploading ? 'Analysing columns…' : 'Drop a file here or click to browse'}</span>
              <span className="mt-1 text-xs text-text-muted">.csv, .xlsx or .xls</span>
            </button>
            <input ref={input} type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
          </div>
        </Card>
      )}

      {step === 2 && preview && (
        <Card>
          <CardHeader
            title="Review column mapping"
            description={`${preview.file_name} · ${preview.total_rows_detected} rows · into ${TARGETS.find(([id]) => id === preview.target_entity)?.[1] ?? preview.target_entity}`}
            actions={<Button variant="ghost" size="sm" onClick={reset}><RotateCcw size={14} /> Start over</Button>}
          />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="bg-surface-secondary text-left text-xs text-text-muted">
                  <th className="px-4 py-2.5 font-medium">Column in file</th>
                  <th className="px-4 py-2.5 font-medium">Sample values</th>
                  <th className="px-4 py-2.5 font-medium">Maps to</th>
                  <th className="px-4 py-2.5 font-medium">Match</th>
                </tr>
              </thead>
              <tbody>
                {preview.mappings.map((m) => {
                  const conf = Math.round(m.confidence_score * 100);
                  return (
                    <tr key={m.file_header} className="border-t border-border">
                      <td className="px-4 py-2.5 font-medium text-text">{m.file_header}</td>
                      <td className="max-w-56 truncate px-4 py-2.5 text-xs text-text-muted">{m.sample_values.join(', ') || '—'}</td>
                      <td className="px-4 py-2.5">
                        <Select aria-label={`Field for ${m.file_header}`} value={mapping[m.file_header]} onChange={(e) => setMapping((s) => ({ ...s, [m.file_header]: e.target.value }))} selectClassName="w-60">
                          <option value={IGNORE}>Don't import</option>
                          {preview.available_db_fields.map((f) => <option key={f.field} value={f.field}>{f.label}{f.required ? ' *' : ''}</option>)}
                        </Select>
                      </td>
                      <td className="px-4 py-2.5">
                        {m.confidence_score >= 0.7 ? <Badge tone="success">{conf}%</Badge> : m.confidence_score >= 0.5 ? <Badge tone="warning">{conf}%</Badge> : <Badge tone="neutral">Choose</Badge>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center gap-3 border-t border-border p-4">
            {missingRequired.length > 0 ? (
              <p role="alert" className="text-sm text-danger">Map the required fields: {missingRequired.map((f) => f.label).join(', ')}</p>
            ) : (
              <Checkbox label="Dry run" description="Validate every row without saving" checked={dryRun} onChange={(e) => setDryRun(e.target.checked)} />
            )}
            <Button className="ml-auto" onClick={run} loading={running} disabled={missingRequired.length > 0}><Upload size={15} /> {dryRun ? 'Validate rows' : 'Import rows'}</Button>
          </div>
        </Card>
      )}

      {step >= 3 && (
        <Card>
          <CardHeader title={dryRun ? 'Dry run' : 'Import'} description={job ? `Status: ${job.status.toLowerCase()} · ${job.total_rows ?? 0} rows` : 'Starting…'} />
          <div className="space-y-4 p-4">
            <div>
              <div className="mb-1 flex justify-between text-xs text-text-muted"><span>Progress</span><span className="tabular-nums">{job?.progress_percentage ?? 0}%</span></div>
              <div className="h-2 overflow-hidden rounded-full bg-neutral-bg" role="progressbar" aria-valuenow={job?.progress_percentage ?? 0} aria-valuemin={0} aria-valuemax={100}>
                <div className="h-full rounded-full bg-primary transition-[width] duration-300" style={{ width: `${job?.progress_percentage ?? 0}%` }} />
              </div>
            </div>
            {step === 4 && job && (
              <>
                <div className="grid grid-cols-3 gap-3">
                  {([['Inserted', job.inserted_count, 'text-success'], ['Updated', job.updated_count, 'text-info'], ['Failed', job.failed_count, 'text-danger']] as const).map(([label, value, tone]) => (
                    <div key={label} className="rounded-md border border-border p-3 text-center">
                      <p className={`text-2xl font-semibold tabular-nums ${tone}`}>{value ?? 0}</p>
                      <p className="text-xs text-text-muted">{label}</p>
                    </div>
                  ))}
                </div>
                <div className="flex flex-wrap gap-2">
                  {job.error_report_file_url && <Button variant="secondary" onClick={downloadErrors}><Download size={15} /> Download failed rows</Button>}
                  <Button onClick={reset}><RotateCcw size={15} /> Import another file</Button>
                </div>
              </>
            )}
          </div>
        </Card>
      )}
    </>
  );
}
