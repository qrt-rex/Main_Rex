import logging
from datetime import datetime
from typing import Optional, Dict, Any, List
from fastapi import APIRouter, HTTPException, Depends, Request, status, Query
from app.schemas.employee import (
    EmployeeCreateRequest,
    EmployeeUpdateRequest,
    EmployeeResponse,
    EmployeeListResponse
)
from app.services.employee_service import EmployeeService
from app.services.auth_service import get_current_admin
from app.services.log_service import LogService
from app.utils.validators import row_error


def _truthy(v: Any) -> bool:
    # bool("false") is True; spreadsheets send text.
    return str(v).strip().lower() not in ("false", "no", "0", "n", "") if v is not None else True

logger = logging.getLogger("rexera.router.employees")
router = APIRouter(prefix="/api/employees", tags=["Employees"])


def _employee_view(doc: Dict[str, Any]) -> EmployeeResponse:
    """Builds the response, filling gaps so one malformed/legacy record cannot break the whole directory."""
    d = dict(doc)
    rid = str(d.get("id") or d.get("_id") or "")
    d["id"] = rid
    d["employee_code"] = d.get("employee_code") or d.get("employee_id") or (rid[:8] or "N/A")
    d["full_name"] = d.get("full_name") or d.get("name") or "(unnamed)"
    d["mobile_number"] = d.get("mobile_number") or d.get("phone") or ""
    d["date_of_joining"] = d.get("date_of_joining") or d.get("joining_date") or ""
    for key in ("email", "department", "designation", "bank_name", "account_no", "ifsc_code"):
        if d.get(key) is None:
            d[key] = ""
    for key in ("base_salary", "hra", "conveyance_allowance"):
        if d.get(key) is None:
            d[key] = 0.0
    if d.get("professional_tax") is None:
        d["professional_tax"] = 200.0
    d["employee_status"] = d.get("employee_status") or "Active"
    d["joining_status"] = d.get("joining_status") or "Joined"
    return EmployeeResponse(**d)

@router.post("", response_model=EmployeeResponse, include_in_schema=False)
@router.post("/", response_model=EmployeeResponse)
async def create_employee(req: EmployeeCreateRequest, request: Request, admin: Dict[str, Any] = Depends(get_current_admin)):
    """Create a new employee with structured salary breakdown (and their sign-in account when a password is given)."""
    doc = await EmployeeService.create_employee(req)
    if req.password:
        await LogService.create_log(
            action="USER_CREATE", performed_by=admin.get("email", ""), performed_by_role=admin.get("role", ""),
            target=doc["email"], details={"message": f"Created sales account for {doc['email']} from Add employee"},
            ip_address=request.client.host if request.client else "",
        )
    return _employee_view(doc)

@router.get("", response_model=EmployeeListResponse, include_in_schema=False)
@router.get("/", response_model=EmployeeListResponse)
async def get_employees(
    search: Optional[str] = Query(None, description="Search by name, code, email, designation"),
    department: Optional[str] = Query(None, description="Filter by department"),
    status: Optional[str] = Query(None, description="Filter by employee status"),
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=2000),
    admin: Dict[str, Any] = Depends(get_current_admin)
):
    """Retrieve employees list with sensitive banking details masked."""
    docs, total = await EmployeeService.get_employees(
        search=search,
        department=department,
        status=status,
        page=page,
        limit=limit,
        mask_banking=True
    )
    return EmployeeListResponse(
        total=total,
        page=page,
        limit=limit,
        employees=[_employee_view(d) for d in docs]
    )

@router.post("/bulk")
async def bulk_import_employees(
    records: List[Dict[str, Any]],
    admin: Dict[str, Any] = Depends(get_current_admin)
):
    """Bulk import employees from CSV / Excel parse results."""
    created = []
    errors = []
    for idx, r in enumerate(records):
        try:
            req = EmployeeCreateRequest(
                employee_code=str(r.get("employee_code") or ""),
                full_name=r.get("full_name") or r.get("name") or "",
                email=r.get("email"),
                mobile_number=str(r.get("mobile_number") or r.get("phone") or ""),
                department=r.get("department") or "Engineering",
                designation=r.get("designation") or r.get("role") or "Staff",
                reporting_manager=r.get("reporting_manager") or "",
                gender=r.get("gender") or "",
                branch=r.get("branch") or "",
                date_of_joining=str(r.get("date_of_joining") or datetime.utcnow().strftime("%Y-%m-%d")),
                base_salary=float(r.get("base_salary") or 0),
                hra=float(r.get("hra") or 0),
                conveyance_allowance=float(r.get("conveyance_allowance") or 0),
                special_allowance=float(r.get("special_allowance") or 0),
                professional_tax=float(r.get("professional_tax") if r.get("professional_tax") not in (None, "") else 200),
                pf_opted=_truthy(r.get("pf_opted", True)),
                bank_name=str(r.get("bank_name") or ""),
                account_no=str(r.get("account_no") or ""),
                ifsc_code=str(r.get("ifsc_code") or ""),
                employee_status=r.get("employee_status") or "Active"
            )
            emp = await EmployeeService.create_employee(req)
            created.append(emp)
        except Exception as e:
            errors.append({"row": idx + 1, "name": r.get("full_name") or r.get("name"), "error": row_error(e)})
    return {
        "success": True,
        "inserted_count": len(created),
        "imported_count": len(created),
        "failed_count": len(errors),
        "errors": errors,
        "message": f"Successfully imported {len(created)} employees ({len(errors)} failed)."
    }

@router.get("/{emp_id}", response_model=EmployeeResponse)
async def get_employee_details(
    emp_id: str,
    unmask: bool = Query(False, description="Whether to show unmasked banking info"),
    admin: Dict[str, Any] = Depends(get_current_admin)
):
    """Retrieve specific employee profile with complete information."""
    doc = await EmployeeService.get_employee_by_id(emp_id, mask_banking=not unmask)
    if not doc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Employee not found.")
    return _employee_view(doc)

@router.put("/{emp_id}", response_model=EmployeeResponse)
async def update_employee(
    emp_id: str,
    req: EmployeeUpdateRequest,
    admin: Dict[str, Any] = Depends(get_current_admin)
):
    """Update employee details and recalculate salary components."""
    doc = await EmployeeService.update_employee(emp_id, req)
    if not doc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Employee not found.")
    return _employee_view(doc)

@router.delete("/{emp_id}")
async def delete_employee(emp_id: str, admin: Dict[str, Any] = Depends(get_current_admin)):
    """Delete an employee record."""
    deleted = await EmployeeService.delete_employee(emp_id)
    if not deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Employee not found.")
    return {"success": True, "message": "Employee deleted successfully."}

