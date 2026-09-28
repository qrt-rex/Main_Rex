import logging
import re
from datetime import datetime
from typing import Dict, Any, List
from fastapi import APIRouter, Depends
from app.schemas.dashboard import DashboardMetricsResponse, StatusCount, DepartmentCount, RecentActivityItem
from app.database import get_collection
from app.services.auth_service import get_current_admin
from app.services.candidate_service import CandidateService
from app.services.employee_service import EmployeeService
from app.services.intern_service import InternService
from app.services.log_service import LogService

logger = logging.getLogger("rexera.router.dashboard")
router = APIRouter(prefix="/api/dashboard", tags=["Dashboard Metrics"])

@router.get("/metrics", response_model=DashboardMetricsResponse)
async def get_dashboard_metrics(admin: Dict[str, Any] = Depends(get_current_admin)):
    """Aggregate high-level HR, recruitment, intern, and payroll metrics for executive dashboard."""
    cand_col = get_collection("candidates")
    emp_col = get_collection("employees")
    intern_col = get_collection("interns")
    token_col = get_collection("joining_tokens")
    slip_col = get_collection("salary_slips")

    admin_email = admin.get("email", "")
    admin_role = admin.get("role", "admin")
    is_superadmin = admin_role == "superadmin"

    total_candidates = await cand_col.count_documents({})
    active_employees = await emp_col.count_documents({"employee_status": {"$in": ["Active", "Probation"]}})
    active_interns = await intern_col.count_documents({"status": {"$in": ["Active", "Ongoing"]}})
    pending_onboarding = await token_col.count_documents({"used": False})

    # Per-HR metrics
    if is_superadmin:
        my_total_candidates = total_candidates
        my_onboarding = await cand_col.count_documents({"status": {"$in": ["Selected", "Joined"]}})
        my_pending_onboarding = pending_onboarding
    else:
        my_total_candidates = await cand_col.count_documents({"assigned_hr": admin_email})
        my_onboarding = await cand_col.count_documents({"assigned_hr": admin_email, "status": {"$in": ["Selected", "Joined"]}})
        # Count pending tokens for candidates assigned to this HR
        hr_candidates = await cand_col.find({"assigned_hr": admin_email}).to_list(5000)
        hr_candidate_ids = [str(c.get("_id")) for c in hr_candidates]
        if hr_candidate_ids:
            my_pending_onboarding = await token_col.count_documents({"used": False, "candidate_id": {"$in": hr_candidate_ids}})
        else:
            my_pending_onboarding = 0

    # Total payroll amount
    all_slips = await slip_col.find({}).to_list(2000)
    total_payroll = sum(s.get("net_salary", 0.0) for s in all_slips)

    # Status distribution
    statuses = ["Applied", "Screening", "Interview Scheduled", "Interviewed", "Selected", "Rejected", "On Hold", "Joined"]
    candidates_by_status = []
    for st in statuses:
        cnt = await cand_col.count_documents({"status": st})
        candidates_by_status.append(StatusCount(status=st, count=cnt))

    # Department distribution: the departments that actually exist (a fixed list showed all zeros)
    dept_counts: Dict[str, int] = {}
    for e in await emp_col.find({"employee_status": {"$in": ["Active", "Probation"]}}, {"department": 1}).to_list(100000):
        dept = e.get("department") or "Unassigned"
        dept_counts[dept] = dept_counts.get(dept, 0) + 1
    employees_by_dept = [DepartmentCount(department=d, count=c)
                         for d, c in sorted(dept_counts.items(), key=lambda kv: (-kv[1], kv[0]))]

    # Recent activities
    recent_activities: List[RecentActivityItem] = []
    
    # Recent candidates
    recent_cands = await cand_col.find({}).sort("created_at", -1).limit(4).to_list(4)
    for c in recent_cands:
        recent_activities.append(RecentActivityItem(
            id=str(c.get("_id")),
            type="candidate",
            title=f"New Candidate Application: {c.get('candidate_name')}",
            description=f"Applied for {c.get('position_applied')} ({c.get('status')})",
            timestamp=str(c.get("created_at") or "")[:10],
            status=c.get("status"),
            icon="user-plus"
        ))

    # Recent employees
    recent_emps = await emp_col.find({}).sort("created_at", -1).limit(3).to_list(3)
    for e in recent_emps:
        recent_activities.append(RecentActivityItem(
            id=str(e.get("_id")),
            type="employee",
            title=f"Employee Onboarded: {e.get('full_name')}",
            description=f"Joined as {e.get('designation')} in {e.get('department')}",
            timestamp=str(e.get("created_at") or "")[:10],
            status=e.get("employee_status"),
            icon="briefcase"
        ))

    # Recent interns
    recent_interns = await intern_col.find({}).sort("created_at", -1).limit(3).to_list(3)
    for i in recent_interns:
        recent_activities.append(RecentActivityItem(
            id=str(i.get("_id")),
            type="intern",
            title=f"Intern Enrolled: {i.get('full_name')}",
            description=f"Role: {i.get('domain_role')} (Mentor: {i.get('assigned_mentor')})",
            timestamp=str(i.get("created_at") or "")[:10],
            status=i.get("status"),
            icon="academic-cap"
        ))

    # Notification feed: candidate status changes & onboarding completions
    notifications = await LogService.get_notifications(
        performed_by=None if is_superadmin else admin_email,
        limit=10,
    )

    # Upcoming interviews
    upcoming_cands = await cand_col.find({"status": {"$in": ["Interview Scheduled", "Screening"]}}).limit(5).to_list(5)
    upcoming_interviews = [
        {
            "id": str(c.get("_id")),
            "candidate_name": c.get("candidate_name"),
            "position": c.get("position_applied"),
            "interview_date": c.get("interview_date") or "TBD",
            "contact": c.get("contact_number"),
            "email": c.get("email"),
            "status": c.get("status")
        }
        for c in upcoming_cands
    ]

    # Advanced Module Aggregations
    today_str = datetime.now().strftime("%Y-%m-%d")
    att_col = get_collection("attendance")
    leave_col = get_collection("leave_requests")
    ts_col = get_collection("timesheets")
    task_col = get_collection("project_tasks")
    proj_col = get_collection("projects")
    bcast_col = get_collection("broadcasts")
    adv_col = get_collection("salary_advances")

    # 1. Attendance Today
    today_records = await att_col.find({"attendance_date": today_str}).to_list(1000)
    pres_cnt = sum(1 for r in today_records if r.get("status") in ["PRESENT", "Present"])
    late_cnt = sum(1 for r in today_records if r.get("status") in ["LATE", "Late"])
    half_cnt = sum(1 for r in today_records if r.get("status") in ["HALF_DAY", "Half-Day"])
    abs_cnt = sum(1 for r in today_records if r.get("status") in ["ABSENT", "Absent"])
    attendance_summary = {
        "today_date": today_str,
        "present_count": pres_cnt,
        "late_count": late_cnt,
        "half_day_count": half_cnt,
        "absent_count": abs_cnt,
        "total_punched_in": len(today_records)
    }

    # 2. Leaves Summary
    pending_leaves = await leave_col.count_documents({"status": "PENDING"})
    approved_leaves_today = await leave_col.count_documents({
        "status": "APPROVED",
        "start_date": {"$lte": today_str},
        "end_date": {"$gte": today_str}
    })
    leaves_summary = {
        "pending_requests_count": pending_leaves,
        "on_leave_today_count": approved_leaves_today
    }

    # 3. Productivity & Projects
    today_timesheets = await ts_col.find({"work_date": today_str}).to_list(2000)
    billed_today = sum(float(t.get("hours_spent", 0.0)) for t in today_timesheets)
    active_projs = await proj_col.count_documents({"status": "ACTIVE"})
    red_blockers = await task_col.count_documents({"status": "BLOCKED"})
    productivity_summary = {
        "billed_hours_today": round(billed_today, 1),
        "active_projects_count": active_projs,
        "red_zone_blockers_count": red_blockers
    }

    # 4. Broadcasts & Alerts
    active_bcasts = await bcast_col.find({"is_active": True}).sort("created_at", -1).limit(5).to_list(5)
    broadcasts_summary = {
        "active_broadcasts_count": len(active_bcasts),
        "latest_title": active_bcasts[0].get("title") if active_bcasts else "None"
    }

    # 5. Advances & Loans (loans live in their own collection)
    active_loans = await get_collection("employee_loans").count_documents({"status": "Active"})
    active_advs = await adv_col.count_documents({"status": {"$in": ["Approved", "Partially Paid"]}})
    advances_summary = {
        "active_loans_count": active_loans,
        "active_advances_count": active_advs
    }

    return DashboardMetricsResponse(
        total_candidates=total_candidates,
        active_employees=active_employees,
        active_interns=active_interns,
        pending_onboarding=pending_onboarding,
        total_payroll_processed=round(total_payroll, 2),
        candidates_by_status=candidates_by_status,
        employees_by_department=employees_by_dept,
        recent_activities=recent_activities,
        upcoming_interviews=upcoming_interviews,
        my_total_candidates=my_total_candidates,
        my_onboarding=my_onboarding,
        my_pending_onboarding=my_pending_onboarding,
        hr_name=admin.get("username", admin_email),
        notifications=notifications,
        attendance_summary=attendance_summary,
        leaves_summary=leaves_summary,
        productivity_summary=productivity_summary,
        broadcasts_summary=broadcasts_summary,
        advances_summary=advances_summary
    )

