/**
 * Rexera HR Management System - Advanced Payroll Operations Command Center
 */

document.addEventListener('DOMContentLoaded', async () => {
  // Auth Check
  if (typeof Auth !== 'undefined' && !Auth.requireAuth()) return;

  // Salary Register Report page has a different DOM structure — handle it separately.
  if (document.getElementById('salary-report-tbody')) {
    await initSalaryReportPage();
    return;
  }

  // State
  let currentPayrolls = [];
  let selectedPayrollIds = new Set();
  let currentEditingPayroll = null;

  // DOM Elements
  const filterMonth = document.getElementById('filter-month');
  const filterYear = document.getElementById('filter-year');
  const filterDepartment = document.getElementById('filter-department');
  const filterStatus = document.getElementById('filter-status');
  const searchInput = document.getElementById('table-search-input');
  const tableBody = document.getElementById('payroll-table-body');
  const selectAllCheckbox = document.getElementById('select-all-checkbox');
  const bulkActionBar = document.getElementById('bulk-action-bar');
  const selectedCountBadge = document.getElementById('selected-count-badge');

  // KPI Elements
  const kpiTotal = document.getElementById('kpi-total-employees');
  const kpiProcessed = document.getElementById('kpi-processed');
  const kpiPending = document.getElementById('kpi-pending');
  const kpiGross = document.getElementById('kpi-gross');
  const kpiDeductions = document.getElementById('kpi-deductions');
  const kpiNet = document.getElementById('kpi-net');

  // Modals
  const modalSalaryEdit = document.getElementById('modal-salary-edit');
  const modalBatchPayroll = document.getElementById('modal-batch-payroll');
  const modalUnlockPayroll = document.getElementById('modal-unlock-payroll');

  // Format Currency
  function formatMoney(amount) {
    const num = parseFloat(amount) || 0;
    return '₹' + num.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  // Load KPI Metrics & Dashboard Summary
  async function loadDashboardMetrics() {
    const m = filterMonth.value;
    const y = parseInt(filterYear.value) || 2026;
    try {
      const res = await API.get(`/payroll/dashboard-metrics?month=${m}&year=${y}`);
      if (res) {
        kpiTotal.textContent = res.total_employees || 0;
        kpiProcessed.textContent = res.processed_count || 0;
        kpiPending.textContent = res.pending_count || 0;
        kpiGross.textContent = formatMoney(res.total_gross_payroll);
        kpiDeductions.textContent = formatMoney(res.total_deductions);
        kpiNet.textContent = formatMoney(res.total_net_payroll);
      }
    } catch (err) {
      console.error('Failed to load metrics:', err);
    }
  }


  // Fetch Payroll Records
  async function loadPayrollData() {
    tableBody.innerHTML = `<tr><td colspan="9" style="text-align: center; padding: 40px; color: var(--text-muted);">Loading payroll records...</td></tr>`;
    selectedPayrollIds.clear();
    updateBulkActionBar();
    if (selectAllCheckbox) selectAllCheckbox.checked = false;

    const m = filterMonth.value;
    const y = filterYear.value;
    const dept = filterDepartment.value;
    const st = filterStatus.value;
    const search = searchInput.value.trim();

    let query = `/payroll?month=${m}&year=${y}`;
    if (dept && dept !== 'All') query += `&department=${encodeURIComponent(dept)}`;
    if (st && st !== 'All') query += `&status=${encodeURIComponent(st)}`;
    if (search) query += `&search=${encodeURIComponent(search)}`;

    try {
      const data = await API.get(query);
      currentPayrolls = data || [];
      renderPayrollTable(currentPayrolls);
      await loadDashboardMetrics();
    } catch (err) {
      tableBody.innerHTML = `<tr><td colspan="9" style="text-align: center; padding: 40px; color: var(--danger);">Failed to load payroll records: ${err.message}</td></tr>`;
    }
  }

  // Render Table Rows
  function renderPayrollTable(payrolls) {
    if (!payrolls || payrolls.length === 0) {
      tableBody.innerHTML = `
        <tr>
          <td colspan="9">
            <div class="empty-state">
              <div class="empty-state-icon">📋</div>
              <div class="empty-state-title">No Payroll Records Found</div>
              <p style="font-size: 13px;">No payroll entries for ${filterMonth.value} ${filterYear.value}. Click <strong>Run Batch Payroll</strong> to generate salary calculations.</p>
            </div>
          </td>
        </tr>`;
      document.getElementById('table-count-info').textContent = 'Showing 0 of 0 records';
      return;
    }

    document.getElementById('table-count-info').textContent = `Showing ${payrolls.length} records`;

    tableBody.innerHTML = payrolls.map(p => {
      const isChecked = selectedPayrollIds.has(p.id || p._id);
      const advLoan = (p.deductions?.salary_advance_deduction || 0) + (p.deductions?.loan_deduction || 0);
      
      let badgeClass = 'badge-calculated';
      if (p.status === 'DRAFT') badgeClass = 'badge-draft';
      else if (p.status === 'UNDER_REVIEW') badgeClass = 'badge-review';
      else if (p.status === 'APPROVED') badgeClass = 'badge-approved';
      else if (p.status === 'FINALIZED') badgeClass = 'badge-finalized';
      else if (p.status === 'PAID') badgeClass = 'badge-paid';

      const isLocked = p.is_locked || p.status === 'FINALIZED' || p.status === 'PAID';

      return `
        <tr data-id="${p.id || p._id}">
          <td style="text-align: center;">
            <input type="checkbox" class="row-checkbox" value="${p.id || p._id}" ${isChecked ? 'checked' : ''} style="cursor: pointer;">
          </td>
          <td>
            <div style="font-weight: 700; color: #09234b;">${p.employee_name}</div>
            <div style="font-size: 11px; color: #64748b; font-family: monospace;">${p.employee_code}</div>
          </td>
          <td>
            <div>${p.department}</div>
            <div style="font-size: 11px; color: #64748b;">${p.designation}</div>
          </td>
          <td style="text-align: right; font-family: monospace; font-weight: 600; color: #1e3a8a;">
            ${formatMoney(p.gross_salary || p.earnings?.gross_salary)}
          </td>
          <td style="text-align: right; font-family: monospace; color: #991b1b;">
            ${formatMoney(p.total_deductions || p.deductions?.total_deductions)}
          </td>
          <td style="text-align: right; font-family: monospace; color: #b45309;">
            ${advLoan > 0 ? formatMoney(advLoan) : '<span style="color:#94a3b8;">—</span>'}
          </td>
          <td style="text-align: right; font-family: monospace; font-weight: 800; font-size: 14px; color: #065f46;">
            ${formatMoney(p.net_salary)}
          </td>
          <td style="text-align: center;">
            <span class="badge ${badgeClass}">${p.status}</span>
            ${isLocked ? '<span title="Locked" style="margin-left:4px; font-size:12px;">🔒</span>' : ''}
          </td>
          <td style="text-align: center;">
            <div style="display: flex; justify-content: center; gap: 6px;">
              <button class="btn-action btn-calc-row" data-id="${p.id || p._id}" title="Edit / Calculate Salary" style="background:#eff6ff; color:#1d4ed8;">
                ✏️
              </button>
              <button class="btn-action btn-preview-slip" data-id="${p.id || p._id}" title="Printable Payslip" style="background:#f1f5f9; color:#09234b;">
                📄
              </button>
              <button class="btn-action btn-send-email-row" data-id="${p.id || p._id}" title="Send Payslip Email" style="background:#ecfdf5; color:#047857;">
                ✉️
              </button>
              ${isLocked ? `
                <button class="btn-action btn-unlock-row" data-id="${p.id || p._id}" title="Unlock Finalized Payroll" style="background:#fef2f2; color:#b91c1c;">
                  🔓
                </button>
              ` : `
                <button class="btn-action btn-finalize-row" data-id="${p.id || p._id}" title="Finalize & Lock" style="background:#f5f3ff; color:#6d28d9;">
                  🔒
                </button>
              `}
            </div>
          </td>
        </tr>`;
    }).join('');

    attachRowEventListeners();
  }

  // Row Event Listeners
  function attachRowEventListeners() {
    // Checkboxes
    document.querySelectorAll('.row-checkbox').forEach(cb => {
      cb.addEventListener('change', (e) => {
        const id = e.target.value;
        if (e.target.checked) selectedPayrollIds.add(id);
        else selectedPayrollIds.delete(id);
        updateBulkActionBar();
      });
    });

    // Edit/Calculate Modal
    document.querySelectorAll('.btn-calc-row').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-id');
        openSalaryEditModal(id);
      });
    });

    // Preview Slip
    document.querySelectorAll('.btn-preview-slip').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-id');
        window.open(`/api/payroll/slip/${id}/printable`, '_blank');
      });
    });

    // Send Email
    document.querySelectorAll('.btn-send-email-row').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-id');
        btn.disabled = true;
        btn.textContent = '⏳';
        try {
          const res = await API.post(`/payroll/record/${id}/send-email`, {});
          if (res.success) {
            API.toast(`Payslip email sent to ${res.email}`, 'success');
          } else {
            API.toast(`Email delivery issue: ${res.message || res.error}`, 'warning');
          }
        } catch (err) {
          API.toast(`Failed sending email: ${err.message}`, 'error');
        } finally {
          btn.disabled = false;
          btn.textContent = '✉️';
        }
      });
    });

    // Finalize Row
    document.querySelectorAll('.btn-finalize-row').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-id');
        const ok = await Confirm.show('Finalize and lock this payroll record? Advances and loan balances will be committed.', { title: 'Finalize Payroll Record', confirmText: 'Finalize' });
        if (!ok) return;
        try {
          await API.post(`/payroll/record/${id}/finalize`, {});
          API.toast('Payroll finalized and locked.', 'success');
          await loadPayrollData();
        } catch (err) {
          API.toast(`Error: ${err.message}`, 'error');
        }
      });
    });

    // Unlock Row
    document.querySelectorAll('.btn-unlock-row').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-id');
        document.getElementById('unlock-payroll-id').value = id;
        document.getElementById('unlock-reason').value = '';
        modalUnlockPayroll.style.display = 'flex';
      });
    });
  }

  // Update Bulk Bar State
  function updateBulkActionBar() {
    const count = selectedPayrollIds.size;
    selectedCountBadge.textContent = count;
    if (count > 0) {
      bulkActionBar.style.display = 'flex';
    } else {
      bulkActionBar.style.display = 'none';
    }
  }

  // Select All Checkbox
  if (selectAllCheckbox) {
    selectAllCheckbox.addEventListener('change', (e) => {
      const isChecked = e.target.checked;
      document.querySelectorAll('.row-checkbox').forEach(cb => {
        cb.checked = isChecked;
        if (isChecked) selectedPayrollIds.add(cb.value);
        else selectedPayrollIds.delete(cb.value);
      });
      updateBulkActionBar();
    });
  }

  // ==========================================
  // SALARY EDIT & REAL-TIME CALCULATION MODAL
  // ==========================================
  function openSalaryEditModal(payrollId) {
    const p = currentPayrolls.find(item => (item.id || item._id) === payrollId);
    if (!p) return;

    currentEditingPayroll = p;
    document.getElementById('edit-payroll-id').value = p.id || p._id;
    document.getElementById('edit-employee-id').value = p.employee_id;

    // Set Header
    document.getElementById('calc-emp-name').textContent = p.employee_name;
    document.getElementById('calc-emp-subtitle').textContent = `${p.employee_code} • ${p.department} • ${p.designation}`;
    document.getElementById('calc-emp-status-badge').textContent = p.status;
    document.getElementById('calc-period-subtitle').textContent = `${p.month} ${p.year}`;

    // Attendance
    const att = p.attendance || {};
    document.getElementById('calc-working-days').value = att.working_days || 30;
    document.getElementById('calc-present-days').value = att.present_days !== undefined ? att.present_days : 30;
    document.getElementById('calc-paid-leave').value = att.paid_leave_days || 0;
    document.getElementById('calc-unpaid-leave').value = att.unpaid_leave_days || 0;
    document.getElementById('calc-half-days').value = att.half_days || 0;
    document.getElementById('calc-late-count').value = att.late_count || 0;
    document.getElementById('calc-ot-hours').value = att.overtime_hours || 0;

    // Earnings
    const earn = p.earnings || {};
    document.getElementById('calc-basic').value = earn.basic || 0;
    document.getElementById('calc-hra').value = earn.hra || 0;
    document.getElementById('calc-conveyance').value = earn.conveyance || 0;
    document.getElementById('calc-medical').value = earn.medical || 0;
    document.getElementById('calc-special').value = earn.special_allowance || 0;
    document.getElementById('calc-bonus').value = earn.bonus || 0;
    document.getElementById('calc-incentive').value = earn.incentive || 0;
    document.getElementById('calc-ot-pay').value = earn.overtime_pay || 0;
    document.getElementById('calc-other-earnings').value = (earn.other_earnings || 0) + (earn.manual_adjustments || 0);

    // Deductions
    const ded = p.deductions || {};
    document.getElementById('calc-pf').value = ded.pf || 0;
    document.getElementById('calc-esi').value = ded.esi || 0;
    document.getElementById('calc-pt').value = ded.professional_tax || ded.pt || 200;
    document.getElementById('calc-tds').value = ded.tds || 0;
    document.getElementById('calc-lop-deduction').value = ded.unpaid_leave_deduction || ded.lop_deduction || 0;
    document.getElementById('calc-late-deduction').value = ded.late_deduction || 0;
    document.getElementById('calc-advance-deduction').value = ded.salary_advance_deduction || 0;
    document.getElementById('calc-loan-deduction').value = ded.loan_deduction || 0;
    document.getElementById('calc-other-deductions').value = (ded.other_deductions || 0) + (ded.manual_adjustments || 0);

    document.getElementById('calc-remarks').value = p.remarks || '';

    // Trigger initial real-time re-sum
    recalcLiveModalNumbers();

    modalSalaryEdit.style.display = 'flex';
  }

  // Real-Time Math on Input Change
  function recalcLiveModalNumbers() {
    const basic = parseFloat(document.getElementById('calc-basic').value) || 0;
    const hra = parseFloat(document.getElementById('calc-hra').value) || 0;
    const conv = parseFloat(document.getElementById('calc-conveyance').value) || 0;
    const med = parseFloat(document.getElementById('calc-medical').value) || 0;
    const spec = parseFloat(document.getElementById('calc-special').value) || 0;
    const bonus = parseFloat(document.getElementById('calc-bonus').value) || 0;
    const inc = parseFloat(document.getElementById('calc-incentive').value) || 0;
    const ot = parseFloat(document.getElementById('calc-ot-pay').value) || 0;
    const otherEarn = parseFloat(document.getElementById('calc-other-earnings').value) || 0;

    const gross = Math.round((basic + hra + conv + med + spec + bonus + inc + ot + otherEarn) * 100) / 100;

    const pf = parseFloat(document.getElementById('calc-pf').value) || 0;
    const esi = parseFloat(document.getElementById('calc-esi').value) || 0;
    const pt = parseFloat(document.getElementById('calc-pt').value) || 0;
    const tds = parseFloat(document.getElementById('calc-tds').value) || 0;
    const lop = parseFloat(document.getElementById('calc-lop-deduction').value) || 0;
    const late = parseFloat(document.getElementById('calc-late-deduction').value) || 0;
    const adv = parseFloat(document.getElementById('calc-advance-deduction').value) || 0;
    const loan = parseFloat(document.getElementById('calc-loan-deduction').value) || 0;
    const otherDed = parseFloat(document.getElementById('calc-other-deductions').value) || 0;

    const totalDeductions = Math.round((pf + esi + pt + tds + lop + late + adv + loan + otherDed) * 100) / 100;
    const net = Math.max(0, Math.round((gross - totalDeductions) * 100) / 100);

    document.getElementById('live-gross-header').textContent = formatMoney(gross);
    document.getElementById('live-deductions-header').textContent = formatMoney(totalDeductions);
    document.getElementById('live-net-amount').textContent = formatMoney(net);
  }

  // Bind live inputs
  document.querySelectorAll('#calc-edit-form input').forEach(inp => {
    inp.addEventListener('input', recalcLiveModalNumbers);
  });

  // Save Calculated / Edited Salary
  document.getElementById('calc-edit-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const pid = document.getElementById('edit-payroll-id').value;
    const empId = document.getElementById('edit-employee-id').value;

    const payload = {
      basic: parseFloat(document.getElementById('calc-basic').value) || 0,
      hra: parseFloat(document.getElementById('calc-hra').value) || 0,
      conveyance: parseFloat(document.getElementById('calc-conveyance').value) || 0,
      medical: parseFloat(document.getElementById('calc-medical').value) || 0,
      special_allowance: parseFloat(document.getElementById('calc-special').value) || 0,
      bonus: parseFloat(document.getElementById('calc-bonus').value) || 0,
      incentive: parseFloat(document.getElementById('calc-incentive').value) || 0,
      overtime_pay: parseFloat(document.getElementById('calc-ot-pay').value) || 0,
      other_earnings: parseFloat(document.getElementById('calc-other-earnings').value) || 0,
      pf: parseFloat(document.getElementById('calc-pf').value) || 0,
      esi: parseFloat(document.getElementById('calc-esi').value) || 0,
      professional_tax: parseFloat(document.getElementById('calc-pt').value) || 0,
      tds: parseFloat(document.getElementById('calc-tds').value) || 0,
      unpaid_leave_deduction: parseFloat(document.getElementById('calc-lop-deduction').value) || 0,
      late_deduction: parseFloat(document.getElementById('calc-late-deduction').value) || 0,
      salary_advance_deduction: parseFloat(document.getElementById('calc-advance-deduction').value) || 0,
      loan_deduction: parseFloat(document.getElementById('calc-loan-deduction').value) || 0,
      other_deductions: parseFloat(document.getElementById('calc-other-deductions').value) || 0,
      remarks: document.getElementById('calc-remarks').value
    };

    try {
      await API.put(`/payroll/record/${pid}`, payload);
      API.toast('Salary updated and recalculations applied.', 'success');
      modalSalaryEdit.style.display = 'none';
      await loadPayrollData();
    } catch (err) {
      API.toast(`Save error: ${err.message}`, 'error');
    }
  });

  // Modal Action Buttons
  document.getElementById('btn-close-calc-modal').addEventListener('click', () => modalSalaryEdit.style.display = 'none');
  document.getElementById('btn-cancel-calc').addEventListener('click', () => modalSalaryEdit.style.display = 'none');

  document.getElementById('btn-view-payslip-from-modal').addEventListener('click', () => {
    if (currentEditingPayroll) {
      window.open(`/api/payroll/slip/${currentEditingPayroll.id || currentEditingPayroll._id}/printable`, '_blank');
    }
  });

  document.getElementById('btn-email-from-modal').addEventListener('click', async () => {
    if (!currentEditingPayroll) return;
    try {
      const res = await API.post(`/payroll/record/${currentEditingPayroll.id || currentEditingPayroll._id}/send-email`, {});
      API.toast(res.success ? `Email dispatched to ${res.email}` : `Failed: ${res.message}`, res.success ? 'success' : 'warning');
    } catch (err) {
      API.toast(`Email error: ${err.message}`, 'error');
    }
  });

  document.getElementById('btn-approve-from-modal').addEventListener('click', async () => {
    if (!currentEditingPayroll) return;
    try {
      await API.post(`/payroll/record/${currentEditingPayroll.id || currentEditingPayroll._id}/approve`, {});
      API.toast('Payroll approved.', 'success');
      modalSalaryEdit.style.display = 'none';
      await loadPayrollData();
    } catch (err) {
      API.toast(`Approval error: ${err.message}`, 'error');
    }
  });

  // ==========================================
  // BULK ACTIONS TOOLBAR
  // ==========================================
  document.getElementById('btn-bulk-calculate').addEventListener('click', async () => {
    const ids = Array.from(selectedPayrollIds);
    if (ids.length === 0) return;
    try {
      API.toast(`Recalculating ${ids.length} selected records...`, 'info');
      const res = await API.post('/payroll/calculate-bulk', {
        month: filterMonth.value,
        year: parseInt(filterYear.value) || 2026,
        employee_ids: ids,
        auto_approve: false
      });
      API.toast(`Calculation complete: ${res.successful_count} succeeded, ${res.failed_count} failed.`, 'success');
      await loadPayrollData();
    } catch (err) {
      API.toast(`Bulk calculation error: ${err.message}`, 'error');
    }
  });

  document.getElementById('btn-bulk-payslips').addEventListener('click', async () => {
    const ids = Array.from(selectedPayrollIds);
    if (ids.length === 0) return;
    const okBulkPayslips = await Confirm.show(`Finalize and generate official payslips for ${ids.length} selected employees?`, { title: 'Bulk Finalize Payslips', confirmText: 'Finalize All' });
    if (!okBulkPayslips) return;

    let finalized = 0;
    for (const id of ids) {
      try {
        await API.post(`/payroll/record/${id}/finalize`, {});
        finalized++;
      } catch (e) {
        console.error(`Finalize failed for ${id}:`, e);
      }
    }
    API.toast(`Successfully finalized and generated ${finalized} payslips.`, 'success');
    await loadPayrollData();
  });

  document.getElementById('btn-bulk-email').addEventListener('click', async () => {
    const ids = Array.from(selectedPayrollIds);
    if (ids.length === 0) return;
    const okBulkEmail = await Confirm.show(`Dispatch separate payslip emails to ${ids.length} selected employees? Each employee will receive only their own payslip PDF.`, { title: 'Send Bulk Payslip Emails', confirmText: 'Send Emails' });
    if (!okBulkEmail) return;

    API.toast('Initiating individual payslip email transmissions...', 'info');
    try {
      const res = await API.post('/payroll/send-bulk-email', ids);
      API.toast(`Bulk Email Results: ${res.sent_count} sent, ${res.failed_count} failed.`, res.sent_count > 0 ? 'success' : 'warning');
      await loadPayrollData();
    } catch (err) {
      API.toast(`Bulk email error: ${err.message}`, 'error');
    }
  });

  document.getElementById('btn-bulk-mark-paid').addEventListener('click', async () => {
    const ids = Array.from(selectedPayrollIds);
    if (ids.length === 0) return;
    const okBulkPaid = await Confirm.show(`Mark ${ids.length} selected payrolls as PAID?`, { title: 'Mark Payrolls Paid', confirmText: 'Mark Paid' });
    if (!okBulkPaid) return;

    for (const id of ids) {
      try {
        await API.post(`/payroll/record/${id}/mark-paid`, {});
      } catch (e) {}
    }
    API.toast(`Marked ${ids.length} records as paid.`, 'success');
    await loadPayrollData();
  });

  document.getElementById('btn-bulk-export').addEventListener('click', () => {
    const selected = currentPayrolls.filter(p => selectedPayrollIds.has(p.id || p._id));
    exportPayrollsToCSV(selected.length > 0 ? selected : currentPayrolls);
  });

  function exportPayrollsToCSV(list) {
    const headers = ["Employee Code", "Employee Name", "Department", "Designation", "Month", "Year", "Gross Earnings", "Deductions", "Advance Recovery", "Loan EMI", "Net Payable Salary", "Status"];
    const rows = list.map(p => [
      `"${p.employee_code}"`,
      `"${p.employee_name}"`,
      `"${p.department}"`,
      `"${p.designation}"`,
      `"${p.month}"`,
      p.year,
      p.gross_salary || 0,
      p.total_deductions || 0,
      p.deductions?.salary_advance_deduction || 0,
      p.deductions?.loan_deduction || 0,
      p.net_salary || 0,
      `"${p.status}"`
    ]);

    const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows.map(e => e.join(","))].join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `Rexera_Payroll_Register_${filterMonth.value}_${filterYear.value}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  // ==========================================
  // BATCH RUNNER MODAL
  // ==========================================
  document.getElementById('btn-open-batch-modal').addEventListener('click', () => {
    document.getElementById('batch-results-box').style.display = 'none';
    document.getElementById('batch-progress-container').style.display = 'none';
    modalBatchPayroll.style.display = 'flex';
  });

  document.getElementById('btn-close-batch-modal').addEventListener('click', () => modalBatchPayroll.style.display = 'none');
  document.getElementById('btn-cancel-batch').addEventListener('click', () => modalBatchPayroll.style.display = 'none');

  document.getElementById('batch-runner-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const m = document.getElementById('batch-run-month').value;
    const y = parseInt(document.getElementById('batch-run-year').value) || 2026;
    const dept = document.getElementById('batch-run-department').value;
    const autoApprove = document.getElementById('batch-auto-approve').checked;

    const progressBox = document.getElementById('batch-progress-container');
    const resultsBox = document.getElementById('batch-results-box');
    const startBtn = document.getElementById('btn-start-batch');

    progressBox.style.display = 'block';
    resultsBox.style.display = 'none';
    startBtn.disabled = true;

    try {
      const res = await API.post('/payroll/calculate-bulk', {
        month: m,
        year: y,
        department: dept,
        auto_approve: autoApprove
      });

      resultsBox.style.display = 'block';
      resultsBox.innerHTML = `
        <div style="font-weight: 700; color: #09234b; font-size: 14px; margin-bottom: 8px;">
          Batch Run Completed: ${res.total_processed} Employees
        </div>
        <div style="color: #047857; margin-bottom: 4px;">✅ <strong>${res.successful_count}</strong> Processed Successfully</div>
        ${res.failed_count > 0 ? `
          <div style="color: #991b1b; margin-top: 10px;">
            ⚠️ <strong>${res.failed_count} Failed</strong>:
            <ul style="margin: 6px 0 0 16px; padding: 0;">
              ${res.failed.map(f => `<li>${f.employee_code} (${f.employee_name}): ${f.reason}</li>`).join('')}
            </ul>
          </div>
        ` : ''}`;

      API.toast(`Batch payroll generated for ${res.successful_count} employees.`, 'success');
      await loadPayrollData();
    } catch (err) {
      API.toast(`Batch error: ${err.message}`, 'error');
    } finally {
      startBtn.disabled = false;
    }
  });

  // ==========================================
  // UNLOCK MODAL
  // ==========================================
  document.getElementById('btn-close-unlock-modal').addEventListener('click', () => modalUnlockPayroll.style.display = 'none');
  document.getElementById('btn-cancel-unlock').addEventListener('click', () => modalUnlockPayroll.style.display = 'none');

  document.getElementById('unlock-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const pid = document.getElementById('unlock-payroll-id').value;
    const reason = document.getElementById('unlock-reason').value;

    try {
      await API.post(`/payroll/record/${pid}/unlock`, { reason });
      API.toast('Payroll unlocked for revision.', 'success');
      modalUnlockPayroll.style.display = 'none';
      await loadPayrollData();
    } catch (err) {
      API.toast(`Unlock failed: ${err.message}`, 'error');
    }
  });

  // Bank Export Direct
  document.getElementById('btn-open-bank-export').addEventListener('click', async () => {
    const m = filterMonth.value;
    const y = filterYear.value;
    try {
      const data = await API.get(`/payroll/bank-export?month=${m}&year=${y}`);
      if (!data || !data.records || data.records.length === 0) {
        API.toast('No payroll data to export for bank transfers.', 'info');
        return;
      }
      const headers = ["Employee Code", "Employee Name", "Department", "Bank Name", "Account Number", "IFSC", "Net Salary", "Payment Reference"];
      const rows = data.records.map(r => [
        `"${r.employee_code}"`,
        `"${r.employee_name}"`,
        `"${r.department}"`,
        `"${r.bank_name}"`,
        `"${r.account_no}"`,
        `"${r.ifsc_code}"`,
        r.net_salary,
        `"${r.payment_reference}"`
      ]);
      const csv = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows.map(e => e.join(","))].join("\n");
      const encoded = encodeURI(csv);
      const link = document.createElement("a");
      link.setAttribute("href", encoded);
      link.setAttribute("download", `Rexera_Bank_Salary_Payout_${m}_${y}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      API.toast('Bank salary payout CSV downloaded.', 'success');
    } catch (err) {
      API.toast(`Export error: ${err.message}`, 'error');
    }
  });

  // Filters trigger reload
  filterMonth.addEventListener('change', loadPayrollData);
  filterYear.addEventListener('input', loadPayrollData);
  filterDepartment.addEventListener('change', loadPayrollData);
  filterStatus.addEventListener('change', loadPayrollData);
  searchInput.addEventListener('input', () => {
    const term = searchInput.value.toLowerCase().trim();
    if (!term) {
      renderPayrollTable(currentPayrolls);
      return;
    }
    const filtered = currentPayrolls.filter(p =>
      (p.employee_name && p.employee_name.toLowerCase().includes(term)) ||
      (p.employee_code && p.employee_code.toLowerCase().includes(term)) ||
      (p.department && p.department.toLowerCase().includes(term)) ||
      (p.designation && p.designation.toLowerCase().includes(term))
    );
    renderPayrollTable(filtered);
  });

  // Logout
  const btnLogout = document.getElementById('btn-logout');
  if (btnLogout) {
    btnLogout.addEventListener('click', () => {
      if (typeof Auth !== 'undefined') Auth.logout();
      else { localStorage.clear(); window.location.href = '/admin-login.html'; }
    });
  }

  // Initial Load for Payroll Operations
  if (tableBody) {
    await loadPayrollData();
  }
});

