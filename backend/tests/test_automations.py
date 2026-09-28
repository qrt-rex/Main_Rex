"""Automations: settings API, scheduling rules, and that each job acts once and only on new work."""
import itertools
from datetime import datetime, timedelta

import pytz

from app.services.automation_service import AUTOMATIONS, AutomationService, now_local
from tests.conftest import login

_seq = itertools.count(1)


def make_employee(client, auth, **over):
    n = next(_seq)
    body = {"full_name": f"Auto Person {n}", "email": f"auto{n}@rexera-test.com", "mobile_number": "9822233333",
            "department": "SALES", "designation": "BDM", "date_of_joining": "2026-01-01",
            "base_salary": 30000, "hra": 10000}
    body.update(over)
    r = client.post("/api/employees", headers=auth, json=body)
    assert r.status_code == 200, r.text
    return r.json()


def enable(client, auth, automation_id, **body):
    r = client.put(f"/api/automations/{automation_id}", headers=auth, json={"enabled": True, **body})
    assert r.status_code == 200, r.text
    return r.json()


def run(client, auth, automation_id):
    r = client.post(f"/api/automations/{automation_id}/run", headers=auth)
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "success", r.json()
    return r.json()


def mails_to(outbox, address, subject_part=""):
    return [m for m in outbox if m["to"] == address and subject_part in m["subject"]]


# ---------------------------------------------------------------- settings API

def test_all_automations_listed_and_off_by_default(client, auth):
    r = client.get("/api/automations", headers=auth)
    assert r.status_code == 200
    items = {a["id"]: a for a in r.json()["automations"]}
    assert set(items) == {a["id"] for a in AUTOMATIONS}
    assert items["billing_summary"]["enabled"] is False
    assert r.json()["settings"]["hr_email"]


def test_update_validation(client, auth):
    assert client.put("/api/automations/nope", headers=auth, json={"enabled": True}).status_code == 404
    assert client.put("/api/automations/billing_summary", headers=auth, json={"enabled": True, "schedule": {"time": "25:00"}}).status_code == 422
    assert client.put("/api/automations/payroll_monthly_run", headers=auth, json={"enabled": False, "schedule": {"day": 31}}).status_code == 422
    assert client.put("/api/automations/payslip_email", headers=auth, json={"enabled": False, "schedule": {"minutes": 1}}).status_code == 422
    assert client.put("/api/automations/pending_leave_reminder", headers=auth,
                      json={"enabled": False, "options": {"pending_days": "abc"}}).status_code == 422
    saved = client.put("/api/automations/settings", headers=auth, json={"hr_email": "HR@rexera-test.com", "accounts_email": "acc@rexera-test.com"})
    assert saved.status_code == 200 and saved.json()["hr_email"] == "hr@rexera-test.com"


def test_needs_permission(client, auth, store):
    client.post("/api/users", headers=auth, json={"username": "autoemp", "email": "auto.emp@rexera-test.com",
                                                  "role": "employee", "password": "Passw0rd!x"})
    headers = login(client, store, "auto.emp@rexera-test.com", "Passw0rd!x")
    assert client.get("/api/automations", headers=headers).status_code == 403


# ---------------------------------------------------------------- scheduling rules

def _state(kind, enabled_at, last_run=None, **sched):
    return {"enabled": True, "enabled_at": enabled_at, "last_run_at": last_run, "schedule": {"type": kind, **sched}}


def test_daily_schedule_runs_once_after_its_time():
    tz = pytz.timezone("Asia/Kolkata")
    now = tz.localize(datetime(2026, 9, 26, 10, 5))
    enabled = "2026-09-25T00:00:00"  # UTC
    assert AutomationService.is_due(_state("daily", enabled, time="10:00"), now)
    assert not AutomationService.is_due(_state("daily", enabled, time="11:00"), now)  # not yet
    ran = "2026-09-26T04:31:00"  # 10:01 IST, after today's slot
    assert not AutomationService.is_due(_state("daily", enabled, ran, time="10:00"), now)
    # Switched on after today's time: waits for tomorrow instead of firing at once.
    assert not AutomationService.is_due(_state("daily", "2026-09-26T04:33:00", time="10:00"), now)
    assert not AutomationService.is_due({**_state("daily", enabled, time="10:00"), "enabled": False}, now)


