/**
 * Rexera HR Unified Add Employee / Intern Controller
 */

let currentPersonType = 'employee'; // 'employee' or 'intern'

document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('add-employee-form');
  if (!form) return;

  // Check URL query parameters (e.g. ?type=intern)
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('type') === 'intern') {
    setPersonType('intern');
  } else {
    setPersonType('employee');
  }

  // Set default dates
  const today = new Date().toISOString().substring(0, 10);
  const dojInput = document.getElementById('date_of_joining');
  const startDateInput = document.getElementById('start_date');
  const endDateInput = document.getElementById('end_date');
  const durationInput = document.getElementById('duration_months');

  if (dojInput && !dojInput.value) dojInput.value = today;
  if (startDateInput && !startDateInput.value) startDateInput.value = today;

  if (startDateInput && !endDateInput.value) {
    const end = new Date();
    end.setMonth(end.getMonth() + 3);
    endDateInput.value = end.toISOString().substring(0, 10);
  }

  // Auto-calculate intern duration in months
  const calcDuration = () => {
    if (startDateInput.value && endDateInput.value) {
      const d1 = new Date(startDateInput.value);
      const d2 = new Date(endDateInput.value);
      const months = (d2.getFullYear() - d1.getFullYear()) * 12 + (d2.getMonth() - d1.getMonth());
      if (months > 0 && durationInput) {
        durationInput.value = months;
      }
    }
  };

  if (startDateInput && endDateInput) {
    startDateInput.addEventListener('change', calcDuration);
    endDateInput.addEventListener('change', calcDuration);
  }

  // Employee Salary calculation triggers
  const baseSalaryInput = document.getElementById('base_salary');
  const hraInput = document.getElementById('hra');
  const conveyanceInput = document.getElementById('conveyance_allowance');
  const specialInput = document.getElementById('special_allowance');
  const pfOptedInput = document.getElementById('pf_opted');
  const ptInput = document.getElementById('professional_tax');

  const salaryInputs = [baseSalaryInput, hraInput, conveyanceInput, specialInput, pfOptedInput, ptInput];
  salaryInputs.forEach(input => {
    if (input) {
      input.addEventListener('input', calculateSalaryPreview);
      input.addEventListener('change', calculateSalaryPreview);
    }
  });

  // Auto 40% HRA button
  const btnAutoHra = document.getElementById('btn-auto-hra');
  if (btnAutoHra) {
    btnAutoHra.addEventListener('click', (e) => {
      e.preventDefault();
      const base = parseFloat(baseSalaryInput.value) || 0;
      hraInput.value = Math.round(base * 0.4);
      calculateSalaryPreview();
    });
  }

  calculateSalaryPreview();

  // Other department toggle
  const deptSelect = document.getElementById('department');
  const otherDeptContainer = document.getElementById('department-other-container');
  const otherDeptInput = document.getElementById('department-other');
  if (deptSelect && otherDeptContainer) {
    deptSelect.addEventListener('change', () => {
      if (deptSelect.value === 'other') {
        otherDeptContainer.style.display = 'block';
        if (otherDeptInput) otherDeptInput.focus();
      } else {
        otherDeptContainer.style.display = 'none';
        if (otherDeptInput) otherDeptInput.value = '';
      }
    });
  }

  // Auto-Fill File Upload & Drag-and-Drop Handling
  initAutoFillDropzone();

  // Unified Form Submission
  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    let deptVal = document.getElementById('department').value;
    if (deptVal === 'other') {
      const customVal = document.getElementById('department-other')?.value.trim();
      if (!customVal) {
        Toast.error('Please specify the custom department name.');
        document.getElementById('department-other')?.focus();
        return;
      }
      deptVal = customVal;
    }

    const submitBtn = document.getElementById('btn-submit');

    if (currentPersonType === 'employee') {
      // FULL-TIME EMPLOYEE SUBMISSION
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Creating Full-Time Employee...';
      }

      const payload = {
        employee_code: document.getElementById('code_input')?.value || '',
        full_name: document.getElementById('full_name').value,
        email: document.getElementById('email').value,
        mobile_number: document.getElementById('mobile_number').value,
        department: deptVal,
        designation: document.getElementById('role_input').value,
        gender: document.getElementById('gender').value,
        branch: document.getElementById('branch').value,
        reporting_manager: document.getElementById('manager_input')?.value || '',
        date_of_joining: document.getElementById('date_of_joining')?.value || new Date().toISOString().substring(0, 10),
        base_salary: parseFloat(document.getElementById('base_salary').value) || 0,
        hra: parseFloat(document.getElementById('hra').value) || 0,
        conveyance_allowance: parseFloat(document.getElementById('conveyance_allowance').value) || 0,
        special_allowance: parseFloat(document.getElementById('special_allowance').value) || 0,
        professional_tax: parseFloat(document.getElementById('professional_tax').value) || 200.0,
        pf_opted: document.getElementById('pf_opted').checked,
        bank_name: document.getElementById('bank_name')?.value || 'Not Provided',
        account_no: document.getElementById('account_no')?.value || '0000000000',
        ifsc_code: document.getElementById('ifsc_code')?.value || 'REX0001',
        employee_status: document.getElementById('status_select')?.value || 'Active'
      };

      try {
        const res = await API.post('/employees/', payload);
        Toast.success(`Full-Time Employee ${res.full_name} (${res.employee_code}) added successfully!`);
        setTimeout(() => {
          window.location.href = '/employees.html';
        }, 1200);
      } catch (err) {
        Toast.error('Failed to create employee: ' + err.message);
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = '💼 Save Full-Time Employee';
        }
      }

    } else {
      // INTERN / TRAINEE SUBMISSION
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Enrolling Intern...';
      }

      const college = document.getElementById('college_university')?.value.trim();
      const degree = document.getElementById('degree')?.value.trim();
      const branch = document.getElementById('branch_specialization')?.value.trim();

      if (!college || !degree || !branch) {
        Toast.error('Please enter College, Degree, and Branch for the intern.');
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = '🎓 Save & Onboard Intern';
        }
        return;
      }

      const payload = {
        intern_code: document.getElementById('code_input')?.value || '',
        full_name: document.getElementById('full_name').value,
        email: document.getElementById('email').value,
        mobile_number: document.getElementById('mobile_number').value,
        department: deptVal,
        domain_role: document.getElementById('role_input').value,
        assigned_mentor: document.getElementById('manager_input')?.value || 'HR Lead',
        start_date: document.getElementById('start_date')?.value || new Date().toISOString().substring(0, 10),
        end_date: document.getElementById('end_date')?.value || new Date().toISOString().substring(0, 10),
        duration_months: parseInt(document.getElementById('duration_months')?.value) || 3,
        college_university: college,
        degree: degree,
        branch_specialization: branch,
        current_semester: document.getElementById('current_semester')?.value || '',
        roll_number: document.getElementById('roll_number')?.value || '',
        internship_type: document.getElementById('internship_type')?.value || 'Full-time',
        monthly_stipend: parseFloat(document.getElementById('monthly_stipend')?.value) || 0,
        bank_name: document.getElementById('bank_name')?.value || '',
        account_no: document.getElementById('account_no')?.value || '',
        ifsc_code: document.getElementById('ifsc_code')?.value || '',
        status: 'Active'
      };

      try {
        const res = await API.post('/interns/', payload);
        Toast.success(`Intern ${res.full_name} (${res.intern_code}) enrolled successfully!`);
        setTimeout(() => {
          window.location.href = '/interns.html';
        }, 1200);
      } catch (err) {
        Toast.error('Failed to enroll intern: ' + err.message);
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = '🎓 Save & Onboard Intern';
        }
      }
    }
  });
});

