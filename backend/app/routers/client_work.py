"""
Client work API. Every route is mounted behind the central RBAC guard (rbac_service.ROUTE_RULES), which
checks authentication and the route's permission; the service then checks the record itself
(assignee / monitor / admin), so a permission alone never exposes someone else's work.

Mutations answer {"success": true, "message": ..., "work": {...}} so the UI can apply the result at once.
Send an `Idempotency-Key` header on a mutation to make a retried request harmless.
"""
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, Header, Query, Request
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel, Field
from starlette.datastructures import UploadFile

from app.routers.legal import require_full_legal
from app.services import client_work_service as svc
from app.services.auth_service import get_current_admin
from app.services.client_work_live import hub

router = APIRouter(prefix="/api/client-work", tags=["Client Work"])


async def access(admin: Dict[str, Any] = Depends(get_current_admin)) -> svc.Access:
    return await svc.access_for(admin)


async def _view(work: Dict[str, Any]) -> Dict[str, Any]:
    return await svc.work_view(work)


async def _ok(message: str, work: Dict[str, Any], **extra) -> Dict[str, Any]:
    return {"success": True, "message": message, "work": await _view(work), **extra}


# ------------------------------------------------------------------ real time
@router.get("/stream")
async def stream(request: Request, acc: svc.Access = Depends(access)):
    """Server-Sent Events: one `work` event whenever work this user may see changes. Refetch on each."""
    sub = hub.subscribe(acc.uid, acc.monitor)
    return StreamingResponse(hub.stream(sub, request.is_disconnected), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no", "Connection": "keep-alive"})


# ------------------------------------------------------------------ dashboards
@router.get("/summary")
async def summary(mine: bool = Query(False), acc: svc.Access = Depends(access)):
    """The three counters of the Client Work Management widget (plus the numbers under them)."""
    stats = await svc.dashboard_stats(acc, mine=mine)
    return {"scope": stats["scope"], "counters": stats["counters"], "generated_at": stats["generated_at"]}


@router.get("/stats")
async def stats(mine: bool = Query(False), acc: svc.Access = Depends(access)):
    return await svc.dashboard_stats(acc, mine=mine)


FILTER_KEYS = ("bucket", "status", "priority", "work_type", "assignee", "legal", "client_id", "deadline_from", "deadline_to",
               "created_from", "created_to", "search", "due")


def filters_from(q: Dict[str, Any]) -> Dict[str, Any]:
    f = {k: (str(q[k]).strip() if q.get(k) else None) for k in FILTER_KEYS}
    f["overdue"] = bool(q.get("overdue"))
    f["waiting_for_client"] = bool(q.get("waiting_for_client"))
    return {k: v for k, v in f.items() if v}


async def _list(acc: svc.Access, mine: bool, p: Dict[str, Any]) -> Dict[str, Any]:
    return await svc.list_work(acc, filters_from(p), mine=mine, sort=p["sort"], order=p["order"], skip=p["skip"], limit=p["limit"])


def _params(bucket, status_, priority, work_type, assignee, legal, client_id, deadline_from, deadline_to, created_from, created_to,
            search, due, overdue, waiting_for_client, sort, order, skip, limit):
    return {"bucket": bucket, "status": status_, "priority": priority, "work_type": work_type, "assignee": assignee, "legal": legal,
            "client_id": client_id, "deadline_from": deadline_from, "deadline_to": deadline_to, "created_from": created_from,
            "created_to": created_to, "search": search, "due": due, "overdue": overdue, "waiting_for_client": waiting_for_client,
            "sort": sort, "order": order, "skip": skip, "limit": limit}


def list_query(
    bucket: Optional[str] = Query(None, pattern="^(need_action|on_hold|completed)$"),
    status_: Optional[str] = Query(None, alias="status"),
    priority: Optional[str] = None, work_type: Optional[str] = None,
    assignee: Optional[str] = Query(None, description="assigned member's user id"),
    legal: Optional[str] = Query(None, description="assigning Legal user's id"),
    client_id: Optional[str] = None, deadline_from: Optional[str] = None, deadline_to: Optional[str] = None,
    created_from: Optional[str] = None, created_to: Optional[str] = None, search: Optional[str] = None,
    due: Optional[str] = Query(None, pattern="^(today|soon)$"), overdue: bool = False, waiting_for_client: bool = False,
    sort: str = Query("priority", pattern="^(priority|deadline|client|work_type|status|assigned|assigned_date|updated)$"),
    order: str = Query("asc", pattern="^(asc|desc)$"), skip: int = Query(0, ge=0), limit: int = Query(50, ge=1, le=200),
):
    return _params(bucket, status_, priority, work_type, assignee, legal, client_id, deadline_from, deadline_to, created_from,
                   created_to, search, due, overdue, waiting_for_client, sort, order, skip, limit)


@router.get("/work")
async def list_work(p: Dict[str, Any] = Depends(list_query), acc: svc.Access = Depends(access)):
    return await _list(acc, False, p)


@router.get("/work/mine")
async def my_work(p: Dict[str, Any] = Depends(list_query), acc: svc.Access = Depends(access)):
    """Get My Clients: only the work assigned to the caller, whatever else their role may see."""
    return await _list(acc, True, p)


@router.get("/waiting")
async def waiting(p: Dict[str, Any] = Depends(list_query), acc: svc.Access = Depends(access)):
    return await svc.waiting_for_client(acc, filters_from(p))


# ------------------------------------------------------------------ assign / create
class AssignBody(BaseModel):
    client_kind: str = Field(pattern="^(record|document)$")
    client_id: str
    user_id: str
    priority: str = "MEDIUM"
    work_type: str = ""
    deadline: Optional[str] = None
    required_action: str = ""
    notes: str = ""


@router.post("/assign", status_code=201)
async def assign(body: AssignBody, acc: svc.Access = Depends(access)):
    """Assign Client: creates the work (or moves open work to another member) and notifies the member."""
    await require_full_legal(acc.user)
    work, outcome = await svc.assign_client(body.client_kind, body.client_id, body.user_id, acc.actor, priority=body.priority,
                                            work_type=body.work_type, deadline=body.deadline, required_action=body.required_action, notes=body.notes)
    return await _ok({"created": "Client assigned.", "reassigned": "Client reassigned.", "unchanged": "Already assigned to this member."}[outcome], work, outcome=outcome)


@router.post("/work", status_code=201)
async def create_work(body: AssignBody, acc: svc.Access = Depends(access)):
    """Create Client Work: like assign, but refuses a client that already has open work."""
    await require_full_legal(acc.user)
    work, _ = await svc.assign_client(body.client_kind, body.client_id, body.user_id, acc.actor, priority=body.priority,
                                      work_type=body.work_type, deadline=body.deadline, required_action=body.required_action,
                                      notes=body.notes, strict=True)
    return await _ok("Client work created.", work)


class ReassignBody(BaseModel):
    user_id: str
    note: str = ""


@router.put("/work/{work_id}/assign")
async def reassign(work_id: str, body: ReassignBody, acc: svc.Access = Depends(access)):
    await require_full_legal(acc.user)
    return await _ok("Work reassigned.", await svc.reassign(work_id, body.user_id, acc, body.note))


# ------------------------------------------------------------------ one work
@router.get("/work/{work_id}")
async def get_work(work_id: str, acc: svc.Access = Depends(access)):
    return await svc.work_detail(work_id, acc)


class DetailsBody(BaseModel):
    priority: Optional[str] = None
    deadline: Optional[str] = None
    required_action: Optional[str] = None
    work_type: Optional[str] = None
    note: str = ""


@router.patch("/work/{work_id}")
async def update_work(work_id: str, body: DetailsBody, acc: svc.Access = Depends(access)):
    work = await svc.update_details(work_id, acc, priority=body.priority, deadline=body.deadline,
                                    required_action=body.required_action, work_type=body.work_type, note=body.note)
    return await _ok("Work updated.", work)


class StatusBody(BaseModel):
    status: str
    reason: str = ""


@router.patch("/work/{work_id}/status")
async def update_status(work_id: str, body: StatusBody, acc: svc.Access = Depends(access), idem: str = Header("", alias="Idempotency-Key")):
    """Update Work Status through the state machine. Putting work on hold needs /hold (it needs the hold details)."""
    return await _ok("Status updated.", await svc.change_status(work_id, body.status, acc, reason=body.reason, idem_key=idem))


@router.post("/work/{work_id}/start")
async def start(work_id: str, acc: svc.Access = Depends(access), idem: str = Header("", alias="Idempotency-Key")):
    return await _ok("Work started.", await svc.start_work(work_id, acc, idem))


class HoldBody(BaseModel):
    hold_type: str = "WAITING_FOR_CLIENT"
    reason: str
    required_from_client: str = ""
    pending_documents: List[str] = []
    expected_response_date: Optional[str] = None
    internal_note: str


@router.post("/work/{work_id}/hold")
async def hold(work_id: str, body: HoldBody, acc: svc.Access = Depends(access), idem: str = Header("", alias="Idempotency-Key")):
    work = await svc.put_on_hold(work_id, acc, hold_type=body.hold_type, reason=body.reason, required_from_client=body.required_from_client,
                                 pending_documents=body.pending_documents, expected_response_date=body.expected_response_date,
                                 internal_note=body.internal_note, idem_key=idem)
    return await _ok("Work put on hold.", work)


class NoteBody(BaseModel):
    note: str = ""


@router.post("/work/{work_id}/resume")
async def resume(work_id: str, body: NoteBody, acc: svc.Access = Depends(access), idem: str = Header("", alias="Idempotency-Key")):
    return await _ok("Work resumed.", await svc.resume_work(work_id, acc, body.note, idem))


@router.post("/work/{work_id}/complete")
async def complete(work_id: str, body: NoteBody, acc: svc.Access = Depends(access), idem: str = Header("", alias="Idempotency-Key")):
    return await _ok("Client work completed.", await svc.complete_work(work_id, acc, body.note, idem))


# ------------------------------------------------------------------ tasks
class TaskBody(BaseModel):
    name: str
    description: str = ""
    due_date: Optional[str] = None
    priority: str = "MEDIUM"
    required: bool = True


@router.get("/work/{work_id}/tasks")
async def tasks(work_id: str, acc: svc.Access = Depends(access)):
    return {"items": await svc.list_tasks(work_id, acc)}


@router.post("/work/{work_id}/tasks", status_code=201)
async def create_task(work_id: str, body: TaskBody, acc: svc.Access = Depends(access), idem: str = Header("", alias="Idempotency-Key")):
    r = await svc.create_task(work_id, acc, body.model_dump(), idem)
    return {"success": True, "message": "Task created." if not r["replayed"] else "Already created.", "task": r["task"], "work": await _view(r["work"])}


class TaskPatch(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    due_date: Optional[str] = None
    priority: Optional[str] = None
    status: Optional[str] = None
    completion_pct: Optional[int] = None
    comment: str = ""
    version: Optional[int] = None


@router.patch("/tasks/{task_id}")
async def update_task(task_id: str, body: TaskPatch, acc: svc.Access = Depends(access), idem: str = Header("", alias="Idempotency-Key")):
    r = await svc.update_task(task_id, acc, body.model_dump(exclude_unset=True), idem)
    return {"success": True, "message": "Task updated.", "task": r["task"], "work": await _view(r["work"])}


@router.post("/tasks/{task_id}/complete")
async def complete_task(task_id: str, body: NoteBody, acc: svc.Access = Depends(access), idem: str = Header("", alias="Idempotency-Key")):
    r = await svc.complete_task(task_id, acc, body.note, idem)
    return {"success": True, "message": "Task completed.", "task": r["task"], "work": await _view(r["work"])}


# ------------------------------------------------------------------ comments
class CommentBody(BaseModel):
    text: str
    kind: str = "COMMENT"
    task_id: Optional[str] = None
    critical: bool = False


@router.get("/work/{work_id}/comments")
async def comments(work_id: str, acc: svc.Access = Depends(access)):
    return {"items": await svc.list_comments(work_id, acc)}


@router.post("/work/{work_id}/comments", status_code=201)
async def add_comment(work_id: str, body: CommentBody, acc: svc.Access = Depends(access)):
    return {"success": True, "message": "Added.", "comment": await svc.add_comment(work_id, acc, text=body.text, kind=body.kind, task_id=body.task_id, critical=body.critical)}


@router.post("/comments/{comment_id}/resolve")
async def resolve(comment_id: str, acc: svc.Access = Depends(access)):
    return {"success": True, "message": "Issue resolved.", "comment": await svc.resolve_issue(comment_id, acc)}


# ------------------------------------------------------------------ client requests and documents
class RequestBody(BaseModel):
    kind: str = "DOCUMENT"
    label: str
    expected_date: Optional[str] = None
    note: str = ""
    mandatory: bool = True
    task_id: Optional[str] = None


@router.get("/work/{work_id}/documents")
async def documents(work_id: str, acc: svc.Access = Depends(access)):
    return await svc.list_documents(work_id, acc)


@router.post("/work/{work_id}/document-requests", status_code=201)
async def request_document(work_id: str, body: RequestBody, acc: svc.Access = Depends(access), idem: str = Header("", alias="Idempotency-Key")):
    """Request Client Document (kind=DOCUMENT) or Request Information (kind=INFORMATION)."""
    r = await svc.request_from_client(work_id, acc, kind=body.kind, label=body.label, expected_date=body.expected_date, note=body.note,
                                      mandatory=body.mandatory, task_id=body.task_id, idem_key=idem)
    return {"success": True, "message": "Requested from the client.", "request": r["request"], "work": await _view(r["work"])}


@router.post("/work/{work_id}/documents", status_code=201)
async def upload(work_id: str, request: Request, acc: svc.Access = Depends(access)):
    """Upload Document (multipart: file, optional label, request_id, task_id, note). With request_id it fulfils that client request."""
    form = await request.form()
    f = form.get("file")
    if not isinstance(f, UploadFile) or not f.filename:
        svc._bad("Choose a file to upload.")
    data = await f.read(svc.MAX_FILE_BYTES + 1)
    doc = await svc.upload_document(work_id, acc, filename=f.filename, content_type=f.content_type or "", data=data,
                                    label=str(form.get("label") or ""), request_id=str(form.get("request_id") or "") or None,
                                    task_id=str(form.get("task_id") or "") or None, note=str(form.get("note") or ""))
    return {"success": True, "message": "Document uploaded.", "document": doc, "work": await _view(await svc.get_work(work_id))}


class ResponseBody(BaseModel):
    note: str
    request_ids: List[str] = []
    resolve_all: bool = False


@router.post("/work/{work_id}/client-response")
async def client_response(work_id: str, body: ResponseBody, acc: svc.Access = Depends(access)):
    """Client Response Received: marks the requests it answers as received; a waiting hold with nothing left resumes by itself."""
    r = await svc.client_response(work_id, acc, note=body.note, request_ids=body.request_ids, resolve_all=body.resolve_all)
    return {"success": True, "message": "Client response recorded.", **r}


@router.get("/documents/{doc_id}/file")
async def download(doc_id: str, acc: svc.Access = Depends(access)):
    meta, data = await svc.file_for(doc_id, acc)
    safe = meta["filename"].replace('"', "")
    return Response(content=data, media_type=meta.get("content_type") or "application/octet-stream",
                    headers={"Content-Disposition": f'attachment; filename="{safe}"', "X-Content-Type-Options": "nosniff"})


# ------------------------------------------------------------------ timeline, history, notifications
@router.get("/work/{work_id}/timeline")
async def timeline(work_id: str, acc: svc.Access = Depends(access)):
    return {"items": await svc.timeline(work_id, acc)}


@router.get("/work/{work_id}/history")
async def history(work_id: str, acc: svc.Access = Depends(access)):
    return await svc.history(work_id, acc)


@router.get("/notifications")
async def notifications(acc: svc.Access = Depends(access)):
    return await svc.my_notifications(acc)


class ReadBody(BaseModel):
    ids: Optional[List[str]] = None


@router.post("/notifications/read")
async def read_notifications(body: ReadBody, acc: svc.Access = Depends(access)):
    return {"success": True, "marked": await svc.mark_notifications_read(acc, body.ids)}
