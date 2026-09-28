import logging
from typing import Optional, List, Dict, Any
from fastapi import APIRouter, HTTPException, Depends, status, Query
from app.services.auth_service import get_current_admin
from app.services.advance_loan_service import AdvanceLoanService
from app.database import get_collection, fix_ids, fix_id
from app.schemas.advanced_payroll import (
    SalaryAdvanceCreate,
    SalaryAdvanceResponse,
    AdvanceApprovalRequest,
    EmployeeLoanCreate,
    EmployeeLoanResponse,
    BonusCreate,
    BonusResponse,
    OvertimeCreate,
    OvertimeResponse
)
from datetime import datetime

logger = logging.getLogger("rexera.router.advances_loans")
router = APIRouter(prefix="/api", tags=["Advances, Loans & Adjustments"])

# ==========================================
# SALARY ADVANCES
# ==========================================
@router.post("/advances", response_model=SalaryAdvanceResponse)
async def create_advance(req: SalaryAdvanceCreate, admin: Dict[str, Any] = Depends(get_current_admin)):
    """Create a new salary advance request/record for an employee."""
    try:
        adv = await AdvanceLoanService.create_advance(
            employee_id=req.employee_id,
            advance_amount=req.advance_amount,
            reason=req.reason,
            monthly_deduction=req.monthly_deduction_amount,
            start_month=req.start_month,
            start_year=req.start_year
        )
        return SalaryAdvanceResponse(**adv)
    except ValueError as ve:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(ve))
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error creating salary advance: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to create advance.")

@router.get("/advances", response_model=List[SalaryAdvanceResponse])
async def list_advances(
    employee_id: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    admin: Dict[str, Any] = Depends(get_current_admin)
):
    """Retrieve all salary advances with optional employee and status filters."""
    advances = await AdvanceLoanService.list_advances(employee_id=employee_id, status=status)
    return [SalaryAdvanceResponse(**a) for a in advances]

@router.post("/advances/{advance_id}/approve", response_model=SalaryAdvanceResponse)
async def approve_advance(
    advance_id: str,
    admin: Dict[str, Any] = Depends(get_current_admin)
):
    """Approve a salary advance request."""
    try:
        res = await AdvanceLoanService.update_advance_approval(
            advance_db_id=advance_id,
            action="approve",
            approved_by=admin.get("username", "HR Admin")
        )
        return SalaryAdvanceResponse(**res)
    except ValueError as ve:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(ve))

@router.post("/advances/{advance_id}/reject", response_model=SalaryAdvanceResponse)
async def reject_advance(
    advance_id: str,
    req: Optional[AdvanceApprovalRequest] = None,
    admin: Dict[str, Any] = Depends(get_current_admin)
):
    """Reject a salary advance request."""
    try:
        remarks = req.remarks if req else "Rejected by Admin"
        res = await AdvanceLoanService.update_advance_approval(
            advance_db_id=advance_id,
            action="reject",
            approved_by=admin.get("username", "HR Admin"),
            remarks=remarks
        )
        return SalaryAdvanceResponse(**res)
    except ValueError as ve:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(ve))

# ==========================================
# EMPLOYEE LOANS
# ==========================================
@router.post("/loans", response_model=EmployeeLoanResponse)
async def create_loan(req: EmployeeLoanCreate, admin: Dict[str, Any] = Depends(get_current_admin)):
    """Create a new employee loan with amortization schedule."""
    try:
        loan = await AdvanceLoanService.create_loan(
            employee_id=req.employee_id,
            principal=req.principal_amount,
            interest_rate=req.interest_rate_percent,
            monthly_emi=req.monthly_emi,
            start_date=req.start_date,
            reason=req.reason
        )
        return EmployeeLoanResponse(**loan)
    except ValueError as ve:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(ve))
    except Exception as e:
        logger.error(f"Error creating employee loan: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to create loan.")

