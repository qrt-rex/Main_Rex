"""Payroll engine, workflow, advances/loans/bonuses/overtime and payslips."""
import itertools

import pytest

_seq = itertools.count(1)


def make_employee(client, auth, **over):
    n = next(_seq)
    body = {"full_name": f"Payroll Person {n}", "email": f"pay{n}@rexera-test.com", "mobile_number": "9822200000",
            "department": "SALES", "designation": "BDM", "date_of_joining": "2026-01-01",
            "base_salary": 30000, "hra": 12000, "conveyance_allowance": 0, "special_allowance": 0,
            "professional_tax": 200, "pf_opted": True, "account_no": "50100492817264", "ifsc_code": "HDFC0001234"}
    body.update(over)
    r = client.post("/api/employees", headers=auth, json=body)
    assert r.status_code == 200, r.text
    return r.json()


def calc(client, auth, emp, month="October", year=2026, **extra):
    r = client.post("/api/payroll/calculate", headers=auth,
                    json={"employee_id": emp["id"], "month": month, "year": year, **extra})
    assert r.status_code == 200, r.text
    return r.json()


def act(client, auth, pid, action, **body):
    return client.post(f"/api/payroll/record/{pid}/{action}", headers=auth, json=body or None)


# ---------------------------------------------------------------- calculator

def test_salary_calculator_maths(client, auth):
    r = client.post("/api/payroll/calculate-salary", headers=auth, json={
        "base_salary": 50000, "hra": 20000, "working_days": 30, "lop_days": 3})
    body = r.json()
    assert r.status_code == 200
    assert body["deductions"]["pf"] == 6000
    assert body["deductions"]["lop_deduction"] == 7000  # 70000 / 30 * 3
    assert body["net_salary"] == 70000 - 6000 - 200 - 7000


@pytest.mark.parametrize("body", [{"base_salary": -1}, {"base_salary": 1000, "lop_days": 31, "working_days": 30},
                                  {"base_salary": 1000, "working_days": 0}, {"base_salary": 1000, "hra": -5}])
def test_salary_calculator_rejects_invalid(client, auth, body):
    assert client.post("/api/payroll/calculate-salary", headers=auth, json=body).status_code == 422


@pytest.mark.parametrize("extra", [{"month": "Octember"}, {"unpaid_leave_days": 40}, {"working_days": 0},
                                   {"overtime_hours": -1}, {"year": 1999}])
def test_payroll_calculation_rejects_invalid(client, auth, extra):
    emp = make_employee(client, auth)
    body = {"employee_id": emp["id"], "month": "October", "year": 2026, **extra}
    assert client.post("/api/payroll/calculate", headers=auth, json=body).status_code == 422


def test_month_name_is_normalised(client, auth):
    emp = make_employee(client, auth)
    rec = calc(client, auth, emp, month="october")
    assert rec["month"] == "October"


# ---------------------------------------------------------------- overtime / bonus / advance / loan inputs

def test_overtime_is_paid_only_in_its_own_month(client, auth):
    emp = make_employee(client, auth)
    ot = client.post("/api/overtime", headers=auth, json={"employee_id": emp["id"], "date": "2026-10-10",
                                                           "hours": 4, "rate_per_hour": 100})
    assert ot.status_code == 200, ot.text
    assert calc(client, auth, emp, month="October")["earnings"]["overtime_pay"] == 400
    # Previously the same entry was paid again in every later month.
    assert calc(client, auth, emp, month="November")["earnings"]["overtime_pay"] == 0


def test_overtime_validation(client, auth):
    emp = make_employee(client, auth)
    post = lambda **b: client.post("/api/overtime", headers=auth, json={"employee_id": emp["id"], "date": "2026-10-11", "hours": 2, **b})
    assert post(hours=30).status_code == 422
    assert post(date="31/12/2026").status_code == 422
    assert post(hours=0).status_code == 422
    assert post(employee_id="ghost").status_code == 404
    assert post(hours=20).status_code == 200
    assert post(hours=5).status_code == 400  # 25 hours on one day


def test_bonus_validation_and_payroll(client, auth):
    emp = make_employee(client, auth)
    post = lambda **b: client.post("/api/bonuses", headers=auth, json={"employee_id": emp["id"], "amount": 5000,
                                                                       "reason": "Target hit", "month": "October", "year": 2026, **b})
    assert post(month="Smarch").status_code == 422
    assert post(amount=-1).status_code == 422
    assert post(reason=" ").status_code == 422
    assert post(month="october").status_code == 200
    assert calc(client, auth, emp, month="October")["earnings"]["bonus"] == 5000
    assert calc(client, auth, emp, month="November")["earnings"]["bonus"] == 0


