"""Sales payroll: collection incentive, attendance from Start/End Day, and the sales person on invoices."""
import itertools
from datetime import date

import pytest

from app.services.sales_payroll import compute_incentive, monthly_salary, slab_percent
from tests.conftest import login
from tests.test_billing import INTRA

_seq = itertools.count(1)
SALARY = 42_000  # basic 30,000 + HRA 12,000 -> gate (x3) 1,26,000, target (x4) 1,68,000


# ---------------------------------------------------------------- pure rules
@pytest.mark.parametrize("collection, pct", [
    (0, 20), (199_999, 20), (200_000, 25), (299_999, 25), (300_000, 27.5), (400_000, 30), (500_000, 32.5),
    (600_000, 35), (700_000, 37.5), (799_999, 37.5), (800_000, 40), (2_000_000, 40),
])
def test_monthly_slabs(collection, pct):
    assert slab_percent(collection) == pct


def test_monthly_salary_is_the_standard_gross():
    assert monthly_salary({"base_salary": 30000, "hra_type": "fixed", "hra_value": 12000, "conveyance_allowance": 1000}) == 43000
    assert monthly_salary({"base_salary": 30000, "hra_type": "percentage", "hra_value": 40}) == 42000


def test_below_three_times_salary_earns_nothing():
    r = compute_incentive([("2026-10-05", 60_000), ("2026-10-13", 60_000)], SALARY)  # 1,20,000 < 1,26,000
    assert r["mode"] == "none" and r["incentive"] == 0


def test_daily_and_weekly_between_x3_and_x4():
    pays = [("2026-10-05", 60_000),   # a >= 10k day: 5% = 3,000 (that week is >= 50k too, but it is all daily money)
            ("2026-10-13", 8_000), ("2026-10-14", 45_000),  # week of Oct 12: 53,000 >= 50k, no day >= 10k... 45k is
            ("2026-10-27", 20_000)]                          # 2026-10-14 45,000 is a >= 10k day
    r = compute_incentive(pays, SALARY)  # total 1,33,000: between 1,26,000 and 1,68,000
    assert r["mode"] == "daily_weekly"
    daily = {d["date"]: d["incentive"] for d in r["days"]}
    assert daily == {"2026-10-05": 3000.0, "2026-10-14": 2250.0, "2026-10-27": 1000.0}
    # Week of Oct 12: 53,000; 45,000 already paid daily, so 5% of the remaining 8,000 = 400.
    assert r["weeks"] == [{"from": "2026-10-13", "to": "2026-10-14", "collection": 53000.0, "incentive": 400.0}]
    assert r["incentive"] == 3000 + 2250 + 1000 + 400


def test_weekly_only_when_no_single_day_qualifies():
    days = ["2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23", "2026-10-24"]
    pays = [(d, 9_000) for d in days] + [("2026-10-06", 75_000)]  # 54,000 in a week, no day >= 10k; +75,000 daily
    r = compute_incentive(pays, SALARY)  # total 1,29,000
    assert r["daily_incentive"] == 3750.0 and r["weekly_incentive"] == 2700.0 and r["incentive"] == 6450.0


def test_monthly_slab_replaces_daily_weekly_at_x4():
    r = compute_incentive([("2026-10-05", 100_000), ("2026-10-13", 70_000)], SALARY)  # 1,70,000 >= 1,68,000
    assert r["mode"] == "monthly" and r["slab_percent"] == 20.0 and r["incentive"] == 34_000 and r["days"] == []
    r = compute_incentive([("2026-10-05", 250_000)], SALARY)
    assert r["slab_percent"] == 25.0 and r["incentive"] == 62_500


def test_no_salary_no_incentive():
    assert compute_incentive([("2026-10-05", 500_000)], 0)["incentive"] == 0


# ---------------------------------------------------------------- end to end
def sales_setup(client, store, auth):
    """A sales login account plus the employee record with the same email (payroll is per employee)."""
    n = next(_seq)
    email = f"rep{n}@rexera-test.com"
    r = client.post("/api/users", headers=auth, json={"username": f"rep{n}", "email": email, "role": "sales", "password": "Passw0rd!x"})
    assert r.status_code in (200, 201), r.text
    e = client.post("/api/employees", headers=auth, json={
        "full_name": f"Sales Rep {n}", "email": email, "mobile_number": "9822200000", "department": "SALES", "designation": "BDE",
        "date_of_joining": "2026-01-01", "base_salary": 30000, "hra": 12000, "conveyance_allowance": 0, "special_allowance": 0,
        "professional_tax": 200, "pf_opted": True, "account_no": "50100492817264", "ifsc_code": "HDFC0001234"})
    assert e.status_code == 200, e.text
    return email, e.json(), login(client, store, email, "Passw0rd!x")


