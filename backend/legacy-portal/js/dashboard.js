/**
 * Rexera HR Executive Dashboard Controller
 */

document.addEventListener('DOMContentLoaded', async () => {
  // Only execute on dashboard.html
  if (!document.getElementById('dashboard-metrics-container')) return;

  await loadDashboardMetrics();
});

async function loadDashboardMetrics() {
  try {
    const data = await API.get('/dashboard/metrics');

    // Update Top Ribbon KPI Stats Counters
    const activeEmps = data.active_employees || 0;
    const activeInterns = data.active_interns || 0;
    if (document.getElementById('stat-employees')) {
      document.getElementById('stat-employees').textContent = (activeEmps + activeInterns);
    }
    if (document.getElementById('stat-interns-sub')) {
      document.getElementById('stat-interns-sub').textContent = `${activeInterns} Interns`;
    }

    // Attendance Today KPI
    const att = data.attendance_summary || {};
    if (document.getElementById('stat-attendance-today')) {
      document.getElementById('stat-attendance-today').textContent = `${att.present_count || 0} Present`;
    }
    if (document.getElementById('stat-attendance-sub')) {
      document.getElementById('stat-attendance-sub').textContent = `${att.late_count || 0} Late / ${att.half_day_count || 0} Half-Day →`;
    }
    if (document.getElementById('launcher-att-stat')) {
      document.getElementById('launcher-att-stat').textContent = `${att.total_punched_in || 0} Checked-in Today`;
    }

    // Productivity & Client Hours KPI
    const prod = data.productivity_summary || {};
    if (document.getElementById('stat-hours-today')) {
      document.getElementById('stat-hours-today').textContent = `${prod.billed_hours_today || 0} hrs`;
    }
    if (document.getElementById('stat-blockers-sub')) {
      document.getElementById('stat-blockers-sub').textContent = `${prod.red_zone_blockers_count || 0} Active Blockers →`;
    }
    if (document.getElementById('launcher-blocker-badge')) {
      const blockerBadge = document.getElementById('launcher-blocker-badge');
      const blkCount = prod.red_zone_blockers_count || 0;
      blockerBadge.textContent = `${blkCount} Red-Zone Blocker${blkCount === 1 ? '' : 's'}`;
      blockerBadge.className = blkCount > 0 ? 'module-badge alert' : 'module-badge live';
    }
    if (document.getElementById('launcher-prod-stat')) {
      document.getElementById('launcher-prod-stat').textContent = `${prod.active_projects_count || 0} Active Projects`;
    }

    // Leaves Summary KPI
    const leaves = data.leaves_summary || {};
    const pendingLeavesCount = leaves.pending_requests_count || 0;
    if (document.getElementById('stat-pending-leaves')) {
      document.getElementById('stat-pending-leaves').textContent = pendingLeavesCount;
    }
    if (document.getElementById('stat-leaves-sub')) {
      document.getElementById('stat-leaves-sub').textContent = `${leaves.on_leave_today_count || 0} On Leave Today →`;
    }
    if (document.getElementById('launcher-leave-badge')) {
      const leaveBadge = document.getElementById('launcher-leave-badge');
      leaveBadge.textContent = `${pendingLeavesCount} Pending Request${pendingLeavesCount === 1 ? '' : 's'}`;
      leaveBadge.className = pendingLeavesCount > 0 ? 'module-badge warning' : 'module-badge live';
    }
    if (document.getElementById('launcher-leave-stat')) {
      document.getElementById('launcher-leave-stat').textContent = `${leaves.on_leave_today_count || 0} Out Today`;
    }

    // Net Payroll Disbursed KPI
    if (document.getElementById('stat-payroll')) {
      document.getElementById('stat-payroll').textContent = `₹${(data.total_payroll_processed || 0).toLocaleString('en-IN')}`;
    }
    if (document.getElementById('launcher-payroll-stat')) {
      document.getElementById('launcher-payroll-stat').textContent = `₹${(data.total_payroll_processed || 0).toLocaleString('en-IN')} Disbursed`;
    }

    // Candidates & Pipeline KPI
    if (document.getElementById('stat-candidates')) {
      document.getElementById('stat-candidates').textContent = data.total_candidates || 0;
    }
    if (document.getElementById('stat-onboarding')) {
      document.getElementById('stat-onboarding').textContent = data.pending_onboarding || 0;
    }
    if (document.getElementById('launcher-cand-stat')) {
      document.getElementById('launcher-cand-stat').textContent = `${data.total_candidates || 0} In Pipeline`;
    }

    // Broadcasts KPI
    const bcasts = data.broadcasts_summary || {};
    if (document.getElementById('launcher-bcast-badge')) {
      document.getElementById('launcher-bcast-badge').textContent = `${bcasts.active_broadcasts_count || 0} Active Alerts`;
    }
    if (document.getElementById('launcher-bcast-stat')) {
      document.getElementById('launcher-bcast-stat').textContent = bcasts.latest_title && bcasts.latest_title !== 'None' ? bcasts.latest_title.substring(0, 24) + '...' : 'System Broadcaster';
    }

    // Loans & Advances KPI
    const loans = data.advances_summary || {};
    if (document.getElementById('launcher-loan-badge')) {
      document.getElementById('launcher-loan-badge').textContent = `${loans.active_loans_count || 0} Active Loans`;
    }
    if (document.getElementById('launcher-loan-stat')) {
      document.getElementById('launcher-loan-stat').textContent = `${loans.active_advances_count || 0} Salary Advances`;
    }

    // Employee Directory Launcher
    if (document.getElementById('launcher-emp-stat')) {
      document.getElementById('launcher-emp-stat').textContent = `${activeEmps} Full-Time Staff`;
    }

    // Render Per-HR Metrics Card
    renderHRMetrics(data);

    // Render Recruitment Pipeline Bars
    renderPipelineProgress(data.candidates_by_status || [], data.total_candidates || 0);

    // Render Upcoming Interviews
    renderUpcomingInterviews(data.upcoming_interviews || []);

    // Render Recent Activities Stream
    renderRecentActivities(data.recent_activities || []);

    // Render live Notifications (status changes & onboarding completions)
    renderNotifications(data.notifications || []);

  } catch (error) {
    Toast.error('Failed to load dashboard metrics: ' + error.message);
  }
}

