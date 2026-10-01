"""
PF / EPF management API. Access is checked by the central RBAC guard (rbac_service.ROUTE_RULES) before any of
these run; /api/pf/me takes no employee id at all, so staff can only ever read their own PF.
"""
import re
from datetime import date
from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status

from app.database import get_collection, fix_ids
from app.schemas.pf import EmployeePFUpdate, PFCalculateRequest, PFRuleCreate, PFRuleStatusUpdate, PFRuleUpdate, PFSettingsUpdate
from app.services import pf_engine, pf_reports, pf_service
from app.services.auth_service import get_current_admin
from app.utils.validators import optional_iso_date

router = APIRouter(prefix="/api", tags=["PF / EPF"])


def _ip(request: Request) -> str:
    return request.client.host if request.client else ""


def _month_range(value: str, label: str) -> str:
    v = (value or "").strip()
    if v and not re.fullmatch(r"\d{4}-(0[1-9]|1[0-2])", v):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=f"{label} must be a month like 2026-10.")
    return v


def _period(month: Optional[str], year: Optional[int]) -> tuple:
    today = date.today()
    try:
        return int(year or today.year), pf_reports._month_no(month or today.month)
    except (ValueError, IndexError):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Unknown month.")


# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
@router.get("/pf/config")
async def get_config():
    rules = await pf_service.list_rules()
    today = date.today()
    current = pf_engine.rule_for(rules, today)
    for r in rules:
        r["used_until"] = await pf_service._finalized_use(r["id"])
        r["is_current"] = bool(current and r["id"] == current["id"])
        start = pf_engine.to_date(r.get("effective_from"))
        r["is_future"] = bool(start and start > today)
    return {"settings": await pf_service.get_settings(), "rules": rules, "current_rule": current,
            "bases": pf_engine.BASES, "issues": await pf_reports.config_issues(), "today": today.isoformat()}


@router.put("/pf/settings")
async def update_settings(body: PFSettingsUpdate, request: Request, admin: Dict[str, Any] = Depends(get_current_admin)):
    data = body.model_dump()
    reason = data.pop("reason", "")
    return await pf_service.update_settings(data, admin, reason=reason, ip=_ip(request))


@router.post("/pf/rules", status_code=status.HTTP_201_CREATED)
async def create_rule(body: PFRuleCreate, request: Request, admin: Dict[str, Any] = Depends(get_current_admin)):
    return await pf_service.create_rule(body.model_dump(), admin, ip=_ip(request))


@router.put("/pf/rules/{rule_id}")
async def update_rule(rule_id: str, body: PFRuleUpdate, request: Request, admin: Dict[str, Any] = Depends(get_current_admin)):
    return await pf_service.update_rule(rule_id, body.model_dump(exclude_unset=True), admin, ip=_ip(request))


@router.post("/pf/rules/{rule_id}/status")
async def set_rule_status(rule_id: str, body: PFRuleStatusUpdate, request: Request, admin: Dict[str, Any] = Depends(get_current_admin)):
    return await pf_service.update_rule(rule_id, {"status": body.status, "reason": body.reason}, admin, ip=_ip(request))


@router.get("/pf/rules/{rule_id}/impact")
async def rule_impact(rule_id: str):
    return await pf_reports.report("impact", rule_id=rule_id)


# ---------------------------------------------------------------------------
# Employee PF details
# ---------------------------------------------------------------------------
@router.get("/employees/{emp_id}/pf")
async def get_employee_pf(emp_id: str):
    emp = await pf_service._employee(emp_id)
    return await pf_service.employee_pf_view(emp)


@router.post("/employees/{emp_id}/pf")
@router.put("/employees/{emp_id}/pf")
async def save_employee_pf(emp_id: str, body: EmployeePFUpdate, request: Request, admin: Dict[str, Any] = Depends(get_current_admin)):
    return await pf_service.save_details(emp_id, body.model_dump(), admin, ip=_ip(request))


