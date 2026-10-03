"""
Operation dashboard: every client case moves through the operation stages, and the documents the
Legal team provided or approved for it are listed on the case.

Cases are the Legal module's clients (legal records and client document forms). A case starts at
Onboarding and can only move on once Legal has approved it. This module adds where each case stands
and who in Admin works it, in `operation_cases` (one row per client, keyed "<kind>:<id>", with its
stage history); the stage is also written onto the client record as `operation_stage`.

Who sees what: everyone with the dashboard sees the unassigned cases and the ones assigned to them or
by them; operations.dashboard.manage sees and reassigns every case.

Documents are read from where Legal already keeps them; nothing is copied:
  * a legal record's verification report, once Legal has made it available;
  * the files of a client document form, once Legal has approved the form;
  * files uploaded to the client's work by someone on the Legal team.
"""
import base64
import re
import uuid
from datetime import datetime, timezone
from html import escape
from typing import Any, Dict, List, Literal, Optional, Set

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, Field

from app.database import get_collection
from app.routers.legal import CLIENT_KINDS, _all_clients, _client_doc, _client_view, _matches, record_report_html
from app.services import operations_service as ops
from app.services.auth_service import get_current_admin
from app.services.rbac_service import get_user_permissions, has_role

router = APIRouter(prefix="/api/operations", tags=["Operations"])

# The pipeline, in order. Add a stage by appending it here: cases keep their stored stage key.
STAGES: List[Dict[str, str]] = [
    {"key": "ONBOARDING", "label": "Onboarding"},
    {"key": "CREATING_DOCUMENTATION", "label": "Creating Documentation"},
    {"key": "PROCESS_START", "label": "Process start"},
    {"key": "DOCUMENTS_REVIEW", "label": "Documents Review"},
    {"key": "APPROVAL", "label": "Approval"},
    {"key": "SUBMISSION", "label": "Submission"},
    {"key": "MEETING_1", "label": "Meeting-1"},
    {"key": "SELECTION", "label": "Selection"},
]
STAGE_LABELS = {s["key"]: s["label"] for s in STAGES}
FIRST_STAGE = STAGES[0]["key"]
VIEWS = ("unassigned", "mine", "by_me", "all")


def _now() -> str:
    return datetime.utcnow().isoformat()


def _uid(user: Dict[str, Any]) -> str:
    return str(user.get("_id") or user.get("id") or "")


def _person(user: Dict[str, Any]) -> Dict[str, str]:
    return {"user_id": _uid(user), "name": user.get("username") or user.get("email", ""), "email": user.get("email", "")}


def _case_key(kind: str, item_id: str) -> str:
    return f"{kind}:{item_id}"


async def _can_manage(admin: Dict[str, Any]) -> bool:
    return "operations.dashboard.manage" in await get_user_permissions(admin)


async def _legal_user_ids() -> Set[str]:
    """Accounts whose uploads count as provided by the Legal team."""
    docs = await get_collection("admins").find({}).to_list(5000)
    return {str(d["_id"]) for d in docs if has_role(d, "legal") or has_role(d, "superadmin") or "legal.manage" in (d.get("grants") or [])}


def _documents(kind: str, doc: Dict[str, Any], work_files: List[Dict[str, Any]], legal_ids: Set[str]) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    approved = doc.get("status") == "APPROVED"
    reviewer, reviewed_at = doc.get("reviewed_by") or "Legal team", doc.get("reviewed_at") or doc.get("updated_at") or ""
    if kind == "record" and doc.get("pdf_available"):
        ref = str(doc.get("crm_id") or doc["_id"]).lstrip("#")
        out.append({"id": "report", "label": "Legal verification report", "filename": f"Legal-report-{ref}.html",
                    "content_type": "text/html", "size": None, "source": "APPROVED" if approved else "PROVIDED",
                    "by": reviewer, "at": reviewed_at or doc.get("created_at", "")})
    if kind == "document" and approved:
        for f in doc.get("files") or []:
            out.append({"id": f"form-{f['file_id']}", "label": f.get("label") or "Document", "filename": f.get("filename") or "document",
                        "content_type": f.get("content_type"), "size": f.get("size"), "source": "APPROVED", "by": reviewer, "at": reviewed_at})
    for f in work_files:
        if f.get("uploaded_by_id") in legal_ids:
            out.append({"id": f"work-{f['_id']}", "label": f.get("label") or f.get("filename") or "Document", "filename": f.get("filename") or "document",
                        "content_type": f.get("content_type"), "size": f.get("size"), "source": "PROVIDED",
                        "by": f.get("uploaded_by") or "Legal team", "at": f.get("uploaded_at") or ""})
    return sorted(out, key=lambda d: str(d.get("at") or ""), reverse=True)


