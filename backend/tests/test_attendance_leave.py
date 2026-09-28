"""Attendance rules and leave management."""
import itertools

import pytest

_seq = itertools.count(1)
GOOD_CFG = {"shift_start_time": "10:00", "grace_cutoff_time": "10:45", "late_cutoff_time": "12:15",
            "early_logout_cutoff_time": "17:00"}


@pytest.fixture(scope="module")
def emp(client, auth):
    n = next(_seq)
    r = client.post("/api/employees", headers=auth, json={
        "full_name": f"Leave Taker {n}", "email": f"leave{n}@rexera-test.com", "mobile_number": "9811100000",
        "department": "ADMIN", "designation": "Clerk", "date_of_joining": "2026-01-01", "base_salary": 30000})
    assert r.status_code == 200, r.text
    return r.json()


# ---------------------------------------------------------------- attendance

def test_attendance_config_roundtrip(client, auth):
    cfg = client.get("/api/attendance/config", headers=auth).json()
    r = client.put("/api/attendance/config", headers=auth, json={**cfg, **GOOD_CFG, "updated_at": "1999-01-01T00:00:00"})
    assert r.status_code == 200, r.text
    saved = client.get("/api/attendance/config", headers=auth).json()
    assert saved["grace_cutoff_time"] == "10:45"
    assert not saved["updated_at"].startswith("1999")  # server-stamped


@pytest.mark.parametrize("override", [
    {"grace_cutoff_time": "09:30"},          # before shift start
    {"late_cutoff_time": "10:30"},           # before grace
    {"shift_start_time": "25:99"},           # malformed
    {"early_logout_cutoff_time": "9am"},     # malformed
    {"early_logout_cutoff_time": "09:00"},   # before shift start
    {"penalty_type": "FIRE_THEM"},
    {"lates_threshold": 0},
    {"timezone": "Mars/Olympus"},
])
def test_attendance_config_rejects_bad_values(client, auth, override):
    cfg = client.get("/api/attendance/config", headers=auth).json()
    r = client.put("/api/attendance/config", headers=auth, json={**cfg, **GOOD_CFG, **override})
    assert r.status_code == 422, (override, r.text)


def test_time_with_seconds_is_accepted(client, auth):
    cfg = client.get("/api/attendance/config", headers=auth).json()
    r = client.put("/api/attendance/config", headers=auth, json={**cfg, **GOOD_CFG, "shift_start_time": "10:00:00"})
    assert r.status_code == 200
    assert client.get("/api/attendance/config", headers=auth).json()["shift_start_time"] == "10:00"


def test_bad_config_already_in_database_does_not_break_attendance(client, auth, store):
    rows = store.tables["attendance_settings"]
    row = next(iter(rows.values()))
    row["grace_cutoff_time"] = "25:99"  # as the old API allowed
    r = client.get("/api/attendance/config", headers=auth)
    assert r.status_code == 200 and r.json()["grace_cutoff_time"] == "09:45"
    row["grace_cutoff_time"] = "10:45"


@pytest.mark.parametrize("params", [{"month": "(("}, {"month": "2026-9"}, {"date_str": "not-a-date"}])
def test_attendance_filters_validated(client, auth, params):
    assert client.get("/api/attendance", headers=auth, params=params).status_code == 422


def test_attendance_list_by_month(client, auth):
    r = client.get("/api/attendance", headers=auth, params={"month": "2026-09"})
    assert r.status_code == 200 and "total" in r.json()


def test_punch_in_unknown_employee(client, auth):
    r = client.post("/api/attendance/punch-in", headers=auth, json={"employee_id": "nobody"})
    assert r.status_code == 400


# ---------------------------------------------------------------- leave

def apply(client, auth, emp, **over):
    body = {"employee_id": emp["employee_code"], "leave_type": "CL", "start_date": "2026-11-02",
            "end_date": "2026-11-03", "reason": "Family function"}
    body.update(over)
    return client.post("/api/leaves/apply", headers=auth, json=body)


def test_leave_validation(client, auth, emp):
    assert apply(client, auth, emp, end_date="2026-11-01").status_code == 422
    assert apply(client, auth, emp, start_date="02-11-2026").status_code == 422
    assert apply(client, auth, emp, leave_type="XX").status_code == 422
    assert apply(client, auth, emp, reason="x").status_code == 422
    assert apply(client, auth, emp, duration_type="FIRST_HALF").status_code == 422  # spans 2 days
    assert apply(client, auth, emp, employee_id="ghost").status_code == 400


