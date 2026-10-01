"""
PF / EPF end to end through the API: configuration, employee PF details, payroll, payslip, history protection,
RBAC, audit, notifications, dashboard and reports. Tests share one database and run in file order.
"""

SUPER, HR = "superadmin@rexera.co.in", "hr@rexera.co.in"
PW = "Pf@Test2026"
STATE: dict = {}


def employee(n: int, basic: float, **extra) -> dict:
    return {"full_name": f"PF Tester {n}", "email": f"pf.tester{n}@rexera.co.in", "mobile_number": f"98765432{n:02d}",
            "department": "SALES" if n % 2 else "HR/ADMIN", "designation": "Executive", "date_of_joining": "2026-01-05",
            "base_salary": basic, "hra": 0, "conveyance_allowance": 0, "special_allowance": 0, "password": PW, **extra}


def payroll(api, emp_key, month="October", year=2026, user=HR):
    r = api.as_(user).post("/api/payroll/calculate", json={
        "employee_id": STATE[emp_key], "month": month, "year": year, "working_days": 30, "present_days": 30})
    assert r.status_code == 200, r.text
    return r.json()


# --- Add employee: password is mandatory ---------------------------------------------------------
def test_add_employee_requires_a_strong_password(api):
    hr = api.as_(HR)
    body = employee(1, 10000)
    r = hr.post("/api/employees", json={k: v for k, v in body.items() if k != "password"})
    assert r.status_code == 422 and "password" in r.text.lower()
    r = hr.post("/api/employees", json={**body, "password": "weakpass"})
    assert r.status_code == 422 and "Password must contain" in r.text
    for key, n, basic in (("low", 1, 10000), ("mid", 2, 20000), ("high", 3, 40000), ("exempt", 4, 30000)):
        r = hr.post("/api/employees", json=employee(n, basic))
        assert r.status_code == 200, r.text
        STATE[key] = r.json()["id"]
    # each new employee can sign in with that password
    assert api.token_for("pf.tester1@rexera.co.in")


# --- Configuration -------------------------------------------------------------------------------
def test_seeded_rules_are_configuration_not_constants(api):
    cfg = api.as_(HR).get("/api/pf/config").json()
    cur = cfg["current_rule"]
    assert (cur["minimum_pf_wage"], cur["maximum_pf_wage"], cur["employee_contribution_percent"],
            cur["employer_contribution_percent"], cur["eps_percent"]) == (14000, 25000, 12, 12, 8.33)
    assert cur["effective_from"] == "2026-09-17" and cfg["settings"]["enabled"] is True
    assert any(r["rule_name"] == "PF Rule 2026 - Previous" and r["maximum_pf_wage"] == 15000 for r in cfg["rules"])
    STATE["current_rule"] = cur["id"]


def test_only_superadmin_configures_rules_and_bad_rules_are_refused(api):
    rule = {"rule_name": "Bad", "minimum_pf_wage": 14000, "maximum_pf_wage": 25000, "employee_contribution_percent": 12,
            "employer_contribution_percent": 12, "eps_percent": 8.33, "effective_from": "2026-12-01"}
    assert api.as_(HR).post("/api/pf/rules", json=rule).status_code == 403
    sa = api.as_(SUPER)
    assert sa.post("/api/pf/rules", json={**rule, "eps_percent": 13}).status_code == 422          # EPS > employer
    assert sa.post("/api/pf/rules", json={**rule, "employee_contribution_percent": 0}).status_code == 422
    assert sa.post("/api/pf/rules", json={**rule, "minimum_pf_wage": 30000}).status_code == 422   # min > max
    assert sa.post("/api/pf/rules", json={**rule, "effective_to": "2026-11-01"}).status_code == 422  # to < from
    overlap = sa.post("/api/pf/rules", json={**rule, "close_previous": False})
    assert overlap.status_code == 409 and "overlap" in overlap.text


def test_calculate_preview(api):
    r = api.as_(HR).post("/api/pf/calculate", json={"basic_salary": 40000}).json()
    assert (r["pf_wage"], r["employee_pf"], r["employer_pf"], r["eps"], r["employer_epf"]) == (25000, 3000, 3000, 2082.5, 917.5)
    assert r["minimum_pf_wage"] == 14000 and r["maximum_pf_wage"] == 25000


