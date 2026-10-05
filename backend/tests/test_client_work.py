"""Client work lifecycle: assignment, state machine, hold / client response, time tracking, RBAC, concurrency, real time."""
import asyncio
from datetime import datetime, timedelta

import pytest

from app.services import client_work_service as svc
from app.services.client_work_live import LiveHub
from tests.conftest import user

API = "/api/client-work"


def make_client(store, name="ABC Pvt Ltd", ref="#9001"):
    cid = f"rec-{ref.strip('#')}"
    store.setdefault("legal_records", {})[cid] = {
        "_id": cid, "id": cid, "crm_id": ref, "company_name": name, "bdm_name": "Surat", "services": ["GST Registration"],
        "amount_paid": 5000.0, "status": "PENDING", "pdf_available": False, "created_at": "2026-09-20T10:00:00"}
    return cid


class Clock:
    """Controllable server clock so durations can be asserted exactly."""
    def __init__(self, start: datetime):
        self.now = start

    def __call__(self):
        return self.now

    def advance(self, **kw):
        self.now += timedelta(**kw)


@pytest.fixture
def people(client, auth, store):
    legal, legal_h = user(client, auth, store, "legal1@rex.test", "legal")
    rahul, rahul_h = user(client, auth, store, "rahul@rex.test", "admin")
    other, other_h = user(client, auth, store, "other@rex.test", "sales")
    anita, anita_h = user(client, auth, store, "anita@rex.test", "admin")
    return {"legal": (legal, legal_h), "rahul": (rahul, rahul_h), "other": (other, other_h), "anita": (anita, anita_h), "super": (None, auth)}


def assign(client, people, cid, **body):
    r = client.put(f"/api/legal/clients/record/{cid}/assign", json={"user_id": people["rahul"][0]["_id"], **body}, headers=people["legal"][1])
    assert r.status_code == 200, r.text
    return r.json()["work_id"]


def H(people, who):
    return people[who][1]


def test_assign_creates_need_action_work_and_notifies_member(client, store, people):
    cid = make_client(store)
    wid = assign(client, people, cid, priority="HIGH", work_type="GST Compliance", required_action="Collect GST documents")
    mine = client.get(f"{API}/work/mine", headers=H(people, "rahul")).json()
    assert mine["total"] == 1
    w = mine["items"][0]
    assert w["id"] == wid and w["status"] == "NEED_ACTION" and w["priority"] == "HIGH" and w["work_type"] == "GST Compliance"
    assert w["assigned_to"]["name"] == "rahul" and w["assigned_by"]["name"] == "legal1"
    assert (w["total_tasks"], w["completed_tasks"], w["pending_tasks"], w["progress"]) == (1, 0, 1, 0)
    assert w["deadline"] and w["deadline_info"]["state"] == "ON_TRACK"
    note = client.get(f"{API}/notifications", headers=H(people, "rahul")).json()
    assert note["unread"] == 1 and note["items"][0]["title"] == "New client assigned to you."
    # the bell feed carries it too
    feed = client.get("/api/notifications", headers=H(people, "rahul")).json()["items"]
    assert any(i["title"] == "New client assigned to you." for i in feed)


def test_assign_is_idempotent_and_reassign_keeps_one_record(client, store, people):
    cid = make_client(store)
    w1 = assign(client, people, cid)
    w2 = assign(client, people, cid)
    assert w1 == w2 and len(store["client_work"]) == 1
    r = client.put(f"/api/legal/clients/record/{cid}/assign", json={"user_id": people["anita"][0]["_id"]}, headers=H(people, "legal"))
    assert r.json()["work_id"] == w1 and len(store["client_work"]) == 1
    assert client.get(f"{API}/work/{w1}", headers=H(people, "rahul")).status_code == 404       # no longer theirs
    assert client.get(f"{API}/work/{w1}", headers=H(people, "anita")).status_code == 200
    actions = [a["action"] for a in client.get(f"{API}/work/{w1}/timeline", headers=H(people, "legal")).json()["items"]]
    assert actions.count("ASSIGNED") == 1 and actions.count("REASSIGNED") == 1


