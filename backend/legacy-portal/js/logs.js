/**
 * Rexera HR Activity Logs Page Controller
 */

let logsData = [];
let currentPage = 1;
const LOGS_PER_PAGE = 30;

document.addEventListener('DOMContentLoaded', async () => {
  if (!document.getElementById('logs-table-container')) return;

  await loadLogs();

  // Filter event handlers
  const actionFilter = document.getElementById('log-action-filter');
  const searchInput = document.getElementById('log-search');
  const dateFrom = document.getElementById('log-date-from');
  const dateTo = document.getElementById('log-date-to');

  if (actionFilter) actionFilter.addEventListener('change', () => { currentPage = 1; loadLogs(); });
  if (dateFrom) dateFrom.addEventListener('change', () => { currentPage = 1; loadLogs(); });
  if (dateTo) dateTo.addEventListener('change', () => { currentPage = 1; loadLogs(); });

  if (searchInput) {
    let timeout;
    searchInput.addEventListener('input', () => {
      clearTimeout(timeout);
      timeout = setTimeout(() => { currentPage = 1; loadLogs(); }, 300);
    });
  }
});

async function loadLogs() {
  const tbody = document.getElementById('logs-tbody');
  if (!tbody) return;

  tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding: 24px; color: var(--text-muted);">Loading activity logs...</td></tr>`;

  const action = document.getElementById('log-action-filter')?.value || '';
  const search = document.getElementById('log-search')?.value || '';
  const dateFrom = document.getElementById('log-date-from')?.value || '';
  const dateTo = document.getElementById('log-date-to')?.value || '';

  try {
    const params = new URLSearchParams();
    params.set('page', currentPage);
    params.set('limit', LOGS_PER_PAGE);
    if (action && action !== 'ALL') params.set('action', action);
    if (search) params.set('search', search);
    if (dateFrom) params.set('date_from', dateFrom + 'T00:00:00');
    if (dateTo) params.set('date_to', dateTo + 'T23:59:59');

    const res = await API.get(`/logs?${params.toString()}`);
    logsData = res.logs || [];
    const total = res.total || 0;

    renderLogsTable(logsData);
    renderLogsPagination(total);
    
    // Update total count
    const countEl = document.getElementById('logs-total-count');
    if (countEl) countEl.textContent = total;

  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; color: var(--danger); padding: 24px;">Failed to load logs: ${err.message}</td></tr>`;
  }
}

