"""
What each person needs to act on, and what happened to what they asked for.

approvals_for(user): requests waiting on *this* user as the superior who decides them
  * leave: staff and sales -> HR, HR -> Admin, Admin -> Super Admin (leave_service routing);
    never your own request
  * invoice requests from sales -> billing managers (billing.manage)
  * client document forms submitted by staff -> the Legal team
updates_for(user): the outcome of this user's own requests over the last 30 days.
broadcast_items(user): broadcasts sent to them (acknowledge from the bell) and, for the sender, how many
  have acknowledged.
new_content_for(user): new schemes, flyers/posts, sales information and leads assigned to them.

Both feed the notification bell and the dashboards, so a request shows up for the right superior
without any extra wiring in the modules that create it.
"""
from datetime import datetime, timedelta
from typing import Any, Dict, List

from app.database import get_collection
from app.services.broadcast_service import BroadcastService
from app.services import rbac_service as rbac
from app.services.leave_service import can_decide

RECENT_DAYS = 30
NEW_CONTENT_DAYS = 14


def _email(user: Dict[str, Any]) -> str:
    return str(user.get("email") or "").strip().lower()


def _ts(v: Any) -> str:
    return v.isoformat() if isinstance(v, datetime) else str(v or "")


def _item(kind: str, id_: str, title: str, description: str, timestamp: Any, link: str) -> Dict[str, Any]:
    return {"id": id_, "type": kind, "title": title, "description": description, "timestamp": _ts(timestamp),
            "link": link, "tone": "warning" if kind == "approval" else "info"}


async def approvals_for(user: Dict[str, Any]) -> List[Dict[str, Any]]:
    granted = await rbac.get_user_permissions(user)
    roles = rbac.user_roles(user)
    me = _email(user)
    items: List[Dict[str, Any]] = []

    if "hr.leave.approve" in granted:
        for lv in await get_collection("leave_requests").find({"status": "PENDING"}).sort("created_at", -1).to_list(200):
            own = me and me == str(lv.get("employee_email") or "").strip().lower()
            if can_decide(lv, roles) and (not own or rbac.SUPERADMIN in roles):
                items.append(_item("approval", f"leave-{lv.get('_id')}",
                                   f"{lv.get('employee_name') or 'An employee'} asked for {lv.get('leave_type', '')} leave",
                                   f"{lv.get('start_date')} to {lv.get('end_date')} · {lv.get('total_days') or 0} day(s) · {lv.get('reason') or ''}".strip(" ·"),
                                   lv.get("created_at"), "/hr/leave"))

    if "billing.manage" in granted:
        for r in await get_collection("billing_requests").find({"status": "pending"}).sort("created_at", -1).to_list(100):
            if str(r.get("requested_by") or "").lower() == me:
                continue
            items.append(_item("approval", f"invoice-request-{r.get('id')}",
                               f"{r.get('requested_by_name') or r.get('requested_by')} requested an invoice",
                               f"{r.get('request_number')} · {r.get('billing_name')} · ₹{float(r.get('estimated_total') or 0):,.2f}",
                               r.get("created_at"), "/billing/requests"))

    if "legal.manage" in granted or rbac.has_role(user, "legal"):
        for d in await get_collection("client_documents").find({"status": "PENDING"}).sort("created_at", -1).to_list(100):
            if str(d.get("submitted_by_email") or "").lower() == me:
                continue
            items.append(_item("approval", f"client-docs-{d.get('_id')}",
                               f"{d.get('submitted_by_name') or 'Staff'} submitted client documents for review",
                               f"{d.get('reference')} · {d.get('company_name') or d.get('name') or 'Client'}",
                               d.get("created_at"), "/legal"))

    items.sort(key=lambda i: i["timestamp"], reverse=True)
    return items


async def updates_for(user: Dict[str, Any]) -> List[Dict[str, Any]]:
    me = _email(user)
    if not me:
        return []
    since = (datetime.utcnow() - timedelta(days=RECENT_DAYS)).isoformat()
    items: List[Dict[str, Any]] = []

    for lv in await get_collection("leave_requests").find({"status": {"$in": ["APPROVED", "REJECTED"]}}).to_list(2000):
        when = _ts(lv.get("action_timestamp") or lv.get("updated_at"))
        if str(lv.get("employee_email") or "").strip().lower() == me and when >= since:
            verdict = "approved" if lv.get("status") == "APPROVED" else "rejected"
            note = f" · {lv['rejection_reason']}" if lv.get("rejection_reason") else ""
            items.append(_item("update", f"leave-decided-{lv.get('_id')}", f"Your {lv.get('leave_type', '')} leave was {verdict}",
                               f"{lv.get('start_date')} to {lv.get('end_date')} · by {lv.get('action_by_name') or 'your approver'}{note}",
                               when, "/hr/leave"))

    for r in await get_collection("billing_requests").find({"requested_by": me}).to_list(500):
        when = _ts(r.get("reviewed_at"))
        if r.get("status") in ("approved", "rejected") and when >= since:
            done = f"approved as invoice {r.get('invoice_number')}" if r.get("status") == "approved" else "rejected"
            items.append(_item("update", f"invoice-request-decided-{r.get('id')}", f"Your invoice request {r.get('request_number')} was {done}",
                               f"{r.get('billing_name')} · by {r.get('reviewed_by') or 'billing'}", when, "/billing/requests"))

    for d in await get_collection("client_documents").find({"submitted_by_email": user.get("email", "")}).to_list(200):
        when = _ts(d.get("reviewed_at"))
        if d.get("status") not in (None, "PENDING") and when >= since:
            note = f" · {d['legal_note']}" if d.get("legal_note") else ""
            items.append(_item("update", f"client-docs-reviewed-{d.get('_id')}-{d.get('status')}",
                               f"Legal marked {d.get('reference')} as {str(d.get('status')).title()}",
                               f"{d.get('company_name') or d.get('name') or 'Client'}{note}", when, "/dashboard"))

    items.sort(key=lambda i: i["timestamp"], reverse=True)
    return items


