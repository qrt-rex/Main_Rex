from typing import Any, Dict, List

from fastapi import APIRouter, Depends

from app.database import get_collection
from app.services.auth_service import get_current_admin
from app.services.log_service import LogService
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

    if "hr.leave.approve" in granted:
        pending = await get_collection("leave_requests").find({"status": "PENDING"}).sort("created_at", -1).to_list(200)
        if pending:
            items.append({
                "id": f"leave-pending-{len(pending)}-{pending[0].get('_id')}",
                "type": "approval",
                "title": f"{len(pending)} leave request{'s' if len(pending) != 1 else ''} awaiting approval",
                "description": f"Latest from {pending[0].get('employee_name', 'an employee')}",
                "timestamp": pending[0].get("created_at"),
                "link": "/hr/leave",
            })

    if "hr.recruitment.view" in granted:
        items += [_event_item(log) for log in await LogService.get_notifications(limit=15)]

    if "hr.broadcasts.view" in granted:
        recent = await get_collection("broadcasts").find({}).sort("created_at", -1).to_list(5)
        items += [{
            "id": f"broadcast-{b.get('broadcast_id') or b.get('_id')}",
            "type": "broadcast",
            "title": b.get("title", "Announcement"),
            "description": f"Broadcast to {b.get('total_targeted_recipients', b.get('total_recipients', 0))} employees",
            "timestamp": b.get("created_at"),
            "link": "/hr/broadcasts",
        } for b in recent]

    items.sort(key=lambda i: str(i.get("timestamp") or ""), reverse=True)
    return {"items": items[:25]}
