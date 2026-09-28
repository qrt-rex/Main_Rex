from datetime import datetime
from typing import Optional, List, Dict, Any
from pydantic import BaseModel, Field, EmailStr
from enum import Enum


class ImportTargetEntity(str, Enum):
    EMPLOYEES = "EMPLOYEES"
    LEAVE_BALANCES = "LEAVE_BALANCES"
    CLIENT_PROJECTS = "CLIENT_PROJECTS"
    ATTENDANCE_LOGS = "ATTENDANCE_LOGS"


class ImportJobStatus(str, Enum):
    PENDING = "PENDING"
    PROCESSING = "PROCESSING"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"


class ColumnMappingSuggestion(BaseModel):
    file_header: str
    suggested_db_field: Optional[str] = None
    confidence_score: float = 0.0
    is_required: bool = False
    sample_values: List[str] = []


class ImportPreviewResponse(BaseModel):
    file_id: str
    file_name: str
    total_rows_detected: int
    target_entity: ImportTargetEntity
    mappings: List[ColumnMappingSuggestion]
    available_db_fields: List[Dict[str, Any]]
    sample_data: List[Dict[str, Any]]


class ExecuteImportRequest(BaseModel):
    file_id: str
    target_entity: ImportTargetEntity
    confirmed_mappings: Dict[str, str]
    dry_run_only: bool = False
    unique_key_field: str = "employee_code"


class ImportJobSummary(BaseModel):
    id: Optional[str] = Field(None, alias="_id")
    job_id: str
    target_entity: ImportTargetEntity
    status: ImportJobStatus = ImportJobStatus.PENDING
    progress_percentage: int = 0
    total_rows: int = 0
    inserted_count: int = 0
    updated_count: int = 0
    failed_count: int = 0
    is_dry_run: bool = False
    error_report_file_url: Optional[str] = None
    initiated_by: EmailStr = "hr@rexera.co.in"
    created_at: datetime = Field(default_factory=datetime.utcnow)
    completed_at: Optional[datetime] = None


TARGET_SCHEMA_REGISTRY: Dict[ImportTargetEntity, Dict[str, Any]] = {
    ImportTargetEntity.EMPLOYEES: {
        "unique_keys": ["employee_code", "email"],
        "fields": {
            "employee_code": {"label": "Employee ID", "required": False, "type": "str", "aliases": ["empid", "emp_id", "employee_id", "id", "staff_id", "code"]},
            "full_name": {"label": "Full Name", "required": True, "type": "str", "aliases": ["name", "emp_name", "employee_name", "fullname"]},
            "email": {"label": "Email Address", "required": True, "type": "email", "aliases": ["mail", "email_id", "work_email", "official_email"]},
            "department": {"label": "Department", "required": True, "type": "str", "aliases": ["dept", "division", "team", "unit"]},
            "designation": {"label": "Designation", "required": True, "type": "str", "aliases": ["role", "job_title", "position", "title"]},
            "mobile_number": {"label": "Mobile Number", "required": False, "type": "phone", "aliases": ["phone", "mobile", "contact", "phone_number", "cell"]},
            "date_of_joining": {"label": "Date of Joining", "required": False, "type": "date", "aliases": ["joining_date", "doj", "start_date"]},
            "base_salary": {"label": "Base Salary", "required": False, "type": "float", "aliases": ["basic", "basic_salary", "ctc", "gross"]},
            "hra": {"label": "HRA", "required": False, "type": "float", "aliases": ["house_rent_allowance"]},
            "conveyance_allowance": {"label": "Conveyance Allowance", "required": False, "type": "float", "aliases": ["conveyance", "transport_allowance"]},
            "special_allowance": {"label": "Special Allowance", "required": False, "type": "float", "aliases": ["special"]},
            "bank_name": {"label": "Bank Name", "required": False, "type": "str", "aliases": ["bank"]},
            "account_no": {"label": "Bank Account Number", "required": False, "type": "str", "aliases": ["account_number", "acc_no", "bank_account"]},
            "ifsc_code": {"label": "IFSC Code", "required": False, "type": "ifsc", "aliases": ["ifsc"]},
            "reporting_manager": {"label": "Reporting Manager", "required": False, "type": "str", "aliases": ["manager", "reports_to"]}
        }
    },
    ImportTargetEntity.LEAVE_BALANCES: {
        "unique_keys": ["employee_id"],
        "fields": {
            "employee_id": {"label": "Employee ID", "required": True, "type": "str", "aliases": ["empid", "emp_id", "code"]},
            "casual_leave_allocated": {"label": "Casual Leave (CL)", "required": False, "type": "float", "aliases": ["cl", "casual_leave", "cl_balance"]},
            "sick_leave_allocated": {"label": "Sick Leave (SL)", "required": False, "type": "float", "aliases": ["sl", "sick_leave", "sl_balance"]},
            "earned_leave_allocated": {"label": "Earned Leave (EL)", "required": False, "type": "float", "aliases": ["el", "pl", "earned_leave", "privilege_leave"]}
        }
    }
}