async def _work_files_by_client() -> Dict[str, List[Dict[str, Any]]]:
    works = {str(w["_id"]): _case_key(w.get("client_kind", ""), str(w.get("client_id", "")))
             for w in await get_collection("client_work").find({}).to_list(100000)}
    out: Dict[str, List[Dict[str, Any]]] = {}
    for f in await get_collection("client_work_documents").find({"type": "FILE"}).to_list(100000):
        key = works.get(str(f.get("work_id")))
        if key:
            out.setdefault(key, []).append(f)
    return out


def _reminder_view(r: Dict[str, Any]) -> Dict[str, Any]:
    return {"id": str(r["_id"]), "type": r.get("type"), "due_at": r.get("due_at"), "note": r.get("body") or "",
            "owner": r.get("owner"), "created_by": r.get("created_by"), "created_at": r.get("created_at"),
            "done_at": r.get("done_at"), "case_key": (r.get("related") or {}).get("id"), "company_name": (r.get("related") or {}).get("label", "")}


def _case(client: Dict[str, Any], row: Optional[Dict[str, Any]], documents: List[Dict[str, Any]], pending_review: int,
          reminders: List[Dict[str, Any]]) -> Dict[str, Any]:
    row = row or {}
    stage = row.get("stage") if row.get("stage") in STAGE_LABELS else FIRST_STAGE
    open_r = [r for r in reminders if not r.get("done_at")]
    return {"key": _case_key(client["kind"], client["id"]), "kind": client["kind"], "id": client["id"], "reference": client["reference"],
            "company_name": client["company_name"], "contact_name": client["contact_name"], "contact_email": client["contact_email"],
            "contact_phone": client["contact_phone"], "gstin": client.get("gstin", ""), "bdm": client["bdm"], "services": client["services"],
            "amount": client.get("amount"), "legal_status": client["status"], "legal_approved": client["status"] == "APPROVED",
            "legal_assigned_to": client.get("assigned_to"), "created_at": client["created_at"],
            "assigned_to": row.get("assigned_to"), "assigned_by": row.get("assigned_by"), "assigned_at": row.get("assigned_at"),
            "stage": stage, "stage_label": STAGE_LABELS[stage],
            "stage_since": row.get("stage_since") or client["created_at"], "stage_by": row.get("stage_by", ""),
            "documents": documents, "pending_review": pending_review,
            "next_reminder": _reminder_view(open_r[0]) if open_r else None}


def _pending_review(kind: str, raw: Dict[str, Any]) -> int:
    """Documents the client has handed over that Legal hasn't approved yet (shown as a count, not listed)."""
    if kind == "document" and raw.get("status") != "APPROVED":
        return len(raw.get("files") or [])
    return 0


def _in_view(case: Dict[str, Any], view: str, me: str) -> bool:
    to, by = (case.get("assigned_to") or {}).get("user_id"), (case.get("assigned_by") or {}).get("user_id")
    if view == "unassigned":
        return not to
    if view == "mine":
        return to == me
    if view == "by_me":
        return bool(to) and by == me
    return True


def _may_see(case: Dict[str, Any], me: str, manage: bool) -> bool:
    return manage or any(_in_view(case, v, me) for v in ("unassigned", "mine", "by_me"))


async def _raw_clients() -> Dict[str, Dict[str, Any]]:
    out: Dict[str, Dict[str, Any]] = {}
    for kind, col in CLIENT_KINDS.items():
        for d in await get_collection(col).find({}).to_list(5000):
            out[_case_key(kind, str(d["_id"]))] = d
    return out


async def _build_case(kind: str, item_id: str, admin: Dict[str, Any]) -> Dict[str, Any]:
    raw = await _client_doc(kind, item_id)
    key = _case_key(kind, item_id)
    row = await get_collection("operation_cases").find_one({"_id": key})
    reminders = await ops.case_reminders(key)
    files = (await _work_files_by_client()).get(key, [])
    case = _case(_client_view(kind, raw), row, _documents(kind, raw, files, await _legal_user_ids()), _pending_review(kind, raw), reminders)
    if not _may_see(case, _uid(admin), await _can_manage(admin)):
        raise HTTPException(status_code=404, detail="Case not found.")  # assigned to someone else
    case["history"] = list(reversed((row or {}).get("history") or []))
    case["reminders"] = [_reminder_view(r) for r in reversed(reminders)]
    return case