// ─── Salary Register Report Page ─────────────────────────────────────
let reportSlipsData = [];

async function initSalaryReportPage() {
  const monthFilter = document.getElementById('report-month-filter');
  const yearFilter = document.getElementById('report-year-filter');
  const searchInput = document.getElementById('report-search');
  const exportBtn = document.getElementById('btn-export-csv');

  if (monthFilter) monthFilter.addEventListener('change', loadSalaryReportData);
  if (yearFilter) yearFilter.addEventListener('change', loadSalaryReportData);
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      const term = searchInput.value.toLowerCase().trim();
      if (!term) {
        renderSalaryReportTable(reportSlipsData);
        return;
      }
      const filtered = reportSlipsData.filter(s =>
        (s.employee_name && s.employee_name.toLowerCase().includes(term)) ||
        (s.employee_code && s.employee_code.toLowerCase().includes(term)) ||
        (s.slip_number && s.slip_number.toLowerCase().includes(term))
      );
      renderSalaryReportTable(filtered);
    });
  }
  if (exportBtn) exportBtn.addEventListener('click', exportSalaryReportToCSV);

  const btnLogout = document.getElementById('btn-logout');
  if (btnLogout) {
    btnLogout.addEventListener('click', () => {
      if (typeof Auth !== 'undefined') Auth.logout();
      else { localStorage.clear(); window.location.href = '/admin-login.html'; }
    });
  }

  await loadSalaryReportData();
}

