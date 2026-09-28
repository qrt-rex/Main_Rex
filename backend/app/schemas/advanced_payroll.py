from typing import Optional, List, Dict, Any
from pydantic import BaseModel, Field, field_validator, model_validator
from datetime import datetime
from app.utils.validators import require_iso_date, require_month_name

Year = Field(..., ge=2000, le=2100)
MAX_AMOUNT = 100_000_000


def _opt(le: float = MAX_AMOUNT):
    """Optional non-negative number."""
    return Field(default=None, ge=0, le=le)


def _required_text(v: Optional[str]) -> Optional[str]:
    if v is not None and not v.strip():
        raise ValueError("This field is required.")
    return v.strip() if v is not None else v

# ==========================================
# 1. Salary Structure Schemas
# ==========================================
class SalaryStructureBase(BaseModel):
    employee_id: str
    salary_type: str = "monthly"  # monthly, daily, hourly, contract
    base_salary: float = Field(default=0.0, ge=0)
    hra_type: str = "fixed"       # fixed, percentage
    hra_value: float = Field(default=0.0, ge=0)
    conveyance_allowance: float = Field(default=0.0, ge=0)
    medical_allowance: float = Field(default=0.0, ge=0)
    special_allowance: float = Field(default=0.0, ge=0)
    other_allowances: float = Field(default=0.0, ge=0)
    
    # Statutory & Deductions
    pf_opted: bool = True
    pf_type: str = "percentage_12" # percentage_12, fixed, none
    pf_fixed_amount: float = Field(default=0.0, ge=0)
    esi_opted: bool = False
    esi_percentage: float = Field(default=0.75, ge=0)
    professional_tax: float = Field(default=200.0, ge=0)
    tds_percentage: float = Field(default=0.0, ge=0)
    
    overtime_rate_per_hour: float = Field(default=0.0, ge=0)
    is_active: bool = True
    remarks: Optional[str] = None

class SalaryStructureCreate(SalaryStructureBase):
    pass

class SalaryStructureUpdate(BaseModel):
    salary_type: Optional[str] = None
    base_salary: Optional[float] = _opt()
    hra_type: Optional[str] = None
    hra_value: Optional[float] = _opt()
    conveyance_allowance: Optional[float] = _opt()
    medical_allowance: Optional[float] = _opt()
    special_allowance: Optional[float] = _opt()
    other_allowances: Optional[float] = _opt()
    pf_opted: Optional[bool] = None
    pf_type: Optional[str] = None
    pf_fixed_amount: Optional[float] = _opt()
    esi_opted: Optional[bool] = None
    esi_percentage: Optional[float] = _opt(100)
    professional_tax: Optional[float] = _opt()
    tds_percentage: Optional[float] = _opt(100)
    overtime_rate_per_hour: Optional[float] = _opt()
    is_active: Optional[bool] = None
    remarks: Optional[str] = None

class SalaryStructureResponse(SalaryStructureBase):
    id: Optional[str] = None
    _id: Optional[str] = None
    employee_code: Optional[str] = None
    employee_name: Optional[str] = None
    department: Optional[str] = None
    designation: Optional[str] = None
    created_at: Optional[str] = None
    updated_at: Optional[str] = None

# ==========================================
# 2. Advance & Loan Schemas
# ==========================================
class SalaryAdvanceCreate(BaseModel):
    employee_id: str
    advance_amount: float = Field(..., gt=0, le=MAX_AMOUNT)
    reason: str = Field(..., max_length=500)
    monthly_deduction_amount: float = Field(..., gt=0, le=MAX_AMOUNT)
    start_month: str
    start_year: int = Year

    @field_validator("reason")
    @classmethod
    def _reason(cls, v):
        return _required_text(v)

    @field_validator("start_month")
    @classmethod
    def _month(cls, v):
        return require_month_name(v)

    @model_validator(mode="after")
    def _installment_fits(self):
        if self.monthly_deduction_amount > self.advance_amount:
            raise ValueError("The monthly installment cannot be larger than the advance itself.")
        return self

class SalaryAdvanceUpdate(BaseModel):
    advance_amount: Optional[float] = None
    reason: Optional[str] = None
    monthly_deduction_amount: Optional[float] = None
    start_month: Optional[str] = None
    start_year: Optional[int] = None
    status: Optional[str] = None

