"""Smart bulk import, dashboard metrics, backup restore and role dashboards."""
import io

import openpyxl
import pytest

from tests.conftest import login


@pytest.fixture(scope="module", autouse=True)
def error_dir(tmp_path_factory):
    import app.services.import_execution_engine as engine
    mp = pytest.MonkeyPatch()
    mp.setattr(engine, "ERROR_REPORT_DIR", str(tmp_path_factory.mktemp("import_errors")))
    yield
    mp.undo()


def upload(client, auth, content: bytes, name: str, target="EMPLOYEES"):
    return client.post("/api/bulk-import/preview-and-map", headers=auth,
                       files={"file": (name, content)}, data={"target_entity": target})


def run(client, auth, preview, dry=False, key="employee_code", overrides=None):
    mappings = {m["file_header"]: m["suggested_db_field"] or "IGNORE" for m in preview["mappings"]}
    mappings.update(overrides or {})
    r = client.post("/api/bulk-import/execute", headers=auth, json={
        "file_id": preview["file_id"], "target_entity": preview["target_entity"],
        "confirmed_mappings": mappings, "dry_run_only": dry, "unique_key_field": key})
    assert r.status_code == 202, r.text
    return client.get(f"/api/bulk-import/jobs/{r.json()['job_id']}", headers=auth).json()


def test_csv_import_validates_rows(client, auth):
    csv = ("Full Name,Email,Department,Designation,Mobile,DOJ,Basic Salary,IFSC\n"
           "Import One,import.one@rexera-test.com,SALES,BDM,98111 22233,15/08/2026,\"₹45,000\",HDFC0001234\n"
           "Import Two,import.two@rexera-test.com,SALES,BDM,12345,2026-08-15,-5000,BAD\n")
    preview = upload(client, auth, csv.encode(), "staff.csv").json()
    job = run(client, auth, preview)
    assert job["status"] == "COMPLETED", job
    assert job["inserted_count"] == 1 and job["failed_count"] == 1
    emp = client.get("/api/employees", headers=auth, params={"search": "import.one"}).json()["employees"][0]
    assert emp["base_salary"] == 45000 and emp["date_of_joining"] == "2026-08-15" and emp["mobile_number"] == "9811122233"
    assert client.get(f"/api/bulk-import/error-reports/{job['job_id']}", headers=auth).status_code == 200


def test_excel_dates_are_accepted(client, auth):
    """pandas reads Excel date cells as '2026-09-01 00:00:00'; every one used to be rejected."""
    from datetime import datetime
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.append(["Full Name", "Email", "Department", "Designation", "DOJ"])
    ws.append(["Excel Person", "excel.person@rexera-test.com", "SALES", "BDM", datetime(2026, 9, 1)])
    buf = io.BytesIO()
    wb.save(buf)
    preview = upload(client, auth, buf.getvalue(), "staff.xlsx").json()
    job = run(client, auth, preview)
    assert job["inserted_count"] == 1, job
    emp = client.get("/api/employees", headers=auth, params={"search": "excel.person"}).json()["employees"][0]
    assert emp["date_of_joining"] == "2026-09-01"


def test_import_update_syncs_payroll_structure(client, auth):
    emp = client.post("/api/employees", headers=auth, json={
        "full_name": "Import Update", "email": "import.update@rexera-test.com", "mobile_number": "9811100099",
        "department": "SALES", "designation": "BDM", "date_of_joining": "2026-01-01", "base_salary": 20000}).json()
    client.post("/api/payroll/calculate", headers=auth, json={"employee_id": emp["id"], "month": "January", "year": 2027})
    csv = f"Employee ID,Full Name,Email,Department,Designation,Basic Salary\n{emp['employee_code']},Import Update,import.update@rexera-test.com,SALES,BDM,26000\n"
    job = run(client, auth, upload(client, auth, csv.encode(), "raise.csv").json())
    assert job["updated_count"] == 1
    assert client.get(f"/api/employees/{emp['id']}", headers=auth).json()["gross_salary"] == 26000
    rec = client.post("/api/payroll/calculate", headers=auth, json={"employee_id": emp["id"], "month": "February", "year": 2027}).json()
    assert rec["earnings"]["basic"] == 26000


