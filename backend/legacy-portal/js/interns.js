/**
 * Rexera HR Intern Management & Directory Controller
 */

let currentInterns = [];
let currentPage = 1;
let currentLimit = 15;
let currentInternId = null;

document.addEventListener('DOMContentLoaded', async () => {
  if (!document.getElementById('interns-table-tbody')) return;

  await loadInterns();

  const searchInput = document.getElementById('intern-search');
  if (searchInput) {
    let timeout;
    searchInput.addEventListener('input', () => {
      clearTimeout(timeout);
      timeout = setTimeout(() => {
        currentPage = 1;
        loadInterns();
      }, 300);
    });
  }

  const deptFilter = document.getElementById('intern-dept-filter');
  if (deptFilter) {
    deptFilter.addEventListener('change', () => {
      currentPage = 1;
      loadInterns();
    });
  }

  const statusFilter = document.getElementById('intern-status-filter');
  if (statusFilter) {
    statusFilter.addEventListener('change', () => {
      currentPage = 1;
      loadInterns();
    });
  }
});

async function loadInterns() {
  const search = document.getElementById('intern-search')?.value || '';
  const department = document.getElementById('intern-dept-filter')?.value || '';
  const status = document.getElementById('intern-status-filter')?.value || '';

  const tbody = document.getElementById('interns-table-tbody');
  if (!tbody) return;

  tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; padding: 30px;"><div style="color: var(--text-muted);">Loading interns...</div></td></tr>`;

  try {
    const data = await API.get('/interns', {
      search,
      department,
      status,
      page: currentPage,
      limit: currentLimit
    });

    currentInterns = data.interns || [];
    renderInternsTable(currentInterns, data.total);
    renderPagination(data.total, data.page, data.limit);
  } catch (error) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; color: var(--danger); padding: 30px;">Failed to load interns: ${error.message}</td></tr>`;
  }
}