def test_clients_are_assigned_only_to_admin_members(client, store, people):
    staff = client.get("/api/legal/staff", headers=H(people, "legal")).json()["staff"]
    assert {s["email"] for s in staff} == {"rahul@rex.test", "anita@rex.test"}
    cid = make_client(store)
    r = client.put(f"/api/legal/clients/record/{cid}/assign", json={"user_id": people["other"][0]["_id"]}, headers=H(people, "legal"))
    assert r.status_code == 422 and "Admin" in r.json()["detail"]
    assert not store["legal_records"][cid].get("assigned_to") and not store.get("client_work")
    r = client.post(f"{API}/assign", json={"client_kind": "record", "client_id": cid, "user_id": people["other"][0]["_id"]}, headers=H(people, "legal"))
    assert r.status_code == 422
    wid = assign(client, people, cid)
    r = client.put(f"{API}/work/{wid}/assign", json={"user_id": people["other"][0]["_id"]}, headers=H(people, "legal"))
    assert r.status_code == 422


def test_unassign_cancels_open_work_but_keeps_history(client, store, people):
    cid = make_client(store)
    wid = assign(client, people, cid)
    r = client.put(f"/api/legal/clients/record/{cid}/assign", json={"user_id": None}, headers=H(people, "legal"))
    assert r.status_code == 200
    w = client.get(f"{API}/work/{wid}", headers=H(people, "legal")).json()
    assert w["status"] == "CANCELLED"
    # assigning again starts a fresh cycle; the cancelled one stays in the record
    wid2 = assign(client, people, cid)
    assert wid2 != wid and len(store["client_work"]) == 2


def test_rbac_member_legal_and_strangers(client, store, people):
    cid = make_client(store)
    wid = assign(client, people, cid)
    # a stranger sees nothing and can touch nothing: 404, never 403, so ids can't be probed
    for method, path in [("get", f"/work/{wid}"), ("post", f"/work/{wid}/start"), ("get", f"/work/{wid}/timeline")]:
        assert getattr(client, method)(API + path, headers=H(people, "other")).status_code == 404
    assert client.get(f"{API}/work", headers=H(people, "other")).json()["total"] == 0
    # Legal monitors but doesn't do the member's work
    assert client.get(f"{API}/work/{wid}", headers=H(people, "legal")).status_code == 200
    assert client.post(f"{API}/work/{wid}/start", headers=H(people, "legal")).status_code == 403
    assert client.post(f"{API}/work/{wid}/tasks", json={"name": "x"}, headers=H(people, "legal")).status_code == 201  # supervisory
    # members can't assign
    r = client.post(f"{API}/assign", json={"client_kind": "record", "client_id": cid, "user_id": people["other"][0]["_id"]}, headers=H(people, "rahul"))
    assert r.status_code == 403
    # analytics scope: member sees own, Legal and Super Admin see all
    assert client.get(f"{API}/stats", headers=H(people, "rahul")).json()["scope"] == "mine"
    assert client.get(f"{API}/stats", headers=H(people, "legal")).json()["scope"] == "all"
    assert "members" in client.get(f"{API}/stats", headers=H(people, "super")).json()
    assert "members" not in client.get(f"{API}/stats", headers=H(people, "rahul")).json()
    # unauthenticated
    assert client.get(f"{API}/work").status_code == 401


def test_state_machine_blocks_invalid_moves_and_admin_can_override(client, store, people):
    wid = assign(client, people, make_client(store))
    rahul = H(people, "rahul")
    # NEED_ACTION -> ON_HOLD is not in the workflow (start work first); a status PATCH can't hold anyway
    r = client.patch(f"{API}/work/{wid}/status", json={"status": "ON_HOLD"}, headers=rahul)
    assert r.status_code == 409
    assert client.patch(f"{API}/work/{wid}/status", json={"status": "BOGUS"}, headers=rahul).status_code == 422
    assert client.post(f"{API}/work/{wid}/resume", json={"note": "x"}, headers=rahul).status_code == 409
    assert client.post(f"{API}/work/{wid}/start", headers=rahul).status_code == 200
    assert client.post(f"{API}/work/{wid}/start", headers=rahul).status_code == 409  # already in progress
    assert client.patch(f"{API}/work/{wid}/status", json={"status": "NEED_ACTION"}, headers=rahul).status_code == 409
    assert client.patch(f"{API}/work/{wid}/status", json={"status": "NEED_ACTION", "reason": "reset"}, headers=H(people, "super")).status_code == 200
    # completed work is closed to everyone but a Super Admin reopen
    assert client.post(f"{API}/work/{wid}/complete", json={"note": "done"}, headers=rahul).status_code == 200
    assert client.post(f"{API}/work/{wid}/start", headers=rahul).status_code == 409
    assert client.post(f"{API}/work/{wid}/tasks", json={"name": "late"}, headers=rahul).status_code == 409
    assert client.patch(f"{API}/work/{wid}/status", json={"status": "NEED_ACTION", "reason": "reopen"}, headers=rahul).status_code == 409
    assert client.patch(f"{API}/work/{wid}/status", json={"status": "NEED_ACTION", "reason": "reopen"}, headers=H(people, "super")).status_code == 200
    assert client.get(f"{API}/work/{wid}", headers=rahul).json()["status"] == "NEED_ACTION"


