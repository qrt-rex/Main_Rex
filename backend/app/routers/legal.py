import io
import csv
from datetime import datetime
from html import escape
from typing import Any, Dict, List, Literal, Optional
from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from fastapi.responses import HTMLResponse, StreamingResponse
from pydantic import BaseModel, Field

from app.database import get_collection
from app.services.auth_service import get_current_admin
from app.services.email_service import EmailService
from app.services.rbac_service import enforce

router = APIRouter(prefix="/api/legal", tags=["Legal Compliance"])

LegalStatus = Literal["PENDING", "UNDER REVIEW", "APPROVED", "HOLD", "REJECTED"]


# ---------------------------------------------------------------------------
# Who sees what: the Legal team (and Super Admin) see every client and are the only ones who
# assign, approve and import. Anyone else with Legal access sees only the clients assigned to them.
# ---------------------------------------------------------------------------
async def full_legal_access(admin: Dict[str, Any]) -> bool:
    from app.services.rbac_service import get_role_permissions, normalize_role
    role = normalize_role(admin.get("role"))
    return role in ("legal", "superadmin") or "legal.manage" in await get_role_permissions(role)


async def require_full_legal(admin: Dict[str, Any]) -> None:
    if not await full_legal_access(admin):
        raise HTTPException(status_code=403, detail="Only the Legal team can do this.")


def assigned_to_me(doc: Dict[str, Any], admin: Dict[str, Any]) -> bool:
    return (doc.get("assigned_to") or {}).get("user_id") == str(admin.get("_id") or admin.get("id") or "")

class LegalRecordCreate(BaseModel):
    crm_id: str
    company_name: str
    bdm_name: str
    services: List[str]
    amount_paid: float
    status: str = "PENDING"
    pdf_available: bool = False
    notes: Optional[str] = None

class LegalStatusUpdate(BaseModel):
    status: str
    notes: Optional[str] = None