class AdvanceApprovalRequest(BaseModel):
    action: str = Field(..., pattern="^(approve|reject)$")
    remarks: Optional[str] = None

class SalaryAdvanceResponse(BaseModel):
    id: Optional[str] = None
    _id: Optional[str] = None
    advance_id: str
    employee_id: str
    employee_code: str
    employee_name: str
    department: str
    request_date: str
    advance_amount: float
    reason: str
    approval_status: str  # Pending, Approved, Rejected, Partially Paid, Fully Recovered, Cancelled
    approved_by: Optional[str] = None
    approval_date: Optional[str] = None
    monthly_deduction_amount: float
    start_month: str
    start_year: int
    paid_amount: float = 0.0
    remaining_balance: float
    status: str
    created_at: str

class EmployeeLoanCreate(BaseModel):
    employee_id: str
    principal_amount: float = Field(..., gt=0, le=MAX_AMOUNT)
    interest_rate_percent: float = Field(default=0.0, ge=0, le=100)
    monthly_emi: float = Field(..., gt=0, le=MAX_AMOUNT)
    start_date: str
    reason: Optional[str] = Field(default=None, max_length=500)

    @field_validator("start_date")
    @classmethod
    def _start(cls, v):
        return require_iso_date(v, "Start date")

    @model_validator(mode="after")
    def _emi_fits(self):
        total = round(self.principal_amount * (1 + self.interest_rate_percent / 100.0), 2)
        if self.monthly_emi > total:
            raise ValueError(f"The monthly EMI cannot be larger than the total payable (₹{total:,.2f}).")
        return self

class EmployeeLoanResponse(BaseModel):
    id: Optional[str] = None
    _id: Optional[str] = None
    loan_id: str
    employee_id: str
    employee_code: str
    employee_name: str
    department: str
    principal_amount: float
    interest_rate_percent: float
    total_payable: float
    monthly_emi: float
    start_date: str
    end_date: Optional[str] = None
    paid_amount: float = 0.0
    remaining_amount: float
    status: str  # Active, Completed, Cancelled
    reason: Optional[str] = None
    created_at: str

# ==========================================
# 3. Bonus, Overtime & Adjustments
# ==========================================
class BonusCreate(BaseModel):
    employee_id: str
    type: str = Field(default="Performance Bonus", max_length=80)  # Performance, Festival, Sales Incentive, Project, Attendance, Custom
    amount: float = Field(..., gt=0, le=MAX_AMOUNT)
    reason: str = Field(..., max_length=500)
    month: str
    year: int = Year

    @field_validator("reason")
    @classmethod
    def _reason(cls, v):
        return _required_text(v)

    @field_validator("month")
    @classmethod
    def _month(cls, v):
        return require_month_name(v)

class BonusResponse(BaseModel):
    id: Optional[str] = None
    _id: Optional[str] = None
    bonus_id: str
    employee_id: str
    employee_name: str
    type: str
    amount: float
    reason: str
    month: str
    year: int
    status: str = "Approved"
    approved_by: Optional[str] = None
    created_at: str

class OvertimeCreate(BaseModel):
    employee_id: str
    date: str
    hours: float = Field(..., gt=0, le=24)
    rate_per_hour: Optional[float] = Field(default=None, gt=0, le=1_000_000)
    reason: Optional[str] = Field(default=None, max_length=500)

    @field_validator("date")
    @classmethod
    def _date(cls, v):
        return require_iso_date(v, "Date")

class OvertimeResponse(BaseModel):
    id: Optional[str] = None
    _id: Optional[str] = None
    employee_id: str
    employee_name: str
    date: str
    hours: float
    rate_per_hour: float
    amount: float
    status: str = "Approved"
    approved_by: Optional[str] = None
    created_at: str

class ManualAdjustmentCreate(BaseModel):
    type: str = Field(..., pattern="^(earning|deduction)$")
    amount: float = Field(..., gt=0)
    reason: str
    description: Optional[str] = None

# ==========================================
# 4. Payroll Calculation & Workflow Schemas
# ==========================================
class AttendanceSummary(BaseModel):
    calendar_days: int = 30
    working_days: int = 30
    present_days: float = 30.0
    paid_leave_days: float = 0.0
    unpaid_leave_days: float = 0.0
    half_days: int = 0
    absent_days: float = 0.0
    holidays: int = 0
    weekly_offs: int = 0
    late_count: int = 0
    overtime_hours: float = 0.0

