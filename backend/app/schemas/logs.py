from typing import List, Optional, Dict, Any
from pydantic import BaseModel, Field


class LogEntry(BaseModel):
    id: str = ""
    action: str  # LOGIN, LOGOUT, SESSION_TIMEOUT, PAYROLL_INCREMENT, PAYROLL_DECREMENT, CANDIDATE_CREATE, CANDIDATE_STATUS_CHANGE, EMPLOYEE_CREATE, EMPLOYEE_UPDATE, EMPLOYEE_DELETE, etc.
    performed_by: str  # admin email or name
    performed_by_role: str = "admin"
    target: Optional[str] = ""  # e.g. employee name, candidate name
    target_id: Optional[str] = ""  # ID of the affected record
    details: Optional[Dict[str, Any]] = {}  # JSON details of the action (old/new values, etc.)
    ip_address: Optional[str] = ""
    timestamp: str = ""


class LogListResponse(BaseModel):
    total: int
    page: int
    limit: int
    logs: List[LogEntry]