async def _save(key: str, kind: str, item_id: str, row: Optional[Dict[str, Any]], changes: Dict[str, Any]) -> None:
    col = get_collection("operation_cases")
    if row:
        await col.update_one({"_id": key}, {"$set": changes})
    else:
        await col.insert_one({"_id": key, "kind": kind, "client_id": item_id, "created_at": _now(), **changes})


@router.get("/board")
async def board(
    view: str = Query("unassigned", description="unassigned, mine (assigned to me), by_me (assigned by me) or all"),
    search: Optional[str] = Query(None),
    with_documents: bool = Query(False, description="only cases that have a document from Legal"),
    admin: Dict[str, Any] = Depends(get_current_admin),
):
    manage, me = await _can_manage(admin), _uid(admin)
    if view not in VIEWS or (view == "all" and not manage):
        view = "unassigned"
    clients = await _all_clients()
    raws = await _raw_clients()
    rows = {r["_id"]: r for r in await get_collection("operation_cases").find({}).to_list(100000)}
    files = await _work_files_by_client()
    legal_ids = await _legal_user_ids()
    reminders: Dict[str, List[Dict[str, Any]]] = {}
    for r in await ops.open_reminders():
        reminders.setdefault((r.get("related") or {}).get("id"), []).append(r)

    cases = []
    for c in clients:
        key = _case_key(c["kind"], c["id"])
        raw = raws.get(key) or {}
        cases.append(_case(c, rows.get(key), _documents(c["kind"], {"_id": c["id"], **raw}, files.get(key, []), legal_ids),
                           _pending_review(c["kind"], raw), reminders.get(key, [])))
    if search and search.strip():
        clients_by_key = {_case_key(c["kind"], c["id"]): c for c in clients}
        cases = [x for x in cases if _matches(clients_by_key[x["key"]], search.strip())
                 or search.strip().lower() in str((x.get("assigned_to") or {}).get("name", "")).lower()]
    if with_documents:
        cases = [x for x in cases if x["documents"]]

    views = {v: sum(1 for x in cases if _in_view(x, v, me)) for v in VIEWS if v != "all" or manage}
    cases = [x for x in cases if _in_view(x, view, me)]
    counts = {s["key"]: 0 for s in STAGES}
    for x in cases:
        counts[x["stage"]] += 1
    return {
        "view": view, "views": views,
        "stages": [{**s, "count": counts[s["key"]]} for s in STAGES],
        "cases": cases,
        "total": len(cases),
        "documents_total": sum(len(x["documents"]) for x in cases),
        "awaiting_legal": sum(1 for x in cases if not x["legal_approved"]),
        "can_manage": manage,
    }


@router.get("/assignees")
async def assignees(admin: Dict[str, Any] = Depends(get_current_admin)):
    """Every active Admin a case can be assigned to."""
    docs = await get_collection("admins").find({}).to_list(5000)
    people = [_person(d) for d in docs if d.get("is_active", True) and has_role(d, "admin")]
    return {"items": sorted(people, key=lambda p: p["name"].lower())}


@router.get("/cases/{kind}/{item_id}")
async def get_case(kind: str, item_id: str, admin: Dict[str, Any] = Depends(get_current_admin)):
    return await _build_case(kind, item_id, admin)


class StageMove(BaseModel):
    stage: str
    note: str = Field(default="", max_length=1000)


