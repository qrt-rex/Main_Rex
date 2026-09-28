"""
Client document forms: staff collect a client's KYC / company documents from their dashboard,
and the Legal team reviews them on the Legal dashboard.

Files are stored in the database (one row per file, base64), not on disk: hosts like Render
wipe the disk on every deploy. Listings never load file contents.
"""
import base64
import os
import re
import uuid
from datetime import datetime
from typing import Any, Dict, List, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from pydantic import BaseModel, Field
from starlette.datastructures import UploadFile

from app.database import get_collection
from app.routers.legal import assigned_to_me, full_legal_access, require_full_legal
from app.services.auth_service import get_current_user
from app.utils.validators import search_pattern, validate_email, validate_mobile

router = APIRouter(prefix="/api/client-documents", tags=["Client Documents"])

DOCUMENTS = [
    ("coi", "Certificate of Incorporation (COI)"),
    ("gst_certificate", "GST certificate"),
    ("msme_certificate", "MSME / Udyam certificate"),
    ("aadhaar_card", "Aadhaar card"),
    ("pan_card", "PAN card"),
    ("company_pan_card", "Company PAN card"),
    ("bank_statement", "Bank statement"),
    ("itr", "ITR"),
    ("pitch_deck", "Pitch deck / financial report"),
]
OTHER_FIELD, OTHER_LABEL = "other_documents", "Other document"
LABELS = dict(DOCUMENTS) | {OTHER_FIELD: OTHER_LABEL}
ALLOWED_EXT = {".pdf", ".jpg", ".jpeg", ".png", ".webp", ".doc", ".docx", ".xls", ".xlsx", ".csv", ".ppt", ".pptx"}
MAX_FILE_BYTES = 10 * 1024 * 1024
MAX_TOTAL_BYTES = 40 * 1024 * 1024
MAX_OTHER_FILES = 10
STATUSES = ["PENDING", "UNDER REVIEW", "APPROVED", "HOLD", "REJECTED"]



def _bad(detail: str):
    raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=detail)


def _text(form, key: str, label: str, required: bool = False, max_len: int = 200) -> str:
    value = str(form.get(key) or "").strip()
    if required and not value:
        _bad(f"{label} is required.")
    if len(value) > max_len:
        _bad(f"{label} is too long (max {max_len} characters).")
    return value


def _optional_id(form, key: str, label: str, clean=lambda v: v.upper()) -> str:
    """Every field is optional and kept as entered (tidied); the form only warns about odd formats."""
    value = clean(re.sub(r"\s", "", str(form.get(key) or "")))
    if len(value) > 40:
        _bad(f"{label} is too long (max 40 characters).")
    return value


def _mask_aadhaar(v: str) -> str:
    return f"XXXX XXXX {v[-4:]}" if v else ""


async def _read_file(upload: UploadFile, field: str) -> Dict[str, Any]:
    name = os.path.basename(upload.filename or "document")
    ext = os.path.splitext(name)[1].lower()
    if ext not in ALLOWED_EXT:
        _bad(f"{LABELS[field]}: {name} is not an allowed file type (PDF, image, Word, Excel or PowerPoint).")
    data = await upload.read(MAX_FILE_BYTES + 1)
    if len(data) > MAX_FILE_BYTES:
        _bad(f"{LABELS[field]}: {name} is larger than {MAX_FILE_BYTES // (1024 * 1024)} MB.")
    if not data:
        _bad(f"{LABELS[field]}: {name} is empty.")
    return {"field": field, "label": LABELS[field], "filename": name,
            "content_type": upload.content_type or "application/octet-stream", "size": len(data), "data": data}


async def _next_reference() -> str:
    col = get_collection("client_documents")
    n = await col.count_documents({}) + 1
    while await col.find_one({"reference": f"DOC-{n:04d}"}):
        n += 1
    return f"DOC-{n:04d}"


def _summary(doc: Dict[str, Any]) -> Dict[str, Any]:
    out = {k: v for k, v in doc.items() if k != "_id"}
    out["id"] = str(doc["_id"])
    out["aadhaar_number"] = _mask_aadhaar(doc.get("aadhaar_number", ""))
    out["file_count"] = len(doc.get("files") or [])
    out.pop("files", None)
    return out


