import { useState, useEffect } from 'react';
import {
  Database,
  Search, 
  X, 
  FileText, 
  ExternalLink,
  ChevronLeft,
  ChevronRight,
  Filter
} from 'lucide-react';
import { CheckCircle2, FolderOpen, Scale, Target, UserCheck } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { api, API_BASE } from '../lib/api';
import { useToast } from '../components/common/ToastContext';
import { LegalClientDocuments } from './LegalClientDocuments';
import { LegalApprovals, LegalAssignClients } from './LegalClients';
import { LegalExportButton, LegalImportButton, LegalOverview } from './LegalDataTools';

type LegalSection = 'records' | 'documents' | 'assign' | 'approvals';
const LEGAL_SECTIONS: { id: LegalSection; label: string; description: string; icon: typeof Scale }[] = [
  { id: 'records', label: 'Legal records', description: 'Legal document review and compliance management', icon: Scale },
  { id: 'documents', label: 'Client documents', description: 'Document forms staff collected from clients', icon: FolderOpen },
  { id: 'assign', label: 'Assign clients', description: 'Give each client to the staff member who handles it', icon: UserCheck },
  { id: 'approvals', label: 'Approvals', description: "Every assigned client's services, approved here and billed in Bill & Invoices", icon: CheckCircle2 },
];

interface LegalRecord {
  id?: string;
  _id?: string;
  crm_id: string;
  company_name: string;
  bdm_name: string;
  services: string[];
  amount_paid: number;
  status: 'PENDING' | 'UNDER REVIEW' | 'APPROVED' | 'HOLD' | 'REJECTED' | string;
  pdf_available: boolean;
  created_at?: string;
}

interface ApiResponse {
  records: LegalRecord[];
  total: number;
  bdms: string[];
  services: string[];
  statuses: string[];
}

