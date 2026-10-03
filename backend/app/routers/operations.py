"""
Operation dashboard: every client case moves through the operation stages, and the documents the
Legal team provided or approved for it are listed on the case.

Cases are the Legal module's clients (legal records and client document forms). This module only
adds where each case stands, in `operation_cases` (one row per client, keyed "<kind>:<id>", with
its stage history). Documents are read from where Legal already keeps them; nothing is copied:
  * a legal record's verification report, once Legal has made it available;
  * the files of a client document form, once Legal has approved the form;
  * files uploaded to the client's work by someone on the Legal team.
"""
import base64
import re
from datetime import datetime
from typing import Any, Dict, List, Optional, Set

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, Field

from app.database import get_collection
from app.routers.legal import CLIENT_KINDS, _all_clients, _client_doc, _client_view, _matches, record_report_html
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
]
STAGE_LABELS = {s["key"]: s["label"] for s in STAGES}
FIRST_STAGE = STAGES[0]["key"]


def _now() -> str:
    return datetime.utcnow().isoformat()


def _case_key(kind: str, item_id: str) -> str:
    return f"{kind}:{item_id}"


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


def _case(client: Dict[str, Any], row: Optional[Dict[str, Any]], documents: List[Dict[str, Any]],
          pending_review: int) -> Dict[str, Any]:
    stage = (row or {}).get("stage")
    if stage not in STAGE_LABELS:
        stage = FIRST_STAGE
    return {"key": _case_key(client["kind"], client["id"]), "kind": client["kind"], "id": client["id"], "reference": client["reference"],
            "company_name": client["company_name"], "contact_name": client["contact_name"], "contact_email": client["contact_email"],
            "contact_phone": client["contact_phone"], "bdm": client["bdm"], "services": client["services"],
            "legal_status": client["status"], "assigned_to": client.get("assigned_to"), "created_at": client["created_at"],
            "stage": stage, "stage_label": STAGE_LABELS[stage],
            "stage_since": (row or {}).get("stage_since") or client["created_at"], "stage_by": (row or {}).get("stage_by", ""),
            "documents": documents, "pending_review": pending_review}


def _pending_review(kind: str, raw: Dict[str, Any]) -> int:
    """Documents the client has handed over that Legal hasn't approved yet (shown as a count, not listed)."""
    if kind == "document" and raw.get("status") != "APPROVED":
        return len(raw.get("files") or [])
    return 0


async def _raw_clients() -> Dict[str, Dict[str, Any]]:
    out: Dict[str, Dict[str, Any]] = {}
    for kind, col in CLIENT_KINDS.items():
        for d in await get_collection(col).find({}).to_list(5000):
            out[_case_key(kind, str(d["_id"]))] = d
    return out


async def _build_case(kind: str, item_id: str) -> Dict[str, Any]:
    raw = await _client_doc(kind, item_id)
    key = _case_key(kind, item_id)
    row = await get_collection("operation_cases").find_one({"_id": key})
    files = (await _work_files_by_client()).get(key, [])
    case = _case(_client_view(kind, raw), row, _documents(kind, raw, files, await _legal_user_ids()), _pending_review(kind, raw))
    case["history"] = list(reversed((row or {}).get("history") or []))
    return case


@router.get("/board")
async def board(
    search: Optional[str] = Query(None),
    legal_status: Optional[str] = Query(None),
    with_documents: bool = Query(False, description="only cases that have a document from Legal"),
    admin: Dict[str, Any] = Depends(get_current_admin),
):
    clients = await _all_clients()
    raws = await _raw_clients()
    rows = {r["_id"]: r for r in await get_collection("operation_cases").find({}).to_list(100000)}
    files = await _work_files_by_client()
    legal_ids = await _legal_user_ids()

    cases = []
    for c in clients:
        key = _case_key(c["kind"], c["id"])
        raw = raws.get(key) or {}
        cases.append(_case(c, rows.get(key), _documents(c["kind"], {"_id": c["id"], **raw}, files.get(key, []), legal_ids),
                           _pending_review(c["kind"], raw)))

    if search and search.strip():
        clients_by_key = {_case_key(c["kind"], c["id"]): c for c in clients}
        cases = [x for x in cases if _matches(clients_by_key[x["key"]], search.strip())]
    if legal_status:
        cases = [x for x in cases if x["legal_status"] == legal_status]
    if with_documents:
        cases = [x for x in cases if x["documents"]]

    counts = {s["key"]: 0 for s in STAGES}
    for x in cases:
        counts[x["stage"]] += 1
    return {
        "stages": [{**s, "count": counts[s["key"]]} for s in STAGES],
        "cases": cases,
        "total": len(cases),
        "documents_total": sum(len(x["documents"]) for x in cases),
        "can_manage": "operations.dashboard.manage" in await get_user_permissions(admin),
    }


@router.get("/cases/{kind}/{item_id}")
async def get_case(kind: str, item_id: str, admin: Dict[str, Any] = Depends(get_current_admin)):
    return await _build_case(kind, item_id)


class StageMove(BaseModel):
    stage: str
    note: str = Field(default="", max_length=1000)


@router.put("/cases/{kind}/{item_id}/stage")
async def move_case(kind: str, item_id: str, req: StageMove, admin: Dict[str, Any] = Depends(get_current_admin)):
    if req.stage not in STAGE_LABELS:
        raise HTTPException(status_code=422, detail=f"Stage must be one of: {', '.join(s['label'] for s in STAGES)}.")
    await _client_doc(kind, item_id)  # 404 for an unknown client
    key = _case_key(kind, item_id)
    col = get_collection("operation_cases")
    row = await col.find_one({"_id": key})
    old = (row or {}).get("stage") or FIRST_STAGE
    if old == req.stage:
        return await _build_case(kind, item_id)
    at, by = _now(), admin.get("username") or admin.get("email", "")
    entry = {"from": old, "from_label": STAGE_LABELS.get(old, old), "to": req.stage, "to_label": STAGE_LABELS[req.stage],
             "by": by, "by_email": admin.get("email", ""), "at": at, "note": req.note.strip()}
    changes = {"stage": req.stage, "stage_since": at, "stage_by": by, "updated_at": at,
               "history": [*((row or {}).get("history") or []), entry]}
    if row:
        await col.update_one({"_id": key}, {"$set": changes})
    else:
        await col.insert_one({"_id": key, "kind": kind, "client_id": item_id, "created_at": at, **changes})
    return await _build_case(kind, item_id)


@router.get("/cases/{kind}/{item_id}/documents/{doc_id}")
async def download_document(kind: str, item_id: str, doc_id: str, admin: Dict[str, Any] = Depends(get_current_admin)):
    case = await _build_case(kind, item_id)
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