def test_monthly_and_interval_schedules():
    tz = pytz.timezone("Asia/Kolkata")
    enabled = "2026-09-01T00:00:00"
    assert AutomationService.is_due(_state("monthly", enabled, day=26, time="09:00"), tz.localize(datetime(2026, 9, 26, 9, 30)))
    assert not AutomationService.is_due(_state("monthly", enabled, day=27, time="09:00"), tz.localize(datetime(2026, 9, 26, 9, 30)))
    now = tz.localize(datetime(2026, 9, 26, 10, 0))
    assert AutomationService.is_due(_state("interval", enabled, "2026-09-26T03:59:00", minutes=30), now)
    assert not AutomationService.is_due(_state("interval", enabled, "2026-09-26T04:20:00", minutes=30), now)


# ---------------------------------------------------------------- billing

def test_invoice_reminders_once_per_step(client, auth, outbox):
    enable(client, auth, "invoice_reminders", options={"days_before_due": 3, "overdue_days": "1,7"})
    today = now_local().date()
    client_info = {"name": "Remind Co", "email": "pay@remind-co.test", "gstin": "27AAACZ1234A1Z9", "state": "Maharashtra"}
    items = [{"name": "Advisory", "quantity": 1, "unit_price": 1000, "gst_rate": 18}]
    for inv_date, due in ((today - timedelta(days=20), today - timedelta(days=10)), (today, today + timedelta(days=30))):
        r = client.post("/api/billing/invoices", headers=auth, json={"client": client_info, "items": items,
                                                                     "invoice_date": inv_date.isoformat(), "due_date": due.isoformat()})
        assert r.status_code == 201, r.text
    run(client, auth, "invoice_reminders")
    assert len(mails_to(outbox, "pay@remind-co.test", "Payment reminder")) == 1  # only the overdue one, one step
    run(client, auth, "invoice_reminders")
    assert len(mails_to(outbox, "pay@remind-co.test", "Payment reminder")) == 1  # no repeat


def test_quotations_expire(client, auth):
    enable(client, auth, "quotation_expiry")
    today = now_local().date()
    r = client.post("/api/billing/quotations", headers=auth, json={
        "client": {"name": "Old Quote Co"}, "items": [{"name": "Svc", "quantity": 1, "unit_price": 100}],
        "quotation_date": (today - timedelta(days=40)).isoformat(), "valid_until": (today - timedelta(days=10)).isoformat()})
    assert r.status_code == 201, r.text
    run(client, auth, "quotation_expiry")
    qid = r.json()["quotation"]["id"]
    assert client.get(f"/api/billing/quotations/{qid}", headers=auth).json()["quotation"]["status"] == "expired"


# ---------------------------------------------------------------- payroll

def test_monthly_run_leaves_existing_records_alone(client, auth):
    month = now_local().strftime("%B")
    year = now_local().year
    edited = make_employee(client, auth)
    fresh = make_employee(client, auth)
    rec = client.post("/api/payroll/calculate", headers=auth, json={"employee_id": edited["id"], "month": month, "year": year}).json()
    client.put(f"/api/payroll/record/{rec['id']}", headers=auth, json={"bonus": 999})
    enable(client, auth, "payroll_monthly_run")
    run(client, auth, "payroll_monthly_run")
    records = {p["employee_id"]: p for p in client.get("/api/payroll", headers=auth, params={"month": month, "year": year}).json()}
    assert records[fresh["id"]]["status"] == "CALCULATED"  # never approved automatically
    assert records[edited["id"]]["earnings"]["bonus"] == 999 and records[edited["id"]]["status"] == "UNDER_REVIEW"