@router.get("/export-all")
async def export_all_system_data(admin: Dict[str, Any] = Depends(get_current_admin)):
    """Export complete dataset across all modules (Employees, Interns, Candidates, Payroll Slips)."""
    emp_col = get_collection("employees")
    intern_col = get_collection("interns")
    cand_col = get_collection("candidates")
    slip_col = get_collection("salary_slips")

    employees = await emp_col.find({}).to_list(5000)
    interns = await intern_col.find({}).to_list(5000)
    candidates = await cand_col.find({}).to_list(5000)
    slips = await slip_col.find({}).to_list(5000)

    # Clean ObjectIds
    def sanitize(docs):
        res = []
        for d in docs:
            item = dict(d)
            if "_id" in item:
                item["id"] = str(item["_id"])
                item["_id"] = str(item["_id"])
            res.append(item)
        return res

    await LogService.create_log(
        action="BACKUP_EXPORT",
        performed_by=admin.get("email", ""),
        performed_by_role=admin.get("role", ""),
        target="full dataset",
        details={"message": f"Exported {len(employees)} employees, {len(interns)} interns, {len(candidates)} candidates"},
    )

    return {
        "success": True,
        "exported_at": datetime.utcnow().isoformat(),
        "employees": sanitize(employees),
        "interns": sanitize(interns),
        "candidates": sanitize(candidates),
        "salary_slips": sanitize(slips)
    }

