"""Operation dashboard: cases from the Legal module, stage moves, documents Legal provided or approved, RBAC."""
import base64

import pytest

from tests.conftest import user

API = "/api/operations"


def add_record(store, ref="#9101", status="PENDING", pdf=False):
    cid = f"rec-{ref.strip('#')}"
    store.setdefault("legal_records", {})[cid] = {
        "_id": cid, "id": cid, "crm_id": ref, "company_name": f"Company {ref}", "bdm_name": "Surat", "services": ["GST Registration"],
        "amount_paid": 5000.0, "status": status, "pdf_available": pdf, "created_at": "2026-09-20T10:00:00"}
    return cid


def add_form(store, status="PENDING"):
    sid = "form-1"
    store.setdefault("client_documents", {})[sid] = {
        "_id": sid, "id": sid, "reference": "DOC-0001", "company_name": "Form Client Pvt Ltd", "name": "Asha", "email": "asha@client.test",
        "phone": "", "status": status, "reviewed_by": "legal1@rex.test", "reviewed_at": "2026-09-25T09:00:00",
        "files": [{"file_id": "f1", "field": "pan_card", "label": "PAN card", "filename": "pan.pdf", "content_type": "application/pdf", "size": 3}],
        "created_at": "2026-09-21T10:00:00"}
    store.setdefault("client_document_files", {})["f1"] = {
        "_id": "f1", "submission_id": sid, "filename": "pan.pdf", "content_type": "application/pdf", "data_b64": base64.b64encode(b"PAN").decode()}
    return sid


@pytest.fixture
def people(client, auth, store):
    return {role: user(client, auth, store, f"{role}1@rex.test", role)[1] for role in ("legal", "support", "admin", "sales", "hr")}


def case(board, key):
    return next(c for c in board["cases"] if c["key"] == key)


def test_board_lists_every_client_in_the_first_stage(client, store, people):
    add_record(store)
    add_form(store)
    r = client.get(f"{API}/board", headers=people["support"])
    assert r.status_code == 200, r.text
    b = r.json()
    assert [s["label"] for s in b["stages"]] == ["Onboarding", "Creating Documentation", "Process start", "Documents Review",
                                                 "Approval", "Submission", "Meeting-1"]
    assert b["total"] == 2 and b["stages"][0]["count"] == 2 and b["can_manage"] is True
    assert {c["stage"] for c in b["cases"]} == {"ONBOARDING"}


def test_only_legal_documents_are_listed(client, store, people):
    add_record(store, "#9101", status="APPROVED", pdf=True)
    add_record(store, "#9102", status="PENDING", pdf=False)
    add_form(store, status="UNDER REVIEW")
    b = client.get(f"{API}/board", headers=people["support"]).json()
    report = case(b, "record:rec-9101")["documents"]
    assert [(d["id"], d["source"]) for d in report] == [("report", "APPROVED")]
    assert case(b, "record:rec-9102")["documents"] == []
    form = case(b, "document:form-1")
    assert form["documents"] == [] and form["pending_review"] == 1  # not approved by Legal yet

    store["client_documents"]["form-1"]["status"] = "APPROVED"
    form = case(client.get(f"{API}/board", headers=people["support"]).json(), "document:form-1")
    assert [(d["id"], d["label"], d["source"]) for d in form["documents"]] == [("form-f1", "PAN card", "APPROVED")]
    assert form["pending_review"] == 0

    only = client.get(f"{API}/board", params={"with_documents": True}, headers=people["support"]).json()
    assert {c["key"] for c in only["cases"]} == {"record:rec-9101", "document:form-1"}