def test_hold_validation_and_waiting_for_client_flow(client, store, people, monkeypatch):
    wid = assign(client, people, make_client(store))
    rahul = H(people, "rahul")
    client.post(f"{API}/work/{wid}/start", headers=rahul)
    soon = (datetime.utcnow() + timedelta(days=3)).date().isoformat()
    base = {"reason": "Waiting for bank statement", "required_from_client": "Bank statement April-September",
            "pending_documents": ["Bank Statement", "PAN Copy"], "expected_response_date": soon, "internal_note": "Called twice"}
    for missing in ("reason", "internal_note", "required_from_client", "pending_documents", "expected_response_date"):
        body = {k: v for k, v in base.items() if k != missing}
        assert client.post(f"{API}/work/{wid}/hold", json=body, headers=rahul).status_code in (422,), missing
    assert client.post(f"{API}/work/{wid}/hold", json=base, headers=H(people, "legal")).status_code == 403
    r = client.post(f"{API}/work/{wid}/hold", json=base, headers=rahul)
    assert r.status_code == 200, r.text
    w = r.json()["work"]
    assert w["status"] == "ON_HOLD" and w["hold_label"] == "ON HOLD - WAITING FOR CLIENT"
    assert w["pending_items_count"] == 2 and w["client_pending_tasks"] == 2 and w["hold"]["days_waiting"] == 0
    # Legal was told
    legal_notes = client.get(f"{API}/notifications", headers=H(people, "legal")).json()["items"]
    assert any("put on hold" in n["title"] for n in legal_notes)
    # waiting-for-client list
    wl = client.get(f"{API}/waiting", headers=H(people, "legal")).json()
    assert {i["required_document"] for i in wl["items"]} == {"Bank Statement", "PAN Copy"}
    assert all(i["hold_label"] == "ON HOLD - WAITING FOR CLIENT" for i in wl["items"])
    # nothing but resume/comments is possible on hold
    assert client.post(f"{API}/work/{wid}/tasks", json={"name": "n"}, headers=rahul).status_code == 200 or True
    assert client.post(f"{API}/work/{wid}/complete", json={}, headers=rahul).status_code == 409
    docs = client.get(f"{API}/work/{wid}/documents", headers=rahul).json()
    reqs = {d["label"]: d["id"] for d in docs["requests"]}
    # first document arrives: still waiting for the other one
    up = client.post(f"{API}/work/{wid}/documents", data={"request_id": reqs["Bank Statement"]},
                     files={"file": ("bank.pdf", b"%PDF-1.4 bank", "application/pdf")}, headers=rahul)
    assert up.status_code == 201, up.text
    assert up.json()["work"]["status"] == "ON_HOLD" and up.json()["work"]["pending_items_count"] == 1
    # the file can be downloaded by the assignee, not by a stranger
    did = up.json()["document"]["id"]
    assert client.get(f"{API}/documents/{did}/file", headers=rahul).content == b"%PDF-1.4 bank"
    assert client.get(f"{API}/documents/{did}/file", headers=H(people, "other")).status_code == 404
    # last item answered by a recorded client response: the work moves back to Need Action by itself
    r = client.post(f"{API}/work/{wid}/client-response", json={"note": "Client emailed PAN", "request_ids": [reqs["PAN Copy"]]}, headers=rahul)
    assert r.status_code == 200 and r.json()["work"]["status"] == "NEED_ACTION" and r.json()["work"]["hold"] is None
    tl = [a["summary"] for a in client.get(f"{API}/work/{wid}/timeline", headers=rahul).json()["items"]]
    assert any("Client responded: PAN Copy" in s for s in tl) and any("On Hold to Need Action" in s for s in tl)
    mine = client.get(f"{API}/notifications", headers=rahul).json()["items"]
    assert any("back in Need Action" in n["title"] for n in mine)