class EarningsBreakdownDetail(BaseModel):
    basic: float = 0.0
    hra: float = 0.0
    conveyance: float = 0.0
    medical: float = 0.0
    special_allowance: float = 0.0
    other_allowances: float = 0.0
    overtime_pay: float = 0.0
    bonus: float = 0.0
    incentive: float = 0.0
    other_earnings: float = 0.0
    manual_adjustments: float = 0.0
    gross_salary: float = 0.0

class DeductionsBreakdownDetail(BaseModel):
    pf: float = 0.0
    esi: float = 0.0
    professional_tax: float = 0.0
    tds: float = 0.0
    unpaid_leave_deduction: float = 0.0
    late_deduction: float = 0.0
    salary_advance_deduction: float = 0.0
    loan_deduction: float = 0.0
    other_deductions: float = 0.0
    manual_adjustments: float = 0.0
    total_deductions: float = 0.0

class SinglePayrollCalculationRequest(BaseModel):
    employee_id: str
    month: str
    year: int = Year
    working_days: Optional[int] = Field(default=None, ge=1, le=31)
    present_days: Optional[float] = _opt(31)
    paid_leave_days: Optional[float] = _opt(31)
    unpaid_leave_days: Optional[float] = _opt(31)
    half_days: Optional[int] = _opt(31)
    late_count: Optional[int] = _opt(31)
    overtime_hours: Optional[float] = _opt(744)
    bonus_amount: Optional[float] = _opt()
    incentive_amount: Optional[float] = _opt()
    advance_deduction_override: Optional[float] = _opt()
    loan_deduction_override: Optional[float] = _opt()
    other_earnings: Optional[float] = Field(default=0.0, ge=0, le=MAX_AMOUNT)
    other_deductions: Optional[float] = Field(default=0.0, ge=0, le=MAX_AMOUNT)
    manual_adjustments: Optional[List[ManualAdjustmentCreate]] = None
    remarks: Optional[str] = None

    @field_validator("month")
    @classmethod
    def _month(cls, v):
        return require_month_name(v)

    @model_validator(mode="after")
    def _days_within_month(self):
        wd = self.working_days or 31
        for name in ("present_days", "paid_leave_days", "unpaid_leave_days"):
            val = getattr(self, name)
            if val is not None and val > wd:
                raise ValueError(f"{name.replace('_', ' ').capitalize()} cannot exceed the working days ({wd}).")
        return self

class BulkPayrollRunRequest(BaseModel):
    month: str
    year: int = Year
    department: Optional[str] = "All"
    employee_ids: Optional[List[str]] = None
    auto_approve: bool = False

    @field_validator("month")
    @classmethod
    def _month(cls, v):
        return require_month_name(v)

class PayrollRecordResponse(BaseModel):
    id: Optional[str] = None
    _id: Optional[str] = None
    payroll_id: str
    employee_id: str
    employee_code: str
    employee_name: str
    department: str
    designation: str
    joining_date: Optional[str] = None
    bank_name: Optional[str] = None
    account_no: Optional[str] = None
    ifsc_code: Optional[str] = None
    pan_number: Optional[str] = None
    email: Optional[str] = None
    month: str
    year: int
    revision_number: int = 1
    status: str  # DRAFT, CALCULATED, UNDER_REVIEW, APPROVED, FINALIZED, PAID, CANCELLED
    attendance: AttendanceSummary
    earnings: EarningsBreakdownDetail
    deductions: DeductionsBreakdownDetail
    gross_salary: Optional[float] = None
    total_deductions: Optional[float] = None
    net_salary: float
    net_salary_words: str
    currency: str = "INR"
    advances_deducted: Optional[List[Dict[str, Any]]] = None
    loans_deducted: Optional[List[Dict[str, Any]]] = None
    manual_adjustments: Optional[List[Dict[str, Any]]] = None
    is_locked: bool = False
    locked_by: Optional[str] = None
    locked_at: Optional[str] = None
    approved_by: Optional[str] = None
    approved_at: Optional[str] = None
    payment_status: str = "Pending"  # Pending, Processing, Paid, Failed
    payment_date: Optional[str] = None
    payment_reference: Optional[str] = None
    payment_method: Optional[str] = "Bank Transfer"
    payslip_generated: bool = False
    payslip_id: Optional[str] = None
    payslip_number: Optional[str] = None
    email_sent: bool = False
    email_sent_at: Optional[str] = None
    remarks: Optional[str] = None
    created_at: str
    updated_at: str

