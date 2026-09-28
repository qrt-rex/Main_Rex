"""
Role dashboard data.

One payload per signed-in user, assembled from blocks that are each gated by a
permission (same pattern as /api/notifications). A block the caller may not see is
absent from the response, so the CRM never has to hide anything client-side.
Everything here is read-only and reuses the collections the HR module already owns.
"""
import asyncio
import html
import logging
import platform
import re
import sys
import time
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional, Set

from fastapi import APIRouter, Depends

from app.config import settings
from app.database import db_manager, get_collection
from app.services.auth_service import get_current_admin
from app.services import rbac_service as rbac

logger = logging.getLogger("rexera.router.workspace")
router = APIRouter(prefix="/api/workspace", tags=["Role Dashboards"])

STARTED_AT = time.time()
APP_VERSION = "2.0.0"

DONE_STATES = ("DONE", "COMPLETED", "CANCELLED")


def _today() -> str:
    return datetime.now().strftime("%Y-%m-%d")


def _iso(value: Any) -> Optional[str]:
    if isinstance(value, datetime):
        return value.isoformat()
    return value if isinstance(value, str) else None


def _status(doc: Dict[str, Any]) -> str:
    return str(doc.get("status") or "").upper()


def _plain_text(markup: str) -> str:
    text = re.sub(r"<br\s*/?>|</p>|</li>", " ", markup, flags=re.IGNORECASE)
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", "", text))).strip()


async def _workforce() -> Dict[str, Any]:
    att, leave = get_collection("attendance"), get_collection("leave_requests")
    today = _today()
    records = await att.find({"attendance_date": today}).to_list(2000)
    employees = await get_collection("employees").find({}).to_list(5000)

    departments: Dict[str, int] = {}
    for e in employees:
        if e.get("employee_status") in ("Active", "Probation"):
            key = e.get("department") or "Unassigned"
            departments[key] = departments.get(key, 0) + 1

    return {
        "active_employees": sum(1 for e in employees if e.get("employee_status") in ("Active", "Probation")),
        "active_interns": await get_collection("interns").count_documents({"status": {"$in": ["Active", "Ongoing"]}}),
        "present_today": sum(1 for r in records if _status(r) in ("PRESENT", "LATE")),
        "late_today": sum(1 for r in records if _status(r) == "LATE"),
        "absent_today": sum(1 for r in records if _status(r) == "ABSENT"),
        "pending_leave": await leave.count_documents({"status": "PENDING"}),
        "on_leave_today": await leave.count_documents(
            {"status": "APPROVED", "start_date": {"$lte": today}, "end_date": {"$gte": today}}),
        "departments": [{"label": k, "value": v} for k, v in sorted(departments.items(), key=lambda i: -i[1])],
    }


def _period(slip: Dict[str, Any]) -> str:
    """Payslips store month name + year ("September", 2026)."""
    return f"{slip.get('month') or ''} {slip.get('year') or ''}".strip()


async def _payroll() -> Dict[str, Any]:
    slips = await get_collection("salary_slips").find({}).to_list(3000)
    now = datetime.now()
    payrolls = get_collection("payrolls")
    return {
        "total_net_disbursed": round(sum(float(s.get("net_salary") or 0) for s in slips), 2),
        "slips_total": len(slips),
        "slips_this_month": sum(
            1 for s in slips if s.get("month") == now.strftime("%B") and str(s.get("year")) == str(now.year)),
        "pending_payroll": await payrolls.count_documents({"status": {"$in": ["DRAFT", "CALCULATED"]}}),
        "approved_payroll": await payrolls.count_documents({"status": {"$in": ["APPROVED", "FINALIZED", "PAID"]}}),
    }


async def _recruitment() -> Dict[str, Any]:
    docs = await get_collection("candidates").find({}).to_list(3000)
    by_status: Dict[str, int] = {}
    for c in docs:
        key = c.get("status") or "Applied"
        by_status[key] = by_status.get(key, 0) + 1
    upcoming = [c for c in docs if c.get("status") in ("Interview Scheduled", "Screening")][:6]
    return {
        "total_candidates": len(docs),
        "pending_onboarding": await get_collection("joining_tokens").count_documents({"used": False}),
        "by_status": [{"label": k, "value": v} for k, v in sorted(by_status.items(), key=lambda i: -i[1]) if v],
        "interviews": [{
            "id": str(c.get("_id")),
            "title": c.get("candidate_name") or "Candidate",
            "description": c.get("position_applied") or "",
            "date": c.get("interview_date") or "To be scheduled",
            "status": c.get("status"),
        } for c in upcoming],
    }