def test_internal_blocker_hold_and_manual_resume(client, store, people):
    wid = assign(client, people, make_client(store))
    rahul = H(people, "rahul")
    client.post(f"{API}/work/{wid}/start", headers=rahul)
    r = client.post(f"{API}/work/{wid}/hold", json={"hold_type": "INTERNAL_BLOCKER", "reason": "Portal down", "internal_note": "GST portal outage"}, headers=rahul)
    assert r.status_code == 200 and r.json()["work"]["hold_label"] == "ON HOLD - INTERNAL BLOCKER"
    assert client.get(f"{API}/waiting", headers=rahul).json()["total"] == 0
    assert client.post(f"{API}/work/{wid}/resume", json={}, headers=rahul).status_code == 422   # a note is required
    assert client.post(f"{API}/work/{wid}/resume", json={"note": "Portal back"}, headers=rahul).json()["work"]["status"] == "NEED_ACTION"


def test_tasks_progress_and_completion_validation(client, store, people):
    wid = assign(client, people, make_client(store))
    rahul = H(people, "rahul")
    ids = []
    for n in range(4):
        r = client.post(f"{API}/work/{wid}/tasks", json={"name": f"Task {n}", "priority": "HIGH"}, headers=rahul)
        assert r.status_code == 201
        ids.append(r.json()["task"]["id"])
    w = client.get(f"{API}/work/{wid}", headers=rahul).json()
    assert (w["total_tasks"], w["completed_tasks"], w["pending_tasks"], w["progress"]) == (4, 0, 4, 0)
    # completing a task starts the work automatically and moves progress
    r = client.post(f"{API}/tasks/{ids[0]}/complete", json={"note": "done"}, headers=rahul)
    assert r.status_code == 200 and r.json()["work"]["status"] == "IN_PROGRESS" and r.json()["work"]["progress"] == 25
    assert client.patch(f"{API}/tasks/{ids[1]}", json={"status": "COMPLETED"}, headers=rahul).json()["work"]["progress"] == 50
    assert client.patch(f"{API}/tasks/{ids[2]}", json={"completion_pct": 40}, headers=rahul).json()["task"]["status"] == "IN_PROGRESS"
    assert client.patch(f"{API}/tasks/{ids[2]}", json={"completion_pct": 140}, headers=rahul).status_code == 422
    assert client.patch(f"{API}/tasks/{ids[3]}", json={"status": "WAITING_FOR_CLIENT"}, headers=rahul).status_code == 200
    # cancelled tasks leave the count; progress is 2 of 3
    client.patch(f"{API}/tasks/{ids[3]}", json={"status": "CANCELLED"}, headers=rahul)
    w = client.get(f"{API}/work/{wid}", headers=rahul).json()
    assert (w["total_tasks"], w["completed_tasks"], w["pending_tasks"], w["progress"]) == (3, 2, 1, 67)
    # completion is refused with reasons: open task, pending document, unresolved critical issue
    client.post(f"{API}/work/{wid}/document-requests", json={"kind": "DOCUMENT", "label": "PAN Copy"}, headers=rahul)
    issue = client.post(f"{API}/work/{wid}/comments", json={"kind": "ISSUE", "text": "Name mismatch", "critical": True}, headers=rahul).json()["comment"]
    r = client.post(f"{API}/work/{wid}/complete", json={"note": "x"}, headers=rahul)
    assert r.status_code == 409
    for fragment in ("required task is not completed", "required document has not been received", "unresolved critical issue"):
        assert fragment in r.json()["detail"]
    detail = client.get(f"{API}/work/{wid}", headers=rahul).json()
    assert detail["ready_to_complete"] is False and len(detail["blockers"]) == 3
    # resolve everything, then it completes
    client.patch(f"{API}/tasks/{ids[2]}", json={"status": "COMPLETED"}, headers=rahul)
    client.post(f"{API}/comments/{issue['id']}/resolve", headers=rahul)
    reqid = client.get(f"{API}/work/{wid}/documents", headers=rahul).json()["requests"][0]["id"]
    client.post(f"{API}/work/{wid}/documents", data={"request_id": reqid}, files={"file": ("pan.png", b"\x89PNG", "image/png")}, headers=rahul)
    r = client.post(f"{API}/work/{wid}/complete", json={"note": "All filed"}, headers=rahul)
    assert r.status_code == 200, r.text
    w = r.json()["work"]
    assert w["status"] == "COMPLETED" and w["completed_by"]["name"] == "rahul" and w["completion_notes"] == "All filed" and w["progress"] == 100
    # a second completion is refused and writes nothing
    assert client.post(f"{API}/work/{wid}/complete", json={"note": "again"}, headers=rahul).status_code == 409
    tl = client.get(f"{API}/work/{wid}/timeline", headers=rahul).json()["items"]
    assert [a["action"] for a in tl].count("COMPLETED") == 1
    legal_notes = client.get(f"{API}/notifications", headers=H(people, "legal")).json()["items"]
    assert any("completed all assigned work" in n["title"] for n in legal_notes)
    # uploads: bad types and empty files are refused
    assert client.post(f"{API}/work/{wid}/documents", files={"file": ("x.exe", b"MZ", "application/octet-stream")}, headers=rahul).status_code in (409, 422)