def collect(client, auth, email, amounts):
    """One big invoice credited to the sales person, then payments on the given dates."""
    r = client.post("/api/billing/invoices", headers=auth, json={
        "branch_key": "ahmedabad_y", "client": INTRA, "apply_gst": False, "sales_person_email": email,
        "items": [{"name": "Advisory", "quantity": 1, "unit_price": 900_000}]})
    assert r.status_code == 201, r.text
    inv = r.json()["invoice"]
    assert inv["sales_person_email"] == email
    for d, amt in amounts:
        p = client.post("/api/billing/payments", headers=auth, json={"invoice_id": inv["id"], "amount": amt, "payment_date": d})
        assert p.status_code == 201, p.text


def test_incentive_lands_on_the_payslip(client, store, auth):
    email, emp, _ = sales_setup(client, store, auth)
    collect(client, auth, email, [("2026-10-05", 60_000), ("2026-10-13", 70_000)])  # 1,30,000: daily/weekly band
    rec = client.post("/api/payroll/calculate", headers=auth, json={"employee_id": emp["id"], "month": "October", "year": 2026}).json()
    assert rec["earnings"]["incentive"] == 3000 + 3500
    assert rec["incentive_details"]["mode"] == "daily_weekly"

    collect(client, auth, email, [("2026-10-20", 50_000)])  # 1,80,000 >= target: 20% of everything
    rec = client.post("/api/payroll/calculate", headers=auth, json={"employee_id": emp["id"], "month": "October", "year": 2026}).json()
    assert rec["earnings"]["incentive"] == 36_000 and rec["incentive_details"]["slab_percent"] == 20.0

    # Another month's payments don't count, and HR can still override with an explicit amount.
    assert client.post("/api/payroll/calculate", headers=auth, json={"employee_id": emp["id"], "month": "November", "year": 2026}).json()["earnings"]["incentive"] == 0
    over = client.post("/api/payroll/calculate", headers=auth, json={"employee_id": emp["id"], "month": "October", "year": 2026, "incentive_amount": 1234}).json()
    assert over["earnings"]["incentive"] == 1234


def test_preview_endpoint_and_non_sales_staff(client, store, auth):
    email, emp, _ = sales_setup(client, store, auth)
    collect(client, auth, email, [("2026-10-05", 60_000), ("2026-10-13", 70_000)])
    p = client.get("/api/payroll/sales-preview", headers=auth, params={"employee_id": emp["id"], "month": "October", "year": 2026}).json()
    assert p["is_sales"] and p["incentive"]["incentive"] == 6500 and p["attendance"]["working_days"] == 31
    plain = client.post("/api/employees", headers=auth, json={
        "full_name": "Plain Person", "email": "plain.person@rexera-test.com", "mobile_number": "9822200000", "department": "ADMIN",
        "designation": "Exec", "date_of_joining": "2026-01-01", "base_salary": 30000, "hra": 12000, "professional_tax": 200}).json()
    p = client.get("/api/payroll/sales-preview", headers=auth, params={"employee_id": plain["id"], "month": "October", "year": 2026}).json()
    assert p == {"is_sales": False, "attendance": None, "incentive": None}
    assert client.get("/api/payroll/sales-preview", headers=auth, params={"employee_id": "nope", "month": "October", "year": 2026}).status_code == 404
    assert client.get("/api/payroll/sales-preview", headers=auth, params={"employee_id": plain["id"], "month": "Nope", "year": 2026}).status_code == 422


def test_sales_person_on_invoice(client, store, auth):
    email, _, sales_h = sales_setup(client, store, auth)
    assert email in [p["email"] for p in client.get("/api/billing/sales-people", headers=auth).json()["items"]]
    body = {"branch_key": "ahmedabad_y", "client": INTRA, "invoice_type": "proforma", "items": [{"name": "A", "quantity": 1, "unit_price": 100}]}
    mine = client.post("/api/billing/invoices", headers=sales_h, json=body)  # a sales user's own proforma is credited to them
    assert mine.status_code == 201 and mine.json()["invoice"]["sales_person_email"] == email
    bad = client.post("/api/billing/invoices", headers=auth, json={**body, "sales_person_email": "admin@rexera-test.com"})
    assert bad.status_code == 422 and "not a sales account" in bad.json()["detail"]
    none = client.post("/api/billing/invoices", headers=auth, json=body)
    assert none.json()["invoice"]["sales_person_email"] == ""
    # Only a billing manager can move the credit; a sales user cannot re-assign it.
    iid = mine.json()["invoice"]["id"]
    assert client.put(f"/api/billing/invoices/{iid}", headers=sales_h, json={"sales_person_email": ""}).json()["invoice"]["sales_person_email"] == email
    assert client.put(f"/api/billing/invoices/{iid}", headers=auth, json={"sales_person_email": ""}).json()["invoice"]["sales_person_email"] == ""