async function loadSalaryReportData() {
  const monthFilter = document.getElementById('report-month-filter');
  const yearFilter = document.getElementById('report-year-filter');
  const m = monthFilter ? monthFilter.value : 'September';
  const y = yearFilter ? yearFilter.value : 2026;

  const tbody = document.getElementById('salary-report-tbody');
  if (tbody) {
    tbody.innerHTML = `<tr><td colspan="9" style="text-align: center; padding: 30px;">Loading salary register...</td></tr>`;
  }

  try {
    const [summary, slipsRes] = await Promise.all([
      API.get(`/payroll/summary?month=${m}&year=${y}`),
      API.get(`/payroll/slips?month=${m}&year=${y}`)
    ]);

    const setText = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    setText('sum-total-slips', summary.total_slips || 0);
    setText('sum-gross-payout', '₹' + (summary.total_gross_disbursed || 0).toLocaleString('en-IN'));
    setText('sum-pf-deducted', '₹' + (summary.total_pf_deducted || 0).toLocaleString('en-IN'));
    setText('sum-pt-deducted', '₹' + (summary.total_pt_deducted || 0).toLocaleString('en-IN'));
    setText('sum-net-disbursed', '₹' + (summary.total_net_disbursed || 0).toLocaleString('en-IN'));

    reportSlipsData = slipsRes.slips || [];
    renderSalaryReportTable(reportSlipsData);
  } catch (err) {
    if (tbody) {
      tbody.innerHTML = `<tr><td colspan="9" style="text-align: center; padding: 30px; color: var(--danger);">Failed to load salary register: ${err.message}</td></tr>`;
    }
  }
}

