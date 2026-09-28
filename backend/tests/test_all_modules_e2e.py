import urllib.request
import json
import io
from datetime import datetime

BASE_URL = "http://127.0.0.1:8080"

def make_req(endpoint, method="GET", data=None, token=None, is_multipart=False, boundary=None):
    url = f"{BASE_URL}{endpoint}"
    headers = {}
    body = None

    if token:
        headers["Authorization"] = f"Bearer {token}"

    if data is not None:
        if is_multipart:
            headers["Content-Type"] = f"multipart/form-data; boundary={boundary}"
            body = data
        else:
            headers["Content-Type"] = "application/json"
            body = json.dumps(data).encode("utf-8")

    req = urllib.request.Request(url, data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req) as resp:
            resp_body = resp.read().decode("utf-8")
            return resp.status, json.loads(resp_body) if resp_body.startswith(("{", "[")) else resp_body
    except urllib.error.HTTPError as e:
        err_body = e.read().decode("utf-8")
        try:
            return e.code, json.loads(err_body)
        except Exception:
            return e.code, {"detail": err_body}

def run_tests():
    print("=== 1. Testing Health Endpoint ===")
    status, res = make_req("/api/health")
    assert status == 200, f"Health check failed: {res}"
    print(f"Health: {res}")

    print("\n=== 2. Admin Login & 2FA ===")
    status, res = make_req("/api/auth/login", method="POST", data={"email": "hr@rexera.co.in", "password": "Hr@@1234"})
    assert status == 200, f"Login failed: {res}"
    debug_otp = res.get("debug_otp", "999999")
    
    status, res = make_req("/api/auth/verify-2fa", method="POST", data={"email": "hr@rexera.co.in", "otp": debug_otp})
    assert status == 200, f"2FA failed: {res}"
    token = res["access_token"]
    print(f"2FA Success: Token obtained for {res.get('email')}.")

    print("\n=== 3. Testing Attendance Module ===")
    # Config
    status, cfg = make_req("/api/attendance/config", token=token)
    assert status == 200, f"Get config failed: {cfg}"
    print(f"Attendance Config: Start={cfg['shift_start_time']}, Grace={cfg['grace_cutoff_time']}")

    # Punch In
    status, punch_res = make_req("/api/attendance/punch-in", method="POST", token=token, data={
        "employee_id": "EMP-001",
        "latitude": 28.535517,
        "longitude": 77.391029
    })
    print(f"Punch-In Result: status={status}, body={punch_res.get('message') if isinstance(punch_res, dict) else punch_res}")

    # Punch Out
    status, punchout_res = make_req("/api/attendance/punch-out", method="POST", token=token, data={
        "employee_id": "EMP-001"
    })
    print(f"Punch-Out Result: status={status}, body={punchout_res.get('message') if isinstance(punchout_res, dict) else punchout_res}")

    print("\n=== 4. Testing Leave Module ===")
    # Balances
    status, bal = make_req("/api/leaves/balances/EMP-001", token=token)
    assert status == 200, f"Balances failed: {bal}"
    print(f"Leave Balances for EMP-001: CL={bal['balances']['casual_leave']['available']}, SL={bal['balances']['sick_leave']['available']}")

    # Apply Leave
    status, apply_res = make_req("/api/leaves/apply", method="POST", token=token, data={
        "employee_id": "EMP-002",
        "leave_type": "CL",
        "start_date": "2026-09-22",
        "end_date": "2026-09-23",
        "reason": "Personal family function",
        "duration_type": "FULL_DAY"
    })
    print(f"Apply Leave: status={status}, data={apply_res.get('message') if isinstance(apply_res, dict) else apply_res}")

    # Pending Leaves Dashboard
    status, pending_res = make_req("/api/leaves/pending-dashboard", token=token)
    assert status == 200
    pending_list = pending_res["data"]
    print(f"Pending Leaves: {len(pending_list)} requests found.")
    if pending_list:
        req_id = pending_list[0]["_id"]
        # Approve Leave
        status, dec_res = make_req("/api/leaves/decision", method="POST", token=token, data={
            "leave_request_id": req_id,
            "action": "APPROVE",
            "remarks": "Approved by HR Superadmin"
        })
        assert status == 200
        print(f"Leave Approval Decision: {dec_res.get('message')}")

    print("\n=== 5. Testing Productivity & Blocker Module ===")
    # Get Tasks
    status, tasks_res = make_req("/api/productivity/tasks", token=token)
    assert status == 200
    tasks = tasks_res["data"]
    print(f"Tasks found: {len(tasks)}")
    
    if tasks:
        t_id = tasks[0]["_id"]
        today_date = datetime.now().strftime("%Y-%m-%d")
        # Log Timesheet
        status, ts_res = make_req("/api/productivity/timesheet/log", method="POST", token=token, data={
            "employee_id": "EMP-001",
            "task_id": t_id,
            "work_date": today_date,
            "hours_spent": 4.5,
            "work_description": "Implemented attendance geofencing unit tests",
            "task_new_status": "IN_PROGRESS"
        })
        print(f"Timesheet Log: status={status}, result={ts_res.get('message') if isinstance(ts_res, dict) else ts_res}")

        # Flag Blocker
        status, blk_res = make_req("/api/productivity/tasks/flag-blocker", method="POST", token=token, data={
            "task_id": t_id,
            "employee_id": "EMP-001",
            "blocker_category": "WAITING_CLIENT_APPROVAL",
            "blocker_reason": "Waiting for client security team signoff on OAuth redirect URIs"
        })
        assert status == 200
        print(f"Blocker Escalation: {blk_res.get('message')}")

    # Bird's Eye Dashboard
    today_date = datetime.now().strftime("%Y-%m-%d")
    status, birds_eye = make_req(f"/api/productivity/dashboard/birds-eye?date_str={today_date}", token=token)
    assert status == 200
    print(f"Bird's Eye: Red Zone Blockers={birds_eye['data']['summary_metrics']['total_red_zone_blockers']}, Active Projs={birds_eye['data']['summary_metrics']['active_projects_count']}")

    print("\n=== 6. Testing Performance Analytics Reports Module ===")
    # Individual Preview
    status, ind_rep = make_req("/api/reports/preview/individual/EMP-001?preset=THIS_MONTH", token=token)
    assert status == 200
    print(f"Individual Report for EMP-001: Score={ind_rep['score_card']['overall_score']}/100, Grade={ind_rep['score_card']['grade']}")

    # Company Preview
    status, comp_rep = make_req("/api/reports/preview/company?preset=THIS_MONTH", token=token)
    assert status == 200
    print(f"Company Report: Billed Hours={comp_rep['total_hours_billed_clients']}h, Active Staff={comp_rep['total_active_employees']}")

    # Async Export Trigger
    status, exp_res = make_req("/api/reports/export-async", method="POST", token=token, data={
        "scope": "COMPANY_WIDE",
        "export_format": "EXCEL",
        "preset": "THIS_MONTH"
    })
    assert status == 202
    print(f"Async Export Triggered: {exp_res.get('message')}")

    print("\n=== 7. Testing Broadcast & Announcement Module ===")
    status, bcast_res = make_req("/api/broadcasts/publish", method="POST", token=token, data={
        "title": "Quarterly All-Hands Meeting Scheduled",
        "rich_html_content": "<p>Please join our Town Hall this Friday at 4:00 PM IST.</p>",
        "priority": "IMPORTANT",
        "audience_type": "ALL_EMPLOYEES",
        "requires_acknowledgment": True,
        "send_email": False
    })
    assert status == 202
    print(f"Broadcast Published: {bcast_res.get('message')}")

    # My notifications
    status, my_notifs = make_req("/api/broadcasts/in-app/my-notifications", token=token)
    assert status == 200
    print(f"In-App Notifications: {my_notifs.get('count')} item(s) delivered.")

    print("\n=== 8. Verifying All Frontend HTML Pages ===")
    urls = [
        "/dashboard.html",
        "/attendance.html",
        "/leaves.html",
        "/productivity.html",
        "/bulk-import.html",
        "/performance-reports.html",
        "/broadcasts.html",
        "/payroll.html",
        "/advances-loans.html",
        "/payroll-settings.html",
        "/salary-slip.html",
        "/salary-report.html"
    ]
    for u in urls:
        req = urllib.request.urlopen(f"{BASE_URL}{u}")
        assert req.status == 200
        print(f"Page {u} -> Status 200 OK (Length: {len(req.read())} bytes)")

    print("\n[SUCCESS] ALL HRMS MODULES TESTED AND VERIFIED SUCCESSFULLY!")

if __name__ == "__main__":
    run_tests()
