/**
 * Rexera HR Employee Directory Controller
 */

let currentEmployees = [];
let currentPage = 1;
let currentLimit = 15;

document.addEventListener('DOMContentLoaded', async () => {
  if (!document.getElementById('employees-table-tbody')) return;

  await loadEmployees();

  // Search input handler
  const searchInput = document.getElementById('employee-search');
  if (searchInput) {
    let timeout;
    searchInput.addEventListener('input', () => {
      clearTimeout(timeout);
      timeout = setTimeout(() => {
        currentPage = 1;
        loadEmployees();
      }, 300);
    });
  }

  // Filter handlers
  const deptFilter = document.getElementById('employee-dept-filter');
  if (deptFilter) {
    deptFilter.addEventListener('change', () => {
      currentPage = 1;
      loadEmployees();
    });
  }

  const statusFilter = document.getElementById('employee-status-filter');
  if (statusFilter) {
    statusFilter.addEventListener('change', () => {
      currentPage = 1;
      loadEmployees();
    });
  }
});

async function loadEmployees() {
  const search = document.getElementById('employee-search')?.value || '';
  const department = document.getElementById('employee-dept-filter')?.value || '';
  const status = document.getElementById('employee-status-filter')?.value || '';

  const tbody = document.getElementById('employees-table-tbody');
  if (!tbody) return;

  tbody.innerHTML = `<tr><td colspan="9" style="text-align:center; padding: 30px;"><div style="color: var(--text-muted);">Loading employees...</div></td></tr>`;

  try {
    const data = await API.get('/employees', {
      search,
      department,
      status,
      page: currentPage,
      limit: currentLimit
    });

    currentEmployees = data.employees || [];
    renderEmployeeTable(currentEmployees, data.total);
    renderPagination(data.total, data.page, data.limit);
  } catch (error) {
    tbody.innerHTML = `<tr><td colspan="9" style="text-align:center; color: var(--danger); padding: 30px;">Failed to load employees: ${error.message}</td></tr>`;
  }
}

