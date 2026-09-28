import re
import uuid
import logging
from datetime import datetime
from typing import Dict, Any, List, Optional

from app.database import get_collection, fix_id, fix_ids
from app.schemas.broadcast import (
    CreateBroadcastRequest,
    BroadcastMessage,
    BroadcastRecipientReceipt,
    InAppNotification,
    BroadcastAudienceType,
    BroadcastPriority
)

logger = logging.getLogger("rexera.broadcast")


class BroadcastService:
    @classmethod
    async def resolve_target_recipients(cls, payload: CreateBroadcastRequest) -> List[Dict[str, Any]]:
        emp_col = get_collection("employees")
        # Only current staff: people who resigned or were terminated don't receive company notices.
        filter_q: Dict[str, Any] = {"employee_status": {"$in": ["Active", "Probation"]}}

        if payload.audience_type == BroadcastAudienceType.DEPARTMENT:
            if not payload.target_departments:
                raise ValueError("Please specify at least one department.")
            filter_q["department"] = {"$in": payload.target_departments}

        elif payload.audience_type == BroadcastAudienceType.BRANCH:
            branches = [b.strip() for b in (payload.target_branches or []) if b and b.strip()]
            if not branches:
                raise ValueError("Please specify at least one branch.")
            filter_q["branch"] = {"$in": branches}

        elif payload.audience_type == BroadcastAudienceType.CUSTOM_LIST:
            if not payload.target_employee_ids:
                raise ValueError("Please specify at least one employee ID.")
            filter_q["$or"] = [
                {"employee_code": {"$in": payload.target_employee_ids}},
                {"employee_id": {"$in": payload.target_employee_ids}},
                {"_id": {"$in": payload.target_employee_ids}}
            ]

        recipients = await emp_col.find(filter_q).to_list(5000)
        if not recipients:
            raise ValueError("No active employees found matching the specified audience criteria.")

        return recipients

    @classmethod
    async def create_and_publish_broadcast(
        cls,
        payload: CreateBroadcastRequest,
        admin_user: Dict[str, Any]
    ) -> Dict[str, Any]:
        recipients = await cls.resolve_target_recipients(payload)
        broadcast_id = str(uuid.uuid4())
        
        broadcast_col = get_collection("broadcasts")
        receipt_col = get_collection("broadcast_receipts")
        notif_col = get_collection("notifications")

        total_recipients = len(recipients)
        now_utc = datetime.utcnow()

        broadcast_doc = BroadcastMessage(
            broadcast_id=broadcast_id,
            title=payload.title,
            rich_html_content=payload.rich_html_content,
            priority=payload.priority,
            audience_type=payload.audience_type,
            target_departments=payload.target_departments or [],
            target_branches=payload.target_branches or [],
            target_employee_ids=payload.target_employee_ids or [],
            requires_acknowledgment=payload.requires_acknowledgment,
            total_targeted_recipients=total_recipients,
            created_by_id=str(admin_user.get("_id", admin_user.get("id"))),
            created_by_name=admin_user.get("username") or admin_user.get("email") or "HR Admin",
            created_at=now_utc
        )
        await broadcast_col.insert_one(broadcast_doc.dict(by_alias=True))

        receipt_records = []
        notification_records = []

        for emp in recipients:
            emp_id = emp.get("employee_code") or emp.get("employee_id") or str(emp.get("_id"))
            emp_name = emp.get("full_name") or emp.get("name") or "Employee"
            
            receipt_records.append(
                BroadcastRecipientReceipt(
                    broadcast_id=broadcast_id,
                    employee_id=emp_id,
                    employee_name=emp_name,
                    employee_email=emp.get("email"),
                    department=emp.get("department", "General"),
                    is_delivered=True
                ).dict(by_alias=True)
            )

            notification_records.append(
                InAppNotification(
                    recipient_employee_id=emp_id,
                    title=f"📢 {payload.title}",
                    message_preview=payload.title,
                    reference_id=broadcast_id,
                    priority=payload.priority,
                    requires_action=payload.requires_acknowledgment
                ).dict(by_alias=True)
            )

        for r in receipt_records:
            await receipt_col.insert_one(r)
        for n in notification_records:
            await notif_col.insert_one(n)

        return {
            "broadcast_id": broadcast_id,
            "title": payload.title,
            "rich_html_content": payload.rich_html_content,
            "priority": payload.priority.value,
            "requires_acknowledgment": payload.requires_acknowledgment,
            "total_recipients": total_recipients,
            "recipients_list": [
                {"email": e.get("email"), "name": e.get("full_name") or e.get("name") or "Colleague",
                 "id": e.get("employee_code") or e.get("employee_id") or str(e.get("_id"))}
                for e in recipients if e.get("email")
            ]
        }

    @classmethod
    async def employee_code_for_account(cls, account: Dict[str, Any]) -> str:
        """Receipts and notifications are keyed by employee code; a signed-in account is matched by email."""
        if account.get("employee_id"):
            return account["employee_id"]
        email = (account.get("email") or "").strip()
        if email:
            emp = await get_collection("employees").find_one(
                {"email": {"$regex": f"^{re.escape(email)}$", "$options": "i"}})
            if emp:
                return emp.get("employee_code") or emp.get("employee_id") or str(emp.get("_id"))
        return email

    @classmethod
    async def acknowledge_broadcast(cls, broadcast_id: str, employee_id: str) -> Dict[str, Any]:
        receipt_col = get_collection("broadcast_receipts")
        broadcast_col = get_collection("broadcasts")

        receipt = await receipt_col.find_one({"broadcast_id": broadcast_id, "employee_id": employee_id})
        if not receipt:
            raise ValueError("Receipt record not found for this employee.")
        if receipt.get("is_acknowledged"):
            return {"success": True, "message": "Broadcast was already acknowledged."}

        now_utc = datetime.utcnow()
        res = await receipt_col.update_one(
            {"_id": receipt["_id"]},
            {
                "$set": {
                    "is_read": True,
                    "read_at": now_utc,
                    "is_acknowledged": True,
                    "acknowledged_at": now_utc
                }
            }
        )

        if res.matched_count == 0:
            raise ValueError("Receipt record not found for this employee.")

        inc = {"acknowledged_count": 1}
        if not receipt.get("is_read"):
            inc["read_count"] = 1
        await broadcast_col.update_one({"broadcast_id": broadcast_id}, {"$inc": inc})

        return {"success": True, "message": "Broadcast acknowledged successfully."}

    @classmethod
    async def get_broadcast_analytics(cls, broadcast_id: str) -> Dict[str, Any]:
        broadcast_col = get_collection("broadcasts")
        receipt_col = get_collection("broadcast_receipts")

        b_doc = await broadcast_col.find_one({"broadcast_id": broadcast_id})
        if not b_doc:
            raise ValueError("Broadcast not found.")

        receipts = await receipt_col.find({"broadcast_id": broadcast_id}).to_list(5000)

        total = len(receipts)
        read_cnt = sum(1 for r in receipts if r.get("is_read") is True)
        ack_cnt = sum(1 for r in receipts if r.get("is_acknowledged") is True)

        read_pct = round((read_cnt / total * 100.0), 1) if total > 0 else 0.0
        ack_pct = round((ack_cnt / total * 100.0), 1) if total > 0 else 0.0

        return {
            "broadcast_id": broadcast_id,
            "title": b_doc.get("title"),
            "priority": b_doc.get("priority"),
            "requires_acknowledgment": b_doc.get("requires_acknowledgment"),
            "created_at": b_doc.get("created_at"),
            "total_recipients": total,
            "read_count": read_cnt,
            "read_percentage": read_pct,
            "acknowledged_count": ack_cnt,
            "acknowledged_percentage": ack_pct,
            "receipts_breakdown": [
                {
                    "employee_name": r.get("employee_name"),
                    "employee_id": r.get("employee_id"),
                    "department": r.get("department"),
                    "is_read": r.get("is_read"),
                    "read_at": r.get("read_at"),
                    "is_acknowledged": r.get("is_acknowledged"),
                    "acknowledged_at": r.get("acknowledged_at")
                }
                for r in receipts
            ]
        }
