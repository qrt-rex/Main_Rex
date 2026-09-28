from typing import List, Optional
from pydantic import BaseModel, EmailStr, Field, field_validator
from app.utils.validators import optional_ifsc, require_choice, require_iso_date, require_mobile

EMPLOYEE_STATUSES = ["Active", "Probation", "Inactive", "Resigned", "Terminated"]
JOINING_STATUSES = ["Pending", "Completed", "Joined"]

Money = Field(default=0.0, ge=0, le=100_000_000)


class _EmployeeFieldRules(BaseModel):
    """Shared field rules for create and update (update skips fields that are None)."""

    @field_validator("full_name", "department", "designation", check_fields=False)
    @classmethod
    def _not_blank(cls, v):
        if v is not None and not str(v).strip():
            raise ValueError("This field is required.")
        return v.strip() if isinstance(v, str) else v

    @field_validator("mobile_number", check_fields=False)
    @classmethod
    def _mobile(cls, v):
        return v if v is None else require_mobile(v)

    @field_validator("ifsc_code", check_fields=False)
    @classmethod
    def _ifsc(cls, v):
        return v if v is None else optional_ifsc(v)

    @field_validator("date_of_joining", check_fields=False)
    @classmethod
    def _doj(cls, v):
        return v if v is None else require_iso_date(v, "Date of joining")

    @field_validator("employee_status", check_fields=False)
    @classmethod
    def _status(cls, v):
        return v if v is None else require_choice(v, EMPLOYEE_STATUSES, "Employee status")

    @field_validator("joining_status", check_fields=False)
    @classmethod
    def _joining_status(cls, v):
        return v if v is None else require_choice(v, JOINING_STATUSES, "Joining status")


class EmployeeCreateRequest(_EmployeeFieldRules):
    employee_code: Optional[str] = ""
    full_name: str = Field(min_length=1, max_length=120)
    email: EmailStr
    mobile_number: str
    department: str = Field(min_length=1, max_length=80)
    designation: str = Field(min_length=1, max_length=80)
    gender: Optional[str] = ""
    branch: Optional[str] = ""
    reporting_manager: Optional[str] = ""
    date_of_joining: str
    base_salary: float = Money
    hra: float = Money
    conveyance_allowance: float = Money
    special_allowance: float = Money
    professional_tax: float = Field(default=200.0, ge=0, le=100_000)
    pf_opted: bool = True
    bank_name: str = ""
    account_no: str = ""
    ifsc_code: str = ""
    employee_status: str = "Active"  # Active, Probation, Inactive, Resigned, Terminated
    joining_status: str = "Completed"  # Pending, Completed

class EmployeeUpdateRequest(_EmployeeFieldRules):
    full_name: Optional[str] = Field(default=None, max_length=120)
    email: Optional[EmailStr] = None
    mobile_number: Optional[str] = None
    department: Optional[str] = Field(default=None, max_length=80)
    designation: Optional[str] = Field(default=None, max_length=80)
    gender: Optional[str] = None
    branch: Optional[str] = None
    reporting_manager: Optional[str] = None
    date_of_joining: Optional[str] = None
    base_salary: Optional[float] = Field(default=None, ge=0, le=100_000_000)
    hra: Optional[float] = Field(default=None, ge=0, le=100_000_000)
    conveyance_allowance: Optional[float] = Field(default=None, ge=0, le=100_000_000)
    special_allowance: Optional[float] = Field(default=None, ge=0, le=100_000_000)
    professional_tax: Optional[float] = Field(default=None, ge=0, le=100_000)
    pf_opted: Optional[bool] = None
    bank_name: Optional[str] = None
    account_no: Optional[str] = None
    ifsc_code: Optional[str] = None
    employee_status: Optional[str] = None
    joining_status: Optional[str] = None

class EmployeeResponse(BaseModel):
    id: str
    employee_code: str
    full_name: str
    email: str
    mobile_number: str
    department: str
    designation: str
    gender: Optional[str] = ""
    branch: Optional[str] = ""
    reporting_manager: Optional[str] = ""
    date_of_joining: str
    base_salary: float
    hra: float
    conveyance_allowance: float
    special_allowance: float = 0.0
    professional_tax: float
    pf_opted: bool = True
    bank_name: str
    account_no: str  # Masked in list, unmasked in detail
    ifsc_code: str
    employee_status: str
    joining_status: str
    gross_salary: float = 0.0
    estimated_net_salary: float = 0.0
    created_at: Optional[str] = None
    updated_at: Optional[str] = None

class EmployeeListResponse(BaseModel):
    total: int
    page: int
    limit: int
    employees: List[EmployeeResponse]
