"""Client productivity (tasks, timesheets, blockers) and company broadcasts."""
import itertools
from datetime import date, timedelta

import pytest

from tests.conftest import login

_seq = itertools.count(1)


def make_employee(client, auth, **over):
    n = next(_seq)
    body = {"full_name": f"Prod Person {n}", "email": f"prod{n}@rexera-test.com", "mobile_number": "9844400000",
            "department": "ADMIN", "designation": "Analyst", "date_of_joining": "2026-01-01", "base_salary": 25000}
    body.update(over)
    r = client.post("/api/employees", headers=auth, json=body)
    assert r.status_code == 200, r.text
    return r.json()


@pytest.fixture(scope="module")
def task(client, auth):
    emp = make_employee(client, auth)
    r = client.post("/api/productivity/tasks/quick", headers=auth, json={
        "client_name": "Acme", "project_name": "Portal", "task_title": "Build login", "employee_id": emp["employee_code"]})
    assert r.status_code == 201, r.text
    return emp, r.json()["data"]


def log(client, auth, emp, task, **over):
    body = {"employee_id": emp["employee_code"], "task_id": task["_id"], "work_date": date.today().isoformat(),
            "hours_spent": 2, "work_description": "Worked on it"}
    body.update(over)
    return client.post("/api/productivity/timesheet/log", headers=auth, json=body)


def test_timesheet_logging_and_limits(client, auth, task):
    emp, t = task
    assert log(client, auth, emp, t, hours_spent=6).status_code == 201
    assert log(client, auth, emp, t, hours_spent=19).status_code == 400  # 25h in a day
    assert log(client, auth, emp, t, work_date="not-a-date").status_code == 422
    assert log(client, auth, emp, t, work_date=(date.today() + timedelta(days=10)).isoformat()).status_code == 422
    assert log(client, auth, emp, t, task_id="nope").status_code == 400
    assert log(client, auth, emp, t, hours_spent=0).status_code == 422
    tasks = client.get("/api/productivity/tasks", headers=auth).json()["data"]
    assert next(x for x in tasks if x["_id"] == t["_id"])["actual_hours_logged"] == 6


def test_quick_task_reuses_client_and_project(client, auth, task):
    emp, _ = task
    before = len(client.get("/api/productivity/clients", headers=auth).json()["data"])
    r = client.post("/api/productivity/tasks/quick", headers=auth, json={
        "client_name": "Acme", "project_name": "Portal", "task_title": "Second", "employee_id": emp["employee_code"]})
    assert r.status_code == 201
    assert len(client.get("/api/productivity/clients", headers=auth).json()["data"]) == before
    assert client.post("/api/productivity/tasks/quick", headers=auth, json={
        "client_name": "Acme", "project_name": "Portal", "task_title": "x", "employee_id": "ghost"}).status_code == 404


def test_blocker_and_dashboard(client, auth, task, outbox):
    emp, t = task
    r = client.post("/api/productivity/tasks/flag-blocker", headers=auth, json={
        "task_id": t["_id"], "employee_id": emp["employee_code"], "blocker_category": "OTHER",
        "blocker_reason": "<b>Waiting</b> on <script>alert(1)</script> access"})
    assert r.status_code == 200 and r.json()["data"]["status"] == "BLOCKED"
    mail = next(m for m in reversed(outbox) if "BOTTLENECK" in m["subject"])
    assert "<script>" not in mail["html"]
    assert client.get("/api/productivity/dashboard/birds-eye", headers=auth).status_code == 200
    assert client.get("/api/productivity/dashboard/birds-eye", headers=auth, params={"date_str": "x"}).status_code == 422


def test_timesheet_blocked_on_leave_day(client, auth, task):
    emp, t = task
    day = (date.today() - timedelta(days=3)).isoformat()
    lid = client.post("/api/leaves/apply", headers=auth, json={
        "employee_id": emp["employee_code"], "leave_type": "CL", "start_date": day, "end_date": day,
        "reason": "Personal"}).json()["data"]["_id"]
    client.post("/api/leaves/decision", headers=auth, json={"leave_request_id": lid, "action": "APPROVE"})
    assert log(client, auth, emp, t, work_date=day).status_code == 400


# ---------------------------------------------------------------- broadcasts

def publish(client, auth, **over):
    body = {"title": "Office closed Friday", "rich_html_content": "Line one\nLine two", "priority": "INFO",
            "audience_type": "ALL_EMPLOYEES"}
    body.update(over)
    return client.post("/api/broadcasts/publish", headers=auth, json=body)