async def _approvals() -> List[Dict[str, Any]]:
    pending = await get_collection("leave_requests").find({"status": "PENDING"}).sort("created_at", -1).to_list(25)
    return [{
        "id": str(l.get("_id")),
        "title": "{} · {}".format(l.get("employee_name") or "Employee", str(l.get("leave_type") or "Leave").title()),
        "description": "{} to {} · {} day(s)".format(l.get("start_date"), l.get("end_date"), l.get("total_days") or 0),
        "timestamp": _iso(l.get("created_at")),
        "link": "/hr/leave",
        "tone": "warning",
    } for l in pending]


def _task_item(t: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "id": str(t.get("_id")),
        "title": t.get("task_title") or "Task",
        "client": t.get("client_name") or "General",
        "project": t.get("project_name") or "",
        "owner": t.get("assigned_to_name") or "Unassigned",
        "status": "BLOCKED" if t.get("is_blocked") else (t.get("status") or "TO_DO"),
        "reason": t.get("blocker_reason"),
        "timestamp": _iso(t.get("updated_at") or t.get("created_at")),
    }


async def _clients() -> Dict[str, Any]:
    clients = await get_collection("clients").find({}).to_list(2000)
    projects = await get_collection("projects").find({}).to_list(2000)
    tasks = await get_collection("project_tasks").find({}).to_list(3000)

    blocked = [t for t in tasks if t.get("is_blocked") or _status(t) == "BLOCKED"]
    blocked_ids = {str(t.get("_id")) for t in blocked}
    open_tasks = [t for t in tasks if _status(t) not in DONE_STATES]
    queue = blocked + [t for t in open_tasks if str(t.get("_id")) not in blocked_ids]

    per_client: Dict[str, int] = {}
    for p in projects:
        key = p.get("client_name") or "Unassigned"
        per_client[key] = per_client.get(key, 0) + 1

    return {
        "total_clients": sum(1 for c in clients if c.get("is_active", True)),
        "active_projects": sum(1 for p in projects if _status(p) == "ACTIVE"),
        "open_tasks": len(open_tasks),
        "blocked_tasks": len(blocked),
        "logged_hours": round(sum(float(p.get("logged_hours_total") or 0) for p in projects), 1),
        "budget_hours": round(sum(float(p.get("budget_hours") or 0) for p in projects), 1),
        "by_client": [{"label": k, "value": v} for k, v in sorted(per_client.items(), key=lambda i: -i[1])][:8],
        "tasks": [_task_item(t) for t in queue[:12]],
    }


async def _users() -> Dict[str, Any]:
    admins = await get_collection("admins").find({}).to_list(1000)
    by_role: Dict[str, int] = {}
    for a in admins:
        role = rbac.normalize_role(a.get("role")) or "unknown"
        by_role[role] = by_role.get(role, 0) + 1
    labels = {r["id"]: r["label"] for r in rbac.ROLES}
    return {
        "total": len(admins),
        "active": sum(1 for a in admins if a.get("is_active", True)),
        "disabled": sum(1 for a in admins if not a.get("is_active", True)),
        "by_role": [{"label": labels.get(k, k.title()), "value": v}
                    for k, v in sorted(by_role.items(), key=lambda i: -i[1])],
    }


async def _updates() -> List[Dict[str, Any]]:
    docs = await get_collection("broadcasts").find({"is_active": True}).sort("created_at", -1).to_list(6)
    return [{
        "id": str(b.get("broadcast_id") or b.get("_id")),
        "title": b.get("title") or "Announcement",
        # The body is stored as (sanitised) HTML; the dashboard shows a plain-text preview.
        "description": _plain_text(b.get("rich_html_content") or b.get("message") or "")[:160],
        "timestamp": _iso(b.get("created_at")),
        "status": b.get("priority") or b.get("category"),
    } for b in docs]


def _log_item(l: Dict[str, Any]) -> Dict[str, Any]:
    target = l.get("target")
    return {
        "id": str(l.get("_id")),
        "title": str(l.get("action") or "").replace("_", " ").title(),
        "description": "{}{}".format(l.get("performed_by") or "", " · " + target if target else ""),
        "timestamp": _iso(l.get("timestamp")),
    }


async def _activity(email: Optional[str]) -> List[Dict[str, Any]]:
    query: Dict[str, Any] = {} if email is None else {"performed_by": email}
    docs = await get_collection("activity_logs").find(query).sort("timestamp", -1).to_list(12)
    return [_log_item(l) for l in docs]


