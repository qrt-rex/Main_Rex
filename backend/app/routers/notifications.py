from typing import Any, Dict, List

from fastapi import APIRouter, Depends

from app.services.auth_service import get_current_admin
from app.services.log_service import LogService
from app.services import inbox
from app.services import rbac_service as rbac

router = APIRouter(prefix="/api/notifications", tags=["Notifications"])


def _event_item(log: Dict[str, Any]) -> Dict[str, Any]:
    d = log.get("details") or {}
    if log.get("action") == "ONBOARDING_COMPLETED":
        title = f"{log.get('target', 'A candidate')} completed onboarding"
        description = f"Employee code {d.get('employee_code', 'N/A')}"
        kind = "onboarding"
    else:
        title = f"{log.get('target', 'Candidate')}: {d.get('old_status', '')} → {d.get('new_status', '')}".strip()
        description = d.get("notes") or f"Updated by {log.get('performed_by', 'HR')}"
        kind = "recruitment"
    return {"id": log["id"], "type": kind, "title": title, "description": description,
            "timestamp": log.get("timestamp"), "link": "/hr/recruitment"}


@router.get("")
async def my_notifications(admin: Dict[str, Any] = Depends(get_current_admin)):
    """Feed built only from what the caller is allowed to see."""
    granted = await rbac.get_user_permissions(admin)
    items: List[Dict[str, Any]] = []

    # Requests waiting on this user as the superior who decides them, and the outcome of their own.
    items += await inbox.approvals_for(admin)
    items += await inbox.updates_for(admin)
    items += await inbox.broadcast_items(admin)
    items += await inbox.new_content_for(admin)

    if "hr.recruitment.view" in granted:
        items += [_event_item(log) for log in await LogService.get_notifications(limit=15)]

    items.sort(key=lambda i: str(i.get("timestamp") or ""), reverse=True)
    return {"items": items[:40]}