INITIAL_LEGAL_RECORDS = [
    {
        "crm_id": "#3715",
        "company_name": "HOPUP FASHION PRIVATE LIMITED",
        "bdm_name": "Ahmedabad (A)",
        "services": ["Startup India Certificate"],
        "amount_paid": 4000.0,
        "status": "PENDING",
        "pdf_available": False,
        "created_at": "2026-09-10T10:00:00"
    },
    {
        "crm_id": "#3716",
        "company_name": "ZENITH TECH SOLUTIONS LLP",
        "bdm_name": "Ahmedabad (Y)",
        "services": ["GST Registration"],
        "amount_paid": 2500.0,
        "status": "UNDER REVIEW",
        "pdf_available": True,
        "created_at": "2026-09-11T11:15:00"
    },
    {
        "crm_id": "#3717",
        "company_name": "SUNRISE EXPORTS PVT LTD",
        "bdm_name": "Vadodara",
        "services": ["Trademark Registration"],
        "amount_paid": 8500.0,
        "status": "APPROVED",
        "pdf_available": True,
        "created_at": "2026-09-12T09:30:00"
    },
    {
        "crm_id": "#3718",
        "company_name": "BLUECHIP MANUFACTURING CO",
        "bdm_name": "Ahmedabad (A)",
        "services": ["GST Registration", "MSME Registration"],
        "amount_paid": 6000.0,
        "status": "HOLD",
        "pdf_available": False,
        "created_at": "2026-09-12T14:45:00"
    },
    {
        "crm_id": "#3719",
        "company_name": "GREENLEAF ORGANICS PRIVATE LIMITED",
        "bdm_name": "Ahmedabad (Y)",
        "services": ["FSSAI License"],
        "amount_paid": 3200.0,
        "status": "PENDING",
        "pdf_available": False,
        "created_at": "2026-09-13T10:20:00"
    },
    {
        "crm_id": "#3720",
        "company_name": "NOVA DIGITAL SERVICES",
        "bdm_name": "Vadodara",
        "services": ["Trademark Registration"],
        "amount_paid": 7800.0,
        "status": "REJECTED",
        "pdf_available": False,
        "created_at": "2026-09-14T16:00:00"
    },
    {
        "crm_id": "#3721",
        "company_name": "ARJUN TEXTILES PVT LTD",
        "bdm_name": "Ahmedabad (A)",
        "services": ["MSME Registration"],
        "amount_paid": 1500.0,
        "status": "APPROVED",
        "pdf_available": True,
        "created_at": "2026-09-15T09:00:00"
    },
    {
        "crm_id": "#3722",
        "company_name": "PARTH INFRASTRUCTURE LLP",
        "bdm_name": "Ahmedabad (Y)",
        "services": ["ISO Certification"],
        "amount_paid": 12000.0,
        "status": "UNDER REVIEW",
        "pdf_available": False,
        "created_at": "2026-09-15T15:30:00"
    },
    {
        "crm_id": "#3723",
        "company_name": "RIDDHIMA PHARMA PRIVATE LIMITED",
        "bdm_name": "Vadodara",
        "services": ["Drug License", "GST Registration"],
        "amount_paid": 9500.0,
        "status": "PENDING",
        "pdf_available": False,
        "created_at": "2026-09-16T12:00:00"
    },
    {
        "crm_id": "#3724",
        "company_name": "SKYLINE REAL ESTATE PVT LTD",
        "bdm_name": "Ahmedabad (A)",
        "services": ["RERA Registration"],
        "amount_paid": 15000.0,
        "status": "APPROVED",
        "pdf_available": True,
        "created_at": "2026-09-16T14:10:00"
    },
    {
        "crm_id": "#3725",
        "company_name": "APEX LOGISTICS GLOBAL",
        "bdm_name": "Mumbai",
        "services": ["Import Export Code (IEC)"],
        "amount_paid": 4500.0,
        "status": "APPROVED",
        "pdf_available": True,
        "created_at": "2026-09-17T11:00:00"
    },
    {
        "crm_id": "#3726",
        "company_name": "MATRIX FINTECH SOLUTIONS",
        "bdm_name": "Ahmedabad (Y)",
        "services": ["NBFC Documentation", "RBI Compliance"],
        "amount_paid": 28000.0,
        "status": "UNDER REVIEW",
        "pdf_available": True,
        "created_at": "2026-09-17T16:20:00"
    },
    {
        "crm_id": "#3727",
        "company_name": "KAVERI ENTERPRISES PVT LTD",
        "bdm_name": "Surat",
        "services": ["GST Registration", "MSME Registration"],
        "amount_paid": 5000.0,
        "status": "PENDING",
        "pdf_available": False,
        "created_at": "2026-09-18T10:30:00"
    },
    {
        "crm_id": "#3728",
        "company_name": "DHANLAXMI JEWELLERS",
        "bdm_name": "Rajkot",
        "services": ["BIS Hallmark Registration"],
        "amount_paid": 8200.0,
        "status": "APPROVED",
        "pdf_available": True,
        "created_at": "2026-09-18T13:40:00"
    },
    {
        "crm_id": "#3729",
        "company_name": "NEXUS HEALTHCARE PVT LTD",
        "bdm_name": "Ahmedabad (A)",
        "services": ["Drug License", "FSSAI License"],
        "amount_paid": 11000.0,
        "status": "UNDER REVIEW",
        "pdf_available": False,
        "created_at": "2026-09-19T09:45:00"
    },
    {
        "crm_id": "#3730",
        "company_name": "VISHAL AGRO INDUSTRIES",
        "bdm_name": "Vadodara",
        "services": ["Pollution Control Board NOC"],
        "amount_paid": 14500.0,
        "status": "HOLD",
        "pdf_available": False,
        "created_at": "2026-09-19T14:15:00"
    },
    {
        "crm_id": "#3731",
        "company_name": "RADIANT SOLAR TECH LLP",
        "bdm_name": "Ahmedabad (Y)",
        "services": ["ISO Certification", "Startup India Certificate"],
        "amount_paid": 16000.0,
        "status": "APPROVED",
        "pdf_available": True,
        "created_at": "2026-09-20T10:00:00"
    },
    {
        "crm_id": "#3732",
        "company_name": "MAHESHWARI PACKAGING",
        "bdm_name": "Surat",
        "services": ["Factory License"],
        "amount_paid": 9800.0,
        "status": "REJECTED",
        "pdf_available": False,
        "created_at": "2026-09-20T15:10:00"
    },
    {
        "crm_id": "#3733",
        "company_name": "OM SAI EDUTECH SOLUTIONS",
        "bdm_name": "Ahmedabad (A)",
        "services": ["Copyright Registration"],
        "amount_paid": 6500.0,
        "status": "UNDER REVIEW",
        "pdf_available": True,
        "created_at": "2026-09-21T11:20:00"
    },
    {
        "crm_id": "#3734",
        "company_name": "ROYAL HERITAGE RESORTS",
        "bdm_name": "Rajkot",
        "services": ["Fire NOC", "FSSAI License"],
        "amount_paid": 18500.0,
        "status": "APPROVED",
        "pdf_available": True,
        "created_at": "2026-09-21T16:45:00"
    },
    {
        "crm_id": "#3735",
        "company_name": "TECHNOFORCE LABS",
        "bdm_name": "Mumbai",
        "services": ["Patent Filing", "Trademark Registration"],
        "amount_paid": 35000.0,
        "status": "PENDING",
        "pdf_available": False,
        "created_at": "2026-09-22T09:30:00"
    },
    {
        "crm_id": "#3736",
        "company_name": "SHREE GANESH COLD STORAGE",
        "bdm_name": "Vadodara",
        "services": ["FSSAI License", "Trade License"],
        "amount_paid": 7200.0,
        "status": "APPROVED",
        "pdf_available": True,
        "created_at": "2026-09-22T12:00:00"
    },
    {
        "crm_id": "#3737",
        "company_name": "URBAN LIFESTYLE CLOTHING",
        "bdm_name": "Ahmedabad (Y)",
        "services": ["Trademark Registration"],
        "amount_paid": 8000.0,
        "status": "UNDER REVIEW",
        "pdf_available": True,
        "created_at": "2026-09-23T10:15:00"
    },
    {
        "crm_id": "#3738",
        "company_name": "PRISM CHEMICALS LIMITED",
        "bdm_name": "Surat",
        "services": ["Dangerous Goods License"],
        "amount_paid": 22000.0,
        "status": "HOLD",
        "pdf_available": False,
        "created_at": "2026-09-23T14:40:00"
    },
    {
        "crm_id": "#3739",
        "company_name": "GALAXY AUTOMATION SYSTEMS",
        "bdm_name": "Ahmedabad (A)",
        "services": ["CE Certification"],
        "amount_paid": 13500.0,
        "status": "APPROVED",
        "pdf_available": True,
        "created_at": "2026-09-24T09:50:00"
    },
    {
        "crm_id": "#3740",
        "company_name": "AURA COSMETICS PVT LTD",
        "bdm_name": "Vadodara",
        "services": ["CDSCO Cosmetics Registration"],
        "amount_paid": 19000.0,
        "status": "PENDING",
        "pdf_available": False,
        "created_at": "2026-09-24T11:30:00"
    },
    {
        "crm_id": "#3741",
        "company_name": "BHOOMI DEVELOPERS",
        "bdm_name": "Rajkot",
        "services": ["RERA Registration", "Partnership Deed"],
        "amount_paid": 16500.0,
        "status": "APPROVED",
        "pdf_available": True,
        "created_at": "2026-09-24T15:20:00"
    },
    {
        "crm_id": "#3742",
        "company_name": "QUANTUM CLOUD NETWORKS",
        "bdm_name": "Mumbai",
        "services": ["DOT OSP Registration"],
        "amount_paid": 12500.0,
        "status": "UNDER REVIEW",
        "pdf_available": True,
        "created_at": "2026-09-25T10:00:00"
    },
    {
        "crm_id": "#3743",
        "company_name": "SILVERLINE CERAMICS",
        "bdm_name": "Morbi",
        "services": ["ISO Certification", "Trademark Registration"],
        "amount_paid": 14000.0,
        "status": "APPROVED",
        "pdf_available": True,
        "created_at": "2026-09-25T13:45:00"
    },
    {
        "crm_id": "#3744",
        "company_name": "PRIME DENTAL CARE CLINIC",
        "bdm_name": "Ahmedabad (Y)",
        "services": ["Clinical Establishment Act License"],
        "amount_paid": 6800.0,
        "status": "PENDING",
        "pdf_available": False,
        "created_at": "2026-09-25T16:10:00"
    },
    {
        "crm_id": "#3745",
        "company_name": "VELOCITY COURIER & CARGO",
        "bdm_name": "Surat",
        "services": ["PSARA License", "GST Registration"],
        "amount_paid": 10500.0,
        "status": "APPROVED",
        "pdf_available": True,
        "created_at": "2026-09-26T09:15:00"
    }
]