def test_advance_rules(client, auth):
    emp = make_employee(client, auth)
    post = lambda **b: client.post("/api/advances", headers=auth, json={
        "employee_id": emp["id"], "advance_amount": 20000, "monthly_deduction_amount": 5000,
        "start_month": "December", "start_year": 2026, "reason": "Medical", **b})
    assert post(monthly_deduction_amount=25000).status_code == 422
    assert post(start_month="Decembruary").status_code == 422
    assert post(advance_amount=42000 * 13, monthly_deduction_amount=5000).status_code == 400  # > 12 months' gross
    assert post(employee_id="ghost").status_code == 404
    adv = post()
    assert adv.status_code == 200, adv.text
    # Recovery starts in December, not immediately.
    assert calc(client, auth, emp, month="November")["deductions"]["salary_advance_deduction"] == 0
    assert calc(client, auth, emp, month="December")["deductions"]["salary_advance_deduction"] == 5000


def test_loan_rules(client, auth):
    emp = make_employee(client, auth)
    post = lambda **b: client.post("/api/loans", headers=auth, json={
        "employee_id": emp["id"], "principal_amount": 10000, "interest_rate_percent": 10,
        "monthly_emi": 1100, "start_date": "2026-12-01", **b})
    assert post(monthly_emi=12000).status_code == 422  # > 11,000 total payable
    assert post(start_date="Dec 2026").status_code == 422
    assert post(interest_rate_percent=500).status_code == 422
    loan = post()
    assert loan.status_code == 200 and loan.json()["total_payable"] == 11000
    assert calc(client, auth, emp, month="November")["deductions"]["loan_deduction"] == 0
    assert calc(client, auth, emp, month="December")["deductions"]["loan_deduction"] == 1100


def test_other_deductions_reach_the_payslip(client, auth):
    emp = make_employee(client, auth)
    rec = calc(client, auth, emp, other_deductions=750, other_earnings=250)
    assert rec["deductions"]["other_deductions"] == 750
    assert rec["earnings"]["other_earnings"] == 250


# ---------------------------------------------------------------- workflow

def test_finalize_unlock_refinalize_recovers_once(client, auth):
    emp = make_employee(client, auth)
    adv = client.post("/api/advances", headers=auth, json={
        "employee_id": emp["id"], "advance_amount": 10000, "monthly_deduction_amount": 2000,
        "start_month": "January", "start_year": 2026, "reason": "Rent deposit"}).json()
    rec = calc(client, auth, emp, month="October")
    pid = rec["id"]
    assert act(client, auth, pid, "finalize").status_code == 200
    bal = lambda: next(a for a in client.get("/api/advances", headers=auth).json() if a["advance_id"] == adv["advance_id"])
    assert bal()["remaining_balance"] == 8000
    assert act(client, auth, pid, "unlock", reason="Fixing overtime").status_code == 200
    assert bal()["remaining_balance"] == 10000  # recovery given back while under review
    assert act(client, auth, pid, "finalize").status_code == 200
    assert bal()["remaining_balance"] == 8000  # not 6000
    # Finalizing an already locked record is a no-op.
    assert act(client, auth, pid, "finalize").status_code == 200
    assert bal()["remaining_balance"] == 8000


def test_workflow_state_rules(client, auth):
    emp = make_employee(client, auth)
    pid = calc(client, auth, emp, month="October")["id"]
    assert act(client, auth, pid, "unlock", reason="Nothing to unlock").status_code == 400
    assert act(client, auth, pid, "approve").status_code == 200
    assert act(client, auth, pid, "finalize").status_code == 200
    assert act(client, auth, pid, "approve").status_code == 400  # locked
    assert client.put(f"/api/payroll/record/{pid}", headers=auth, json={"bonus": 100}).status_code == 400
    r = client.post("/api/payroll/calculate", headers=auth, json={"employee_id": emp["id"], "month": "October", "year": 2026})
    assert r.status_code == 400
    assert act(client, auth, pid, "unlock", reason="bad").status_code == 422  # reason too short


def test_mark_paid_finalizes_first(client, auth):
    """Paying a CALCULATED payroll used to skip advance recovery and the payslip."""
    emp = make_employee(client, auth)
    client.post("/api/advances", headers=auth, json={
        "employee_id": emp["id"], "advance_amount": 6000, "monthly_deduction_amount": 3000,
        "start_month": "January", "start_year": 2026, "reason": "Travel"})
    pid = calc(client, auth, emp, month="October")["id"]
    r = act(client, auth, pid, "mark-paid", payment_reference="UTR123")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] == "PAID" and body["is_locked"] and body["payslip_generated"]
    advs = [a for a in client.get("/api/advances", headers=auth).json() if a["employee_id"] == emp["id"]]
    assert advs[0]["remaining_balance"] == 3000
    assert act(client, auth, pid, "mark-paid").json()["payment_reference"] == "UTR123"  # idempotent


def test_edit_payroll_validation(client, auth):
    emp = make_employee(client, auth)
    pid = calc(client, auth, emp, month="October")["id"]
    assert client.put(f"/api/payroll/record/{pid}", headers=auth, json={"bonus": -500}).status_code == 422
    r = client.put(f"/api/payroll/record/{pid}", headers=auth, json={"bonus": 500})
    assert r.status_code == 200 and r.json()["earnings"]["bonus"] == 500 and r.json()["status"] == "UNDER_REVIEW"


