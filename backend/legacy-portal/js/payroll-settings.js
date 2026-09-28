/**
 * Rexera HR Management System - Payroll Settings, SMTP & Logs
 */

document.addEventListener('DOMContentLoaded', async () => {
  if (typeof Auth !== 'undefined' && !Auth.requireAuth()) return;

  let currentSettings = null;

  // Tabs
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      btn.classList.add('active');
      const tabId = btn.getAttribute('data-tab');
      document.getElementById(tabId).classList.add('active');
    });
  });

  // Load Settings
  async function loadSettings() {
    try {
      currentSettings = await API.get('/payroll-settings');
      if (!currentSettings) return;

      // Tab 1: Rules
      document.getElementById('cfg-comp-name').value = currentSettings.company_name || '';
      document.getElementById('cfg-comp-email').value = currentSettings.company_email || '';
      document.getElementById('cfg-comp-phone').value = currentSettings.company_phone || '';
      document.getElementById('cfg-currency').value = currentSettings.currency || 'INR (₹)';
      document.getElementById('cfg-comp-address').value = currentSettings.company_address || '';
      document.getElementById('cfg-working-days').value = currentSettings.standard_working_days || 30;
      document.getElementById('cfg-proration').value = currentSettings.salary_proration_method || 'calendar_days';
      document.getElementById('cfg-late-rule').value = currentSettings.late_deduction_rule || 'count_tiers';
      document.getElementById('cfg-pt-amount').value = currentSettings.default_pt_amount || 200;
      document.getElementById('cfg-ot-multiplier').value = currentSettings.overtime_rate_multiplier || 1.5;
      document.getElementById('cfg-payslip-prefix').value = currentSettings.payslip_prefix || 'REX-PAY';

      // Tab 2: SMTP
      const smtp = currentSettings.smtp || {};
      document.getElementById('smtp-host').value = smtp.smtp_host || 'smtp.gmail.com';
      document.getElementById('smtp-port').value = smtp.smtp_port || 587;
      document.getElementById('smtp-user').value = smtp.smtp_user || '';
      document.getElementById('smtp-password').value = smtp.smtp_password || '';
      document.getElementById('smtp-from-name').value = smtp.from_name || 'Rexera HR & Payroll';
      document.getElementById('smtp-from-email').value = smtp.from_email || 'hr@rexera.co.in';
      document.getElementById('smtp-dev-mode').checked = smtp.email_dev_mode === true;

      // Tab 3: Templates
      const tpl = currentSettings.email_template || {};
      document.getElementById('tpl-subject').value = tpl.subject_template || 'Salary Payslip - {{month}} {{year}} - {{employee_code}}';
      document.getElementById('tpl-body').value = tpl.body_template || '';

    } catch (e) {
      API.toast(`Failed loading settings: ${e.message}`, 'error');
    }
  }

  // Save Rules Form
  document.getElementById('form-payroll-rules').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!currentSettings) return;

    currentSettings.company_name = document.getElementById('cfg-comp-name').value;
    currentSettings.company_email = document.getElementById('cfg-comp-email').value;
    currentSettings.company_phone = document.getElementById('cfg-comp-phone').value;
    currentSettings.currency = document.getElementById('cfg-currency').value;
    currentSettings.company_address = document.getElementById('cfg-comp-address').value;
    currentSettings.standard_working_days = parseInt(document.getElementById('cfg-working-days').value) || 30;
    currentSettings.salary_proration_method = document.getElementById('cfg-proration').value;
    currentSettings.late_deduction_rule = document.getElementById('cfg-late-rule').value;
    currentSettings.default_pt_amount = parseFloat(document.getElementById('cfg-pt-amount').value) || 200;
    currentSettings.overtime_rate_multiplier = parseFloat(document.getElementById('cfg-ot-multiplier').value) || 1.5;
    currentSettings.payslip_prefix = document.getElementById('cfg-payslip-prefix').value;

    try {
      await API.put('/payroll-settings', currentSettings);
      API.toast('Payroll configuration saved successfully.', 'success');
      await loadSettings();
    } catch (err) {
      API.toast(`Save error: ${err.message}`, 'error');
    }
  });

  // Save SMTP Form
  document.getElementById('form-smtp').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!currentSettings) return;

    currentSettings.smtp = {
      smtp_host: document.getElementById('smtp-host').value,
      smtp_port: parseInt(document.getElementById('smtp-port').value) || 587,
      smtp_user: document.getElementById('smtp-user').value,
      smtp_password: document.getElementById('smtp-password').value,
      smtp_encryption: 'TLS',
      from_name: document.getElementById('smtp-from-name').value,
      from_email: document.getElementById('smtp-from-email').value,
      email_dev_mode: document.getElementById('smtp-dev-mode').checked
    };

    try {
      await API.put('/payroll-settings', currentSettings);
      API.toast('SMTP settings saved successfully.', 'success');
      await loadSettings();
    } catch (err) {
      API.toast(`Save error: ${err.message}`, 'error');
    }
  });

  // Test SMTP Connection
  document.getElementById('btn-test-smtp').addEventListener('click', async () => {
    const btn = document.getElementById('btn-test-smtp');
    btn.disabled = true;
    btn.textContent = '⏳ Testing connection...';
    try {
      const res = await API.post('/payroll-settings/test-smtp?test_recipient=hr@rexera.co.in', {});
      API.toast(res.message || 'SMTP Test Connection Successful!', 'success');
    } catch (err) {
      API.toast(`SMTP Test Failed: ${err.message}`, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = '⚡ Test SMTP Connection';
    }
  });

  // Save Template Form
  document.getElementById('form-template').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!currentSettings) return;

    currentSettings.email_template = {
      subject_template: document.getElementById('tpl-subject').value,
      body_template: document.getElementById('tpl-body').value
    };

    try {
      await API.put('/payroll-settings', currentSettings);
      API.toast('Email template saved successfully.', 'success');
      await loadSettings();
    } catch (err) {
      API.toast(`Save error: ${err.message}`, 'error');
    }
  });

  // Preview Template
  document.getElementById('btn-preview-tpl').addEventListener('click', () => {
    const subj = document.getElementById('tpl-subject').value
      .replace('{{month}}', 'September')
      .replace('{{year}}', '2026')
      .replace('{{employee_code}}', 'EMP-001');

    let body = document.getElementById('tpl-body').value
      .replace(/{{employee_name}}/g, 'Aarav Sharma')
      .replace(/{{employee_code}}/g, 'EMP-001')
      .replace(/{{department}}/g, 'Engineering')
      .replace(/{{month}}/g, 'September')
      .replace(/{{year}}/g, '2026')
      .replace(/{{net_salary}}/g, '97,000.00')
      .replace(/{{company_name}}/g, 'Rexera Technologies Inc.')
      .replace(/{{payslip_number}}/g, 'REX-PAY-2026SEP-0001');

    alert(`[PREVIEW SUBJECT]\n${subj}\n\n[PREVIEW BODY]\n${body}`);
  });

  // ==========================================
  // TAB 4: AUDIT & EMAIL LOGS
  // ==========================================
  async function loadAuditLogs() {
    const tbody = document.getElementById('audit-table-body');
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding:20px;">Loading audit logs...</td></tr>`;
    try {
      const logs = await API.get('/payroll-settings/audit-logs');
      if (!logs || logs.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding:20px; color:#64748b;">No audit records logged yet.</td></tr>`;
        return;
      }
      tbody.innerHTML = logs.map(l => `
        <tr>
          <td><small>${l.timestamp ? l.timestamp.replace('T', ' ').slice(0, 19) : 'N/A'}</small></td>
          <td><strong>${l.user_email}</strong> <small>(${l.user_role})</small></td>
          <td><span class="badge badge-calculated">${l.action}</span></td>
          <td><code>${l.entity_type}</code></td>
          <td>${l.employee_name || 'System / Batch'}</td>
        </tr>
      `).join('');
    } catch (e) {
      tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; color:var(--danger);">${e.message}</td></tr>`;
    }
  }

  async function loadEmailLogs() {
    const tbody = document.getElementById('email-logs-table-body');
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:20px;">Loading email transmission logs...</td></tr>`;
    try {
      const logs = await API.get('/payroll-settings/email-logs');
      if (!logs || logs.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:20px; color:#64748b;">No payslip emails dispatched yet.</td></tr>`;
        return;
      }
      tbody.innerHTML = logs.map(l => `
        <tr>
          <td><small>${l.sent_at ? l.sent_at.replace('T', ' ').slice(0, 19) : 'N/A'}</small></td>
          <td><strong>${l.employee_name}</strong> <small>(${l.employee_code})</small></td>
          <td><code>${l.email}</code></td>
          <td><code>${l.payslip_number}</code></td>
          <td>${l.month} ${l.year}</td>
          <td style="text-align:center;">
            <span class="badge ${l.status === 'Sent' ? 'badge-approved' : 'badge-locked'}">${l.status}</span>
          </td>
          <td><small style="color:${l.status === 'Sent' ? '#047857' : '#991b1b'};">${l.error_message || 'Transmitted successfully'}</small></td>
        </tr>
      `).join('');
    } catch (e) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; color:var(--danger);">${e.message}</td></tr>`;
    }
  }

  document.getElementById('btn-refresh-audit').addEventListener('click', loadAuditLogs);
  document.getElementById('btn-refresh-email-logs').addEventListener('click', loadEmailLogs);

  // Logout
  const btnLogout = document.getElementById('btn-logout');
  if (btnLogout) {
    btnLogout.addEventListener('click', () => {
      if (typeof Auth !== 'undefined') Auth.logout();
      else { localStorage.clear(); window.location.href = '/admin-login.html'; }
    });
  }

  // Initial Load
  await loadSettings();
  await loadAuditLogs();
  await loadEmailLogs();
});