def test_payslips_emailed_only_when_finalized_after_enabling(client, auth, outbox):
    month = now_local().strftime("%B")
    year = now_local().year
    before = make_employee(client, auth, email="before.slip@rexera-test.com")
    after = make_employee(client, auth, email="after.slip@rexera-test.com")
    old = client.post("/api/payroll/calculate", headers=auth, json={"employee_id": before["id"], "month": month, "year": year}).json()
    client.post(f"/api/payroll/record/{old['id']}/finalize", headers=auth)
    enable(client, auth, "payslip_email")
    new = client.post("/api/payroll/calculate", headers=auth, json={"employee_id": after["id"], "month": month, "year": year}).json()
    client.post(f"/api/payroll/record/{new['id']}/finalize", headers=auth)
    run(client, auth, "payslip_email")
    run(client, auth, "payslip_email")
    assert len(mails_to(outbox, "after.slip@rexera-test.com")) == 1
    assert not mails_to(outbox, "before.slip@rexera-test.com")


# ---------------------------------------------------------------- HR & recruitment

def test_birthday_and_anniversary_wishes_once(client, auth, outbox, store):
    today = now_local().date()
    emp = make_employee(client, auth, email="bday@rexera-test.com",
                        date_of_joining=today.replace(year=today.year - 2).isoformat())
    store.tables.setdefault("onboarding_submissions", {})["sub-bday"] = {
        "employee_id": emp["id"], "date_of_birth": today.replace(year=1995).isoformat()}
    enable(client, auth, "celebrations")
    run(client, auth, "celebrations")
    run(client, auth, "celebrations")
    assert len(mails_to(outbox, "bday@rexera-test.com", "Happy Birthday")) == 1
    assert len(mails_to(outbox, "bday@rexera-test.com", "2-year work anniversary")) == 1


def test_pending_leave_reminder(client, auth, outbox, store):
    client.put("/api/automations/settings", headers=auth, json={"hr_email": "hr.inbox@rexera-test.com", "accounts_email": "acc@rexera-test.com"})
    emp = make_employee(client, auth)
    r = client.post("/api/leaves/apply", headers=auth, json={"employee_id": emp["employee_code"], "leave_type": "CL",
                                                              "start_date": "2026-12-01", "end_date": "2026-12-01", "reason": "Family visit"})
    lid = r.json()["data"]["_id"]
    store.tables["leave_requests"][lid]["created_at"] = (datetime.utcnow() - timedelta(days=5)).isoformat()
    enable(client, auth, "pending_leave_reminder", options={"pending_days": 2})
    run(client, auth, "pending_leave_reminder")
    mail = mails_to(outbox, "hr.inbox@rexera-test.com", "leave request")[-1]
    assert emp["full_name"] in mail["html"]


def test_joining_link_sent_only_for_new_selections(client, auth, outbox):
    old = client.post("/api/candidates", json={"candidate_name": "Old Pick", "email": "old.pick@example.com",
                                               "contact_number": "9876500022", "position_applied": "BDM"}).json()["candidate_id"]
    client.patch(f"/api/candidates/{old}/status", headers=auth, json={"status": "Selected", "interview_notes": "ok"})
    enable(client, auth, "auto_joining_link")
    new = client.post("/api/candidates", json={"candidate_name": "New Pick", "email": "new.pick@example.com",
                                               "contact_number": "9876500033", "position_applied": "BDM"}).json()["candidate_id"]
    client.patch(f"/api/candidates/{new}/status", headers=auth, json={"status": "Selected", "interview_notes": "ok"})
    run(client, auth, "auto_joining_link")
    run(client, auth, "auto_joining_link")
    assert len(mails_to(outbox, "new.pick@example.com", "Joining Token")) == 1
    assert not mails_to(outbox, "old.pick@example.com", "Joining Token")


def test_run_history_is_recorded(client, auth):
    enable(client, auth, "billing_summary")
    run(client, auth, "billing_summary")
    runs = client.get("/api/automations/runs", headers=auth).json()["runs"]
    assert runs[0]["automation_id"] == "billing_summary" and runs[0]["trigger"] == "manual"
    state = next(a for a in client.get("/api/automations", headers=auth).json()["automations"] if a["id"] == "billing_summary")
    assert state["last_status"] == "success" and state["last_run_at"]
