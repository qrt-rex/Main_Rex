"""
Sales workspace: leads to call (with a dialer that logs each call as a CRM entry), schemes,
company material (posts, flyers, PDFs, sales information), the sales team's progress and a live
day-start / day-end attendance board.

Admin and Legal (and Super Admin) add and edit leads, schemes and material (`sales.hub.manage`);
sales staff use it from their dashboard (`sales.hub.view`) and only see the leads assigned to them.
"""
import base64
import logging
import os
import re
import uuid
from datetime import date, datetime
from typing import Any, Dict, List, Literal, Optional

import pytz
from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from pydantic import BaseModel, Field
from starlette.datastructures import UploadFile

from app.config import settings
from app.database import get_collection
from app.schemas.attendance import PunchInRequest, PunchOutRequest
from app.services.attendance_service import AttendanceService
from app.services.auth_service import get_current_admin
from app.services.rbac_service import ROLES, get_user_permissions, has_role, normalize_role, sees_all_attendance

router = APIRouter(prefix="/api/sales-hub", tags=["Sales Workspace"])
logger = logging.getLogger("rexera.sales_hub")

LEAD_STATUSES = ["NEW", "ATTEMPTED", "CALL_BACK", "INTERESTED", "NOT_INTERESTED", "CONVERTED", "INVALID"]
OPEN_STATUSES = {"NEW", "ATTEMPTED", "CALL_BACK", "INTERESTED"}
OUTCOME_STATUS = {"NO_ANSWER": "ATTEMPTED", "BUSY": "ATTEMPTED", "CALL_BACK": "CALL_BACK", "INTERESTED": "INTERESTED",
                  "NOT_INTERESTED": "NOT_INTERESTED", "CONVERTED": "CONVERTED", "WRONG_NUMBER": "INVALID"}
Outcome = Literal["NO_ANSWER", "BUSY", "CALL_BACK", "INTERESTED", "NOT_INTERESTED", "CONVERTED", "WRONG_NUMBER"]
MATERIAL_KINDS = ["POST", "FLYER", "PDF", "SALES_INFO", "VIDEO", "OTHER"]
ALLOWED_EXT = {".pdf", ".jpg", ".jpeg", ".png", ".webp", ".gif", ".doc", ".docx", ".ppt", ".pptx", ".xls", ".xlsx", ".mp4"}
MAX_FILE_BYTES = 10 * 1024 * 1024
ROLE_LABELS = {r["id"]: r["label"] for r in ROLES}


def _tz():
    return pytz.timezone(settings.AUTOMATION_TIMEZONE)


def _today() -> str:
    return datetime.now(_tz()).date().isoformat()


def _now() -> str:
    return datetime.utcnow().isoformat()


def _id(doc: Dict[str, Any]) -> Dict[str, Any]:
    out = {k: v for k, v in doc.items() if k != "_id"}
    out["id"] = str(doc["_id"])
    return out


def _me(admin: Dict[str, Any]) -> Dict[str, str]:
    return {"user_id": str(admin.get("_id") or admin.get("id") or ""), "name": admin.get("username") or admin.get("email", ""),
            "email": admin.get("email", "")}


async def _can_manage(admin: Dict[str, Any]) -> bool:
    return "sales.hub.manage" in await get_user_permissions(admin)


async def _user(user_id: str) -> Dict[str, str]:
    u = await get_collection("admins").find_one({"_id": user_id})
    if not u or not u.get("is_active", True):
        raise HTTPException(status_code=404, detail="That user doesn't exist or is disabled.")
    return {"user_id": str(u["_id"]), "name": u.get("username") or u.get("email", ""), "email": u.get("email", "")}


async def _sales_team() -> List[Dict[str, Any]]:
    """Active sales & employee users, plus anyone who has leads or a day session (e.g. an admin who also calls)."""
    users = [u for u in await get_collection("admins").find({}).to_list(2000) if u.get("is_active", True)]
    lead_owners = {(l.get("assigned_to") or {}).get("user_id") for l in await get_collection("sales_leads").find({}).to_list(20000)}
    session_users = {s.get("user_id") for s in await get_collection("sales_day_sessions").find({"date": _today()}).to_list(5000)}
    team = [u for u in users if has_role(u, "sales") or str(u["_id"]) in lead_owners | session_users]
    return sorted(team, key=lambda u: (u.get("username") or u.get("email", "")).lower())


