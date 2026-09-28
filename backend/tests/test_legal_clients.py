"""Legal: assigning clients (legal records and document forms) to staff, and approvals."""
from tests.conftest import login


def make_user(client, auth, store, email, role="sales"):
    r = client.post("/api/users", headers=auth, json={"username": email.split("@")[0], "email": email, "role": role, "password": "Passw0rd!x"})
    assert r.status_code in (200, 201), r.text
    return r.json(), login(client, store, email, "Passw0rd!x")


def test_assign_and_approve_flow(client, auth, store, outbox):
    member, member_headers = make_user(client, auth, store, "assignee.one@rexera-test.com")
    doc = client.post("/api/client-documents", headers=auth, data={
        "name": "Amit Jain", "email": "amit@jainco.test", "phone": "9876501234", "company_name": "JainCo LLP"}).json()["submission"]

    staff = client.get("/api/legal/staff", headers=auth).json()["staff"]
    assert any(s["id"] == member["id"] and s["role_label"] == "Sales Person" for s in staff)

    clients = client.get("/api/legal/clients", headers=auth).json()["items"]
    record = next(c for c in clients if c["kind"] == "record" and c["status"] == "PENDING")
    assert any(c["kind"] == "document" and c["id"] == doc["id"] for c in clients)

    for kind, cid in (("record", record["id"]), ("document", doc["id"])):
        r = client.put(f"/api/legal/clients/{kind}/{cid}/assign", headers=auth, json={"user_id": member["id"]})
        assert r.status_code == 200, r.text
        assert r.json()["assigned_to"]["email"] == "assignee.one@rexera-test.com"
    assert any(m["to"] == "assignee.one@rexera-test.com" and "JainCo LLP" in m["subject"] for m in outbox)

    mine = client.get("/api/legal/assigned/mine", headers=member_headers).json()["items"]
    assert {(c["kind"], c["id"]) for c in mine} == {("record", record["id"]), ("document", doc["id"])}
    assert record["services"] == next(c for c in mine if c["kind"] == "record")["services"]

    only_member = client.get("/api/legal/clients", headers=auth, params={"assigned": member["id"]}).json()["items"]
    assert len(only_member) == 2

    r = client.patch(f"/api/legal/clients/document/{doc['id']}/status", headers=auth, json={"status": "APPROVED", "notes": "OK"})
    assert r.status_code == 200 and r.json()["status"] == "APPROVED"
    assert client.get(f"/api/client-documents/{doc['id']}", headers=auth).json()["legal_note"] == "OK"
    assert client.patch(f"/api/legal/clients/record/{record['id']}/status", headers=auth, json={"status": "Nope"}).status_code == 422
    approved = client.get("/api/legal/clients", headers=auth, params={"status": "APPROVED", "assigned": member["id"]}).json()["items"]
    assert [c["id"] for c in approved] == [doc["id"]]

    # Unassign
    client.put(f"/api/legal/clients/record/{record['id']}/assign", headers=auth, json={"user_id": None})
    assert len(client.get("/api/legal/assigned/mine", headers=member_headers).json()["items"]) == 1


def test_import_records_skips_existing(client, auth):
    rows = [{"crm_id": "9100", "company_name": "Import One Ltd", "bdm_name": "Surat", "services": "GST Registration, ISO Certification",
             "amount_paid": "12,500", "status": "approved", "pdf_available": "Yes", "created_at": "2026-08-15"},
            {"crm_id": "#9100", "company_name": "Duplicate", "amount_paid": 1},
            {"crm_id": "9101", "company_name": "Bad Amount", "amount_paid": "abc"},
            {"company_name": "No Id"}]
    r = client.post("/api/legal/records/import", headers=auth, json=rows)
    assert r.status_code == 200, r.text
    assert (r.json()["imported"], r.json()["skipped"], r.json()["failed"]) == (1, 1, 2)
    rec = next(c for c in client.get("/api/legal/clients", headers=auth, params={"search": "Import One"}).json()["items"])
    assert rec["reference"] == "#9100" and rec["services"] == ["GST Registration", "ISO Certification"]
    assert rec["amount"] == 12500 and rec["status"] == "APPROVED" and rec["pdf_available"] and rec["created_at"].startswith("2026-08-15")