/**
 * Switch between Employee and Intern Form Modes
 */
function setPersonType(type) {
  currentPersonType = type;

  const btnEmp = document.getElementById('btn-type-employee');
  const btnIntern = document.getElementById('btn-type-intern');
  const pageHeading = document.getElementById('page-heading');
  const topbarBackLink = document.getElementById('topbar-back-link');
  const btnCancel = document.getElementById('btn-cancel');
  const btnSubmit = document.getElementById('btn-submit');

  const lblCode = document.getElementById('lbl-code');
  const codeInput = document.getElementById('code_input');
  const lblRole = document.getElementById('lbl-role');
  const roleInput = document.getElementById('role_input');
  const lblManager = document.getElementById('lbl-manager');
  const managerInput = document.getElementById('manager_input');

  const groupDoj = document.getElementById('group-doj');
  const groupStatus = document.getElementById('group-status');

  const sectionEmp = document.getElementById('section-employee-fields');
  const sectionIntern = document.getElementById('section-intern-fields');

  if (type === 'intern') {
    if (btnEmp) btnEmp.classList.remove('active');
    if (btnIntern) btnIntern.classList.add('active');

    if (pageHeading) pageHeading.textContent = 'Onboard Intern / Trainee';
    if (topbarBackLink) {
      topbarBackLink.textContent = '← Back to Interns Directory';
      topbarBackLink.href = '/interns.html';
    }
    if (btnCancel) btnCancel.onclick = () => window.location.href = '/interns.html';

    if (lblCode) lblCode.textContent = 'Intern Code';
    if (codeInput) codeInput.placeholder = 'Auto-generated (e.g. INT-2026-001)';
    if (lblRole) lblRole.innerHTML = 'Internship Role / Domain <span class="required">*</span>';
    if (roleInput) roleInput.placeholder = 'e.g. Full-Stack Engineer Intern';
    if (lblManager) lblManager.innerHTML = 'Assigned Mentor / Lead <span class="required">*</span>';
    if (managerInput) managerInput.placeholder = 'e.g. Aarav Sharma';

    if (groupDoj) groupDoj.style.display = 'none';
    if (groupStatus) groupStatus.style.display = 'none';

    if (sectionEmp) sectionEmp.style.display = 'none';
    if (sectionIntern) sectionIntern.style.display = 'block';

    if (btnSubmit) {
      btnSubmit.innerHTML = '🎓 Save & Onboard Intern';
      btnSubmit.className = 'btn btn-gold';
    }
  } else {
    if (btnEmp) btnEmp.classList.add('active');
    if (btnIntern) btnIntern.classList.remove('active');

    if (pageHeading) pageHeading.textContent = 'Add Full-Time Employee';
    if (topbarBackLink) {
      topbarBackLink.textContent = '← Back to Employee Directory';
      topbarBackLink.href = '/employees.html';
    }
    if (btnCancel) btnCancel.onclick = () => window.location.href = '/employees.html';

    if (lblCode) lblCode.textContent = 'Employee Code';
    if (codeInput) codeInput.placeholder = 'Auto-generated (e.g. EMP-001)';
    if (lblRole) lblRole.innerHTML = 'Designation <span class="required">*</span>';
    if (roleInput) roleInput.placeholder = 'e.g. Lead Backend Engineer';
    if (lblManager) lblManager.innerHTML = 'Reporting Manager';
    if (managerInput) managerInput.placeholder = 'e.g. Vikram Malhotra';

    if (groupDoj) groupDoj.style.display = 'block';
    if (groupStatus) groupStatus.style.display = 'block';

    if (sectionEmp) sectionEmp.style.display = 'block';
    if (sectionIntern) sectionIntern.style.display = 'none';

    if (btnSubmit) {
      btnSubmit.innerHTML = '💼 Save Full-Time Employee';
      btnSubmit.className = 'btn btn-primary';
    }
  }
}