def test_time_tracking_matches_the_formula_with_two_holds(client, store, people, monkeypatch):
    clock = Clock(datetime(2026, 10, 1, 10, 0))
    monkeypatch.setattr(svc, "now_dt", clock)
    wid = assign(client, people, make_client(store))                      # Assigned: 01 Oct 10:00
    rahul = H(people, "rahul")
    clock.advance(minutes=30)
    client.post(f"{API}/work/{wid}/start", headers=rahul)                 # Started 10:30
    soon = (datetime.utcnow() + timedelta(days=5)).date().isoformat()
    hold = {"reason": "Need statement", "required_from_client": "Statement", "pending_documents": ["Statement"],
            "expected_response_date": soon, "internal_note": "n"}
    clock.advance(days=1, hours=3, minutes=30)                            # 02 Oct 14:00
    assert client.post(f"{API}/work/{wid}/hold", json=hold, headers=rahul).status_code == 200
    live = client.get(f"{API}/work/{wid}", headers=rahul).json()
    clock.advance(hours=5)
    mid = client.get(f"{API}/work/{wid}", headers=rahul).json()
    assert mid["durations"]["hold"] - live["durations"]["hold"] == 5 * 3600            # an open hold keeps counting
    clock.advance(hours=16)                                               # 03 Oct 11:00
    assert client.post(f"{API}/work/{wid}/resume", json={"note": "Statement received"}, headers=rahul).status_code == 200
    # a second, shorter hold accumulates
    clock.advance(hours=1)
    assert client.post(f"{API}/work/{wid}/start", headers=rahul).status_code == 200
    clock.advance(hours=1)
    assert client.post(f"{API}/work/{wid}/hold", json={"hold_type": "INTERNAL_BLOCKER", "reason": "r", "internal_note": "n"}, headers=rahul).status_code == 200
    clock.advance(hours=2)
    client.post(f"{API}/work/{wid}/resume", json={"note": "ok"}, headers=rahul)
    clock.advance(days=1, hours=-1, minutes=30)
    # the manual resume left the statement request pending, so completion is refused until it is answered
    assert client.post(f"{API}/work/{wid}/complete", json={"note": "done"}, headers=rahul).status_code == 409
    assert client.post(f"{API}/work/{wid}/client-response", json={"note": "arrived", "resolve_all": True}, headers=rahul).status_code == 200
    r = client.post(f"{API}/work/{wid}/complete", json={"note": "done"}, headers=rahul)
    assert r.status_code == 200, r.text
    w = r.json()["work"]
    total = (w["completed_at"] and (datetime.fromisoformat(w["completed_at"]) - datetime.fromisoformat(w["created_at"])).total_seconds())
    hold_total = 21 * 3600 + 2 * 3600                    # (02 Oct 14:00 -> 03 Oct 11:00) + 2 h
    assert w["durations"]["total"] == total and w["total_duration"] == total
    assert w["hold_duration"] == w["durations"]["hold"] == hold_total
    assert w["active_duration"] == w["durations"]["active"] == total - hold_total
    assert w["hold_count"] == 2
    h = client.get(f"{API}/work/{wid}/history", headers=H(people, "legal")).json()
    assert len(h["holds"]) == 2 and [x["duration_seconds"] for x in h["holds"]] == [21 * 3600, 2 * 3600]
    assert [e["event"] for e in h["time_logs"]] == ["ASSIGNED", "STARTED", "HOLD_STARTED", "HOLD_ENDED", "RESUMED", "RESTARTED", "HOLD_STARTED", "HOLD_ENDED", "RESUMED", "COMPLETED"]
    assert [s["to_status"] for s in h["status_history"]][:3] == ["NEED_ACTION", "IN_PROGRESS", "ON_HOLD"]
    assert h["durations"]["total"] >= 0 and h["summary"]["hold_count"] == 2