def test_admin_sees_only_assigned_clients(client, auth, store):
    boss, boss_h = make_user(client, auth, store, "scoped.admin@rexera-test.com", role="admin")
    _, legal_h = make_user(client, auth, store, "legal.team@rexera-test.com", role="legal")
    doc_mine = client.post("/api/client-documents", headers=auth, data={"company_name": "Mine Co"}).json()["submission"]
    doc_other = client.post("/api/client-documents", headers=auth, data={"company_name": "Other Co"}).json()["submission"]
    everything = client.get("/api/legal/clients", headers=legal_h).json()["items"]
    rec_mine, rec_other = [c for c in everything if c["kind"] == "record"][:2]

    # The Legal team assigns (the admin can't).
    for kind, cid in (("record", rec_mine["id"]), ("document", doc_mine["id"])):
        assert client.put(f"/api/legal/clients/{kind}/{cid}/assign", headers=legal_h, json={"user_id": boss["id"]}).status_code == 200
    assert client.put(f"/api/legal/clients/record/{rec_other['id']}/assign", headers=boss_h, json={"user_id": boss["id"]}).status_code == 403

    # The admin sees only what is assigned to them, everywhere.
    assert {c["id"] for c in client.get("/api/legal/clients", headers=boss_h).json()["items"]} == {rec_mine["id"], doc_mine["id"]}
    assert [r["crm_id"] for r in client.get("/api/legal/records", headers=boss_h).json()["records"]] == [rec_mine["reference"]]
    assert [d["id"] for d in client.get("/api/client-documents", headers=boss_h).json()["items"]] == [doc_mine["id"]]
    assert client.get(f"/api/client-documents/{doc_mine['id']}", headers=boss_h).status_code == 200
    assert client.get(f"/api/client-documents/{doc_other['id']}", headers=boss_h).status_code == 404
    assert client.get(f"/api/legal/records/{rec_mine['reference'].lstrip('#')}/pdf", headers=boss_h).status_code == 200
    assert client.get(f"/api/legal/records/{rec_other['reference'].lstrip('#')}/pdf", headers=boss_h).status_code == 404

    # Read-only: no status changes, staff list or import for the admin.
    assert client.patch(f"/api/legal/clients/record/{rec_mine['id']}/status", headers=boss_h, json={"status": "APPROVED"}).status_code == 403
    assert client.patch(f"/api/client-documents/{doc_mine['id']}/status", headers=boss_h, json={"status": "APPROVED"}).status_code == 403
    assert client.get("/api/legal/staff", headers=boss_h).status_code == 403
    assert client.post("/api/legal/records/import", headers=boss_h, json=[]).status_code == 403
    # The Legal team still sees everything.
    assert len(client.get("/api/legal/clients", headers=legal_h).json()["items"]) == len(everything)


def test_permissions_and_errors(client, auth, store):
    _, headers = make_user(client, auth, store, "no.legal@rexera-test.com", role="employee")
    assert client.get("/api/legal/clients", headers=headers).status_code == 403
    assert client.get("/api/legal/staff", headers=headers).status_code == 403
    assert client.get("/api/legal/assigned/mine", headers=headers).status_code == 200
    assert client.put("/api/legal/clients/other/x/assign", headers=auth, json={"user_id": None}).status_code == 404
    record = next(c for c in client.get("/api/legal/clients", headers=auth).json()["items"] if c["kind"] == "record")
    assert client.put(f"/api/legal/clients/record/{record['id']}/assign", headers=auth, json={"user_id": "ghost"}).status_code == 404