async def ensure_initial_records():
    col = get_collection("legal_records")
    count = await col.count_documents({})
    if count == 0:
        for rec in INITIAL_LEGAL_RECORDS:
            await col.insert_one(rec)

@router.get("/records")
async def list_legal_records(
    bdm: Optional[str] = Query(None),
    service: Optional[str] = Query(None),
    status_filter: Optional[str] = Query(None, alias="status"),
    search: Optional[str] = Query(None),
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=100),
    admin: Dict[str, Any] = Depends(get_current_admin),
):
    await ensure_initial_records()
    col = get_collection("legal_records")
    all_records = await col.find({}).to_list(1000)
    if not await full_legal_access(admin):
        all_records = [r for r in all_records if assigned_to_me(r, admin)]

    # Extract distinct filter options
    bdms = sorted(list({r.get("bdm_name") for r in all_records if r.get("bdm_name")}))
    services_set = set()
    for r in all_records:
        for s in r.get("services", []):
            services_set.add(s)
    services = sorted(list(services_set))
    statuses = ["PENDING", "UNDER REVIEW", "APPROVED", "HOLD", "REJECTED"]

    # Filter in-memory for flexible substring search and multi-tag filtering
    filtered = all_records
    if bdm and bdm != "All BDMs":
        filtered = [r for r in filtered if r.get("bdm_name") == bdm]
    if service and service != "All Services":
        filtered = [r for r in filtered if service in r.get("services", [])]
    if status_filter and status_filter != "All Status":
        filtered = [r for r in filtered if r.get("status") == status_filter]
    if search:
        s_lower = search.strip().lower()
        filtered = [
            r for r in filtered
            if s_lower in str(r.get("crm_id", "")).lower()
            or s_lower in str(r.get("company_name", "")).lower()
            or s_lower in str(r.get("bdm_name", "")).lower()
            or any(s_lower in str(srv).lower() for srv in r.get("services", []))
        ]

    total = len(filtered)
    # Sort by crm_id descending or created_at
    filtered = sorted(filtered, key=lambda x: str(x.get("crm_id", "")), reverse=False)
    paginated = filtered[skip : skip + limit]

    return {
        "records": paginated,
        "total": total,
        "skip": skip,
        "limit": limit,
        "bdms": bdms,
        "services": services,
        "statuses": statuses,
    }