def test_salary_changes_reach_payroll(client, auth):
    """Payroll read a salary structure frozen at the first run; edits and adjustments were ignored."""
    emp = make_employee(client, auth)
    assert calc(client, auth, emp, month="October")["earnings"]["basic"] == 30000
    client.put(f"/api/employees/{emp['id']}", headers=auth, json={"base_salary": 35000, "hra": 14000})
    rec = calc(client, auth, emp, month="November")
    assert rec["earnings"]["basic"] == 35000 and rec["earnings"]["hra"] == 14000
    r = client.post("/api/payroll/adjust-salary", headers=auth, json={
        "employee_id": emp["id"], "adjustment_type": "increment", "field": "base_salary", "amount": 5000,
        "reason": "Annual increment"})
    assert r.status_code == 200, r.text
    assert calc(client, auth, emp, month="December")["earnings"]["basic"] == 40000
    bad = client.post("/api/payroll/adjust-salary", headers=auth, json={
        "employee_id": emp["id"], "adjustment_type": "sideways", "field": "base_salary", "amount": 1, "reason": "xxx"})
    assert bad.status_code == 422


def test_bank_export_only_includes_signed_off_payroll(client, auth):
    a, b = make_employee(client, auth), make_employee(client, auth)
    calc(client, auth, a, month="March", year=2027)
    pid = calc(client, auth, b, month="March", year=2027)["id"]
    act(client, auth, pid, "finalize")
    rows = client.get("/api/payroll/bank-export", headers=auth, params={"month": "March", "year": 2027}).json()["records"]
    assert [r["employee_code"] for r in rows] == [b["employee_code"]]


def test_bulk_run_and_legacy_endpoints(client, auth):
    make_employee(client, auth)
    r = client.post("/api/payroll/calculate-bulk", headers=auth, json={"month": "April", "year": 2027})
    assert r.status_code == 200 and r.json()["successful_count"] >= 1
    assert client.post("/api/payroll/calculate-bulk", headers=auth, json={"month": "Nope", "year": 2027}).status_code == 422
    r = client.post("/api/payroll/batch-run", headers=auth, json={"month": "May", "year": 2027})
    assert r.status_code == 200 and "message" in r.json()
    assert client.get("/api/payroll/summary", headers=auth, params={"month": "May", "year": 2027}).status_code == 200
    assert client.get("/api/payroll/dashboard-metrics", headers=auth, params={"month": "May", "year": 2027}).status_code == 200


def test_generate_slip_with_half_day_lop(client, auth):
    emp = make_employee(client, auth)
    r = client.post("/api/payroll/generate-slip", headers=auth, json={
        "employee_id": emp["id"], "month": "June", "year": 2027, "working_days": 30, "paid_days": 28.5,
        "lop_days": 1.5, "other_deductions": 300})
    assert r.status_code == 200, r.text
    slip = r.json()
    assert slip["lop_days"] == 1.5
    assert slip["deductions"]["other_deductions"] >= 300
    slips = client.get("/api/payroll/slips", headers=auth, params={"month": "June", "year": 2027}).json()
    assert slips["total"] >= 1


def test_printable_payslip_escapes_markup(client, auth):
    emp = make_employee(client, auth, full_name='<img src=x onerror="alert(1)">', designation="<b>Boss</b>")
    pid = calc(client, auth, emp, month="July", year=2027)["id"]
    html = client.get(f"/api/payroll/slip/{pid}/printable", headers=auth).text
    assert "<img src=x" not in html and "&lt;img src=x" in html
    assert "<b>Boss</b>" not in html
    assert client.get(f"/api/payroll/slip/{pid}/printable").status_code == 401


def test_annual_statement_and_delete_rules(client, auth):
    emp = make_employee(client, auth)
    pid = calc(client, auth, emp, month="August", year=2027)["id"]
    st = client.get(f"/api/payroll/statement/{emp['id']}/2027", headers=auth).json()
    assert st["months"][0]["month"] == "August"
    act(client, auth, pid, "finalize")
    assert client.delete(f"/api/payroll/slip/{pid}", headers=auth).status_code == 400


def test_send_payslip_email(client, auth, outbox):
    emp = make_employee(client, auth, full_name="Mail <script>x</script> Person")
    pid = calc(client, auth, emp, month="September", year=2027)["id"]
    r = client.post(f"/api/payroll/record/{pid}/send-email", headers=auth)
    assert r.status_code == 200 and r.json()["success"]
    mail = outbox.last_to(emp["email"])
    assert mail and "<script>x</script>" not in mail["html"]
    r = client.post("/api/payroll/send-bulk-email", headers=auth, json=[pid, "missing"])
    assert r.json()["sent_count"] == 1 and r.json()["failed_count"] == 1
