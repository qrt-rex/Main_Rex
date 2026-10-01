import re
from fastapi import APIRouter, HTTPException, BackgroundTasks, Depends, Query, status
from typing import Dict, Any, List, Optional

from app.schemas.leave import LeaveApplicationRequest, LeaveDecisionRequest
from app.services.leave_service import LeaveService, LEVEL_LABEL
from app.services.rbac_service import ROLES, get_user_permissions, normalize_role, user_roles
from app.services.leave_alert_worker import LeaveAlertWorker
from app.services.auth_service import get_current_user
from app.database import get_collection, fix_ids

router = APIRouter(prefix="/api/leaves", tags=["Leave Management"])


async def _is_approver(user: Dict[str, Any]) -> bool:
    return "hr.leave.approve" in await get_user_permissions(user)


async def _own_applicant(user: Dict[str, Any]) -> Dict[str, Any]:
    """Whoever is signed in: their employee record (matched by email), or else the login account itself.

    Every login can request its own leave. Accounts without an employee record (e.g. hr@, admin@) are
    identified by their email, the same identity broadcasts and attendance fall back to.
    """
    email = str(user.get("email") or "").strip()
    if not email:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Your account has no email address, so leave can't be requested.")
    emps = await get_collection("employees").find({"email": {"$regex": f"^{re.escape(email)}$", "$options": "i"}}).to_list(2)
    if emps:
        return emps[0]
    role = normalize_role(user.get("role"))
    return {"employee_code": email.lower(), "full_name": user.get("username") or email, "email": email,
            "department": next((r["label"] for r in ROLES if r["id"] == role), "General")}


def _code(emp: Dict[str, Any]) -> str:
    return emp.get("employee_code") or emp.get("employee_id") or str(emp["_id"])


async def _alert_recipients(leave: Dict[str, Any]) -> Optional[List[str]]:
    """HR-level requests go to manager/HR; Sales leave goes to Legal/HR/Admin/SuperAdmin; HR leave to Admin/SuperAdmin; Admin leave to SuperAdmin."""
    lvl = leave.get("approval_level", "HR")
    if lvl == "HR":
        return None
    if lvl == "SALES":
        allowed = {"legal", "hr", "admin", "superadmin"}
    elif lvl == "ADMIN":
        allowed = {"admin", "superadmin"}
    else:
        allowed = {"superadmin"}
    accounts = await get_collection("admins").find({}).to_list(2000)
    return sorted({a["email"] for a in accounts if a.get("email") and a.get("is_active", True) and any(r in allowed for r in user_roles(a))}) or None


@router.get("", status_code=status.HTTP_200_OK)
@router.get("/", status_code=status.HTTP_200_OK)
async def list_all_leaves(current_user: Dict[str, Any] = Depends(get_current_user)):
    """All leave applications for approvers; everyone else sees only their own."""
    leave_col = get_collection("leave_requests")
    docs = await leave_col.find({}).sort("created_at", -1).to_list(500)
    if not await _is_approver(current_user):
        me = str(current_user.get("email") or "").strip().lower()
        docs = [d for d in docs if me and str(d.get("employee_email") or "").strip().lower() == me]
    return {"success": True, "count": len(docs), "data": fix_ids(docs)}


@router.post("/apply", status_code=status.HTTP_201_CREATED)
async def apply_for_leave(
    payload: LeaveApplicationRequest,
    background_tasks: BackgroundTasks,
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    return await _submit(payload, background_tasks)


async def _submit(payload: LeaveApplicationRequest, background_tasks: BackgroundTasks,
                  applicant: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    try:
        res = await LeaveService.apply_leave(payload, applicant=applicant)
    except ValueError as ve:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(ve))

    leave = res["leave_request"]
    background_tasks.add_task(
        LeaveAlertWorker.send_new_leave_application_alert,
        leave_request=leave,
        conflict_info=res["conflict_info"],
        recipients=await _alert_recipients(leave)
    )

    return {
        "success": True,
        "message": f"Leave application submitted; it goes to {LEVEL_LABEL.get(leave.get('approval_level'), 'HR')} for approval.",
        "data": leave,
        "conflict_info": res["conflict_info"]
    }


@router.post("/apply-own", status_code=status.HTTP_201_CREATED)
async def apply_for_own_leave(
    payload: LeaveApplicationRequest,
    background_tasks: BackgroundTasks,
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """Request your own leave (sales, staff, HR, admin): routed to HR, or to Admin / Super Admin for HR / Admin staff."""
    emp = await _own_applicant(current_user)
    payload.employee_id = _code(emp)
    return await _submit(payload, background_tasks, applicant=emp)


@router.get("/pending-dashboard", status_code=status.HTTP_200_OK)
async def get_hr_pending_leaves(current_user: Dict[str, Any] = Depends(get_current_user)):
    items = await LeaveService.get_hr_pending_leaves_dashboard(user_roles(current_user), current_user.get("email") or "")
    return {"success": True, "count": len(items), "data": items}


@router.post("/decision", status_code=status.HTTP_200_OK)
async def decide_leave_request(
    payload: LeaveDecisionRequest,
    background_tasks: BackgroundTasks,
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    try:
        res = await LeaveService.process_leave_decision(payload, admin_user=current_user)
    except ValueError as ve:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(ve))

    background_tasks.add_task(
        LeaveAlertWorker.send_leave_decision_notification,
        leave_request=res["leave_request"],
        action=res["action"]
    )

    return {
        "success": True,
        "message": f"Leave request has been successfully {payload.action.lower()}d.",
        "data": res["leave_request"]
    }


@router.get("/balances/{employee_id}", status_code=status.HTTP_200_OK)
async def get_employee_leave_balances(
    employee_id: str,
    year: Optional[int] = Query(None, ge=2000, le=2100),
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    # Balances are keyed by employee code; accept a record id too. "me" (and anyone who can't approve leave) gets their own.
    if employee_id == "me" or not await _is_approver(current_user):
        employee_id = _code(await _own_applicant(current_user))
    emp = await LeaveService.resolve_employee(employee_id)
    if emp:
        employee_id = emp.get("employee_code") or emp.get("employee_id") or str(emp.get("_id"))
    balances = await LeaveService.get_or_create_balance(employee_id, year=year)
    return {
        "success": True,
        "employee_id": employee_id,
        "balances": {
            "casual_leave": {
                "allocated": balances.casual_leave_allocated,
                "used": balances.casual_leave_used,
                "available": balances.casual_leave_available
            },
            "sick_leave": {
                "allocated": balances.sick_leave_allocated,
                "used": balances.sick_leave_used,
                "available": balances.sick_leave_available
            },
            "earned_leave": {
                "allocated": balances.earned_leave_allocated,
                "used": balances.earned_leave_used,
                "available": balances.earned_leave_available
            },
            "loss_of_pay_days_ytd": balances.loss_of_pay_days
        }
    }
