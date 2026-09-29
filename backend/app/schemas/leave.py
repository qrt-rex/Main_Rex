from datetime import datetime, date
from typing import Optional, List, Dict
from pydantic import BaseModel, Field, EmailStr, field_validator, model_validator
from enum import Enum
from app.utils.validators import require_iso_date


class LeaveTypeEnum(str, Enum):
    CASUAL = "CL"          # Casual Leave
    SICK = "SL"            # Sick Leave
    EARNED = "EL"          # Earned / Privilege Leave
    MATERNITY = "ML"       # Maternity Leave
    PATERNITY = "PL"       # Paternity Leave
    COMP_OFF = "COMP_OFF"  # Compensatory Off
    LOSS_OF_PAY = "LOP"    # Loss of Pay / Unpaid Leave


class LeaveStatus(str, Enum):
    PENDING = "PENDING"
    APPROVED = "APPROVED"
    REJECTED = "REJECTED"
    CANCELLED = "CANCELLED"


class LeaveDurationType(str, Enum):
    FULL_DAY = "FULL_DAY"
    FIRST_HALF = "FIRST_HALF"
    SECOND_HALF = "SECOND_HALF"


class LeaveBalance(BaseModel):
    id: Optional[str] = Field(None, alias="_id")
    employee_id: str
    year: int = Field(default_factory=lambda: datetime.utcnow().year)
    
    casual_leave_allocated: float = 12.0
    casual_leave_used: float = 0.0
    
    sick_leave_allocated: float = 10.0
    sick_leave_used: float = 0.0
    
    earned_leave_allocated: float = 15.0
    earned_leave_used: float = 0.0
    
    comp_off_balance: float = 0.0
    loss_of_pay_days: float = 0.0
    
    updated_at: datetime = Field(default_factory=datetime.utcnow)

    @property
    def casual_leave_available(self) -> float:
        return max(0.0, self.casual_leave_allocated - self.casual_leave_used)

    @property
    def sick_leave_available(self) -> float:
        return max(0.0, self.sick_leave_allocated - self.sick_leave_used)

    @property
    def earned_leave_available(self) -> float:
        return max(0.0, self.earned_leave_allocated - self.earned_leave_used)


class LeaveApplicationRequest(BaseModel):
    employee_id: str = ""  # ignored by /apply-own, which uses the caller's own record
    leave_type: LeaveTypeEnum
    start_date: str  # YYYY-MM-DD
    end_date: str    # YYYY-MM-DD
    duration_type: LeaveDurationType = LeaveDurationType.FULL_DAY
    reason: str = Field(..., min_length=3, max_length=500)
    medical_certificate_url: Optional[str] = None

    @field_validator("start_date", "end_date")
    @classmethod
    def _iso(cls, v, info):
        return require_iso_date(v, "Start date" if info.field_name == "start_date" else "End date")

    @model_validator(mode="after")
    def validate_date_order(self):
        if self.end_date < self.start_date:
            raise ValueError("End date cannot be earlier than start date.")
        if self.duration_type != LeaveDurationType.FULL_DAY and self.start_date != self.end_date:
            raise ValueError("A half-day leave must start and end on the same date.")
        if (date.fromisoformat(self.end_date) - date.fromisoformat(self.start_date)).days + 1 > 366:
            raise ValueError("A single leave request cannot exceed one year.")
        return self


class DepartmentConflictInfo(BaseModel):
    has_conflict: bool = False
    conflict_count: int = 0
    conflicting_colleagues: List[Dict[str, str]] = []
    understaffing_risk_level: str = "LOW"  # "LOW", "MEDIUM", "HIGH"


class LeaveRequest(BaseModel):
    id: Optional[str] = Field(None, alias="_id")
    employee_id: str
    employee_name: str
    employee_email: EmailStr
    department: str
    manager_email: Optional[EmailStr] = None
    
    leave_type: LeaveTypeEnum
    start_date: str
    end_date: str
    duration_type: LeaveDurationType = LeaveDurationType.FULL_DAY
    total_days: float
    reason: str
    medical_certificate_url: Optional[str] = None
    
    is_loss_of_pay: bool = False
    lop_days: float = 0.0
    paid_leave_days: float = 0.0
    
    status: LeaveStatus = LeaveStatus.PENDING
    applicant_role: str = ""
    approval_level: str = "HR"  # who must decide: HR (staff, sales), ADMIN (HR's own leave), SUPERADMIN (an admin's)
    action_by_id: Optional[str] = None
    action_by_name: Optional[str] = None
    action_timestamp: Optional[datetime] = None
    rejection_reason: Optional[str] = None
    
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class LeaveDecisionRequest(BaseModel):
    leave_request_id: str
    action: str = Field(..., pattern="^(APPROVE|REJECT)$")
    remarks: Optional[str] = None
