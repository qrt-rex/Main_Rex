from fastapi import APIRouter, HTTPException, BackgroundTasks, Depends, status
from typing import Dict, Any

from app.schemas.broadcast import CreateBroadcastRequest
from app.services.broadcast_service import BroadcastService
from app.services.broadcast_email_worker import BroadcastBatchEmailWorker
from app.services.auth_service import get_current_user
from app.database import get_collection

router = APIRouter(prefix="/api/broadcasts", tags=["Company Broadcasts & Announcements"])


@router.post("/publish", status_code=status.HTTP_202_ACCEPTED)
async def publish_broadcast(
    payload: CreateBroadcastRequest,
    background_tasks: BackgroundTasks = BackgroundTasks(),
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    try:
        res = await BroadcastService.create_and_publish_broadcast(payload, admin_user=current_user)
    except ValueError as ve:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(ve))

    if payload.send_email and res.get("recipients_list"):
        background_tasks.add_task(
            BroadcastBatchEmailWorker.dispatch_broadcast_in_batches,
            broadcast_id=res["broadcast_id"],
            title=res["title"],
            rich_html_content=res["rich_html_content"],
            priority=res["priority"],
            requires_ack=res["requires_acknowledgment"],
            recipients_list=res["recipients_list"]
        )

    return {
        "success": True,
        "broadcast_id": res["broadcast_id"],
        "message": f"Broadcast published to {res['total_recipients']} employee(s). In-app alerts delivered, emails queued.",
        "total_recipients": res["total_recipients"]
    }


@router.post("/acknowledge/{broadcast_id}", status_code=status.HTTP_200_OK)
async def acknowledge_broadcast_message(
    broadcast_id: str,
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    emp_id = await BroadcastService.employee_code_for_account(current_user)
    try:
        return await BroadcastService.acknowledge_broadcast(broadcast_id, emp_id)
    except ValueError as ve:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(ve))


@router.get("", status_code=status.HTTP_200_OK, include_in_schema=False)
@router.get("/", status_code=status.HTTP_200_OK)
async def list_broadcasts(current_user: Dict[str, Any] = Depends(get_current_user)):
    """Broadcast history (newest first) with read/acknowledge analytics for each."""
    docs = await get_collection("broadcasts").find({}).sort("created_at", -1).to_list(200)
    history = []
    for d in docs:
        try:
            info = await BroadcastService.get_broadcast_analytics(d.get("broadcast_id"))
        except ValueError:
            continue
        info.pop("receipts_breakdown", None)
        info["audience_type"] = d.get("audience_type")
        info["target_departments"] = d.get("target_departments") or []
        info["target_branches"] = d.get("target_branches") or []
        history.append(info)
    return {"success": True, "data": history}