async def broadcast_items(user: Dict[str, Any]) -> List[Dict[str, Any]]:
    since = (datetime.utcnow() - timedelta(days=RECENT_DAYS)).isoformat()
    my_id = str(user.get("id") or user.get("_id") or "")
    code = await BroadcastService.employee_code_for_account(user)
    receipts = {r.get("broadcast_id"): r for r in await get_collection("broadcast_receipts").find({"employee_id": code}).to_list(500)}
    items: List[Dict[str, Any]] = []
    for b in await get_collection("broadcasts").find({}).sort("created_at", -1).to_list(300):
        when = _ts(b.get("created_at"))
        if when < since:
            continue
        bid = b.get("broadcast_id")
        mine = receipts.get(bid)
        if mine:
            needs_ack = bool(b.get("requires_acknowledgment")) and not mine.get("is_acknowledged")
            state = "Please acknowledge" if needs_ack else "Acknowledged" if mine.get("is_acknowledged") else f"From {b.get('created_by_name') or 'HR'}"
            items.append({**_item("broadcast", f"broadcast-{bid}", b.get("title") or "Announcement",
                                  f"{str(b.get('priority') or 'INFO').title()} · {state}", when, "/notifications"),
                          "broadcast_id": bid, "needs_ack": needs_ack, "body": b.get("rich_html_content") or ""})
        if b.get("requires_acknowledgment") and str(b.get("created_by_id")) == my_id:
            rs = await get_collection("broadcast_receipts").find({"broadcast_id": bid}).to_list(5000)
            acked = [r for r in rs if r.get("is_acknowledged")]
            latest = max([_ts(r.get("acknowledged_at")) for r in acked] or [when])
            # The id changes with the count, so each new acknowledgement shows as unread for the sender.
            items.append(_item("update", f"broadcast-acks-{bid}-{len(acked)}",
                               f"{len(acked)} of {len(rs)} employees acknowledged \"{b.get('title')}\"",
                               "Your broadcast · Broadcasts shows who has confirmed", latest, "/hr/broadcasts"))
    return items


async def client_work_items(user: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Notifications the client work module generated for this user (assigned, on hold, completed, overdue…)."""
    if "clientwork.view" not in await rbac.get_user_permissions(user):
        return []
    uid = str(user.get("id") or user.get("_id") or "")
    since = (datetime.utcnow() - timedelta(days=RECENT_DAYS)).isoformat()
    rows = await get_collection("client_work_notifications").find({"user_id": uid}).sort("created_at", -1).to_list(100)
    return [_item("update", f"client-work-{n.get('_id')}", n.get("title") or "Client work", n.get("message") or "",
                  n.get("created_at"), n.get("link") or "/client-work")
            for n in rows if _ts(n.get("created_at")) >= since]


async def new_content_for(user: Dict[str, Any]) -> List[Dict[str, Any]]:
    if "sales.hub.view" not in await rbac.get_user_permissions(user):
        return []
    since = (datetime.utcnow() - timedelta(days=NEW_CONTENT_DAYS)).isoformat()
    me, my_id = _email(user), str(user.get("id") or user.get("_id") or "")
    items: List[Dict[str, Any]] = []
    for s in await get_collection("sales_schemes").find({"active": True}).to_list(200):
        if _ts(s.get("created_at")) >= since and str(s.get("created_by") or "").lower() != me:
            items.append(_item("update", f"scheme-{s.get('_id')}", f"New scheme: {s.get('title')}",
                               (s.get("description") or "")[:140], s.get("created_at"), "/dashboard"))
    for m in await get_collection("sales_materials").find({"active": True}).to_list(200):
        if _ts(m.get("created_at")) >= since and str(m.get("created_by") or "").lower() != me:
            what = "sales information" if m.get("kind") == "SALES_INFO" else "flyer / post"
            items.append(_item("update", f"material-{m.get('_id')}", f"New {what}: {m.get('title')}",
                               (m.get("description") or "")[:140], m.get("created_at"), "/dashboard"))
    for lead in await get_collection("sales_leads").find({"assigned_to.user_id": my_id}).to_list(2000):
        if _ts(lead.get("created_at")) >= since and str(lead.get("created_by") or "").lower() != me:
            who = lead.get("name") or lead.get("company") or lead.get("phone")
            items.append(_item("update", f"lead-{lead.get('_id')}", f"New lead assigned to you: {who}",
                               " · ".join(x for x in (lead.get("company"), lead.get("service_interest")) if x),
                               lead.get("created_at"), "/dashboard"))
    return items
