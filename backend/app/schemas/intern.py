from typing import List, Optional
from pydantic import BaseModel, EmailStr, Field, field_validator, model_validator
from app.utils.validators import optional_ifsc, optional_iso_date, require_choice, require_iso_date, require_mobile

INTERN_STATUSES = ["Ongoing", "Under Review", "Completed", "Converted to Full-Time", "Discontinued"]


class _InternFieldRules(BaseModel):
    @field_validator("mobile_number", check_fields=False)
    @classmethod
    def _mobile(cls, v):
        return v if v is None else require_mobile(v)

    @field_validator("ifsc_code", check_fields=False)
    @classmethod
    def _ifsc(cls, v):
        return v if v is None else optional_ifsc(v)

    @field_validator("start_date", "end_date", check_fields=False)
    @classmethod
    def _dates(cls, v, info):
        return v if v is None else require_iso_date(v, info.field_name.replace("_", " ").capitalize())

    @field_validator("date_of_birth", check_fields=False)
    @classmethod
    def _dob(cls, v):
        return v if v is None else optional_iso_date(v, "Date of birth")

    @field_validator("status", check_fields=False)
    @classmethod
    def _status(cls, v):
        return v if v is None else require_choice(v, INTERN_STATUSES, "Status")

    @model_validator(mode="after")
    def _end_after_start(self):
        start, end = getattr(self, "start_date", None), getattr(self, "end_date", None)
        if start and end and end < start:
            raise ValueError("End date must be on or after the start date.")
        return self


class InternCreateRequest(_InternFieldRules):
    intern_code: Optional[str] = ""
    full_name: str
    email: EmailStr
    mobile_number: str
    gender: Optional[str] = "Other"
    date_of_birth: Optional[str] = ""
    
    # Academic Details
    college_university: str
    degree: str  # B.Tech, BCA, MCA, MBA, B.Sc, etc.
    branch_specialization: str
    current_semester: Optional[str] = ""
    roll_number: Optional[str] = ""
    
    # Internship Scope
    department: str
    domain_role: str
    assigned_mentor: str
    start_date: str
    end_date: str
    duration_months: int = Field(default=3, ge=1, le=60)
    internship_type: str = "Full-time"  # Full-time, Part-time, Summer Intern, Research Trainee

    # Stipend & Banking
    monthly_stipend: float = Field(default=15000.0, ge=0, le=10_000_000)
    bank_name: Optional[str] = ""
    account_no: Optional[str] = ""
    ifsc_code: Optional[str] = ""
    
    status: str = "Ongoing"  # Ongoing, Under Review, Completed, Converted to Full-Time, Discontinued
    performance_rating: Optional[float] = Field(default=None, ge=0, le=5)
    mentor_feedback: Optional[str] = ""

class InternUpdateRequest(_InternFieldRules):
    full_name: Optional[str] = None
    email: Optional[EmailStr] = None
    mobile_number: Optional[str] = None
    college_university: Optional[str] = None
    degree: Optional[str] = None
    branch_specialization: Optional[str] = None
    current_semester: Optional[str] = None
    department: Optional[str] = None
    domain_role: Optional[str] = None
    assigned_mentor: Optional[str] = None
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    duration_months: Optional[int] = Field(default=None, ge=1, le=60)
    monthly_stipend: Optional[float] = Field(default=None, ge=0, le=10_000_000)
    bank_name: Optional[str] = None
    account_no: Optional[str] = None
    ifsc_code: Optional[str] = None
    status: Optional[str] = None
    performance_rating: Optional[float] = Field(default=None, ge=0, le=5)
    mentor_feedback: Optional[str] = None

class InternConvertToEmployeeRequest(BaseModel):
    employee_code: Optional[str] = ""
    designation: str = Field(min_length=1, max_length=80)
    department: Optional[str] = None
    reporting_manager: Optional[str] = ""
    date_of_joining: str
    base_salary: float = Field(gt=0, le=100_000_000)
    hra: float = Field(default=0.0, ge=0, le=100_000_000)
    conveyance_allowance: float = Field(default=0.0, ge=0, le=100_000_000)
    special_allowance: float = Field(default=0.0, ge=0, le=100_000_000)
    professional_tax: float = Field(default=200.0, ge=0, le=100_000)
    pf_opted: bool = True

    @field_validator("date_of_joining")
    @classmethod
    def _doj(cls, v):
        return require_iso_date(v, "Date of joining")

class InternResponse(BaseModel):
    id: str
    intern_code: str
    full_name: str
    email: str
    mobile_number: str
    gender: Optional[str] = ""
    date_of_birth: Optional[str] = ""
    college_university: str
    degree: str
    branch_specialization: str
    current_semester: Optional[str] = ""
    roll_number: Optional[str] = ""
    department: str
    domain_role: str
    assigned_mentor: str
    start_date: str
    end_date: str
    duration_months: int
    internship_type: str
    monthly_stipend: float
    bank_name: Optional[str] = ""
    account_no: Optional[str] = ""
    ifsc_code: Optional[str] = ""
    status: str
    performance_rating: Optional[float] = None
    mentor_feedback: Optional[str] = ""
    converted_employee_id: Optional[str] = None
    created_at: Optional[str] = None
    updated_at: Optional[str] = None

class InternListResponse(BaseModel):
    total: int
    page: int
    limit: int
    interns: List[InternResponse]
