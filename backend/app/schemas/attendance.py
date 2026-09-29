from datetime import datetime
from typing import Literal, Optional, List, Dict, Any
import pytz
from pydantic import BaseModel, Field, EmailStr, field_validator, model_validator
from enum import Enum
from app.utils.validators import require_hhmm


class AttendanceStatus(str, Enum):
    PRESENT = "PRESENT"
    LATE = "LATE"
    HALF_DAY = "HALF_DAY"
    ABSENT = "ABSENT"
    ON_LEAVE = "ON_LEAVE"
    HOLIDAY = "HOLIDAY"
    WEEK_OFF = "WEEK_OFF"


class WorkMode(str, Enum):
    OFFICE = "OFFICE"
    REMOTE = "REMOTE"
    HYBRID = "HYBRID"
    FIELD = "FIELD"


TIME_FIELDS = ("shift_start_time", "grace_cutoff_time", "late_cutoff_time", "early_logout_cutoff_time", "shift_end_time")


class AttendanceConfig(BaseModel):
    company_id: str = "DEFAULT"
    timezone: str = "Asia/Kolkata"

    # Timing Thresholds (24-hour HH:MM, same day)
    shift_start_time: str = "09:00"
    grace_cutoff_time: str = "09:45"
    late_cutoff_time: str = "11:15"
    early_logout_cutoff_time: str = "16:00"
    shift_end_time: str = "18:00"

    # Geofencing & Network Parameters
    geofence_enabled: bool = True
    office_latitude: float = Field(default=28.535517, ge=-90, le=90)
    office_longitude: float = Field(default=77.391029, ge=-180, le=180)
    allowed_radius_meters: float = Field(default=100.0, ge=0, le=100_000)
    ip_whitelisting_enabled: bool = False
    whitelisted_ips: List[str] = Field(default_factory=lambda: ["127.0.0.1", "192.168.1.1"])

    # Rule of 3 Lates Policy
    enable_three_lates_penalty: bool = True
    lates_threshold: int = Field(default=3, ge=1, le=31)
    penalty_type: Literal["DEDUCT_CL", "MARK_HALF_DAY"] = "DEDUCT_CL"

    # Notification Toggles
    send_late_warning_to_employee: bool = True
    send_half_day_alert_to_hr: bool = True
    hr_notification_email: EmailStr = "hr@rexera.co.in"

    updated_at: datetime = Field(default_factory=datetime.utcnow)
    updated_by: Optional[str] = "SYSTEM"

    @field_validator(*TIME_FIELDS)
    @classmethod
    def _hhmm(cls, v, info):
        return require_hhmm(v, info.field_name.replace("_time", "").replace("_", " ").capitalize())

    @field_validator("timezone")
    @classmethod
    def _tz(cls, v):
        try:
            pytz.timezone(v)
        except Exception:
            raise ValueError(f"Unknown timezone: {v}") from None
        return v

    @model_validator(mode="after")
    def _ordered(self):
        start, grace, late = self.shift_start_time, self.grace_cutoff_time, self.late_cutoff_time
        early, end = self.early_logout_cutoff_time, self.shift_end_time
        # Zero-padded HH:MM strings compare in time order.
        # (shift_end_time isn't editable in either UI, so it isn't used to reject a save.)
        if not start < end:
            raise ValueError("Shift end must be after shift start.")
        if not start <= grace:
            raise ValueError("Grace cutoff cannot be earlier than the shift start.")
        if not grace <= late:
            raise ValueError("Late (half-day) cutoff cannot be earlier than the grace cutoff.")
        if not start < early:
            raise ValueError("Early-logout cutoff must be after the shift start.")
        return self


class PunchInRequest(BaseModel):
    employee_id: str
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    client_ip: Optional[str] = None
    device_info: Optional[Dict[str, Any]] = None
    remarks: Optional[str] = None


class PunchOutRequest(BaseModel):
    employee_id: str
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    client_ip: Optional[str] = None
    remarks: Optional[str] = None


class AttendanceRecord(BaseModel):
    id: Optional[str] = Field(None, alias="_id")
    employee_id: str
    employee_name: str
    employee_email: EmailStr
    department: str
    work_mode: WorkMode = WorkMode.OFFICE
    attendance_date: str  # YYYY-MM-DD
    
    punch_in_time: Optional[datetime] = None
    punch_out_time: Optional[datetime] = None
    punch_in_local: Optional[str] = None
    punch_out_local: Optional[str] = None
    
    status: AttendanceStatus = AttendanceStatus.PRESENT
    is_late: bool = False
    late_minutes: int = 0
    is_half_day: bool = False
    half_day_reason: Optional[str] = None
    
    total_work_minutes: int = 0
    total_work_hours: float = 0.0
    
    punch_in_ip: Optional[str] = None
    punch_in_lat: Optional[float] = None
    punch_in_lon: Optional[float] = None
    distance_from_office_meters: Optional[float] = None
    geofence_verified: bool = False
    
    is_third_late_penalty_applied: bool = False
    penalty_details: Optional[str] = None
    remarks: Optional[str] = None
    
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class AbsenteeismTelemetryLog(BaseModel):
    employee_id: str
    department: str
    record_date: str
    day_of_week: int
    is_monday_or_friday: bool
    is_adjacent_to_holiday: bool
    login_delay_minutes: int
    status: str
    historical_lates_past_30d: int
    rolling_attendance_rate: float
    timestamp: datetime = Field(default_factory=datetime.utcnow)