@router.post("", status_code=status.HTTP_201_CREATED)
async def submit_documents(request: Request, user: Dict[str, Any] = Depends(get_current_user)):
    form = await request.form()
    # Every field is optional. Recognisable values are normalised (e.g. +91 numbers); anything else is kept as typed.
    email = _text(form, "email", "Email").lower()
    ok, clean_email = validate_email(email)
    phone = _text(form, "phone", "Number", max_len=30)
    ok_phone, clean_phone = validate_mobile(phone) if phone else (False, "")
    record: Dict[str, Any] = {
        "name": _text(form, "name", "Name", max_len=120),
        "email": clean_email if ok else email,
        "phone": clean_phone if ok_phone else phone,
        "company_name": _text(form, "company_name", "Company name"),
        "gst_number": _optional_id(form, "gst_number", "GST number"),
        "msme_number": _optional_id(form, "msme_number", "MSME / Udyam number"),
        "aadhaar_number": _optional_id(form, "aadhaar_number", "Aadhaar number", clean=lambda v: v.replace("-", "")),
        "pan_number": _optional_id(form, "pan_number", "PAN"),
        "company_pan_number": _optional_id(form, "company_pan_number", "Company PAN"),
        "note": _text(form, "note", "Note", max_len=2000),
    }

    uploads: List[Dict[str, Any]] = []
    for field, _label in DOCUMENTS:
        item = form.get(field)
        if isinstance(item, UploadFile) and item.filename:
            uploads.append(await _read_file(item, field))
    others = [f for f in form.getlist(OTHER_FIELD) if isinstance(f, UploadFile) and f.filename]
    if len(others) > MAX_OTHER_FILES:
        _bad(f"Attach at most {MAX_OTHER_FILES} other documents.")
    for item in others:
        uploads.append(await _read_file(item, OTHER_FIELD))
    if sum(u["size"] for u in uploads) > MAX_TOTAL_BYTES:
        _bad(f"The documents together are larger than {MAX_TOTAL_BYTES // (1024 * 1024)} MB.")
    if not uploads and not any(record.values()):
        _bad("The form is empty. Fill in at least one field or attach a document.")

    submission_id = uuid.uuid4().hex
    files_col = get_collection("client_document_files")
    files_meta = []
    for u in uploads:
        file_id = uuid.uuid4().hex
        await files_col.insert_one({"_id": file_id, "submission_id": submission_id, "field": u["field"], "filename": u["filename"],
                                    "content_type": u["content_type"], "size": u["size"],
                                    "data_b64": base64.b64encode(u["data"]).decode("ascii")})
        files_meta.append({"file_id": file_id, **{k: u[k] for k in ("field", "label", "filename", "content_type", "size")}})

    now = datetime.utcnow().isoformat()
    doc = {"_id": submission_id, "reference": await _next_reference(), **record, "files": files_meta,
           "status": "PENDING", "legal_note": "",
           "submitted_by_email": user.get("email", ""), "submitted_by_name": user.get("username") or user.get("email", ""),
           "created_at": now, "updated_at": now}
    await get_collection("client_documents").insert_one(dict(doc))
    return {"success": True, "message": f"Form {doc['reference']} submitted to the Legal team.", "submission": _summary(doc)}


@router.get("/mine")
async def my_submissions(user: Dict[str, Any] = Depends(get_current_user)):
    docs = await get_collection("client_documents").find({"submitted_by_email": user.get("email", "")}).sort("created_at", -1).to_list(50)
    return {"items": [_summary(d) for d in docs]}


@router.get("")
async def list_submissions(
    search: Optional[str] = Query(None),
    status_filter: Optional[str] = Query(None, alias="status"),
    skip: int = Query(0, ge=0),
    limit: int = Query(25, ge=1, le=100),
    user: Dict[str, Any] = Depends(get_current_user),
):
    query: Dict[str, Any] = {}
    # Outside the Legal team, only the forms assigned to you.
    if not await full_legal_access(user):
        query["assigned_to.user_id"] = str(user.get("_id") or user.get("id") or "")
    if status_filter and status_filter in STATUSES:
        query["status"] = status_filter
    if search and search.strip():
        p = search_pattern(search)
        query["$or"] = [{f: {"$regex": p, "$options": "i"}} for f in ("reference", "company_name", "name", "email", "phone", "submitted_by_email")]
    col = get_collection("client_documents")
    total = await col.count_documents(query)
    docs = await col.find(query).sort("created_at", -1).skip(skip).limit(limit).to_list(limit)
    return {"items": [_summary(d) for d in docs], "total": total, "statuses": STATUSES}


async def _get(submission_id: str, user: Dict[str, Any]) -> Dict[str, Any]:
    doc = await get_collection("client_documents").find_one({"_id": submission_id})
    # Someone else's form reads as "not found" outside the Legal team.
    if not doc or not (await full_legal_access(user) or assigned_to_me(doc, user)):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document form not found.")
    return doc


@router.get("/{submission_id}")
async def get_submission(submission_id: str, user: Dict[str, Any] = Depends(get_current_user)):
    doc = await _get(submission_id, user)
    return {**{k: v for k, v in doc.items() if k != "_id"}, "id": str(doc["_id"])}


@router.get("/{submission_id}/files/{file_id}")
async def download_file(submission_id: str, file_id: str, user: Dict[str, Any] = Depends(get_current_user)):
    await _get(submission_id, user)
    f = await get_collection("client_document_files").find_one({"_id": file_id, "submission_id": submission_id})
    if not f:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="File not found.")
    safe = re.sub(r'[^A-Za-z0-9._ -]', "_", f.get("filename") or "document")
    return Response(content=base64.b64decode(f["data_b64"]), media_type=f.get("content_type") or "application/octet-stream",
                    headers={"Content-Disposition": f'attachment; filename="{safe}"'})


class StatusUpdate(BaseModel):
    status: Literal["PENDING", "UNDER REVIEW", "APPROVED", "HOLD", "REJECTED"]
    legal_note: Optional[str] = Field(default=None, max_length=2000)


@router.patch("/{submission_id}/status")
async def update_status(submission_id: str, req: StatusUpdate, user: Dict[str, Any] = Depends(get_current_user)):
    await require_full_legal(user)
    doc = await _get(submission_id, user)
    changes = {"status": req.status, "reviewed_by": user.get("email", ""), "reviewed_at": datetime.utcnow().isoformat(),
               "updated_at": datetime.utcnow().isoformat()}
    if req.legal_note is not None:
        changes["legal_note"] = req.legal_note.strip()
    await get_collection("client_documents").update_one({"_id": doc["_id"]}, {"$set": changes})
    return {"success": True, **changes}