/**
 * Real-time Employee Salary Preview Calculations
 */
function calculateSalaryPreview() {
  const base = parseFloat(document.getElementById('base_salary')?.value) || 0;
  const hra = parseFloat(document.getElementById('hra')?.value) || 0;
  const conveyance = parseFloat(document.getElementById('conveyance_allowance')?.value) || 0;
  const special = parseFloat(document.getElementById('special_allowance')?.value) || 0;
  const pt = parseFloat(document.getElementById('professional_tax')?.value) || 0;
  const pfOpted = document.getElementById('pf_opted')?.checked ?? true;

  const gross = base + hra + conveyance + special;
  const pf = pfOpted ? Math.round(base * 0.12) : 0;
  const net = Math.max(0, gross - (pf + pt));

  const grossEl = document.getElementById('preview-gross-salary');
  const pfEl = document.getElementById('preview-pf-deduction');
  const netEl = document.getElementById('preview-net-salary');

  if (grossEl) grossEl.textContent = `₹${gross.toLocaleString('en-IN')}`;
  if (pfEl) pfEl.textContent = `₹${pf.toLocaleString('en-IN')}`;
  if (netEl) netEl.textContent = `₹${net.toLocaleString('en-IN')}`;
}

/**
 * Auto-Fill Dropzone & File Parser Engine
 */
