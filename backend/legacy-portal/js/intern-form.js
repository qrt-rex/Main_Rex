/**
 * Rexera HR Add Intern Controller
 */

document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('add-intern-form');
  if (!form) return;

  const startDateInput = document.getElementById('start_date');
  const endDateInput = document.getElementById('end_date');
  const durationInput = document.getElementById('duration_months');

  // Auto calculate duration in months
  const calcDuration = () => {
    if (startDateInput.value && endDateInput.value) {
      const d1 = new Date(startDateInput.value);
      const d2 = new Date(endDateInput.value);
      const months = (d2.getFullYear() - d1.getFullYear()) * 12 + (d2.getMonth() - d1.getMonth());
      if (months > 0) {
        durationInput.value = months;
      }
    }
  };

  if (startDateInput && endDateInput) {
    startDateInput.addEventListener('change', calcDuration);
    endDateInput.addEventListener('change', calcDuration);
  }

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

    const submitBtn = form.querySelector('button[type="submit"]');
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Enrolling Intern...';
    }

    const payload = {
      intern_code: document.getElementById('intern_code')?.value || '',
      full_name: document.getElementById('full_name').value,
      email: document.getElementById('email').value,
      mobile_number: document.getElementById('mobile_number').value,
      gender: document.getElementById('gender').value,
      date_of_birth: document.getElementById('date_of_birth')?.value || '',
      college_university: document.getElementById('college_university').value,
      degree: document.getElementById('degree').value,
      branch_specialization: document.getElementById('branch_specialization').value,
      current_semester: document.getElementById('current_semester')?.value || '',
      roll_number: document.getElementById('roll_number')?.value || '',
      department: deptVal,
      domain_role: document.getElementById('domain_role').value,
      assigned_mentor: document.getElementById('assigned_mentor').value,
      start_date: document.getElementById('start_date').value,
      end_date: document.getElementById('end_date').value,
      duration_months: parseInt(document.getElementById('duration_months').value) || 3,
      internship_type: document.getElementById('internship_type').value,
      monthly_stipend: parseFloat(document.getElementById('monthly_stipend').value) || 0,
      bank_name: document.getElementById('bank_name')?.value || '',
      account_no: document.getElementById('account_no')?.value || '',
      ifsc_code: (document.getElementById('ifsc_code')?.value || '').toUpperCase(),
      status: 'Ongoing'
    };

    try {
      const res = await API.post('/interns', payload);
      Toast.success(`Intern ${res.full_name} (${res.intern_code}) enrolled successfully!`);
      setTimeout(() => {
        window.location.href = '/interns.html';
      }, 1000);
    } catch (err) {
      Toast.error('Failed to enroll intern: ' + err.message);
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Save & Enroll Intern';
      }
    }
  });

  // Initialize Intern Auto-Fill Dropzone
  initInternDropzone();
});

/**
 * Intern Form Auto-Fill Dropzone Engine
 */
let parsedInternsList = [];
let currentInternIndex = 0;

function initInternDropzone() {
  const dropzone = document.getElementById('autofill-dropzone');
  const fileInput = document.getElementById('autofill-file-input');
  const btnBrowse = document.getElementById('btn-browse-file');
  const btnTemplate = document.getElementById('btn-download-template');

  if (!dropzone || !fileInput) return;

  if (btnBrowse) {
    btnBrowse.addEventListener('click', (e) => {
      e.stopPropagation();
      fileInput.click();
    });
  }

  if (btnTemplate) {
    btnTemplate.addEventListener('click', (e) => {
      e.stopPropagation();
      Importer.downloadTemplate('intern', 'xlsx');
    });
  }

  dropzone.addEventListener('click', () => {
    fileInput.click();
  });

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
      await processUploadedInternFile(files[0]);
    }
  });

  fileInput.addEventListener('change', async () => {
    if (fileInput.files && fileInput.files.length > 0) {
      await processUploadedInternFile(fileInput.files[0]);
      fileInput.value = '';
    }
  });

  const btnPrev = document.getElementById('btn-prev-record');
  const btnNext = document.getElementById('btn-next-record');
  const btnBulk = document.getElementById('btn-bulk-save-records');
  const btnClear = document.getElementById('btn-clear-parsed-data');

  if (btnPrev) btnPrev.addEventListener('click', prevParsedIntern);
  if (btnNext) btnNext.addEventListener('click', nextParsedIntern);
  if (btnBulk) btnBulk.addEventListener('click', bulkImportParsedInterns);
  if (btnClear) btnClear.addEventListener('click', clearParsedInterns);
}