def test_dry_run_writes_nothing(client, auth):
    csv = "Full Name,Email,Department,Designation\nDry Run,dry.run@rexera-test.com,SALES,BDM\n"
    job = run(client, auth, upload(client, auth, csv.encode(), "dry.csv").json(), dry=True)
    assert job["inserted_count"] == 1
    assert client.get("/api/employees", headers=auth, params={"search": "dry.run"}).json()["total"] == 0


def test_imported_leave_balances_are_used(client, auth):
    emp = client.post("/api/employees", headers=auth, json={
        "full_name": "Balance Person", "email": "balance.person@rexera-test.com", "mobile_number": "9811100098",
        "department": "SALES", "designation": "BDM", "date_of_joining": "2026-01-01", "base_salary": 20000}).json()
    csv = f"Employee ID,CL,SL,EL\n{emp['employee_code']},20,5,30\n"
    preview = upload(client, auth, csv.encode(), "balances.csv", target="LEAVE_BALANCES").json()
    job = run(client, auth, preview, key="employee_id")
    assert job["inserted_count"] == 1, job
    from datetime import date
    bal = client.get(f"/api/leaves/balances/{emp['employee_code']}", headers=auth, params={"year": date.today().year}).json()
    assert bal["balances"]["casual_leave"]["allocated"] == 20


def test_upload_rejections(client, auth):
    assert upload(client, auth, b"", "empty.csv").status_code == 400
    assert upload(client, auth, b"just text", "notes.txt").status_code == 400
    assert upload(client, auth, b"Full Name,Email\n", "headers-only.csv").status_code == 400
    assert upload(client, auth, b"a,b\n1,2\n", "x.csv", target="ATTENDANCE_LOGS").status_code == 400
    assert client.get("/api/bulk-import/jobs/nope", headers=auth).status_code == 404


def test_dashboard_departments_are_real(client, auth):
    m = client.get("/api/dashboard/metrics", headers=auth).json()
    depts = {d["department"] for d in m["employees_by_department"]}
    assert "SALES" in depts and "Engineering" not in depts


def test_restore_merges_instead_of_duplicating(client, auth):
    backup = client.get("/api/dashboard/export-all", headers=auth).json()
    before = client.get("/api/employees", headers=auth, params={"limit": 2000}).json()["total"]
    new = {"full_name": "Restored Person", "email": "restored.person@rexera-test.com", "employee_code": backup["employees"][0]["employee_code"]}
    r = client.post("/api/dashboard/import-all", headers=auth, json={"employees": backup["employees"] + [new]})
    assert r.status_code == 200, r.text
    assert r.json()["stats"]["employees"] == 1 and r.json()["skipped"] == len(backup["employees"])
    after = client.get("/api/employees", headers=auth, params={"limit": 2000}).json()
    assert after["total"] == before + 1
    codes = [e["employee_code"] for e in after["employees"]]
    assert len(codes) == len(set(codes))  # the clashing code was replaced


def test_workspace_summary_for_an_employee_account(client, auth, store):
    emp = client.post("/api/employees", headers=auth, json={
        "full_name": "Self Service", "email": "self.service@rexera-test.com", "mobile_number": "9811100097",
        "department": "SALES", "designation": "BDM", "date_of_joining": "2026-01-01", "base_salary": 20000}).json()
    client.post("/api/leaves/apply", headers=auth, json={"employee_id": emp["employee_code"], "leave_type": "CL",
                                                         "start_date": "2026-12-28", "end_date": "2026-12-28", "reason": "Travel"})
    client.post("/api/users", headers=auth, json={"username": "selfservice", "email": "Self.Service@rexera-test.com",
                                                  "role": "employee", "password": "Passw0rd!x"})
    headers = login(client, store, "self.service@rexera-test.com", "Passw0rd!x")
    me = client.get("/api/workspace/summary", headers=headers).json()["me"]
    assert me["employee"]["employee_code"] == emp["employee_code"]
    assert len(me["leaves"]) == 1  # used to look up leaves by record id and find none
    assert "workforce" not in client.get("/api/workspace/summary", headers=headers).json()
    admin_view = client.get("/api/workspace/summary", headers=auth).json()
    assert "payroll" in admin_view and "workforce" in admin_view
    assert client.get("/api/workspace/system", headers=auth).status_code == 200
    assert client.get("/api/workspace/desk", headers=auth).status_code == 200
    assert client.get("/api/notifications", headers=auth).status_code == 200
