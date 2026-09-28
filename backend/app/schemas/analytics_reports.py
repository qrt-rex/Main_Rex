from datetime import datetime, date
from typing import Optional, List, Dict, Any
from pydantic import BaseModel, Field, EmailStr, field_validator, model_validator
from enum import Enum


class DateRangePreset(str, Enum):
    THIS_MONTH = "THIS_MONTH"
    LAST_MONTH = "LAST_MONTH"
    THIS_QUARTER = "THIS_QUARTER"
    YEAR_TO_DATE = "YEAR_TO_DATE"
    CUSTOM = "CUSTOM"


class ExportFormat(str, Enum):
    PDF = "PDF"
    EXCEL = "EXCEL"
    CSV = "CSV"


class ReportScope(str, Enum):
    INDIVIDUAL = "INDIVIDUAL"
    COMPANY_WIDE = "COMPANY_WIDE"


class ChartDataset(BaseModel):
    label: str
    data: List[float]
    backgroundColor: Optional[List[str]] = None
    borderColor: Optional[str] = None
    fill: bool = False


class ChartDataPayload(BaseModel):
    labels: List[str]
    datasets: List[ChartDataset]


class TrendIndicator(BaseModel):
    metric_name: str
    current_value: float
    previous_value: float
    delta_percentage: float
    direction: str  # "UP", "DOWN", "FLAT"
    is_positive_trend: bool


class PerformanceScoreBreakdown(BaseModel):
    overall_score: float
    grade: str
    attendance_score: float
    productivity_hours_score: float
    task_completion_score: float
    blocker_mitigation_score: float


class IndividualPerformanceReport(BaseModel):
    employee_id: str
    employee_name: str
    department: str
    designation: str
    date_range_label: str
    start_date: str
    end_date: str
    
    score_card: PerformanceScoreBreakdown
    total_present_days: int
    total_late_days: int
    total_absent_days: int
    total_leave_days: float
    total_client_hours_logged: float
    average_daily_hours: float
    
    productivity_trend: TrendIndicator
    attendance_trend: TrendIndicator
    
    tasks_total: int
    tasks_completed: int
    tasks_in_progress: int
    tasks_blocked: int
    task_completion_rate: float
    
    daily_hours_chart: ChartDataPayload
    task_distribution_chart: ChartDataPayload


class DepartmentEfficiencyMetric(BaseModel):
    department: str
    headcount: int
    total_hours_logged: float
    avg_hours_per_employee: float
    average_performance_score: float
    tasks_completed_count: int
    active_blockers_count: int


class CompanyWidePerformanceReport(BaseModel):
    company_name: str = "Rexera Technologies"
    date_range_label: str
    start_date: str
    end_date: str
    total_active_employees: int
    total_hours_billed_clients: float
    company_wide_efficiency_rate: float
    company_avg_performance_score: float
    
    overall_hours_trend: TrendIndicator
    department_metrics: List[DepartmentEfficiencyMetric]
    client_billing_chart: ChartDataPayload
    blocker_categories_chart: ChartDataPayload
    top_critical_bottlenecks: List[Dict[str, Any]]


class ReportGenerationJob(BaseModel):
    id: Optional[str] = Field(None, alias="_id")
    job_id: str
    scope: ReportScope
    format: ExportFormat
    employee_id: Optional[str] = None
    status: str = "PROCESSING"  # PROCESSING, COMPLETED, FAILED
    download_url: Optional[str] = None
    file_name: Optional[str] = None
    error: Optional[str] = None
    requested_by: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
    completed_at: Optional[datetime] = None


class ReportExportRequest(BaseModel):
    scope: ReportScope
    export_format: ExportFormat
    employee_id: Optional[str] = None
    preset: DateRangePreset = DateRangePreset.THIS_MONTH
    start_date: Optional[str] = None
    end_date: Optional[str] = None

    @field_validator("scope", mode="before")
    @classmethod
    def _scope_alias(cls, v):
        # The CRM sends "COMPANY"; the API name is COMPANY_WIDE.
        return ReportScope.COMPANY_WIDE if str(v).upper() == "COMPANY" else v

    @model_validator(mode="after")
    def _needs_employee(self):
        if self.scope == ReportScope.INDIVIDUAL and not (self.employee_id or "").strip():
            raise ValueError("Choose an employee for an individual report.")
        return self
