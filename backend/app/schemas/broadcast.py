from datetime import datetime
from typing import Optional, List, Dict, Any
from pydantic import BaseModel, Field, EmailStr, field_validator
from enum import Enum
from app.utils.sanitize import sanitize_rich_text


class BroadcastAudienceType(str, Enum):
    ALL_EMPLOYEES = "ALL_EMPLOYEES"
    DEPARTMENT = "DEPARTMENT"
    BRANCH = "BRANCH"
    CUSTOM_LIST = "CUSTOM_LIST"  # specific employees, e.g. a personal message


class BroadcastPriority(str, Enum):
    INFO = "INFO"
    IMPORTANT = "IMPORTANT"
    POLICY_UPDATE = "POLICY_UPDATE"
    CRITICAL_EMERGENCY = "CRITICAL_EMERGENCY"


class CreateBroadcastRequest(BaseModel):
    title: str = Field(..., min_length=3, max_length=200)
    rich_html_content: str = Field(..., min_length=5, max_length=50_000)
    priority: BroadcastPriority = BroadcastPriority.INFO
    audience_type: BroadcastAudienceType = BroadcastAudienceType.ALL_EMPLOYEES
    target_departments: Optional[List[str]] = Field(default_factory=list)
    target_branches: Optional[List[str]] = Field(default_factory=list)
    target_employee_ids: Optional[List[str]] = Field(default_factory=list)
    requires_acknowledgment: bool = False
    send_email: bool = True
    expiry_date: Optional[str] = None

    @field_validator("title")
    @classmethod
    def _title(cls, v):
        v = v.strip()
        if len(v) < 3:
            raise ValueError("The title needs at least 3 characters.")
        return v

    @field_validator("rich_html_content")
    @classmethod
    def _body(cls, v):
        # Stored and emailed as HTML: keep formatting, drop scripts, event handlers and unsafe links.
        return sanitize_rich_text(v)


class BroadcastMessage(BaseModel):
    id: Optional[str] = Field(None, alias="_id")
    broadcast_id: str
    title: str
    rich_html_content: str
    priority: BroadcastPriority
    audience_type: BroadcastAudienceType
    target_departments: List[str] = []
    target_branches: List[str] = []
    target_employee_ids: List[str] = []
    requires_acknowledgment: bool = False
    
    total_targeted_recipients: int = 0
    emails_dispatched_count: int = 0
    read_count: int = 0
    acknowledged_count: int = 0
    
    is_active: bool = True
    created_by_id: str = "ADMIN"
    created_by_name: str = "HR Admin"
    created_at: datetime = Field(default_factory=datetime.utcnow)


class BroadcastRecipientReceipt(BaseModel):
    id: Optional[str] = Field(None, alias="_id")
    broadcast_id: str
    employee_id: str
    employee_name: str
    employee_email: Optional[str] = None  # an employee without an email still gets the in-app notice
    department: str
    
    is_delivered: bool = True
    is_read: bool = False
    read_at: Optional[datetime] = None
    
    is_acknowledged: bool = False
    acknowledged_at: Optional[datetime] = None
    
    created_at: datetime = Field(default_factory=datetime.utcnow)


class InAppNotification(BaseModel):
    id: Optional[str] = Field(None, alias="_id")
    recipient_employee_id: str
    title: str
    message_preview: str
    reference_id: str
    notification_type: str = "BROADCAST"
    priority: BroadcastPriority = BroadcastPriority.INFO
    requires_action: bool = False
    is_read: bool = False
    created_at: datetime = Field(default_factory=datetime.utcnow)
