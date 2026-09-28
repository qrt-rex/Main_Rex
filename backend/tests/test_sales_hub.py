"""Sales workspace: leads & dialer, schemes, material, progress and the day start/end board."""
from tests.conftest import login


def user(client, auth, store, email, role):
    r = client.post("/api/users", headers=auth, json={"username": email.split("@")[0], "email": email, "role": role, "password": "Passw0rd!x"})
    assert r.status_code in (200, 201), r.text
    return r.json(), login(client, store, email, "Passw0rd!x")


def test_sales_person_flow(client, auth, store):
    rep, rep_h = user(client, auth, store, "rep.one@rexera-test.com", "sales")
    other, other_h = user(client, auth, store, "rep.two@rexera-test.com", "sales")
    _, legal_h = user(client, auth, store, "legal.boss@rexera-test.com", "legal")

    # Legal adds a lead for rep one, a scheme and a flyer.
    lead = client.post("/api/sales-hub/leads", headers=legal_h, json={"name": "Kiran Patel", "company": "Patel Foods", "phone": "9876500101",
                                                                        "service_interest": "FSSAI License", "assigned_user_id": rep["id"]})
    assert lead.status_code == 201, lead.text
    lead = lead.json()
    assert client.post("/api/sales-hub/schemes", headers=legal_h, json={"title": "Diwali 10% off", "description": "On GST registration"}).status_code == 201
    flyer = client.post("/api/sales-hub/materials", headers=legal_h, data={"title": "GST flyer", "kind": "FLYER"},
                        files={"file": ("gst.pdf", b"%PDF flyer", "application/pdf")})
    assert flyer.status_code == 201, flyer.text

    # Sales staff cannot manage schemes or upload company material.
    assert client.post("/api/sales-hub/schemes", headers=rep_h, json={"title": "Nope"}).status_code == 403

    # Start the day, then see only their own leads plus schemes and material.
    assert client.post("/api/sales-hub/day/start", headers=rep_h).status_code == 200
    s = client.get("/api/sales-hub/summary", headers=rep_h).json()
    assert [l["id"] for l in s["leads"]] == [lead["id"]] and not s["can_manage"]
    assert any(x["title"] == "Diwali 10% off" for x in s["schemes"])
    assert any(m["title"] == "GST flyer" and m["has_file"] for m in s["materials"])
    assert client.get(f"/api/sales-hub/materials/{flyer.json()['id']}/file", headers=rep_h).content == b"%PDF flyer"
    assert client.get("/api/sales-hub/summary", headers=other_h).json()["leads"] == []

    # Dialer: log calls (CRM entries). Someone else's lead is refused.
    r = client.post(f"/api/sales-hub/leads/{lead['id']}/calls", headers=rep_h, json={"outcome": "CALL_BACK", "note": "Call after 5", "follow_up_date": "2026-12-01"})
    assert r.status_code == 201 and r.json()["lead"]["status"] == "CALL_BACK" and r.json()["lead"]["follow_up_date"] == "2026-12-01"
    assert client.post(f"/api/sales-hub/leads/{lead['id']}/calls", headers=other_h, json={"outcome": "NO_ANSWER"}).status_code == 403
    assert client.post(f"/api/sales-hub/leads/{lead['id']}/calls", headers=rep_h, json={"outcome": "SHOUTED"}).status_code == 422
    client.post(f"/api/sales-hub/leads/{lead['id']}/calls", headers=rep_h, json={"outcome": "CONVERTED", "note": "Paid"})
    calls = client.get(f"/api/sales-hub/leads/{lead['id']}/calls", headers=rep_h).json()["items"]
    assert [c["outcome"] for c in calls] == ["CONVERTED", "CALL_BACK"]

    # Progress and attendance are visible to the team.
    rows = {r["email"]: r for r in client.get("/api/sales-hub/progress", headers=other_h).json()["rows"]}
    me = rows["rep.one@rexera-test.com"]
    assert (me["calls"], me["converted"], me["leads_assigned"], me["day_status"]) == (2, 1, 1, "WORKING")
    assert rows["rep.two@rexera-test.com"]["calls"] == 0
    board = {b["email"]: b for b in client.get("/api/sales-hub/attendance", headers=other_h).json()["board"]}
    assert board["rep.one@rexera-test.com"]["status"] == "WORKING" and board["rep.two@rexera-test.com"]["status"] == "NOT_STARTED"
    assert client.post("/api/sales-hub/day/end", headers=rep_h).json()["ended_at"]
    board = {b["email"]: b for b in client.get("/api/sales-hub/attendance", headers=rep_h).json()["board"]}
    assert board["rep.one@rexera-test.com"]["status"] == "DAY_ENDED"
    assert client.post("/api/sales-hub/day/end", headers=other_h).status_code == 409


def test_manage_validation_and_import(client, auth, store):
    rep, _ = user(client, auth, store, "rep.import@rexera-test.com", "sales")
    assert client.post("/api/sales-hub/leads", headers=auth, json={}).status_code == 422
    assert client.post("/api/sales-hub/leads", headers=auth, json={"name": "X", "assigned_user_id": "ghost"}).status_code == 404
    assert client.post("/api/sales-hub/schemes", headers=auth, json={"title": "Bad", "valid_from": "2026-12-01", "valid_to": "2026-11-01"}).status_code == 422
    assert client.post("/api/sales-hub/materials", headers=auth, data={"title": "Empty", "kind": "POST"}).status_code == 422
    assert client.post("/api/sales-hub/materials", headers=auth, data={"title": "Bad", "kind": "POST"},
                       files={"file": ("x.exe", b"MZ", "application/octet-stream")}).status_code == 422
    info = client.post("/api/sales-hub/materials", headers=auth, data={"title": "Pricing", "kind": "SALES_INFO", "description": "GST: ₹1,999"})
    assert info.status_code == 201 and not info.json()["has_file"]

    rows = [{"name": "Lead A", "phone": "98765 11111", "assigned_to": "rep.import@rexera-test.com"},
            {"name": "Lead A again", "phone": "+91 9876511111"},
            {"city": "Surat"}]
    r = client.post("/api/sales-hub/leads/import", headers=auth, json=rows).json()
    assert (r["imported"], r["skipped"], r["failed"]) == (1, 1, 1)
    mine = client.get("/api/sales-hub/leads", headers=auth, params={"assigned": rep["id"]}).json()["items"]
    assert [l["name"] for l in mine] == ["Lead A"]