# ---------------------------------------------------------------------------
# Dashboard summary (sales staff)
# ---------------------------------------------------------------------------
@router.get("/summary")
async def summary(admin: Dict[str, Any] = Depends(get_current_admin)):
    me = _me(admin)
    leads = await get_collection("sales_leads").find({"assigned_to.user_id": me["user_id"]}).to_list(5000)
    order = {"CALL_BACK": 0, "INTERESTED": 1, "NEW": 2, "ATTEMPTED": 3}
    leads.sort(key=lambda l: (order.get(l.get("status"), 9), str(l.get("follow_up_date") or "9999"), str(l.get("created_at") or "")))
    today = _today()
    schemes = [s for s in await get_collection("sales_schemes").find({"active": True}).sort("created_at", -1).to_list(200)
               if not s.get("valid_to") or s["valid_to"] >= today]
    materials = await get_collection("sales_materials").find({"active": True}).sort("created_at", -1).to_list(200)
    session = await get_collection("sales_day_sessions").find_one({"user_id": me["user_id"], "date": today})
    return {
        "me": me,
        "can_manage": await _can_manage(admin),
        "today": today,
        "session": _id(session) if session else None,
        "leads": [_id(l) for l in leads],
        "schemes": [_id(s) for s in schemes],
        "materials": [_material_view(m) for m in materials],
        "progress": await _progress(today, today, admin),
        "attendance": await _attendance(today, admin),
    }


# ---------------------------------------------------------------------------
# Start / end the day (feeds the attendance board)
# ---------------------------------------------------------------------------
async def _sync_attendance(admin: Dict[str, Any], event: str) -> None:
    """
    Start Day is the attendance punch-in and End Day the punch-out, so payroll sees the same day. The existing
    shift rules decide the status: late arrival is Late / Half Day, logging out before the early-logout cutoff
    downgrades to Half Day. Staff without an employee record (matched by email) just skip attendance.
    """
    email = (admin.get("email") or "").strip()
    emp = await get_collection("employees").find_one({"email": {"$regex": f"^{re.escape(email)}$", "$options": "i"}}) if email else None
    if not emp:
        return
    ref = emp.get("employee_code") or emp.get("employee_id") or str(emp["_id"])
    try:
        if event == "in":
            await AttendanceService.process_punch_in(PunchInRequest(employee_id=ref), skip_location=True)
        else:
            await AttendanceService.process_punch_out(PunchOutRequest(employee_id=ref))
    except (ValueError, PermissionError) as e:  # already punched today, no email on file...: the day session still works
        logger.info("Attendance %s skipped for %s: %s", event, email, e)


@router.post("/day/start")
async def start_day(admin: Dict[str, Any] = Depends(get_current_admin)):
    me, today = _me(admin), _today()
    await _sync_attendance(admin, "in")
    col = get_collection("sales_day_sessions")
    existing = await col.find_one({"user_id": me["user_id"], "date": today})
    if existing and not existing.get("ended_at"):
        return _id(existing)
    if existing:  # ended earlier today and starting again: resume the same day
        await col.update_one({"_id": existing["_id"]}, {"$set": {"ended_at": None, "resumed_at": _now()}})
        return _id(await col.find_one({"_id": existing["_id"]}))
    doc = {**me, "role": normalize_role(admin.get("role")), "date": today, "started_at": _now(), "ended_at": None}
    res = await col.insert_one(dict(doc))
    return {**doc, "id": str(res.inserted_id)}


@router.post("/day/end")
async def end_day(admin: Dict[str, Any] = Depends(get_current_admin)):
    me = _me(admin)
    col = get_collection("sales_day_sessions")
    existing = await col.find_one({"user_id": me["user_id"], "date": _today()})
    if not existing:
        raise HTTPException(status_code=409, detail="You haven't started your day yet.")
    await _sync_attendance(admin, "out")
    if not existing.get("ended_at"):
        await col.update_one({"_id": existing["_id"]}, {"$set": {"ended_at": _now()}})
    return _id(await col.find_one({"_id": existing["_id"]}))