function renderInternsTable(interns, total) {
  const tbody = document.getElementById('interns-table-tbody');
  if (!tbody) return;

  const countBadge = document.getElementById('intern-total-count');
  if (countBadge) countBadge.textContent = total;

  if (interns.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="8">
          <div class="empty-state">
            <div class="empty-state-icon">🎓</div>
            <div class="empty-state-title">No Interns Found</div>
            <p>Try adjusting your search or add a new intern.</p>
          </div>
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = interns.map(i => {
    const statusSlug = (i.status || 'Ongoing').toLowerCase().replace(/\s+/g, '-');
    const isConverted = i.status === 'Converted to Full-Time';

    return `
      <tr>
        <td><code>${i.intern_code}</code></td>
        <td>
          <div class="user-cell">
            <div class="user-cell-avatar" style="background: var(--purple-bg); color: var(--purple-text);">${i.full_name.charAt(0)}</div>
            <div class="user-cell-info">
              <span class="user-cell-name">${i.full_name}</span>
              <span class="user-cell-sub">${i.email}</span>
            </div>
          </div>
        </td>
        <td>
          <div style="font-weight: 500;">${i.college_university}</div>
          <div style="font-size: 11px; color: var(--text-muted);">${i.degree} (${i.branch_specialization})</div>
        </td>
        <td><strong>${i.domain_role}</strong><div style="font-size: 11px; color: var(--text-muted);">Mentor: ${i.assigned_mentor}</div></td>
        <td><span style="font-size: 12px;">${i.duration_months} Mos (${(i.start_date || '').substring(0, 7)})</span></td>
        <td><strong>₹${(i.monthly_stipend || 0).toLocaleString('en-IN')}</strong></td>
        <td>
          <span class="badge badge-${statusSlug}">
            <span class="badge-dot"></span>${i.status}
          </span>
        </td>
        <td>
          <div class="action-group">
            <button class="btn-action" title="View Intern Details" onclick="viewInternDetails('${i.id}')">
              👁️
            </button>
            ${!isConverted ? `
              <button class="btn-action" title="Convert to Full-Time Employee" style="color: var(--purple);" onclick="openConvertToFteModal('${i.id}', '${i.full_name}', '${i.domain_role}', '${i.department}', ${i.monthly_stipend})">
                🚀
              </button>
            ` : ''}
            <button class="btn-action btn-delete" title="Delete Intern" onclick="deleteIntern('${i.id}')">
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
    <div>Showing ${startIdx} to ${endIdx} of ${total} interns</div>
    <div class="pagination-controls">
      <button class="pagination-btn" ${page <= 1 ? 'disabled' : ''} onclick="changePage(${page - 1})">Previous</button>
      <span style="padding: 0 8px; font-weight: 600;">Page ${page} of ${totalPages}</span>
      <button class="pagination-btn" ${page >= totalPages ? 'disabled' : ''} onclick="changePage(${page + 1})">Next</button>
    </div>
  `;
}

function changePage(newPage) {
  currentPage = newPage;
  loadInterns();
}

async function viewInternDetails(internId) {
  try {
    const i = await API.get(`/interns/${internId}`);
    const modal = document.getElementById('intern-details-modal');
    const content = document.getElementById('intern-details-content');
    if (!modal || !content) return;

    content.innerHTML = `
      <div style="display: flex; align-items: center; gap: 16px; margin-bottom: 20px; padding-bottom: 16px; border-bottom: 1px solid var(--border-light);">
        <div class="user-cell-avatar" style="width: 50px; height: 50px; font-size: 20px; background: var(--purple); color: #fff;">
          ${i.full_name.charAt(0)}
        </div>
        <div>
          <h3 style="font-size: 18px; color: var(--rex-navy);">${i.full_name} (${i.intern_code})</h3>
          <p style="font-size: 13px; color: var(--text-muted);">${i.domain_role} • ${i.department} (Mentor: ${i.assigned_mentor})</p>
        </div>
      </div>

      <h4 style="color: var(--rex-navy); margin-bottom: 10px; font-size: 15px;">Academic Information</h4>
      <div style="background: #f8fafc; border: 1px solid var(--border-light); border-radius: 8px; padding: 16px; margin-bottom: 20px;">
        <div style="margin-bottom: 6px;"><strong>College / University:</strong> ${i.college_university}</div>
        <div style="margin-bottom: 6px;"><strong>Degree & Branch:</strong> ${i.degree} - ${i.branch_specialization}</div>
        <div style="margin-bottom: 6px;"><strong>Semester & Roll:</strong> ${i.current_semester || 'N/A'} (Roll: ${i.roll_number || 'N/A'})</div>
      </div>

      <h4 style="color: var(--rex-navy); margin-bottom: 10px; font-size: 15px;">Internship Scope & Compensation</h4>
      <div style="background: #f8fafc; border: 1px solid var(--border-light); border-radius: 8px; padding: 16px; margin-bottom: 20px;">
        <div style="margin-bottom: 6px;"><strong>Duration:</strong> ${i.duration_months} Months (${i.start_date} to ${i.end_date})</div>
        <div style="margin-bottom: 6px;"><strong>Type:</strong> ${i.internship_type}</div>
        <div style="margin-bottom: 6px;"><strong>Monthly Stipend:</strong> <strong style="color: var(--rex-gold);">₹${(i.monthly_stipend || 0).toLocaleString('en-IN')}</strong></div>
        <div style="margin-bottom: 6px;"><strong>Status:</strong> <span class="badge badge-active">${i.status}</span></div>
        ${i.performance_rating ? `<div><strong>Performance Rating:</strong> ⭐ ${i.performance_rating} / 5.0</div>` : ''}
        ${i.mentor_feedback ? `<div style="margin-top: 6px; font-size: 12px; color: var(--text-muted);"><strong>Feedback:</strong> ${i.mentor_feedback}</div>` : ''}
      </div>

      <h4 style="color: var(--rex-navy); margin-bottom: 10px; font-size: 15px;">Banking Information</h4>
      <div style="background: #f8fafc; border: 1px solid var(--border-light); border-radius: 8px; padding: 16px;">
        <div><strong>Bank Name:</strong> ${i.bank_name || 'Not provided'}</div>
        <div style="margin-top: 4px;"><strong>Account Number:</strong> <code>${i.account_no || 'Not provided'}</code></div>
        <div style="margin-top: 4px;"><strong>IFSC Code:</strong> <code>${i.ifsc_code || 'Not provided'}</code></div>
      </div>
    `;

    modal.classList.add('active');
  } catch (err) {
    Toast.error('Failed to load intern details: ' + err.message);
  }
}

function closeInternModal() {
  const modal = document.getElementById('intern-details-modal');
  if (modal) modal.classList.remove('active');
}

/**
 * Convert to Full-Time Employee Modal
 */
function openConvertToFteModal(internId, name, role, dept, stipend) {
  currentInternId = internId;
  document.getElementById('fte-intern-name').textContent = name;
  document.getElementById('fte-designation').value = role.replace(/Intern/i, 'Associate').trim();
  
  const fteDeptSelect = document.getElementById('fte-department');
  const otherContainer = document.getElementById('fte-department-other-container');
  const otherInput = document.getElementById('fte-department-other');
  
  if (fteDeptSelect) {
    // Check if dept is in options
    const exists = Array.from(fteDeptSelect.options).some(opt => opt.value === dept);
    if (exists) {
      fteDeptSelect.value = dept;
      if (otherContainer) otherContainer.style.display = 'none';
      if (otherInput) otherInput.value = '';
    } else if (dept) {
      fteDeptSelect.value = 'other';
      if (otherContainer) {
        otherContainer.style.display = 'block';
        if (otherInput) otherInput.value = dept;
      }
    } else {
      fteDeptSelect.value = 'SALES';
      if (otherContainer) otherContainer.style.display = 'none';
    }

    fteDeptSelect.onchange = () => {
      if (fteDeptSelect.value === 'other') {
        if (otherContainer) otherContainer.style.display = 'block';
        if (otherInput) otherInput.focus();
      } else {
        if (otherContainer) otherContainer.style.display = 'none';
        if (otherInput) otherInput.value = '';
      }
    };
  }

  document.getElementById('fte-doj').value = new Date().toISOString().substring(0, 10);
  
  // Suggest starter base salary (e.g. 2.5x stipend or minimum 35k)
  const suggestedBase = Math.max(35000, Math.round(stipend * 2.2));
  document.getElementById('fte-base-salary').value = suggestedBase;
  document.getElementById('fte-hra').value = Math.round(suggestedBase * 0.4);
  document.getElementById('fte-conveyance').value = 2000;
  document.getElementById('fte-special').value = 5000;

  const modal = document.getElementById('convert-fte-modal');
  if (modal) modal.classList.add('active');
}

function closeConvertToFteModal() {
  const modal = document.getElementById('convert-fte-modal');
  if (modal) modal.classList.remove('active');
}

async function submitConvertToFte() {
  if (!currentInternId) return;

  let deptVal = document.getElementById('fte-department').value;
  if (deptVal === 'other') {
    const customVal = document.getElementById('fte-department-other')?.value.trim();
    if (!customVal) {
      Toast.error('Please enter the custom department name.');
      document.getElementById('fte-department-other')?.focus();
      return;
    }
    deptVal = customVal;
  }

  const payload = {
    designation: document.getElementById('fte-designation').value,
    department: deptVal,
    reporting_manager: document.getElementById('fte-manager')?.value || '',
    date_of_joining: document.getElementById('fte-doj').value,
    base_salary: parseFloat(document.getElementById('fte-base-salary').value) || 0,
    hra: parseFloat(document.getElementById('fte-hra').value) || 0,
    conveyance_allowance: parseFloat(document.getElementById('fte-conveyance').value) || 0,
    special_allowance: parseFloat(document.getElementById('fte-special').value) || 0,
    professional_tax: 200.0,
    pf_opted: document.getElementById('fte-pf-opted').checked
  };

  try {
    const res = await API.post(`/interns/${currentInternId}/convert`, payload);
    Toast.success(res.message);
    closeConvertToFteModal();
    loadInterns();
  } catch (err) {
    Toast.error('Conversion failed: ' + err.message);
  }
}

async function deleteIntern(internId) {
  const ok = await Confirm.show('Are you sure you want to delete this intern record? This cannot be undone.', { title: 'Delete Intern', confirmText: 'Delete', danger: true });
  if (!ok) return;

  try {
    await API.delete(`/interns/${internId}`);
    Toast.success('Intern record deleted.');
    loadInterns();
  } catch (err) {
    Toast.error('Failed to delete intern: ' + err.message);
  }
}

/**
 * Export Interns to Excel (.xlsx) or CSV (.csv)
 */
async function exportInterns(format = 'xlsx') {
  try {
    Toast.info('Fetching intern records for export...');
    const data = await API.get('/interns?limit=1000');
    const interns = data.interns || [];

    if (interns.length === 0) {
      Toast.warning('No intern records available to export.');
      return;
    }

    const exportRows = interns.map(i => ({
      'Intern Code': i.intern_code,
      'Full Name': i.full_name,
      'Email': i.email,
      'Mobile Number': i.mobile_number,
      'Department': i.department,
      'Domain / Role': i.domain_role,
      'Assigned Mentor': i.assigned_mentor || '',
      'College / University': i.college_university,
      'Degree': i.degree,
      'Branch': i.branch_specialization,
      'Current Semester': i.current_semester || '',
      'Roll Number': i.roll_number || '',
      'Start Date': i.start_date,
      'End Date': i.end_date,
      'Duration (Months)': i.duration_months,
      'Monthly Stipend': i.monthly_stipend,
      'Status': i.status,
      'Bank Name': i.bank_name || '',
      'Account Number': i.account_no || '',
      'IFSC Code': i.ifsc_code || ''
    }));

    const dateStr = new Date().toISOString().substring(0, 10);
    const filename = `Rexera_Interns_Directory_${dateStr}.${format}`;

    if (format === 'csv') {
      Importer.exportToCSV(exportRows, filename);
    } else {
      Importer.exportToExcel(exportRows, filename, 'Interns');
    }
  } catch (err) {
    Toast.error('Export failed: ' + err.message);
  }
}

function toggleInternExportMenu(menuId) {
  const menu = document.getElementById(menuId);
  if (!menu) return;
  const isShown = menu.style.display === 'block';
  menu.style.display = isShown ? 'none' : 'block';

  if (!isShown) {
    const hideListener = (e) => {
      if (!menu.contains(e.target) && e.target.id !== 'btn-export-interns-dropdown') {
        menu.style.display = 'none';
        document.removeEventListener('click', hideListener);
      }
    };
    setTimeout(() => document.addEventListener('click', hideListener), 10);
  }
}

/**
 * Bulk Import Interns from Excel / CSV handling
 */
let pendingBulkInternRecords = [];

document.addEventListener('DOMContentLoaded', () => {
  const fileInput = document.getElementById('bulk-import-interns-file-input');
  if (!fileInput) return;

  fileInput.addEventListener('change', async () => {
    if (fileInput.files && fileInput.files.length > 0) {
      const file = fileInput.files[0];
      try {
        Toast.info(`Reading ${file.name}...`);
        const records = await Importer.parseFile(file);

        if (!records || records.length === 0) {
          Toast.warning('No valid intern records found in file.');
          return;
        }

        pendingBulkInternRecords = records;
        openBulkImportInternsModal(records);
      } catch (err) {
        Toast.error('File parsing error: ' + err.message);
      } finally {
        fileInput.value = '';
      }
    }
  });
});

function openBulkImportInternsModal(records) {
  const modal = document.getElementById('bulk-import-interns-modal');
  const countEl = document.getElementById('import-interns-preview-count');
  const tbody = document.getElementById('import-interns-preview-tbody');
  if (!modal || !tbody) return;

  if (countEl) countEl.textContent = records.length;

  tbody.innerHTML = records.slice(0, 50).map(r => `
    <tr>
      <td><strong>${r.full_name || '-'}</strong></td>
      <td>${r.email || '-'}</td>
      <td>${r.mobile_number || '-'}</td>
      <td>${r.college_university || '-'}</td>
      <td>${r.domain_role || r.designation || '-'}</td>
      <td>₹${(parseFloat(r.monthly_stipend) || 0).toLocaleString('en-IN')}</td>
    </tr>
  `).join('');

  if (records.length > 50) {
    tbody.innerHTML += `<tr><td colspan="6" style="text-align: center; color: #64748b; font-style: italic;">... and ${records.length - 50} more records</td></tr>`;
  }

  modal.style.display = 'flex';
}

function closeBulkImportInternsModal() {
  const modal = document.getElementById('bulk-import-interns-modal');
  if (modal) modal.style.display = 'none';
  pendingBulkInternRecords = [];
}

async function executeInternBulkImport() {
  if (!pendingBulkInternRecords || pendingBulkInternRecords.length === 0) {
    Toast.warning('No intern records to import.');
    return;
  }

  const btn = document.getElementById('btn-confirm-bulk-interns-import');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Enrolling Interns...';
  }

  try {
    const res = await API.post('/interns/bulk', pendingBulkInternRecords);
    Toast.success(res.message || `Successfully enrolled ${res.inserted_count} interns!`);
    closeBulkImportInternsModal();
    loadInterns();
  } catch (err) {
    Toast.error('Bulk intern import failed: ' + err.message);
    if (btn) {
      btn.disabled = false;
      btn.textContent = '⚡ Confirm & Enroll All Interns';
    }
  }
}

window.exportInterns = exportInterns;
window.toggleInternExportMenu = toggleInternExportMenu;
window.closeBulkImportInternsModal = closeBulkImportInternsModal;
window.executeInternBulkImport = executeInternBulkImport;

