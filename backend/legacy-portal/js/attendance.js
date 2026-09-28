document.addEventListener('DOMContentLoaded', async () => {
  if (typeof Auth !== 'undefined' && !Auth.requireAuth()) return;

  function fmt12(t) {
    const [h, m] = (t || '00:00').split(':').map(Number);
    const d = new Date(2000, 0, 1, h, m);
    return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  }
  function addMinute(t) {
    const [h, m] = t.split(':').map(Number);
    const d = new Date(2000, 0, 1, h, m + 1);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }

  function renderPolicies(cfg) {
    const el = document.getElementById('policy-rules');
    if (!el) return;
    const penalty = cfg.penalty_type === 'MARK_HALF_DAY' ? '3 Lates = Half-Day' : '3 Lates = 1 CL';
    const rows = [
      [`On-Time Arrival:`, `${fmt12(cfg.shift_start_time)} – ${fmt12(cfg.grace_cutoff_time)}`, 'Marked full-day Present without penalty', 'badge-ontime', 'PRESENT'],
      [`Late Arrival:`, `${fmt12(addMinute(cfg.grace_cutoff_time))} – ${fmt12(cfg.late_cutoff_time)}`, `Triggers automated warning email (${penalty})`, 'badge-late', 'LATE'],
      [`Late Arrival (Post ${fmt12(cfg.late_cutoff_time)}):`, `After ${fmt12(cfg.late_cutoff_time)}`, 'Automatic downgrade to Half-Day + HR Alert', 'badge-halfday', 'HALF-DAY'],
      [`Early Logout (Pre ${fmt12(cfg.early_logout_cutoff_time)}):`, `Before ${fmt12(cfg.early_logout_cutoff_time)}`, 'Automatic downgrade to Half-Day deduction', 'badge-halfday', 'HALF-DAY'],
    ];
    el.innerHTML = rows.map(r => `
      <div class="rule-item">
        <div><strong>${r[0]}</strong> ${r[1]}
          <div style="font-size:12px; color:#64748b;">${r[2]}</div></div>
        <span class="rule-badge ${r[3]}">${r[4]}</span>
      </div>`).join('');
  }

  let currentCfg = {};
  async function loadPolicies() {
    try {
      currentCfg = await API.get('/attendance/config');
      renderPolicies(currentCfg);
    } catch (e) {
      const el = document.getElementById('policy-rules');
      if (el) el.innerHTML = `<div style="color:#b91c1c;">Could not load policies: ${e.message}</div>`;
    }
  }

  // Load employee dropdown and records
  async function loadEmployees() {
    try {
      const data = await API.get('/employees?limit=500');
      const select = document.getElementById('filter-att-employee');
      if (select) {
        select.innerHTML = '<option value="">All Employees</option>';
        (data.employees || data.data || []).forEach(emp => {
          const opt = document.createElement('option');
          opt.value = emp.employee_code || emp.id || emp._id;
          opt.textContent = `${emp.full_name || emp.name} (${emp.employee_code || emp.id})`;
          select.appendChild(opt);
        });
      }
    } catch (e) {
      console.error('Error loading employees:', e);
    }
  }

  async function loadAttendanceRecords(params = {}) {
    const tbody = document.getElementById('attendance-table-body');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding:20px;">Fetching records...</td></tr>';
    
    let query = '/attendance?';
    if (params.date) query += `date_str=${params.date}&`;
    if (params.month) query += `month=${params.month}&`;
    if (params.employee_id) query += `employee_id=${params.employee_id}&`;

    try {
      const data = await API.get(query);
      const records = data.data || (Array.isArray(data) ? data : []);
      const countEl = document.getElementById('att-record-count');
      if (countEl) countEl.textContent = `${records.length} record(s)`;

      if (records.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding:30px; color:#64748b;">No attendance logs found.</td></tr>';
        return;
      }

      tbody.innerHTML = records.map(r => {
        let statusBadge = `<span class="rule-badge badge-ontime">PRESENT</span>`;
        if (r.status === 'LATE') statusBadge = `<span class="rule-badge badge-late">LATE (+${r.late_minutes}m)</span>`;
        else if (r.status === 'HALF_DAY') statusBadge = `<span class="rule-badge badge-halfday">HALF-DAY</span>`;
        else if (r.status === 'ABSENT') statusBadge = `<span class="rule-badge" style="background:#fecaca; color:#991b1b;">ABSENT</span>`;
        else if (r.status === 'ON_LEAVE') statusBadge = `<span class="rule-badge" style="background:#e0e7ff; color:#3730a3;">ON LEAVE</span>`;

        return `
          <tr>
            <td>
              <strong>${r.employee_name || 'Staff'}</strong>
              <div style="font-size:12px; color:#64748b;">${r.department || 'General'} &bull; ${r.employee_id}</div>
            </td>
            <td><strong>${r.attendance_date}</strong></td>
            <td>${r.punch_in_local || '--'}</td>
            <td>${r.punch_out_local || '--'}</td>
            <td><strong>${r.total_work_hours || 0} hrs</strong></td>
            <td>${statusBadge}</td>
            <td style="font-size:12px; color:#64748b;">
              ${r.penalty_details || r.half_day_reason || r.remarks || 'Standard punch'}
            </td>
          </tr>
        `;
      }).join('');
    } catch (e) {
      tbody.innerHTML = `<tr><td colspan="7" style="color:red; text-align:center;">Error loading records: ${e.message}</td></tr>`;
    }
  }

  // Settings Modal Handlers
  const btnOpenTiming = document.getElementById('btn-open-timing-settings');
  if (btnOpenTiming) {
    btnOpenTiming.addEventListener('click', async () => {
      try {
        const cfg = currentCfg && currentCfg.shift_start_time ? currentCfg : await API.get('/attendance/config');
        document.getElementById('cfg-shift-start').value = cfg.shift_start_time;
        document.getElementById('cfg-grace-cutoff').value = cfg.grace_cutoff_time;
        document.getElementById('cfg-late-cutoff').value = cfg.late_cutoff_time;
        document.getElementById('cfg-early-logout').value = cfg.early_logout_cutoff_time;
        document.getElementById('cfg-penalty-type').value = cfg.penalty_type || 'DEDUCT_CL';
        document.getElementById('cfg-hr-email').value = cfg.hr_notification_email || 'hr@rexera.co.in';
        
        const modal = document.getElementById('settings-modal');
        if (modal) {
          modal.style.display = 'flex';
          modal.classList.add('active');
        }
      } catch (e) {
        if (typeof Toast !== 'undefined') Toast.error('Error loading configuration: ' + e.message);
        else alert('Error loading configuration: ' + e.message);
      }
    });
  }

  const attSettingsForm = document.getElementById('attendance-settings-form');
  if (attSettingsForm) {
    attSettingsForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const updated = {
        ...currentCfg,
        shift_start_time: document.getElementById('cfg-shift-start').value,
        grace_cutoff_time: document.getElementById('cfg-grace-cutoff').value,
        late_cutoff_time: document.getElementById('cfg-late-cutoff').value,
        early_logout_cutoff_time: document.getElementById('cfg-early-logout').value,
        penalty_type: document.getElementById('cfg-penalty-type').value,
        hr_notification_email: document.getElementById('cfg-hr-email').value
      };

      try {
        await API.put('/attendance/config', updated);
        await loadPolicies();
        if (typeof Toast !== 'undefined') Toast.success('Timing rules updated successfully!');
        else alert('Settings updated successfully!');
        
        const modal = document.getElementById('settings-modal');
        if (modal) {
          modal.style.display = 'none';
          modal.classList.remove('active');
        }
      } catch (err) {
        if (typeof Toast !== 'undefined') Toast.error(err.message || 'Failed to save settings');
        else alert(err.message);
      }
    });
  }

  // Filter actions
  const filterDate = document.getElementById('filter-att-date');
  if (filterDate) {
    filterDate.addEventListener('change', (e) => {
      loadAttendanceRecords({ date: e.target.value });
    });
  }

  const btnToday = document.getElementById('btn-filter-today');
  if (btnToday) {
    btnToday.addEventListener('click', () => {
      const today = new Date().toISOString().split('T')[0];
      if (filterDate) filterDate.value = today;
      loadAttendanceRecords({ date: today });
    });
  }

  const btnMonth = document.getElementById('btn-filter-this-month');
  if (btnMonth) {
    btnMonth.addEventListener('click', () => {
      const now = new Date();
      const monthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      loadAttendanceRecords({ month: monthStr });
    });
  }

  const btnRefresh = document.getElementById('btn-refresh-attendance');
  if (btnRefresh) {
    btnRefresh.addEventListener('click', () => {
      loadAttendanceRecords();
    });
  }

  await loadPolicies();
  await loadEmployees();
  await loadAttendanceRecords();
});