def _hours(s: Dict[str, Any]) -> float:
    try:
        start = datetime.fromisoformat(s["started_at"])
        end = datetime.fromisoformat(s["ended_at"]) if s.get("ended_at") else datetime.utcnow()
        return round(max(0.0, (end - start).total_seconds() / 3600), 2)
    except (KeyError, TypeError, ValueError):
        return 0.0


async def _attendance(day: str, viewer: Dict[str, Any]) -> List[Dict[str, Any]]:
    """The day board. Only HR, Admin and Super Admin see everyone; anyone else sees their own row."""
    sessions = {s.get("user_id"): s for s in await get_collection("sales_day_sessions").find({"date": day}).to_list(5000)}
    everyone, me = sees_all_attendance(viewer), _me(viewer)["user_id"]
    board = []
    for u in await _sales_team():
        uid = str(u["_id"])
        if not everyone and uid != me:
            continue
        s = sessions.get(uid)
        board.append({
            "user_id": uid, "name": u.get("username") or u.get("email", ""), "email": u.get("email", ""),
            "role_label": ROLE_LABELS.get(normalize_role(u.get("role")), u.get("role", "")),
            "status": "NOT_STARTED" if not s else ("WORKING" if not s.get("ended_at") else "DAY_ENDED"),
            "started_at": (s or {}).get("started_at"), "ended_at": (s or {}).get("ended_at"),
            "hours": _hours(s) if s else 0.0, "last_login": u.get("last_login"),
        })
    return board


@router.get("/attendance")
async def attendance(day: Optional[str] = Query(None, alias="date"), admin: Dict[str, Any] = Depends(get_current_admin)):
    d = day or _today()
    try:
        date.fromisoformat(d)
    except ValueError:
        raise HTTPException(status_code=422, detail="Date must be YYYY-MM-DD.")
    return {"date": d, "board": await _attendance(d, admin)}


# ---------------------------------------------------------------------------
# Progress
# ---------------------------------------------------------------------------
async def _progress(date_from: str, date_to: str, viewer: Dict[str, Any]) -> List[Dict[str, Any]]:
    leads = await get_collection("sales_leads").find({}).to_list(20000)
    calls = [c for c in await get_collection("sales_calls").find({}).to_list(100000)
             if date_from <= str(c.get("local_date", "")) <= date_to]
    today = _today()
    sessions = {s.get("user_id"): s for s in await get_collection("sales_day_sessions").find({"date": today}).to_list(5000)}
    rows = []
    everyone, me = sees_all_attendance(viewer), _me(viewer)["user_id"]
    for u in await _sales_team():
        uid = str(u["_id"])
        own_day = everyone or uid == me  # other people's day status is attendance: not shared
        mine = [l for l in leads if (l.get("assigned_to") or {}).get("user_id") == uid]
        my_calls = [c for c in calls if c.get("user_id") == uid]
        converted = sum(1 for c in my_calls if c.get("outcome") == "CONVERTED")
        rows.append({
            "user_id": uid, "name": u.get("username") or u.get("email", ""), "email": u.get("email", ""),
            "leads_assigned": len(mine),
            "leads_open": sum(1 for l in mine if l.get("status") in OPEN_STATUSES),
            "calls": len(my_calls),
            "connected": sum(1 for c in my_calls if c.get("outcome") not in ("NO_ANSWER", "BUSY", "WRONG_NUMBER")),
            "interested": sum(1 for c in my_calls if c.get("outcome") == "INTERESTED"),
            "converted": converted,
            "converted_total": sum(1 for l in mine if l.get("status") == "CONVERTED"),
            "follow_ups_due": sum(1 for l in mine if l.get("status") in OPEN_STATUSES and l.get("follow_up_date") and l["follow_up_date"] <= today),
            "day_status": None if not own_day else "NOT_STARTED" if uid not in sessions else ("WORKING" if not sessions[uid].get("ended_at") else "DAY_ENDED"),
            "hours_today": _hours(sessions[uid]) if own_day and uid in sessions else 0.0,
        })
    return sorted(rows, key=lambda r: (-r["converted"], -r["calls"], r["name"].lower()))