# --- Employee PF details -------------------------------------------------------------------------
def test_employee_pf_details_validation(api):
    hr = api.as_(HR)
    assert hr.put(f"/api/employees/{STATE['low']}/pf", json={"uan": "12345678901"}).status_code == 422
    assert hr.put(f"/api/employees/{STATE['low']}/pf", json={"pf_member_id": "bad id!"}).status_code == 422
    r = hr.put(f"/api/employees/{STATE['low']}/pf", json={"uan": "100200300400", "pf_member_id": "MHBAN00000640000000125",
                                                         "pf_joining_date": "2026-10-01", "reason": "Joined PF"})
    assert r.status_code == 200 and r.json()["calculation"]["pf_wage"] == 14000
    dup = hr.put(f"/api/employees/{STATE['mid']}/pf", json={"uan": "100200300400"})
    assert dup.status_code == 409 and "already belongs" in dup.text
    no_reason = hr.put(f"/api/employees/{STATE['exempt']}/pf", json={"pf_applicable": False})
    assert no_reason.status_code == 422 and "exemption reason" in no_reason.text
    ex = hr.put(f"/api/employees/{STATE['exempt']}/pf", json={"pf_applicable": False, "exemption_reason": "Excluded employee (international worker)"})
    assert ex.status_code == 200 and ex.json()["calculation"]["status"] == "EXEMPT"


def test_employee_reads_only_their_own_pf(api):
    me = api.as_("pf.tester1@rexera.co.in")
    own = me.get("/api/pf/me")
    assert own.status_code == 200 and own.json()["employee"]["id"] == STATE["low"]
    assert own.json()["calculation"]["employee_pf"] == 1680
    assert me.get(f"/api/employees/{STATE['mid']}/pf").status_code == 403
    assert me.get(f"/api/employees/{STATE['low']}/pf").status_code == 403    # even their own id: only /api/pf/me
    assert me.put(f"/api/employees/{STATE['low']}/pf", json={"uan": "999999999999"}).status_code == 403
    for url in ("/api/pf/dashboard", "/api/pf/employees", "/api/pf/payroll", "/api/pf/reports", "/api/pf/audit-logs", "/api/pf/config"):
        assert me.get(url).status_code == 403, url
    assert me.post("/api/pf/calculate", json={"basic_salary": 1}).status_code == 403


# --- Payroll integration -------------------------------------------------------------------------
def test_payroll_calculates_pf_with_the_engine(api):
    high = payroll(api, "high")
    assert high["deductions"]["pf"] == 3000
    pf = high["pf"]
    assert (pf["basic_salary"], pf["pf_wage"], pf["employer_pf"], pf["eps"], pf["employer_epf"]) == (40000, 25000, 3000, 2082.5, 917.5)
    assert pf["rule_id"] == STATE["current_rule"] and high["ctc"] == 43000
    STATE["high_payroll"] = high["id"]
    low = payroll(api, "low")
    assert low["deductions"]["pf"] == 1680 and low["pf"]["wage_limited_by"] == "minimum"
    assert payroll(api, "exempt")["deductions"]["pf"] == 0


def test_pf_cannot_be_typed_into_payroll_and_basic_edits_rerun_the_engine(api):
    hr = api.as_(HR)
    r = hr.put(f"/api/payroll/record/{STATE['high_payroll']}", json={"pf": 100})
    assert r.status_code == 400 and "PF" in r.text
    r = hr.put(f"/api/payroll/record/{STATE['high_payroll']}", json={"basic": 20000})
    assert r.status_code == 200 and r.json()["deductions"]["pf"] == 2400 and r.json()["pf"]["pf_wage"] == 20000
    # The payroll edit form sends every field back: an unchanged PF and basic must save, and PF stays as the engine set it
    r = hr.put(f"/api/payroll/record/{STATE['high_payroll']}", json={"basic": 20000, "da": 0, "pf": 2400, "hra": 5000, "remarks": "HRA fix"})
    assert r.status_code == 200, r.text
    assert r.json()["deductions"]["pf"] == 2400 and r.json()["earnings"]["hra"] == 5000 and r.json()["pf"]["pf_wage"] == 20000
    payroll(api, "high")  # recalculate back to the employee's real basic


def test_deleting_open_payroll_removes_its_pf_transaction(api):
    hr = api.as_(HR)
    rec = payroll(api, "low", month="August")

    async def txs():
        from app.database import get_collection
        return await get_collection("payroll_pf_transactions").find({"payroll_id": rec["id"]}).to_list(10)
    assert len(api.run(txs)) == 1
    assert hr.delete(f"/api/payroll/slip/{rec['id']}").status_code == 200
    assert api.run(txs) == []