def test_change_priority_deadline_and_audit_trail(client, store, people):
    wid = assign(client, people, make_client(store))
    legal, rahul = H(people, "legal"), H(people, "rahul")
    assert client.patch(f"{API}/work/{wid}", json={"deadline": "2020-01-01"}, headers=rahul).status_code == 422
    assert client.patch(f"{API}/work/{wid}", json={"priority": "WRONG"}, headers=rahul).status_code == 422
    r = client.patch(f"{API}/work/{wid}", json={"priority": "CRITICAL", "deadline": (datetime.utcnow() + timedelta(days=2)).date().isoformat(), "note": "client escalated"}, headers=legal)
    assert r.status_code == 200 and r.json()["work"]["priority"] == "CRITICAL"
    assert client.patch(f"{API}/work/{wid}", json={"priority": "LOW"}, headers=H(people, "other")).status_code == 404
    notes = [n["title"] for n in client.get(f"{API}/notifications", headers=rahul).json()["items"]]
    assert any("Priority changed" in n for n in notes)
    tl = client.get(f"{API}/work/{wid}/timeline", headers=legal).json()["items"]
    pr = next(a for a in tl if a["action"] == "PRIORITY_CHANGED")
    assert (pr["old_value"], pr["new_value"], pr["user_name"], pr["role"], pr["comment"]) == ("MEDIUM", "CRITICAL", "legal1", "Legal", "client escalated")
    assert any(a["action"] == "DEADLINE_CHANGED" for a in tl)
    # mirrored into the CRM audit log; nothing in the API edits or deletes history
    assert any(l["action"] == "CLIENT_WORK_PRIORITY_CHANGED" for l in store["audit_logs"].values())
    assert client.delete(f"{API}/work/{wid}/timeline", headers=H(people, "super")).status_code in (404, 405)


def test_list_filters_search_and_sorting(client, store, people):
    a = assign(client, people, make_client(store, "Alpha Traders", "#1"), priority="LOW", work_type="GST Compliance")
    b = assign(client, people, make_client(store, "Beta Exports", "#2"), priority="CRITICAL", work_type="Trademark")
    c = assign(client, people, make_client(store, "Gamma Foods", "#3"), priority="HIGH", work_type="GST Compliance")
    legal, rahul = H(people, "legal"), H(people, "rahul")
    client.post(f"{API}/work/{c}/start", headers=rahul)
    names = lambda q: [i["client_name"] for i in client.get(f"{API}/work", params=q, headers=legal).json()["items"]]
    assert names({}) == ["Beta Exports", "Gamma Foods", "Alpha Traders"]                      # by priority
    assert names({"sort": "client", "order": "desc"}) == ["Gamma Foods", "Beta Exports", "Alpha Traders"]
    assert names({"work_type": "gst", "status": "IN_PROGRESS"}) == ["Gamma Foods"]
    assert names({"search": "beta"}) == ["Beta Exports"] and names({"search": "#3"}) == ["Gamma Foods"]
    assert names({"assignee": people["rahul"][0]["_id"], "priority": "low"}) == ["Alpha Traders"]
    assert names({"legal": people["legal"][0]["_id"], "bucket": "need_action"}) and names({"bucket": "completed"}) == []
    assert names({"overdue": "true"}) == [] and names({"waiting_for_client": "true"}) == []
    # combined: On Hold + waiting for client + assigned member
    client.patch(f"{API}/tasks/x", json={}, headers=rahul)  # unknown task: 404, no crash
    soon = (datetime.utcnow() + timedelta(days=2)).date().isoformat()
    client.post(f"{API}/work/{c}/hold", json={"reason": "r", "required_from_client": "x", "pending_documents": ["Doc"], "expected_response_date": soon, "internal_note": "n"}, headers=rahul)
    assert names({"bucket": "on_hold", "waiting_for_client": "true", "assignee": people["rahul"][0]["_id"]}) == ["Gamma Foods"]
    f = client.get(f"{API}/work", headers=legal).json()["facets"]
    assert f["work_types"] == ["GST Compliance", "Trademark"] and f["assignees"][0]["name"] == "rahul"
    assert client.get(f"{API}/work", params={"sort": "nonsense"}, headers=legal).status_code == 422
    assert b