@router.get("/progress")
async def progress(date_from: Optional[str] = Query(None, alias="from"), date_to: Optional[str] = Query(None, alias="to"),
                   admin: Dict[str, Any] = Depends(get_current_admin)):
    today = _today()
    f, t = date_from or today, date_to or today
    try:
        date.fromisoformat(f), date.fromisoformat(t)
    except ValueError:
        raise HTTPException(status_code=422, detail="Dates must be YYYY-MM-DD.")
    if t < f:
        raise HTTPException(status_code=422, detail="The end date is before the start date.")
    return {"from": f, "to": t, "rows": await _progress(f, t, admin)}


# ---------------------------------------------------------------------------
# Leads
# ---------------------------------------------------------------------------
class LeadIn(BaseModel):
    name: str = Field(default="", max_length=120)
    company: str = Field(default="", max_length=200)
    phone: str = Field(default="", max_length=30)
    email: str = Field(default="", max_length=200)
    city: str = Field(default="", max_length=80)
    source: str = Field(default="", max_length=80)
    service_interest: str = Field(default="", max_length=200)
    notes: str = Field(default="", max_length=2000)
    status: Optional[str] = None
    follow_up_date: Optional[str] = None
    assigned_user_id: Optional[str] = None


def _clean_lead(req: LeadIn) -> Dict[str, Any]:
    data = {k: (getattr(req, k) or "").strip() for k in ("name", "company", "phone", "email", "city", "source", "service_interest", "notes")}
    if not (data["name"] or data["company"] or data["phone"]):
        raise HTTPException(status_code=422, detail="Enter at least a name, company or phone number.")
    if req.status is not None:
        if req.status not in LEAD_STATUSES:
            raise HTTPException(status_code=422, detail=f"Status must be one of {', '.join(LEAD_STATUSES)}.")
        data["status"] = req.status
    if req.follow_up_date:
        try:
            data["follow_up_date"] = date.fromisoformat(req.follow_up_date[:10]).isoformat()
        except ValueError:
            raise HTTPException(status_code=422, detail="Follow-up date must be YYYY-MM-DD.")
    elif req.follow_up_date == "":
        data["follow_up_date"] = None
    return data


@router.get("/assignees")
async def assignees():
    users = [u for u in await get_collection("admins").find({}).to_list(2000) if u.get("is_active", True)]
    out = [{"id": str(u["_id"]), "name": u.get("username") or u.get("email", ""), "email": u.get("email", ""),
            "role": normalize_role(u.get("role")), "role_label": ROLE_LABELS.get(normalize_role(u.get("role")), u.get("role", ""))} for u in users]
    return {"users": sorted(out, key=lambda u: (u["role"] != "sales", u["name"].lower()))}


@router.get("/leads")
async def list_leads(search: Optional[str] = None, status_filter: Optional[str] = Query(None, alias="status"), assigned: Optional[str] = None):
    items = await get_collection("sales_leads").find({}).sort("created_at", -1).to_list(20000)
    if status_filter in LEAD_STATUSES:
        items = [l for l in items if l.get("status") == status_filter]
    if assigned == "unassigned":
        items = [l for l in items if not l.get("assigned_to")]
    elif assigned:
        items = [l for l in items if (l.get("assigned_to") or {}).get("user_id") == assigned]
    if search and search.strip():
        s = search.strip().lower()
        items = [l for l in items if any(s in str(l.get(k, "")).lower() for k in ("name", "company", "phone", "email", "city", "service_interest"))]
    return {"items": [_id(l) for l in items], "total": len(items), "statuses": LEAD_STATUSES}


@router.post("/leads", status_code=status.HTTP_201_CREATED)
async def create_lead(req: LeadIn, admin: Dict[str, Any] = Depends(get_current_admin)):
    data = _clean_lead(req)
    can_m = await _can_manage(admin)
    assigned = None
    if can_m and req.assigned_user_id:
        assigned = await _user(req.assigned_user_id)
    elif not can_m:
        # Reps and employees create leads assigned to themselves
        assigned = _me(admin)
    elif req.assigned_user_id:
        assigned = await _user(req.assigned_user_id)

    doc = {**data, "status": data.get("status", "NEW"), "follow_up_date": data.get("follow_up_date"),
           "assigned_to": assigned,
           "created_by": admin.get("email", ""), "created_at": _now(), "updated_at": _now(), "call_count": 0}
    res = await get_collection("sales_leads").insert_one(dict(doc))
    return {**doc, "id": str(res.inserted_id)}