def test_finalize_blocked_until_pf_information_is_complete(api):
    hr, sa = api.as_(HR), api.as_(SUPER)
    r = hr.post("/api/employees", json=employee(5, 18000))
    STATE["legacy"] = r.json()["id"]
    hr.put(f"/api/employees/{STATE['legacy']}", json={"pf_opted": False})  # PF switched off with no reason recorded
    rec = payroll(api, "legacy")
    assert rec["pf"]["status"] == "ERROR"
    blocked = hr.post(f"/api/payroll/record/{rec['id']}/finalize")
    assert blocked.status_code == 400 and "exemption reason" in blocked.text
    hr.put(f"/api/employees/{STATE['legacy']}/pf", json={"pf_applicable": False, "exemption_reason": "Voluntary opt-out (Para 26A)"})
    rec = payroll(api, "legacy")
    assert hr.post(f"/api/payroll/record/{rec['id']}/finalize").status_code == 200

    # UAN required by configuration: the mid employee has none
    sa.put("/api/pf/settings", json={"require_uan_to_finalize": True, "reason": "Audit"})
    mid = payroll(api, "mid")
    blocked = hr.post(f"/api/payroll/record/{mid['id']}/finalize")
    assert blocked.status_code == 400 and "UAN is missing" in blocked.text
    sa.put("/api/pf/settings", json={"require_uan_to_finalize": False, "reason": "Back to default"})


def test_finalized_payroll_is_never_recalculated_by_a_rule_change(api):
    hr, sa = api.as_(HR), api.as_(SUPER)
    fin = hr.post(f"/api/payroll/record/{STATE['high_payroll']}/finalize")
    assert fin.status_code == 200 and fin.json()["status"] == "FINALIZED"

    # The rule used by finalized payroll can't have its wages or rates changed, nor end before that payroll.
    locked = sa.put(f"/api/pf/rules/{STATE['current_rule']}", json={"maximum_pf_wage": 30000, "reason": "try"})
    assert locked.status_code == 409 and "new effective-dated rule" in locked.text
    assert sa.put(f"/api/pf/rules/{STATE['current_rule']}", json={"effective_to": "2026-10-15"}).status_code == 409
    assert sa.post("/api/pf/rules", json={"rule_name": "Too early", "minimum_pf_wage": 14000, "maximum_pf_wage": 30000,
                                          "employee_contribution_percent": 12, "employer_contribution_percent": 12,
                                          "eps_percent": 8.33, "effective_from": "2026-10-15"}).status_code == 409
    assert sa.put(f"/api/pf/rules/{STATE['current_rule']}", json={"rule_name": "PF Rule 2026 - Sept/Oct"}).status_code == 200

    # A new rule from November closes the current one the day before; October stays as calculated.
    new = sa.post("/api/pf/rules", json={"rule_name": "Rule B", "minimum_pf_wage": 15000, "maximum_pf_wage": 30000,
                                         "employee_contribution_percent": 12, "employer_contribution_percent": 12,
                                         "eps_percent": 8.33, "effective_from": "2026-11-01", "reason": "Ceiling raised"})
    assert new.status_code == 201, new.text
    STATE["rule_b"] = new.json()["id"]
    rules = {r["id"]: r for r in sa.get("/api/pf/config").json()["rules"]}
    assert rules[STATE["current_rule"]]["effective_to"] == "2026-10-31"

    oct_rec = hr.get(f"/api/payroll/record/{STATE['high_payroll']}").json()
    assert oct_rec["deductions"]["pf"] == 3000 and oct_rec["pf"]["pf_wage"] == 25000
    assert hr.post("/api/payroll/calculate", json={"employee_id": STATE["high"], "month": "October", "year": 2026}).status_code == 400

    slip = api.as_("pf.tester3@rexera.co.in").get(f"/api/payroll/slip/{oct_rec['payslip_id']}/printable")
    assert slip.status_code == 200 and "PF Wage" in slip.text and "₹25,000.00" in slip.text and "Employer EPF" in slip.text
    assert "₹917.50" in slip.text

    nov = payroll(api, "high", month="November")
    assert nov["deductions"]["pf"] == 3600 and nov["pf"]["rule_id"] == STATE["rule_b"]
    assert payroll(api, "low", month="November")["pf"]["pf_wage"] == 15000

    # someone else's payslip reads as not found for an employee
    assert api.as_("pf.tester1@rexera.co.in").get(f"/api/payroll/slip/{oct_rec['payslip_id']}/printable").status_code == 404


def test_salary_change_recalculates_audits_and_notifies(api):
    hr = api.as_(HR)
    r = hr.put(f"/api/employees/{STATE['low']}", json={"base_salary": 15000})
    assert r.status_code == 200
    logs = hr.get(f"/api/pf/audit-logs?employee_id={STATE['low']}").json()["rows"]
    wage = [l for l in logs if l["field_name"] == "PF Wage"]
    assert wage and (wage[0]["old_value"], wage[0]["new_value"]) == (14000, 15000)
    assert any(l["field_name"] == "UAN" and l["new_value"] == "100200300400" for l in logs)
    assert all(l["changed_by"] for l in logs)
    bell = api.as_("pf.tester1@rexera.co.in").get("/api/notifications").json()["items"]
    assert any("PF contribution status has been updated" in i["title"] for i in bell)
    hr_bell = hr.get("/api/notifications").json()["items"]
    assert any("PF-exempt" in i["title"] for i in hr_bell)


