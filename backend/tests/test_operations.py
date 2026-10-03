"""Operation dashboard: cases from the Legal module, stages, assignment to Admins, Legal's documents, reminders, RBAC."""
import asyncio
import base64
from datetime import datetime, timedelta

import pytest

from app.services import operations_service
from tests.conftest import user

API = "/api/operations"


def add_record(store, ref="#9101", status="APPROVED", pdf=False):
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
    out = {"super": (None, auth)}
    for name, role in (("legal", "legal"), ("support", "support"), ("anita", "admin"), ("rahul", "admin"), ("sales", "sales"), ("hr", "hr")):
        out[name] = user(client, auth, store, f"{name}@rex.test", role)
    return out


def H(people, who):
    return people[who][1]


def uid(people, who):
    return people[who][0]["_id"]


def board(client, people, who, **params):
    r = client.get(f"{API}/board", params=params, headers=H(people, who))
    assert r.status_code == 200, r.text
    return r.json()


def case(b, key):
    return next(c for c in b["cases"] if c["key"] == key)


def assign(client, people, cid, to, by="support", kind="record"):
    r = client.put(f"{API}/cases/{kind}/{cid}/assign", json={"user_id": uid(people, to)}, headers=H(people, by))
    assert r.status_code == 200, r.text
    return r.json()


def test_board_starts_every_client_at_onboarding_unassigned(client, store, people):
    add_record(store)
    add_form(store)
    b = board(client, people, "anita")
    assert [s["label"] for s in b["stages"]] == ["Onboarding", "Creating Documentation", "Process start", "Documents Review",
                                                 "Approval", "Submission", "Meeting-1", "Selection"]
    assert b["view"] == "unassigned" and b["total"] == 2 and b["stages"][0]["count"] == 2
    assert b["awaiting_legal"] == 1 and b["can_manage"] is False
    assert b["views"] == {"unassigned": 2, "mine": 0, "by_me": 0}
    assert {c["stage"] for c in b["cases"]} == {"ONBOARDING"}
    assert board(client, people, "support")["views"]["all"] == 2


def test_onboarding_finishes_only_after_legal_approves(client, store, people):
    cid = add_record(store, status="UNDER REVIEW")
    url = f"{API}/cases/record/{cid}/stage"
    r = client.put(url, json={"stage": "CREATING_DOCUMENTATION"}, headers=H(people, "anita"))
    assert r.status_code == 409 and "Legal approves" in r.text
    store["legal_records"][cid]["status"] = "APPROVED"
    r = client.put(url, json={"stage": "CREATING_DOCUMENTATION"}, headers=H(people, "anita"))
    assert r.status_code == 200 and r.json()["stage"] == "CREATING_DOCUMENTATION"


def test_move_stage_records_history_and_updates_the_client(client, store, people):
    cid = add_record(store)
    url = f"{API}/cases/record/{cid}/stage"
    assert client.put(url, json={"stage": "CREATING_DOCUMENTATION", "note": "KYC received"}, headers=H(people, "support")).status_code == 200
    c = client.put(url, json={"stage": "SELECTION"}, headers=H(people, "legal")).json()
    assert c["stage"] == "SELECTION" and c["stage_label"] == "Selection" and c["stage_by"] == "legal"
    assert [(h["from"], h["to"]) for h in c["history"]] == [("CREATING_DOCUMENTATION", "SELECTION"), ("ONBOARDING", "CREATING_DOCUMENTATION")]
    assert c["history"][1]["note"] == "KYC received"
    # the client's own record carries the stage (Legal's client list shows it)
    assert store["legal_records"][cid]["operation_stage_label"] == "Selection"
    legal_view = client.get("/api/legal/clients", headers=H(people, "legal")).json()["items"][0]
    assert legal_view["operation_stage"] == "Selection"
    assert client.put(url, json={"stage": "MEETING_2"}, headers=H(people, "support")).status_code == 422
    assert client.put(f"{API}/cases/record/nope/stage", json={"stage": "APPROVAL"}, headers=H(people, "support")).status_code == 404


