document.addEventListener('DOMContentLoaded', async () => {
  if (typeof Auth !== 'undefined' && !Auth.requireAuth()) return;
  const token = API.getToken();

  let employeesList = [];

  async function loadEmployees() {
    try {
      const res = await fetch('/api/employees?limit=2000', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();
      employeesList = data.data || data.employees || [];
      const select = document.getElementById('leave-emp-select');
      select.innerHTML = employeesList.map(e => `
        <option value="${e.employee_code || e.employee_id || e._id}">${e.full_name || e.name} (${e.employee_code || e.employee_id})</option>
      `).join('');

      if (employeesList.length > 0) {
        const firstId = employeesList[0].employee_code || employeesList[0].employee_id || employeesList[0]._id;
        loadEmployeeBalances(firstId);
      }
    } catch (e) {
      console.error('Error loading employees:', e);
    }
  }

  async function loadEmployeeBalances(empId) {
    try {
      const res = await fetch(`/api/leaves/balances/${empId}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();
      if (data.balances) {
        document.getElementById('stat-cl-avail').textContent = data.balances.casual_leave.available;
        document.getElementById('stat-sl-avail').textContent = data.balances.sick_leave.available;
        document.getElementById('stat-el-avail').textContent = data.balances.earned_leave.available;
        document.getElementById('stat-lop-days').textContent = data.balances.loss_of_pay_days_ytd;
      }
    } catch (e) {
      console.error('Error fetching balances:', e);
    }
  }

  async function loadPendingLeaves() {
    const tbody = document.getElementById('pending-leaves-tbody');
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; padding:20px;">Fetching pending requests...</td></tr>';

    try {
      const res = await fetch('/api/leaves/pending-dashboard', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();
      const items = data.data || [];
      document.getElementById('pending-count-badge').textContent = `${items.length} Pending`;

      if (items.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; padding:30px; color:#64748b;">No pending leave applications.</td></tr>';
        return;
      }

      tbody.innerHTML = items.map(r => {
        let conflictHtml = '<span style="color:#10b981; font-size:12px;">✅ No Conflict</span>';
        if (r.conflict_warning && r.conflict_warning.has_conflict) {
          const colleagues = (r.conflict_warning.conflicting_colleagues || []).map(c => c.employee_name).join(', ');
          conflictHtml = `
            <div class="conflict-warning-badge">
              ⚠️ ${r.conflict_warning.conflict_count} on leave in ${r.department}:<br>${colleagues}
            </div>
          `;
        }

        let lopBadge = '';
        if (r.is_loss_of_pay) {
          lopBadge = `<div class="lop-warning-badge">LOP: ${r.lop_days} Day(s)</div>`;
        }

        const balInfo = r.balances 
          ? `CL: ${r.balances.casual_leave_available} | SL: ${r.balances.sick_leave_available} | EL: ${r.balances.earned_leave_available}`
          : '--';

        return `
          <tr>
            <td>
              <strong>${r.employee_name}</strong>
              <div style="font-size:12px; color:#64748b;">${r.department} &bull; ${r.employee_id}</div>
            </td>
            <td><strong>${r.leave_type}</strong> ${lopBadge}</td>
            <td>${r.start_date} &rarr; ${r.end_date}</td>
            <td><strong>${r.total_days} day(s)</strong></td>
            <td style="font-size:12px;">${balInfo}</td>
            <td>${conflictHtml}</td>
            <td style="font-size:12px; max-width:180px;">${r.reason}</td>
            <td>
              <div style="display:flex; gap:6px;">
                <button class="btn btn-success btn-sm btn-approve-leave" data-id="${r._id || r.id}">✓ Approve</button>
                <button class="btn btn-danger btn-sm btn-reject-leave" data-id="${r._id || r.id}">✕ Reject</button>
              </div>
            </td>
          </tr>
        `;
      }).join('');

      // Bind actions
      document.querySelectorAll('.btn-approve-leave').forEach(btn => {
        btn.addEventListener('click', () => handleLeaveDecision(btn.dataset.id, 'APPROVE'));
      });
      document.querySelectorAll('.btn-reject-leave').forEach(btn => {
        btn.addEventListener('click', () => handleLeaveDecision(btn.dataset.id, 'REJECT'));
      });

    } catch (e) {
      tbody.innerHTML = `<tr><td colspan="8" style="color:red; text-align:center;">Error: ${e.message}</td></tr>`;
    }
  }

  async function loadAllLeavesHistory() {
    const tbody = document.getElementById('all-leaves-tbody');
    try {
      const res = await fetch('/api/leaves', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();
      const records = data.data || [];

      if (records.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; padding:20px; color:#64748b;">No past leave records.</td></tr>';
        return;
      }

      tbody.innerHTML = records.map(r => {
        let statusTag = `<span class="rule-badge" style="background:#fef9c3; color:#854d0e;">PENDING</span>`;
        if (r.status === 'APPROVED') statusTag = `<span class="rule-badge badge-ontime">APPROVED</span>`;
        else if (r.status === 'REJECTED') statusTag = `<span class="rule-badge badge-halfday">REJECTED</span>`;

        return `
          <tr>
            <td><strong>${r.employee_name}</strong> (${r.employee_id})</td>
            <td><strong>${r.leave_type}</strong></td>
            <td>${r.start_date} to ${r.end_date}</td>
            <td>${r.total_days} Day(s)</td>
            <td>${statusTag}</td>
            <td>${r.is_loss_of_pay ? `<span style="color:#d9534f; font-weight:bold;">${r.lop_days} LOP Days</span>` : 'Paid'}</td>
            <td>${r.action_by_name || '--'}</td>
            <td style="font-size:12px; color:#64748b;">${r.created_at ? r.created_at.split('T')[0] : '--'}</td>
          </tr>
        `;
      }).join('');
    } catch (e) {
      tbody.innerHTML = `<tr><td colspan="8" style="color:red; text-align:center;">${e.message}</td></tr>`;
    }
  }

  async function handleLeaveDecision(requestId, action) {
    const remarks = action === 'REJECT' ? prompt('Enter rejection reason:') : 'Approved by HR';
    if (action === 'REJECT' && remarks === null) return;

    try {
      const res = await fetch('/api/leaves/decision', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          leave_request_id: requestId,
          action: action,
          remarks: remarks
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Action failed');
      alert(`Leave request has been ${action.toLowerCase()}d successfully.`);
      loadPendingLeaves();
      loadAllLeavesHistory();
    } catch (e) {
      alert(`[ERROR] ${e.message}`);
    }
  }

  // Modal open
  const btnOpenLeave = document.getElementById('btn-open-apply-leave');
  if (btnOpenLeave) {
    btnOpenLeave.addEventListener('click', () => {
      const modal = document.getElementById('apply-leave-modal');
      if (modal) {
        modal.style.display = 'flex';
        modal.classList.add('active');
      }
    });
  }

  // Toggle medical certificate if SL > 2 days
  function checkMedicalUploadMandate() {
    const type = document.getElementById('leave-type-select')?.value;
    const start = document.getElementById('leave-start-date')?.value;
    const end = document.getElementById('leave-end-date')?.value;
    const medGroup = document.getElementById('medical-cert-group');

    if (medGroup && type === 'SL' && start && end) {
      const s = new Date(start);
      const e = new Date(end);
      const days = (e - s) / (1000 * 3600 * 24) + 1;
      if (days > 2) {
        medGroup.style.display = 'block';
        return;
      }
    }
    if (medGroup) medGroup.style.display = 'none';
  }

  document.getElementById('leave-type-select')?.addEventListener('change', checkMedicalUploadMandate);
  document.getElementById('leave-start-date')?.addEventListener('change', checkMedicalUploadMandate);
  document.getElementById('leave-end-date')?.addEventListener('change', checkMedicalUploadMandate);

  // Apply Leave Submit
  const applyForm = document.getElementById('apply-leave-form');
  if (applyForm) {
    applyForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const payload = {
        employee_id: document.getElementById('leave-emp-select').value,
        leave_type: document.getElementById('leave-type-select').value,
        start_date: document.getElementById('leave-start-date').value,
        end_date: document.getElementById('leave-end-date').value,
        duration_type: document.getElementById('leave-duration-select').value,
        reason: document.getElementById('leave-reason').value,
        medical_certificate_url: document.getElementById('leave-medical-url')?.value || null
      };

      try {
        const data = await API.post('/leaves/apply', payload);
        if (typeof Toast !== 'undefined') Toast.success('Leave application submitted successfully!');
        else alert('Leave application submitted successfully!');
        
        const modal = document.getElementById('apply-leave-modal');
        if (modal) {
          modal.style.display = 'none';
          modal.classList.remove('active');
        }
        applyForm.reset();
        loadPendingLeaves();
        loadAllLeavesHistory();
      } catch (err) {
        if (typeof Toast !== 'undefined') Toast.error(err.message || 'Leave application failed');
        else alert(`[ERROR] ${err.message}`);
      }
    });
  }

  await loadEmployees();
  await loadPendingLeaves();
  await loadAllLeavesHistory();
});