async function processUploadedInternFile(file) {
  try {
    Toast.info(`Reading ${file.name}...`);
    const records = await Importer.parseFile(file);

    if (!records || records.length === 0) {
      Toast.warning('No valid intern records found in file.');
      return;
    }

    parsedInternsList = records;
    currentInternIndex = 0;

    loadParsedIntern(0);

    const multiBar = document.getElementById('multi-record-bar');
    if (records.length > 1) {
      if (multiBar) multiBar.style.display = 'flex';
      updateMultiInternBar();
      Toast.success(`Loaded ${records.length} interns from ${file.name}!`);
    } else {
      if (multiBar) multiBar.style.display = 'none';
      Toast.success(`Form auto-filled for ${records[0].full_name || 'intern'}!`);
    }
  } catch (err) {
    console.error('File parsing error:', err);
    Toast.error('Failed to parse file: ' + err.message);
  }
}

function loadParsedIntern(index) {
  if (!parsedInternsList || index < 0 || index >= parsedInternsList.length) return;
  currentInternIndex = index;
  const record = parsedInternsList[index];
  Importer.autofillInternForm(record);
  updateMultiInternBar();
}

function updateMultiInternBar() {
  const counter = document.getElementById('record-badge-counter');
  const preview = document.getElementById('record-preview-label');
  const btnPrev = document.getElementById('btn-prev-record');
  const btnNext = document.getElementById('btn-next-record');
  const btnBulk = document.getElementById('btn-bulk-save-records');

  const current = parsedInternsList[currentInternIndex];
  if (counter) counter.textContent = `Intern ${currentInternIndex + 1} of ${parsedInternsList.length}`;
  if (preview && current) {
    preview.textContent = `${current.full_name || 'Unnamed'} • ${current.college_university || current.domain_role || 'Intern'}`;
  }

  if (btnPrev) btnPrev.disabled = currentInternIndex <= 0;
  if (btnNext) btnNext.disabled = currentInternIndex >= parsedInternsList.length - 1;
  if (btnBulk) btnBulk.textContent = `⚡ Bulk Save All (${parsedInternsList.length} Interns)`;
}

function prevParsedIntern() {
  if (currentInternIndex > 0) {
    loadParsedIntern(currentInternIndex - 1);
  }
}

function nextParsedIntern() {
  if (currentInternIndex < parsedInternsList.length - 1) {
    loadParsedIntern(currentInternIndex + 1);
  }
}

function clearParsedInterns() {
  parsedInternsList = [];
  currentInternIndex = 0;
  const multiBar = document.getElementById('multi-record-bar');
  if (multiBar) multiBar.style.display = 'none';
  Toast.info('Cleared uploaded spreadsheet records.');
}

async function bulkImportParsedInterns() {
  if (!parsedInternsList || parsedInternsList.length === 0) {
    Toast.warning('No intern records loaded to save.');
    return;
  }

  const confirmSave = await Confirm.show(`Are you sure you want to bulk save all ${parsedInternsList.length} interns?`, { title: 'Bulk Save Interns', confirmText: 'Save All' });
  if (!confirmSave) return;

  const btnBulk = document.getElementById('btn-bulk-save-records');
  if (btnBulk) {
    btnBulk.disabled = true;
    btnBulk.textContent = 'Saving interns...';
  }

  try {
    const res = await API.post('/interns/bulk', parsedInternsList);
    Toast.success(res.message || `Successfully enrolled ${res.inserted_count || parsedInternsList.length} interns!`);
    setTimeout(() => {
      window.location.href = '/interns.html';
    }, 1500);
  } catch (err) {
    Toast.error('Bulk intern enrollment failed: ' + err.message);
    if (btnBulk) {
      btnBulk.disabled = false;
      btnBulk.textContent = `⚡ Bulk Save All (${parsedInternsList.length} Interns)`;
    }
  }
}

