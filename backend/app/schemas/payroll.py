from typing import List, Optional, Dict, Any
from pydantic import BaseModel, Field, field_validator, model_validator
from app.utils.validators import require_month_name

Money = Field(default=0.0, ge=0, le=100_000_000)
Days = Field(default=30, ge=1, le=31)

class EarningsBreakdown(BaseModel):
    basic: float = 0.0
    hra: float = 0.0
    conveyance: float = 0.0
    special_allowance: float = 0.0
    bonus: float = 0.0
    other_allowances: float = 0.0
    gross_earnings: float = 0.0

class DeductionsBreakdown(BaseModel):
    pf: float = 0.0
    pt: float = 200.0
    tds: float = 0.0
    lop_deduction: float = 0.0
    other_deductions: float = 0.0
    gross_deductions: float = 0.0

class SalaryCalculateRequest(BaseModel):
    base_salary: float = Field(..., ge=0, le=100_000_000)
    hra: float = Money
    conveyance_allowance: float = Money
    special_allowance: float = Money
    pf_opted: bool = True
    professional_tax: float = Field(default=200.0, ge=0, le=100_000)
    bonus: float = Money
    other_deductions: float = Money
    working_days: int = Days
    lop_days: float = Field(default=0, ge=0, le=31)

    @model_validator(mode="after")
    def _lop_within_month(self):
        if self.lop_days > self.working_days:
            raise ValueError("Loss-of-pay days cannot exceed the working days.")
        return self

class SalaryCalculationResult(BaseModel):
    earnings: EarningsBreakdown
    deductions: DeductionsBreakdown
    gross_salary: float
    net_salary: float
    net_salary_words: str

class SalarySlipCreateRequest(BaseModel):
    employee_id: str
    month: str  # January, February, etc.
    year: int = Field(..., ge=2000, le=2100)
    working_days: int = Days
    paid_days: float = Field(default=30, ge=0, le=31)
    lop_days: float = Field(default=0, ge=0, le=31)
    bonus: float = Money
    other_deductions: float = Money
    remarks: Optional[str] = ""

    @field_validator("month")
    @classmethod
    def _month(cls, v):
        return require_month_name(v)

    @model_validator(mode="after")
    def _lop_within_month(self):
        if self.lop_days > self.working_days:
            raise ValueError("Loss-of-pay days cannot exceed the working days.")
        return self

class BatchPayrollRunRequest(BaseModel):
    month: str
    year: int = Field(..., ge=2000, le=2100)
    department: Optional[str] = None  # None for all departments

    @field_validator("month")
    @classmethod
    def _month(cls, v):
        return require_month_name(v)

class SalarySlipResponse(BaseModel):
    id: str
    slip_number: str
    employee_id: str
    employee_code: str
    employee_name: str
    department: str
    designation: str
    bank_name: str
    account_no: str
    ifsc_code: str
    pan_number: Optional[str] = ""
    date_of_joining: Optional[str] = ""
    month: str
    year: int
    working_days: int
    paid_days: float
    lop_days: float  # half-day leave makes these fractional
    earnings: EarningsBreakdown
    deductions: DeductionsBreakdown
    net_salary: float
    net_salary_words: str
    payment_status: str = "Paid"  # Draft, Processed, Paid
    payment_date: Optional[str] = None
    created_at: str

class SalarySlipListResponse(BaseModel):
    total: int
    month: Optional[str] = None
    year: Optional[int] = None
    slips: List[SalarySlipResponse]

class PayrollSummaryResponse(BaseModel):
    month: str
    year: int
    total_slips: int
    total_gross_disbursed: float
    total_pf_deducted: float
    total_pt_deducted: float
    total_tds_deducted: float
    total_net_disbursed: float
    department_summary: Dict[str, Any] = {}