@router.put("/cases/{kind}/{item_id}/stage")
async def move_case(kind: str, item_id: str, req: StageMove, admin: Dict[str, Any] = Depends(get_current_admin)):
    if req.stage not in STAGE_LABELS:
        raise HTTPException(status_code=422, detail=f"Stage must be one of: {', '.join(s['label'] for s in STAGES)}.")
    case = await _build_case(kind, item_id, admin)
    if req.stage != FIRST_STAGE and not case["legal_approved"]:
        raise HTTPException(status_code=409, detail="Onboarding finishes once Legal approves this client's documents.")
    if case["stage"] == req.stage:
        return case
    key = _case_key(kind, item_id)
    row = await get_collection("operation_cases").find_one({"_id": key})
    at, me = _now(), _person(admin)
    entry = {"from": case["stage"], "from_label": case["stage_label"], "to": req.stage, "to_label": STAGE_LABELS[req.stage],
             "by": me["name"], "by_email": me["email"], "at": at, "note": req.note.strip()}
    await _save(key, kind, item_id, row, {"stage": req.stage, "stage_since": at, "stage_by": me["name"], "updated_at": at,
                                          "history": [*((row or {}).get("history") or []), entry]})
    # The client's own record carries its operation stage too, so it shows wherever the client does.
    await get_collection(CLIENT_KINDS[kind]).update_one({"_id": item_id}, {"$set": {
        "operation_stage": req.stage, "operation_stage_label": STAGE_LABELS[req.stage], "operation_stage_at": at}})
    assignee = (case.get("assigned_to") or {}).get("user_id")
    if assignee and assignee != me["user_id"]:
        await ops.notify(assignee, f"{case['company_name']} moved to {STAGE_LABELS[req.stage]}", f"By {me['name']}" + (f": {req.note.strip()}" if req.note.strip() else ""))
    return await _build_case(kind, item_id, admin)


class AssignCase(BaseModel):
    user_id: Optional[str] = None  # None unassigns
    note: str = Field(default="", max_length=1000)


@router.put("/cases/{kind}/{item_id}/assign")
async def assign_case(kind: str, item_id: str, req: AssignCase, admin: Dict[str, Any] = Depends(get_current_admin)):
    case = await _build_case(kind, item_id, admin)
    me = _person(admin)
    current = case.get("assigned_to") or {}
    if current and not (await _can_manage(admin) or me["user_id"] in (current.get("user_id"), (case.get("assigned_by") or {}).get("user_id"))):
        raise HTTPException(status_code=403, detail="Only the person who assigned this case, its assignee or a manager can reassign it.")
    assigned = None
    if req.user_id:
        user = await get_collection("admins").find_one({"_id": req.user_id})
        if not user or not user.get("is_active", True) or not has_role(user, "admin"):
            raise HTTPException(status_code=404, detail="Pick an active Admin to assign this case to.")
        assigned = _person(user)
    if (assigned or {}).get("user_id") == current.get("user_id"):
        return case
    key, at = _case_key(kind, item_id), _now()
    row = await get_collection("operation_cases").find_one({"_id": key})
    log = {"at": at, "by": me["name"], "from": current.get("name", ""), "to": (assigned or {}).get("name", ""), "note": req.note.strip()}
    await _save(key, kind, item_id, row, {"assigned_to": assigned, "assigned_by": me if assigned else None, "assigned_at": at if assigned else None,
                                          "updated_at": at, "assignment_history": [*((row or {}).get("assignment_history") or []), log]})
    if assigned and assigned["user_id"] != me["user_id"]:
        title = f"Client case assigned to you: {case['company_name']}"
        await ops.notify(assigned["user_id"], title, f"By {me['name']} · stage {case['stage_label']}" + (f" · {req.note.strip()}" if req.note.strip() else ""))
        await ops.email(assigned["email"], title,
                        f"<p>Dear {escape(assigned['name'])},</p><p>{escape(me['name'])} assigned the client "
                        f"<b>{escape(case['company_name'])}</b> ({escape(case['reference'])}) to you on the Operation dashboard.</p>"
                        f"<p>Current stage: {escape(case['stage_label'])}</p>"
                        + (f"<p>Note: {escape(req.note.strip())}</p>" if req.note.strip() else "")
                        + "<p>You'll find it under “Assigned to me” on your dashboard.</p>")
    if current.get("user_id") and current["user_id"] != me["user_id"]:
        await ops.notify(current["user_id"], f"{case['company_name']} is no longer assigned to you", f"Changed by {me['name']}")
    return await _build_case(kind, item_id, admin)