@router.post("/import-all")
async def import_all_system_data(
    payload: Dict[str, Any],
    admin: Dict[str, Any] = Depends(get_current_admin)
):
    """Import and merge full system dataset from backup JSON / multi-sheet workbook."""
    emp_col = get_collection("employees")
    intern_col = get_collection("interns")
    cand_col = get_collection("candidates")

    imported_stats = {"employees": 0, "interns": 0, "candidates": 0}
    skipped = 0

    def same(field: str, value: str) -> Dict[str, Any]:
        return {field: {"$regex": f"^{re.escape(str(value).strip())}$", "$options": "i"}}

    def clean(doc: Dict[str, Any]) -> Dict[str, Any]:
        doc = {k: v for k, v in doc.items() if isinstance(k, str) and k not in ("_id", "id")}
        doc["email"] = str(doc.get("email", "")).strip().lower()
        return doc

    # Restore *merges*: a record that already exists (same email) is skipped, so restoring a
    # backup into a running system no longer duplicates everyone.
    for emp_data in payload.get("employees", []) or []:
        if not isinstance(emp_data, dict) or not emp_data.get("full_name") or not emp_data.get("email"):
            continue
        emp_data = clean(emp_data)
        if await emp_col.find_one(same("email", emp_data["email"])):
            skipped += 1
            continue
        code = str(emp_data.get("employee_code") or "").strip()
        if not code or await emp_col.find_one({"employee_code": code}):
            emp_data["employee_code"] = await EmployeeService.generate_next_employee_code()
        await emp_col.insert_one(emp_data)
        imported_stats["employees"] += 1

    for intern_data in payload.get("interns", []) or []:
        if not isinstance(intern_data, dict) or not intern_data.get("full_name") or not intern_data.get("email"):
            continue
        intern_data = clean(intern_data)
        if await intern_col.find_one(same("email", intern_data["email"])):
            skipped += 1
            continue
        code = str(intern_data.get("intern_code") or "").strip()
        if not code or await intern_col.find_one({"intern_code": code}):
            intern_data["intern_code"] = await InternService.generate_next_intern_code()
        await intern_col.insert_one(intern_data)
        imported_stats["interns"] += 1

    for cand_data in payload.get("candidates", []) or []:
        if not isinstance(cand_data, dict) or not (cand_data.get("candidate_name") or cand_data.get("full_name")):
            continue
        if "full_name" in cand_data and "candidate_name" not in cand_data:
            cand_data["candidate_name"] = cand_data["full_name"]
        cand_data = clean(cand_data)
        if cand_data["email"] and await CandidateService.find_duplicate(cand_data["email"], str(cand_data.get("position_applied") or "")):
            skipped += 1
            continue
        await cand_col.insert_one(cand_data)
        imported_stats["candidates"] += 1

    await LogService.create_log(
        action="BACKUP_RESTORE",
        performed_by=admin.get("email", ""),
        performed_by_role=admin.get("role", ""),
        target="full dataset",
        details={"message": f"Restored {imported_stats} ({skipped} existing records skipped)"},
    )

    return {
        "success": True,
        "message": (f"Successfully imported {imported_stats['employees']} employees, {imported_stats['interns']} interns, "
                    f"and {imported_stats['candidates']} candidates ({skipped} already existed and were skipped)."),
        "stats": imported_stats,
        "skipped": skipped,
    }