async def _me(admin: Dict[str, Any]) -> Dict[str, Any]:
    email = (admin.get("email") or "").lower()
    employee = await get_collection("employees").find_one(
        {"email": {"$regex": f"^{re.escape(email)}$", "$options": "i"}}) if email else None
    out: Dict[str, Any] = {"employee": None, "tasks": [], "leaves": [], "payslip": None}

    if employee:
        emp_id = str(employee.get("_id"))
        # Leave requests are keyed by employee code (older ones by record id).
        leave_keys = [k for k in (employee.get("employee_code"), employee.get("employee_id"), emp_id) if k]
        out["employee"] = {
            "full_name": employee.get("full_name"),
            "employee_code": employee.get("employee_code"),
            "designation": employee.get("designation"),
            "department": employee.get("department"),
            "joining_date": employee.get("date_of_joining") or employee.get("joining_date"),
            "status": employee.get("employee_status"),
        }
        leaves = await get_collection("leave_requests").find({"employee_id": {"$in": leave_keys}}).sort("created_at", -1).to_list(5)
        out["leaves"] = [{
            "id": str(l.get("_id")),
            "title": str(l.get("leave_type") or "Leave").title(),
            "description": "{} to {}".format(l.get("start_date"), l.get("end_date")),
            "status": l.get("status"),
            "timestamp": _iso(l.get("created_at")),
        } for l in leaves]
        slips = await get_collection("salary_slips").find({"employee_id": emp_id}).sort("created_at", -1).to_list(1)
        if slips:
            out["payslip"] = {
                "id": str(slips[0].get("_id")),
                "period": _period(slips[0]),
                "net_salary": float(slips[0].get("net_salary") or 0),
            }

    tasks = await get_collection("project_tasks").find({"assigned_to_email": email}).to_list(20)
    out["tasks"] = [{
        "id": str(t.get("_id")),
        "title": t.get("task_title") or "Task",
        "description": "{} · {}".format(t.get("project_name") or "", t.get("client_name") or "").strip(" ·"),
        "status": "BLOCKED" if t.get("is_blocked") else (t.get("status") or "TO_DO"),
        "timestamp": _iso(t.get("updated_at") or t.get("created_at")),
    } for t in tasks if _status(t) not in DONE_STATES][:8]
    return out


@router.get("/summary")
async def workspace_summary(admin: Dict[str, Any] = Depends(get_current_admin)):
    """Everything a role dashboard renders. Blocks the caller can't see are omitted."""
    role = rbac.normalize_role(admin.get("role"))
    granted: Set[str] = await rbac.get_role_permissions(role)

    # Every block the caller may see, gathered concurrently: each one is several
    # round trips and the dashboard waits for all of them.
    jobs = {
        "me": _me(admin),
        "updates": _updates(),
        # Own actions when the caller can't read the org-wide audit trail.
        "activity": _activity(None if "audit.view" in granted else admin.get("email")),
    }
    if {"hr.dashboard.view", "hr.employees.view"} & granted:
        jobs["workforce"] = _workforce()
    if "hr.payroll.view" in granted:
        jobs["payroll"] = _payroll()
    if "hr.recruitment.view" in granted:
        jobs["recruitment"] = _recruitment()
    if "hr.leave.approve" in granted:
        jobs["approvals"] = _approvals()
    if {"clients.view", "hr.productivity.view"} & granted:
        jobs["clients"] = _clients()
    if "users.manage" in granted:
        jobs["users"] = _users()

    results = await asyncio.gather(*jobs.values())
    payload: Dict[str, Any] = {
        "role": role,
        "role_label": next((r["label"] for r in rbac.ROLES if r["id"] == role), role.title()),
        "username": admin.get("username") or admin.get("email"),
        "generated_at": datetime.utcnow().isoformat(),
    }
    payload.update(dict(zip(jobs.keys(), results)))
    return payload


@router.get("/desk")
async def support_desk(admin: Dict[str, Any] = Depends(get_current_admin)):
    """Support queue: client-facing blockers, newest first."""
    tasks = await get_collection("project_tasks").find({"is_blocked": True}).to_list(200)
    tasks.sort(key=lambda t: str(t.get("blocked_at") or t.get("updated_at") or ""), reverse=True)
    return {
        "total_open": len(tasks),
        "open_requests": [{
            "id": str(t.get("_id")),
            "title": t.get("task_title") or "Request",
            "client": t.get("client_name") or "General",
            "project": t.get("project_name") or "",
            "owner": t.get("assigned_to_name") or "Unassigned",
            "category": t.get("blocker_category") or "GENERAL",
            "reason": t.get("blocker_reason") or "",
            "raised_by": t.get("blocked_by_name") or "",
            "timestamp": _iso(t.get("blocked_at") or t.get("updated_at")),
        } for t in tasks[:25]],
    }


