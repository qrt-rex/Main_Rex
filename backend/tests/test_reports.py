"""Performance report previews and every export scope/format combination."""
import io

import openpyxl
import pytest


@pytest.fixture(scope="module", autouse=True)
def report_dir(tmp_path_factory):
    import app.routers.reports as router_mod
    import app.services.report_export_service as svc_mod
    out = str(tmp_path_factory.mktemp("reports"))
    mp = pytest.MonkeyPatch()
    mp.setattr(svc_mod, "OUTPUT_DIR", out)
    mp.setattr(router_mod, "OUTPUT_DIR", out)
    yield out
    mp.undo()


@pytest.fixture(scope="module")
def emp(client, auth):
    r = client.post("/api/employees", headers=auth, json={
        "full_name": "Report <Subject> & Co", "email": "report.subject@rexera-test.com", "mobile_number": "9833300000",
        "department": "SALES", "designation": "BDM", "date_of_joining": "2026-01-01", "base_salary": 40000})
    assert r.status_code == 200, r.text
    return r.json()


@pytest.mark.parametrize("preset", ["THIS_MONTH", "LAST_MONTH", "THIS_QUARTER", "YEAR_TO_DATE"])
def test_company_preview_presets(client, auth, preset):
    r = client.get("/api/reports/preview/company", headers=auth, params={"preset": preset})
    assert r.status_code == 200, r.text
    if preset == "THIS_QUARTER":
        assert r.json()["date_range_label"].startswith("Q")  # used to fall through to month-to-date


@pytest.mark.parametrize("params", [{"preset": "CUSTOM"}, {"preset": "CUSTOM", "start_date": "2026-12-31", "end_date": "2026-01-01"},
                                    {"preset": "CUSTOM", "start_date": "31/12/2026", "end_date": "2027-01-01"},
                                    {"preset": "NEXT_YEAR"}])
def test_invalid_ranges_rejected(client, auth, params):
    assert client.get("/api/reports/preview/company", headers=auth, params=params).status_code == 422


def test_custom_range(client, auth, emp):
    r = client.get(f"/api/reports/preview/individual/{emp['employee_code']}", headers=auth,
                   params={"preset": "CUSTOM", "start_date": "2026-09-01", "end_date": "2026-09-30"})
    assert r.status_code == 200 and r.json()["start_date"] == "2026-09-01"
    assert client.get("/api/reports/preview/individual/ghost", headers=auth).status_code == 404


@pytest.mark.parametrize("scope", ["INDIVIDUAL", "COMPANY_WIDE", "COMPANY"])
@pytest.mark.parametrize("fmt, magic", [("PDF", b"%PDF"), ("EXCEL", b"PK"), ("CSV", b"\xef\xbb\xbf")])
def test_every_export_combination_produces_a_file(client, auth, emp, scope, fmt, magic):
    body = {"scope": scope, "export_format": fmt, "preset": "THIS_MONTH",
            "employee_id": emp["employee_code"] if scope == "INDIVIDUAL" else None}
    r = client.post("/api/reports/export-async", headers=auth, json=body)
    assert r.status_code == 202, r.text
    job_id = r.json()["job_id"]
    job = client.get(f"/api/reports/jobs/{job_id}", headers=auth).json()
    assert job["status"] == "COMPLETED", job
    dl = client.get(f"/api/reports/download/{job_id}", headers=auth)
    assert dl.status_code == 200, dl.text
    assert dl.content.startswith(magic)
    if fmt == "EXCEL":
        wb = openpyxl.load_workbook(io.BytesIO(dl.content))
        assert wb.sheetnames


def test_individual_export_needs_a_real_employee(client, auth):
    r = client.post("/api/reports/export-async", headers=auth, json={"scope": "INDIVIDUAL", "export_format": "PDF"})
    assert r.status_code == 422
    r = client.post("/api/reports/export-async", headers=auth, json={"scope": "INDIVIDUAL", "export_format": "PDF", "employee_id": "ghost"})
    assert r.status_code == 404


def test_failed_job_reports_failure(client, auth, monkeypatch):
    from app.services.report_export_service import ReportExportService

    def boom(*a, **k):
        raise RuntimeError("disk full")
    monkeypatch.setattr(ReportExportService, "export", classmethod(lambda cls, *a, **k: boom()))
    r = client.post("/api/reports/export-async", headers=auth, json={"scope": "COMPANY_WIDE", "export_format": "CSV"})
    job_id = r.json()["job_id"]
    assert client.get(f"/api/reports/jobs/{job_id}", headers=auth).json()["status"] == "FAILED"
    dl = client.get(f"/api/reports/download/{job_id}", headers=auth)
    assert dl.status_code == 409 and "disk full" in dl.json()["detail"]


def test_download_unknown_job_and_auth(client, auth):
    assert client.get("/api/reports/download/nope", headers=auth).status_code == 404
    assert client.get("/api/reports/download/nope").status_code == 401


def test_company_report_has_no_invented_numbers(client, auth, emp):
    r = client.get("/api/reports/preview/company", headers=auth,
                   params={"preset": "CUSTOM", "start_date": "2001-01-01", "end_date": "2001-01-31"}).json()
    assert "Client A" not in r["client_billing_chart"]["labels"]
    assert r["blocker_categories_chart"]["labels"] == [] or r["top_critical_bottlenecks"]
    assert r["company_wide_efficiency_rate"] != 92.4 and r["company_avg_performance_score"] != 84.5
    assert all(d["average_performance_score"] != 85.0 or d["headcount"] == 0 for d in r["department_metrics"])


def test_individual_report_counts_tasks_created_in_the_ui(client, auth, emp):
    client.post("/api/productivity/tasks/quick", headers=auth, json={
        "client_name": "Acme", "project_name": "Reports", "task_title": "Counted", "employee_id": emp["employee_code"]})
    r = client.get(f"/api/reports/preview/individual/{emp['employee_code']}", headers=auth).json()
    assert r["tasks_total"] >= 1


def test_report_email_has_no_localhost_link(client, auth, outbox):
    client.post("/api/reports/export-async", headers=auth, json={"scope": "COMPANY_WIDE", "export_format": "EXCEL"})
    mail = next(m for m in reversed(outbox) if "Report Ready" in m["subject"])
    assert "127.0.0.1" not in mail["html"]