export function LegalDashboard() {
  const { showToast } = useToast();
  const { can } = useAuth();
  // Bumped after an import so the overview tiles re-count.
  const [dataVersion, setDataVersion] = useState(0);
  // The open section lives in the URL (?section=…) so it survives a refresh and can be linked.
  const [params, setParams] = useSearchParams();
  const section = (LEGAL_SECTIONS.some((s) => s.id === params.get('section')) ? params.get('section') : 'records') as LegalSection;
  const setSection = (id: LegalSection) => setParams(id === 'records' ? {} : { section: id }, { replace: true });

  const [records, setRecords] = useState<LegalRecord[]>([]);
  const [totalCount, setTotalCount] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(true);

  // Filter options
  const [bdmOptions, setBdmOptions] = useState<string[]>([]);
  const [serviceOptions, setServiceOptions] = useState<string[]>([]);

  // Filter states
  const [selectedBdm, setSelectedBdm] = useState<string>('All BDMs');
  const [selectedService, setSelectedService] = useState<string>('All Services');
  const [selectedStatus, setSelectedStatus] = useState<string>('All Status');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Pagination
  const [currentPage, setCurrentPage] = useState<number>(1);
  const pageSize = 25;

  // PDF Preview Modal
  const [previewPdfCrmId, setPreviewPdfCrmId] = useState<string | null>(null);

  // Status edit modal / quick update
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const fetchRecords = async () => {
    try {
      setLoading(true);
      const params: Record<string, string | number> = {
        skip: (currentPage - 1) * pageSize,
        limit: pageSize,
      };
      if (selectedBdm !== 'All BDMs') params.bdm = selectedBdm;
      if (selectedService !== 'All Services') params.service = selectedService;
      if (selectedStatus !== 'All Status') params.status = selectedStatus;
      if (searchQuery.trim()) params.search = searchQuery.trim();

      const data = await api.get<ApiResponse>('/api/legal/records', params);
      setRecords(data.records || []);
      setTotalCount(data.total || 0);

      if (data.bdms && data.bdms.length > 0) setBdmOptions(data.bdms);
      if (data.services && data.services.length > 0) setServiceOptions(data.services);
    } catch (err) {
      showToast("Could not load legal records. Please check your connection.", "error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRecords();
  }, [selectedBdm, selectedService, selectedStatus, searchQuery, currentPage]);

  const clearFilters = () => {
    setSelectedBdm('All BDMs');
    setSelectedService('All Services');
    setSelectedStatus('All Status');
    setSearchQuery('');
    setCurrentPage(1);
  };

  const handleStatusChange = async (crmId: string, newStatus: string) => {
    try {
      setUpdatingId(crmId);
      await api.patch(`/api/legal/records/${crmId}/status`, { status: newStatus });
      showToast(`Status updated to ${newStatus}`, 'success');
      setRecords((prev) =>
        prev.map((r) => (r.crm_id === crmId ? { ...r, status: newStatus } : r))
      );
    } catch {
      showToast('Failed to update status', 'error');
    } finally {
      setUpdatingId(null);
    }
  };

  // Status Badge Component
  const renderStatusBadge = (rec: LegalRecord) => {
    const s = rec.status?.toUpperCase() || 'PENDING';
    let dotColor = 'bg-amber-500';
    let textColor = 'text-amber-700 dark:text-amber-400';
    let bgColor = 'bg-amber-50/80 dark:bg-amber-950/40 border-amber-200/80 dark:border-amber-800/40';

    if (s === 'APPROVED') {
      dotColor = 'bg-emerald-500';
      textColor = 'text-emerald-700 dark:text-emerald-400';
      bgColor = 'bg-emerald-50/80 dark:bg-emerald-950/40 border-emerald-200/80 dark:border-emerald-800/40';
    } else if (s === 'UNDER REVIEW') {
      dotColor = 'bg-blue-500';
      textColor = 'text-blue-700 dark:text-blue-400';
      bgColor = 'bg-blue-50/80 dark:bg-blue-950/40 border-blue-200/80 dark:border-blue-800/40';
    } else if (s === 'HOLD') {
      dotColor = 'bg-rose-500';
      textColor = 'text-rose-700 dark:text-rose-400';
      bgColor = 'bg-rose-50/80 dark:bg-rose-950/40 border-rose-200/80 dark:border-rose-800/40';
    } else if (s === 'REJECTED') {
      dotColor = 'bg-slate-500';
      textColor = 'text-slate-600 dark:text-slate-400';
      bgColor = 'bg-slate-100 dark:bg-slate-800/50 border-slate-200 dark:border-slate-700';
    }

    return (
      <div className="relative group inline-block">
        <button
          type="button"
          className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-bold tracking-wide border uppercase shadow-xs transition-all hover:scale-105 ${bgColor} ${textColor}`}
          title="Click to change status"
        >
          <span className={`h-1.5 w-1.5 rounded-full ${dotColor}`} />
          <span>{s}</span>
        </button>

        {/* Dropdown to change status on hover/click */}
        <div className="absolute left-0 mt-1 hidden group-hover:block z-30 w-36 rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl dark:border-slate-700 dark:bg-slate-900 animate-pop-in">
          {['PENDING', 'UNDER REVIEW', 'APPROVED', 'HOLD', 'REJECTED'].map((opt) => (
            <button
              key={opt}
              type="button"
              disabled={updatingId === rec.crm_id}
              onClick={() => handleStatusChange(rec.crm_id, opt)}
              className="w-full text-left px-2.5 py-1.5 rounded-lg text-xs font-semibold hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 transition-colors"
            >
              {opt}
            </button>
          ))}
        </div>
      </div>
    );
  };

  const startIdx = (currentPage - 1) * pageSize + 1;
  const endIdx = Math.min(currentPage * pageSize, totalCount);
  const totalPages = Math.ceil(totalCount / pageSize) || 1;

  return (
    // The app header already shows the account and sign-out, so this page has no header bar of its own.
    <div className="text-slate-900 dark:text-slate-100 pb-16 font-sans">
      <div className="max-w-7xl mx-auto">
       <div className="grid gap-6 lg:grid-cols-[210px_minmax(0,1fr)]">
        {/* Section sidebar */}
        <nav aria-label="Legal sections" className="self-start lg:sticky lg:top-24">
          <ul className="flex gap-1.5 overflow-x-auto rounded-2xl border border-slate-200/80 bg-white p-2 shadow-sm dark:border-slate-800 dark:bg-slate-900 lg:flex-col">
            {LEGAL_SECTIONS.map(({ id, label, icon: Icon }) => (
              <li key={id} className="shrink-0">
                <button
                  type="button"
                  onClick={() => setSection(id)}
                  aria-current={section === id ? 'page' : undefined}
                  className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-xs font-bold transition-colors ${
                    section === id
                      ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300'
                      : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800'
                  }`}
                >
                  <Icon size={15} />
                  <span className="whitespace-nowrap">{label}</span>
                </button>
              </li>
            ))}
            {can('sales.hub.manage') && (
              <li className="shrink-0 lg:mt-1 lg:border-t lg:border-slate-100 lg:pt-1 dark:lg:border-slate-800">
                <Link to="/sales/hub" className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-xs font-bold text-slate-600 hover:bg-slate-50 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800">
                  <Target size={15} />
                  <span className="whitespace-nowrap">Sales workspace</span>
                </Link>
              </li>
            )}
          </ul>
        </nav>

        <div className="min-w-0 space-y-6">
        {/* Title + Stats Counter Row */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">{LEGAL_SECTIONS.find((s) => s.id === section)?.label}</h2>
            <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-0.5">
              {LEGAL_SECTIONS.find((s) => s.id === section)?.description}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto">
            {section === 'records' && (
              <div className="inline-flex items-center gap-2 rounded-full bg-indigo-50 border border-indigo-100 px-4 py-1.5 text-xs font-bold text-indigo-700 dark:bg-indigo-950/40 dark:border-indigo-900/50 dark:text-indigo-300 shadow-xs">
                <Database size={14} className="text-indigo-600 dark:text-indigo-400" />
                <span>{totalCount} records</span>
              </div>
            )}
            <LegalImportButton onImported={() => { fetchRecords(); setDataVersion((n) => n + 1); }} />
            <LegalExportButton />
          </div>
        </div>

        <LegalOverview refreshKey={`${section}-${dataVersion}`} />

        {section === 'documents' && <LegalClientDocuments />}
        {section === 'assign' && <LegalAssignClients />}
        {section === 'approvals' && <LegalApprovals />}

        {section === 'records' && <>
        {/* Filter Card */}
        <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900/90 backdrop-blur-sm">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-4 items-end">
            {/* BDM Filter */}
            <div className="lg:col-span-3 space-y-1.5">
              <label className="text-[11px] font-bold tracking-wider uppercase text-slate-400 dark:text-slate-500">
                BDM
              </label>
              <select
                value={selectedBdm}
                onChange={(e) => { setSelectedBdm(e.target.value); setCurrentPage(1); }}
                className="w-full rounded-xl border border-slate-200 bg-slate-50/50 px-3 py-2 text-xs font-semibold text-slate-700 focus:border-indigo-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 dark:border-slate-700 dark:bg-slate-800/80 dark:text-slate-200"
              >
                <option value="All BDMs">All BDMs</option>
                {bdmOptions.map((b) => (
                  <option key={b} value={b}>{b}</option>
                ))}
              </select>
            </div>

            {/* SERVICES Filter */}
            <div className="lg:col-span-3 space-y-1.5">
              <label className="text-[11px] font-bold tracking-wider uppercase text-slate-400 dark:text-slate-500">
                Services
              </label>
              <select
                value={selectedService}
                onChange={(e) => { setSelectedService(e.target.value); setCurrentPage(1); }}
                className="w-full rounded-xl border border-slate-200 bg-slate-50/50 px-3 py-2 text-xs font-semibold text-slate-700 focus:border-indigo-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 dark:border-slate-700 dark:bg-slate-800/80 dark:text-slate-200"
              >
                <option value="All Services">All Services</option>
                {serviceOptions.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>

            {/* STATUS Filter */}
            <div className="lg:col-span-2 space-y-1.5">
              <label className="text-[11px] font-bold tracking-wider uppercase text-slate-400 dark:text-slate-500">
                Status
              </label>
              <select
                value={selectedStatus}
                onChange={(e) => { setSelectedStatus(e.target.value); setCurrentPage(1); }}
                className="w-full rounded-xl border border-slate-200 bg-slate-50/50 px-3 py-2 text-xs font-semibold text-slate-700 focus:border-indigo-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 dark:border-slate-700 dark:bg-slate-800/80 dark:text-slate-200"
              >
                <option value="All Status">All Status</option>
                <option value="PENDING">Pending</option>
                <option value="UNDER REVIEW">Under Review</option>
                <option value="APPROVED">Approved</option>
                <option value="HOLD">Hold</option>
                <option value="REJECTED">Rejected</option>
              </select>
            </div>

            {/* SEARCH Box */}
            <div className="lg:col-span-3 space-y-1.5">
              <label className="text-[11px] font-bold tracking-wider uppercase text-slate-400 dark:text-slate-500">
                Search
              </label>
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  placeholder="Search by CRM ID, company name or BDM..."
                  value={searchQuery}
                  onChange={(e) => { setSearchQuery(e.target.value); setCurrentPage(1); }}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50/50 py-2 pl-9 pr-3 text-xs font-medium text-slate-800 placeholder:text-slate-400 focus:border-indigo-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 dark:border-slate-700 dark:bg-slate-800/80 dark:text-slate-200"
                />
              </div>
            </div>

            {/* Clear Button */}
            <div className="lg:col-span-1">
              <button
                type="button"
                onClick={clearFilters}
                className="w-full inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-slate-100/80 px-3 py-2 text-xs font-bold text-slate-600 hover:bg-slate-200 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700 transition-colors"
              >
                <X size={13} />
                <span>Clear</span>
              </button>
            </div>
          </div>
        </div>

        {/* Legal Records Table Card */}
        <div className="rounded-2xl border border-slate-200/80 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900 overflow-hidden">
          {/* Table Card Header */}
          <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="flex h-6 w-6 items-center justify-center rounded-md bg-indigo-50 text-indigo-600 dark:bg-indigo-950 dark:text-indigo-400">
                <Filter size={13} />
              </div>
              <h3 className="font-bold text-sm text-slate-800 dark:text-slate-100">Legal Records</h3>
            </div>

            <div className="text-xs font-semibold text-slate-500 dark:text-slate-400">
              Showing <span className="text-slate-800 dark:text-slate-200 font-bold">{totalCount > 0 ? `${startIdx}-${endIdx}` : '0'}</span> of <span className="text-slate-800 dark:text-slate-200 font-bold">{totalCount}</span> records
            </div>
          </div>

          {/* Table Content */}
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-100 dark:border-slate-800/80 bg-slate-50/60 dark:bg-slate-800/30 text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                  <th className="py-3.5 pl-6 pr-4">CRM ID</th>
                  <th className="py-3.5 px-4">Company Name</th>
                  <th className="py-3.5 px-4">BDM Name</th>
                  <th className="py-3.5 px-4">Services</th>
                  <th className="py-3.5 px-4">Amount Paid with GST</th>
                  <th className="py-3.5 px-4">Status</th>
                  <th className="py-3.5 pl-4 pr-6 text-right">PDF View</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 text-xs">
                {loading ? (
                  <tr>
                    <td colSpan={7} className="py-12 text-center text-slate-400">
                      <div className="flex flex-col items-center justify-center gap-2">
                        <span className="h-6 w-6 animate-spin rounded-full border-2 border-indigo-600 border-t-transparent" />
                        <span className="text-xs font-medium">Loading compliance records...</span>
                      </div>
                    </td>
                  </tr>
                ) : records.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-12 text-center text-slate-400">
                      <div className="flex flex-col items-center justify-center gap-2">
                        <FileText size={28} className="text-slate-300 dark:text-slate-600" />
                        <span className="text-sm font-semibold text-slate-600 dark:text-slate-300">No legal records match your filters</span>
                        <button
                          onClick={clearFilters}
                          className="mt-1 text-xs text-indigo-600 hover:underline font-semibold"
                        >
                          Clear all filters
                        </button>
                      </div>
                    </td>
                  </tr>
                ) : (
                  records.map((rec) => (
                    <tr 
                      key={rec.crm_id}
                      className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors group"
                    >
                      {/* CRM ID */}
                      <td className="py-4 pl-6 pr-4 font-mono font-bold text-indigo-600 dark:text-indigo-400">
                        {rec.crm_id}
                      </td>

                      {/* Company Name */}
                      <td className="py-4 px-4 font-bold text-slate-800 dark:text-slate-100">
                        {rec.company_name}
                      </td>

                      {/* BDM Name */}
                      <td className="py-4 px-4 font-medium text-slate-600 dark:text-slate-300">
                        {rec.bdm_name}
                      </td>

                      {/* Services */}
                      <td className="py-4 px-4">
                        <div className="flex flex-wrap gap-1.5 max-w-xs">
                          {rec.services.map((srv, idx) => (
                            <span
                              key={idx}
                              className="inline-flex items-center rounded-md bg-slate-100 dark:bg-slate-800 px-2 py-0.5 text-[10px] font-semibold text-slate-600 dark:text-slate-300 border border-slate-200/60 dark:border-slate-700/60"
                            >
                              {srv}
                            </span>
                          ))}
                        </div>
                      </td>

                      {/* Amount Paid with GST */}
                      <td className="py-4 px-4 font-bold text-emerald-600 dark:text-emerald-400">
                        ₹{rec.amount_paid.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </td>

                      {/* Status Badge */}
                      <td className="py-4 px-4">
                        {renderStatusBadge(rec)}
                      </td>

                      {/* PDF View */}
                      <td className="py-4 pl-4 pr-6 text-right">
                        {rec.pdf_available ? (
                          <button
                            type="button"
                            onClick={() => setPreviewPdfCrmId(rec.crm_id)}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700 hover:bg-emerald-100 dark:border-emerald-800/80 dark:bg-emerald-950/50 dark:text-emerald-300 transition-all hover:scale-105 active:scale-95 shadow-xs"
                          >
                            <FileText size={13} />
                            <span>View PDF</span>
                          </button>
                        ) : (
                          <span className="text-[11px] italic text-slate-400 dark:text-slate-500">
                            PDF Not Available
                          </span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Table Footer & Pagination */}
          {totalPages > 1 && (
            <div className="px-6 py-3.5 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between">
              <div className="text-xs text-slate-500 dark:text-slate-400">
                Page <span className="font-bold text-slate-800 dark:text-slate-200">{currentPage}</span> of <span className="font-bold text-slate-800 dark:text-slate-200">{totalPages}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  disabled={currentPage === 1}
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  className="inline-flex items-center justify-center h-8 w-8 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 transition-colors"
                >
                  <ChevronLeft size={16} />
                </button>
                <button
                  type="button"
                  disabled={currentPage >= totalPages}
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  className="inline-flex items-center justify-center h-8 w-8 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 transition-colors"
                >
                  <ChevronRight size={16} />
                </button>
              </div>
            </div>
          )}
        </div>
        </>}
        </div>
       </div>
      </div>

      {/* PDF Preview Modal */}
      {previewPdfCrmId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/70 backdrop-blur-sm p-4 animate-fade-in">
          <div className="relative w-full max-w-4xl max-h-[90vh] bg-slate-900 rounded-2xl border border-slate-700 shadow-2xl flex flex-col overflow-hidden animate-pop-in">
            {/* Modal Header */}
            <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-950/60">
              <div className="flex items-center gap-2.5">
                <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-950 text-emerald-400 border border-emerald-800">
                  <FileText size={15} />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-white">Compliance Document Preview</h4>
                  <p className="text-[11px] font-mono text-emerald-400">{previewPdfCrmId}</p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <a
                  href={`${API_BASE}/api/legal/records/${encodeURIComponent(previewPdfCrmId)}/pdf`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-800 text-slate-200 hover:bg-slate-700 border border-slate-700 transition-colors"
                >
                  <ExternalLink size={13} />
                  <span>Open in New Tab</span>
                </a>
                <button
                  type="button"
                  onClick={() => setPreviewPdfCrmId(null)}
                  className="h-8 w-8 rounded-lg bg-slate-800 text-slate-400 hover:text-white hover:bg-slate-700 flex items-center justify-center transition-colors"
                >
                  <X size={16} />
                </button>
              </div>
            </div>

            {/* Modal Iframe */}
            <div className="flex-1 min-h-[500px] w-full bg-slate-950 p-2">
              <iframe
                src={`${API_BASE}/api/legal/records/${encodeURIComponent(previewPdfCrmId)}/pdf`}
                title="Legal Document Viewer"
                className="w-full h-full min-h-[500px] rounded-xl border border-slate-800"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