async def _collection_sizes(names: List[str]) -> List[Dict[str, Any]]:
    sizes = []
    for name in names:
        try:
            count = await get_collection(name).count_documents({})
        except Exception:  # table not created yet
            count = 0
        sizes.append({"label": name.replace("_", " ").title(), "value": count})
    return sizes


@router.get("/system")
async def system_status(admin: Dict[str, Any] = Depends(get_current_admin)):
    """Live infrastructure, database, security and backup status for the IT dashboard."""
    granted = await rbac.get_role_permissions(rbac.normalize_role(admin.get("role")))

    started = time.time()
    db_error = None
    try:
        await get_collection("admins").count_documents({})
        db_ok = True
    except Exception as exc:
        db_ok = False
        db_error = str(exc)
        logger.error("System status: database probe failed: %s", exc)
    latency_ms = round((time.time() - started) * 1000, 1)
    uptime = int(time.time() - STARTED_AT)

    logs = await get_collection("activity_logs").find({}).sort("timestamp", -1).to_list(400)
    cutoff = (datetime.utcnow() - timedelta(hours=24)).isoformat()
    recent = [l for l in logs if str(l.get("timestamp") or "") >= cutoff]

    payload: Dict[str, Any] = {
        "infrastructure": {
            "app_name": settings.APP_NAME,
            "version": APP_VERSION,
            "environment": settings.APP_ENV,
            "python": sys.version.split()[0],
            "platform": platform.system(),
            "uptime_seconds": uptime,
            "debug": settings.DEBUG,
        },
        "database": {
            "engine": "PostgreSQL",
            "connected": bool(db_ok and db_manager.is_live_pg),
            "schema": settings.DB_SCHEMA,
            "latency_ms": latency_ms,
            "error": db_error,
            "collections": await _collection_sizes([
                "employees", "interns", "candidates", "attendance", "leave_requests",
                "salary_slips", "project_tasks", "activity_logs",
            ]),
        },
        "monitoring": {
            "email_mode": "Simulated (dev)" if settings.EMAIL_DEV_MODE else (
                "Brevo API" if settings.BREVO_API_KEY else "SMTP"),
            "session_timeout_minutes": settings.SESSION_TIMEOUT_MINUTES,
            "token_expiry_minutes": settings.ACCESS_TOKEN_EXPIRE_MINUTES,
            "events_24h": len(recent),
            "sign_ins_24h": sum(1 for l in recent if l.get("action") == "LOGIN"),
            "session_timeouts_24h": sum(1 for l in recent if l.get("action") == "SESSION_TIMEOUT"),
            "permission_changes_24h": sum(1 for l in recent if str(l.get("action") or "").startswith("PERMISSION_")),
        },
    }

    if "it.deployment.view" in granted:
        payload["deployment"] = {
            "version": APP_VERSION,
            "environment": settings.APP_ENV,
            "started_at": datetime.utcfromtimestamp(STARTED_AT).isoformat(),
            "uptime_seconds": uptime,
            "frontend": "React 19 + Vite",
            "backend": "FastAPI",
        }

    if "it.security.view" in granted:
        admins = await get_collection("admins").find({}).to_list(1000)
        security_actions = ("LOGIN", "LOGOUT", "SESSION_TIMEOUT", "PERMISSION_GRANT", "PERMISSION_REVOKE",
                            "USER_CREATE", "USER_UPDATE", "PASSWORD_RESET")
        payload["security"] = {
            "accounts_total": len(admins),
            "accounts_active": sum(1 for a in admins if a.get("is_active", True)),
            "accounts_disabled": sum(1 for a in admins if not a.get("is_active", True)),
            "superadmins": sum(1 for a in admins if rbac.normalize_role(a.get("role")) == rbac.SUPERADMIN),
            "two_factor": "Email OTP enforced on every sign-in",
            "events": [dict(_log_item(l), ip=l.get("ip_address") or "")
                       for l in logs if l.get("action") in security_actions][:15],
        }

    if "it.backup.manage" in granted:
        backups = [l for l in logs if str(l.get("action") or "").startswith("BACKUP")]
        payload["backup"] = {
            "last_backup": _iso(backups[0].get("timestamp")) if backups else None,
            "last_backup_by": backups[0].get("performed_by") if backups else None,
            "total_backups_logged": len(backups),
        }
    return payload