function renderSalaryReportTable(slips) {
  const tbody = document.getElementById('salary-report-tbody');
  if (!tbody) return;

  if (!slips || slips.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9" style="text-align: center; padding: 30px; color: var(--text-muted);">No salary slips found for this period.</td></tr>`;
    return;
  }

  tbody.innerHTML = slips.map(s => {
    const earnings = s.earnings || {};
    const deductions = s.deductions || {};

    return `
      <tr>
        <td><code>${s.slip_number}</code></td>
        <td>
          <div class="user-cell">
            <div class="user-cell-avatar">${(s.employee_name || '?').charAt(0)}</div>
            <div class="user-cell-info">
              <span class="user-cell-name">${s.employee_name}</span>
              <span class="user-cell-sub">${s.employee_code}</span>
            </div>
          </div>
        </td>
        <td>${s.department}</td>
        <td>₹${(earnings.basic || 0).toLocaleString('en-IN')}</td>
        <td><strong>₹${(earnings.gross_earnings || 0).toLocaleString('en-IN')}</strong></td>
        <td>₹${(deductions.pf || 0).toLocaleString('en-IN')}</td>
        <td>₹${(deductions.pt || 0).toLocaleString('en-IN')}</td>
        <td><strong style="color: var(--success);">₹${(s.net_salary || 0).toLocaleString('en-IN')}</strong></td>
        <td>
          <div class="action-group">
            <a href="${API.baseURL}/payroll/slip/${s.id}/printable" target="_blank" class="btn-action" title="View / Print Payslip">
              🖨️
            </a>
            <button class="btn-action btn-delete" title="Delete Slip" onclick="deleteSalarySlip('${s.id}')">
              🗑️
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

async function deleteSalarySlip(slipId) {
  const ok = await Confirm.show('Are you sure you want to delete this payslip record?', { title: 'Delete Payslip', confirmText: 'Delete', danger: true });
  if (!ok) return;

  try {
    await API.delete(`/payroll/slip/${slipId}`);
    Toast.success('Payslip record deleted.');
    loadSalaryReportData();
  } catch (err) {
    Toast.error('Failed to delete payslip: ' + err.message);
  }
}

function exportSalaryReportToCSV() {
  if (reportSlipsData.length === 0) {
    Toast.warning('No salary records available to export.');
    return;
  }

  const headers = ['Slip Number', 'Employee Code', 'Employee Name', 'Department', 'Designation', 'Month', 'Year', 'Basic Salary', 'Gross Earnings', 'PF Deducted', 'PT Deducted', 'Net Salary'];
  const rows = reportSlipsData.map(s => [
    s.slip_number,
    s.employee_code,
    `"${s.employee_name}"`,
    `"${s.department}"`,
    `"${s.designation}"`,
    s.month,
    s.year,
    s.earnings.basic,
    s.earnings.gross_earnings,
    s.deductions.pf,
    s.deductions.pt,
    s.net_salary
  ]);

  const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
  const encodedUri = encodeURI(csvContent);
  const link = document.createElement('a');
  link.setAttribute('href', encodedUri);
  link.setAttribute('download', `Rexera_Salary_Register_${reportSlipsData[0]?.month}_${reportSlipsData[0]?.year}.csv`);
  document.body.appendChild(link);
  link.click();
  link.remove();
  Toast.success('Salary register exported to CSV successfully.');
}