function renderHRMetrics(data) {
  const card = document.getElementById('hr-metrics-card');
  if (!card) return;

  const myTotal = data.my_total_candidates || 0;
  const myOnboarding = data.my_onboarding || 0;
  const myPending = data.my_pending_onboarding || 0;
  const hrName = data.hr_name || 'HR';

  // Always show the card
  card.style.display = 'block';

  const titleEl = document.getElementById('hr-metrics-title');
  if (titleEl) titleEl.textContent = `${hrName}'s Candidate Summary`;

  const elMyC = document.getElementById('stat-my-candidates');
  const elMyO = document.getElementById('stat-my-onboarding');
  const elMyP = document.getElementById('stat-my-pending');

  if (elMyC) elMyC.textContent = myTotal;
  if (elMyO) elMyO.textContent = myOnboarding;
  if (elMyP) elMyP.textContent = myPending;
}

function renderPipelineProgress(statusCounts, total) {
  const container = document.getElementById('pipeline-progress-container');
  if (!container) return;

  if (statusCounts.length === 0 || total === 0) {
    container.innerHTML = `<p style="font-size: 13px; color: var(--text-muted);">No candidates in pipeline yet.</p>`;
    return;
  }

  const colorMap = {
    'Applied': 'var(--info)',
    'Screening': '#6366f1',
    'Interview Scheduled': '#8b5cf6',
    'Interviewed': '#3b82f6',
    'Selected': 'var(--rex-gold)',
    'Joined': 'var(--success)',
    'On Hold': 'var(--warning)',
    'Rejected': 'var(--danger)'
  };

  container.innerHTML = statusCounts.map(item => {
    const pct = total > 0 ? Math.round((item.count / total) * 100) : 0;
    const color = colorMap[item.status] || 'var(--rex-navy)';
    return `
      <div class="pipeline-item">
        <div class="pipeline-info">
          <span>${item.status}</span>
          <span style="color: var(--text-muted);">${item.count} (${pct}%)</span>
        </div>
        <div class="progress-track">
          <div class="progress-fill" style="width: ${pct}%; background: ${color};"></div>
        </div>
      </div>
    `;
  }).join('');
}