let parsedRecordsList = [];
let currentRecordIndex = 0;

function initAutoFillDropzone() {
  const dropzone = document.getElementById('autofill-dropzone');
  const fileInput = document.getElementById('autofill-file-input');
  const btnBrowse = document.getElementById('btn-browse-file');
  const btnTemplate = document.getElementById('btn-download-template');

  if (!dropzone || !fileInput) return;

  // Browse button click
  if (btnBrowse) {
    btnBrowse.addEventListener('click', (e) => {
      e.stopPropagation();
      fileInput.click();
    });
  }

  // Template download button
  if (btnTemplate) {
    btnTemplate.addEventListener('click', (e) => {
      e.stopPropagation();
      Importer.downloadTemplate(currentPersonType, 'xlsx');
    });
  }

  // Dropzone click triggers file input
  dropzone.addEventListener('click', () => {
    fileInput.click();
  });

  // Drag and drop event listeners
  ['dragenter', 'dragover'].forEach(eventName => {
    dropzone.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.add('dragover');
    });
  });

  ['dragleave', 'drop'].forEach(eventName => {
    dropzone.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.remove('dragover');
    });
  });

  dropzone.addEventListener('drop', async (e) => {
    const files = e.dataTransfer?.files;
    if (files && files.length > 0) {
      await processUploadedFile(files[0]);
    }
  });

  fileInput.addEventListener('change', async () => {
    if (fileInput.files && fileInput.files.length > 0) {
      await processUploadedFile(fileInput.files[0]);
      fileInput.value = ''; // Reset for re-selection
    }
  });

  // Multi-Record Navigation button listeners
  const btnPrev = document.getElementById('btn-prev-record');
  const btnNext = document.getElementById('btn-next-record');
  const btnBulk = document.getElementById('btn-bulk-save-records');
  const btnClear = document.getElementById('btn-clear-parsed-data');

  if (btnPrev) btnPrev.addEventListener('click', prevParsedRecord);
  if (btnNext) btnNext.addEventListener('click', nextParsedRecord);
  if (btnBulk) btnBulk.addEventListener('click', bulkImportParsedRecords);
  if (btnClear) btnClear.addEventListener('click', clearParsedRecords);
}

/**
 * Process and auto-fill form from an uploaded spreadsheet
 */
async function processUploadedFile(file) {
  try {
    Toast.info(`Reading ${file.name}...`);
    const records = await Importer.parseFile(file);

    if (!records || records.length === 0) {
      Toast.warning('No valid data records found in file.');
      return;
    }

    parsedRecordsList = records;
    currentRecordIndex = 0;

    // Auto-fill the first record into the form
    loadParsedRecord(0);

    const multiBar = document.getElementById('multi-record-bar');
    if (records.length > 1) {
      if (multiBar) multiBar.style.display = 'flex';
      updateMultiRecordBar();
      Toast.success(`Successfully loaded ${records.length} records from ${file.name}! Use Next/Prev or Bulk Save.`);
    } else {
      if (multiBar) multiBar.style.display = 'none';
      Toast.success(`Form auto-filled with details for ${records[0].full_name || 'candidate'}!`);
    }
  } catch (err) {
    console.error('File parsing error:', err);
    Toast.error('Failed to parse file: ' + err.message);
  }
}

