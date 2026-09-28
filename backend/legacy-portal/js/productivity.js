document.addEventListener('DOMContentLoaded', async () => {
  if (typeof Auth !== 'undefined' && !Auth.requireAuth()) return;

  let employeesList = [];
  let tasksList = [];

  const todayStr = new Date().toISOString().split('T')[0];
  const dateFilter = document.getElementById('efficiency-date-filter');
  const workDateInput = document.getElementById('ts-work-date');
  if (dateFilter) dateFilter.value = todayStr;
  if (workDateInput) workDateInput.value = todayStr;

  function populateSelects() {
    const empOptions = employeesList.length
      ? employeesList.map(e => `
        <option value="${e.employee_code || e.id || e._id}">${e.full_name || e.name} (${e.employee_code || e.id})</option>
      `).join('')
      : '<option value="">No employees found</option>';
    ['ts-emp-select', 'blocker-emp-select', 'nt-emp'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.innerHTML = empOptions;
    });

    const taskOptions = tasksList.length
      ? tasksList.map(t => `
        <option value="${t._id || t.id}">[${t.client_name || 'Client'}] ${t.task_title} (${t.project_name || 'Project'})</option>
      `).join('')
      : '<option value="">No tasks available</option>';
    ['ts-task-select', 'blocker-task-select'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.innerHTML = taskOptions;
    });
    const noTasks = document.getElementById('ts-no-tasks');
    if (noTasks) noTasks.style.display = tasksList.length ? 'none' : 'block';

    const uniq = (arr) => [...new Set(arr.filter(Boolean))];
    const fillList = (id, values) => {
      const el = document.getElementById(id);
      if (el) el.innerHTML = values.map(v => `<option value="${v}"></option>`).join('');
    };
    fillList('nt-client-list', uniq(tasksList.map(t => t.client_name)));
    fillList('nt-project-list', uniq(tasksList.map(t => t.project_name)));
  }

  async function loadInitialData() {
    try {
      const [empData, taskData] = await Promise.all([
        API.get('/employees?limit=500'),
        API.get('/productivity/tasks')
      ]);
      
      employeesList = empData.employees || empData.data || [];
      tasksList = taskData.data || (Array.isArray(taskData) ? taskData : []);

      populateSelects();

    } catch (e) {
      console.error('Error loading initial data:', e);
      if (typeof Toast !== 'undefined') Toast.error('Failed to load initial employees or tasks: ' + e.message);
    }
  }

  async function loadBirdsEyeDashboard(targetDate) {
    try {
      const data = await API.get(`/productivity/dashboard/birds-eye?date_str=${targetDate}`);
      const analytics = data.data || data;

      // Summary KPIs
      if (analytics.summary_metrics) {
        document.getElementById('stat-active-proj-count').textContent = analytics.summary_metrics.active_projects_count ?? 0;
        document.getElementById('stat-underutilized-count').textContent = analytics.summary_metrics.underutilized_count ?? 0;
        document.getElementById('stat-burnout-count').textContent = analytics.summary_metrics.burnout_risk_count ?? 0;
      }

      if (analytics.employee_efficiency) {
        const totalBilled = analytics.employee_efficiency.reduce((acc, curr) => acc + (curr.logged_hours || 0), 0);
        document.getElementById('stat-total-billed-today').textContent = `${totalBilled.toFixed(1)} hrs`;

        // Render Efficiency Table
        const effTbody = document.getElementById('efficiency-tbody');
        if (effTbody) {
          if (analytics.employee_efficiency.length === 0) {
            effTbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:20px; color:#64748b;">No employee records logged for today.</td></tr>`;
          } else {
            effTbody.innerHTML = analytics.employee_efficiency.map(e => {
              let healthTag = `<span class="status-badge-optimal">OPTIMAL</span>`;
              if (e.health_status === 'UNDERUTILIZED') healthTag = `<span class="status-badge-underutilized">IDLE / &lt; 4H</span>`;
              else if (e.health_status === 'BURNOUT_RISK') healthTag = `<span class="status-badge-burnout">BURNOUT / 10H+</span>`;
              else if (e.health_status === 'ON_LEAVE') healthTag = `<span style="color:#6366f1; font-weight:bold;">ON LEAVE</span>`;
              else if (e.health_status === 'ABSENT') healthTag = `<span style="color:#94a3b8;">ABSENT</span>`;

              return `
                <tr>
                  <td>
                    <strong>${e.employee_name}</strong>
                    <div style="font-size:12px; color:#64748b;">${e.department} &bull; ${e.employee_id}</div>
                  </td>
                  <td><strong>${e.attendance_status}</strong></td>
                  <td>${e.present_hours} hrs</td>
                  <td><strong>${e.logged_hours} hrs</strong></td>
                  <td><strong>${e.efficiency_pct}%</strong></td>
                  <td>${healthTag}</td>
                </tr>
              `;
            }).join('');
          }
        }
      }

      // Render Red Zone Blockers
      const blockers = analytics.red_zone_bottlenecks || [];
      const rzCount = document.getElementById('red-zone-count');
      if (rzCount) rzCount.textContent = `${blockers.length} Blocked`;
      const rzGrid = document.getElementById('red-zone-grid');

      if (rzGrid) {
        if (blockers.length === 0) {
          rzGrid.innerHTML = `<div style="color:rgba(255,255,255,0.8); font-size:13px;">✅ No critical bottlenecks flagged across active projects.</div>`;
        } else {
          rzGrid.innerHTML = blockers.map(b => `
            <div class="blocker-card">
              <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
                <span class="blocker-cat-pill">${b.blocker_category ? b.blocker_category.replace(/_/g, ' ') : 'BLOCKER'}</span>
                <span style="font-size:11.5px; color:#fff; font-weight:bold;">Stuck: ${b.stuck_duration_hours}h</span>
              </div>
              <div style="font-weight:bold; font-size:14px; margin-bottom:4px; color:#fff;">${b.task_title}</div>
              <div style="font-size:12px; color:rgba(255,255,255,0.8); margin-bottom:8px;">
                ${b.client_name} &bull; ${b.project_name} &bull; <strong>${b.assigned_to}</strong>
              </div>
              <div style="background:rgba(0,0,0,0.2); padding:6px 10px; border-radius:4px; font-size:12px; color:#fff;">
                "${b.blocker_reason}"
              </div>
            </div>
          `).join('');
        }
      }

      // Render Projects Table
      const projTbody = document.getElementById('projects-tbody');
      if (projTbody && analytics.active_projects) {
        if (analytics.active_projects.length === 0) {
          projTbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:20px; color:#64748b;">No active client projects found.</td></tr>`;
        } else {
          projTbody.innerHTML = analytics.active_projects.map(p => `
            <tr>
              <td><strong>${p.project_name}</strong></td>
              <td>${p.client_name}</td>
              <td>${p.project_manager}</td>
              <td>${p.completed_tasks}/${p.total_tasks} Tasks Done (${p.blocked_tasks} Blocked)</td>
              <td>
                <div style="display:flex; align-items:center; gap:8px;">
                  <div style="flex:1; background:#e2e8f0; height:8px; border-radius:4px; overflow:hidden;">
                    <div style="width:${p.completion_percentage}%; background:#10b981; height:100%;"></div>
                  </div>
                  <span style="font-weight:bold; font-size:12px;">${p.completion_percentage}%</span>
                </div>
              </td>
              <td><strong>${p.logged_hours_total} / ${p.budget_hours} hrs</strong></td>
            </tr>
          `).join('');
        }
      }

    } catch (e) {
      console.error('Error loading dashboard:', e);
      if (typeof Toast !== 'undefined') Toast.error('Error loading productivity dashboard: ' + e.message);
    }
  }

  // Filter change
  const dateFilterEl = document.getElementById('efficiency-date-filter');
  if (dateFilterEl) {
    dateFilterEl.addEventListener('change', (e) => {
      loadBirdsEyeDashboard(e.target.value);
    });
  }

  // New Task modal + submit
  const btnOpenNewTask = document.getElementById('btn-open-new-task');
  if (btnOpenNewTask) {
    btnOpenNewTask.addEventListener('click', () => {
      document.getElementById('new-task-modal')?.classList.add('active');
    });
  }
  const newTaskForm = document.getElementById('new-task-form');
  if (newTaskForm) {
    newTaskForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await API.post('/productivity/tasks/quick', {
          client_name: document.getElementById('nt-client').value,
          project_name: document.getElementById('nt-project').value,
          task_title: document.getElementById('nt-title').value,
          employee_id: document.getElementById('nt-emp').value,
          estimated_hours: parseFloat(document.getElementById('nt-hours').value) || 0
        });
        if (typeof Toast !== 'undefined') Toast.success('Task created.');
        document.getElementById('new-task-modal')?.classList.remove('active');
        newTaskForm.reset();
        document.getElementById('nt-hours').value = 8;
        await loadInitialData();
        loadBirdsEyeDashboard(document.getElementById('efficiency-date-filter')?.value || todayStr);
      } catch (err) {
        if (typeof Toast !== 'undefined') Toast.error(err.message || 'Failed to create task');
      }
    });
  }

  // Modal open
  const btnOpenTs = document.getElementById('btn-open-log-timesheet');
  if (btnOpenTs) {
    btnOpenTs.addEventListener('click', () => {
      const modal = document.getElementById('log-timesheet-modal');
      if (modal) modal.classList.add('active');
    });
  }

  const btnOpenBlocker = document.getElementById('btn-open-flag-blocker');
  if (btnOpenBlocker) {
    btnOpenBlocker.addEventListener('click', () => {
      const modal = document.getElementById('flag-blocker-modal');
      if (modal) modal.classList.add('active');
    });
  }

  // Log Timesheet Form Submit
  const logForm = document.getElementById('log-timesheet-form');
  if (logForm) {
    logForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const payload = {
        employee_id: document.getElementById('ts-emp-select').value,
        task_id: document.getElementById('ts-task-select').value,
        work_date: document.getElementById('ts-work-date').value,
        hours_spent: parseFloat(document.getElementById('ts-hours').value),
        work_description: document.getElementById('ts-desc').value,
        task_new_status: document.getElementById('ts-status-select').value
      };

      try {
        const data = await API.post('/productivity/timesheet/log', payload);
        if (typeof Toast !== 'undefined') Toast.success(data.message || 'Timesheet entry logged successfully!');
        else alert(`[SUCCESS] ${data.message}`);
        
        document.getElementById('log-timesheet-modal')?.classList.remove('active');
        logForm.reset();
        if (workDateInput) workDateInput.value = todayStr;
        loadBirdsEyeDashboard(document.getElementById('efficiency-date-filter')?.value || todayStr);
      } catch (err) {
        if (typeof Toast !== 'undefined') Toast.error(err.message || 'Failed to log timesheet');
        else alert(`[VALIDATION ERROR] ${err.message}`);
      }
    });
  }

  // Flag Blocker Form Submit
  const blockerForm = document.getElementById('flag-blocker-form');
  if (blockerForm) {
    blockerForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const payload = {
        employee_id: document.getElementById('blocker-emp-select').value,
        task_id: document.getElementById('blocker-task-select').value,
        blocker_category: document.getElementById('blocker-category-select').value,
        blocker_reason: document.getElementById('blocker-reason-text').value
      };

      try {
        const data = await API.post('/productivity/tasks/flag-blocker', payload);
        if (typeof Toast !== 'undefined') Toast.warning(data.message || 'Blocker escalated successfully!');
        else alert(`[ESCALATED] ${data.message}`);

        document.getElementById('flag-blocker-modal')?.classList.remove('active');
        blockerForm.reset();
        loadBirdsEyeDashboard(document.getElementById('efficiency-date-filter')?.value || todayStr);
      } catch (err) {
        if (typeof Toast !== 'undefined') Toast.error(err.message || 'Failed to flag blocker');
        else alert(`[ERROR] ${err.message}`);
      }
    });
  }

  await loadInitialData();
  await loadBirdsEyeDashboard(todayStr);
});
