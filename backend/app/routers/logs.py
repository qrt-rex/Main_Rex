import logging
from typing import Optional, Dict, Any
from fastapi import APIRouter, Depends, Query
from app.schemas.logs import LogEntry, LogListResponse
from app.services.log_service import LogService
from app.services.auth_service import get_current_admin

logger = logging.getLogger("rexera.router.logs")
router = APIRouter(prefix="/api/logs", tags=["Activity Logs"])


@router.get("", response_model=LogListResponse, include_in_schema=False)
@router.get("/", response_model=LogListResponse)
async def get_activity_logs(
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=200),
    action: Optional[str] = Query(None, description="Filter by action type"),
    search: Optional[str] = Query(None, description="Search by performer, target, or action"),
    date_from: Optional[str] = Query(None, description="Filter from date (ISO format)"),
    date_to: Optional[str] = Query(None, description="Filter to date (ISO format)"),
    admin: Dict[str, Any] = Depends(get_current_admin),
):
    """
    Retrieve paginated activity logs.
    Superadmins see all logs; regular HR admins see only their own logs.
    """
    role = admin.get("role", "admin")
    performed_by = None
    if role != "superadmin":
        performed_by = admin.get("email")

    docs, total = await LogService.get_logs(
        page=page,
        limit=limit,
        action_filter=action,
        search=search,
        performed_by=performed_by,
        date_from=date_from,
        date_to=date_to,
    )

    return LogListResponse(
        total=total,
        page=page,
        limit=limit,
        logs=[LogEntry(**d) for d in docs],
    )


@router.get("/export")
async def export_logs_csv(
    action: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    admin: Dict[str, Any] = Depends(get_current_admin),
):
    """Export activity logs as JSON (frontend handles CSV conversion)."""
    role = admin.get("role", "admin")
    performed_by = None
    if role != "superadmin":
        performed_by = admin.get("email")

    docs, total = await LogService.get_logs(
        page=1,
        limit=5000,
        action_filter=action,
        search=search,
        performed_by=performed_by,
        date_from=date_from,
        date_to=date_to,
    )

    return {
        "success": True,
        "total": total,
        "logs": docs,
    }