@router.put("/leads/{lead_id}")
async def update_lead(lead_id: str, req: LeadIn):
    col = get_collection("sales_leads")
    lead = await col.find_one({"_id": lead_id})
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found.")
    data = _clean_lead(req)
    data["assigned_to"] = await _user(req.assigned_user_id) if req.assigned_user_id else None
    data["updated_at"] = _now()
    await col.update_one({"_id": lead_id}, {"$set": data})
    return _id(await col.find_one({"_id": lead_id}))


@router.delete("/leads/{lead_id}")
async def delete_lead(lead_id: str):
    res = await get_collection("sales_leads").delete_one({"_id": lead_id})
    if not res.deleted_count:
        raise HTTPException(status_code=404, detail="Lead not found.")
    return {"success": True}


@router.post("/leads/import")
async def import_leads(rows: List[Dict[str, Any]], admin: Dict[str, Any] = Depends(get_current_admin)):
    """Bulk-add leads from a spreadsheet; an 'assigned to' email assigns the lead to that user."""
    if len(rows) > 5000:
        raise HTTPException(status_code=422, detail="Import at most 5000 leads at a time.")
    users = {str(u.get("email", "")).lower(): u for u in await get_collection("admins").find({}).to_list(2000) if u.get("is_active", True)}
    col = get_collection("sales_leads")
    known_phones = {re.sub(r"\D", "", str(l.get("phone", "")))[-10:] for l in await col.find({}).to_list(20000)} - {""}
    imported, skipped, errors = 0, 0, []
    for i, r in enumerate(rows, 1):
        g = lambda *keys: next((str(r[k]).strip() for k in keys if r.get(k) not in (None, "")), "")
        lead = {"name": g("name", "full_name", "lead_name", "contact_name"), "company": g("company", "company_name", "current_company"),
                "phone": g("phone", "mobile", "mobile_number", "contact_number", "number"), "email": g("email"),
                "city": g("city", "location"), "source": g("source"), "service_interest": g("service_interest", "service", "services"),
                "notes": g("notes", "note", "remarks")}
        if not (lead["name"] or lead["company"] or lead["phone"]):
            errors.append({"row": i, "error": "Needs at least a name, company or phone."})
            continue
        digits = re.sub(r"\D", "", lead["phone"])[-10:]
        if digits and digits in known_phones:
            skipped += 1
            continue
        owner = users.get(g("assigned_to", "assigned_to_email", "assigned_email", "assignee").lower())
        await col.insert_one({**lead, "status": "NEW", "follow_up_date": None, "call_count": 0,
                              "assigned_to": {"user_id": str(owner["_id"]), "name": owner.get("username") or owner.get("email", ""),
                                              "email": owner.get("email", "")} if owner else None,
                              "created_by": admin.get("email", ""), "created_at": _now(), "updated_at": _now()})
        if digits:
            known_phones.add(digits)
        imported += 1
    return {"imported": imported, "skipped": skipped, "failed": len(errors), "errors": errors[:50],
            "message": f"Imported {imported} lead(s); {skipped} phone number(s) already existed; {len(errors)} failed."}


class CallIn(BaseModel):
    outcome: Outcome
    note: str = Field(default="", max_length=2000)
    follow_up_date: Optional[str] = None


@router.post("/leads/{lead_id}/calls", status_code=status.HTTP_201_CREATED)
async def log_call(lead_id: str, req: CallIn, admin: Dict[str, Any] = Depends(get_current_admin)):
    """The dialer's CRM entry: one call and its outcome. Only the lead's owner (or a manager) can log it."""
    col = get_collection("sales_leads")
    lead = await col.find_one({"_id": lead_id})
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found.")
    me = _me(admin)
    if (lead.get("assigned_to") or {}).get("user_id") != me["user_id"] and not await _can_manage(admin):
        raise HTTPException(status_code=403, detail="This lead is assigned to someone else.")
    follow_up = None
    if req.follow_up_date:
        try:
            follow_up = date.fromisoformat(req.follow_up_date[:10]).isoformat()
        except ValueError:
            raise HTTPException(status_code=422, detail="Follow-up date must be YYYY-MM-DD.")
    now_local = datetime.now(_tz())
    call = {"lead_id": lead_id, **me, "outcome": req.outcome, "note": req.note.strip(), "follow_up_date": follow_up,
            "at": _now(), "local_date": now_local.date().isoformat()}
    await get_collection("sales_calls").insert_one(dict(call))
    changes = {"status": OUTCOME_STATUS[req.outcome], "last_call_at": call["at"], "last_outcome": req.outcome,
               "last_note": call["note"], "call_count": int(lead.get("call_count") or 0) + 1, "updated_at": _now(),
               "follow_up_date": follow_up if req.outcome in ("CALL_BACK", "INTERESTED") else None}
    await col.update_one({"_id": lead_id}, {"$set": changes})
    return {"call": call, "lead": _id({**lead, **changes})}


