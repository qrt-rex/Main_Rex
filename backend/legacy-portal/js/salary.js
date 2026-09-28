/**
 * Rexera HR Salary Slip Generator & Viewer Controller
 */

let activeEmployeesList = [];

document.addEventListener('DOMContentLoaded', async () => {
  const form = document.getElementById('salary-slip-form');
  if (!form) return;

  await loadActiveEmployeesDropdown();

  // Check URL params for preselected employee
  const urlParams = new URLSearchParams(window.location.search);
  const preselectedEmp = urlParams.get('emp');
  if (preselectedEmp) {
    const select = document.getElementById('slip-employee-select');
    if (select) {
      select.value = preselectedEmp;
      onEmployeeSelected(preselectedEmp);
    }
  }

  // Employee selection listener
  const empSelect = document.getElementById('slip-employee-select');
  if (empSelect) {
    empSelect.addEventListener('change', (e) => {
      onEmployeeSelected(e.target.value);
    });
  }

  // Input listeners for dynamic preview
  const inputs = ['slip-bonus', 'slip-other-deductions', 'slip-working-days', 'slip-lop-days'];
  inputs.forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('input', updateSalarySlipPreview);
    }
  });

  // Generate Slip form submission
  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const empId = document.getElementById('slip-employee-select').value;
    if (!empId) {
      Toast.warning('Please select an employee.');
      return;
    }

    const payload = {
      employee_id: empId,
      month: document.getElementById('slip-month').value,
      year: parseInt(document.getElementById('slip-year').value),
      working_days: parseInt(document.getElementById('slip-working-days').value) || 30,
      paid_days: parseInt(document.getElementById('slip-paid-days').value) || 30,
      lop_days: parseInt(document.getElementById('slip-lop-days').value) || 0,
      bonus: parseFloat(document.getElementById('slip-bonus').value) || 0,
      other_deductions: parseFloat(document.getElementById('slip-other-deductions').value) || 0,
      remarks: document.getElementById('slip-remarks')?.value || ''
    };

    const submitBtn = form.querySelector('button[type="submit"]');
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Generating Payslip...';
    }

    try {
      const res = await API.post('/payroll/generate-slip', payload);
      Toast.success(`Salary Slip ${res.slip_number} generated successfully!`);
      
      // Render printable preview container
      renderPrintableSlip(res);

      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Generate Official Payslip';
      }
    } catch (err) {
      Toast.error('Failed to generate salary slip: ' + err.message);
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Generate Official Payslip';
      }
    }
  });
});

async function loadActiveEmployeesDropdown() {
  try {
    const res = await API.get('/employees?limit=2000');
    activeEmployeesList = res.employees || [];
    
    const select = document.getElementById('slip-employee-select');
    if (!select) return;

    select.innerHTML = `<option value="">-- Choose Employee --</option>` + 
      activeEmployeesList.map(e => `
        <option value="${e.id}">${e.employee_code} - ${e.full_name} (${e.department})</option>
      `).join('');
  } catch (err) {
    Toast.error('Failed to load employees list: ' + err.message);
  }
}

function onEmployeeSelected(empId) {
  const emp = activeEmployeesList.find(e => e.id === empId);
  if (!emp) return;

  // Auto-fill values
  document.getElementById('preview-base-val').textContent = `₹${(emp.base_salary || 0).toLocaleString('en-IN')}`;
  document.getElementById('preview-hra-val').textContent = `₹${(emp.hra || 0).toLocaleString('en-IN')}`;
  document.getElementById('preview-conveyance-val').textContent = `₹${(emp.conveyance_allowance || 0).toLocaleString('en-IN')}`;
  document.getElementById('preview-special-val').textContent = `₹${(emp.special_allowance || 0).toLocaleString('en-IN')}`;
  
  updateSalarySlipPreview();
}

async function updateSalarySlipPreview() {
  const empId = document.getElementById('slip-employee-select')?.value;
  const emp = activeEmployeesList.find(e => e.id === empId);
  if (!emp) return;

  const bonus = parseFloat(document.getElementById('slip-bonus')?.value) || 0;
  const otherDed = parseFloat(document.getElementById('slip-other-deductions')?.value) || 0;
  const workingDays = parseInt(document.getElementById('slip-working-days')?.value) || 30;
  const lopDays = parseInt(document.getElementById('slip-lop-days')?.value) || 0;

  // Compute live calculation via API
  try {
    const calc = await API.post('/payroll/calculate-salary', {
      base_salary: emp.base_salary || 0,
      hra: emp.hra || 0,
      conveyance_allowance: emp.conveyance_allowance || 0,
      special_allowance: emp.special_allowance || 0,
      pf_opted: emp.pf_opted ?? true,
      professional_tax: emp.professional_tax || 200,
      bonus: bonus,
      other_deductions: otherDed,
      working_days: workingDays,
      lop_days: lopDays
    });

    document.getElementById('preview-gross-earnings').textContent = `₹${calc.gross_salary.toLocaleString('en-IN')}`;
    document.getElementById('preview-pf-val').textContent = `₹${calc.deductions.pf.toLocaleString('en-IN')}`;
    document.getElementById('preview-pt-val').textContent = `₹${calc.deductions.pt.toLocaleString('en-IN')}`;
    document.getElementById('preview-lop-val').textContent = `₹${calc.deductions.lop_deduction.toLocaleString('en-IN')}`;
    document.getElementById('preview-total-deductions').textContent = `₹${calc.deductions.gross_deductions.toLocaleString('en-IN')}`;
    document.getElementById('preview-net-payable').textContent = `₹${calc.net_salary.toLocaleString('en-IN')}`;
    document.getElementById('preview-net-words').textContent = calc.net_salary_words;

  } catch (e) {
    console.error('Calculation error:', e);
  }
}

function renderPrintableSlip(slip) {
  const container = document.getElementById('generated-slip-container');
  if (!container) return;

  container.style.display = 'block';
  const iframe = document.getElementById('slip-print-iframe');
  if (iframe) {
    iframe.src = `${API.baseURL}/payroll/slip/${slip.id}/printable`;
  }
  container.scrollIntoView({ behavior: 'smooth' });
}