def test_broadcast_body_is_sanitised(client, auth, outbox):
    make_employee(client, auth, full_name="Reader One")
    r = publish(client, auth, title="Policy <update>", rich_html_content=(
        '<p onclick="steal()">Hello <b>team</b></p><script>alert(1)</script>'
        '<a href="javascript:alert(1)">bad</a> <a href="https://rexera.co.in">good</a><img src=x onerror=alert(1)>'))
    assert r.status_code == 202, r.text
    bid = r.json()["broadcast_id"]
    mails = [m for m in outbox if "Policy <update>" in m["subject"]]
    assert mails
    body = mails[-1]["html"]
    for bad in ("<script", "onclick", "javascript:", "onerror", "<img"):
        assert bad not in body, bad
    assert "<b>team</b>" in body and 'href="https://rexera.co.in"' in body
    assert "Policy &lt;update&gt;" in body
    assert "Dear None" not in body and "127.0.0.1" not in body
    assert client.get(f"/api/broadcasts/analytics/{bid}", headers=auth).status_code == 200


def test_plain_text_keeps_line_breaks(client, auth, outbox):
    make_employee(client, auth)
    publish(client, auth, title="Two lines please")
    mail = next(m for m in reversed(outbox) if "Two lines please" in m["subject"])
    assert "Line one<br>Line two" in mail["html"]


def test_former_staff_do_not_receive_broadcasts(client, auth, outbox):
    gone = make_employee(client, auth, employee_status="Resigned", email="resigned.person@rexera-test.com")
    publish(client, auth, title="Staff only notice")
    assert not any(m["to"] == gone["email"] and "Staff only notice" in m["subject"] for m in outbox)


def test_employee_without_email_does_not_break_publishing(client, auth, store):
    emp = make_employee(client, auth)
    store.tables["employees"][emp["id"]]["email"] = ""  # legacy record
    assert publish(client, auth, title="Still works").status_code == 202


def test_acknowledge_with_employee_account(client, auth, store):
    emp = make_employee(client, auth, email="ack.person@rexera-test.com")
    client.post("/api/users", headers=auth, json={"username": "ackperson", "email": emp["email"],
                                                  "role": "employee", "password": "Passw0rd!x"})
    bid = publish(client, auth, title="Please acknowledge", requires_acknowledgment=True).json()["broadcast_id"]
    headers = login(client, store, emp["email"], "Passw0rd!x")
    feed = client.get("/api/broadcasts/in-app/my-notifications", headers=headers).json()
    assert any(n["reference_id"] == bid for n in feed["data"])
    assert client.post(f"/api/broadcasts/acknowledge/{bid}", headers=headers).status_code == 200
    assert client.post(f"/api/broadcasts/acknowledge/{bid}", headers=headers).status_code == 200
    stats = client.get(f"/api/broadcasts/analytics/{bid}", headers=auth).json()
    assert stats["acknowledged_count"] == 1


def test_broadcast_validation_and_list(client, auth):
    assert publish(client, auth, title="  ").status_code == 422
    assert publish(client, auth, priority="PANIC").status_code == 422
    assert publish(client, auth, audience_type="DEPARTMENT", target_departments=[]).status_code == 400
    r = client.get("/api/broadcasts", headers=auth)
    assert r.status_code == 200 and len(r.json()["data"]) >= 1


def test_branch_broadcast_reaches_only_that_branch(client, auth, outbox):
    inside = make_employee(client, auth, branch="BRD", email="brd.person@rexera-test.com")
    outside = make_employee(client, auth, branch="AMD", email="amd.person@rexera-test.com")
    assert publish(client, auth, audience_type="BRANCH", target_branches=[]).status_code == 400
    r = publish(client, auth, title="Baroda office notice", audience_type="BRANCH", target_branches=["BRD"])
    assert r.status_code == 202, r.text
    got = {m["to"] for m in outbox if "Baroda office notice" in m["subject"]}
    assert inside["email"] in got and outside["email"] not in got
    listed = next(b for b in client.get("/api/broadcasts", headers=auth).json()["data"]
                  if b["broadcast_id"] == r.json()["broadcast_id"])
    assert listed["audience_type"] == "BRANCH" and listed["target_branches"] == ["BRD"]


def test_personal_message_reaches_only_selected_employee(client, auth, outbox):
    target = make_employee(client, auth, email="personal.target@rexera-test.com")
    other = make_employee(client, auth, email="personal.other@rexera-test.com")
    assert publish(client, auth, audience_type="CUSTOM_LIST", target_employee_ids=[]).status_code == 400
    r = publish(client, auth, title="Your appraisal meeting", audience_type="CUSTOM_LIST", target_employee_ids=[target["id"]])
    assert r.status_code == 202 and r.json()["total_recipients"] == 1, r.text
    got = {m["to"] for m in outbox if "Your appraisal meeting" in m["subject"]}
    assert got == {target["email"]} and other["email"] not in got
