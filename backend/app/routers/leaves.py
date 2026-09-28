from fastapi import APIRouter, HTTPException, BackgroundTasks, Depends, Query, status
from typing import Dict, Any, List, Optional

from app.schemas.leave import (
    LeaveApplicationRequest,
    LeaveDecisionRequest,
    LeaveBalance,
)
from app.services.leave_service import LeaveService
from app.services.leave_alert_worker import LeaveAlertWorker
from app.services.auth_service import get_current_user
from app.database import get_collection, fix_ids

router = APIRouter(prefix="/api/leaves", tags=["Leave Management"])


@router.get("", status_code=status.HTTP_200_OK)
@router.get("/", status_code=status.HTTP_200_OK)
async def list_all_leaves(current_user: Dict[str, Any] = Depends(get_current_user)):
    """List all leave applications."""
    leave_col = get_collection("leave_requests")
    docs = await leave_col.find({}).sort("created_at", -1).to_list(500)
    return {"success": True, "count": len(docs), "data": fix_ids(docs)}


@router.post("/apply", status_code=status.HTTP_201_CREATED)
async def apply_for_leave(
    payload: LeaveApplicationRequest,
    background_tasks: BackgroundTasks,
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    try:
        res = await LeaveService.apply_leave(payload)
    except ValueError as ve:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(ve))

    background_tasks.add_task(
        LeaveAlertWorker.send_new_leave_application_alert,
        leave_request=res["leave_request"],
        conflict_info=res["conflict_info"]
    )

    return {
        "success": True,
        "message": "Leave application submitted successfully.",
        "data": res["leave_request"],
        "conflict_info": res["conflict_info"]
    }


@router.get("/pending-dashboard", status_code=status.HTTP_200_OK)
async def get_hr_pending_leaves(current_user: Dict[str, Any] = Depends(get_current_user)):
    items = await LeaveService.get_hr_pending_leaves_dashboard()
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
    # Balances are keyed by employee code; accept a record id too.
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