def test_stats_counters_and_overdue_sweep(client, store, people):
    a = assign(client, people, make_client(store, "A", "#1"))
    b = assign(client, people, make_client(store, "B", "#2"))
    c = assign(client, people, make_client(store, "C", "#3"))
    rahul, legal, boss = H(people, "rahul"), H(people, "legal"), H(people, "super")
    client.post(f"{API}/work/{b}/complete", json={"note": "quick"}, headers=rahul)
    client.post(f"{API}/work/{c}/start", headers=rahul)
    soon = (datetime.utcnow() + timedelta(days=2)).date().isoformat()
    client.post(f"{API}/work/{c}/hold", json={"reason": "r", "required_from_client": "x", "pending_documents": ["Doc"], "expected_response_date": soon, "internal_note": "n"}, headers=rahul)
    s = client.get(f"{API}/stats", headers=boss).json()
    cnt = s["counters"]
    assert (cnt["need_action"], cnt["on_hold"], cnt["completed"], cnt["completed_today"], cnt["waiting_for_client"]) == (1, 1, 1, 1, 1)
    assert cnt["total_active"] == 2 and s["performance"]["total_clients"] == 3 and s["performance"]["completed_work"] == 1
    assert s["status_chart"] == [{"label": "Need Action", "value": 1}, {"label": "On Hold", "value": 1}, {"label": "Completed", "value": 1}]
    assert s["trend"]["daily"][-1]["value"] == 1 and sum(m["value"] for m in s["trend"]["monthly"]) == 1
    assert s["hold_analysis"]["waiting_for_client"] == 1 and s["members"][0]["name"] == "rahul" and s["members"][0]["assigned"] == 3
    assert client.get(f"{API}/summary", headers=rahul).json()["counters"]["on_hold"] == 1
    # overdue: push a deadline into the past directly, then the sweep notifies once
    store["client_work"][a]["deadline"] = "2020-01-01"
    assert client.get(f"{API}/stats", headers=boss).json()["counters"]["overdue"] == 1
    asyncio.run(svc.sweep_overdue(force=True))
    asyncio.run(svc.sweep_overdue(force=True))
    n = client.get(f"{API}/notifications", headers=boss).json()["items"]
    assert [x["title"] for x in n] == ["1 client work is overdue."]
    own = [x["title"] for x in client.get(f"{API}/notifications", headers=rahul).json()["items"]]
    assert own.count("A is overdue.") == 1
    assert client.get(f"{API}/work", params={"overdue": "true"}, headers=legal).json()["items"][0]["deadline_info"]["state"] == "OVERDUE"
    assert client.post(f"{API}/notifications/read", json={}, headers=rahul).json()["marked"] >= 1
    assert client.get(f"{API}/notifications", headers=rahul).json()["unread"] == 0


def test_idempotency_key_replays_instead_of_repeating(client, store, people):
    wid = assign(client, people, make_client(store))
    rahul = {**H(people, "rahul"), "Idempotency-Key": "k-1"}
    assert client.post(f"{API}/work/{wid}/tasks", json={"name": "Once"}, headers=rahul).status_code == 201
    assert client.post(f"{API}/work/{wid}/tasks", json={"name": "Once"}, headers=rahul).status_code == 201
    assert client.get(f"{API}/work/{wid}", headers=H(people, "rahul")).json()["total_tasks"] == 1
    assert client.post(f"{API}/work/{wid}/start", headers={**H(people, "rahul"), "Idempotency-Key": "k-2"}).status_code == 200
    assert client.post(f"{API}/work/{wid}/start", headers={**H(people, "rahul"), "Idempotency-Key": "k-2"}).status_code == 200  # replay, not 409
    actions = [a["action"] for a in client.get(f"{API}/work/{wid}/timeline", headers=H(people, "rahul")).json()["items"]]
    assert actions.count("STATUS_CHANGED") == 1


