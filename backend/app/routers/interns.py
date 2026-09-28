import logging
from datetime import datetime
from typing import Optional, Dict, Any, List
from fastapi import APIRouter, HTTPException, Depends, status, Query
from app.schemas.intern import (
    InternCreateRequest,
    InternUpdateRequest,
    InternConvertToEmployeeRequest,
    InternResponse,
    InternListResponse
)
from app.services.intern_service import InternService
from app.services.auth_service import get_current_admin
from app.utils.validators import mask_account_number, row_error

logger = logging.getLogger("rexera.router.interns")
router = APIRouter(prefix="/api/interns", tags=["Intern Management"])

@router.post("", response_model=InternResponse, include_in_schema=False)
@router.post("/", response_model=InternResponse)
async def create_intern(req: InternCreateRequest, admin: Dict[str, Any] = Depends(get_current_admin)):
    """Add a new intern employee with academic and stipend details."""
    doc = await InternService.create_intern(req)
    return _intern_view(doc)

@router.get("", response_model=InternListResponse, include_in_schema=False)
@router.get("/", response_model=InternListResponse)
async def get_interns(
    search: Optional[str] = Query(None, description="Search by name, code, college, mentor"),
    department: Optional[str] = Query(None, description="Filter by department"),
    status: Optional[str] = Query(None, description="Filter by status (Ongoing, Completed, Converted)"),
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=2000),
    admin: Dict[str, Any] = Depends(get_current_admin)
):
    """Retrieve list of interns with search and filters."""
    docs, total = await InternService.get_interns(
        search=search,
        department=department,
        status=status,
        page=page,
        limit=limit
    )
    return InternListResponse(
        total=total,
        page=page,
        limit=limit,
        interns=[_intern_view(d) for d in docs]
    )


def _intern_view(doc: Dict[str, Any], unmask: bool = False) -> InternResponse:
    d = dict(doc)
    if not unmask:
        d["account_no"] = mask_account_number(d.get("account_no") or "")
    return InternResponse(**d)

@router.post("/bulk")
async def bulk_import_interns(
    records: List[Dict[str, Any]],
    admin: Dict[str, Any] = Depends(get_current_admin)
):
    """Bulk import interns from CSV / Excel parse results."""
    created = []
    errors = []
    for idx, r in enumerate(records):
        try:
            s = lambda key, default="": str(r.get(key) if r.get(key) not in (None, "") else default).strip()
            today = datetime.utcnow().strftime("%Y-%m-%d")
            req = InternCreateRequest(
                intern_code=s("intern_code"),
                full_name=s("full_name") or s("name"),
                email=s("email"),
                mobile_number=s("mobile_number") or s("phone"),
                department=s("department", "Engineering"),
                domain_role=s("domain_role") or s("designation") or "Intern",
                assigned_mentor=s("assigned_mentor", "HR Lead"),
                college_university=s("college_university", "University"),
                degree=s("degree", "B.Tech"),
                branch_specialization=s("branch_specialization", "Computer Science"),
                current_semester=s("current_semester"),
                roll_number=s("roll_number"),
                start_date=s("start_date", today),
                end_date=s("end_date") or s("start_date", today),
                duration_months=int(float(r.get("duration_months") or 3)),
                internship_type=s("internship_type", "Full-time"),
                monthly_stipend=float(r.get("monthly_stipend") or 0),
                bank_name=s("bank_name"),
                account_no=s("account_no"),
                ifsc_code=s("ifsc_code"),
                status=s("status", "Ongoing")
            )
            intern = await InternService.create_intern(req)
            created.append(intern)
        except Exception as e:
            errors.append({"row": idx + 1, "name": r.get("full_name") or r.get("name"), "error": row_error(e)})
    return {
        "success": True,
        "inserted_count": len(created),
        "imported_count": len(created),
        "failed_count": len(errors),
        "errors": errors,
        "message": f"Successfully enrolled {len(created)} interns ({len(errors)} failed)."
    }

@router.get("/{intern_id}", response_model=InternResponse)
async def get_intern_details(
    intern_id: str,
    unmask: bool = Query(False, description="Whether to show unmasked banking info"),
    admin: Dict[str, Any] = Depends(get_current_admin),
):
    """Retrieve full profile of a specific intern."""
    doc = await InternService.get_intern_by_id(intern_id)
    if not doc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Intern not found.")
    return _intern_view(doc, unmask=unmask)

@router.put("/{intern_id}", response_model=InternResponse)
async def update_intern(
    intern_id: str,
    req: InternUpdateRequest,
    admin: Dict[str, Any] = Depends(get_current_admin)
):
    """Update intern profile, review rating, or feedback."""
    doc = await InternService.update_intern(intern_id, req)
    if not doc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Intern not found.")
    return _intern_view(doc)

@router.post("/{intern_id}/convert")
async def convert_intern_to_full_time(
    intern_id: str,
    req: InternConvertToEmployeeRequest,
    admin: Dict[str, Any] = Depends(get_current_admin)
):
    """
    Convert a successful intern directly into a Full-Time Employee.
    Carries over verified personal and banking details.
    """
    ok, msg, created_emp = await InternService.convert_to_full_time(intern_id, req)
    if not ok:
        code = status.HTTP_404_NOT_FOUND if msg == "Intern record not found." else status.HTTP_400_BAD_REQUEST
        raise HTTPException(status_code=code, detail=msg)
    # Bank numbers need their own permission to view; the conversion response doesn't bypass that.
    created_emp["account_no"] = mask_account_number(created_emp.get("account_no", ""))
    return {
        "success": True,
        "message": msg,
        "employee": created_emp
    }

@router.delete("/{intern_id}")
async def delete_intern(intern_id: str, admin: Dict[str, Any] = Depends(get_current_admin)):
    """Delete an intern record."""
    deleted = await InternService.delete_intern(intern_id)
    if not deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Intern not found.")
    return {"success": True, "message": "Intern deleted successfully."}