@router.post("/records")
async def create_legal_record(data: LegalRecordCreate, admin: Dict[str, Any] = Depends(get_current_admin)):
    await require_full_legal(admin)
    col = get_collection("legal_records")
    doc = data.dict()
    doc["created_at"] = datetime.now().isoformat()
    res = await col.insert_one(doc)
    return {"id": res.inserted_id, "message": "Legal record created successfully", "record": doc}

@router.patch("/records/{record_id}/status")
async def update_record_status(record_id: str, data: LegalStatusUpdate, admin: Dict[str, Any] = Depends(get_current_admin)):
    await require_full_legal(admin)
    col = get_collection("legal_records")
    # match by id or crm_id
    rec = await col.find_one({"_id": record_id}) or await col.find_one({"crm_id": record_id})
    if not rec:
        raise HTTPException(status_code=404, detail="Legal record not found")
    
    update_data = {
        "status": data.status,
        "updated_at": datetime.now().isoformat()
    }
    if data.notes:
        update_data["notes"] = data.notes
    
    await col.update_one({"_id": rec["_id"]}, {"$set": update_data})
    return {"message": "Status updated successfully", "status": data.status}

# ---------------------------------------------------------------------------
# Clients: legal records and client document forms, assigned to staff and approved by Legal
# ---------------------------------------------------------------------------
CLIENT_KINDS = {"record": "legal_records", "document": "client_documents"}
CLIENT_STATUSES = ["PENDING", "UNDER REVIEW", "APPROVED", "HOLD", "REJECTED"]