class PayrollEditRequest(BaseModel):
    basic: Optional[float] = _opt()
    hra: Optional[float] = _opt()
    conveyance: Optional[float] = _opt()
    medical: Optional[float] = _opt()
    special_allowance: Optional[float] = _opt()
    other_allowances: Optional[float] = _opt()
    overtime_pay: Optional[float] = _opt()
    bonus: Optional[float] = _opt()
    incentive: Optional[float] = _opt()
    other_earnings: Optional[float] = _opt()
    pf: Optional[float] = _opt()
    esi: Optional[float] = _opt()
    professional_tax: Optional[float] = _opt()
    tds: Optional[float] = _opt()
    unpaid_leave_deduction: Optional[float] = _opt()
    late_deduction: Optional[float] = _opt()
    salary_advance_deduction: Optional[float] = _opt()
    loan_deduction: Optional[float] = _opt()
    other_deductions: Optional[float] = _opt()
    manual_adjustments: Optional[List[ManualAdjustmentCreate]] = None
    remarks: Optional[str] = None

class PayrollUnlockRequest(BaseModel):
    reason: str = Field(..., min_length=5)

class PayrollMarkPaidRequest(BaseModel):
    payment_date: Optional[str] = None
    payment_reference: Optional[str] = None
    payment_method: Optional[str] = "Bank Transfer"
    notes: Optional[str] = None

# ==========================================
# 5. Email & SMTP & Settings Schemas
# ==========================================
class SMTPSettings(BaseModel):
    smtp_host: str = "smtp.gmail.com"
    smtp_port: int = 587
    smtp_user: str = ""
    smtp_password: Optional[str] = ""
    smtp_encryption: str = "TLS"  # TLS, SSL, None
    from_name: str = "Rexera HR & Payroll"
    from_email: str = "hr@rexera.co.in"
    email_dev_mode: bool = True

class EmailTemplateConfig(BaseModel):
    subject_template: str = "Salary Payslip - {{month}} {{year}} - {{employee_code}}"
    body_template: str = """Dear {{employee_name}},

Please find attached your official salary payslip for {{month}} {{year}}.

Summary of details:
- Employee ID: {{employee_code}}
- Department: {{department}}
- Net Payable Salary: ₹{{net_salary}}
- Payslip Number: {{payslip_number}}

If you have any questions or require clarifications regarding your deductions or salary components, please reach out to the HR & Payroll team.

Best Regards,
{{company_name}} HR & Payroll Team"""

class EmailLogResponse(BaseModel):
    id: Optional[str] = None
    _id: Optional[str] = None
    employee_id: str
    employee_code: str
    employee_name: str
    email: str
    payslip_number: str
    month: str
    year: int
    sent_at: str
    status: str  # Sent, Failed, Pending
    error_message: Optional[str] = None
    retry_count: int = 0

class CompanyPayrollSettings(BaseModel):
    company_name: str = "Rexera Technologies Inc."
    company_address: str = "Rexera, Ahmedabad"
    company_phone: str = "+91 40 4852 9000"
    company_email: str = "hr@rexera.co.in"
    company_website: str = "https://www.rexera.co.in"
    currency: str = "INR"
    currency_symbol: str = "₹"
    standard_working_days: int = 30
    salary_proration_method: str = "calendar_days"  # calendar_days, standard_30, actual_working_days
    late_deduction_rule: str = "count_tiers"        # count_tiers (3 late = 0.5 day), minute_based, fixed
    overtime_rate_multiplier: float = 1.5
    default_pf_opted: bool = True
    default_pt_amount: float = 200.0
    payslip_prefix: str = "REX-PAY"
    timezone: str = "Asia/Kolkata"
    smtp: SMTPSettings = SMTPSettings()
    email_template: EmailTemplateConfig = EmailTemplateConfig()

# ==========================================
# 6. Audit Logs & Reports
# ==========================================
class AuditLogEntry(BaseModel):
    id: Optional[str] = None
    _id: Optional[str] = None
    user_email: str
    user_role: str
    action: str
    entity_type: str  # payroll, advance, loan, payslip, settings
    entity_id: Optional[str] = None
    employee_name: Optional[str] = None
    old_value: Optional[Any] = None
    new_value: Optional[Any] = None
    timestamp: str
    ip_address: Optional[str] = None