def test_audit_log_is_read_only(api):
    sa = api.as_(SUPER)
    assert sa.get("/api/pf/audit-logs").status_code == 200
    assert sa.delete("/api/pf/audit-logs").status_code in (403, 405)
    assert sa.put("/api/pf/audit-logs", json={}).status_code in (403, 405)


# --- Dashboard, lists and reports ----------------------------------------------------------------
def test_dashboard_and_employee_list(api):
    hr = api.as_(HR)
    d = hr.get("/api/pf/dashboard?month=October&year=2026").json()["metrics"]
    assert d["pf_covered"] >= 3 and d["pf_exempt"] >= 2 and d["missing_uan"] >= 1
    assert d["monthly_liability"] == round(d["total_employee_pf"] + d["total_employer_pf"], 2)
    assert d["total_employer_pf"] == round(d["total_eps"] + d["total_employer_epf"], 2)
    rows = hr.get("/api/pf/employees?month=October&year=2026").json()["rows"]
    high = next(r for r in rows if r["employee_id"] == STATE["high"])
    assert (high["basic_salary"], high["pf_wage"], high["employee_pf"], high["source"]) == (40000, 25000, 3000, "payroll")
    only_exempt = hr.get("/api/pf/employees?pf_status=EXEMPT").json()["rows"]
    assert only_exempt and all(r["pf_status"] == "EXEMPT" for r in only_exempt)


def test_reports(api):
    hr = api.as_(HR)
    monthly = hr.get("/api/pf/reports?kind=monthly&start=2026-10&end=2026-10").json()
    row = next(r for r in monthly["rows"] if r["employee_id"] == STATE["high"])
    assert (row["pf_wage"], row["employee_pf"], row["employer_pf"], row["eps"], row["employer_epf"], row["total_contribution"]) == \
        (25000, 3000, 3000, 2082.5, 917.5, 6000)
    dept = hr.get("/api/pf/reports?kind=department&start=2026-10&end=2026-11").json()
    assert {g["department"] for g in dept["rows"]} >= {"SALES"}
    hist = hr.get(f"/api/pf/reports?kind=history&employee_id={STATE['high']}").json()["rows"]
    assert [h["calculation_date"] for h in hist] == ["2026-10-31", "2026-11-30"] and [h["employee_pf"] for h in hist] == [3000, 3600]
    assert hr.get("/api/pf/reports?kind=history").status_code == 422
    impact = hr.get(f"/api/pf/reports?kind=impact&rule_id={STATE['rule_b']}").json()
    assert any(r["employee_id"] == STATE["high"] and r["new_employee_pf"] == 3600 and r["previous_employee_pf"] == 3000 for r in impact["rows"])
    exc = hr.get("/api/pf/reports?kind=exceptions").json()
    codes = {(r["employee_id"], r["exception"]) for r in exc["rows"]}
    assert (STATE["mid"], "MISSING_UAN") in codes and (STATE["exempt"], "EXEMPT") in codes
    assert hr.get("/api/pf/reports?kind=monthly&start=2026-13").status_code == 422


def test_pf_payroll_view_marks_finalized_figures(api):
    rows = api.as_(HR).get("/api/pf/payroll?month=October&year=2026").json()["rows"]
    high = next(r for r in rows if r["employee_id"] == STATE["high"])
    assert high["payroll_status"] == "FINALIZED" and high["pf_wage"] == 25000 and high["net_salary"] is not None


def test_new_pf_permissions_reach_roles_saved_before_pf(api):
    from app.database import get_collection
    from app.services import rbac_service as rbac

    async def scenario():
        col = get_collection("role_permissions")
        await col.update_one({"role": "admin"}, {"$set": {"role": "admin", "permissions": ["hr.dashboard.view"]}}, upsert=True)
        rbac._cache.clear()
        await rbac.migrate_new_permissions()
        first = set((await col.find_one({"role": "admin"}))["permissions"])
        await rbac.set_role_permission("admin", "hr.pf.audit", False, "test")
        await rbac.migrate_new_permissions()
        second = set((await col.find_one({"role": "admin"}))["permissions"])
        await col.delete_one({"role": "admin"})
        rbac._cache.clear()
        return first, second
    first, second = api.run(scenario)
    assert {"hr.pf.view", "hr.pf.manage", "hr.pf.reports", "hr.pf.audit"} <= first
    assert "hr.pf.audit" not in second and "hr.pf.view" in second