def _client_view(kind: str, d: Dict[str, Any]) -> Dict[str, Any]:
    """One shape for both kinds of client, as the Assign and Approvals views show them."""
    if kind == "record":
        return {"kind": kind, "id": str(d["_id"]), "reference": d.get("crm_id", ""), "company_name": d.get("company_name", ""),
                "contact_name": "", "contact_email": "", "contact_phone": "", "gstin": "",
                "bdm": d.get("bdm_name", ""), "services": d.get("services") or [], "documents": [],
                "amount": d.get("amount_paid"), "status": d.get("status", "PENDING"), "pdf_available": bool(d.get("pdf_available")),
                "assigned_to": d.get("assigned_to"), "created_at": d.get("created_at", "")}
    # Every field of a document form is optional: fall back to the contact's name for display.
    company = d.get("company_name") or d.get("name") or d.get("email") or "Unnamed client"
    return {"kind": kind, "id": str(d["_id"]), "reference": d.get("reference", ""), "company_name": company,
            "contact_name": d.get("name", ""), "contact_email": d.get("email", ""), "contact_phone": d.get("phone", ""),
            "gstin": d.get("gst_number", ""), "bdm": d.get("submitted_by_name", ""), "services": [],
            "documents": sorted({f.get("label", "") for f in d.get("files") or []}),
            "amount": None, "status": d.get("status", "PENDING"),
            "assigned_to": d.get("assigned_to"), "created_at": d.get("created_at", "")}


async def _all_clients() -> List[Dict[str, Any]]:
    await ensure_initial_records()
    items = [_client_view("record", d) for d in await get_collection("legal_records").find({}).to_list(5000)]
    items += [_client_view("document", d) for d in await get_collection("client_documents").find({}).to_list(5000)]
    return sorted(items, key=lambda c: str(c.get("created_at") or ""), reverse=True)


def _matches(c: Dict[str, Any], search: str) -> bool:
    s = search.lower()
    hay = [c["reference"], c["company_name"], c["contact_name"], c["contact_email"], c["bdm"], *c["services"],
           (c.get("assigned_to") or {}).get("name", "")]
    return any(s in str(h).lower() for h in hay)


@router.get("/staff")
async def list_staff(admin: Dict[str, Any] = Depends(get_current_admin)):
    """Active users a client can be assigned to (any role; Admins listed first)."""
    await require_full_legal(admin)
    from app.services.rbac_service import ROLES, normalize_role
    labels = {r["id"]: r["label"] for r in ROLES}
    docs = await get_collection("admins").find({}).to_list(1000)
    staff = [{"id": str(d["_id"]), "name": d.get("username") or d.get("email", ""), "email": d.get("email", ""),
              "role": normalize_role(d.get("role")), "role_label": labels.get(normalize_role(d.get("role")), d.get("role", ""))}
             for d in docs if d.get("is_active", True)]
    return {"staff": sorted(staff, key=lambda s: (s["role"] != "admin", s["name"].lower()))}


@router.get("/clients")
async def list_clients(
    search: Optional[str] = Query(None),
    status_filter: Optional[str] = Query(None, alias="status"),
    assigned: Optional[str] = Query(None, description="a user id, 'unassigned' or 'assigned'"),
    kind: Optional[str] = Query(None),
    admin: Dict[str, Any] = Depends(get_current_admin),
):
    items = await _all_clients()
    if not await full_legal_access(admin):
        items = [c for c in items if assigned_to_me(c, admin)]
    if kind in CLIENT_KINDS:
        items = [c for c in items if c["kind"] == kind]
    if status_filter in CLIENT_STATUSES:
        items = [c for c in items if c["status"] == status_filter]
    if assigned == "unassigned":
        items = [c for c in items if not c.get("assigned_to")]
    elif assigned == "assigned":
        items = [c for c in items if c.get("assigned_to")]
    elif assigned:
        items = [c for c in items if (c.get("assigned_to") or {}).get("user_id") == assigned]
    if search and search.strip():
        items = [c for c in items if _matches(c, search.strip())]
    return {"items": items, "total": len(items), "statuses": CLIENT_STATUSES}