def test_assignment_lists_admins_and_hides_the_case_from_other_admins(client, store, people):
    cid = add_record(store)
    names = [p["name"] for p in client.get(f"{API}/assignees", headers=H(people, "anita")).json()["items"]]
    assert names == ["anita", "rahul"]  # every active Admin, nobody else

    c = assign(client, people, cid, "rahul", by="anita")
    assert c["assigned_to"]["name"] == "rahul" and c["assigned_by"]["name"] == "anita"
    rahul = board(client, people, "rahul", view="mine")
    assert [x["key"] for x in rahul["cases"]] == [f"record:{cid}"] and rahul["views"]["unassigned"] == 0
    assert [x["key"] for x in board(client, people, "anita", view="by_me")["cases"]] == [f"record:{cid}"]
    # another admin no longer sees it anywhere, nor can open it
    other = user(client, people["super"][1], store, "third@rex.test", "admin")[1]
    assert client.get(f"{API}/board", headers=other).json()["total"] == 0
    assert client.get(f"{API}/cases/record/{cid}", headers=other).status_code == 404
    # managers see everything
    assert board(client, people, "support", view="all")["total"] == 1

    # the assignee hears about it, in the app and in the bell
    feed = client.get("/api/notifications", headers=H(people, "rahul")).json()["items"]
    assert any("assigned to you" in i["title"] for i in feed)

    # only an Admin can be picked; a stranger can't reassign
    bad = client.put(f"{API}/cases/record/{cid}/assign", json={"user_id": uid(people, "sales")}, headers=H(people, "anita"))
    assert bad.status_code == 404
    assert client.put(f"{API}/cases/record/{cid}/assign", json={"user_id": None}, headers=other).status_code == 404
    assert client.put(f"{API}/cases/record/{cid}/assign", json={"user_id": None}, headers=H(people, "anita")).json()["assigned_to"] is None


def test_only_legal_documents_are_listed(client, store, people):
    add_record(store, "#9101", status="APPROVED", pdf=True)
    add_record(store, "#9102", status="PENDING", pdf=False)
    add_form(store, status="UNDER REVIEW")
    b = board(client, people, "support")
    assert [(d["id"], d["source"]) for d in case(b, "record:rec-9101")["documents"]] == [("report", "APPROVED")]
    assert case(b, "record:rec-9102")["documents"] == []
    form = case(b, "document:form-1")
    assert form["documents"] == [] and form["pending_review"] == 1

    store["client_documents"]["form-1"]["status"] = "APPROVED"
    form = case(board(client, people, "support"), "document:form-1")
    assert [(d["id"], d["label"], d["source"]) for d in form["documents"]] == [("form-f1", "PAN card", "APPROVED")]
    only = board(client, people, "support", with_documents=True)
    assert {c["key"] for c in only["cases"]} == {"record:rec-9101", "document:form-1"}


def test_files_legal_uploaded_to_client_work_count_as_provided(client, store, people):
    cid = add_record(store)
    store["client_work"] = {"w1": {"_id": "w1", "client_kind": "record", "client_id": cid, "status": "IN_PROGRESS"}}
    store["client_work_documents"] = {
        "d1": {"_id": "d1", "type": "FILE", "work_id": "w1", "label": "Draft MoA", "filename": "moa.docx", "file_id": "b1",
               "uploaded_by": "legal", "uploaded_by_id": uid(people, "legal"), "uploaded_at": "2026-09-26T10:00:00"},
        "d2": {"_id": "d2", "type": "FILE", "work_id": "w1", "label": "Client photo", "filename": "x.png", "file_id": "b2",
               "uploaded_by": "sales", "uploaded_by_id": uid(people, "sales"), "uploaded_at": "2026-09-26T11:00:00"},
    }
    store["client_work_files"] = {"b1": {"_id": "b1", "data_b64": base64.b64encode(b"MOA").decode()},
                                  "b2": {"_id": "b2", "data_b64": base64.b64encode(b"IMG").decode()}}
    docs = case(board(client, people, "support"), f"record:{cid}")["documents"]
    assert [(d["id"], d["source"], d["by"]) for d in docs] == [("work-d1", "PROVIDED", "legal")]
    r = client.get(f"{API}/cases/record/{cid}/documents/work-d1", headers=H(people, "support"))
    assert r.status_code == 200 and r.content == b"MOA" and "moa.docx" in r.headers["content-disposition"]
    assert client.get(f"{API}/cases/record/{cid}/documents/work-d2", headers=H(people, "support")).status_code == 404


