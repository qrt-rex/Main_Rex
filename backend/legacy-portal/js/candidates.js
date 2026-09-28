const candidateIndex = {};
/**
 * Rexera HR Recruitment Pipeline & Candidate Directory Controller
 */

let currentCandidates = [];
let currentPage = 1;
let currentLimit = 15;
let currentCandidateId = null;

document.addEventListener('DOMContentLoaded', async () => {
  if (!document.getElementById('candidates-table-tbody')) return;

  await loadCandidates();

  // Search input handler
  const searchInput = document.getElementById('candidate-search');
  if (searchInput) {
    let timeout;
    searchInput.addEventListener('input', () => {
      clearTimeout(timeout);
      timeout = setTimeout(() => {
        currentPage = 1;
        loadCandidates();
      }, 300);
    });
  }

  // Filter change handlers
  const statusFilter = document.getElementById('candidate-status-filter');
  if (statusFilter) {
    statusFilter.addEventListener('change', () => {
      currentPage = 1;
      loadCandidates();
    });
  }

  const posFilter = document.getElementById('candidate-position-filter');
  if (posFilter) {
    posFilter.addEventListener('change', () => {
      currentPage = 1;
      loadCandidates();
    });
  }

  const modalStatusSelect = document.getElementById('modal-status-select');
  if (modalStatusSelect) {
    modalStatusSelect.addEventListener('change', updateStatusNotesRequirement);
  }
});

async function loadCandidates() {
  const search = document.getElementById('candidate-search')?.value || '';
  const status = document.getElementById('candidate-status-filter')?.value || '';
  const position = document.getElementById('candidate-position-filter')?.value || '';

  const tbody = document.getElementById('candidates-table-tbody');
  if (!tbody) return;

  tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; padding: 30px;"><div style="color: var(--text-muted);">Loading candidates...</div></td></tr>`;

  try {
    const data = await API.get('/candidates', {
      search,
      status,
      position,
      page: currentPage,
      limit: currentLimit
    });

    currentCandidates = data.candidates || [];
    renderCandidateTable(currentCandidates, data.total);
    renderPagination(data.total, data.page, data.limit);
  } catch (error) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; color: var(--danger); padding: 30px;">Failed to load candidates: ${escapeHtml(error.message)}</td></tr>`;
  }
}