function loadParsedRecord(index) {
  if (!parsedRecordsList || index < 0 || index >= parsedRecordsList.length) return;
  currentRecordIndex = index;
  const record = parsedRecordsList[index];
  Importer.autofillEmployeeForm(record);
  updateMultiRecordBar();
}

function updateMultiRecordBar() {
  const counter = document.getElementById('record-badge-counter');
  const preview = document.getElementById('record-preview-label');
  const btnPrev = document.getElementById('btn-prev-record');
  const btnNext = document.getElementById('btn-next-record');
  const btnBulk = document.getElementById('btn-bulk-save-records');

  const current = parsedRecordsList[currentRecordIndex];
  if (counter) counter.textContent = `Record ${currentRecordIndex + 1} of ${parsedRecordsList.length}`;
  if (preview && current) {
    preview.textContent = `${current.full_name || 'Unnamed'} • ${current.designation || current.domain_role || 'No Role'}`;
  }

  if (btnPrev) btnPrev.disabled = currentRecordIndex <= 0;
  if (btnNext) btnNext.disabled = currentRecordIndex >= parsedRecordsList.length - 1;
  if (btnBulk) btnBulk.textContent = `⚡ Bulk Save All (${parsedRecordsList.length} ${currentPersonType === 'intern' ? 'Interns' : 'Employees'})`;
}

function prevParsedRecord() {
  if (currentRecordIndex > 0) {
    loadParsedRecord(currentRecordIndex - 1);
  }
}

function nextParsedRecord() {
  if (currentRecordIndex < parsedRecordsList.length - 1) {
    loadParsedRecord(currentRecordIndex + 1);
  }
}

function clearParsedRecords() {
  parsedRecordsList = [];
  currentRecordIndex = 0;
  const multiBar = document.getElementById('multi-record-bar');
  if (multiBar) multiBar.style.display = 'none';
  Toast.info('Cleared uploaded spreadsheet records.');
}

async function bulkImportParsedRecords() {
  if (!parsedRecordsList || parsedRecordsList.length === 0) {
    Toast.warning('No records loaded to save.');
    return;
  }

  const endpoint = currentPersonType === 'intern' ? '/interns/bulk' : '/employees/bulk';
  const label = currentPersonType === 'intern' ? 'Interns' : 'Employees';

  const confirmSave = await Confirm.show(`Are you sure you want to bulk save all ${parsedRecordsList.length} ${label}?`, { title: 'Bulk Save Records', confirmText: 'Save All' });
  if (!confirmSave) return;

  const btnBulk = document.getElementById('btn-bulk-save-records');
  if (btnBulk) {
    btnBulk.disabled = true;
    btnBulk.textContent = 'Saving records...';
  }

  try {
    const res = await API.post(endpoint, parsedRecordsList);
    Toast.success(res.message || `Successfully imported ${res.inserted_count || parsedRecordsList.length} ${label}!`);
    setTimeout(() => {
      window.location.href = currentPersonType === 'intern' ? '/interns.html' : '/employees.html';
    }, 1500);
  } catch (err) {
    Toast.error('Bulk save failed: ' + err.message);
    if (btnBulk) {
      btnBulk.disabled = false;
      btnBulk.textContent = `⚡ Bulk Save All (${parsedRecordsList.length})`;
    }
  }
}

window.setPersonType = setPersonType;
window.prevParsedRecord = prevParsedRecord;
window.nextParsedRecord = nextParsedRecord;
window.clearParsedRecords = clearParsedRecords;
window.bulkImportParsedRecords = bulkImportParsedRecords;

