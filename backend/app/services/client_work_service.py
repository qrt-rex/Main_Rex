"""
Client work lifecycle: Legal assigns a client to a member, the member works it through
NEED_ACTION -> IN_PROGRESS -> (ON_HOLD -> NEED_ACTION ->) COMPLETED, and Legal / Super Admin watch it.

Collections (all in the existing document store):
  client_work                   one record per piece of work (counters, status, version, current hold)
  client_tasks                  the tasks of a work
  client_work_status_history    every status change (append-only)
  client_work_activity          the audit trail: who, role, action, old/new value, comment (append-only)
  client_work_hold_history      every hold period: reason, what is needed from the client, start/end
  client_work_documents         document / information requests to the client and the files received
  client_work_files             file bytes (base64), kept apart so listings stay light
  client_work_comments          comments, internal notes and issues
  client_work_notifications     per-user notifications generated from events
  client_work_time_logs         lifecycle timestamps (assigned, started, hold, resume, completed)
  client_work_active            one marker per client with open work: the primary key makes a
                                second concurrent "create work for this client" fail instead of duplicating

Consistency rules:
  * the history / activity / time-log collections are only ever inserted into;
  * durations are computed from server timestamps and clamped at 0;
  * task counters and progress are recomputed from the tasks, never incremented;
  * each work has a `version`; every write is compare-and-swap on it, and one in-process lock per
    work serialises the read-modify-write cycle;
  * a repeated request carrying the same Idempotency-Key replays instead of repeating its effects.
"""
import asyncio
import base64
import logging
import os
import time
import uuid
import weakref
from contextlib import asynccontextmanager
from datetime import date, datetime, timedelta
from typing import Any, Dict, List, Optional, Set, Tuple

import pytz
from fastapi import HTTPException

from app.config import settings
from app.database import get_collection
from app.services import rbac_service as rbac
from app.services.audit_service import AuditService
from app.services.client_work_live import hub

logger = logging.getLogger("rexera.client_work")

# ------------------------------------------------------------------ vocabulary
NEED_ACTION, IN_PROGRESS, ON_HOLD, COMPLETED, CANCELLED = "NEED_ACTION", "IN_PROGRESS", "ON_HOLD", "COMPLETED", "CANCELLED"
ASSIGNED = "ASSIGNED"  # the instant a record exists; it is NEED_ACTION as soon as it is saved
ACTIVE = (NEED_ACTION, IN_PROGRESS, ON_HOLD)
PRIORITIES = ["CRITICAL", "HIGH", "MEDIUM", "LOW"]
PRIORITY_RANK = {p: i for i, p in enumerate(PRIORITIES)}
TASK_STATUSES = ["PENDING", "IN_PROGRESS", "WAITING_FOR_CLIENT", "COMPLETED", "CANCELLED"]
HOLD_WAITING, HOLD_INTERNAL = "WAITING_FOR_CLIENT", "INTERNAL_BLOCKER"
HOLD_LABELS = {HOLD_WAITING: "ON HOLD - WAITING FOR CLIENT", HOLD_INTERNAL: "ON HOLD - INTERNAL BLOCKER"}
BUCKETS = {NEED_ACTION: "need_action", IN_PROGRESS: "need_action", ON_HOLD: "on_hold", COMPLETED: "completed"}
DUE_SOON_DAYS = 3
DEFAULT_DEADLINE_DAYS = 7

# The controlled workflow. Anything else needs the clientwork.admin override below.
TRANSITIONS: Dict[str, Set[str]] = {
    ASSIGNED: {NEED_ACTION},
    NEED_ACTION: {IN_PROGRESS, COMPLETED},
    IN_PROGRESS: {ON_HOLD, COMPLETED},
    ON_HOLD: {NEED_ACTION},
    COMPLETED: set(),
    CANCELLED: set(),
}
OVERRIDE_TRANSITIONS: Dict[str, Set[str]] = {
    NEED_ACTION: {ON_HOLD, CANCELLED},
    IN_PROGRESS: {NEED_ACTION, CANCELLED},
    ON_HOLD: {IN_PROGRESS, COMPLETED, CANCELLED},
    COMPLETED: {NEED_ACTION},   # reopen; the completion stays in completion_history
    CANCELLED: {NEED_ACTION},
}

ALLOWED_EXT = {".pdf", ".jpg", ".jpeg", ".png", ".webp", ".doc", ".docx", ".xls", ".xlsx", ".csv", ".ppt", ".pptx", ".txt"}
MAX_FILE_BYTES = 10 * 1024 * 1024
KINDS = {"record": "legal_records", "document": "client_documents"}
MAX_IDEM_KEYS = 60


# ------------------------------------------------------------------ small helpers
def _col(name: str):
    return get_collection(name)


def now_dt() -> datetime:
    return datetime.utcnow()


def now_iso() -> str:
    return now_dt().isoformat()


def parse_dt(value: Any) -> Optional[datetime]:
    if not value:
        return None
    if isinstance(value, datetime):
        return value.replace(tzinfo=None)
    try:
        d = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    if d.tzinfo is not None:
        d = d.astimezone(pytz.utc).replace(tzinfo=None)
    return d


def local_today() -> date:
    try:
        tz = pytz.timezone(settings.AUTOMATION_TIMEZONE)
    except Exception:
        tz = pytz.utc
    return datetime.now(pytz.utc).astimezone(tz).date()


def to_local(dt: datetime) -> datetime:
    try:
        tz = pytz.timezone(settings.AUTOMATION_TIMEZONE)
    except Exception:
        tz = pytz.utc
    return pytz.utc.localize(dt).astimezone(tz)


def seconds_between(start: Optional[datetime], end: Optional[datetime]) -> int:
    """Never negative, whatever order two timestamps arrive in."""
    if not start or not end:
        return 0
    return max(0, int((end - start).total_seconds()))


def parse_date(value: Any, field: str = "date") -> Optional[str]:
    if value in (None, ""):
        return None
    try:
        return date.fromisoformat(str(value)[:10]).isoformat()
    except ValueError:
        raise HTTPException(status_code=422, detail=f"{field} must be a date like 2026-10-05.")


def _bad(detail: str, code: int = 422):
    raise HTTPException(status_code=code, detail=detail)


def _clean(value: Any, label: str, required: bool = False, max_len: int = 2000) -> str:
    v = str(value or "").strip()
    if required and not v:
        _bad(f"{label} is required.")
    if len(v) > max_len:
        _bad(f"{label} is too long (max {max_len} characters).")
    return v