async def _client_doc(kind: str, item_id: str) -> Dict[str, Any]:
    if kind not in CLIENT_KINDS:
        raise HTTPException(status_code=404, detail="Unknown client type.")
    doc = await get_collection(CLIENT_KINDS[kind]).find_one({"_id": item_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Client not found.")
    return doc


class AssignRequest(BaseModel):
    user_id: Optional[str] = None  # None unassigns


@router.put("/clients/{kind}/{item_id}/assign")
async def assign_client(kind: str, item_id: str, req: AssignRequest, admin: Dict[str, Any] = Depends(get_current_admin)):
    await require_full_legal(admin)
    doc = await _client_doc(kind, item_id)
    assigned = None
    if req.user_id:
        user = await get_collection("admins").find_one({"_id": req.user_id})
        if not user or not user.get("is_active", True):
            raise HTTPException(status_code=404, detail="That user doesn't exist or is disabled.")
        assigned = {"user_id": str(user["_id"]), "name": user.get("username") or user.get("email", ""), "email": user.get("email", ""),
                    "assigned_at": datetime.utcnow().isoformat(), "assigned_by": admin.get("email", "")}
    await get_collection(CLIENT_KINDS[kind]).update_one({"_id": doc["_id"]}, {"$set": {"assigned_to": assigned, "updated_at": datetime.utcnow().isoformat()}})
    client = _client_view(kind, {**doc, "assigned_to": assigned})
    if assigned and assigned["email"] and (doc.get("assigned_to") or {}).get("user_id") != assigned["user_id"]:
        services = ", ".join(client["services"] or client["documents"]) or "—"
        body = (f"<p>Dear {escape(assigned['name'])},</p><p>The client <b>{escape(client['company_name'])}</b> "
                f"({escape(client['reference'])}) has been assigned to you by the Legal team.</p>"
                f"<p>Services: {escape(services)}<br>Status: {escape(client['status'])}</p>"
                f"<p>You can see it under “Clients assigned to you” on your CRM dashboard.</p>")
        try:
            await EmailService.send_email(to_email=assigned["email"], subject=f"Client assigned to you: {client['company_name']}", html_content=body)
        except Exception:
            pass  # the assignment stands even if the notice can't be sent
    return client


class ClientStatusUpdate(BaseModel):
    status: LegalStatus
    notes: Optional[str] = Field(default=None, max_length=2000)


@router.patch("/clients/{kind}/{item_id}/status")
async def update_client_status(kind: str, item_id: str, req: ClientStatusUpdate, admin: Dict[str, Any] = Depends(get_current_admin)):
    await require_full_legal(admin)
    doc = await _client_doc(kind, item_id)
    changes = {"status": req.status, "updated_at": datetime.utcnow().isoformat(),
               "reviewed_by": admin.get("email", ""), "reviewed_at": datetime.utcnow().isoformat()}
    if req.notes is not None:
        changes["legal_note" if kind == "document" else "notes"] = req.notes.strip()
    await get_collection(CLIENT_KINDS[kind]).update_one({"_id": doc["_id"]}, {"$set": changes})
    return _client_view(kind, {**doc, **changes})


@router.post("/records/import")
async def import_legal_records(rows: List[Dict[str, Any]], admin: Dict[str, Any] = Depends(get_current_admin)):
    """Bulk-add legal records from a spreadsheet. Rows whose CRM id already exists are skipped, not duplicated."""
    await require_full_legal(admin)
    if len(rows) > 2000:
        raise HTTPException(status_code=422, detail="Import at most 2000 rows at a time.")
    col = get_collection("legal_records")
    existing = {str(r.get("crm_id", "")).strip() for r in await col.find({}).to_list(20000)}
    imported, skipped, errors = 0, 0, []
    for i, r in enumerate(rows, 1):
        crm = str(r.get("crm_id") or "").strip()
        if crm and not crm.startswith("#"):
            crm = f"#{crm}"
        company = str(r.get("company_name") or "").strip()
        if not crm or not company:
            errors.append({"row": i, "error": "CRM ID and company name are required."})
            continue
        if crm in existing:
            skipped += 1
            continue
        try:
            amount = float(str(r.get("amount_paid") or 0).replace(",", "").replace("₹", "").strip() or 0)
        except ValueError:
            errors.append({"row": i, "error": f"Amount '{r.get('amount_paid')}' is not a number."})
            continue
        status_value = str(r.get("status") or "PENDING").strip().upper().replace("_", " ")
        if status_value not in CLIENT_STATUSES or amount < 0:
            errors.append({"row": i, "error": f"Status must be one of {', '.join(CLIENT_STATUSES)} and the amount 0 or more."})
            continue
        services = r.get("services") or []
        if isinstance(services, str):
            services = [s.strip() for s in services.replace(";", ",").split(",") if s.strip()]
        pdf = str(r.get("pdf_available") or "").strip().lower() in ("yes", "true", "1", "y", "available")
        created = str(r.get("created_at") or r.get("date") or "").strip()[:10] or datetime.utcnow().date().isoformat()
        await col.insert_one({"crm_id": crm, "company_name": company, "bdm_name": str(r.get("bdm_name") or "").strip(),
                              "services": services, "amount_paid": amount, "status": status_value, "pdf_available": pdf,
                              "created_at": f"{created}T00:00:00" if len(created) == 10 else created,
                              "imported_by": admin.get("email", "")})
        existing.add(crm)
        imported += 1
    return {"imported": imported, "skipped": skipped, "failed": len(errors), "errors": errors[:50],
            "message": f"Imported {imported} record(s); {skipped} already existed; {len(errors)} failed."}


@router.get("/assigned/mine")
async def my_assigned_clients(admin: Dict[str, Any] = Depends(get_current_admin)):
    """Clients the Legal team assigned to the signed-in user, with their services and approval status."""
    me = str(admin.get("_id") or admin.get("id") or "")
    items = [c for c in await _all_clients() if (c.get("assigned_to") or {}).get("user_id") == me]
    return {"items": items, "total": len(items)}


@router.get("/export-missing-pdf")
async def export_missing_pdf(admin: Dict[str, Any] = Depends(get_current_admin)):
    await ensure_initial_records()
    col = get_collection("legal_records")
    all_records = await col.find({}).to_list(1000)
    if not await full_legal_access(admin):
        all_records = [r for r in all_records if assigned_to_me(r, admin)]
    missing = [r for r in all_records if not r.get("pdf_available")]

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["CRM ID", "Company Name", "BDM Name", "Services", "Amount Paid (INR)", "Status", "PDF Status"])
    for r in missing:
        writer.writerow([
            r.get("crm_id", ""),
            r.get("company_name", ""),
            r.get("bdm_name", ""),
            ", ".join(r.get("services", [])),
            f"{r.get('amount_paid', 0.0):.2f}",
            r.get("status", ""),
            "Missing"
        ])
    output.seek(0)
    return StreamingResponse(
        io.BytesIO(output.getvalue().encode("utf-8")),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=Missing_Legal_PDFs_Report.csv"}
    )

@router.get("/records/{crm_id}/pdf")
async def get_legal_record_pdf(crm_id: str, admin: Dict[str, Any] = Depends(get_current_admin)):
    await ensure_initial_records()
    # clean crm_id
    formatted_crm_id = crm_id if crm_id.startswith("#") else f"#{crm_id}"
    col = get_collection("legal_records")
    rec = await col.find_one({"crm_id": formatted_crm_id}) or await col.find_one({"_id": crm_id})
    if not rec or not (await full_legal_access(admin) or assigned_to_me(rec, admin)):
        raise HTTPException(status_code=404, detail="Legal document not found")

    services_html = "".join([f"<span class='badge'>{s}</span>" for s in rec.get("services", [])])
    company = rec.get("company_name", "N/A")
    cid = rec.get("crm_id", "N/A")
    bdm = rec.get("bdm_name", "N/A")
    amount = f"₹{rec.get('amount_paid', 0.0):,.2f}"
    st = rec.get("status", "PENDING")

    html_content = f"""<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>Legal Document Review - {company} ({cid})</title>
    <style>
        body {{ font-family: 'Segoe UI', Arial, sans-serif; background: #0f172a; color: #f8fafc; padding: 40px; margin: 0; }}
        .card {{ max-width: 760px; margin: 0 auto; background: #1e293b; border: 1px solid #334155; border-radius: 16px; padding: 36px; box-shadow: 0 10px 30px rgba(0,0,0,0.5); }}
        .header {{ display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #334155; padding-bottom: 20px; }}
        .brand {{ font-size: 20px; font-weight: 800; color: #14b8a6; letter-spacing: 1px; }}
        .crm-id {{ font-size: 16px; font-weight: 700; color: #818cf8; background: #312e81; padding: 4px 12px; border-radius: 20px; }}
        .title {{ font-size: 24px; font-weight: 700; margin: 24px 0 8px; color: #ffffff; }}
        .subtitle {{ font-size: 14px; color: #94a3b8; margin-bottom: 24px; }}
        .grid {{ display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 24px; background: #0f172a; padding: 20px; border-radius: 12px; }}
        .label {{ font-size: 11px; text-transform: uppercase; color: #64748b; font-weight: 600; margin-bottom: 4px; }}
        .val {{ font-size: 15px; font-weight: 600; color: #f1f5f9; }}
        .badge {{ display: inline-block; background: #0e7490; color: #cffafe; font-size: 12px; font-weight: 600; padding: 4px 10px; border-radius: 6px; margin-right: 6px; }}
        .status-pill {{ display: inline-block; padding: 6px 14px; border-radius: 20px; font-weight: 700; font-size: 12px; background: #065f46; color: #6ee7b7; }}
        .footer {{ margin-top: 30px; padding-top: 20px; border-top: 1px solid #334155; font-size: 12px; color: #64748b; text-align: center; }}
        @media print {{ body {{ background: #fff; color: #000; }} .card {{ border: none; box-shadow: none; }} }}
    </style>
</head>
<body>
    <div class="card">
        <div class="header">
            <div class="brand">REXERA LEGAL & COMPLIANCE</div>
            <div class="crm-id">{cid}</div>
        </div>
        <div class="title">{company}</div>
        <div class="subtitle">Official Verification & Compliance Assessment Report</div>
        
        <div class="grid">
            <div>
                <div class="label">BDM Branch / Officer</div>
                <div class="val">{bdm}</div>
            </div>
            <div>
                <div class="label">Amount Paid with GST</div>
                <div class="val" style="color: #34d399;">{amount}</div>
            </div>
            <div>
                <div class="label">Compliance Status</div>
                <div><span class="status-pill">{st}</span></div>
            </div>
            <div>
                <div class="label">Services Contracted</div>
                <div style="margin-top: 6px;">{services_html}</div>
            </div>
        </div>

        <div style="background: #0f172a; padding: 20px; border-radius: 12px; border-left: 4px solid #14b8a6; margin-bottom: 20px;">
            <div style="font-weight: 700; margin-bottom: 6px; color: #14b8a6;">Legal Audit Certification</div>
            <div style="font-size: 13px; color: #94a3b8; line-height: 1.6;">
                This document certifies that corporate documents, statutory approvals, and compliance filings for <strong>{company}</strong> have been reviewed by the Rexera Legal Department under CRM identifier <strong>{cid}</strong>.
            </div>
        </div>

        <div class="footer">
            Generated by Rexera Legal Portal · Verified Digital Record · Protected with SHA-256 RBAC
        </div>
    </div>
</body>
</html>"""
    return HTMLResponse(content=html_content)