@router.get("/loans", response_model=List[EmployeeLoanResponse])
async def list_loans(
    employee_id: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    admin: Dict[str, Any] = Depends(get_current_admin)
):
    """Retrieve all employee loans with optional employee and status filters."""
    loans = await AdvanceLoanService.list_loans(employee_id=employee_id, status=status)
    return [EmployeeLoanResponse(**l) for l in loans]

# ==========================================
# BONUSES & OVERTIME
# ==========================================
@router.post("/bonuses", response_model=BonusResponse)
async def create_bonus(req: BonusCreate, admin: Dict[str, Any] = Depends(get_current_admin)):
    """Add an approved bonus / incentive for an employee for a specific payroll month."""
    emp_col = get_collection("employees")
    bonus_col = get_collection("bonuses")
    emp = await emp_col.find_one({"_id": req.employee_id})
    if not emp:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Employee not found.")

    count = await bonus_col.count_documents({})
    now_str = datetime.utcnow().isoformat()
    doc = {
        "bonus_id": f"BONUS-{count + 1:04d}",
        "employee_id": str(emp["_id"]),
        "employee_name": emp.get("full_name", ""),
        "type": req.type,
        "amount": float(req.amount),
        "reason": req.reason,
        "month": req.month,
        "year": int(req.year),
        "status": "Approved",
        "approved_by": admin.get("username", "HR Admin"),
        "created_at": now_str
    }
    res = await bonus_col.insert_one(doc)
    doc["id"] = str(res.inserted_id)
    doc["_id"] = str(res.inserted_id)
    return BonusResponse(**doc)

@router.get("/bonuses", response_model=List[BonusResponse])
async def list_bonuses(
    employee_id: Optional[str] = Query(None),
    month: Optional[str] = Query(None),
    year: Optional[int] = Query(None),
    admin: Dict[str, Any] = Depends(get_current_admin)
):
    bonus_col = get_collection("bonuses")
    query: Dict[str, Any] = {}
    if employee_id: query["employee_id"] = employee_id
    if month and month.lower() != "all": query["month"] = month
    if year: query["year"] = int(year)
    docs = await bonus_col.find(query).sort("created_at", -1).to_list(1000)
    return [BonusResponse(**fix_id(d)) for d in docs]

@router.post("/overtime", response_model=OvertimeResponse)
async def create_overtime(req: OvertimeCreate, admin: Dict[str, Any] = Depends(get_current_admin)):
    """Log approved overtime hours for an employee."""
    emp_col = get_collection("employees")
    ot_col = get_collection("overtime")
    emp = await emp_col.find_one({"_id": req.employee_id})
    if not emp:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Employee not found.")

    logged = await ot_col.find({"employee_id": str(emp["_id"]), "date": req.date}).to_list(1000)
    already = sum(float(d.get("hours") or 0) for d in logged)
    if already + float(req.hours) > 24:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                            detail=f"{already:g} overtime hours are already logged on {req.date}; a day has only 24.")

    rate = req.rate_per_hour or float(emp.get("base_salary") or 30000) / 240.0 * 1.5
    amount = round(float(req.hours) * rate, 2)
    now_str = datetime.utcnow().isoformat()

    doc = {
        "employee_id": str(emp["_id"]),
        "employee_name": emp.get("full_name", ""),
        "date": req.date,
        "hours": float(req.hours),
        "rate_per_hour": rate,
        "amount": amount,
        "status": "Approved",
        "approved_by": admin.get("username", "HR Admin"),
        "reason": req.reason or "Overtime Project Delivery",
        "created_at": now_str
    }
    res = await ot_col.insert_one(doc)
    doc["id"] = str(res.inserted_id)
    doc["_id"] = str(res.inserted_id)
    return OvertimeResponse(**doc)

@router.get("/overtime", response_model=List[OvertimeResponse])
async def list_overtime(
    employee_id: Optional[str] = Query(None),
    admin: Dict[str, Any] = Depends(get_current_admin)
):
    ot_col = get_collection("overtime")
    query: Dict[str, Any] = {}
    if employee_id: query["employee_id"] = employee_id
    docs = await ot_col.find(query).sort("created_at", -1).to_list(1000)
    return [OvertimeResponse(**fix_id(d)) for d in docs]
