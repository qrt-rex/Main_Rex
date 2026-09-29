import math
import logging
from datetime import datetime, date, time
from typing import Dict, Any, Optional, Tuple
import pytz

from pydantic import ValidationError
from app.database import get_collection, fix_id
from app.schemas.attendance import (
    TIME_FIELDS,
    AttendanceConfig,
    AttendanceRecord,
    AttendanceStatus,
    WorkMode,
    PunchInRequest,
    PunchOutRequest,
    AbsenteeismTelemetryLog,
)

logger = logging.getLogger("rexera.attendance")


class AttendanceService:
    @staticmethod
    def calculate_haversine_distance(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
        """
        Calculates great-circle distance between two coordinates in meters.
        """
        R = 6371000  # Radius of Earth in meters
        phi1 = math.radians(lat1)
        phi2 = math.radians(lat2)
        delta_phi = math.radians(lat2 - lat1)
        delta_lambda = math.radians(lon2 - lon1)

        a = (
            math.sin(delta_phi / 2.0) ** 2
            + math.cos(phi1) * math.cos(phi2) * math.sin(delta_lambda / 2.0) ** 2
        )
        c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
        return round(R * c, 2)

    @classmethod
    async def get_config(cls) -> AttendanceConfig:
        """Fetch attendance config or seed default."""
        col = get_collection("attendance_settings")
        doc = await col.find_one({"company_id": "DEFAULT"})
        if doc:
            try:
                return AttendanceConfig(**doc)
            except ValidationError as e:
                # A value saved before validation existed (e.g. "25:99") must not take attendance down:
                # fall back to the default shift timings and keep the rest of the saved settings.
                logger.warning(f"Saved attendance settings are invalid, using default shift timings: {e}")
                try:
                    return AttendanceConfig(**{k: v for k, v in doc.items() if k not in TIME_FIELDS})
                except ValidationError:
                    return AttendanceConfig()

        default_config = AttendanceConfig()
        await col.insert_one(default_config.model_dump())
        return default_config

    @classmethod
    def _parse_time_str(cls, time_str: str) -> time:
        parts = [int(p) for p in time_str.split(":")]
        return time(hour=parts[0], minute=parts[1])

    @classmethod
    async def resolve_employee(cls, employee_ref: str) -> Optional[Dict[str, Any]]:
        """Find an employee by legacy employee_id, employee code, or record id."""
        emp_col = get_collection("employees")
        for key in ("employee_id", "employee_code", "_id"):
            emp = await emp_col.find_one({key: employee_ref})
            if emp:
                return emp
        return None

    @classmethod
    def _get_local_now(cls, tz_name: str) -> datetime:
        try:
            tz = pytz.timezone(tz_name)
            return datetime.now(tz)
        except Exception:
            return datetime.now()

    @classmethod
    async def validate_location_and_network(
        cls,
        config: AttendanceConfig,
        emp_work_mode: WorkMode,
        lat: Optional[float],
        lon: Optional[float],
        client_ip: Optional[str]
    ) -> Tuple[bool, Optional[float], Optional[str]]:
        """
        Validates Geofencing & IP Whitelisting (Bypassed for Remote/WFH employees).
        """
        if emp_work_mode in [WorkMode.REMOTE, WorkMode.FIELD]:
            return True, 0.0, None

        distance = None
        if config.geofence_enabled:
            if lat is None or lon is None:
                return False, None, "GPS coordinates are mandatory for Office attendance punch-in."
            
            distance = cls.calculate_haversine_distance(
                lat, lon, config.office_latitude, config.office_longitude
            )
            if distance > config.allowed_radius_meters:
                return False, distance, (
                    f"Geofence violation: You are {distance}m away from the office. "
                    f"Maximum permitted radius is {config.allowed_radius_meters}m."
                )

        if config.ip_whitelisting_enabled:
            if not client_ip or client_ip not in config.whitelisted_ips:
                return False, distance, f"Unauthorized network IP ({client_ip}). Must connect to Office Wi-Fi."

        return True, distance, None

    @classmethod
    async def process_punch_in(
        cls,
        payload: PunchInRequest,
        skip_location: bool = False
    ) -> Dict[str, Any]:
        """
        Atomic punch-in engine with timezone evaluation and status classification.
        """
        config = await cls.get_config()
        att_col = get_collection("attendance")

        # 1. Fetch Employee Details
        emp = await cls.resolve_employee(payload.employee_id)
        if not emp:
            raise ValueError(f"Employee ID {payload.employee_id} not found.")
        if not emp.get("email"):
            raise ValueError("This employee has no email address on file; add one before recording attendance.")

        emp_id = emp.get("employee_code") or emp.get("employee_id") or str(emp.get("_id"))
        work_mode = WorkMode(emp.get("work_mode", WorkMode.OFFICE))
        local_now = cls._get_local_now(config.timezone)
        today_str = local_now.strftime("%Y-%m-%d")

        # 2. Prevent Duplicate Punch-In
        existing = await att_col.find_one({
            "employee_id": emp_id,
            "attendance_date": today_str
        })
        if existing and existing.get("punch_in_time"):
            raise ValueError(f"Duplicate punch-in: Attendance already recorded for {today_str} at {existing.get('punch_in_local')}.")

        # 3. Geofence & IP Whitelist Verification
        if skip_location:  # Sales Start Day: field staff have no office GPS/IP to check
            is_valid, distance, err_msg = True, None, None
        else:
            is_valid, distance, err_msg = await cls.validate_location_and_network(
                config, work_mode, payload.latitude, payload.longitude, payload.client_ip
            )
        if not is_valid:
            raise PermissionError(err_msg)

        # 4. Time Window Classification Logic
        current_time = local_now.time()
        shift_start = cls._parse_time_str(config.shift_start_time)
        grace_cutoff = cls._parse_time_str(config.grace_cutoff_time)
        late_cutoff = cls._parse_time_str(config.late_cutoff_time)

        status = AttendanceStatus.PRESENT
        is_late = False
        is_half_day = False
        half_day_reason = None
        
        # Calculate login delay past shift start (09:00 AM) in minutes
        shift_dt = datetime.combine(local_now.date(), shift_start)
        now_dt = datetime.combine(local_now.date(), current_time)
        delay_minutes = max(0, int((now_dt - shift_dt).total_seconds() / 60))

        if current_time <= grace_cutoff:
            status = AttendanceStatus.PRESENT
        elif grace_cutoff < current_time <= late_cutoff:
            status = AttendanceStatus.LATE
            is_late = True
        else:
            status = AttendanceStatus.HALF_DAY
            is_half_day = True
            half_day_reason = f"Late arrival after {config.late_cutoff_time}"

        # 5. Check "Rule of 3 Lates"
        is_third_late = False
        penalty_notes = None
        if is_late and config.enable_three_lates_penalty:
            month_prefix = today_str[:7]
            prior_lates = await att_col.count_documents({
                "employee_id": emp_id,
                "attendance_date": {"$regex": f"^{month_prefix}"},
                "is_late": True
            })
            total_lates_including_today = prior_lates + 1
            if total_lates_including_today >= config.lates_threshold:
                is_third_late = True
                if config.penalty_type == "DEDUCT_CL":
                    penalty_notes = f"3rd Late mark in {month_prefix}. 1 Casual Leave (CL) marked for deduction."
                else:
                    status = AttendanceStatus.HALF_DAY
                    is_half_day = True
                    half_day_reason = f"Converted to Half-Day (Accumulated {total_lates_including_today} late arrivals this month)."

        # 6. Construct and Insert Record
        record = AttendanceRecord(
            employee_id=emp_id,
            employee_name=emp.get("full_name", "Unknown"),
            employee_email=emp.get("email"),
            department=emp.get("department", "General"),
            work_mode=work_mode,
            attendance_date=today_str,
            punch_in_time=datetime.utcnow(),
            punch_in_local=local_now.strftime("%I:%M:%S %p"),
            status=status,
            is_late=is_late,
            late_minutes=delay_minutes,
            is_half_day=is_half_day,
            half_day_reason=half_day_reason,
            punch_in_ip=payload.client_ip,
            punch_in_lat=payload.latitude,
            punch_in_lon=payload.longitude,
            distance_from_office_meters=distance,
            geofence_verified=True if distance is not None and distance <= config.allowed_radius_meters else False,
            is_third_late_penalty_applied=is_third_late,
            penalty_details=penalty_notes
        )

        record_dict = record.dict(by_alias=True)
        if existing:
            await att_col.update_one({"_id": existing["_id"]}, {"$set": record_dict})
            record_dict["_id"] = str(existing["_id"])
        else:
            insert_res = await att_col.insert_one(record_dict)
            record_dict["_id"] = str(insert_res.inserted_id)

        # 7. Extract Telemetry for Predictive Absenteeism
        telemetry = AbsenteeismTelemetryLog(
            employee_id=emp_id,
            department=emp.get("department", "General"),
            record_date=today_str,
            day_of_week=local_now.weekday(),
            is_monday_or_friday=local_now.weekday() in [0, 4],
            is_adjacent_to_holiday=False,
            login_delay_minutes=delay_minutes,
            status=status.value,
            historical_lates_past_30d=await att_col.count_documents({
                "employee_id": emp_id,
                "is_late": True
            }),
            rolling_attendance_rate=95.0
        )
        await get_collection("absenteeism_telemetry").insert_one(telemetry.dict())

        return {
            "record": fix_id(record_dict),
            "event_type": "PUNCH_IN",
            "trigger_late_warning": is_late,
            "trigger_half_day_alert": is_half_day,
            "is_third_late": is_third_late,
            "config": config
        }

    @classmethod
    async def process_punch_out(
        cls,
        payload: PunchOutRequest
    ) -> Dict[str, Any]:
        """
        Process Punch-Out and apply Early Logout Half-Day downgrade if before 04:00 PM.
        """
        config = await cls.get_config()
        att_col = get_collection("attendance")

        local_now = cls._get_local_now(config.timezone)
        today_str = local_now.strftime("%Y-%m-%d")

        # Punch-in stores the employee code; accept the same references punch-in does.
        emp = await cls.resolve_employee(payload.employee_id)
        emp_id = (emp.get("employee_code") or emp.get("employee_id") or str(emp.get("_id"))) if emp else payload.employee_id
        existing = await att_col.find_one({
            "employee_id": emp_id,
            "attendance_date": today_str
        })
        if not existing or not existing.get("punch_in_time"):
            raise ValueError("Cannot punch out without an active punch-in for today.")

        if existing.get("punch_out_time"):
            raise ValueError(f"Already punched out today at {existing.get('punch_out_local')}.")

        current_time = local_now.time()
        early_logout_cutoff = cls._parse_time_str(config.early_logout_cutoff_time)
        
        punch_in_utc = existing.get("punch_in_time")
        if isinstance(punch_in_utc, str):
            punch_in_utc = datetime.fromisoformat(punch_in_utc)
        
        utc_now = datetime.utcnow()
        duration_seconds = (utc_now - punch_in_utc).total_seconds()
        work_minutes = max(0, int(duration_seconds / 60))
        work_hours = round(work_minutes / 60.0, 2)

        is_downgraded_to_half_day = False
        new_status = existing.get("status")
        half_day_reason = existing.get("half_day_reason")

        if current_time < early_logout_cutoff:
            if new_status != AttendanceStatus.HALF_DAY.value:
                new_status = AttendanceStatus.HALF_DAY.value
                is_downgraded_to_half_day = True
                half_day_reason = f"Early logout before {config.early_logout_cutoff_time} ({local_now.strftime('%I:%M %p')})"

        update_fields = {
            "punch_out_time": utc_now,
            "punch_out_local": local_now.strftime("%I:%M:%S %p"),
            "total_work_minutes": work_minutes,
            "total_work_hours": work_hours,
            "status": new_status,
            "is_half_day": True if new_status == AttendanceStatus.HALF_DAY.value else existing.get("is_half_day", False),
            "half_day_reason": half_day_reason,
            "updated_at": utc_now
        }

        await att_col.update_one({"_id": existing["_id"]}, {"$set": update_fields})
        updated_doc = await att_col.find_one({"_id": existing["_id"]})

        return {
            "record": fix_id(updated_doc),
            "event_type": "PUNCH_OUT",
            "is_downgraded_to_half_day": is_downgraded_to_half_day,
            "config": config
        }
