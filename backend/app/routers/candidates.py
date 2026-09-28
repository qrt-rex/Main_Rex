import logging
from typing import Optional, Dict, Any, List
from fastapi import APIRouter, HTTPException, Depends, status, Query
from app.schemas.candidate import (
    CandidateCreateRequest,
    CandidateUpdateRequest,
    CandidateStatusUpdateRequest,
    CandidateResponse,
    CandidateListResponse
)
from app.services.candidate_service import CandidateService
from app.services.auth_service import get_current_admin
from app.services.email_service import EmailService
from app.services.log_service import LogService
from app.utils.validators import row_error

logger = logging.getLogger("rexera.router.candidates")
router = APIRouter(prefix="/api/candidates", tags=["Candidates & Recruitment"])

@router.post("", response_model=Dict[str, Any], include_in_schema=False)
@router.post("/", response_model=Dict[str, Any])
async def create_candidate(req: CandidateCreateRequest):
    """
    Public Candidate Interview Form submission endpoint.
    Allows job applicants to submit their application with dynamic education, experience & skill sets.
    """
    if await CandidateService.find_duplicate(req.email, req.position_applied):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT,
                            detail="You have already applied for this position. Our HR team will contact you.")
    try:
        created = await CandidateService.create_candidate(req)
        return {
            "success": True,
            "message": "Application submitted successfully! Our HR team will contact you shortly.",
            "candidate_id": created["id"]
        }
    except Exception as e:
        logger.error(f"Error submitting candidate application: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to submit application.")

@router.get("", response_model=CandidateListResponse, include_in_schema=False)
@router.get("/", response_model=CandidateListResponse)
async def get_candidates(
    search: Optional[str] = Query(None, description="Search by name, email, phone, position"),
    status: Optional[str] = Query(None, description="Filter by candidate status"),
    position: Optional[str] = Query(None, description="Filter by position"),
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=2000),
    sort_by: str = Query("created_at", pattern="^(created_at|updated_at|candidate_name|position_applied|status|interview_date)$"),
    sort_desc: bool = Query(True),
    admin: Dict[str, Any] = Depends(get_current_admin)
):
    """Admin endpoint to retrieve candidates with multi-field search and status filters."""
    docs, total = await CandidateService.get_candidates(
        search=search,
        status=status,
        position=position,
        page=page,
        limit=limit,
        sort_by=sort_by,
        sort_desc=sort_desc
    )
    return CandidateListResponse(
        total=total,
        page=page,
        limit=limit,
        candidates=[CandidateResponse(**d) for d in docs]
    )

@router.post("/bulk")
async def bulk_import_candidates(
    records: List[Dict[str, Any]],
    admin: Dict[str, Any] = Depends(get_current_admin)
):
    """Bulk import candidates from CSV / Excel parse results."""
    created = []
    errors = []
    for idx, r in enumerate(records):
        try:
            s = lambda *keys, default="": next((str(r[k]).strip() for k in keys if r.get(k) not in (None, "")), default)
            req = CandidateCreateRequest(
                candidate_name=s("candidate_name", "full_name", "name"),
                position_applied=s("position_applied", "designation", "role", default="General"),
                email=s("email"),
                contact_number=s("contact_number", "mobile_number", "phone"),
                interview_date=s("interview_date"),
                current_company=s("current_company"),
                total_experience=s("total_experience"),
                current_ctc=s("current_ctc"),
                expected_ctc=s("expected_ctc"),
                notice_period=s("notice_period", default="30 Days"),
                education=r.get("education") or [],
                work_experience=r.get("work_experience") or [],
                skills=r.get("skills") or [],
                declaration_accepted=True
            )
            if await CandidateService.find_duplicate(req.email, req.position_applied):
                raise ValueError(f"{req.email} has already applied for {req.position_applied}.")
            cand = await CandidateService.create_candidate(req)
            created.append(cand)
        except Exception as e:
            errors.append({"row": idx + 1, "name": r.get("candidate_name") or r.get("full_name"), "error": row_error(e)})
    return {
        "success": True,
        "inserted_count": len(created),
        "imported_count": len(created),
        "failed_count": len(errors),
        "errors": errors,
        "message": f"Successfully imported {len(created)} candidates into pipeline ({len(errors)} failed)."
    }

@router.get("/{candidate_id}", response_model=CandidateResponse)
async def get_candidate_details(candidate_id: str, admin: Dict[str, Any] = Depends(get_current_admin)):
    """Retrieve full profile details of a specific candidate."""
    doc = await CandidateService.get_candidate_by_id(candidate_id)
    if not doc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Candidate not found.")
    return CandidateResponse(**doc)

@router.put("/{candidate_id}", response_model=CandidateResponse)
async def update_candidate(
    candidate_id: str,
    req: CandidateUpdateRequest,
    admin: Dict[str, Any] = Depends(get_current_admin)
):
    """Update candidate profile information."""
    doc = await CandidateService.update_candidate(candidate_id, req)
    if not doc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Candidate not found.")
    return CandidateResponse(**doc)

@router.patch("/{candidate_id}/status", response_model=CandidateResponse)
async def update_candidate_status(
    candidate_id: str,
    req: CandidateStatusUpdateRequest,
    admin: Dict[str, Any] = Depends(get_current_admin)
):
    """Progress candidate status in recruitment pipeline."""
    if req.status in ("On Hold", "Rejected") and not (req.interview_notes and req.interview_notes.strip()):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"A reason is required when marking a candidate as '{req.status}'."
        )
    existing = await CandidateService.get_candidate_by_id(candidate_id)
    if not existing:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Candidate not found.")
    old_status = existing.get("status", "")

    doc = await CandidateService.update_candidate_status(candidate_id, req.status, req.interview_notes)
    if not doc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Candidate not found.")

    if old_status != req.status:
        await LogService.log_candidate_status_change(
            admin_email=admin.get("email", ""),
            admin_role=admin.get("role", "admin"),
            candidate_name=doc.get("candidate_name", ""),
            candidate_id=candidate_id,
            old_status=old_status,
            new_status=req.status,
            notes=req.interview_notes or "",
        )

    return CandidateResponse(**doc)

@router.delete("/{candidate_id}")
async def delete_candidate(candidate_id: str, admin: Dict[str, Any] = Depends(get_current_admin)):
    """Delete a candidate record."""
    deleted = await CandidateService.delete_candidate(candidate_id)
    if not deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Candidate not found.")
    return {"success": True, "message": "Candidate deleted successfully."}