def test_start_and_end_day_mark_attendance(client, store, auth):
    email, emp, sales_h = sales_setup(client, store, auth)
    code = emp["employee_code"]
    assert client.post("/api/sales-hub/day/start", headers=sales_h).status_code == 200
    rec = next(r for r in store.tables["attendance"].values() if r["employee_id"] == code)
    assert rec["punch_in_time"] and not rec.get("punch_out_time")
    assert rec["status"] in ("PRESENT", "LATE", "HALF_DAY")
    assert client.post("/api/sales-hub/day/end", headers=sales_h).status_code == 200
    rec = next(r for r in store.tables["attendance"].values() if r["employee_id"] == code)
    assert rec["punch_out_time"] and "total_work_hours" in rec
    # Starting again (resume) or ending twice must not fail the day session.
    assert client.post("/api/sales-hub/day/start", headers=sales_h).status_code == 200
    assert client.post("/api/sales-hub/day/end", headers=sales_h).status_code == 200


def put_attendance(store, code, day, status, out=True, late=False):
    store.tables.setdefault("attendance", {})[f"{code}-{day}"] = {
        "employee_id": code, "attendance_date": day, "status": status, "is_late": late,
        "punch_in_time": f"{day}T04:00:00", "punch_out_time": f"{day}T12:30:00" if out else None}


def test_payroll_attendance_comes_from_punches(client, store, auth):
    email, emp, _ = sales_setup(client, store, auth)
    code = emp["employee_code"]
    # August 2026 (31 days, Sundays: 2, 9, 16, 23, 30). Worked Aug 3-7 (Mon-Fri) and 10-14 in various ways.
    for n in (3, 4, 5):
        put_attendance(store, code, f"2026-08-{n:02d}", "PRESENT")
    put_attendance(store, code, "2026-08-06", "LATE", late=True)
    put_attendance(store, code, "2026-08-07", "HALF_DAY")  # logged out early / arrived very late
    put_attendance(store, code, "2026-08-10", "PRESENT", out=False)  # started but never ended the day: half day
    rec = client.post("/api/payroll/calculate", headers=auth, json={"employee_id": emp["id"], "month": "August", "year": 2026}).json()
    a = rec["attendance"]
    assert rec["attendance_source"] == "start_end_day"
    assert a["working_days"] == 31 and a["half_days"] == 2 and a["late_count"] == 1
    # 4 full + 2 half days worked; 5 Sundays are paid weekly offs; the other 20 days (incl. Sat Aug 1) never started -> absent.
    assert a["absent_days"] == 20
    expected_lop = round(SALARY / 31 * (20 + 2 * 0.5), 2)  # absent days + half a day for each half day
    assert rec["deductions"]["unpaid_leave_deduction"] == pytest.approx(expected_lop, abs=0.05)

    # Explicit attendance in the request still wins over punches.
    manual = client.post("/api/payroll/calculate", headers=auth, json={"employee_id": emp["id"], "month": "August", "year": 2026, "present_days": 31}).json()
    assert manual["attendance_source"] == "manual" and manual["deductions"]["unpaid_leave_deduction"] == 0


def test_staff_without_punches_keep_a_full_month(client, auth):
    # Not imported from tests.test_payroll: pytest's own collected copy of that module and one imported
    # under the "tests." package name are different module objects with separate email counters, so
    # sharing make_employee across the two would risk reusing an email the other copy already created.
    n = next(_seq)
    emp = client.post("/api/employees", headers=auth, json={
        "full_name": f"Non-Sales Person {n}", "email": f"nonsales{n}@rexera-test.com", "mobile_number": "9822200000",
        "department": "ADMIN", "designation": "Exec", "date_of_joining": "2026-01-01", "base_salary": 30000, "hra": 12000,
        "professional_tax": 200, "pf_opted": True, "account_no": "50100492817264", "ifsc_code": "HDFC0001234"}).json()
    rec = client.post("/api/payroll/calculate", headers=auth, json={"employee_id": emp["id"], "month": "August", "year": 2026}).json()
    assert rec["attendance_source"] == "manual" and rec["deductions"]["unpaid_leave_deduction"] == 0


def test_sales_account_that_never_started_a_day_is_absent(client, store, auth):
    email, emp, _ = sales_setup(client, store, auth)  # a sales account with no punches at all this month
    rec = client.post("/api/payroll/calculate", headers=auth, json={"employee_id": emp["id"], "month": "June", "year": 2026}).json()
    assert date(2026, 6, 1).weekday() == 0  # June 2026: 30 days, 4 Sundays paid off, the other 26 absent
    assert rec["attendance"]["absent_days"] == 26 and rec["attendance_source"] == "start_end_day"
