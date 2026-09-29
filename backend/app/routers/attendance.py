from datetime import datetime
from fastapi import APIRouter, HTTPException, BackgroundTasks, Request, Depends, Query, status
from typing import Dict, Any, Optional

from app.schemas.attendance import (
    PunchInRequest,
    PunchOutRequest,
    AttendanceConfig,
)
from app.services.attendance_service import AttendanceService
from app.services.attendance_alert_worker import AttendanceAlertWorker
from app.services.auth_service import get_current_user
from app.services.rbac_service import sees_all_attendance
from app.services.broadcast_service import BroadcastService
from app.database import get_collection, fix_ids

router = APIRouter(prefix="/api/attendance", tags=["Attendance & Time Tracking"])

STATUSES = ("PRESENT", "LATE", "HALF_DAY", "ABSENT", "ON_LEAVE", "HOLIDAY", "WEEK_OFF")


def summarise(docs) -> Dict[str, Any]:
    """Days counted per status, overall and per employee, for whatever range was asked for."""
    totals = {s: 0 for s in STATUSES}
    people: Dict[str, Dict[str, Any]] = {}
    for d in docs:
        s = d.get("status") if d.get("status") in totals else None
        p = people.setdefault(d.get("employee_id") or "?", {"employee_id": d.get("employee_id"), "employee_name": d.get("employee_name"),
                                                              "department": d.get("department"), "hours": 0.0, **{k: 0 for k in STATUSES}})
        if s:
            totals[s] += 1
            p[s] += 1
        p["hours"] = round(p["hours"] + float(d.get("total_work_hours") or 0), 2)
    return {"records": len(docs), "employees": len(people), "totals": totals,
            "by_employee": sorted(people.values(), key=lambda p: (p.get("employee_name") or "").lower())}


@router.get("", status_code=status.HTTP_200_OK)
@router.get("/", status_code=status.HTTP_200_OK)
async def list_attendance_records(
    date_str: Optional[str] = Query(None, pattern=r"^\d{4}-\d{2}-\d{2}$"),
    month: Optional[str] = Query(None, pattern=r"^\d{4}-\d{2}$"),
    date_from: Optional[str] = Query(None, pattern=r"^\d{4}-\d{2}-\d{2}$"),
    date_to: Optional[str] = Query(None, pattern=r"^\d{4}-\d{2}-\d{2}$"),
    employee_id: Optional[str] = None,
    limit: int = Query(500, ge=1, le=5000),
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """List attendance records with filters. Only HR, Admin and Super Admin see other people's records."""
    att_col = get_collection("attendance")
    filter_q: Dict[str, Any] = {}
    if not sees_all_attendance(current_user):
        employee_id = await BroadcastService.employee_code_for_account(current_user)  # the caller's own code, whatever was asked
    if date_str:
        filter_q["attendance_date"] = date_str
    elif date_from or date_to:  # inclusive range: today, yesterday, this week...
        if date_from and date_to and date_to < date_from:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="The end date is before the start date.")
        filter_q["attendance_date"] = {**({"$gte": date_from} if date_from else {}), **({"$lte": date_to} if date_to else {})}
    elif month:
        filter_q["attendance_date"] = {"$regex": f"^{month}-"}
    if employee_id:
        filter_q["employee_id"] = employee_id

    total = await att_col.count_documents(filter_q)
    docs = await att_col.find(filter_q).sort("attendance_date", -1).to_list(limit)
    return {"success": True, "count": len(docs), "total": total, "data": fix_ids(docs), "summary": summarise(docs)}


@router.post("/punch-in", status_code=status.HTTP_200_OK)
async def punch_in(
    payload: PunchInRequest,
    background_tasks: BackgroundTasks,
    request: Request,
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    if not payload.client_ip:
        client_host = request.client.host if request.client else "127.0.0.1"
        payload.client_ip = request.headers.get("X-Forwarded-For", client_host).split(",")[0].strip()

    try:
        result = await AttendanceService.process_punch_in(payload)
    except PermissionError as pe:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(pe))
    except ValueError as ve:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(ve))

    rec = result["record"]
    cfg: AttendanceConfig = result["config"]

    if result.get("trigger_late_warning") and cfg.send_late_warning_to_employee:
        background_tasks.add_task(
            AttendanceAlertWorker.send_late_login_warning,
            employee_name=rec["employee_name"],
            employee_email=rec["employee_email"],
            punch_time_local=rec["punch_in_local"],
            late_minutes=rec["late_minutes"],
            is_third_late=result.get("is_third_late", False),
            penalty_details=rec.get("penalty_details")
        )

    if result.get("trigger_half_day_alert") and cfg.send_half_day_alert_to_hr:
        background_tasks.add_task(
            AttendanceAlertWorker.send_half_day_breach_alert,
            employee_name=rec["employee_name"],
            employee_email=rec["employee_email"],
            employee_id=rec["employee_id"],
            department=rec["department"],
            event_time_local=rec["punch_in_local"],
            reason=rec["half_day_reason"],
            hr_recipient=cfg.hr_notification_email
        )

    return {
        "success": True,
        "message": f"Punch-in recorded successfully as {rec['status']}.",
        "attendance": rec
    }


@router.post("/punch-out", status_code=status.HTTP_200_OK)
async def punch_out(
    payload: PunchOutRequest,
    background_tasks: BackgroundTasks,
    request: Request,
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    try:
        result = await AttendanceService.process_punch_out(payload)
    except ValueError as ve:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(ve))

    rec = result["record"]
    cfg: AttendanceConfig = result["config"]

    if result.get("is_downgraded_to_half_day") and cfg.send_half_day_alert_to_hr:
        background_tasks.add_task(
            AttendanceAlertWorker.send_half_day_breach_alert,
            employee_name=rec["employee_name"],
            employee_email=rec["employee_email"],
            employee_id=rec["employee_id"],
            department=rec["department"],
            event_time_local=rec["punch_out_local"],
            reason=rec["half_day_reason"],
            hr_recipient=cfg.hr_notification_email
        )

    return {
        "success": True,
        "message": f"Punch-out recorded at {rec['punch_out_local']}. Total Hours: {rec['total_work_hours']} hrs.",
        "attendance": rec
    }


@router.get("/config", status_code=status.HTTP_200_OK)
async def get_attendance_config(current_user: Dict[str, Any] = Depends(get_current_user)):
    return await AttendanceService.get_config()


@router.put("/config", status_code=status.HTTP_200_OK)
async def update_attendance_config(
    updated_config: AttendanceConfig,
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    col = get_collection("attendance_settings")
    doc = updated_config.model_dump()
    doc["company_id"] = "DEFAULT"  # single company-wide record
    doc["updated_at"] = datetime.utcnow()
    doc["updated_by"] = current_user.get("email", "HR_ADMIN")
    await col.update_one({"company_id": "DEFAULT"}, {"$set": doc}, upsert=True)
    return {"success": True, "message": "Attendance settings updated successfully."}
