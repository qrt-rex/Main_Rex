/**
 * Rexera HR Management System - Universal CSV & Excel (XLSX/XLS) Importer, Exporter & Auto-Filler
 */

const Importer = {
  // Dictionary of known column aliases mapped to standardized internal keys
  fieldMap: {
    // Identity & Name
    full_name: ['full_name', 'fullname', 'name', 'employee_name', 'candidate_name', 'intern_name', 'person_name', 'emp_name', 'candidate', 'intern'],
    parent_name: ['parent_name', 'father_name', 'mother_name', 'parent', 'guardian_name'],
    gender: ['gender', 'sex'],
    date_of_birth: ['date_of_birth', 'dob', 'birth_date', 'birthdate'],
    marital_status: ['marital_status', 'marital', 'married'],
    nationality: ['nationality', 'country'],
    blood_group: ['blood_group', 'blood', 'bg'],

    // Contact
    email: ['email', 'email_address', 'mail', 'e-mail', 'candidate_email', 'emp_email'],
    mobile_number: ['mobile_number', 'mobile', 'phone', 'contact_number', 'contact', 'phone_number', 'cell', 'telephone'],
    alternate_mobile: ['alternate_mobile', 'alt_phone', 'alt_mobile', 'secondary_phone'],
    permanent_address: ['permanent_address', 'address', 'perm_address', 'residence_address'],
    correspondence_address: ['correspondence_address', 'current_address', 'local_address', 'temp_address'],

    // Organization & Role
    employee_code: ['employee_code', 'emp_code', 'code', 'emp_id', 'id'],
    intern_code: ['intern_code', 'intern_id', 'trainee_code'],
    department: ['department', 'dept', 'division', 'team', 'business_unit'],
    designation: ['designation', 'role', 'position', 'position_applied', 'job_title', 'title', 'domain_role'],
    reporting_manager: ['reporting_manager', 'manager', 'lead', 'supervisor', 'mentor', 'assigned_mentor'],
    date_of_joining: ['date_of_joining', 'doj', 'joining_date', 'joined_date', 'start_date', 'appointment_date'],
    employee_status: ['employee_status', 'status', 'emp_status', 'state'],

    // Compensation & Salary
    base_salary: ['base_salary', 'basic', 'basic_salary', 'base', 'salary', 'fixed_pay', 'fixed_salary'],
    hra: ['hra', 'house_rent_allowance', 'rent_allowance'],
    conveyance_allowance: ['conveyance_allowance', 'conveyance', 'travel_allowance', 'ca'],
    special_allowance: ['special_allowance', 'special', 'allowances', 'other_allowance', 'sa'],
    professional_tax: ['professional_tax', 'pt', 'prof_tax'],
    pf_opted: ['pf_opted', 'pf', 'provident_fund', 'epf', 'deduct_pf'],
    monthly_stipend: ['monthly_stipend', 'stipend', 'stipend_amount', 'intern_stipend'],

    // Banking
    bank_name: ['bank_name', 'bank', 'bank_title'],
    account_no: ['account_no', 'account_number', 'bank_account', 'acc_no', 'account'],
    ifsc_code: ['ifsc_code', 'ifsc', 'branch_code', 'ifsc_num'],

    // Statutory IDs
    pan_number: ['pan_number', 'pan', 'pan_card', 'pan_no'],
    aadhaar_number: ['aadhaar_number', 'aadhaar', 'aadhar', 'aadhaar_no', 'uidai'],
    emergency_contact_name: ['emergency_contact_name', 'emergency_name', 'ice_name'],
    emergency_contact_number: ['emergency_contact_number', 'emergency_phone', 'ice_phone'],
    emergency_contact_relation: ['emergency_contact_relation', 'emergency_relation', 'relation'],

    // Intern Academic
    college_university: ['college_university', 'college', 'university', 'institution', 'institute', 'school', 'campus'],
    degree: ['degree', 'course', 'qualification', 'program'],
    branch_specialization: ['branch_specialization', 'branch', 'stream', 'specialization', 'field_of_study', 'major'],
    current_semester: ['current_semester', 'semester', 'sem', 'year_of_study'],
    roll_number: ['roll_number', 'roll_no', 'reg_no', 'registration_no', 'enrollment_no', 'student_id'],
    duration_months: ['duration_months', 'duration', 'months', 'internship_duration', 'period'],
    internship_type: ['internship_type', 'type', 'mode'],
    start_date: ['start_date', 'internship_start', 'commencement_date'],
    end_date: ['end_date', 'internship_end', 'completion_date'],

    // Candidate Specific
    current_company: ['current_company', 'company', 'employer', 'previous_company', 'present_company'],
    total_experience: ['total_experience', 'experience', 'exp', 'work_experience', 'total_exp'],
    current_ctc: ['current_ctc', 'present_ctc', 'current_salary'],
    expected_ctc: ['expected_ctc', 'exp_ctc', 'desired_salary'],
    notice_period: ['notice_period', 'notice', 'np']
  },

  /**
   * Normalizes a header string (e.g. "Employee Name (Full)" -> "full_name")
   */
  normalizeHeader(header) {
    if (!header) return '';
    const clean = String(header).toLowerCase().replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
    for (const [standardKey, aliases] of Object.entries(this.fieldMap)) {
      if (standardKey === clean || aliases.includes(clean)) {
        return standardKey;
      }
      for (const alias of aliases) {
        if (clean.includes(alias) || alias.includes(clean)) {
          return standardKey;
        }
      }
    }
    return clean;
  },

  /**
   * Universal parser for .csv, .xlsx, .xls files
   * Returns a Promise resolving to Array of Objects
   */
  async parseFile(file) {
    const filename = file.name.toLowerCase();
    
    if (filename.endsWith('.csv')) {
      return this.parseCSVFile(file);
    } else if (filename.endsWith('.xlsx') || filename.endsWith('.xls')) {
      return this.parseExcelFile(file);
    } else {
      throw new Error('Unsupported file format. Please upload a .csv, .xlsx, or .xls file.');
    }
  },

  /**
   * Parse CSV file with robust quote and delimiter handling
   */
  async parseCSVFile(file) {
    const text = await file.text();
    return this.parseCSVText(text);
  },

  parseCSVText(text) {
    const lines = text.split(/\r\n|\n|\r/).filter(l => l.trim().length > 0);
    if (lines.length < 2) {
      throw new Error('CSV file is empty or missing data rows.');
    }

    // Parse header
    const rawHeaders = this.splitCSVLine(lines[0]);
    const normalizedHeaders = rawHeaders.map(h => this.normalizeHeader(h));

    const records = [];
    for (let i = 1; i < lines.length; i++) {
      const values = this.splitCSVLine(lines[i]);
      if (values.every(v => !v || v.trim().length === 0)) continue;

      const row = {};
      normalizedHeaders.forEach((key, idx) => {
        if (key && values[idx] !== undefined) {
          row[key] = values[idx].trim();
        }
      });
      records.push(row);
    }
    return records;
  },

  splitCSVLine(line) {
    const values = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === ',' && !inQuotes) {
        values.push(current);
        current = '';
      } else {
        current += char;
      }
    }
    values.push(current);
    return values;
  },

  /**
   * Parse Excel (.xlsx/.xls) file using SheetJS
   */
  async parseExcelFile(file) {
    if (typeof XLSX === 'undefined') {
      throw new Error('Excel parsing library is loading. Please try again in a moment.');
    }

    const data = await file.arrayBuffer();
    const workbook = XLSX.read(data, { type: 'array', cellDates: true });
    
    // Read first sheet by default (or multiple sheets if requested)
    const firstSheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[firstSheetName];
    const jsonRows = XLSX.utils.sheet_to_json(worksheet, { defval: '', raw: false });

    if (!jsonRows || jsonRows.length === 0) {
      throw new Error('The uploaded Excel sheet contains no data.');
    }

    // Normalize keys
    const normalizedRecords = jsonRows.map(rawRow => {
      const normalizedRow = {};
      for (const [key, val] of Object.entries(rawRow)) {
        const normKey = this.normalizeHeader(key);
        let cleanVal = val;
        if (val instanceof Date) {
          cleanVal = val.toISOString().substring(0, 10);
        } else if (typeof val === 'string') {
          cleanVal = val.trim();
        }
        if (normKey) {
          normalizedRow[normKey] = cleanVal;
        }
      }
      return normalizedRow;
    });

    return normalizedRecords;
  },

  /**
   * Parse ALL sheets in a workbook (for Full System Import)
   */
  async parseAllSheets(file) {
    if (typeof XLSX === 'undefined') {
      throw new Error('Excel parser library is not loaded.');
    }

    const data = await file.arrayBuffer();
    const workbook = XLSX.read(data, { type: 'array', cellDates: true });
    const result = {};

    workbook.SheetNames.forEach(name => {
      const sheet = workbook.Sheets[name];
      const rows = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false });
      const normRows = rows.map(r => {
        const norm = {};
        for (const [k, v] of Object.entries(r)) {
          norm[this.normalizeHeader(k)] = v;
        }
        return norm;
      });
      result[name.toLowerCase()] = normRows;
    });

    return result;
  },

  /**
   * Auto-fill Add Employee / Intern Form from parsed record
   */
  autofillEmployeeForm(data) {
    if (!data) return false;

    // Detect if this record is an Intern or Employee
    const isIntern = Boolean(
      data.college_university || 
      data.degree || 
      data.monthly_stipend || 
      data.internship_type || 
      data.intern_code ||
      (data.designation && data.designation.toLowerCase().includes('intern'))
    );

    if (typeof window.setPersonType === 'function') {
      window.setPersonType(isIntern ? 'intern' : 'employee');
    }

    // Populate common fields
    this.setInputValue('full_name', data.full_name);
    this.setInputValue('email', data.email);
    this.setInputValue('mobile_number', data.mobile_number);
    this.setInputValue('code_input', isIntern ? (data.intern_code || data.employee_code) : data.employee_code);
    this.setInputValue('role_input', data.designation || data.domain_role);
    this.setInputValue('manager_input', data.reporting_manager || data.assigned_mentor);
    this.setInputValue('date_of_joining', data.date_of_joining || data.start_date);
    
    // Department dropdown & other container
    const deptSelect = document.getElementById('department');
    const deptOtherContainer = document.getElementById('department-other-container');
    const deptOtherInput = document.getElementById('department-other');
    if (deptSelect && data.department) {
      const optExists = Array.from(deptSelect.options).some(o => o.value.toLowerCase() === data.department.toLowerCase());
      if (optExists) {
        deptSelect.value = data.department;
        if (deptOtherContainer) deptOtherContainer.style.display = 'none';
      } else {
        deptSelect.value = 'other';
        if (deptOtherContainer) {
          deptOtherContainer.style.display = 'block';
          if (deptOtherInput) deptOtherInput.value = data.department;
        }
      }
    }

    // Banking
    this.setInputValue('bank_name', data.bank_name);
    this.setInputValue('account_no', data.account_no);
    this.setInputValue('ifsc_code', data.ifsc_code);

    if (isIntern) {
      // Intern-specific fields
      this.setInputValue('college_university', data.college_university);
      this.setInputValue('degree', data.degree);
      this.setInputValue('branch_specialization', data.branch_specialization);
      this.setInputValue('current_semester', data.current_semester);
      this.setInputValue('roll_number', data.roll_number);
      this.setInputValue('start_date', data.start_date || data.date_of_joining);
      this.setInputValue('end_date', data.end_date);
      this.setInputValue('duration_months', data.duration_months);
      this.setInputValue('monthly_stipend', data.monthly_stipend);
      if (data.internship_type) {
        const typeSelect = document.getElementById('internship_type');
        if (typeSelect) typeSelect.value = data.internship_type;
      }
    } else {
      // Employee-specific fields
      this.setInputValue('base_salary', data.base_salary);
      this.setInputValue('hra', data.hra || Math.round((parseFloat(data.base_salary) || 0) * 0.4));
      this.setInputValue('conveyance_allowance', data.conveyance_allowance || 2000);
      this.setInputValue('special_allowance', data.special_allowance || 5000);
      this.setInputValue('professional_tax', data.professional_tax || 200);

      const pfCheckbox = document.getElementById('pf_opted');
      if (pfCheckbox && data.pf_opted !== undefined) {
        const pfStr = String(data.pf_opted).toLowerCase();
        pfCheckbox.checked = !(pfStr === 'false' || pfStr === 'no' || pfStr === '0');
      }

      if (typeof window.calculateSalaryPreview === 'function') {
        window.calculateSalaryPreview();
      }
    }

    return true;
  },

  /**
   * Auto-fill Intern Form on intern-form.html
   */
  autofillInternForm(data) {
    if (!data) return false;
    this.setInputValue('intern_code', data.intern_code || data.employee_code);
    this.setInputValue('full_name', data.full_name);
    this.setInputValue('email', data.email);
    this.setInputValue('mobile_number', data.mobile_number);
    this.setInputValue('date_of_birth', data.date_of_birth);
    this.setInputValue('college_university', data.college_university);
    this.setInputValue('degree', data.degree);
    this.setInputValue('branch_specialization', data.branch_specialization);
    this.setInputValue('current_semester', data.current_semester);
    this.setInputValue('roll_number', data.roll_number);
    this.setInputValue('domain_role', data.domain_role || data.designation);
    this.setInputValue('assigned_mentor', data.assigned_mentor || data.reporting_manager);
    this.setInputValue('start_date', data.start_date || data.date_of_joining);
    this.setInputValue('end_date', data.end_date);
    this.setInputValue('duration_months', data.duration_months);
    this.setInputValue('monthly_stipend', data.monthly_stipend);
    this.setInputValue('bank_name', data.bank_name);
    this.setInputValue('account_no', data.account_no);
    this.setInputValue('ifsc_code', data.ifsc_code);

    if (data.department) {
      const deptSelect = document.getElementById('department');
      if (deptSelect) deptSelect.value = data.department;
    }
    return true;
  },

  /**
   * Auto-fill Candidate Form on index.html
   */
  autofillCandidateForm(data) {
    if (!data) return false;
    this.setInputValue('candidate_name', data.full_name || data.candidate_name);
    this.setInputValue('position_applied', data.designation || data.position_applied);
    this.setInputValue('email', data.email);
    this.setInputValue('contact_number', data.mobile_number || data.contact_number);
    this.setInputValue('current_company', data.current_company);
    this.setInputValue('total_experience', data.total_experience);
    this.setInputValue('current_ctc', data.current_ctc);
    this.setInputValue('expected_ctc', data.expected_ctc);
    this.setInputValue('notice_period', data.notice_period);
    return true;
  },

  setInputValue(id, val) {
    const el = document.getElementById(id);
    if (el && val !== undefined && val !== null && val !== '') {
      el.value = val;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }
  },

  /**
   * Export Array of Objects to Excel (.xlsx)
   */
  exportToExcel(data, filename = 'Rexera_Export.xlsx', sheetName = 'Data') {
    if (typeof XLSX === 'undefined') {
      Toast.error('Excel export module not ready.');
      return;
    }
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, sheetName.substring(0, 31));
    XLSX.writeFile(wb, filename);
    Toast.success(`Exported ${data.length} records to ${filename}`);
  },

  /**
   * Export Multi-Sheet System Backup Workbook (.xlsx)
   */
  exportFullSystemExcel(sheetsDict, filename = 'Rexera_HR_Complete_System_Backup_2026.xlsx') {
    if (typeof XLSX === 'undefined') {
      Toast.error('Excel export module not ready.');
      return;
    }
    const wb = XLSX.utils.book_new();
    for (const [sheetName, rows] of Object.entries(sheetsDict)) {
      const ws = XLSX.utils.json_to_sheet(rows && rows.length ? rows : [{ Status: 'No data records found' }]);
      XLSX.utils.book_append_sheet(wb, ws, sheetName.substring(0, 31));
    }
    XLSX.writeFile(wb, filename);
    Toast.success(`Full system database exported to ${filename}`);
  },

  /**
   * Export Array of Objects to standard CSV
   */
  exportToCSV(data, filename = 'Rexera_Export.csv', columns = null) {
    if (!data || data.length === 0) {
      Toast.warning('No data records available to export.');
      return;
    }

    const headers = columns || Object.keys(data[0]);
    const csvRows = [];
    csvRows.push(headers.join(','));

    for (const row of data) {
      const values = headers.map(h => {
        let val = row[h];
        if (val === undefined || val === null) val = '';
        if (typeof val === 'object') val = JSON.stringify(val);
        val = String(val).replace(/"/g, '""');
        return `"${val}"`;
      });
      csvRows.push(values.join(','));
    }

    const csvBlob = new Blob([csvRows.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(csvBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    Toast.success(`Exported ${data.length} records to ${filename}`);
  },

  /**
   * Download pre-formatted Sample Templates
   */
  downloadTemplate(type = 'employee', format = 'xlsx') {
    let sampleData = [];
    let filename = `Rexera_Sample_${type.toUpperCase()}_Template.${format}`;

    if (type === 'employee') {
      sampleData = [
        {
          full_name: 'Aditi Rao',
          email: 'aditi.rao@rexera.co.in',
          mobile_number: '9876543210',
          department: 'Engineering',
          designation: 'Senior Backend Engineer',
          reporting_manager: 'Vikram Malhotra',
          date_of_joining: '2026-09-01',
          base_salary: 60000,
          hra: 24000,
          conveyance_allowance: 2000,
          special_allowance: 5000,
          professional_tax: 200,
          pf_opted: 'Yes',
          bank_name: 'HDFC Bank',
          account_no: '50100492817264',
          ifsc_code: 'HDFC0001024'
        },
        {
          full_name: 'Manish Verma',
          email: 'manish.v@rexera.co.in',
          mobile_number: '9812345678',
          department: 'Product & Design',
          designation: 'UI/UX Product Designer',
          reporting_manager: 'Siddharth Roy',
          date_of_joining: '2026-09-15',
          base_salary: 50000,
          hra: 20000,
          conveyance_allowance: 2000,
          special_allowance: 4000,
          professional_tax: 200,
          pf_opted: 'Yes',
          bank_name: 'ICICI Bank',
          account_no: '002401569842',
          ifsc_code: 'ICIC0000024'
        }
      ];
    } else if (type === 'intern') {
      sampleData = [
        {
          full_name: 'Sneha Reddy',
          email: 'sneha.reddy@college.edu',
          mobile_number: '9877112233',
          department: 'Engineering',
          domain_role: 'Full-Stack Developer Intern',
          assigned_mentor: 'Aarav Sharma',
          college_university: 'Nirma University, Ahmedabad',
          degree: 'B.Tech',
          branch_specialization: 'Computer Science',
          current_semester: '7th Semester',
          roll_number: '21BCE089',
          start_date: '2026-09-01',
          end_date: '2026-12-31',
          duration_months: 4,
          monthly_stipend: 18000,
          internship_type: 'Full-time',
          bank_name: 'State Bank of India',
          account_no: '304958271029',
          ifsc_code: 'SBIN0001234'
        }
      ];
    } else if (type === 'candidate') {
      sampleData = [
        {
          candidate_name: 'Rohan Deshmukh',
          position_applied: 'DevOps Engineer',
          email: 'rohan.d@example.com',
          contact_number: '9765432109',
          current_company: 'Infosys',
          total_experience: '4.5 Years',
          current_ctc: '14 LPA',
          expected_ctc: '20 LPA',
          notice_period: '30 Days'
        }
      ];
    }

    if (format === 'csv') {
      this.exportToCSV(sampleData, filename);
    } else {
      this.exportToExcel(sampleData, filename, `${type.toUpperCase()} Template`);
    }
  }
};

window.Importer = Importer;