function renderCandidateTable(candidates, total) {
  const tbody = document.getElementById('candidates-table-tbody');
  if (!tbody) return;

  const countBadge = document.getElementById('candidate-total-count');
  if (countBadge) countBadge.textContent = total;

  if (candidates.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="8">
          <div class="empty-state">
            <div class="empty-state-icon">👥</div>
            <div class="empty-state-title">No Candidates Found</div>
            <p>Try adjusting your search query or status filter.</p>
          </div>
        </td>
      </tr>
    `;
    return;
  }

  candidates.forEach(c => { candidateIndex[c.id] = c; });
  tbody.innerHTML = candidates.map(c => {
    const statusSlug = c.status.toLowerCase().replace(/\s+/g, '-');
    const tokenBadge = c.has_joining_token
      ? `<span class="badge" style="background: #fef3c7; color: #92400e; font-family: monospace; font-size: 11px;">Token: ${escapeHtml(c.joining_token)}</span>`
      : '';

    return `
      <tr>
        <td>
          <div class="user-cell">
            <div class="user-cell-avatar">${escapeHtml(c.candidate_name.charAt(0))}</div>
            <div class="user-cell-info">
              <span class="user-cell-name">${escapeHtml(c.candidate_name)}</span>
              <span class="user-cell-sub">${escapeHtml(c.email)}</span>
            </div>
          </div>
        </td>
        <td><strong>${escapeHtml(c.position_applied)}</strong></td>
        <td>${escapeHtml(c.contact_number)}</td>
        <td>${escapeHtml(c.total_experience || 'N/A')}</td>
        <td><code>${escapeHtml(c.interview_date || 'TBD')}</code></td>
        <td>
          <span class="badge badge-${statusSlug}">
            <span class="badge-dot"></span>${escapeHtml(c.status)}
          </span>
          <div style="margin-top: 4px;">${tokenBadge}</div>
        </td>
        <td><span style="font-size: 11px; color: var(--text-muted);">${(c.created_at || '').substring(0, 10)}</span></td>
        <td>
          <div class="action-group">
            <button class="btn-action" title="View Full Profile" onclick="openCandidateDrawer('${c.id}')">
              👁️
            </button>
            <button class="btn-action" title="Quick Status Update" onclick="openStatusModal('${c.id}')">
              🔄
            </button>
            ${!c.has_joining_token ? `
              <button class="btn-action" title="Generate Joining Token" style="color: var(--rex-gold);" onclick="openTokenModal('${c.id}', '${escapeHtml(c.candidate_name)}', '${escapeHtml(c.email)}', '${escapeHtml(c.position_applied)}')">
                🔑
              </button>
            ` : ''}
            <button class="btn-action btn-delete" title="Delete Candidate" onclick="deleteCandidate('${c.id}')">
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
    <div>Showing ${startIdx} to ${endIdx} of ${total} candidates</div>
    <div class="pagination-controls">
      <button class="pagination-btn" ${page <= 1 ? 'disabled' : ''} onclick="changePage(${page - 1})">Previous</button>
      <span style="padding: 0 8px; font-weight: 600;">Page ${page} of ${totalPages}</span>
      <button class="pagination-btn" ${page >= totalPages ? 'disabled' : ''} onclick="changePage(${page + 1})">Next</button>
    </div>
  `;
}

function changePage(newPage) {
  currentPage = newPage;
  loadCandidates();
}

/**
 * Full Candidate Profile Drawer
 */
async function openCandidateDrawer(candidateId) {
  const drawerOverlay = document.getElementById('candidate-drawer-overlay');
  const drawerContent = document.getElementById('candidate-drawer-content');
  if (!drawerOverlay || !drawerContent) return;

  drawerContent.innerHTML = `<div style="text-align: center; padding: 40px;">Loading profile...</div>`;
  drawerOverlay.classList.add('active');

  try {
    const c = await API.get(`/candidates/${candidateId}`);
    currentCandidateId = candidateId;

    const eduRows = (c.education || []).map(e => `
      <div style="background: #f8fafc; padding: 10px 14px; border-radius: 6px; margin-bottom: 8px; border: 1px solid var(--border-light);">
        <div style="font-weight: 600; color: var(--rex-navy);">${escapeHtml(e.degree)} - ${escapeHtml(e.grade)}</div>
        <div style="font-size: 12px; color: var(--text-muted);">${escapeHtml(e.institution)} (${escapeHtml(e.year)})</div>
      </div>
    `).join('') || '<p style="color: var(--text-muted); font-size: 13px;">No education details entered.</p>';

    const expRows = (c.work_experience || []).map(w => `
      <div style="background: #f8fafc; padding: 10px 14px; border-radius: 6px; margin-bottom: 8px; border: 1px solid var(--border-light);">
        <div style="font-weight: 600; color: var(--rex-navy);">${escapeHtml(w.role)} @ ${escapeHtml(w.company)} (${escapeHtml(w.duration)})</div>
        <div style="font-size: 12px; color: var(--text-muted); margin-top: 4px;">${escapeHtml(w.responsibilities)}</div>
      </div>
    `).join('') || '<p style="color: var(--text-muted); font-size: 13px;">No work experience details entered.</p>';

    const skillBadges = (c.skills || []).map(s => `
      <span style="display: inline-block; background: #e0f2fe; color: #0369a1; padding: 4px 10px; border-radius: 14px; font-size: 12px; font-weight: 600; margin: 0 4px 6px 0;">
        ${escapeHtml(s.name)} (${escapeHtml(s.proficiency)})
      </span>
    `).join('') || '<p style="color: var(--text-muted); font-size: 13px;">No skills added.</p>';

    drawerContent.innerHTML = `
      <div style="display: flex; align-items: center; gap: 16px; margin-bottom: 24px; padding-bottom: 18px; border-bottom: 1px solid var(--border-light);">
        <div class="user-cell-avatar" style="width: 52px; height: 52px; font-size: 20px; background: var(--rex-navy); color: #fff;">
          ${escapeHtml(c.candidate_name.charAt(0))}
        </div>
        <div>
          <h2 style="font-size: 18px; color: var(--rex-navy); margin-bottom: 2px;">${escapeHtml(c.candidate_name)}</h2>
          <div style="font-size: 13px; color: var(--text-muted);">${escapeHtml(c.position_applied)} • Status: <strong>${escapeHtml(c.status)}</strong></div>
        </div>
      </div>

      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 20px;">
        <div class="form-group">
          <span class="form-label">Email Address</span>
          <span style="font-size: 13px; font-weight: 500;">${escapeHtml(c.email)}</span>
        </div>
        <div class="form-group">
          <span class="form-label">Phone Number</span>
          <span style="font-size: 13px; font-weight: 500;">${escapeHtml(c.contact_number)}</span>
        </div>
        <div class="form-group">
          <span class="form-label">Current Company</span>
          <span style="font-size: 13px;">${escapeHtml(c.current_company || 'N/A')}</span>
        </div>
        <div class="form-group">
          <span class="form-label">Total Experience</span>
          <span style="font-size: 13px;">${escapeHtml(c.total_experience || 'N/A')}</span>
        </div>
        <div class="form-group">
          <span class="form-label">Current CTC</span>
          <span style="font-size: 13px;">${escapeHtml(c.current_ctc || 'N/A')}</span>
        </div>
        <div class="form-group">
          <span class="form-label">Expected CTC</span>
          <span style="font-size: 13px; font-weight: 600; color: var(--success);">${escapeHtml(c.expected_ctc || 'N/A')}</span>
        </div>
      </div>

      <div style="margin-bottom: 20px;">
        <h4 style="font-size: 14px; margin-bottom: 8px; color: var(--rex-navy);">Skills Matrix</h4>
        <div>${skillBadges}</div>
      </div>

      <div style="margin-bottom: 20px;">
        <h4 style="font-size: 14px; margin-bottom: 8px; color: var(--rex-navy);">Education History</h4>
        ${eduRows}
      </div>

      <div style="margin-bottom: 20px;">
        <h4 style="font-size: 14px; margin-bottom: 8px; color: var(--rex-navy);">Work Experience</h4>
        ${expRows}
      </div>

      <div style="margin-bottom: 20px;">
        <h4 style="font-size: 14px; margin-bottom: 8px; color: var(--rex-navy);">Personality & Strengths</h4>
        <p style="font-size: 13px; margin-bottom: 4px;"><strong>Languages:</strong> ${escapeHtml(c.languages_known || 'N/A')}</p>
        <p style="font-size: 13px; margin-bottom: 4px;"><strong>Strengths:</strong> ${escapeHtml(c.strengths || 'N/A')}</p>
        <p style="font-size: 13px; margin-bottom: 4px;"><strong>Hobbies:</strong> ${escapeHtml(c.hobbies || 'N/A')}</p>
      </div>

      <div style="background: #f1f5f9; padding: 14px; border-radius: 6px; margin-bottom: 10px;">
        <h4 style="font-size: 13px; margin-bottom: 4px;">HR Interview Notes</h4>
        <p style="font-size: 12px; color: var(--text-muted);">${escapeHtml(c.interview_notes || 'No notes added yet.')}</p>
      </div>
    `;
  } catch (err) {
    drawerContent.innerHTML = `<div style="color: var(--danger); padding: 20px;">Error loading candidate profile: ${escapeHtml(err.message)}</div>`;
  }
}

function closeCandidateDrawer() {
  const drawerOverlay = document.getElementById('candidate-drawer-overlay');
  if (drawerOverlay) drawerOverlay.classList.remove('active');
}

/**
 * Status Update Modal
 */
function openStatusModal(id, currentStatus) {
  if (currentStatus === undefined) currentStatus = (candidateIndex[id] || {}).status;
  currentCandidateId = id;
  const select = document.getElementById('modal-status-select');
  if (select) select.value = currentStatus;
  updateStatusNotesRequirement();
  const modal = document.getElementById('status-update-modal');
  if (modal) modal.classList.add('active');
}

function updateStatusNotesRequirement() {
  const select = document.getElementById('modal-status-select');
  const label = document.getElementById('modal-status-notes-label');
  if (!select || !label) return;
  const needsReason = select.value === 'On Hold' || select.value === 'Rejected';
  label.innerHTML = needsReason
    ? 'Reason for ' + select.value + ' <span class="required">*</span>'
    : 'Interview / Decision Notes';
}

function closeStatusModal() {
  const modal = document.getElementById('status-update-modal');
  if (modal) modal.classList.remove('active');
}

async function submitStatusUpdate() {
  if (!currentCandidateId) return;
  const status = document.getElementById('modal-status-select').value;
  const notes = document.getElementById('modal-status-notes').value.trim();

  if ((status === 'On Hold' || status === 'Rejected') && !notes) {
    Toast.error(`Please provide a reason before marking the candidate as ${status}.`);
    document.getElementById('modal-status-notes')?.focus();
    return;
  }

  try {
    await API.patch(`/candidates/${currentCandidateId}/status`, { status, interview_notes: notes });
    Toast.success('Candidate status updated to ' + status);
    closeStatusModal();
    loadCandidates();
  } catch (e) {
    Toast.error('Failed to update status: ' + e.message);
  }
}

/**
 * Issue Joining Token Modal
 */
function openTokenModal(candId, name, email, position) {
  if (name === undefined) {
    const c = candidateIndex[candId] || {};
    name = c.candidate_name || '';
    email = c.email || '';
    position = c.position_applied;
  }
  document.getElementById('token-cand-id').value = candId;
  document.getElementById('token-cand-name').value = name;
  document.getElementById('token-cand-email').value = email;
  document.getElementById('token-cand-designation').value = position || 'Software Engineer';
  
  const deptSelect = document.getElementById('token-cand-dept');
  const otherContainer = document.getElementById('token-cand-dept-other-container');
  const otherInput = document.getElementById('token-cand-dept-other');
  if (deptSelect && otherContainer) {
    deptSelect.value = 'SALES';
    otherContainer.style.display = 'none';
    if (otherInput) otherInput.value = '';

    deptSelect.onchange = () => {
      if (deptSelect.value === 'other') {
        otherContainer.style.display = 'block';
        if (otherInput) otherInput.focus();
      } else {
        otherContainer.style.display = 'none';
        if (otherInput) otherInput.value = '';
      }
    };
  }

  const modal = document.getElementById('generate-token-modal');
  if (modal) modal.classList.add('active');
}

function closeTokenModal() {
  const modal = document.getElementById('generate-token-modal');
  if (modal) modal.classList.remove('active');
}

async function submitGenerateToken() {
  const candidate_id = document.getElementById('token-cand-id').value;
  const full_name = document.getElementById('token-cand-name').value;
  const email = document.getElementById('token-cand-email').value;
  let department = document.getElementById('token-cand-dept').value;
  const designation = document.getElementById('token-cand-designation').value;

  if (department === 'other') {
    const customVal = document.getElementById('token-cand-dept-other')?.value.trim();
    if (!customVal) {
      Toast.error('Please enter the custom department name.');
      document.getElementById('token-cand-dept-other')?.focus();
      return;
    }
    department = customVal;
  }

  try {
    const res = await API.post('/joining/generate-token', {
      candidate_id,
      full_name,
      email,
      department,
      designation,
      token_type: 'employee',
      expires_in_days: 7
    });

    Toast.success(`Joining token generated: ${res.token} and invitation sent to ${email}`);
    closeTokenModal();
    loadCandidates();
  } catch (err) {
    Toast.error('Failed to generate token: ' + err.message);
  }
}

async function deleteCandidate(candidateId) {
  const ok = await Confirm.show('Are you sure you want to permanently delete this candidate application? This cannot be undone.', { title: 'Delete Candidate', confirmText: 'Delete', danger: true });
  if (!ok) return;

  try {
    await API.delete(`/candidates/${candidateId}`);
    Toast.success('Candidate record deleted.');
    loadCandidates();
  } catch (err) {
    Toast.error('Failed to delete candidate: ' + err.message);
  }
}

/**
 * Export Candidates to Excel (.xlsx) or CSV (.csv)
 */
async function exportCandidates(format = 'xlsx') {
  try {
    Toast.info('Fetching candidate records for export...');
    const data = await API.get('/candidates?limit=1000');
    const candidates = data.candidates || [];

    if (candidates.length === 0) {
      Toast.warning('No candidate records available to export.');
      return;
    }

    const exportRows = candidates.map(c => ({
      'Candidate Name': c.candidate_name || c.full_name,
      'Position Applied': c.position_applied,
      'Email': c.email,
      'Contact Number': c.contact_number,
      'Current Company': c.current_company || '',
      'Total Experience': c.total_experience || '',
      'Current CTC': c.current_ctc || '',
      'Expected CTC': c.expected_ctc || '',
      'Notice Period': c.notice_period || '',
      'Status': c.status,
      'Application Date': c.application_date || '',
      'Interview Date': c.interview_date || '',
      'Joining Token': c.joining_token || ''
    }));

    const dateStr = new Date().toISOString().substring(0, 10);
    const filename = `Rexera_Candidates_Pipeline_${dateStr}.${format}`;

    if (format === 'csv') {
      Importer.exportToCSV(exportRows, filename);
    } else {
      Importer.exportToExcel(exportRows, filename, 'Candidates');
    }
  } catch (err) {
    Toast.error('Export failed: ' + err.message);
  }
}

function toggleCandExportMenu(menuId) {
  const menu = document.getElementById(menuId);
  if (!menu) return;
  const isShown = menu.style.display === 'block';
  menu.style.display = isShown ? 'none' : 'block';

  if (!isShown) {
    const hideListener = (e) => {
      if (!menu.contains(e.target) && e.target.id !== 'btn-export-candidates-dropdown') {
        menu.style.display = 'none';
        document.removeEventListener('click', hideListener);
      }
    };
    setTimeout(() => document.addEventListener('click', hideListener), 10);
  }
}

/**
 * Bulk Import Candidates from Excel / CSV handling
 */
let pendingBulkCandidateRecords = [];

document.addEventListener('DOMContentLoaded', () => {
  const fileInput = document.getElementById('bulk-import-candidates-file-input');
  if (!fileInput) return;

  fileInput.addEventListener('change', async () => {
    if (fileInput.files && fileInput.files.length > 0) {
      const file = fileInput.files[0];
      try {
        Toast.info(`Reading ${file.name}...`);
        const records = await Importer.parseFile(file);

        if (!records || records.length === 0) {
          Toast.warning('No valid candidate records found in file.');
          return;
        }

        pendingBulkCandidateRecords = records;
        openBulkImportCandidatesModal(records);
      } catch (err) {
        Toast.error('File parsing error: ' + err.message);
      } finally {
        fileInput.value = '';
      }
    }
  });
});

function openBulkImportCandidatesModal(records) {
  const modal = document.getElementById('bulk-import-candidates-modal');
  const countEl = document.getElementById('import-candidates-preview-count');
  const tbody = document.getElementById('import-candidates-preview-tbody');
  if (!modal || !tbody) return;

  if (countEl) countEl.textContent = records.length;

  tbody.innerHTML = records.slice(0, 50).map(r => `
    <tr>
      <td><strong>${escapeHtml(r.full_name || r.candidate_name || '-')}</strong></td>
      <td>${escapeHtml(r.position_applied || r.designation || '-')}</td>
      <td>${escapeHtml(r.email || '-')}</td>
      <td>${escapeHtml(r.mobile_number || r.contact_number || '-')}</td>
      <td>${escapeHtml(r.total_experience || '-')}</td>
      <td>${escapeHtml(r.current_ctc || '-')}</td>
    </tr>
  `).join('');

  if (records.length > 50) {
    tbody.innerHTML += `<tr><td colspan="6" style="text-align: center; color: #64748b; font-style: italic;">... and ${records.length - 50} more records</td></tr>`;
  }

  modal.style.display = 'flex';
}

function closeBulkImportCandidatesModal() {
  const modal = document.getElementById('bulk-import-candidates-modal');
  if (modal) modal.style.display = 'none';
  pendingBulkCandidateRecords = [];
}

async function executeCandidateBulkImport() {
  if (!pendingBulkCandidateRecords || pendingBulkCandidateRecords.length === 0) {
    Toast.warning('No candidate records to import.');
    return;
  }

  const btn = document.getElementById('btn-confirm-bulk-candidates-import');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Importing Candidates...';
  }

  try {
    const res = await API.post('/candidates/bulk', pendingBulkCandidateRecords);
    Toast.success(res.message || `Successfully imported ${res.inserted_count} candidate profiles!`);
    closeBulkImportCandidatesModal();
    loadCandidates();
  } catch (err) {
    Toast.error('Bulk candidate import failed: ' + err.message);
    if (btn) {
      btn.disabled = false;
      btn.textContent = '⚡ Confirm & Import All Candidates';
    }
  }
}

window.exportCandidates = exportCandidates;
window.toggleCandExportMenu = toggleCandExportMenu;
window.closeBulkImportCandidatesModal = closeBulkImportCandidatesModal;
window.executeCandidateBulkImport = executeCandidateBulkImport;