def test_download_report_and_approved_form_file(client, store, people):
    cid = add_record(store, status="APPROVED", pdf=True)
    add_form(store, status="APPROVED")
    r = client.get(f"{API}/cases/record/{cid}/documents/report", headers=H(people, "anita"))
    assert r.status_code == 200 and "Company #9101" in r.text
    r = client.get(f"{API}/cases/document/form-1/documents/form-f1", headers=H(people, "anita"))
    assert r.status_code == 200 and r.content == b"PAN"


def test_call_and_email_reminders(client, store, people):
    cid = add_record(store)
    assign(client, people, cid, "rahul", by="anita")
    soon = (datetime.utcnow() + timedelta(hours=2)).isoformat() + "Z"
    past = (datetime.utcnow() - timedelta(minutes=1)).isoformat() + "Z"
    url = f"{API}/cases/record/{cid}/reminders"
    later = client.post(url, json={"type": "EMAIL", "due_at": soon, "note": "Send the draft"}, headers=H(people, "anita"))
    assert later.status_code == 200, later.text
    assert later.json()["owner"]["name"] == "rahul"  # defaults to the assignee
    due = client.post(url, json={"type": "CALL", "due_at": past, "note": "Ask about GST login"}, headers=H(people, "rahul")).json()
    assert client.post(url, json={"type": "CALL", "due_at": "next week"}, headers=H(people, "rahul")).status_code == 422

    mine = client.get(f"{API}/reminders", headers=H(people, "rahul")).json()["items"]
    assert [r["type"] for r in mine] == ["CALL", "EMAIL"]
    assert case(board(client, people, "rahul", view="mine"), f"record:{cid}")["next_reminder"]["type"] == "CALL"

    sent = asyncio.run(operations_service.send_due_reminders())
    assert sent == 1 and asyncio.run(operations_service.send_due_reminders()) == 0  # once only
    feed = client.get("/api/notifications", headers=H(people, "rahul")).json()["items"]
    assert any(i["title"] == f"Call reminder: Company #9101" for i in feed)

    assert client.post(f"{API}/reminders/{due['id']}/done", headers=H(people, "sales")).status_code == 403
    assert client.post(f"{API}/reminders/{due['id']}/done", headers=H(people, "rahul")).status_code == 200
    assert [r["type"] for r in client.get(f"{API}/reminders", headers=H(people, "rahul")).json()["items"]] == ["EMAIL"]
    assert client.delete(f"{API}/reminders/{later.json()['id']}", headers=H(people, "anita")).status_code == 200


def test_access_follows_roles(client, store, people):
    cid = add_record(store)
    for role in ("sales", "hr"):
        assert client.get(f"{API}/board", headers=H(people, role)).status_code == 403
        assert client.put(f"{API}/cases/record/{cid}/stage", json={"stage": "APPROVAL"}, headers=H(people, role)).status_code == 403
    for who in ("legal", "support", "anita", "super"):
        assert client.get(f"{API}/board", headers=H(people, who)).status_code == 200
    # Admins can't ask for every case; they get the unassigned view instead
    assert board(client, people, "anita", view="all")["view"] == "unassigned"


def test_search(client, store, people):
    add_record(store, "#9101")
    add_record(store, "#9102")
    assert [c["reference"] for c in board(client, people, "support", search="9102")["cases"]] == ["#9102"]