@router.get("/cases/{kind}/{item_id}/documents/{doc_id}")
async def download_document(kind: str, item_id: str, doc_id: str, admin: Dict[str, Any] = Depends(get_current_admin)):
    case = await _build_case(kind, item_id, admin)
    meta = next((d for d in case["documents"] if d["id"] == doc_id), None)
    if not meta:
        # Anything Legal hasn't provided or approved reads as not found here.
        raise HTTPException(status_code=404, detail="Document not found.")
    if doc_id == "report":
        content, media = record_report_html(await _client_doc(kind, item_id)).encode("utf-8"), "text/html; charset=utf-8"
    elif doc_id.startswith("form-"):
        f = await get_collection("client_document_files").find_one({"_id": doc_id[5:], "submission_id": item_id})
        if not f:
            raise HTTPException(status_code=404, detail="Document not found.")
        content, media = base64.b64decode(f["data_b64"]), f.get("content_type") or "application/octet-stream"
    else:
        d = await get_collection("client_work_documents").find_one({"_id": doc_id[5:], "type": "FILE"})
        f = d and await get_collection("client_work_files").find_one({"_id": d["file_id"]})
        if not f:
            raise HTTPException(status_code=404, detail="Document not found.")
        content, media = base64.b64decode(f["data_b64"]), d.get("content_type") or "application/octet-stream"
    safe = re.sub(r'[^A-Za-z0-9._ -]', "_", meta["filename"] or "document")
    return Response(content=content, media_type=media, headers={"Content-Disposition": f'attachment; filename="{safe}"'})


# ------------------------------------------------------------------ call and email reminders
class ReminderCreate(BaseModel):
    type: Literal["CALL", "EMAIL"]
    due_at: str = Field(description="when to remind, ISO date-time (UTC unless it carries an offset)")
    note: str = Field(default="", max_length=1000)
    owner_id: Optional[str] = None  # who to remind; defaults to the case's assignee, else yourself


def _utc(value: str) -> str:
    try:
        dt = datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
    except ValueError:
        raise HTTPException(status_code=422, detail="Give the reminder time as a date and time.")
    if dt.tzinfo:
        dt = dt.astimezone(timezone.utc).replace(tzinfo=None)
    return dt.isoformat()


@router.post("/cases/{kind}/{item_id}/reminders")
async def add_reminder(kind: str, item_id: str, req: ReminderCreate, admin: Dict[str, Any] = Depends(get_current_admin)):
    case = await _build_case(kind, item_id, admin)
    me = _person(admin)
    owner_id = req.owner_id or (case.get("assigned_to") or {}).get("user_id") or me["user_id"]
    user = await get_collection("admins").find_one({"_id": owner_id})
    if not user or not user.get("is_active", True):
        raise HTTPException(status_code=404, detail="That person doesn't exist or is disabled.")
    owner = _person(user)
    what = ops.REMINDER_TYPES[req.type]
    row = {"_id": uuid.uuid4().hex, "type": req.type, "subject": f"{what} {case['company_name']}", "body": req.note.strip(),
           "due_at": _utc(req.due_at), "done_at": None, "reminder_sent_at": None, "owner": owner, "created_by": me, "created_at": _now(),
           "related": {"kind": ops.CASE_KIND, "id": case["key"], "label": case["company_name"]}}
    await get_collection("crm_activities").insert_one(dict(row))
    if owner["user_id"] != me["user_id"]:
        await ops.notify(owner["user_id"], f"{me['name']} set you a {what.lower()} reminder: {case['company_name']}", req.note.strip())
    return _reminder_view(row)


@router.get("/reminders")
async def my_reminders(admin: Dict[str, Any] = Depends(get_current_admin)):
    """Your open call and email reminders, soonest first."""
    return {"items": [_reminder_view(r) for r in await ops.open_reminders(_uid(admin))], "now": _now()}


async def _own_reminder(reminder_id: str, admin: Dict[str, Any]) -> Dict[str, Any]:
    r = await get_collection("crm_activities").find_one({"_id": reminder_id})
    if not r or (r.get("related") or {}).get("kind") != ops.CASE_KIND:
        raise HTTPException(status_code=404, detail="Reminder not found.")
    if _uid(admin) not in ((r.get("owner") or {}).get("user_id"), (r.get("created_by") or {}).get("user_id")) and not await _can_manage(admin):
        raise HTTPException(status_code=404, detail="Reminder not found.")
    return r


@router.post("/reminders/{reminder_id}/done")
async def complete_reminder(reminder_id: str, admin: Dict[str, Any] = Depends(get_current_admin)):
    r = await _own_reminder(reminder_id, admin)
    await get_collection("crm_activities").update_one({"_id": r["_id"]}, {"$set": {"done_at": _now(), "done_by": _person(admin)}})
    return {"success": True}


@router.delete("/reminders/{reminder_id}")
async def delete_reminder(reminder_id: str, admin: Dict[str, Any] = Depends(get_current_admin)):
    r = await _own_reminder(reminder_id, admin)
    await get_collection("crm_activities").delete_one({"_id": r["_id"]})
    return {"success": True}