function renderLogsTable(logs) {
  const tbody = document.getElementById('logs-tbody');
  if (!tbody) return;

  if (logs.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6">
          <div class="empty-state">
            <div class="empty-state-icon">📋</div>
            <div class="empty-state-title">No Activity Logs Found</div>
            <p>Adjust your filters or check back later.</p>
          </div>
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = logs.map(log => {
    const badge = getActionBadge(log.action);
    const ts = formatTimestamp(log.timestamp);
    const details = formatDetails(log);

    return `
      <tr>
        <td><code style="font-size: 11px; color: var(--text-muted);">${ts}</code></td>
        <td>${badge}</td>
        <td>
          <div style="font-weight: 600; font-size: 13px;">${log.performed_by || '—'}</div>
          <div style="font-size: 11px; color: var(--text-muted);">${log.performed_by_role || ''}</div>
        </td>
        <td style="font-weight: 500;">${log.target || '—'}</td>
        <td style="font-size: 12px; max-width: 300px; word-wrap: break-word;">${details}</td>
        <td><code style="font-size: 11px;">${log.ip_address || '—'}</code></td>
      </tr>
    `;
  }).join('');
}

function getActionBadge(action) {
  const map = {
    'LOGIN':              { color: '#10b981', bg: '#ecfdf5', icon: '🔓', label: 'Login' },
    'LOGOUT':             { color: '#6366f1', bg: '#eef2ff', icon: '🚪', label: 'Logout' },
    'SESSION_TIMEOUT':    { color: '#ef4444', bg: '#fef2f2', icon: '⏱️', label: 'Session Timeout' },
    'PAYROLL_INCREMENT':  { color: '#059669', bg: '#ecfdf5', icon: '📈', label: 'Payroll ↑' },
    'PAYROLL_DECREMENT':  { color: '#dc2626', bg: '#fef2f2', icon: '📉', label: 'Payroll ↓' },
    'CANDIDATE_CREATE':   { color: '#2563eb', bg: '#eff6ff', icon: '👤', label: 'New Candidate' },
    'CANDIDATE_STATUS_CHANGE': { color: '#8b5cf6', bg: '#f5f3ff', icon: '🔄', label: 'Status Change' },
    'EMPLOYEE_CREATE':    { color: '#0891b2', bg: '#ecfeff', icon: '💼', label: 'New Employee' },
    'EMPLOYEE_UPDATE':    { color: '#ca8a04', bg: '#fefce8', icon: '✏️', label: 'Employee Edit' },
    'EMPLOYEE_DELETE':    { color: '#be123c', bg: '#fff1f2', icon: '🗑️', label: 'Employee Delete' },
  };
  
  const info = map[action] || { color: '#64748b', bg: '#f8fafc', icon: '📌', label: action };
  
  return `<span class="log-action-badge" style="
    display: inline-flex; align-items: center; gap: 5px; padding: 4px 10px; border-radius: 20px;
    font-size: 11px; font-weight: 700; letter-spacing: 0.3px;
    color: ${info.color}; background: ${info.bg}; border: 1px solid ${info.color}20;
  ">${info.icon} ${info.label}</span>`;
}

function formatTimestamp(ts) {
  if (!ts) return '—';
  try {
    const d = new Date(ts);
    const date = d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
    const time = d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    return `${date}<br>${time}`;
  } catch {
    return ts.substring(0, 19);
  }
}

function formatDetails(log) {
  const d = log.details || {};
  
  if (log.action === 'PAYROLL_INCREMENT' || log.action === 'PAYROLL_DECREMENT') {
    const fieldLabel = (d.field || '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    return `<strong>${fieldLabel}</strong>: ₹${(d.old_value || 0).toLocaleString('en-IN')} → ₹${(d.new_value || 0).toLocaleString('en-IN')}<br>
            <span style="color: var(--text-muted);">Amount: ₹${(d.amount || 0).toLocaleString('en-IN')} | Reason: ${d.reason || '—'}</span>`;
  }
  
  if (d.message) return d.message;
  
  // Fallback: show JSON summary
  const keys = Object.keys(d);
  if (keys.length === 0) return '—';
  return keys.slice(0, 3).map(k => `${k}: ${d[k]}`).join(', ');
}

function renderLogsPagination(total) {
  const container = document.getElementById('logs-pagination');
  if (!container) return;

  const totalPages = Math.ceil(total / LOGS_PER_PAGE);
  if (totalPages <= 1) {
    container.innerHTML = '';
    return;
  }

  let html = '';
  html += `<button class="btn btn-outline btn-sm" ${currentPage <= 1 ? 'disabled' : ''} onclick="goToLogPage(${currentPage - 1})">← Prev</button>`;
  
  for (let i = 1; i <= Math.min(totalPages, 10); i++) {
    html += `<button class="btn ${i === currentPage ? 'btn-primary' : 'btn-outline'} btn-sm" onclick="goToLogPage(${i})">${i}</button>`;
  }
  
  if (totalPages > 10) {
    html += `<span style="padding: 0 8px; color: var(--text-muted);">... ${totalPages}</span>`;
  }

  html += `<button class="btn btn-outline btn-sm" ${currentPage >= totalPages ? 'disabled' : ''} onclick="goToLogPage(${currentPage + 1})">Next →</button>`;
  
  container.innerHTML = html;
}

function goToLogPage(page) {
  currentPage = page;
  loadLogs();
}

async function exportLogsCSV() {
  try {
    Toast.info('Exporting activity logs...');

    const action = document.getElementById('log-action-filter')?.value || '';
    const search = document.getElementById('log-search')?.value || '';
    const dateFrom = document.getElementById('log-date-from')?.value || '';
    const dateTo = document.getElementById('log-date-to')?.value || '';

    const params = new URLSearchParams();
    if (action && action !== 'ALL') params.set('action', action);
    if (search) params.set('search', search);
    if (dateFrom) params.set('date_from', dateFrom + 'T00:00:00');
    if (dateTo) params.set('date_to', dateTo + 'T23:59:59');

    const res = await API.get(`/logs/export?${params.toString()}`);
    const logs = res.logs || [];

    if (logs.length === 0) {
      Toast.warning('No logs to export.');
      return;
    }

    const headers = ['Timestamp', 'Action', 'Performed By', 'Role', 'Target', 'Details', 'IP Address'];
    const rows = logs.map(l => [
      l.timestamp,
      l.action,
      `"${l.performed_by || ''}"`,
      l.performed_by_role || '',
      `"${l.target || ''}"`,
      `"${JSON.stringify(l.details || {}).replace(/"/g, '""')}"`,
      l.ip_address || ''
    ]);

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const link = document.createElement('a');
    link.setAttribute('href', encodeURI(csvContent));
    link.setAttribute('download', `Rexera_Activity_Logs_${new Date().toISOString().substring(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    link.remove();
    Toast.success('Activity logs exported to CSV.');
  } catch (err) {
    Toast.error('Export failed: ' + err.message);
  }
}

window.goToLogPage = goToLogPage;
window.exportLogsCSV = exportLogsCSV;