@router.get("/leads/{lead_id}/calls")
async def lead_calls(lead_id: str, admin: Dict[str, Any] = Depends(get_current_admin)):
    lead = await get_collection("sales_leads").find_one({"_id": lead_id})
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found.")
    if (lead.get("assigned_to") or {}).get("user_id") != _me(admin)["user_id"] and not await _can_manage(admin):
        raise HTTPException(status_code=403, detail="This lead is assigned to someone else.")
    calls = await get_collection("sales_calls").find({"lead_id": lead_id}).sort("at", -1).to_list(500)
    return {"items": [{k: v for k, v in c.items() if k != "_id"} for c in calls]}


# ---------------------------------------------------------------------------
# Schemes
# ---------------------------------------------------------------------------
class SchemeIn(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    description: str = Field(default="", max_length=5000)
    valid_from: Optional[str] = None
    valid_to: Optional[str] = None
    active: bool = True


def _clean_scheme(req: SchemeIn) -> Dict[str, Any]:
    out: Dict[str, Any] = {"title": req.title.strip(), "description": req.description.strip(), "active": req.active}
    for key in ("valid_from", "valid_to"):
        value = getattr(req, key)
        try:
            out[key] = date.fromisoformat(value[:10]).isoformat() if value else None
        except ValueError:
            raise HTTPException(status_code=422, detail="Dates must be YYYY-MM-DD.")
    if out["valid_from"] and out["valid_to"] and out["valid_to"] < out["valid_from"]:
        raise HTTPException(status_code=422, detail="'Valid to' is before 'valid from'.")
    return out


@router.get("/schemes")
async def list_schemes():
    return {"items": [_id(s) for s in await get_collection("sales_schemes").find({}).sort("created_at", -1).to_list(500)]}


@router.post("/schemes", status_code=status.HTTP_201_CREATED)
async def create_scheme(req: SchemeIn, admin: Dict[str, Any] = Depends(get_current_admin)):
    doc = {**_clean_scheme(req), "created_by": admin.get("email", ""), "created_at": _now(), "updated_at": _now()}
    res = await get_collection("sales_schemes").insert_one(dict(doc))
    return {**doc, "id": str(res.inserted_id)}


@router.put("/schemes/{scheme_id}")
async def update_scheme(scheme_id: str, req: SchemeIn):
    col = get_collection("sales_schemes")
    if not await col.find_one({"_id": scheme_id}):
        raise HTTPException(status_code=404, detail="Scheme not found.")
    await col.update_one({"_id": scheme_id}, {"$set": {**_clean_scheme(req), "updated_at": _now()}})
    return _id(await col.find_one({"_id": scheme_id}))


@router.delete("/schemes/{scheme_id}")
async def delete_scheme(scheme_id: str):
    if not (await get_collection("sales_schemes").delete_one({"_id": scheme_id})).deleted_count:
        raise HTTPException(status_code=404, detail="Scheme not found.")
    return {"success": True}


# ---------------------------------------------------------------------------
# Company material: posts, flyers, PDFs, sales information
# ---------------------------------------------------------------------------
def _material_view(m: Dict[str, Any]) -> Dict[str, Any]:
    out = _id(m)
    out.pop("file_id", None)
    out["has_file"] = bool(m.get("file_id"))
    return out


@router.get("/materials")
async def list_materials():
    return {"items": [_material_view(m) for m in await get_collection("sales_materials").find({}).sort("created_at", -1).to_list(500)],
            "kinds": MATERIAL_KINDS}


async def _store_file(upload: UploadFile) -> Dict[str, Any]:
    name = os.path.basename(upload.filename or "file")
    ext = os.path.splitext(name)[1].lower()
    if ext not in ALLOWED_EXT:
        raise HTTPException(status_code=422, detail=f"{name} is not an allowed file type (PDF, image, video, Word, Excel or PowerPoint).")
    data = await upload.read(MAX_FILE_BYTES + 1)
    if len(data) > MAX_FILE_BYTES:
        raise HTTPException(status_code=422, detail=f"{name} is larger than {MAX_FILE_BYTES // (1024 * 1024)} MB.")
    file_id = uuid.uuid4().hex
    await get_collection("sales_material_files").insert_one({"_id": file_id, "filename": name, "content_type": upload.content_type or "application/octet-stream",
                                                             "size": len(data), "data_b64": base64.b64encode(data).decode("ascii")})
    return {"file_id": file_id, "filename": name, "size": len(data), "content_type": upload.content_type or ""}


def _material_fields(form) -> Dict[str, Any]:
    title = str(form.get("title") or "").strip()
    kind = str(form.get("kind") or "OTHER").strip().upper()
    if not title:
        raise HTTPException(status_code=422, detail="Give the material a title.")
    if kind not in MATERIAL_KINDS:
        raise HTTPException(status_code=422, detail=f"Type must be one of {', '.join(MATERIAL_KINDS)}.")
    link = str(form.get("link") or "").strip()
    if link and not re.match(r"^https?://", link):
        raise HTTPException(status_code=422, detail="Links must start with http:// or https://.")
    return {"title": title[:200], "kind": kind, "description": str(form.get("description") or "").strip()[:10000], "link": link[:1000],
            "active": str(form.get("active") or "true").lower() not in ("false", "0", "no")}


@router.post("/materials", status_code=status.HTTP_201_CREATED)
async def create_material(request: Request, admin: Dict[str, Any] = Depends(get_current_admin)):
    form = await request.form()
    fields = _material_fields(form)
    upload = form.get("file")
    file_meta = await _store_file(upload) if isinstance(upload, UploadFile) and upload.filename else {}
    if not (file_meta or fields["description"] or fields["link"]):
        raise HTTPException(status_code=422, detail="Attach a file, add a link or write the information.")
    doc = {**fields, **file_meta, "created_by": admin.get("email", ""), "created_at": _now(), "updated_at": _now()}
    res = await get_collection("sales_materials").insert_one(dict(doc))
    return _material_view({**doc, "_id": res.inserted_id})


@router.put("/materials/{material_id}")
async def update_material(material_id: str, request: Request):
    col = get_collection("sales_materials")
    existing = await col.find_one({"_id": material_id})
    if not existing:
        raise HTTPException(status_code=404, detail="Material not found.")
    form = await request.form()
    fields = _material_fields(form)
    upload = form.get("file")
    if isinstance(upload, UploadFile) and upload.filename:
        fields.update(await _store_file(upload))
        if existing.get("file_id"):
            await get_collection("sales_material_files").delete_one({"_id": existing["file_id"]})
    fields["updated_at"] = _now()
    await col.update_one({"_id": material_id}, {"$set": fields})
    return _material_view(await col.find_one({"_id": material_id}))


@router.delete("/materials/{material_id}")
async def delete_material(material_id: str):
    col = get_collection("sales_materials")
    existing = await col.find_one({"_id": material_id})
    if not existing:
        raise HTTPException(status_code=404, detail="Material not found.")
    if existing.get("file_id"):
        await get_collection("sales_material_files").delete_one({"_id": existing["file_id"]})
    await col.delete_one({"_id": material_id})
    return {"success": True}


@router.get("/materials/{material_id}/file")
async def download_material(material_id: str):
    m = await get_collection("sales_materials").find_one({"_id": material_id})
    f = await get_collection("sales_material_files").find_one({"_id": (m or {}).get("file_id") or "-"})
    if not m or not f:
        raise HTTPException(status_code=404, detail="File not found.")
    safe = re.sub(r'[^A-Za-z0-9._ -]', "_", f.get("filename") or "file")
    return Response(content=base64.b64decode(f["data_b64"]), media_type=f.get("content_type") or "application/octet-stream",
                    headers={"Content-Disposition": f'attachment; filename="{safe}"'})
