"""
Operation dashboard notifications and follow-up reminders.

Notifications land in `operation_notifications` (one row per person) and reach the bell and the
dashboard's Notifications tab through inbox.operation_items.

Reminders are `crm_activities` rows (type CALL or EMAIL), the activity shape the CRM plan uses, so
Sales activities can share the collection later: {type, subject, body, due_at, done_at, owner,
created_by, created_at, related: {kind: "operation_case", id: "<kind>:<client id>", label}}.
When one falls due, its owner is notified in the app and by email, once (`reminder_sent_at`).
"""
import logging
import uuid
from datetime import datetime
from html import escape
from typing import Any, Dict, List, Optional

from app.database import get_collection
from app.services.email_service import EmailService

logger = logging.getLogger("rexera.operations")

CASE_KIND = "operation_case"
REMINDER_TYPES = {"CALL": "Call", "EMAIL": "Email"}
LINK = "/operations"


def now_iso() -> str:
    return datetime.utcnow().isoformat()


async def notify(user_id: str, title: str, message: str = "", *, link: str = LINK) -> None:
    if not user_id:
        return
    await get_collection("operation_notifications").insert_one(
        {"_id": uuid.uuid4().hex, "user_id": user_id, "title": title, "message": message, "link": link, "created_at": now_iso()})


async def email(to: str, subject: str, html: str) -> None:
    if not to:
        return
    try:
        await EmailService.send_email(to_email=to, subject=subject, html_content=html)
    except Exception as e:  # the notification in the app still stands
        logger.warning(f"Operations email to {to} failed: {e}")


async def case_reminders(case_key: str) -> List[Dict[str, Any]]:
    rows = [r for r in await get_collection("crm_activities").find({}).to_list(100000)
            if (r.get("related") or {}).get("kind") == CASE_KIND and (r.get("related") or {}).get("id") == case_key]
    return sorted(rows, key=lambda r: str(r.get("due_at") or ""))


async def open_reminders(owner_id: Optional[str] = None) -> List[Dict[str, Any]]:
    rows = [r for r in await get_collection("crm_activities").find({}).to_list(100000)
            if (r.get("related") or {}).get("kind") == CASE_KIND and not r.get("done_at")
            and (owner_id is None or (r.get("owner") or {}).get("user_id") == owner_id)]
    return sorted(rows, key=lambda r: str(r.get("due_at") or ""))


async def send_due_reminders(now: Optional[datetime] = None) -> int:
    """Tell each owner about reminders that have fallen due: in the app and by email, once each."""
    at = (now or datetime.utcnow()).isoformat()
    sent = 0
    for r in await open_reminders():
        if r.get("reminder_sent_at") or str(r.get("due_at") or "") > at:
            continue
        owner = r.get("owner") or {}
        what = REMINDER_TYPES.get(r.get("type"), "Follow up")
        client = (r.get("related") or {}).get("label") or "the client"
        title = f"{what} reminder: {client}"
        await notify(owner.get("user_id", ""), title, r.get("body") or r.get("subject") or "")
        verb = "call" if r.get("type") == "CALL" else "email"
        await email(owner.get("email", ""), title,
                    f"<p>Dear {escape(owner.get('name') or 'colleague')},</p>"
                    f"<p>This is your reminder to {verb} <b>{escape(client)}</b> for further inquiry and follow-up.</p>"
                    + (f"<p>Note: {escape(r.get('body') or '')}</p>" if r.get("body") else "")
                    + "<p>Open the Operation dashboard in Rex CRM to see the case and mark the reminder done.</p>")
        await get_collection("crm_activities").update_one({"_id": r["_id"]}, {"$set": {"reminder_sent_at": now_iso()}})
        sent += 1
    return sent