@router.get("/pf/me")
async def my_pf(admin: Dict[str, Any] = Depends(get_current_admin)):
    """The signed-in employee's own PF details, PF calculation and PF history (finalized payroll only)."""
    email = str(admin.get("email") or "").strip()
    emp = await get_collection("employees").find_one({"email": {"$regex": f"^{re.escape(email)}$", "$options": "i"}}) if email else None
    if not emp:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No employee record is linked to your account.")
    view = await pf_service.employee_pf_view(emp)
    view["details"] = {k: v for k, v in view["details"].items() if k not in ("updated_by", "statutory_pf_wage")}
    history = await get_collection("payroll_pf_transactions").find({"employee_id": str(emp["_id"]), "finalized": True}).to_list(500)
    history.sort(key=lambda t: str(t.get("calculation_date")), reverse=True)
    view["history"] = [{k: t.get(k) for k in ("month", "year", "calculation_date", "pf_rule_name", "basic_salary", "pf_wage",
                                               "employee_pf", "employer_pf", "eps_contribution", "employer_epf", "status")}
                       for t in history]
    return view


# ---------------------------------------------------------------------------
# Calculation preview, PF payroll, dashboard, lists, reports, audit
# ---------------------------------------------------------------------------
@router.post("/pf/calculate")
async def calculate(body: PFCalculateRequest):
    on = pf_engine.to_date(body.on_date) or date.today()
    if body.employee_id:
        emp = await pf_service._employee(body.employee_id)
        details = await get_collection("employee_pf_details").find_one({"employee_id": body.employee_id})
        result = pf_engine.evaluate(emp, details, await pf_service.list_rules(), await pf_service.get_settings(), on,
                                    basic=body.basic_salary, da=body.da)
        return result
    return await pf_service.calculate_amounts(body.basic_salary, da=body.da, statutory_wage=body.statutory_pf_wage,
                                              eps_applicable=body.eps_applicable, on=on, rule_id=body.rule_id)


@router.get("/pf/payroll")
async def pf_payroll(month: Optional[str] = None, year: Optional[int] = None, department: str = ""):
    y, m = _period(month, year)
    return {"rows": await pf_reports.payroll_rows(y, m, department=department)}


@router.get("/pf/dashboard")
async def pf_dashboard(month: Optional[str] = None, year: Optional[int] = None, department: str = "", branch: str = "",
                       employee_id: str = "", pf_status: str = "", pf_applicable: str = "", eps_applicable: str = ""):
    y, m = _period(month, year)
    return await pf_reports.dashboard(y, m, department=department, branch=branch, employee_id=employee_id,
                                      pf_status=pf_status, pf_applicable=pf_applicable, eps_applicable=eps_applicable)


@router.get("/pf/employees")
async def pf_employees(month: Optional[str] = None, year: Optional[int] = None, department: str = "", branch: str = "",
                       pf_status: str = "", pf_applicable: str = "", eps_applicable: str = "", include_inactive: bool = False):
    y, m = _period(month, year)
    return {"rows": await pf_reports.employee_rows(y, m, department=department, branch=branch, pf_status=pf_status,
                                                   pf_applicable=pf_applicable, eps_applicable=eps_applicable,
                                                   include_inactive=include_inactive)}


@router.get("/pf/reports")
async def pf_report(kind: str = Query("monthly"), start: str = "", end: str = "", department: str = "", branch: str = "",
                    employee_id: str = "", rule_id: str = "", finalized_only: bool = False):
    if kind == "history" and not employee_id:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Choose an employee for the PF history report.")
    try:
        return await pf_reports.report(kind, start=_month_range(start, "From"), end=_month_range(end, "To"), department=department,
                                       branch=branch, employee_id=employee_id, rule_id=rule_id, finalized_only=finalized_only)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(e))


@router.get("/pf/audit-logs")
async def pf_audit_logs(employee_id: str = "", entity: str = "", start: str = "", end: str = "", limit: int = Query(500, ge=1, le=5000)):
    """Read-only: the PF audit trail has no update or delete endpoint."""
    try:
        start, end = optional_iso_date(start, "From"), optional_iso_date(end, "To")
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(e))
    query: Dict[str, Any] = {}
    if employee_id:
        query["employee_id"] = employee_id
    if entity:
        query["entity"] = entity
    if start:
        query.setdefault("created_at", {})["$gte"] = start
    if end:
        query.setdefault("created_at", {})["$lte"] = f"{end}T23:59:59.999999"
    docs = await get_collection("pf_audit_logs").find(query).sort("created_at", -1).to_list(limit)
    return {"rows": fix_ids(docs)}
