document.addEventListener('DOMContentLoaded', () => {
  if (typeof Auth !== 'undefined' && !Auth.requireAuth()) return;
  const token = API.getToken();

  const dropzone = document.getElementById('dropzone');
  const fileInput = document.getElementById('file-input');
  let currentPreview = null;

  dropzone.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) handleFileUpload(e.target.files[0]);
  });

  dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.style.background = '#dbeafe';
  });
  dropzone.addEventListener('dragleave', () => {
    dropzone.style.background = '#eff6ff';
  });
  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.style.background = '#eff6ff';
    if (e.dataTransfer.files.length > 0) handleFileUpload(e.dataTransfer.files[0]);
  });

  async function handleFileUpload(file) {
    const targetEntity = document.getElementById('target-entity-select').value;
    const formData = new FormData();
    formData.append('file', file);
    formData.append('target_entity', targetEntity);

    dropzone.innerHTML = `<div>⏳ Uploading & Analyzing Fuzzy Column Headers for <strong>${file.name}</strong>...</div>`;

    try {
      const res = await fetch('/api/bulk-import/preview-and-map', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body: formData
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Failed to parse file');

      currentPreview = data;
      renderMappingTable(data);
    } catch (e) {
      alert(`[ERROR] ${e.message}`);
      dropzone.innerHTML = `
        <div style="font-size:36px; margin-bottom:10px;">📄</div>
        <h3 style="margin:0 0 6px 0; color:#1e293b;">Click or Drag & Drop File Here</h3>
        <p style="margin:0; font-size:13px; color:#64748b;">Supports .csv, .xlsx, and .xls spreadsheets</p>
      `;
    }
  }

  function renderMappingTable(preview) {
    document.getElementById('mapping-review-card').style.display = 'block';
    document.getElementById('mapping-summary-text').textContent = 
      `File: ${preview.file_name} | Total Rows: ${preview.total_rows_detected} | Target: ${preview.target_entity}`;

    const tbody = document.getElementById('mapping-tbody');
    const availableFields = preview.available_db_fields || [];

    tbody.innerHTML = preview.mappings.map((m, idx) => {
      let confBadge = `<span class="confidence-badge confidence-high">${Math.round(m.confidence_score * 100)}% Match</span>`;
      if (m.confidence_score < 0.7 && m.confidence_score >= 0.5) {
        confBadge = `<span class="confidence-badge confidence-med">${Math.round(m.confidence_score * 100)}% Match</span>`;
      } else if (m.confidence_score < 0.5) {
        confBadge = `<span class="confidence-badge confidence-low">Manual Select</span>`;
      }

      const options = availableFields.map(f => `
        <option value="${f.field}" ${f.field === m.suggested_db_field ? 'selected' : ''}>
          ${f.label} (${f.field}) ${f.required ? '*' : ''}
        </option>
      `).join('');

      return `
        <tr>
          <td><strong>${m.file_header}</strong></td>
          <td style="font-size:12px; color:#64748b;">${m.sample_values.join(', ') || '--'}</td>
          <td>
            <select class="form-control mapping-field-select" data-header="${m.file_header}" style="padding:4px 8px; font-size:13px;">
              <option value="IGNORE">-- Ignore / Do Not Map --</option>
              ${options}
            </select>
          </td>
          <td>${confBadge}</td>
          <td>${m.is_required ? '<span style="color:#dc2626; font-weight:bold; font-size:11px;">MANDATORY</span>' : '<span style="color:#64748b; font-size:11px;">Optional</span>'}</td>
        </tr>
      `;
    }).join('');
  }

  // Execute import
  document.getElementById('btn-execute-import').addEventListener('click', async () => {
    if (!currentPreview) return;

    const confirmedMappings = {};
    document.querySelectorAll('.mapping-field-select').forEach(select => {
      const header = select.dataset.header;
      confirmedMappings[header] = select.value;
    });

    const isDryRun = document.getElementById('dry-run-checkbox').checked;

    try {
      const res = await fetch('/api/bulk-import/execute', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          file_id: currentPreview.file_id,
          target_entity: currentPreview.target_entity,
          confirmed_mappings: confirmedMappings,
          dry_run_only: isDryRun,
          unique_key_field: currentPreview.target_entity === 'EMPLOYEES' ? 'employee_code' : 'employee_id'
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Execution failed');

      pollJobStatus(data.job_id);
    } catch (e) {
      alert(`[ERROR] ${e.message}`);
    }
  });

  function pollJobStatus(jobId) {
    document.getElementById('execution-status-card').style.display = 'block';
    const statusText = document.getElementById('job-status-text');
    const progressNum = document.getElementById('job-progress-num');
    const progressFill = document.getElementById('job-progress-fill');
    const resultStats = document.getElementById('job-result-stats');

    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/bulk-import/jobs/${jobId}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        const job = await res.json();

        progressNum.textContent = `${job.progress_percentage || 0}%`;
        progressFill.style.width = `${job.progress_percentage || 0}%`;
        statusText.textContent = `Status: ${job.status} (${job.total_rows || 0} rows)`;

        if (job.status === 'COMPLETED' || job.status === 'FAILED') {
          clearInterval(interval);
          resultStats.style.display = 'block';
          document.getElementById('stat-ins-count').textContent = `${job.inserted_count || 0} Inserted`;
          document.getElementById('stat-upd-count').textContent = `${job.updated_count || 0} Updated`;
          document.getElementById('stat-fail-count').textContent = `${job.failed_count || 0} Failed`;

          if (job.error_report_file_url) {
            const errWrapper = document.getElementById('error-download-wrapper');
            const errBtn = document.getElementById('btn-download-error-report');
            errWrapper.style.display = 'block';
            errBtn.href = job.error_report_file_url;
          }
        }
      } catch (e) {
        clearInterval(interval);
      }
    }, 1000);
  }
});