def public(doc: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    if not doc:
        return None
    out = {k: v for k, v in doc.items() if k not in ("_id", "idem_keys", "data_b64")}
    out["id"] = str(doc["_id"])
    return out


# ------------------------------------------------------------------ actors and access
def actor_of(user: Dict[str, Any]) -> Dict[str, str]:
    role = rbac.normalize_role(user.get("role"))
    labels = {r["id"]: r["label"] for r in rbac.ROLES}
    return {"user_id": str(user.get("_id") or user.get("id") or ""), "name": user.get("username") or user.get("email", ""),
            "email": user.get("email", ""), "role": role, "role_label": labels.get(role, role)}


SYSTEM = {"user_id": "", "name": "System", "email": "", "role": "system", "role_label": "System"}


class Access:
    """What the signed-in user may do with client work, resolved once per request."""
    def __init__(self, user: Dict[str, Any], perms: Set[str]):
        self.user = user
        self.actor = actor_of(user)
        self.uid = self.actor["user_id"]
        self.admin = "clientwork.admin" in perms
        self.monitor = self.admin or "clientwork.monitor" in perms
        self.perms = perms

    def sees(self, work: Dict[str, Any]) -> bool:
        return self.monitor or work.get("assignee_id") == self.uid

    def acts(self, work: Dict[str, Any]) -> bool:
        return self.admin or work.get("assignee_id") == self.uid


async def access_for(user: Dict[str, Any]) -> Access:
    return Access(user, await rbac.get_user_permissions(user))


# ------------------------------------------------------------------ locking
_locks: "weakref.WeakValueDictionary[str, asyncio.Lock]" = weakref.WeakValueDictionary()


@asynccontextmanager
async def locked(key: str):
    lock = _locks.get(key)
    if lock is None:
        lock = asyncio.Lock()
        _locks[key] = lock
    async with lock:
        yield


# ------------------------------------------------------------------ append-only records
async def log_activity(work: Dict[str, Any], actor: Dict[str, str], action: str, summary: str, *, old: Any = None, new: Any = None,
                       comment: str = "", task_id: Optional[str] = None, at: Optional[str] = None) -> None:
    await _col("client_work_activity").insert_one({
        "work_id": str(work["_id"]), "client_id": work.get("client_id"), "task_id": task_id, "at": at or now_iso(),
        "user_id": actor["user_id"], "user_name": actor["name"], "role": actor["role_label"], "action": action,
        "summary": summary, "old_value": old, "new_value": new, "comment": comment})
    # Important events are mirrored into the CRM-wide audit log shown in Administration > Activity log.
    if action in AUDITED:
        try:
            await AuditService.log_action(actor["email"] or actor["name"], actor["role"], f"CLIENT_WORK_{action}", "client_work",
                                          str(work["_id"]), work.get("client_name"), old, new)
        except Exception:  # the lifecycle record above is the source of truth
            logger.exception("audit mirror failed")


AUDITED = {"ASSIGNED", "REASSIGNED", "STATUS_CHANGED", "HOLD_STARTED", "HOLD_ENDED", "COMPLETED", "REOPENED", "CANCELLED",
           "PRIORITY_CHANGED", "DEADLINE_CHANGED"}


async def log_time(work_id: str, event: str, at: str, actor: Dict[str, str], note: str = "") -> None:
    await _col("client_work_time_logs").insert_one({"work_id": work_id, "event": event, "at": at, "user_id": actor["user_id"],
                                                   "user_name": actor["name"], "note": note})


async def log_status(work: Dict[str, Any], old: Optional[str], new: str, actor: Dict[str, str], reason: str, at: str) -> None:
    await _col("client_work_status_history").insert_one({
        "work_id": str(work["_id"]), "from_status": old, "to_status": new, "at": at, "user_id": actor["user_id"],
        "user_name": actor["name"], "role": actor["role_label"], "reason": reason})


async def notify(user_ids: List[str], work: Dict[str, Any], kind: str, title: str, message: str, *, dedupe: str = "",
                 skip: str = "") -> List[str]:
    """One notification per recipient; `skip` (usually the actor) never notifies themselves; `dedupe` makes it once-only."""
    sent: List[str] = []
    col = _col("client_work_notifications")
    for uid in dict.fromkeys(u for u in user_ids if u and u != skip):
        if dedupe and await col.find_one({"user_id": uid, "dedupe_key": dedupe}):
            continue
        await col.insert_one({"user_id": uid, "work_id": str(work["_id"]), "kind": kind, "title": title, "message": message,
                              "created_at": now_iso(), "read": False, "dedupe_key": dedupe or None,
                              "link": "/client-work" if work["_id"] == "summary" else f"/client-work/{work['_id']}"})
        sent.append(uid)
    return sent


def publish(work: Dict[str, Any], event: str, notified: List[str] = (), extra_users: List[str] = ()) -> None:
    hub.publish({"type": "work", "event": event, "work_id": str(work["_id"]), "status": work.get("status"),
                 "client_name": work.get("client_name"), "notified": list(notified)},
                [work.get("assignee_id"), work.get("legal_owner_id"), *notified, *extra_users])


# ------------------------------------------------------------------ computed views
def _hold_seconds(work: Dict[str, Any], now: datetime) -> int:
    total = int(work.get("hold_seconds_closed") or 0)
    h = work.get("current_hold")
    if h:
        total += seconds_between(parse_dt(h.get("started_at")), now)
    return total


def durations(work: Dict[str, Any], now: Optional[datetime] = None) -> Dict[str, int]:
    """Total = completed (or now) - assigned; hold = sum of hold periods; active = total - hold."""
    now = now or now_dt()
    start = parse_dt(work.get("created_at"))
    end = parse_dt(work.get("completed_at")) or parse_dt(work.get("cancelled_at")) or now
    total = seconds_between(start, end)
    hold = min(total, _hold_seconds(work, end if work.get("completed_at") or work.get("cancelled_at") else now))
    return {"total": total, "hold": hold, "active": max(0, total - hold)}


def deadline_info(work: Dict[str, Any]) -> Dict[str, Any]:
    dl = work.get("deadline")
    if not dl:
        return {"state": "NO_DEADLINE", "days_left": None, "label": "No deadline"}
    if work.get("status") in (COMPLETED, CANCELLED):
        return {"state": "CLOSED", "days_left": None, "label": "Closed"}
    days = (date.fromisoformat(dl) - local_today()).days
    if days < 0:
        return {"state": "OVERDUE", "days_left": days, "label": f"Overdue by {-days} day{'s' if days != -1 else ''}"}
    if days == 0:
        return {"state": "DUE_TODAY", "days_left": 0, "label": "Due today"}
    return {"state": "DUE_SOON" if days <= DUE_SOON_DAYS else "ON_TRACK", "days_left": days,
            "label": f"{days} day{'s' if days != 1 else ''} remaining"}


def next_action(work: Dict[str, Any], tasks: List[Dict[str, Any]], pending_requests: List[Dict[str, Any]]) -> str:
    st = work.get("status")
    open_tasks = [t for t in tasks if t.get("status") not in ("COMPLETED", "CANCELLED")]
    if st == COMPLETED:
        return "Completed"
    if st == CANCELLED:
        return "Cancelled"
    if st == ON_HOLD:
        if pending_requests:
            return f"Follow up with client: {pending_requests[0].get('label')}"
        return "Clear the blocker, then resume work"
    if st == NEED_ACTION and not work.get("started_at"):
        return "Start work"
    if open_tasks:
        t = sorted(open_tasks, key=lambda x: (PRIORITY_RANK.get(x.get("priority"), 9), x.get("due_date") or "9999"))[0]
        return f"Task: {t.get('name')}"
    if tasks:
        return "Mark client work as completed"
    return "Add tasks or mark work completed"


async def work_view(work: Dict[str, Any], *, tasks: Optional[List[Dict[str, Any]]] = None,
                    requests: Optional[List[Dict[str, Any]]] = None, now: Optional[datetime] = None) -> Dict[str, Any]:
    """The record as the UI shows it: stored fields plus everything derived from the clock."""
    now = now or now_dt()
    wid = str(work["_id"])
    if tasks is None:
        tasks = await _col("client_tasks").find({"work_id": wid}).to_list(5000)
    if requests is None:
        requests = await _col("client_work_documents").find({"work_id": wid, "type": "REQUEST"}).to_list(2000)
    pending = sorted([r for r in requests if r.get("status") == "PENDING"], key=lambda r: r.get("requested_at") or "")
    d = durations(work, now)
    hold = work.get("current_hold")
    hold_view = None
    if hold:
        waiting_since = parse_dt(hold.get("started_at"))
        hold_view = {**hold, "label": HOLD_LABELS.get(hold.get("type"), "ON HOLD"), "days_waiting": seconds_between(waiting_since, now) // 86400,
                     "seconds_waiting": seconds_between(waiting_since, now)}
    out = public(work) or {}
    out.update({
        "durations": d, "deadline_info": deadline_info(work), "hold": hold_view,
        "hold_label": HOLD_LABELS.get((hold or {}).get("type")) if work.get("status") == ON_HOLD else None,
        "bucket": BUCKETS.get(work.get("status")), "pending_items_count": len(pending),
        "days_open": seconds_between(parse_dt(work.get("created_at")), parse_dt(work.get("completed_at")) or now) // 86400,
        "days_on_hold": d["hold"] // 86400, "time_elapsed_seconds": d["total"],
        "next_action": next_action(work, tasks, pending),
        "pending_requests": [public(r) for r in pending[:50]],
    })
    for k in ("current_hold",):
        out.pop(k, None)
    return out


def _recount(tasks: List[Dict[str, Any]], pending_requests: int) -> Dict[str, Any]:
    live = [t for t in tasks if t.get("status") != "CANCELLED"]
    done = sum(1 for t in live if t.get("status") == "COMPLETED")
    total = len(live)
    return {"total_tasks": total, "completed_tasks": done, "pending_tasks": total - done,
            "client_pending_tasks": pending_requests, "progress": round(done * 100 / total) if total else 0}


# ------------------------------------------------------------------ persistence with versioning
async def get_work(work_id: str) -> Dict[str, Any]:
    work = await _col("client_work").find_one({"_id": work_id})
    if not work:
        _bad("Client work not found.", 404)
    return work


async def visible_work(work_id: str, acc: Access) -> Dict[str, Any]:
    """404 (not 403) for work the user may not see, so ids can't be probed."""
    work = await _col("client_work").find_one({"_id": work_id})
    if not work or not acc.sees(work):
        _bad("Client work not found.", 404)
    return work


def require_act(work: Dict[str, Any], acc: Access) -> None:
    if not acc.acts(work):
        _bad("Only the assigned member can do this.", 403)


def require_open(work: Dict[str, Any], *, allow_hold: bool = True) -> None:
    if work.get("status") in (COMPLETED, CANCELLED):
        _bad(f"This work is {work['status'].lower()}; it can't be changed.", 409)
    if work.get("status") == ON_HOLD and not allow_hold:
        _bad("This work is on hold. Resume it first.", 409)


async def save_work(work: Dict[str, Any], changes: Dict[str, Any], idem_key: str = "") -> Dict[str, Any]:
    """Compare-and-swap on `version`: the write lands only if nobody changed the record since it was read."""
    expected = int(work.get("version") or 1)
    merged = {**changes, "version": expected + 1, "updated_at": now_iso()}
    if idem_key:
        merged["idem_keys"] = ([*(work.get("idem_keys") or []), idem_key])[-MAX_IDEM_KEYS:]
    res = await _col("client_work").update_one({"_id": work["_id"], "version": expected}, {"$set": merged})
    if res.matched_count == 0:
        _bad("This work was just changed by someone else. Reload and try again.", 409)
    return {**work, **merged}


def replayed(work: Dict[str, Any], idem_key: str) -> bool:
    return bool(idem_key) and idem_key in (work.get("idem_keys") or [])


async def _pending_request_count(work_id: str) -> int:
    return await _col("client_work_documents").count_documents({"work_id": work_id, "type": "REQUEST", "status": "PENDING"})


async def refresh_counters(work_id: str, extra: Optional[Dict[str, Any]] = None, idem_key: str = "") -> Dict[str, Any]:
    """Recompute counters / progress from the tasks and requests (retrying if another writer got in first)."""
    for attempt in range(4):
        work = await get_work(work_id)
        tasks = await _col("client_tasks").find({"work_id": work_id}).to_list(5000)
        changes = {**_recount(tasks, await _pending_request_count(work_id)), "last_activity_at": now_iso(), **(extra or {})}
        try:
            return await save_work(work, changes, idem_key)
        except HTTPException as e:
            if e.status_code != 409 or attempt == 3:
                raise
            await asyncio.sleep(0.02 * (attempt + 1))
    raise RuntimeError("unreachable")


# ------------------------------------------------------------------ client snapshots
async def client_snapshot(kind: str, client_id: str) -> Dict[str, Any]:
    if kind not in KINDS:
        _bad("Unknown client type.", 404)
    doc = await _col(KINDS[kind]).find_one({"_id": client_id})
    if not doc:
        _bad("Client not found.", 404)
    from app.routers.legal import _client_view  # lazy: legal.py imports this module
    v = _client_view(kind, doc)
    return {"doc": doc, "view": v, "snapshot": {k: v.get(k) for k in ("reference", "company_name", "contact_name", "contact_email",
                                                                        "contact_phone", "gstin", "bdm", "services", "documents", "amount")}}


async def next_work_no() -> str:
    col = _col("client_work")
    async with locked("work-number"):
        n = await col.count_documents({}) + 1
        while await col.find_one({"work_no": f"CW-{n:05d}"}):
            n += 1
        return f"CW-{n:05d}"


# ------------------------------------------------------------------ assignment (create / reassign)
async def _user_doc(user_id: str) -> Dict[str, Any]:
    u = await _col("admins").find_one({"_id": user_id})
    if not u or not u.get("is_active", True):
        _bad("That user doesn't exist or is disabled.", 404)
    if "admin" not in rbac.user_roles(u):
        _bad("Clients can only be assigned to Admin members.")
    return u


async def _active_work(kind: str, client_id: str) -> Optional[Dict[str, Any]]:
    """The open work of a client, via the marker whose primary key guarantees there is at most one."""
    marker = await _col("client_work_active").find_one({"_id": f"{kind}:{client_id}"})
    if marker:
        w = await _col("client_work").find_one({"_id": marker.get("work_id")})
        if w and w.get("status") in ACTIVE:
            return w
        await _col("client_work_active").delete_one({"_id": f"{kind}:{client_id}"})  # stale marker
    return await _col("client_work").find_one({"client_kind": kind, "client_id": client_id, "status": {"$in": list(ACTIVE)}})


def _assignee(u: Dict[str, Any]) -> Dict[str, str]:
    return {"user_id": str(u["_id"]), "name": u.get("username") or u.get("email", ""), "email": u.get("email", "")}


async def assign_client(kind: str, client_id: str, user_id: str, by: Dict[str, str], *, priority: str = "MEDIUM", work_type: str = "",
                        deadline: Optional[str] = None, required_action: str = "", notes: str = "", strict: bool = False,
                        client: Optional[Dict[str, Any]] = None) -> Tuple[Dict[str, Any], str]:
    """Create the client's work and put it in the member's Need Action, or move open work to a new member.

    Returns (work, outcome) with outcome in created / reassigned / unchanged.
    """
    priority = (priority or "MEDIUM").upper()
    if priority not in PRIORITIES:
        _bad(f"Priority must be one of {', '.join(PRIORITIES)}.")
    deadline = parse_date(deadline, "Deadline")
    if deadline and date.fromisoformat(deadline) < local_today():
        _bad("The deadline can't be in the past.")
    required_action = _clean(required_action, "Required action", max_len=500)
    notes = _clean(notes, "Notes", max_len=2000)
    member = await _user_doc(user_id)
    c = client or await client_snapshot(kind, client_id)

    async with locked(f"client:{kind}:{client_id}"):
        existing = await _active_work(kind, client_id)
        if existing:
            if strict:
                _bad("This client already has open work. Reassign it instead.", 409)
            return await _reassign_locked(existing, member, by, notes)

        at = now_iso()
        wtype = _clean(work_type, "Work type", max_len=120) or ", ".join(c["snapshot"].get("services") or [])[:120] or "General Compliance"
        work_id = uuid.uuid4().hex
        try:  # the marker's primary key is the cross-process guard against a second open work
            await _col("client_work_active").insert_one({"_id": f"{kind}:{client_id}", "work_id": work_id, "at": at})
        except Exception:
            _bad("This client already has open work.", 409)
        work = {
            "_id": work_id, "work_no": await next_work_no(), "client_kind": kind, "client_id": client_id,
            "client_ref": c["snapshot"].get("reference"), "client_name": c["snapshot"].get("company_name"),
            "client": c["snapshot"], "assigned_by": {"user_id": by["user_id"], "name": by["name"], "email": by["email"], "role": by["role_label"]},
            "assigned_to": _assignee(member), "assignee_id": str(member["_id"]), "legal_owner_id": by["user_id"],
            "work_type": wtype, "priority": priority, "status": NEED_ACTION, "required_action": required_action,
            "created_at": at, "started_at": None, "completed_at": None, "deadline": deadline or (local_today() + timedelta(days=DEFAULT_DEADLINE_DAYS)).isoformat(),
            "total_tasks": 0, "completed_tasks": 0, "pending_tasks": 0, "client_pending_tasks": 0, "progress": 0,
            "hold_seconds_closed": 0, "hold_count": 0, "current_hold": None, "completion_notes": "", "completion_history": [],
            "last_activity_at": at, "version": 1, "updated_at": at, "idem_keys": [],
        }
        await _col("client_work").insert_one(dict(work))
        await log_status(work, ASSIGNED, NEED_ACTION, by, "Client assigned", at)
        await log_time(work_id, "ASSIGNED", at, by, f"Assigned to {work['assigned_to']['name']}")
        await log_activity(work, by, "ASSIGNED", f"Client assigned to {work['assigned_to']['name']}", new=work["assigned_to"]["name"],
                           comment=notes, at=at)
        if required_action:
            await _insert_task(work, by, {"name": required_action[:120], "description": required_action, "priority": priority})
            work = await refresh_counters(work_id)
        sent = await notify([work["assignee_id"]], work, "ASSIGNED", "New client assigned to you.",
                            f"{work['client_name']} · {work['work_type']} · {priority.title()} priority", skip=by["user_id"])
        publish(work, "assigned", sent)
        return work, "created"


async def _reassign_locked(work: Dict[str, Any], member: Dict[str, Any], by: Dict[str, str], note: str) -> Tuple[Dict[str, Any], str]:
    if work["assignee_id"] == str(member["_id"]):
        return work, "unchanged"
    async with locked(f"work:{work['_id']}"):
        work = await get_work(work["_id"])
        old = work["assigned_to"]
        new = _assignee(member)
        work = await save_work(work, {"assigned_to": new, "assignee_id": new["user_id"], "last_activity_at": now_iso()})
        at = now_iso()
        await log_time(work["_id"], "REASSIGNED", at, by, f"{old['name']} -> {new['name']}")
        await log_activity(work, by, "REASSIGNED", f"Reassigned from {old['name']} to {new['name']}", old=old["name"], new=new["name"], comment=note, at=at)
        sent = await notify([new["user_id"]], work, "ASSIGNED", "New client assigned to you.", f"{work['client_name']} · reassigned from {old['name']}", skip=by["user_id"])
        sent += await notify([old["user_id"]], work, "REASSIGNED", "Client work reassigned.", f"{work['client_name']} is now handled by {new['name']}.", skip=by["user_id"])
        publish(work, "reassigned", sent, [old["user_id"]])
        return work, "reassigned"


async def reassign(work_id: str, user_id: str, acc: Access, note: str = "") -> Dict[str, Any]:
    work = await visible_work(work_id, acc)
    require_open(work)
    member = await _user_doc(user_id)
    work, _ = await _reassign_locked(work, member, acc.actor, _clean(note, "Note"))
    return work


async def unassign_client(kind: str, client_id: str, by: Dict[str, str]) -> Optional[Dict[str, Any]]:
    """Legal removed the assignee: the open work is cancelled (kept for the record), not deleted."""
    async with locked(f"client:{kind}:{client_id}"):
        work = await _active_work(kind, client_id)
        if not work:
            return None
        async with locked(f"work:{work['_id']}"):
            work = await get_work(work["_id"])
            if work.get("status") not in ACTIVE:
                return None
            if work.get("current_hold"):
                work = await _close_hold(work, by, "Client unassigned by Legal")
            work = await _set_status(work, CANCELLED, by, "Client unassigned by Legal", action="CANCELLED",
                                     extra={"cancelled_at": now_iso()})
            sent = await notify([work["assignee_id"]], work, "CANCELLED", f"{work['client_name']} was unassigned.",
                                "Legal removed this client from your queue.", skip=by["user_id"])
            publish(work, "cancelled", sent)
            return work


async def backfill_assigned() -> int:
    """Clients assigned before this module existed get their work record (idempotent)."""
    made = 0
    for kind, coll in KINDS.items():
        for doc in await _col(coll).find({}).to_list(20000):
            a = doc.get("assigned_to")
            if not a or not a.get("user_id"):
                continue
            cid = str(doc["_id"])
            if await _col("client_work").find_one({"client_kind": kind, "client_id": cid}):
                continue
            try:
                by = {**SYSTEM, "name": a.get("assigned_by") or "Legal", "email": a.get("assigned_by") or ""}
                lead = await _col("admins").find_one({"email": (a.get("assigned_by") or "").lower()})
                if lead:
                    by = actor_of(lead)
                await assign_client(kind, cid, a["user_id"], by, deadline=None)
                made += 1
            except HTTPException:
                continue
    return made


# ------------------------------------------------------------------ status machine
def check_transition(old: str, new: str, *, override: bool, system: bool = False) -> None:
    if new in TRANSITIONS.get(old, set()):
        return
    if system or (override and new in OVERRIDE_TRANSITIONS.get(old, set())):
        return
    _bad(f"Work can't move from {old.replace('_', ' ').title()} to {new.replace('_', ' ').title()}.", 409)


async def completion_blockers(work: Dict[str, Any]) -> List[str]:
    wid = str(work["_id"])
    tasks = await _col("client_tasks").find({"work_id": wid}).to_list(5000)
    reqs = await _col("client_work_documents").find({"work_id": wid, "type": "REQUEST", "status": "PENDING"}).to_list(2000)
    issues = await _col("client_work_comments").find({"work_id": wid, "kind": "ISSUE"}).to_list(2000)
    out: List[str] = []
    open_tasks = [t for t in tasks if t.get("required", True) and t.get("status") not in ("COMPLETED", "CANCELLED")]
    if open_tasks:
        out.append(f"{len(open_tasks)} required task{'s are' if len(open_tasks) != 1 else ' is'} not completed")
    docs = [r for r in reqs if r.get("mandatory", True) and r.get("kind") == "DOCUMENT"]
    if docs:
        out.append(f"{len(docs)} required document{'s have' if len(docs) != 1 else ' has'} not been received: " + ", ".join(d["label"] for d in docs[:5]))
    info = [r for r in reqs if r.get("mandatory", True) and r.get("kind") != "DOCUMENT"]
    if info:
        out.append(f"{len(info)} mandatory client response{'s are' if len(info) != 1 else ' is'} still pending")
    crit = [i for i in issues if i.get("critical") and not i.get("resolved")]
    if crit:
        out.append(f"{len(crit)} unresolved critical issue{'s' if len(crit) != 1 else ''}")
    return out


async def _set_status(work: Dict[str, Any], new: str, actor: Dict[str, str], reason: str, *,
                      extra: Optional[Dict[str, Any]] = None, action: str = "STATUS_CHANGED", idem_key: str = "") -> Dict[str, Any]:
    """Apply one transition: save first (compare-and-swap), then write the history. Caller holds the work lock."""
    old = work["status"]
    at = now_iso()
    changes: Dict[str, Any] = {"status": new, "last_activity_at": at, **(extra or {})}
    work = await save_work(work, changes, idem_key)
    wid = str(work["_id"])
    await log_status(work, old, new, actor, reason, at)
    label = lambda s: s.replace("_", " ").title()
    await log_activity(work, actor, action, f"Status changed from {label(old)} to {label(new)}", old=old, new=new, comment=reason, at=at)
    marker = _col("client_work_active")
    if new in (COMPLETED, CANCELLED):
        await marker.delete_one({"_id": f"{work['client_kind']}:{work['client_id']}"})
    elif old in (COMPLETED, CANCELLED):
        try:
            await marker.insert_one({"_id": f"{work['client_kind']}:{work['client_id']}", "work_id": wid, "at": at})
        except Exception:
            pass
    return work


async def change_status(work_id: str, to: str, acc: Access, *, reason: str = "", idem_key: str = "",
                        completion_notes: str = "") -> Dict[str, Any]:
    """Generic transition, used by the per-action endpoints that need no extra input."""
    to = (to or "").upper()
    if to not in (NEED_ACTION, IN_PROGRESS, ON_HOLD, COMPLETED, CANCELLED):
        _bad("Unknown status.")
    async with locked(f"work:{work_id}"):
        work = await visible_work(work_id, acc)
        if replayed(work, idem_key):
            return work
        require_act(work, acc)
        if work["status"] == to:
            _bad(f"This work is already {to.replace('_', ' ').lower()}.", 409)
        check_transition(work["status"], to, override=acc.admin)
        if to == ON_HOLD:
            _bad("Use 'Put on hold' with the hold details.")
        if to == COMPLETED:
            return await _complete_locked(work, acc, completion_notes or reason, idem_key)
        if to == NEED_ACTION and work["status"] == ON_HOLD:
            return await _resume_locked(work, acc.actor, reason or "Resumed", idem_key)
        extra: Dict[str, Any] = {}
        action = "STATUS_CHANGED"
        first_start = to == IN_PROGRESS and not work.get("started_at")
        if to == IN_PROGRESS:
            extra["started_at"] = work.get("started_at") or now_iso()
        if work["status"] in (COMPLETED, CANCELLED) and to == NEED_ACTION:
            action = "REOPENED"
            extra.update({"completed_at": None, "cancelled_at": None, "completed_by": None})
        if to == CANCELLED:
            action = "CANCELLED"
            extra["cancelled_at"] = now_iso()
            if work.get("current_hold"):
                work = await _close_hold(work, acc.actor, "Work cancelled")
        work = await _set_status(work, to, acc.actor, reason, extra=extra, action=action, idem_key=idem_key)
        if to == IN_PROGRESS:
            await log_time(str(work["_id"]), "STARTED" if first_start else "RESTARTED", now_iso(), acc.actor, reason)
        if action == "REOPENED":
            await log_time(str(work["_id"]), "REOPENED", now_iso(), acc.actor, reason)
        sent = await notify([work["legal_owner_id"], work["assignee_id"]], work, action, f"{work['client_name']}: {to.replace('_', ' ').title()}",
                            reason, skip=acc.uid)
        publish(work, action.lower(), sent)
        return work


async def start_work(work_id: str, acc: Access, idem_key: str = "") -> Dict[str, Any]:
    return await change_status(work_id, IN_PROGRESS, acc, reason="Work started", idem_key=idem_key)


# ---- hold / resume
async def _close_hold(work: Dict[str, Any], actor: Dict[str, str], reason: str, *, auto: bool = False) -> Dict[str, Any]:
    """End the open hold period: add its length to hold_seconds_closed and stamp the hold history row."""
    hold = work.get("current_hold")
    if not hold:
        return work
    ended = now_iso()
    secs = seconds_between(parse_dt(hold.get("started_at")), parse_dt(ended))
    work = await save_work(work, {"current_hold": None, "hold_seconds_closed": int(work.get("hold_seconds_closed") or 0) + secs})
    await _col("client_work_hold_history").update_one({"_id": hold["hold_id"]}, {"$set": {
        "ended_at": ended, "ended_by": actor["name"], "resume_reason": reason, "duration_seconds": secs, "auto_resumed": auto}})
    await log_time(str(work["_id"]), "HOLD_ENDED", ended, actor, reason)
    return work


async def put_on_hold(work_id: str, acc: Access, *, hold_type: str = HOLD_WAITING, reason: str, required_from_client: str = "",
                      pending_documents: Optional[List[str]] = None, expected_response_date: Optional[str] = None,
                      internal_note: str = "", idem_key: str = "") -> Dict[str, Any]:
    hold_type = (hold_type or HOLD_WAITING).upper()
    if hold_type not in HOLD_LABELS:
        _bad("Hold type must be WAITING_FOR_CLIENT or INTERNAL_BLOCKER.")
    reason = _clean(reason, "Hold reason", required=True, max_len=1000)
    internal_note = _clean(internal_note, "Internal note", required=True, max_len=2000)
    required_from_client = _clean(required_from_client, "Required from client", max_len=1000)
    items = [_clean(p, "Pending document", max_len=200) for p in (pending_documents or []) if str(p or "").strip()]
    expected = parse_date(expected_response_date, "Expected client response date")
    if hold_type == HOLD_WAITING:
        if not required_from_client:
            _bad("Required from client is required.")
        if not items:
            _bad("List at least one pending document or item.")
        if not expected:
            _bad("Expected client response date is required.")
        if date.fromisoformat(expected) < local_today():
            _bad("The expected response date can't be in the past.")
    async with locked(f"work:{work_id}"):
        work = await visible_work(work_id, acc)
        if replayed(work, idem_key):
            return work
        require_act(work, acc)
        if work["status"] == ON_HOLD:
            _bad("This work is already on hold.", 409)
        check_transition(work["status"], ON_HOLD, override=acc.admin)
        at = now_iso()
        hold_id = uuid.uuid4().hex
        hold = {"hold_id": hold_id, "type": hold_type, "reason": reason, "required_from_client": required_from_client,
                "pending_items": items, "expected_response_date": expected, "internal_note": internal_note,
                "started_at": at, "started_by": acc.actor["name"]}
        work = await _set_status(work, ON_HOLD, acc.actor, reason, action="HOLD_STARTED", idem_key=idem_key,
                                 extra={"current_hold": hold, "hold_count": int(work.get("hold_count") or 0) + 1})
        await _col("client_work_hold_history").insert_one({"_id": hold_id, "work_id": work_id, **{k: v for k, v in hold.items() if k != "hold_id"},
                                                           "ended_at": None, "ended_by": None, "resume_reason": "", "duration_seconds": None, "auto_resumed": False})
        existing = {r["label"].lower() for r in await _col("client_work_documents").find({"work_id": work_id, "type": "REQUEST", "status": "PENDING"}).to_list(500)}
        for label in items if hold_type == HOLD_WAITING else []:
            if label.lower() not in existing:
                await _insert_request(work, acc.actor, "DOCUMENT", label, expected, "", hold_id=hold_id)
        await log_time(work_id, "HOLD_STARTED", at, acc.actor, reason)
        await refresh_counters(work_id)
        work = await get_work(work_id)
        sent = await notify([work["legal_owner_id"]], work, "ON_HOLD", f"{work['client_name']} has been put on hold.", f"{HOLD_LABELS[hold_type]} · {reason}", skip=acc.uid)
        publish(work, "hold_started", sent)
        return work


async def _resume_locked(work: Dict[str, Any], actor: Dict[str, str], reason: str, idem_key: str = "", auto: bool = False) -> Dict[str, Any]:
    work = await _close_hold(work, actor, reason, auto=auto)
    work = await _set_status(work, NEED_ACTION, actor, reason, action="HOLD_ENDED", idem_key=idem_key)
    await log_time(str(work["_id"]), "RESUMED", now_iso(), actor, reason)
    sent = await notify([work["assignee_id"]] if auto else [work["legal_owner_id"], work["assignee_id"]], work, "RESUMED",
                        f"{work['client_name']} is back in Need Action.", reason, skip="" if auto else actor["user_id"])
    publish(work, "resumed", sent)
    return work


async def resume_work(work_id: str, acc: Access, reason: str, idem_key: str = "") -> Dict[str, Any]:
    reason = _clean(reason, "Resume note", required=True, max_len=1000)
    async with locked(f"work:{work_id}"):
        work = await visible_work(work_id, acc)
        if replayed(work, idem_key):
            return work
        require_act(work, acc)
        if work["status"] != ON_HOLD:
            _bad("Only work that is on hold can be resumed.", 409)
        return await _resume_locked(work, acc.actor, reason, idem_key)


async def _maybe_auto_resume(work_id: str, actor: Dict[str, str], why: str) -> None:
    """Waiting-for-client hold with nothing left to wait for: the work returns to Need Action by itself."""
    async with locked(f"work:{work_id}"):
        work = await get_work(work_id)
        hold = work.get("current_hold")
        if work.get("status") != ON_HOLD or not hold or hold.get("type") != HOLD_WAITING:
            return
        if await _pending_request_count(work_id) > 0:
            return
        await log_activity(work, actor, "CLIENT_RESPONDED", "Client submitted the required items", comment=why)
        await _resume_locked(work, SYSTEM, "Client response received: work automatically moved to Need Action", auto=True)


# ---- completion
async def _complete_locked(work: Dict[str, Any], acc: Access, notes: str, idem_key: str = "") -> Dict[str, Any]:
    blockers = await completion_blockers(work)
    if blockers:
        raise HTTPException(status_code=409, detail="Can't complete yet: " + "; ".join(blockers) + ".")
    at = now_iso()
    if work.get("current_hold"):
        work = await _close_hold(work, acc.actor, "Completed")
    snapshot_work = {**work, "completed_at": at}
    d = durations(snapshot_work, parse_dt(at))
    record = {"completed_by": acc.actor["name"], "completed_by_id": acc.uid, "completed_at": at, "total_duration": d["total"],
              "active_duration": d["active"], "hold_duration": d["hold"], "total_tasks": work.get("total_tasks", 0),
              "completed_tasks": work.get("completed_tasks", 0), "notes": notes}
    extra = {"completed_at": at, "completed_by": {"user_id": acc.uid, "name": acc.actor["name"]}, "completion_notes": notes,
             "total_duration": d["total"], "active_duration": d["active"], "hold_duration": d["hold"],
             "completion_history": [*(work.get("completion_history") or []), record], "next_action": "Completed"}
    work = await _set_status(work, COMPLETED, acc.actor, notes or "All work completed", extra=extra, action="COMPLETED", idem_key=idem_key)
    await log_time(str(work["_id"]), "COMPLETED", at, acc.actor, notes)
    sent = await notify([work["legal_owner_id"]], work, "COMPLETED", f"{work['client_name']} has completed all assigned work.",
                        f"Completed by {acc.actor['name']}", skip=acc.uid)
    publish(work, "completed", sent)
    return work


async def complete_work(work_id: str, acc: Access, notes: str = "", idem_key: str = "") -> Dict[str, Any]:
    return await change_status(work_id, COMPLETED, acc, completion_notes=_clean(notes, "Completion notes", max_len=2000), idem_key=idem_key)


# ------------------------------------------------------------------ work details
async def update_details(work_id: str, acc: Access, *, priority: Optional[str] = None, deadline: Optional[str] = None,
                         required_action: Optional[str] = None, work_type: Optional[str] = None, note: str = "") -> Dict[str, Any]:
    async with locked(f"work:{work_id}"):
        work = await visible_work(work_id, acc)
        if not (acc.acts(work) or acc.monitor):
            _bad("You can't change this work.", 403)
        require_open(work)
        changes: Dict[str, Any] = {}
        events: List[Tuple[str, str, Any, Any]] = []
        if priority is not None and priority.upper() != work["priority"]:
            p = priority.upper()
            if p not in PRIORITIES:
                _bad(f"Priority must be one of {', '.join(PRIORITIES)}.")
            changes["priority"] = p
            events.append(("PRIORITY_CHANGED", f"Priority changed from {work['priority'].title()} to {p.title()}", work["priority"], p))
        if deadline is not None:
            dl = parse_date(deadline, "Deadline")
            if not dl:
                _bad("Deadline is required.")
            if dl != work.get("deadline"):
                if date.fromisoformat(dl) < local_today():
                    _bad("The deadline can't be in the past.")
                changes["deadline"] = dl
                changes["overdue_notified_for"] = None
                events.append(("DEADLINE_CHANGED", f"Deadline changed from {work.get('deadline') or 'none'} to {dl}", work.get("deadline"), dl))
        if required_action is not None and required_action.strip() != (work.get("required_action") or ""):
            ra = _clean(required_action, "Required action", max_len=500)
            changes["required_action"] = ra
            events.append(("DETAILS_CHANGED", "Required action updated", work.get("required_action"), ra))
        if work_type is not None and work_type.strip() != work.get("work_type"):
            wt = _clean(work_type, "Work type", required=True, max_len=120)
            changes["work_type"] = wt
            events.append(("DETAILS_CHANGED", f"Work type changed to {wt}", work.get("work_type"), wt))
        if not changes:
            return work
        changes["last_activity_at"] = now_iso()
        work = await save_work(work, changes)
        for action, summary, old, new in events:
            await log_activity(work, acc.actor, action, summary, old=old, new=new, comment=note)
        other = [work["assignee_id"], work["legal_owner_id"]]
        sent = await notify(other, work, events[0][0], f"{work['client_name']}: " + events[0][1], note, skip=acc.uid)
        publish(work, "details_changed", sent)
        return work


# ------------------------------------------------------------------ tasks
async def _insert_task(work: Dict[str, Any], actor: Dict[str, str], data: Dict[str, Any]) -> Dict[str, Any]:
    at = now_iso()
    priority = (data.get("priority") or "MEDIUM").upper()
    if priority not in PRIORITIES:
        _bad(f"Priority must be one of {', '.join(PRIORITIES)}.")
    task = {"_id": uuid.uuid4().hex, "work_id": str(work["_id"]), "client_id": work.get("client_id"),
            "name": _clean(data.get("name"), "Task name", required=True, max_len=160),
            "description": _clean(data.get("description"), "Description", max_len=2000),
            "assigned_to": work["assigned_to"], "created_by": actor["name"], "created_at": at,
            "due_date": parse_date(data.get("due_date"), "Due date"), "status": "PENDING", "priority": priority,
            "completion_pct": 0, "required": bool(data.get("required", True)), "completed_at": None, "updated_at": at, "version": 1}
    await _col("client_tasks").insert_one(dict(task))
    await log_activity(work, actor, "TASK_CREATED", f"Task created: {task['name']}", new=task["name"], task_id=task["_id"], at=at)
    return task


async def create_task(work_id: str, acc: Access, data: Dict[str, Any], idem_key: str = "") -> Dict[str, Any]:
    async with locked(f"work:{work_id}"):
        work = await visible_work(work_id, acc)
        if replayed(work, idem_key):
            return {"work": work, "task": None, "replayed": True}
        if not (acc.acts(work) or acc.monitor):
            _bad("You can't add tasks to this work.", 403)
        require_open(work)
        task = await _insert_task(work, acc.actor, data)
        work = await refresh_counters(work_id, idem_key=idem_key)
        sent = await notify([work["assignee_id"]], work, "TASK_CREATED", f"{work['client_name']}: new task", task["name"], skip=acc.uid)
        publish(work, "task_created", sent)
        return {"work": work, "task": public(task), "replayed": False}


async def get_task(task_id: str, acc: Access) -> Tuple[Dict[str, Any], Dict[str, Any]]:
    task = await _col("client_tasks").find_one({"_id": task_id})
    if not task:
        _bad("Task not found.", 404)
    work = await visible_work(task["work_id"], acc)
    return task, work


async def update_task(task_id: str, acc: Access, data: Dict[str, Any], idem_key: str = "") -> Dict[str, Any]:
    task0, _ = await get_task(task_id, acc)
    work_id = task0["work_id"]
    async with locked(f"work:{work_id}"):
        task, work = await get_task(task_id, acc)
        if replayed(work, idem_key):
            return {"work": work, "task": public(task), "replayed": True}
        require_act(work, acc)
        require_open(work, allow_hold=False)
        expected = data.get("version")
        if expected is not None and int(expected) != int(task.get("version") or 1):
            _bad("This task was changed by someone else. Reload and try again.", 409)
        changes: Dict[str, Any] = {}
        events: List[Tuple[str, str, Any, Any, str]] = []
        for f, label, mx in (("name", "Task name", 160), ("description", "Description", 2000)):
            if data.get(f) is not None and str(data[f]).strip() != (task.get(f) or ""):
                changes[f] = _clean(data[f], label, required=(f == "name"), max_len=mx)
                events.append(("TASK_UPDATED", f"Task {f} updated: {task['name']}", task.get(f), changes[f], ""))
        if data.get("due_date") is not None:
            dd = parse_date(data["due_date"], "Due date")
            if dd != task.get("due_date"):
                changes["due_date"] = dd
                events.append(("TASK_UPDATED", f"Task due date changed: {task['name']}", task.get("due_date"), dd, ""))
        if data.get("priority") is not None and data["priority"].upper() != task["priority"]:
            p = data["priority"].upper()
            if p not in PRIORITIES:
                _bad(f"Priority must be one of {', '.join(PRIORITIES)}.")
            changes["priority"] = p
            events.append(("TASK_UPDATED", f"Task priority changed: {task['name']}", task["priority"], p, ""))
        pct = data.get("completion_pct")
        new_status = (data.get("status") or "").upper() or None
        if new_status and new_status not in TASK_STATUSES:
            _bad(f"Task status must be one of {', '.join(TASK_STATUSES)}.")
        if pct is not None:
            try:
                pct = int(pct)
            except (TypeError, ValueError):
                _bad("Completion must be a number from 0 to 100.")
            if not 0 <= pct <= 100:
                _bad("Completion must be a number from 0 to 100.")
            changes["completion_pct"] = pct
            if pct == 100 and not new_status:
                new_status = "COMPLETED"
            elif 0 < pct < 100 and not new_status and task["status"] == "PENDING":
                new_status = "IN_PROGRESS"
        if new_status and new_status != task["status"]:
            changes["status"] = new_status
            if new_status == "COMPLETED":
                changes.update({"completion_pct": 100, "completed_at": now_iso()})
            elif task["status"] == "COMPLETED":
                changes.update({"completed_at": None, "completion_pct": min(changes.get("completion_pct", 90), 99)})
            if new_status == "CANCELLED":
                changes["completion_pct"] = task.get("completion_pct", 0)
            events.append(("TASK_STATUS_CHANGED" if new_status != "COMPLETED" else "TASK_COMPLETED",
                           f"Task {'completed' if new_status == 'COMPLETED' else 'marked ' + new_status.replace('_', ' ').title()}: {task['name']}",
                           task["status"], new_status, str(data.get("comment") or "")))
        if not changes:
            return {"work": work, "task": public(task), "replayed": False}
        changes.update({"updated_at": now_iso(), "version": int(task.get("version") or 1) + 1})
        res = await _col("client_tasks").update_one({"_id": task_id, "version": int(task.get("version") or 1)}, {"$set": changes})
        if res.matched_count == 0:
            _bad("This task was changed by someone else. Reload and try again.", 409)
        task = {**task, **changes}
        auto_started = False
        if work["status"] == NEED_ACTION and changes.get("status") in ("IN_PROGRESS", "COMPLETED"):
            started = now_iso()
            work = await _set_status(work, IN_PROGRESS, acc.actor, "Work started automatically with the first task update",
                                     extra={"started_at": work.get("started_at") or started})
            await log_time(work_id, "STARTED", started, acc.actor, "First task update")
            auto_started = True
        for action, summary, old, new, comment in events:
            await log_activity(work, acc.actor, action, summary, old=old, new=new, comment=comment, task_id=task_id)
        work = await refresh_counters(work_id, idem_key=idem_key)
        sent = []
        if events:
            sent = await notify([work["legal_owner_id"]], work, events[0][0], f"{work['client_name']}: {events[0][1]}", "", skip=acc.uid) \
                if any(e[0] == "TASK_COMPLETED" for e in events) else []
        publish(work, "task_updated" if not auto_started else "started", sent)
        return {"work": work, "task": public(task), "replayed": False}


async def complete_task(task_id: str, acc: Access, comment: str = "", idem_key: str = "") -> Dict[str, Any]:
    return await update_task(task_id, acc, {"status": "COMPLETED", "comment": comment}, idem_key)


# ------------------------------------------------------------------ comments, notes, issues
async def add_comment(work_id: str, acc: Access, *, text: str, kind: str = "COMMENT", task_id: Optional[str] = None,
                      critical: bool = False) -> Dict[str, Any]:
    kind = (kind or "COMMENT").upper()
    if kind not in ("COMMENT", "NOTE", "ISSUE"):
        _bad("Kind must be COMMENT, NOTE or ISSUE.")
    text = _clean(text, "Comment", required=True, max_len=4000)
    async with locked(f"work:{work_id}"):
        work = await visible_work(work_id, acc)
        if not (acc.acts(work) or acc.monitor):
            _bad("You can't comment on this work.", 403)
        if task_id and not await _col("client_tasks").find_one({"_id": task_id, "work_id": work_id}):
            _bad("Task not found on this work.", 404)
        c = {"_id": uuid.uuid4().hex, "work_id": work_id, "task_id": task_id, "kind": kind, "text": text,
             "critical": bool(critical) and kind == "ISSUE", "resolved": False, "user_id": acc.uid, "user_name": acc.actor["name"],
             "role": acc.actor["role_label"], "created_at": now_iso()}
        await _col("client_work_comments").insert_one(dict(c))
        verb = {"COMMENT": "Comment added", "NOTE": "Internal note added", "ISSUE": "Critical issue raised" if c["critical"] else "Issue raised"}[kind]
        await log_activity(work, acc.actor, f"{kind}_ADDED", verb, new=text[:200], comment=text, task_id=task_id)
        work = await save_work(work, {"last_activity_at": now_iso()})
        sent = await notify([work["assignee_id"], work["legal_owner_id"]], work, kind, f"{work['client_name']}: {verb.lower()}", text[:140], skip=acc.uid)
        publish(work, "comment", sent)
        return public(c)


async def resolve_issue(comment_id: str, acc: Access) -> Dict[str, Any]:
    c = await _col("client_work_comments").find_one({"_id": comment_id})
    if not c or c.get("kind") != "ISSUE":
        _bad("Issue not found.", 404)
    async with locked(f"work:{c['work_id']}"):
        work = await visible_work(c["work_id"], acc)
        if not (acc.acts(work) or acc.monitor):
            _bad("You can't resolve this issue.", 403)
        if c.get("resolved"):
            return public(c)
        await _col("client_work_comments").update_one({"_id": comment_id}, {"$set": {"resolved": True, "resolved_by": acc.actor["name"], "resolved_at": now_iso()}})
        await log_activity(work, acc.actor, "ISSUE_RESOLVED", "Issue resolved", old="open", new="resolved", comment=c.get("text", "")[:200])
        work = await save_work(work, {"last_activity_at": now_iso()})
        publish(work, "issue_resolved")
        return public({**c, "resolved": True})


# ------------------------------------------------------------------ client requests and documents
async def _insert_request(work: Dict[str, Any], actor: Dict[str, str], kind: str, label: str, expected: Optional[str], note: str,
                          *, mandatory: bool = True, hold_id: Optional[str] = None, task_id: Optional[str] = None) -> Dict[str, Any]:
    r = {"_id": uuid.uuid4().hex, "type": "REQUEST", "work_id": str(work["_id"]), "client_id": work.get("client_id"), "kind": kind,
         "label": label, "status": "PENDING", "mandatory": mandatory, "requested_at": now_iso(), "requested_by": actor["name"],
         "expected_date": expected, "note": note, "hold_id": hold_id, "task_id": task_id, "received_at": None, "received_by": None,
         "response_note": "", "file_id": None}
    await _col("client_work_documents").insert_one(dict(r))
    await log_activity(work, actor, "CLIENT_REQUEST", f"{'Document' if kind == 'DOCUMENT' else 'Information'} requested from client: {label}", new=label, comment=note)
    return r


async def request_from_client(work_id: str, acc: Access, *, kind: str, label: str, expected_date: Optional[str] = None,
                              note: str = "", mandatory: bool = True, task_id: Optional[str] = None, idem_key: str = "") -> Dict[str, Any]:
    kind = (kind or "DOCUMENT").upper()
    if kind not in ("DOCUMENT", "INFORMATION"):
        _bad("Kind must be DOCUMENT or INFORMATION.")
    label = _clean(label, "What to request", required=True, max_len=200)
    expected = parse_date(expected_date, "Expected response date")
    async with locked(f"work:{work_id}"):
        work = await visible_work(work_id, acc)
        if replayed(work, idem_key):
            return {"work": work, "request": None, "replayed": True}
        require_act(work, acc)
        require_open(work)
        dup = await _col("client_work_documents").find_one({"work_id": work_id, "type": "REQUEST", "status": "PENDING", "label": label})
        if dup:
            _bad(f"'{label}' has already been requested and is still pending.", 409)
        r = await _insert_request(work, acc.actor, kind, label, expected, _clean(note, "Note", max_len=1000), mandatory=mandatory, task_id=task_id)
        work = await refresh_counters(work_id, idem_key=idem_key)
        publish(work, "client_request")
        return {"work": work, "request": public(r), "replayed": False}


def _check_upload(name: str, data: bytes) -> str:
    name = os.path.basename(name or "document")
    if os.path.splitext(name)[1].lower() not in ALLOWED_EXT:
        _bad(f"{name} is not an allowed file type (PDF, image, Word, Excel, PowerPoint, CSV or text).")
    if not data:
        _bad(f"{name} is empty.")
    if len(data) > MAX_FILE_BYTES:
        _bad(f"{name} is larger than {MAX_FILE_BYTES // (1024 * 1024)} MB.")
    return name


async def upload_document(work_id: str, acc: Access, *, filename: str, content_type: str, data: bytes, label: str = "",
                          request_id: Optional[str] = None, task_id: Optional[str] = None, note: str = "") -> Dict[str, Any]:
    name = _check_upload(filename, data)
    async with locked(f"work:{work_id}"):
        work = await visible_work(work_id, acc)
        require_act(work, acc)
        require_open(work)
        req = None
        if request_id:
            req = await _col("client_work_documents").find_one({"_id": request_id, "work_id": work_id, "type": "REQUEST"})
            if not req:
                _bad("That request isn't on this work.", 404)
            if req["status"] != "PENDING":
                _bad("That request has already been fulfilled.", 409)
        if task_id and not await _col("client_tasks").find_one({"_id": task_id, "work_id": work_id}):
            _bad("Task not found on this work.", 404)
        file_id, doc_id, at = uuid.uuid4().hex, uuid.uuid4().hex, now_iso()
        await _col("client_work_files").insert_one({"_id": file_id, "work_id": work_id, "data_b64": base64.b64encode(data).decode("ascii")})
        meta = {"_id": doc_id, "type": "FILE", "work_id": work_id, "client_id": work.get("client_id"), "task_id": task_id or (req or {}).get("task_id"),
                "request_id": request_id, "label": _clean(label, "Label", max_len=200) or (req or {}).get("label") or name, "filename": name,
                "content_type": content_type or "application/octet-stream", "size": len(data), "file_id": file_id,
                "uploaded_by": acc.actor["name"], "uploaded_by_id": acc.uid, "uploaded_at": at, "note": _clean(note, "Note", max_len=1000)}
        await _col("client_work_documents").insert_one(dict(meta))
        await log_activity(work, acc.actor, "DOCUMENT_UPLOADED", f"Document uploaded: {meta['label']}", new=name, task_id=meta["task_id"], at=at)
        if req:
            await _col("client_work_documents").update_one({"_id": request_id}, {"$set": {
                "status": "RECEIVED", "received_at": at, "received_by": acc.actor["name"], "file_id": file_id, "doc_id": doc_id}})
            await log_activity(work, acc.actor, "CLIENT_RESPONDED", f"Client provided: {req['label']}", old="PENDING", new="RECEIVED", task_id=meta["task_id"], at=at)
        work = await refresh_counters(work_id)
        sent = await notify([work["assignee_id"]], work, "DOCUMENT", f"{work['client_name']} has submitted the requested document." if req else
                            f"{work['client_name']}: document uploaded", meta["label"], skip=acc.uid) if req or acc.uid != work["assignee_id"] else []
        publish(work, "document", sent)
    if req:
        await _maybe_auto_resume(work_id, acc.actor, f"Received {req['label']}")
    return public(meta)


async def client_response(work_id: str, acc: Access, *, note: str, request_ids: Optional[List[str]] = None, resolve_all: bool = False) -> Dict[str, Any]:
    """Record that the client answered (outside the CRM): marks the named requests received."""
    note = _clean(note, "Response note", required=True, max_len=2000)
    async with locked(f"work:{work_id}"):
        work = await visible_work(work_id, acc)
        require_act(work, acc)
        require_open(work)
        pend = await _col("client_work_documents").find({"work_id": work_id, "type": "REQUEST", "status": "PENDING"}).to_list(500)
        chosen = pend if resolve_all else [r for r in pend if r["_id"] in set(request_ids or [])]
        if not chosen:
            _bad("Choose at least one pending request this response answers.")
        at = now_iso()
        for r in chosen:
            await _col("client_work_documents").update_one({"_id": r["_id"]}, {"$set": {
                "status": "RECEIVED", "received_at": at, "received_by": acc.actor["name"], "response_note": note}})
            await log_activity(work, acc.actor, "CLIENT_RESPONDED", f"Client responded: {r['label']}", old="PENDING", new="RECEIVED", comment=note, at=at)
        work = await refresh_counters(work_id)
        sent = await notify([work["assignee_id"]], work, "CLIENT_RESPONSE", f"{work['client_name']} has responded to the request.", note[:140], skip=acc.uid)
        publish(work, "client_response", sent)
    await _maybe_auto_resume(work_id, acc.actor, note)
    return {"work": await work_view(await get_work(work_id)), "resolved": len(chosen)}


async def file_for(doc_id: str, acc: Access) -> Tuple[Dict[str, Any], bytes]:
    meta = await _col("client_work_documents").find_one({"_id": doc_id, "type": "FILE"})
    if not meta:
        _bad("Document not found.", 404)
    await visible_work(meta["work_id"], acc)
    f = await _col("client_work_files").find_one({"_id": meta["file_id"]})
    if not f:
        _bad("Document not found.", 404)
    return meta, base64.b64decode(f["data_b64"])


# ------------------------------------------------------------------ listing and filtering
def _matches_text(w: Dict[str, Any], s: str) -> bool:
    s = s.lower()
    c = w.get("client") or {}
    hay = [w.get("client_name"), w.get("client_ref"), w.get("work_no"), w.get("work_type"), (w.get("assigned_to") or {}).get("name"),
           c.get("contact_name"), c.get("contact_email"), c.get("gstin")]
    return any(s in str(h or "").lower() for h in hay)


def apply_filters(works: List[Dict[str, Any]], f: Dict[str, Any]) -> List[Dict[str, Any]]:
    today = local_today().isoformat()
    soon = (local_today() + timedelta(days=DUE_SOON_DAYS)).isoformat()
    out = []
    for w in works:
        st = w.get("status")
        if f.get("bucket") and BUCKETS.get(st) != f["bucket"]:
            continue
        if f.get("status") and st != f["status"].upper():
            continue
        if f.get("priority") and w.get("priority") != f["priority"].upper():
            continue
        if f.get("work_type") and f["work_type"].lower() not in (w.get("work_type") or "").lower():
            continue
        if f.get("assignee") and w.get("assignee_id") != f["assignee"]:
            continue
        if f.get("legal") and w.get("legal_owner_id") != f["legal"]:
            continue
        if f.get("client_id") and f["client_id"] not in (w.get("client_id"), w.get("client_ref")):
            continue
        dl = w.get("deadline")
        if f.get("deadline_from") and (not dl or dl < f["deadline_from"]):
            continue
        if f.get("deadline_to") and (not dl or dl > f["deadline_to"]):
            continue
        created = (w.get("created_at") or "")[:10]
        if f.get("created_from") and created < f["created_from"]:
            continue
        if f.get("created_to") and created > f["created_to"]:
            continue
        active = st in ACTIVE
        if f.get("overdue") and not (active and dl and dl < today):
            continue
        if f.get("due") == "today" and not (active and dl == today):
            continue
        if f.get("due") == "soon" and not (active and dl and today < dl <= soon):
            continue
        if f.get("waiting_for_client") and not (w.get("client_pending_tasks", 0) > 0 or (w.get("current_hold") or {}).get("type") == HOLD_WAITING):
            continue
        if f.get("search") and not _matches_text(w, f["search"].strip()):
            continue
        out.append(w)
    return out


SORTS = {
    "priority": lambda w: (PRIORITY_RANK.get(w.get("priority"), 9), w.get("deadline") or "9999"),
    "deadline": lambda w: (w.get("deadline") or "9999",),
    "client": lambda w: ((w.get("client_name") or "").lower(),),
    "work_type": lambda w: ((w.get("work_type") or "").lower(),),
    "status": lambda w: (w.get("status") or "",),
    "assigned": lambda w: ((w.get("assigned_to") or {}).get("name", "").lower(),),
    "assigned_date": lambda w: (w.get("created_at") or "",),
    "updated": lambda w: (w.get("last_activity_at") or "",),
}


async def scoped_works(acc: Access, *, mine: bool = False) -> List[Dict[str, Any]]:
    col = _col("client_work")
    if acc.monitor and not mine:
        return await col.find({}).to_list(50000)
    return await col.find({"assignee_id": acc.uid}).to_list(20000)


async def list_work(acc: Access, filters: Dict[str, Any], *, mine: bool = False, sort: str = "priority", order: str = "asc",
                    skip: int = 0, limit: int = 50) -> Dict[str, Any]:
    works = [w for w in await scoped_works(acc, mine=mine) if w.get("status") != CANCELLED or filters.get("status") == CANCELLED]
    everything = works
    works = apply_filters(works, filters)
    works.sort(key=SORTS.get(sort, SORTS["priority"]), reverse=(order == "desc"))
    total = len(works)
    page = works[skip: skip + limit]
    ids = [str(w["_id"]) for w in page]
    tasks = await _col("client_tasks").find({"work_id": {"$in": ids}}).to_list(100000) if ids else []
    reqs = await _col("client_work_documents").find({"work_id": {"$in": ids}, "type": "REQUEST"}).to_list(100000) if ids else []
    now = now_dt()
    items = [await work_view(w, tasks=[t for t in tasks if t["work_id"] == str(w["_id"])],
                             requests=[r for r in reqs if r["work_id"] == str(w["_id"])], now=now) for w in page]
    facets = {"assignees": sorted({(w["assignee_id"], w["assigned_to"]["name"]) for w in everything if w.get("assigned_to")}, key=lambda x: x[1].lower()),
              "legal": sorted({(w["legal_owner_id"], (w.get("assigned_by") or {}).get("name", "")) for w in everything if w.get("legal_owner_id")}, key=lambda x: x[1].lower()),
              "work_types": sorted({w.get("work_type") for w in everything if w.get("work_type")})}
    facets = {"assignees": [{"id": i, "name": n} for i, n in facets["assignees"]], "legal": [{"id": i, "name": n} for i, n in facets["legal"]],
              "work_types": facets["work_types"]}
    return {"items": items, "total": total, "skip": skip, "limit": limit, "facets": facets}


async def waiting_for_client(acc: Access, filters: Dict[str, Any]) -> Dict[str, Any]:
    """Pending requests across the user's work: what the client still owes, how long, and the hold type."""
    works = {str(w["_id"]): w for w in apply_filters([w for w in await scoped_works(acc) if w.get("status") in ACTIVE], {k: v for k, v in filters.items() if k not in ("waiting_for_client",)})}
    if not works:
        return {"items": [], "total": 0}
    reqs = await _col("client_work_documents").find({"type": "REQUEST", "status": "PENDING"}).to_list(100000)
    now = now_dt()
    items = []
    for r in reqs:
        w = works.get(r["work_id"])
        if not w:
            continue
        requested = parse_dt(r.get("requested_at"))
        hold = w.get("current_hold") if w.get("status") == ON_HOLD else None
        items.append({"id": str(r["_id"]), "work_id": r["work_id"], "client_name": w.get("client_name"), "client_ref": w.get("client_ref"),
                      "assigned_to": (w.get("assigned_to") or {}).get("name"), "required_action": w.get("required_action") or r.get("note") or "",
                      "required_document": r.get("label"), "kind": r.get("kind"), "requested_at": r.get("requested_at"),
                      "days_waiting": seconds_between(requested, now) // 86400, "expected_date": r.get("expected_date"),
                      "overdue": bool(r.get("expected_date") and r["expected_date"] < local_today().isoformat()),
                      "work_status": w.get("status"), "hold_label": HOLD_LABELS.get(hold.get("type")) if hold else None,
                      "status": "Pending"})
    items.sort(key=lambda x: (x["expected_date"] or "9999", x["requested_at"] or ""))
    return {"items": items, "total": len(items)}


# ------------------------------------------------------------------ detail, timeline, history
async def work_detail(work_id: str, acc: Access) -> Dict[str, Any]:
    work = await visible_work(work_id, acc)
    tasks = sorted(await _col("client_tasks").find({"work_id": work_id}).to_list(5000), key=lambda t: t.get("created_at") or "")
    reqs = await _col("client_work_documents").find({"work_id": work_id, "type": "REQUEST"}).to_list(2000)
    view = await work_view(work, tasks=tasks, requests=reqs)
    view["blockers"] = await completion_blockers(work) if work["status"] in ACTIVE else []
    view["ready_to_complete"] = work["status"] in (NEED_ACTION, IN_PROGRESS) and not view["blockers"]
    view["can_act"] = acc.acts(work) and work["status"] in ACTIVE
    view["can_manage"] = acc.monitor and work["status"] in ACTIVE
    view["can_override"] = acc.admin
    view["allowed_transitions"] = sorted((TRANSITIONS.get(work["status"], set()) | (OVERRIDE_TRANSITIONS.get(work["status"], set()) if acc.admin else set())))
    try:
        c = await client_snapshot(work["client_kind"], work["client_id"])
        view["client"] = {**(work.get("client") or {}), **c["snapshot"], "legal_status": c["view"].get("status")}
    except HTTPException:
        pass  # the client record was removed; the snapshot taken at assignment stays
    prev = await _col("client_work").find({"client_kind": work["client_kind"], "client_id": work["client_id"]}).to_list(100)
    view["previous_works"] = [{"id": str(p["_id"]), "work_no": p.get("work_no"), "status": p.get("status"), "created_at": p.get("created_at"),
                               "completed_at": p.get("completed_at")} for p in prev if str(p["_id"]) != work_id]
    view["tasks"] = [await task_view(t) for t in tasks]
    return view


async def task_view(t: Dict[str, Any]) -> Dict[str, Any]:
    out = public(t) or {}
    out["overdue"] = bool(t.get("due_date") and t.get("status") not in ("COMPLETED", "CANCELLED") and t["due_date"] < local_today().isoformat())
    return out


async def list_tasks(work_id: str, acc: Access) -> List[Dict[str, Any]]:
    await visible_work(work_id, acc)
    tasks = sorted(await _col("client_tasks").find({"work_id": work_id}).to_list(5000), key=lambda t: t.get("created_at") or "")
    comments = await _col("client_work_comments").find({"work_id": work_id}).to_list(5000)
    docs = await _col("client_work_documents").find({"work_id": work_id, "type": "FILE"}).to_list(5000)
    acts = await _col("client_work_activity").find({"work_id": work_id}).to_list(20000)
    out = []
    for t in tasks:
        tid = str(t["_id"])
        v = await task_view(t)
        v["comments"] = [public(c) for c in comments if c.get("task_id") == tid]
        v["attachments"] = [public(d) for d in docs if d.get("task_id") == tid]
        v["history"] = sorted((public(a) for a in acts if a.get("task_id") == tid), key=lambda a: a["at"], reverse=True)
        out.append(v)
    return out


async def list_comments(work_id: str, acc: Access) -> List[Dict[str, Any]]:
    await visible_work(work_id, acc)
    return sorted((public(c) for c in await _col("client_work_comments").find({"work_id": work_id}).to_list(5000)), key=lambda c: c["created_at"], reverse=True)


async def list_documents(work_id: str, acc: Access) -> Dict[str, Any]:
    await visible_work(work_id, acc)
    docs = await _col("client_work_documents").find({"work_id": work_id}).to_list(5000)
    return {"requests": sorted((public(d) for d in docs if d["type"] == "REQUEST"), key=lambda d: d["requested_at"], reverse=True),
            "files": sorted((public(d) for d in docs if d["type"] == "FILE"), key=lambda d: d["uploaded_at"], reverse=True)}


async def timeline(work_id: str, acc: Access, limit: int = 500) -> List[Dict[str, Any]]:
    await visible_work(work_id, acc)
    acts = await _col("client_work_activity").find({"work_id": work_id}).to_list(20000)
    return sorted((public(a) for a in acts), key=lambda a: a["at"], reverse=True)[:limit]


async def history(work_id: str, acc: Access) -> Dict[str, Any]:
    work = await visible_work(work_id, acc)
    wid = work_id
    st = sorted((public(s) for s in await _col("client_work_status_history").find({"work_id": wid}).to_list(5000)), key=lambda s: s["at"])
    holds = sorted((public(h) for h in await _col("client_work_hold_history").find({"work_id": wid}).to_list(5000)), key=lambda h: h["started_at"])
    now = now_dt()
    for h in holds:
        if h.get("ended_at") is None:
            h["duration_seconds"] = seconds_between(parse_dt(h["started_at"]), now)
            h["open"] = True
    logs = sorted((public(t) for t in await _col("client_work_time_logs").find({"work_id": wid}).to_list(5000)), key=lambda t: t["at"])
    d = durations(work, now)
    return {"status_history": st, "holds": holds, "time_logs": logs, "durations": d,
            "summary": {"assigned_at": work.get("created_at"), "started_at": work.get("started_at"), "completed_at": work.get("completed_at"),
                        "hold_count": work.get("hold_count", 0), "completion_history": work.get("completion_history", []),
                        "total_calendar_seconds": d["total"], "active_seconds": d["active"], "hold_seconds": d["hold"]}}


# ------------------------------------------------------------------ notifications
async def my_notifications(acc: Access, limit: int = 50) -> Dict[str, Any]:
    items = await _col("client_work_notifications").find({"user_id": acc.uid}).to_list(2000)
    items.sort(key=lambda n: n.get("created_at") or "", reverse=True)
    return {"items": [public(n) for n in items[:limit]], "unread": sum(1 for n in items if not n.get("read"))}


async def mark_notifications_read(acc: Access, ids: Optional[List[str]] = None) -> int:
    n = 0
    for item in await _col("client_work_notifications").find({"user_id": acc.uid, "read": False}).to_list(2000):
        if ids is None or str(item["_id"]) in ids:
            await _col("client_work_notifications").update_one({"_id": item["_id"]}, {"$set": {"read": True}})
            n += 1
    return n


# ------------------------------------------------------------------ overdue sweep
_last_sweep = 0.0


async def sweep_overdue(force: bool = False) -> int:
    """Tell assignee + assigner once per missed deadline, and Super Admins how many works are overdue."""
    global _last_sweep
    if not force and time.monotonic() - _last_sweep < 60:
        return 0
    _last_sweep = time.monotonic()
    today = local_today().isoformat()
    overdue = [w for w in await _col("client_work").find({}).to_list(50000)
               if w.get("status") in ACTIVE and w.get("deadline") and w["deadline"] < today]
    for w in overdue:
        if w.get("overdue_notified_for") == w["deadline"]:
            continue
        await notify([w["assignee_id"], w["legal_owner_id"]], w, "OVERDUE", f"{w['client_name']} is overdue.",
                     f"Deadline was {w['deadline']}", dedupe=f"overdue:{w['_id']}:{w['deadline']}")
        await _col("client_work").update_one({"_id": w["_id"]}, {"$set": {"overdue_notified_for": w["deadline"]}})
        publish(w, "overdue")
    if overdue:
        admins = [str(a["_id"]) for a in await _col("admins").find({}).to_list(2000)
                  if a.get("is_active", True) and rbac.SUPERADMIN in rbac.user_roles(a)]
        anchor = {"_id": "summary"}
        key = f"overdue-summary:{today}:{len(overdue)}"
        await notify(admins, anchor, "OVERDUE_SUMMARY", f"{len(overdue)} client work{'s are' if len(overdue) != 1 else ' is'} overdue.",
                     "Open Client Work to review them.", dedupe=key)
    return len(overdue)


# ------------------------------------------------------------------ statistics
def _avg(values: List[int]) -> int:
    return int(sum(values) / len(values)) if values else 0


async def dashboard_stats(acc: Access, mine: bool = False) -> Dict[str, Any]:
    await sweep_overdue()
    works = [w for w in await scoped_works(acc, mine=mine) if w.get("status") != CANCELLED]
    now = now_dt()
    today = local_today()
    today_s = today.isoformat()
    soon_s = (today + timedelta(days=DUE_SOON_DAYS)).isoformat()
    active = [w for w in works if w["status"] in ACTIVE]
    done = [w for w in works if w["status"] == COMPLETED]
    need = [w for w in active if w["status"] in (NEED_ACTION, IN_PROGRESS)]
    hold = [w for w in active if w["status"] == ON_HOLD]
    week_start = today - timedelta(days=today.weekday())

    def completed_on(w):
        d = parse_dt(w.get("completed_at"))
        return to_local(d).date() if d else None

    overdue = [w for w in active if w.get("deadline") and w["deadline"] < today_s]
    waiting = [w for w in hold if (w.get("current_hold") or {}).get("type") == HOLD_WAITING]
    internal = [w for w in hold if (w.get("current_hold") or {}).get("type") == HOLD_INTERNAL]
    ids = {str(w["_id"]) for w in works}
    holds = [h for h in await _col("client_work_hold_history").find({}).to_list(100000) if h["work_id"] in ids]
    hold_secs = [(h.get("duration_seconds") if h.get("ended_at") else seconds_between(parse_dt(h["started_at"]), now)) or 0 for h in holds]
    reqs = [r for r in await _col("client_work_documents").find({"type": "REQUEST"}).to_list(100000) if r["work_id"] in ids]
    response = [seconds_between(parse_dt(r["requested_at"]), parse_dt(r["received_at"])) for r in reqs if r.get("status") == "RECEIVED" and r.get("received_at")]
    comp_days: Dict[str, int] = {}
    for w in done:
        d = completed_on(w)
        if d:
            comp_days[d.isoformat()] = comp_days.get(d.isoformat(), 0) + 1
    daily = [{"label": (today - timedelta(days=i)).strftime("%d %b"), "value": comp_days.get((today - timedelta(days=i)).isoformat(), 0)} for i in range(13, -1, -1)]
    weekly = []
    for i in range(7, -1, -1):
        ws = week_start - timedelta(weeks=i)
        weekly.append({"label": ws.strftime("%d %b"), "value": sum(v for k, v in comp_days.items() if ws <= date.fromisoformat(k) < ws + timedelta(days=7))})
    monthly = []
    for i in range(5, -1, -1):
        y, m = today.year, today.month - i
        while m <= 0:
            m += 12
            y -= 1
        monthly.append({"label": date(y, m, 1).strftime("%b %Y"), "value": sum(v for k, v in comp_days.items() if k[:7] == f"{y}-{m:02d}")})

    out: Dict[str, Any] = {
        "scope": "all" if (acc.monitor and not mine) else "mine", "generated_at": now_iso(),
        "counters": {"need_action": len(need), "in_progress": sum(1 for w in need if w["status"] == IN_PROGRESS), "on_hold": len(hold),
                     "completed": len(done), "total_active": len(active), "my_clients": len({w["client_id"] for w in works}),
                     "overdue": len(overdue), "due_today": sum(1 for w in active if w.get("deadline") == today_s),
                     "due_soon": sum(1 for w in active if w.get("deadline") and today_s < w["deadline"] <= soon_s),
                     "completed_today": sum(1 for w in done if completed_on(w) == today),
                     "completed_this_week": sum(1 for w in done if (completed_on(w) or date.min) >= week_start),
                     "completed_this_month": sum(1 for w in done if (completed_on(w) or date.min) >= today.replace(day=1)),
                     "waiting_for_client": len(waiting), "internal_blocker": len(internal)},
        "status_chart": [{"label": "Need Action", "value": len(need)}, {"label": "On Hold", "value": len(hold)}, {"label": "Completed", "value": len(done)}],
        "performance": {"total_clients": len({w["client_id"] for w in works}), "avg_completion_seconds": _avg([w.get("total_duration") or durations(w, now)["total"] for w in done]),
                        "avg_active_seconds": _avg([w.get("active_duration") or durations(w, now)["active"] for w in done]),
                        "avg_hold_seconds": _avg(hold_secs), "avg_response_seconds": _avg(response),
                        "completed_work": len(done), "pending_work": len(active), "overdue_work": len(overdue)},
        "trend": {"daily": daily, "weekly": weekly, "monthly": monthly},
        "hold_analysis": {"total_on_hold": len(hold), "waiting_for_client": len(waiting), "internal_blocker": len(internal), "avg_hold_seconds": _avg(hold_secs),
                          "chart": [{"label": "Waiting for client", "value": len(waiting)}, {"label": "Internal blocker", "value": len(internal)}]},
    }
    if acc.monitor and not mine:
        by: Dict[str, Dict[str, Any]] = {}
        for w in works:
            r = by.setdefault(w["assignee_id"], {"user_id": w["assignee_id"], "name": w["assigned_to"]["name"], "assigned": 0, "completed": 0, "pending": 0, "overdue": 0, "_t": []})
            r["assigned"] += 1
            if w["status"] == COMPLETED:
                r["completed"] += 1
                r["_t"].append(w.get("total_duration") or durations(w, now)["total"])
            elif w["status"] in ACTIVE:
                r["pending"] += 1
                if w.get("deadline") and w["deadline"] < today_s:
                    r["overdue"] += 1
        out["members"] = sorted(({**{k: v for k, v in r.items() if k != "_t"}, "avg_completion_seconds": _avg(r["_t"])} for r in by.values()),
                                key=lambda r: (-r["pending"], r["name"].lower()))
    return out