def test_files_legal_uploaded_to_client_work_count_as_provided(client, store, people):
    cid = add_record(store)
    legal_id = next(u["_id"] for u in store["admins"].values() if u["role"] == "legal")
    sales_id = next(u["_id"] for u in store["admins"].values() if u["role"] == "sales")
    store["client_work"] = {"w1": {"_id": "w1", "client_kind": "record", "client_id": cid, "status": "IN_PROGRESS"}}
    store["client_work_documents"] = {
        "d1": {"_id": "d1", "type": "FILE", "work_id": "w1", "label": "Draft MoA", "filename": "moa.docx", "file_id": "b1",
               "uploaded_by": "legal1", "uploaded_by_id": legal_id, "uploaded_at": "2026-09-26T10:00:00"},
        "d2": {"_id": "d2", "type": "FILE", "work_id": "w1", "label": "Client photo", "filename": "x.png", "file_id": "b2",
               "uploaded_by": "sales1", "uploaded_by_id": sales_id, "uploaded_at": "2026-09-26T11:00:00"},
    }
    store["client_work_files"] = {"b1": {"_id": "b1", "data_b64": base64.b64encode(b"MOA").decode()},
                                  "b2": {"_id": "b2", "data_b64": base64.b64encode(b"IMG").decode()}}
    docs = case(client.get(f"{API}/board", headers=people["support"]).json(), f"record:{cid}")["documents"]
    assert [(d["id"], d["source"], d["by"]) for d in docs] == [("work-d1", "PROVIDED", "legal1")]

    r = client.get(f"{API}/cases/record/{cid}/documents/work-d1", headers=people["support"])
    assert r.status_code == 200 and r.content == b"MOA" and "moa.docx" in r.headers["content-disposition"]
    # A file Legal didn't provide can't be fetched through the dashboard.
    assert client.get(f"{API}/cases/record/{cid}/documents/work-d2", headers=people["support"]).status_code == 404


def test_download_report_and_approved_form_file(client, store, people):
    cid = add_record(store, status="APPROVED", pdf=True)
    add_form(store, status="APPROVED")
    r = client.get(f"{API}/cases/record/{cid}/documents/report", headers=people["support"])
    assert r.status_code == 200 and "Company #9101" in r.text
    r = client.get(f"{API}/cases/document/form-1/documents/form-f1", headers=people["support"])
    assert r.status_code == 200 and r.content == b"PAN"


def test_move_stage_records_history(client, store, people):
    cid = add_record(store)
    url = f"{API}/cases/record/{cid}/stage"
    r = client.put(url, json={"stage": "CREATING_DOCUMENTATION", "note": "KYC received"}, headers=people["support"])
    assert r.status_code == 200, r.text
    r = client.put(url, json={"stage": "DOCUMENTS_REVIEW"}, headers=people["legal"])
    c = r.json()
    assert c["stage"] == "DOCUMENTS_REVIEW" and c["stage_label"] == "Documents Review" and c["stage_by"] == "legal1"
    assert [(h["from"], h["to"]) for h in c["history"]] == [("CREATING_DOCUMENTATION", "DOCUMENTS_REVIEW"), ("ONBOARDING", "CREATING_DOCUMENTATION")]
    assert c["history"][1]["note"] == "KYC received"

    b = client.get(f"{API}/board", headers=people["admin"]).json()
    assert case(b, f"record:{cid}")["stage"] == "DOCUMENTS_REVIEW"
    assert next(s for s in b["stages"] if s["key"] == "DOCUMENTS_REVIEW")["count"] == 1

    assert client.put(url, json={"stage": "MEETING_2"}, headers=people["support"]).status_code == 422
    assert client.put(f"{API}/cases/record/nope/stage", json={"stage": "APPROVAL"}, headers=people["support"]).status_code == 404


def test_access_follows_roles(client, store, people, auth):
    cid = add_record(store)
    for role in ("sales", "hr"):
        assert client.get(f"{API}/board", headers=people[role]).status_code == 403
        assert client.put(f"{API}/cases/record/{cid}/stage", json={"stage": "APPROVAL"}, headers=people[role]).status_code == 403
    for headers in (people["legal"], people["support"], people["admin"], auth):
        assert client.get(f"{API}/board", headers=headers).status_code == 200


def test_search_and_legal_status_filters(client, store, people):
    add_record(store, "#9101", status="APPROVED")
    add_record(store, "#9102", status="HOLD")
    b = client.get(f"{API}/board", params={"search": "9102"}, headers=people["support"]).json()
    assert [c["reference"] for c in b["cases"]] == ["#9102"]
    b = client.get(f"{API}/board", params={"legal_status": "APPROVED"}, headers=people["support"]).json()
    assert [c["reference"] for c in b["cases"]] == ["#9101"]