def test_half_day_and_overlap(client, auth, emp):
    r = apply(client, auth, emp, start_date="2026-12-01", end_date="2026-12-01", duration_type="FIRST_HALF")
    assert r.status_code == 201 and r.json()["data"]["total_days"] == 0.5
    assert apply(client, auth, emp, start_date="2026-12-01", end_date="2026-12-02").status_code == 400


def test_pending_requests_cannot_overdraw_the_balance(client, auth):
    """Two pending 10-day CL requests against 12 days: approving both must not use 20."""
    n = next(_seq)
    e = client.post("/api/employees", headers=auth, json={
        "full_name": f"Overdraw {n}", "email": f"overdraw{n}@rexera-test.com", "mobile_number": "9811100001",
        "department": "ADMIN", "designation": "Clerk", "date_of_joining": "2026-01-01", "base_salary": 30000}).json()
    a = apply(client, auth, e, start_date="2026-10-01", end_date="2026-10-10").json()["data"]
    b = apply(client, auth, e, start_date="2026-10-20", end_date="2026-10-29").json()["data"]
    assert a["paid_leave_days"] == 10 and b["paid_leave_days"] == 10  # both looked fine when filed
    for leave in (a, b):
        r = client.post("/api/leaves/decision", headers=auth, json={"leave_request_id": leave["_id"], "action": "APPROVE"})
        assert r.status_code == 200, r.text
    second = client.post("/api/leaves/decision", headers=auth,
                         json={"leave_request_id": b["_id"], "action": "APPROVE"})
    assert second.status_code == 400  # already decided
    bal = client.get(f"/api/leaves/balances/{e['employee_code']}", headers=auth, params={"year": 2026}).json()["balances"]
    assert bal["casual_leave"]["used"] == 12
    assert bal["casual_leave"]["available"] == 0
    assert bal["loss_of_pay_days_ytd"] == 8
    leaves = client.get("/api/leaves", headers=auth).json()["data"]
    approved_b = next(x for x in leaves if x["_id"] == b["_id"])
    assert approved_b["paid_leave_days"] == 2 and approved_b["lop_days"] == 8


def test_leave_uses_the_balance_of_its_own_year(client, auth, emp):
    r = apply(client, auth, emp, start_date="2027-01-04", end_date="2027-01-05")
    assert r.status_code == 201
    lid = r.json()["data"]["_id"]
    client.post("/api/leaves/decision", headers=auth, json={"leave_request_id": lid, "action": "APPROVE"})
    bal27 = client.get(f"/api/leaves/balances/{emp['employee_code']}", headers=auth, params={"year": 2027}).json()
    assert bal27["balances"]["casual_leave"]["used"] == 2
    # Balances resolve from the record id as well as the code.
    by_id = client.get(f"/api/leaves/balances/{emp['id']}", headers=auth, params={"year": 2027}).json()
    assert by_id["balances"]["casual_leave"]["used"] == 2


def test_reject_and_approved_leave_shows_in_attendance(client, auth, emp):
    r = apply(client, auth, emp, start_date="2026-11-16", end_date="2026-11-16")
    lid = r.json()["data"]["_id"]
    ok = client.post("/api/leaves/decision", headers=auth, json={"leave_request_id": lid, "action": "APPROVE"})
    assert ok.json()["data"]["action_by_name"] == "admin"
    att = client.get("/api/attendance", headers=auth, params={"date_str": "2026-11-16", "employee_id": emp["employee_code"]}).json()
    assert att["data"][0]["status"] == "ON_LEAVE"
    r = apply(client, auth, emp, start_date="2026-11-20", end_date="2026-11-20")
    rej = client.post("/api/leaves/decision", headers=auth, json={"leave_request_id": r.json()["data"]["_id"],
                                                                  "action": "REJECT", "remarks": "Busy week"})
    assert rej.status_code == 200 and rej.json()["data"]["status"] == "REJECTED"
    assert client.post("/api/leaves/decision", headers=auth, json={"leave_request_id": "nope", "action": "APPROVE"}).status_code == 400
    assert client.post("/api/leaves/decision", headers=auth, json={"leave_request_id": lid, "action": "MAYBE"}).status_code == 422


def test_pending_dashboard(client, auth, emp):
    apply(client, auth, emp, start_date="2026-12-21", end_date="2026-12-22")
    r = client.get("/api/leaves/pending-dashboard", headers=auth)
    assert r.status_code == 200 and r.json()["count"] >= 1
    assert "balances" in r.json()["data"][0]
