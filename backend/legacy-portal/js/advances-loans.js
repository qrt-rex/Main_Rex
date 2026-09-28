/**
 * Rexera HR Management System - Advances, Loans, Bonuses & Overtime Operations
 */

document.addEventListener('DOMContentLoaded', async () => {
  if (typeof Auth !== 'undefined' && !Auth.requireAuth()) return;

  let employeesList = [];

  // Tab Switching
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      btn.classList.add('active');
      const tabId = btn.getAttribute('data-tab');
      document.getElementById(tabId).classList.add('active');
    });
  });

  function formatMoney(val) {
    const num = parseFloat(val) || 0;
    return '₹' + num.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  // Fetch active employees for dropdowns
  async function loadEmployeesDropdown() {
    try {
      const res = await API.get('/employees?status=Active&limit=500');
      employeesList = Array.isArray(res) ? res : (res.employees || res.data || []);
      const opts = (employeesList.length ? '<option value="">-- Choose Employee --</option>' : '<option value="">No active employees found</option>') + employeesList.map(e => `
        <option value="${e.id || e._id}">${e.employee_code} - ${e.full_name} (${e.department})</option>
      `).join('');

      document.getElementById('adv-emp-select').innerHTML = opts;
      document.getElementById('loan-emp-select').innerHTML = opts;
      document.getElementById('bonus-emp-select').innerHTML = opts;
      document.getElementById('ot-emp-select').innerHTML = opts;
    } catch (e) {
      console.error('Failed to load employees for selects:', e);
      ['adv-emp-select', 'loan-emp-select', 'bonus-emp-select', 'ot-emp-select'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.innerHTML = '<option value="">Could not load employees</option>';
      });
    }
  }

  // ==========================================
  // TAB 1: ADVANCES
  // ==========================================
  async function loadAdvances() {
    const tbody = document.getElementById('advances-table-body');
    tbody.innerHTML = `<tr><td colspan="9" style="text-align:center; padding:30px;">Loading advances...</td></tr>`;
    try {
      const list = await API.get('/advances');
      if (!list || list.length === 0) {
        tbody.innerHTML = `<tr><td colspan="9" style="text-align:center; padding:30px; color:#64748b;">No salary advance records active. Click "+ Issue Salary Advance" to create one.</td></tr>`;
        return;
      }
      tbody.innerHTML = list.map(a => {
        const pct = Math.min(100, Math.round(((a.paid_amount || 0) / (a.advance_amount || 1)) * 100));
        return `
          <tr>
            <td><code>${a.advance_id}</code></td>
            <td>
              <strong>${a.employee_name}</strong>
              <div style="font-size:11px; color:#64748b;">${a.employee_code} • ${a.department}</div>
            </td>
            <td>${a.request_date}</td>
            <td style="text-align:right; font-family:monospace; font-weight:700;">${formatMoney(a.advance_amount)}</td>
            <td style="text-align:right; font-family:monospace; color:#1e3a8a;">${formatMoney(a.monthly_deduction_amount)}/mo</td>
            <td style="text-align:right; font-family:monospace; color:#047857;">
              ${formatMoney(a.paid_amount)}
              <div style="font-size:10px; color:#64748b;">${pct}% recovered</div>
            </td>
            <td style="text-align:right; font-family:monospace; font-weight:700; color:#b45309;">${formatMoney(a.remaining_balance)}</td>
            <td style="text-align:center;">
              <span class="badge ${a.status === 'Fully Recovered' ? 'badge-paid' : 'badge-approved'}">${a.status}</span>
            </td>
            <td style="text-align:center;">
              ${a.status === 'Pending' ? `
                <button class="btn btn-sm btn-gold btn-adv-approve" data-id="${a.id || a._id}">Approve</button>
              ` : `<span style="font-size:12px; color:#64748b;">Active</span>`}
            </td>
          </tr>`;
      }).join('');
    } catch (e) {
      tbody.innerHTML = `<tr><td colspan="9" style="text-align:center; padding:30px; color:var(--danger);">${e.message}</td></tr>`;
    }
  }

  // Create Advance Modal & Submit
  const modalAdv = document.getElementById('modal-advance');
  document.getElementById('btn-create-advance').addEventListener('click', () => modalAdv.style.display = 'flex');
  document.getElementById('btn-close-advance-modal').addEventListener('click', () => modalAdv.style.display = 'none');
  document.getElementById('btn-cancel-adv-modal').addEventListener('click', () => modalAdv.style.display = 'none');

  document.getElementById('form-advance').addEventListener('submit', async (e) => {
    e.preventDefault();
    const empId = document.getElementById('adv-emp-select').value;
    const amt = parseFloat(document.getElementById('adv-amount').value);
    const monthly = parseFloat(document.getElementById('adv-monthly').value);
    const m = document.getElementById('adv-month').value;
    const y = parseInt(document.getElementById('adv-year').value) || 2026;
    const reason = document.getElementById('adv-reason').value;

    try {
      await API.post('/advances', {
        employee_id: empId,
        advance_amount: amt,
        monthly_deduction_amount: monthly,
        start_month: m,
        start_year: y,
        reason: reason
      });
      API.toast('Salary advance issued and approved.', 'success');
      modalAdv.style.display = 'none';
      document.getElementById('form-advance').reset();
      await loadAdvances();
    } catch (err) {
      API.toast(`Failed: ${err.message}`, 'error');
    }
  });

  // ==========================================
  // TAB 2: LOANS
  // ==========================================
  async function loadLoans() {
    const tbody = document.getElementById('loans-table-body');
    tbody.innerHTML = `<tr><td colspan="9" style="text-align:center; padding:30px;">Loading loans...</td></tr>`;
    try {
      const list = await API.get('/loans');
      if (!list || list.length === 0) {
        tbody.innerHTML = `<tr><td colspan="9" style="text-align:center; padding:30px; color:#64748b;">No employee loans registered. Click "+ Issue Employee Loan" to add one.</td></tr>`;
        return;
      }
      tbody.innerHTML = list.map(l => `
        <tr>
          <td><code>${l.loan_id}</code></td>
          <td>
            <strong>${l.employee_name}</strong>
            <div style="font-size:11px; color:#64748b;">${l.employee_code} • ${l.department}</div>
          </td>
          <td>${l.start_date}</td>
          <td style="text-align:right; font-family:monospace;">${formatMoney(l.principal_amount)}</td>
          <td style="text-align:right;">${l.interest_rate_percent}%</td>
          <td style="text-align:right; font-family:monospace; font-weight:700;">${formatMoney(l.total_payable)}</td>
          <td style="text-align:right; font-family:monospace; color:#1e3a8a;">${formatMoney(l.monthly_emi)}/mo</td>
          <td style="text-align:right; font-family:monospace; color:#b45309; font-weight:700;">${formatMoney(l.remaining_amount)}</td>
          <td style="text-align:center;">
            <span class="badge ${l.status === 'Completed' ? 'badge-paid' : 'badge-approved'}">${l.status}</span>
          </td>
        </tr>
      `).join('');
    } catch (e) {
      tbody.innerHTML = `<tr><td colspan="9" style="text-align:center; padding:30px; color:var(--danger);">${e.message}</td></tr>`;
    }
  }

  // Create Loan Modal
  const modalLoan = document.getElementById('modal-loan');
  document.getElementById('btn-create-loan').addEventListener('click', () => modalLoan.style.display = 'flex');
  document.getElementById('btn-close-loan-modal').addEventListener('click', () => modalLoan.style.display = 'none');
  document.getElementById('btn-cancel-loan-modal').addEventListener('click', () => modalLoan.style.display = 'none');

  document.getElementById('form-loan').addEventListener('submit', async (e) => {
    e.preventDefault();
    const empId = document.getElementById('loan-emp-select').value;
    const principal = parseFloat(document.getElementById('loan-principal').value);
    const interest = parseFloat(document.getElementById('loan-interest').value) || 0;
    const emi = parseFloat(document.getElementById('loan-emi').value);
    const sDate = document.getElementById('loan-start-date').value;
    const reason = document.getElementById('loan-reason').value;

    try {
      await API.post('/loans', {
        employee_id: empId,
        principal_amount: principal,
        interest_rate_percent: interest,
        monthly_emi: emi,
        start_date: sDate,
        reason: reason
      });
      API.toast('Employee loan schedule established.', 'success');
      modalLoan.style.display = 'none';
      document.getElementById('form-loan').reset();
      await loadLoans();
    } catch (err) {
      API.toast(`Failed: ${err.message}`, 'error');
    }
  });

  // ==========================================
  // TAB 3: BONUSES
  // ==========================================
  async function loadBonuses() {
    const tbody = document.getElementById('bonuses-table-body');
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:30px;">Loading bonuses...</td></tr>`;
    try {
      const list = await API.get('/bonuses');
      if (!list || list.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:30px; color:#64748b;">No bonuses recorded.</td></tr>`;
        return;
      }
      tbody.innerHTML = list.map(b => `
        <tr>
          <td><code>${b.bonus_id}</code></td>
          <td><strong>${b.employee_name}</strong></td>
          <td><span class="badge badge-calculated">${b.type}</span></td>
          <td>${b.reason}</td>
          <td>${b.month} ${b.year}</td>
          <td style="text-align:right; font-family:monospace; font-weight:700; color:#047857;">${formatMoney(b.amount)}</td>
          <td style="text-align:center;"><span class="badge badge-approved">${b.status}</span></td>
        </tr>
      `).join('');
    } catch (e) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:30px; color:var(--danger);">${e.message}</td></tr>`;
    }
  }

  // Create Bonus Modal
  const modalBonus = document.getElementById('modal-bonus');
  document.getElementById('btn-create-bonus').addEventListener('click', () => modalBonus.style.display = 'flex');
  document.getElementById('btn-close-bonus-modal').addEventListener('click', () => modalBonus.style.display = 'none');
  document.getElementById('btn-cancel-bonus-modal').addEventListener('click', () => modalBonus.style.display = 'none');

  document.getElementById('form-bonus').addEventListener('submit', async (e) => {
    e.preventDefault();
    const empId = document.getElementById('bonus-emp-select').value;
    const type = document.getElementById('bonus-type').value;
    const amt = parseFloat(document.getElementById('bonus-amount').value);
    const m = document.getElementById('bonus-month').value;
    const y = parseInt(document.getElementById('bonus-year').value) || 2026;
    const reason = document.getElementById('bonus-reason').value;

    try {
      await API.post('/bonuses', {
        employee_id: empId,
        type: type,
        amount: amt,
        month: m,
        year: y,
        reason: reason
      });
      API.toast('Bonus awarded and scheduled.', 'success');
      modalBonus.style.display = 'none';
      document.getElementById('form-bonus').reset();
      await loadBonuses();
    } catch (err) {
      API.toast(`Failed: ${err.message}`, 'error');
    }
  });

  // ==========================================
  // TAB 4: OVERTIME
  // ==========================================
  async function loadOvertime() {
    const tbody = document.getElementById('overtime-table-body');
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:30px;">Loading overtime records...</td></tr>`;
    try {
      const list = await API.get('/overtime');
      if (!list || list.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:30px; color:#64748b;">No overtime records logged.</td></tr>`;
        return;
      }
      tbody.innerHTML = list.map(o => `
        <tr>
          <td><strong>${o.employee_name}</strong></td>
          <td>${o.date}</td>
          <td><strong>${o.hours} hrs</strong></td>
          <td style="text-align:right; font-family:monospace;">${formatMoney(o.rate_per_hour)}/hr</td>
          <td style="text-align:right; font-family:monospace; font-weight:700; color:#1e3a8a;">${formatMoney(o.amount)}</td>
          <td>${o.approved_by || 'HR Admin'}</td>
          <td style="text-align:center;"><span class="badge badge-approved">${o.status}</span></td>
        </tr>
      `).join('');
    } catch (e) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:30px; color:var(--danger);">${e.message}</td></tr>`;
    }
  }

  // Create Overtime Modal
  const modalOt = document.getElementById('modal-overtime');
  document.getElementById('btn-create-overtime').addEventListener('click', () => modalOt.style.display = 'flex');
  document.getElementById('btn-close-ot-modal').addEventListener('click', () => modalOt.style.display = 'none');
  document.getElementById('btn-cancel-ot-modal').addEventListener('click', () => modalOt.style.display = 'none');

  document.getElementById('form-overtime').addEventListener('submit', async (e) => {
    e.preventDefault();
    const empId = document.getElementById('ot-emp-select').value;
    const date = document.getElementById('ot-date').value;
    const hrs = parseFloat(document.getElementById('ot-hours').value);
    const rate = document.getElementById('ot-rate').value ? parseFloat(document.getElementById('ot-rate').value) : null;
    const reason = document.getElementById('ot-reason').value;

    try {
      await API.post('/overtime', {
        employee_id: empId,
        date: date,
        hours: hrs,
        rate_per_hour: rate,
        reason: reason
      });
      API.toast('Overtime logged and approved.', 'success');
      modalOt.style.display = 'none';
      document.getElementById('form-overtime').reset();
      await loadOvertime();
    } catch (err) {
      API.toast(`Failed: ${err.message}`, 'error');
    }
  });

  // Logout
  const btnLogout = document.getElementById('btn-logout');
  if (btnLogout) {
    btnLogout.addEventListener('click', () => {
      if (typeof Auth !== 'undefined') Auth.logout();
      else { localStorage.clear(); window.location.href = '/admin-login.html'; }
    });
  }

  // Initial Load
  await loadEmployeesDropdown();
  await loadAdvances();
  await loadLoans();
  await loadBonuses();
  await loadOvertime();
});
