from datetime import datetime, date, timedelta
from typing import Optional
from pydantic import BaseModel, Field, EmailStr, field_validator
from enum import Enum
from app.utils.validators import parse_iso_date


class TaskStatus(str, Enum):
    TO_DO = "TO_DO"
    IN_PROGRESS = "IN_PROGRESS"
    UNDER_REVIEW = "UNDER_REVIEW"
    COMPLETED = "COMPLETED"
    BLOCKED = "BLOCKED"


class BlockerCategory(str, Enum):
    WAITING_CLIENT_APPROVAL = "WAITING_CLIENT_APPROVAL"
    MISSING_ASSETS_SPEC = "MISSING_ASSETS_SPEC"
    SERVER_INFRA_ISSUE = "SERVER_INFRA_ISSUE"
    DEPENDENCY_ON_TEAM = "DEPENDENCY_ON_TEAM"
    BUDGET_SCOPE_CREEP = "BUDGET_SCOPE_CREEP"
    OTHER = "OTHER"


class ProjectStatus(str, Enum):
    PLANNING = "PLANNING"
    ACTIVE = "ACTIVE"
    ON_HOLD = "ON_HOLD"
    COMPLETED = "COMPLETED"


class UtilizationHealthStatus(str, Enum):
    OPTIMAL = "OPTIMAL"
    UNDERUTILIZED = "UNDERUTILIZED"
    OVERLOADED = "OVERLOADED"
    BURNOUT_RISK = "BURNOUT_RISK"


class Client(BaseModel):
    id: Optional[str] = Field(None, alias="_id")
    client_name: str
    company_name: str
    contact_email: EmailStr
    account_manager_id: Optional[str] = None
    is_active: bool = True
    created_at: datetime = Field(default_factory=datetime.utcnow)


class Project(BaseModel):
    id: Optional[str] = Field(None, alias="_id")
    project_name: str
    client_id: str
    client_name: str
    project_manager_id: Optional[str] = None
    project_manager_name: str = "Manager"
    project_manager_email: EmailStr = "hr@rexera.co.in"
    status: ProjectStatus = ProjectStatus.ACTIVE
    budget_hours: float = 0.0
    logged_hours_total: float = 0.0
    start_date: str = Field(default_factory=lambda: datetime.utcnow().strftime("%Y-%m-%d"))
    deadline: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)


class ProjectTask(BaseModel):
    id: Optional[str] = Field(None, alias="_id")
    project_id: str
    project_name: str
    client_id: Optional[str] = None
    client_name: str = "General"
    task_title: str
    assigned_to_id: str
    assigned_to_name: str
    assigned_to_email: Optional[EmailStr] = None
    estimated_hours: float = 0.0
    actual_hours_logged: float = 0.0
    status: TaskStatus = TaskStatus.TO_DO
    
    is_blocked: bool = False
    blocker_category: Optional[BlockerCategory] = None
    blocker_reason: Optional[str] = None
    blocked_at: Optional[datetime] = None
    blocked_by_name: Optional[str] = None
    
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class LogTimesheetRequest(BaseModel):
    employee_id: str
    task_id: str
    work_date: str  # YYYY-MM-DD
    hours_spent: float = Field(..., gt=0.0, le=24.0)
    work_description: str = Field(..., min_length=3, max_length=1000)
    task_new_status: Optional[TaskStatus] = None

    @field_validator("work_date")
    @classmethod
    def _work_date(cls, v):
        d = parse_iso_date(v, "Work date")
        # One day of slack for time zones; hours can't be logged for work that hasn't happened.
        if d > date.today() + timedelta(days=1):
            raise ValueError("Hours cannot be logged for a future date.")
        return d.isoformat()


class FlagBlockerRequest(BaseModel):
    task_id: str
    employee_id: str
    blocker_category: BlockerCategory
    blocker_reason: str = Field(..., min_length=5, max_length=1000)


class TimesheetEntry(BaseModel):
    id: Optional[str] = Field(None, alias="_id")
    employee_id: str
    employee_name: str
    department: str
    task_id: str
    task_title: str
    project_id: str
    project_name: str
    client_id: str
    client_name: str
    work_date: str
    hours_spent: float
    work_description: str
    created_at: datetime = Field(default_factory=datetime.utcnow)