function renderEmployeeTable(employees, total) {
  const tbody = document.getElementById('employees-table-tbody');
  if (!tbody) return;

  const countBadge = document.getElementById('employee-total-count');
  if (countBadge) countBadge.textContent = total;

  if (employees.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="9">
          <div class="empty-state">
            <div class="empty-state-icon">💼</div>
            <div class="empty-state-title">No Employees Found</div>
            <p>Try modifying your search or department filter.</p>
          </div>
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = employees.map(e => {
    const statusSlug = (e.employee_status || 'Active').toLowerCase().replace(/\s+/g, '-');

    return `
      <tr>
        <td><code>${e.employee_code}</code></td>
        <td>
          <div class="user-cell">
            <div class="user-cell-avatar">${e.full_name.charAt(0)}</div>
            <div class="user-cell-info">
              <span class="user-cell-name">${e.full_name}</span>
              <span class="user-cell-sub">${e.email}</span>
            </div>
          </div>
        </td>
        <td>${e.department}</td>
        <td>${e.branch || '-'}</td>
        <td><strong>${e.designation}</strong></td>
        <td>
          <div class="masked-account-box" id="bank-box-${e.id}">
            <span id="bank-acc-${e.id}">${e.account_no}</span>
            <button class="btn-toggle-mask" title="Reveal Account Number" onclick="toggleUnmaskAccount('${e.id}')">👁️</button>
          </div>
        </td>
        <td><strong>₹${(e.gross_salary || 0).toLocaleString('en-IN')}</strong></td>
        <td>
          <span class="badge badge-${statusSlug}">
            <span class="badge-dot"></span>${e.employee_status}
          </span>
        </td>
        <td>
          <div class="action-group">
            <button class="btn-action" title="View Full Details" onclick="viewEmployeeDetails('${e.id}')">
              👁️
            </button>
            <a href="/salary-slip.html?emp=${e.id}" class="btn-action" title="Generate Salary Slip" style="color: var(--rex-navy);">
              📄
            </a>
            <button class="btn-action btn-delete" title="Delete Employee" onclick="deleteEmployee('${e.id}')">
              🗑️
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

function renderPagination(total, page, limit) {
  const container = document.getElementById('pagination-container');
  if (!container) return;

  const totalPages = Math.ceil(total / limit) || 1;
  const startIdx = total === 0 ? 0 : (page - 1) * limit + 1;
  const endIdx = Math.min(page * limit, total);

  container.innerHTML = `
    <div>Showing ${startIdx} to ${endIdx} of ${total} employees</div>
    <div class="pagination-controls">
      <button class="pagination-btn" ${page <= 1 ? 'disabled' : ''} onclick="changePage(${page - 1})">Previous</button>
      <span style="padding: 0 8px; font-weight: 600;">Page ${page} of ${totalPages}</span>
      <button class="pagination-btn" ${page >= totalPages ? 'disabled' : ''} onclick="changePage(${page + 1})">Next</button>
    </div>
  `;
}

function changePage(newPage) {
  currentPage = newPage;
  loadEmployees();
}

async function toggleUnmaskAccount(empId) {
  const span = document.getElementById(`bank-acc-${empId}`);
  if (!span) return;

  if (span.getAttribute('data-unmasked') === 'true') {
    // Re-mask
    span.textContent = span.getAttribute('data-masked') || '••••••••';
    span.setAttribute('data-unmasked', 'false');
  } else {
    try {
      const details = await API.get(`/employees/${empId}?unmask=true`);
      span.setAttribute('data-masked', span.textContent);
      span.textContent = details.account_no;
      span.setAttribute('data-unmasked', 'true');
    } catch (e) {
      Toast.error('Could not unmask account: ' + e.message);
    }
  }
}

async function viewEmployeeDetails(empId) {
  try {
    const e = await API.get(`/employees/${empId}?unmask=true`);
    const modal = document.getElementById('employee-details-modal');
    const content = document.getElementById('employee-details-content');
    if (!modal || !content) return;

    content.innerHTML = `
      <div style="display: flex; align-items: center; gap: 16px; margin-bottom: 20px; padding-bottom: 16px; border-bottom: 1px solid var(--border-light);">
        <div class="user-cell-avatar" style="width: 50px; height: 50px; font-size: 20px; background: var(--rex-navy); color: #fff;">
          ${e.full_name.charAt(0)}
        </div>
        <div>
          <h3 style="font-size: 18px; color: var(--rex-navy);">${e.full_name} (${e.employee_code})</h3>
          <p style="font-size: 13px; color: var(--text-muted);">${e.designation} • ${e.department}</p>
        </div>
      </div>

      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 20px;">
        <div><strong>Email:</strong> ${e.email}</div>
        <div><strong>Mobile:</strong> ${e.mobile_number}</div>
        <div><strong>Manager:</strong> ${e.reporting_manager || 'None'}</div>
        <div><strong>Date of Joining:</strong> ${e.date_of_joining}</div>
        <div><strong>Status:</strong> <span class="badge badge-active">${e.employee_status}</span></div>
        <div><strong>Onboarding Status:</strong> ${e.joining_status}</div>
      </div>

      <h4 style="color: var(--rex-navy); margin-bottom: 10px; font-size: 15px;">Salary Structure Breakdown</h4>
      <div style="background: #f8fafc; border: 1px solid var(--border-light); border-radius: 8px; padding: 16px; margin-bottom: 20px;">
        <div style="display: flex; justify-content: space-between; margin-bottom: 6px;"><span>Basic Salary:</span><strong>₹${(e.base_salary || 0).toLocaleString('en-IN')}</strong></div>
        <div style="display: flex; justify-content: space-between; margin-bottom: 6px;"><span>House Rent Allowance (HRA):</span><strong>₹${(e.hra || 0).toLocaleString('en-IN')}</strong></div>
        <div style="display: flex; justify-content: space-between; margin-bottom: 6px;"><span>Conveyance Allowance:</span><strong>₹${(e.conveyance_allowance || 0).toLocaleString('en-IN')}</strong></div>
        <div style="display: flex; justify-content: space-between; margin-bottom: 6px;"><span>Special Allowance:</span><strong>₹${(e.special_allowance || 0).toLocaleString('en-IN')}</strong></div>
        <div style="display: flex; justify-content: space-between; margin-bottom: 6px;"><span>Professional Tax:</span><strong>₹${e.professional_tax || 200}</strong></div>
        <div style="display: flex; justify-content: space-between; margin-bottom: 6px;"><span>PF Opted:</span><strong>${e.pf_opted ? 'Yes (12% of Basic)' : 'No'}</strong></div>
        <hr style="border: none; border-top: 1px solid var(--border-light); margin: 10px 0;">
        <div style="display: flex; justify-content: space-between; font-size: 15px;"><span>Gross Salary:</span><strong style="color: var(--rex-navy);">₹${(e.gross_salary || 0).toLocaleString('en-IN')}</strong></div>
        <div style="display: flex; justify-content: space-between; font-size: 15px; margin-top: 4px;"><span>Estimated Net Salary:</span><strong style="color: var(--success);">₹${(e.estimated_net_salary || 0).toLocaleString('en-IN')}</strong></div>
      </div>

      <h4 style="color: var(--rex-navy); margin-bottom: 10px; font-size: 15px;">Banking Information</h4>
      <div style="background: #f8fafc; border: 1px solid var(--border-light); border-radius: 8px; padding: 16px;">
        <div><strong>Bank Name:</strong> ${e.bank_name}</div>
        <div style="margin-top: 4px;"><strong>Account Number:</strong> <code>${e.account_no}</code></div>
        <div style="margin-top: 4px;"><strong>IFSC Code:</strong> <code>${e.ifsc_code}</code></div>
      </div>
    `;

    modal.classList.add('active');
  } catch (err) {
    Toast.error('Failed to load employee details: ' + err.message);
  }
}

function closeEmployeeModal() {
  const modal = document.getElementById('employee-details-modal');
  if (modal) modal.classList.remove('active');
}

async function deleteEmployee(empId) {
  const ok = await Confirm.show('Are you sure you want to delete this employee record? This cannot be undone.', { title: 'Delete Employee', confirmText: 'Delete', danger: true });
  if (!ok) return;

  try {
    await API.delete(`/employees/${empId}`);
    Toast.success('Employee record deleted.');
    loadEmployees();
  } catch (err) {
    Toast.error('Failed to delete employee: ' + err.message);
  }
}

/**
 * Export Employees to Excel (.xlsx) or CSV (.csv)
 */
async function exportEmployees(format = 'xlsx') {
  try {
    Toast.info('Fetching employee records for export...');
    const data = await API.get('/employees?limit=1000&unmask=true');
    const employees = data.employees || [];

    if (employees.length === 0) {
      Toast.warning('No employee records available to export.');
      return;
    }

    const exportRows = employees.map(e => ({
      'Employee Code': e.employee_code,
      'Full Name': e.full_name,
      'Email': e.email,
      'Mobile Number': e.mobile_number,
      'Department': e.department,
      'Designation': e.designation,
      'Gender': e.gender || '',
      'Branch': e.branch || '',
      'Reporting Manager': e.reporting_manager || '',
      'Date of Joining': e.date_of_joining,
      'Status': e.employee_status,
      'Base Salary': e.base_salary,
      'HRA': e.hra,
      'Conveyance Allowance': e.conveyance_allowance,
      'Special Allowance': e.special_allowance,
      'Gross Salary': e.gross_salary,
      'PF Opted': e.pf_opted ? 'Yes' : 'No',
      'Professional Tax': e.professional_tax,
      'Bank Name': e.bank_name,
      'Account Number': e.account_no,
      'IFSC Code': e.ifsc_code
    }));

    const dateStr = new Date().toISOString().substring(0, 10);
    const filename = `Rexera_Employees_Directory_${dateStr}.${format}`;

    if (format === 'csv') {
      Importer.exportToCSV(exportRows, filename);
    } else {
      Importer.exportToExcel(exportRows, filename, 'Employees');
    }
  } catch (err) {
    Toast.error('Export failed: ' + err.message);
  }
}

function toggleExportMenu(menuId) {
  const menu = document.getElementById(menuId);
  if (!menu) return;
  const isShown = menu.style.display === 'block';
  menu.style.display = isShown ? 'none' : 'block';

  if (!isShown) {
    const hideListener = (e) => {
      if (!menu.contains(e.target) && e.target.id !== 'btn-export-employees-dropdown') {
        menu.style.display = 'none';
        document.removeEventListener('click', hideListener);
      }
    };
    setTimeout(() => document.addEventListener('click', hideListener), 10);
  }
}

/**
 * Bulk Import from Excel / CSV handling
 */
let pendingBulkEmployeeRecords = [];

document.addEventListener('DOMContentLoaded', () => {
  const fileInput = document.getElementById('bulk-import-file-input');
  if (!fileInput) return;

  fileInput.addEventListener('change', async () => {
    if (fileInput.files && fileInput.files.length > 0) {
      const file = fileInput.files[0];
      try {
        Toast.info(`Reading ${file.name}...`);
        const records = await Importer.parseFile(file);

        if (!records || records.length === 0) {
          Toast.warning('No valid records found in file.');
          return;
        }

        pendingBulkEmployeeRecords = records;
        openBulkImportModal(records);
      } catch (err) {
        Toast.error('File parsing error: ' + err.message);
      } finally {
        fileInput.value = '';
      }
    }
  });
});

function openBulkImportModal(records) {
  const modal = document.getElementById('bulk-import-modal');
  const countEl = document.getElementById('import-preview-count');
  const tbody = document.getElementById('import-preview-tbody');
  if (!modal || !tbody) return;

  if (countEl) countEl.textContent = records.length;

  tbody.innerHTML = records.slice(0, 50).map(r => `
    <tr>
      <td><strong>${r.full_name || '-'}</strong></td>
      <td>${r.email || '-'}</td>
      <td>${r.mobile_number || '-'}</td>
      <td>${r.department || '-'}</td>
      <td>${r.designation || '-'}</td>
      <td>₹${(parseFloat(r.base_salary) || 0).toLocaleString('en-IN')}</td>
    </tr>
  `).join('');

  if (records.length > 50) {
    tbody.innerHTML += `<tr><td colspan="6" style="text-align: center; color: #64748b; font-style: italic;">... and ${records.length - 50} more records</td></tr>`;
  }

  modal.style.display = 'flex';
}

function closeBulkImportModal() {
  const modal = document.getElementById('bulk-import-modal');
  if (modal) modal.style.display = 'none';
  pendingBulkEmployeeRecords = [];
}

async function executeEmployeeBulkImport() {
  if (!pendingBulkEmployeeRecords || pendingBulkEmployeeRecords.length === 0) {
    Toast.warning('No records to import.');
    return;
  }

  const btn = document.getElementById('btn-confirm-bulk-import');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Importing...';
  }

  try {
    const res = await API.post('/employees/bulk', pendingBulkEmployeeRecords);
    Toast.success(res.message || `Successfully imported ${res.inserted_count} employees!`);
    closeBulkImportModal();
    loadEmployees();
  } catch (err) {
    Toast.error('Bulk import failed: ' + err.message);
    if (btn) {
      btn.disabled = false;
      btn.textContent = '⚡ Confirm & Import All';
    }
  }
}

window.exportEmployees = exportEmployees;
window.toggleExportMenu = toggleExportMenu;
window.closeBulkImportModal = closeBulkImportModal;
window.executeEmployeeBulkImport = executeEmployeeBulkImport;

