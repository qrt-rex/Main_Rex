"""Leave approval routing (sales -> HR, HR -> Admin, Admin -> Super Admin) and attendance date ranges."""
import itertools

from tests.conftest import login

_seq = itertools.count(1)
DAYS = itertools.count(1)


def person(client, store, auth, role):
    """A login account plus the employee record with the same email; returns (email, employee, auth header)."""
    n = next(_seq)
    email = f"lv{role}{n}@rexera-test.com"
    r = client.post("/api/users", headers=auth, json={"username": f"lv{role}{n}", "email": email, "role": role, "password": "Passw0rd!x"})
    assert r.status_code in (200, 201), r.text
    e = client.post("/api/employees", headers=auth, json={
        "full_name": f"Leave {role} {n}", "email": email, "mobile_number": "9822200000", "department": "SALES", "designation": "Exec",
        "date_of_joining": "2026-01-01", "base_salary": 30000, "hra": 12000, "professional_tax": 200})
    assert e.status_code == 200, e.text
    return email, e.json(), login(client, store, email, "Passw0rd!x")


def own_leave(client, h):
    d = f"2027-03-{next(DAYS):02d}"  # one distinct day per request so requests never overlap
    return client.post("/api/leaves/apply-own", headers=h, json={"leave_type": "CL", "start_date": d, "end_date": d, "reason": "Family function"})


def decide(client, h, leave_id, action="APPROVE"):
    return client.post("/api/leaves/decision", headers=h, json={"leave_request_id": leave_id, "action": action, "remarks": "ok"})


def test_sales_leave_goes_to_hr(client, store, auth):
    _, _, sales = person(client, store, auth, "sales")
    _, _, hr = person(client, store, auth, "hr")
    r = own_leave(client, sales)
    assert r.status_code == 201, r.text
    leave = r.json()["data"]
    assert leave["approval_level"] == "HR" and leave["applicant_role"] == "sales" and "HR" in r.json()["message"]
    lid = leave["id"]
    # Sales can't approve (no permission), sees only their own requests and none to decide.
    assert decide(client, sales, lid).status_code == 403
    assert [x["id"] for x in client.get("/api/leaves", headers=sales).json()["data"]] == [lid]
    assert client.get("/api/leaves/pending-dashboard", headers=sales).json()["data"] == []
    # HR sees it in the queue and approves it; attendance is marked on leave.
    assert lid in [x["id"] for x in client.get("/api/leaves/pending-dashboard", headers=hr).json()["data"]]
    ok = decide(client, hr, lid)
    assert ok.status_code == 200 and ok.json()["data"]["status"] == "APPROVED"


def test_hr_leave_goes_to_admin_and_admin_leave_to_superadmin(client, store, auth):
    _, _, hr = person(client, store, auth, "hr")
    _, _, admin = person(client, store, auth, "admin")
    _, _, other_hr = person(client, store, auth, "hr")

    hr_leave = own_leave(client, hr).json()["data"]
    assert hr_leave["approval_level"] == "ADMIN"
    assert hr_leave["id"] not in [x["id"] for x in client.get("/api/leaves/pending-dashboard", headers=hr).json()["data"]]  # not their queue
    for h in (hr, other_hr):  # neither their own nor another HR can decide an HR leave
        r = decide(client, h, hr_leave["id"])
        assert r.status_code == 400 and "Admin" in r.json()["detail"], r.text
    assert hr_leave["id"] in [x["id"] for x in client.get("/api/leaves/pending-dashboard", headers=admin).json()["data"]]
    assert decide(client, admin, hr_leave["id"]).json()["data"]["status"] == "APPROVED"

    admin_leave = own_leave(client, admin).json()["data"]
    assert admin_leave["approval_level"] == "SUPERADMIN"
    r = decide(client, admin, admin_leave["id"])  # an admin can't approve their own (or another admin's) leave
    assert r.status_code == 400 and "Super Admin" in r.json()["detail"]
    assert decide(client, hr, admin_leave["id"]).status_code == 400
    assert decide(client, auth, admin_leave["id"]).json()["data"]["status"] == "APPROVED"


def test_admin_can_also_decide_hr_level_requests(client, store, auth):
    _, _, sales = person(client, store, auth, "sales")
    _, _, admin = person(client, store, auth, "admin")
    lid = own_leave(client, sales).json()["data"]["id"]
    assert decide(client, admin, lid, "REJECT").json()["data"]["status"] == "REJECTED"


def test_own_leave_needs_an_employee_record_and_balances_are_own(client, store, auth):
    email = f"noemp{next(_seq)}@rexera-test.com"
    client.post("/api/users", headers=auth, json={"username": email.split("@")[0], "email": email, "role": "sales", "password": "Passw0rd!x"})
    h = login(client, store, email, "Passw0rd!x")
    assert own_leave(client, h).status_code == 400
    _, emp, sales = person(client, store, auth, "sales")
    b = client.get("/api/leaves/balances/me", headers=sales)
    assert b.status_code == 200 and b.json()["employee_id"] == emp["employee_code"]
    # A user who can't approve can't read someone else's balances by id.
    assert client.get(f"/api/leaves/balances/{emp['employee_code']}-other", headers=sales).json()["employee_id"] == emp["employee_code"]


def att(store, code, day, status, hours=8.0, name="Range Person"):
    store.tables.setdefault("attendance", {})[f"{code}-{day}"] = {
        "employee_id": code, "employee_name": name, "department": "SALES", "attendance_date": day, "status": status, "total_work_hours": hours}


def test_attendance_ranges_and_counts(client, store, auth):
    for day, status in (("2026-11-02", "PRESENT"), ("2026-11-03", "LATE"), ("2026-11-04", "HALF_DAY"), ("2026-11-05", "ABSENT"),
                        ("2026-11-06", "ON_LEAVE"), ("2026-11-09", "PRESENT")):
        att(store, "RNG-1", day, status)
    att(store, "RNG-2", "2026-11-03", "PRESENT", name="Second Person")

    r = client.get("/api/attendance", headers=auth, params={"date_from": "2026-11-02", "date_to": "2026-11-06"}).json()
    s = r["summary"]
    assert s["records"] == 6 and s["employees"] == 2
    assert s["totals"]["PRESENT"] == 2 and s["totals"]["LATE"] == 1 and s["totals"]["HALF_DAY"] == 1
    assert s["totals"]["ABSENT"] == 1 and s["totals"]["ON_LEAVE"] == 1
    one = next(p for p in s["by_employee"] if p["employee_id"] == "RNG-1")
    assert one["PRESENT"] == 1 and one["LATE"] == 1 and one["hours"] == 40.0

    day = client.get("/api/attendance", headers=auth, params={"date_from": "2026-11-03", "date_to": "2026-11-03"}).json()
    assert day["summary"]["records"] == 2
    assert client.get("/api/attendance", headers=auth, params={"date_from": "2026-11-09"}).json()["summary"]["totals"]["PRESENT"] >= 1
    assert client.get("/api/attendance", headers=auth, params={"date_from": "2026-11-09", "date_to": "2026-11-02"}).status_code == 422
    assert client.get("/api/attendance", headers=auth, params={"date_from": "nope"}).status_code == 422
    # The older single-day and month filters still work.
    assert client.get("/api/attendance", headers=auth, params={"date_str": "2026-11-05"}).json()["summary"]["totals"]["ABSENT"] == 1
    assert client.get("/api/attendance", headers=auth, params={"month": "2026-11", "employee_id": "RNG-1"}).json()["summary"]["records"] == 6