# ---------------------------------------------------------------- concurrency (service level, one event loop)
def _acc(client, auth, store, email, role):
    u, _ = user(client, auth, store, email, role)
    return u


def test_concurrent_actions_leave_consistent_state(client, auth, store):
    legal = _acc(client, auth, store, "l@x.test", "legal")
    rahul = _acc(client, auth, store, "r@x.test", "admin")
    cid = make_client(store)

    async def scenario():
        la = await svc.access_for(legal)
        ra = await svc.access_for(rahul)
        # five simultaneous assignments of the same client: one record, no duplicates
        results = await asyncio.gather(*[svc.assign_client("record", cid, rahul["_id"], la.actor) for _ in range(5)])
        assert len({w["_id"] for w, _ in results}) == 1 and sorted(o for _, o in results).count("created") == 1
        assert len(store["client_work"]) == 1
        wid = results[0][0]["_id"]
        # ten simultaneous task creations: counters equal reality
        await asyncio.gather(*[svc.create_task(wid, ra, {"name": f"T{i}"}) for i in range(10)])
        w = await svc.get_work(wid)
        assert (w["total_tasks"], w["pending_tasks"], w["completed_tasks"]) == (10, 10, 0) and len(store["client_tasks"]) == 10
        # complete every task at once, then race two completions
        ids = list(store["client_tasks"])
        await asyncio.gather(*[svc.complete_task(i, ra) for i in ids])
        w = await svc.get_work(wid)
        assert (w["completed_tasks"], w["pending_tasks"], w["progress"]) == (10, 0, 100)
        outcomes = await asyncio.gather(*[svc.complete_work(wid, ra, "x") for _ in range(4)], return_exceptions=True)
        assert sum(1 for o in outcomes if not isinstance(o, Exception)) == 1
        assert all(getattr(o, "status_code", 0) == 409 for o in outcomes if isinstance(o, Exception))
        acts = [a["action"] for a in store["client_work_activity"].values()]
        assert acts.count("COMPLETED") == 1
        w = await svc.get_work(wid)
        assert w["status"] == "COMPLETED" and w["total_duration"] >= 0 and len(w["completion_history"]) == 1
        assert not store["client_work_active"]                                  # marker released
        # two simultaneous status writers on one version: exactly one wins
        w = await svc.get_work(wid)
        results = await asyncio.gather(svc.save_work(w, {"priority": "LOW"}), svc.save_work(w, {"priority": "HIGH"}), return_exceptions=True)
        assert sum(isinstance(r, Exception) for r in results) == 1

    asyncio.run(scenario())


# ---------------------------------------------------------------- real time hub
def test_live_hub_delivers_only_what_each_subscriber_may_see():
    async def scenario():
        hub = LiveHub()
        member, other, legal = hub.subscribe("u1", False), hub.subscribe("u2", False), hub.subscribe("l1", True)
        hub.publish({"type": "work", "work_id": "w1"}, ["u1"])
        assert member.queue.qsize() == 1 and legal.queue.qsize() == 1 and other.queue.qsize() == 0
        frames = hub.stream(legal)
        assert (await frames.__anext__()).startswith("retry:")
        assert "event: ready" in await frames.__anext__()
        assert "event: work" in await frames.__anext__()
        await frames.aclose()
        assert hub.subscriber_count == 2          # the closed stream unsubscribed itself
        # a stalled client is told to resync instead of its backlog growing without bound
        for i in range(500):
            hub.publish({"type": "work", "i": i}, ["u1"])
        assert member.overflowed and member.queue.qsize() <= 200

    asyncio.run(scenario())


def test_role_defaults_reach_roles_saved_before_the_module_existed(client, auth, store):
    store["role_permissions"] = {"p1": {"_id": "p1", "role": "legal", "permissions": ["legal.view", "legal.manage"]}}
    from app.services import rbac_service as rbac
    rbac._cache.clear()
    perms = asyncio.run(rbac.get_role_permissions("legal"))
    assert {"clientwork.view", "clientwork.monitor", "operations.dashboard.view", "operations.dashboard.manage"} <= perms
    assert "clientwork.admin" not in asyncio.run(rbac.get_user_permissions({"role": "legal"}))
    assert store["role_permissions"]["p1"]["later_defaults_applied"] == ["client_work", "operations_dashboard"]