function renderUpcomingInterviews(interviews) {
  const tbody = document.getElementById('upcoming-interviews-tbody');
  if (!tbody) return;

  if (interviews.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="4" style="text-align: center; color: var(--text-muted); padding: 24px;">
          No upcoming interviews scheduled today.
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = interviews.map(i => `
    <tr>
      <td>
        <div class="user-cell">
          <div class="user-cell-avatar">${i.candidate_name.charAt(0)}</div>
          <div class="user-cell-info">
            <span class="user-cell-name">${i.candidate_name}</span>
            <span class="user-cell-sub">${i.email}</span>
          </div>
        </div>
      </td>
      <td><strong>${i.position}</strong></td>
      <td><code>${i.interview_date}</code></td>
      <td>
        <span class="badge badge-${i.status.toLowerCase().replace(/\s+/g, '-')}">
          <span class="badge-dot"></span>${i.status}
        </span>
      </td>
    </tr>
  `).join('');
}

function renderRecentActivities(activities) {
  const container = document.getElementById('recent-activities-container');
  if (!container) return;

  if (activities.length === 0) {
    container.innerHTML = `<p style="font-size: 13px; color: var(--text-muted); text-align: center; padding: 20px;">No recent activities logged.</p>`;
    return;
  }

  container.innerHTML = activities.map(act => `
    <div class="activity-item ${act.type}">
      <div class="activity-dot"></div>
      <div class="activity-content">
        <div class="activity-title">${act.title}</div>
        <div class="activity-desc">${act.description}</div>
        <div class="activity-time">${act.timestamp}</div>
      </div>
    </div>
  `).join('');
}

function renderNotifications(notifications) {
  const container = document.getElementById('notifications-container');
  if (!container) return;

  if (notifications.length === 0) {
    container.innerHTML = `<p style="font-size: 13px; color: var(--text-muted); text-align: center; padding: 20px;">No notifications yet.</p>`;
    return;
  }

  container.innerHTML = notifications.map(n => {
    const details = n.details || {};
    let cssType = 'status-other';
    let title = '';
    let desc = details.message || '';

    if (n.action === 'ONBOARDING_COMPLETED') {
      cssType = 'onboarding';
      title = `🎉 ${n.target} completed onboarding`;
      desc = `Bank details verified & HR policy signed. Employee ID: ${details.employee_code || 'N/A'}`;
    } else if (n.action === 'CANDIDATE_STATUS_CHANGE') {
      const newStatus = details.new_status || '';
      if (newStatus === 'Joined') {
        cssType = 'status-joined';
        title = `✅ ${n.target} joined`;
      } else if (newStatus === 'Rejected') {
        cssType = 'status-rejected';
        title = `❌ ${n.target} marked Rejected`;
      } else if (newStatus === 'On Hold') {
        cssType = 'status-hold';
        title = `⏸️ ${n.target} put On Hold`;
      } else {
        cssType = 'status-other';
        title = `🔄 ${n.target}: ${details.old_status || ''} → ${newStatus}`;
      }
      desc = details.notes ? `Reason: ${details.notes}` : `Status updated by ${n.performed_by || 'admin'}`;
    }

    const time = formatNotificationTime(n.timestamp);

    return `
      <div class="activity-item ${cssType}">
        <div class="activity-dot"></div>
        <div class="activity-content">
          <div class="activity-title">${title}</div>
          <div class="activity-desc">${desc}</div>
          <div class="activity-time">${time}</div>
        </div>
      </div>
    `;
  }).join('');
}

function formatNotificationTime(timestamp) {
  if (!timestamp) return '';
  const d = new Date(timestamp);
  if (isNaN(d.getTime())) return timestamp;
  return d.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

/**
 * System-Wide Complete Backup & Restore Engine
 */
function toggleSystemExportMenu() {
  const menu = document.getElementById('system-export-menu');
  if (!menu) return;
  const isShown = menu.style.display === 'block';
  menu.style.display = isShown ? 'none' : 'block';

  if (!isShown) {
    const hideListener = (e) => {
      if (!menu.contains(e.target) && e.target.id !== 'btn-export-all-dropdown') {
        menu.style.display = 'none';
        document.removeEventListener('click', hideListener);
      }
    };
    setTimeout(() => document.addEventListener('click', hideListener), 10);
  }
}

async function exportCompleteSystem(format = 'xlsx') {
  try {
    Toast.info('Preparing complete system data backup...');
    const data = await API.get('/dashboard/export-all');

    const dateStr = new Date().toISOString().substring(0, 10);
    const filename = `Rexera_Complete_HR_System_Backup_${dateStr}.${format}`;

    if (format === 'json') {
      const jsonBlob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(jsonBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      Toast.success('Full database JSON backup downloaded successfully!');
    } else {
      // Multi-sheet Excel workbook
      const sheets = {
        'Employees': data.employees || [],
        'Interns': data.interns || [],
        'Candidates': data.candidates || [],
        'Salary Slips': data.salary_slips || []
      };
      Importer.exportFullSystemExcel(sheets, filename);
    }
  } catch (err) {
    Toast.error('Failed to export system backup: ' + err.message);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const restoreInput = document.getElementById('system-restore-file-input');
  if (!restoreInput) return;

  restoreInput.addEventListener('change', async () => {
    if (!restoreInput.files || restoreInput.files.length === 0) return;
    const file = restoreInput.files[0];
    const filename = file.name.toLowerCase();

    try {
      let payload = { employees: [], interns: [], candidates: [] };

      if (filename.endsWith('.json')) {
        Toast.info(`Reading backup file ${file.name}...`);
        const text = await file.text();
        const parsed = JSON.parse(text);
        payload.employees = parsed.employees || [];
        payload.interns = parsed.interns || [];
        payload.candidates = parsed.candidates || [];
      } else if (filename.endsWith('.xlsx') || filename.endsWith('.xls')) {
        Toast.info(`Reading multi-sheet workbook ${file.name}...`);
        const allSheets = await Importer.parseAllSheets(file);
        payload.employees = allSheets['employees'] || allSheets['employee'] || [];
        payload.interns = allSheets['interns'] || allSheets['intern'] || [];
        payload.candidates = allSheets['candidates'] || allSheets['candidate'] || [];
      } else {
        Toast.error('Please upload a .xlsx, .xls, or .json backup file.');
        return;
      }

      const totalCount = payload.employees.length + payload.interns.length + payload.candidates.length;
      if (totalCount === 0) {
        Toast.warning('No compatible records found in the backup file.');
        return;
      }

      const confirmRestore = await Confirm.show(
        `Restore system database from <strong>${file.name}</strong>?<br><br>` +
        `• Employees: ${payload.employees.length}<br>` +
        `• Interns: ${payload.interns.length}<br>` +
        `• Candidates: ${payload.candidates.length}`,
        { title: 'Restore Database', confirmText: 'Restore', danger: true }
      );

      if (!confirmRestore) return;

      Toast.info('Restoring database records...');
      const res = await API.post('/dashboard/import-all', payload);
      Toast.success(res.message || 'System data restored successfully!');
      setTimeout(() => {
        loadDashboardMetrics();
      }, 1200);

    } catch (err) {
      console.error('System restore error:', err);
      Toast.error('Restore failed: ' + err.message);
    } finally {
      restoreInput.value = '';
    }
  });
});

window.toggleSystemExportMenu = toggleSystemExportMenu;
window.exportCompleteSystem = exportCompleteSystem;
