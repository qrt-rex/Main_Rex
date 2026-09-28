from typing import List, Dict, Any, Optional
from pydantic import BaseModel

class StatusCount(BaseModel):
    status: str
    count: int

class DepartmentCount(BaseModel):
    department: str
    count: int

class RecentActivityItem(BaseModel):
    id: str
    type: str  # candidate, employee, intern, onboarding, payroll
    title: str
    description: str
    timestamp: str
    status: Optional[str] = None
    icon: Optional[str] = None

class DashboardMetricsResponse(BaseModel):
    total_candidates: int
    active_employees: int
    active_interns: int
    pending_onboarding: int
    total_payroll_processed: float
    candidates_by_status: List[StatusCount]
    employees_by_department: List[DepartmentCount]
    recent_activities: List[RecentActivityItem]
    upcoming_interviews: List[Dict[str, Any]]

    # Per-HR metrics
    my_total_candidates: int = 0
    my_onboarding: int = 0
    my_pending_onboarding: int = 0
    hr_name: str = ""
    # Live notification feed: candidate status changes & onboarding completions
    notifications: List[Dict[str, Any]] = []

    # Advanced Module Aggregations
    attendance_summary: Optional[Dict[str, Any]] = None
    leaves_summary: Optional[Dict[str, Any]] = None
    productivity_summary: Optional[Dict[str, Any]] = None
    broadcasts_summary: Optional[Dict[str, Any]] = None
    performance_summary: Optional[Dict[str, Any]] = None
    advances_summary: Optional[Dict[str, Any]] = None
