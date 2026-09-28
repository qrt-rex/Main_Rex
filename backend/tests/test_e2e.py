import requests
import json

BASE_URL = "http://127.0.0.1:8000"

def test_full_system():
    print("=" * 60)
    print("[START] FULL-STACK E2E INTEGRATION TEST SUITE")
    print("=" * 60)

    # 1. Health Check
    r = requests.get(f"{BASE_URL}/api/health")
    assert r.status_code == 200, f"Health check failed: {r.text}"
    print(f"[PASS] 1. Health Check OK: {r.json()['status']} ({r.json()['database_mode']})")

    # 2. Admin Login Step 1 (Password)
    r = requests.post(f"{BASE_URL}/api/auth/login", json={
        "email": "hr@rexera.co.in",
        "password": "Hr@@1234"
    })
    assert r.status_code == 200, f"Admin login step 1 failed: {r.text}"
    login_step1 = r.json()
    assert login_step1["requires_2fa"] == True
    temp_token = login_step1["temp_token"]
    print(f"[PASS] 2. Admin Login Step 1 (2FA OTP Dispatched) OK: {login_step1['message']}")

    # 3. Admin Login Step 2 (Verify OTP using dev bypass code 999999)
    r = requests.post(f"{BASE_URL}/api/auth/verify-2fa", json={
        "email": "hr@rexera.co.in",
        "otp": "999999",
        "temp_token": temp_token
    })
    assert r.status_code == 200, f"2FA verify failed: {r.text}"
    auth_data = r.json()
    token = auth_data["access_token"]
    assert token is not None
    headers = {"Authorization": f"Bearer {token}"}
    print(f"[PASS] 3. Admin 2FA OTP Verified & JWT Issued OK: Role={auth_data['role']}")

    # 4. Admin Profile (/api/auth/me)
    r = requests.get(f"{BASE_URL}/api/auth/me", headers=headers)
    assert r.status_code == 200
    print(f"[PASS] 4. Admin Profile Retrieved OK: {r.json()['email']}")

    # 5. Public Candidate Application
    cand_payload = {
        "candidate_name": "Divyansh Mehra",
        "position_applied": "Senior Cloud Architect",
        "interview_date": "2026-09-22",
        "contact_number": "9811223344",
        "email": "divyansh.mehra@example.com",
        "current_company": "Oracle India",
        "total_experience": "6 Years",
        "notice_period": "30 Days",
        "current_ctc": "22 LPA",
        "expected_ctc": "30 LPA",
        "education": [
            {"degree": "B.Tech IT", "institution": "IIT Roorkee", "year": "2020", "grade": "9.1 CGPA"}
        ],
        "work_experience": [
            {"company": "Oracle", "role": "Cloud Architect", "duration": "2020 - Present", "responsibilities": "OCI & AWS infrastructure"}
        ],
        "skills": [
            {"name": "Kubernetes", "proficiency": "Expert", "comments": "CKA Certified"},
            {"name": "Terraform", "proficiency": "Advanced", "comments": "IaC"}
        ],
        "declaration_accepted": True
    }
    r = requests.post(f"{BASE_URL}/api/candidates/", json=cand_payload)
    assert r.status_code == 200, f"Candidate apply failed: {r.text}"
    cand_id = r.json()["candidate_id"]
    print(f"[PASS] 5. Public Candidate Application Submitted OK: ID={cand_id}")

    # 6. Candidate Listing & Filter
    r = requests.get(f"{BASE_URL}/api/candidates/?search=Divyansh", headers=headers)
    assert r.status_code == 200
    assert r.json()["total"] >= 1
    print(f"[PASS] 6. Candidate Filtered in Recruitment Pipeline OK: Total={r.json()['total']}")

    # 7. Generate Joining Token for Candidate
    r = requests.post(f"{BASE_URL}/api/joining/generate-token", headers=headers, json={
        "candidate_id": cand_id,
        "full_name": "Divyansh Mehra",
        "email": "divyansh.mehra@example.com",
        "department": "Engineering",
        "designation": "Senior Cloud Architect",
        "token_type": "employee",
        "expires_in_days": 7
    })
    assert r.status_code == 200, f"Generate token failed: {r.text}"
    joining_token = r.json()["token"]
    print(f"[PASS] 7. Joining Token Generated & Offer Dispatched OK: Token={joining_token}")

    # 8. Candidate Validates Token at /joining-login.html
    r = requests.post(f"{BASE_URL}/api/joining/validate-token", json={"token": joining_token})
    assert r.status_code == 200
    assert r.json()["valid"] == True
    print(f"[PASS] 8. Candidate Token Gate Validated OK: {r.json()['message']}")

    # 9. Candidate Completes Onboarding & 13-Clause Policy Agreement
    onboard_payload = {
        "token": joining_token,
        "full_name": "Divyansh Mehra",
        "parent_name": "Rajesh Mehra",
        "date_of_birth": "1998-07-14",
        "gender": "Male",
        "marital_status": "Single",
        "nationality": "Indian",
        "blood_group": "B+",
        "mobile_number": "9811223344",
        "email": "divyansh.mehra@example.com",
        "permanent_address": "Flat 402, Cyber Residency, HITEC City, Hyderabad",
        "correspondence_address": "Flat 402, Cyber Residency, HITEC City, Hyderabad",
        "aadhaar_number": "784512963012",
        "pan_number": "ABCDE1234F",
        "emergency_contact_name": "Rajesh Mehra",
        "emergency_contact_number": "9811223300",
        "emergency_contact_relation": "Father",
        "bank_name": "HDFC Bank",
        "account_no": "50100849201948",
        "ifsc_code": "HDFC0001024",
        "agreement": {
            "accepted": True,
            "signature_name": "Divyansh Mehra"
        }
    }
    r = requests.post(f"{BASE_URL}/api/joining/submit-onboarding", json=onboard_payload)
    assert r.status_code == 200, f"Submit onboarding failed: {r.text}"
    emp_code = r.json()["employee_code"]
    print(f"[PASS] 9. Onboarding & 13-Clause Policy Agreement Signed OK: Employee Code={emp_code}")

    # 10. Intern Onboarding Form
    intern_payload = {
        "full_name": "Sneha Reddy",
        "email": "sneha.reddy@student.ac.in",
        "mobile_number": "9877112233",
        "gender": "Female",
        "date_of_birth": "2003-08-20",
        "college_university": "Osmania University",
        "degree": "B.Tech",
        "branch_specialization": "Information Technology",
        "current_semester": "7th Semester",
        "roll_number": "OU-2021-IT-089",
        "department": "Engineering",
        "domain_role": "Backend Engineer Intern",
        "assigned_mentor": "Aarav Sharma",
        "start_date": "2026-07-01",
        "end_date": "2026-12-31",
        "duration_months": 6,
        "internship_type": "Full-time",
        "monthly_stipend": 22000.0,
        "bank_name": "ICICI Bank",
        "account_no": "002401889922",
        "ifsc_code": "ICIC0000024"
    }
    r = requests.post(f"{BASE_URL}/api/interns/", headers=headers, json=intern_payload)
    assert r.status_code == 200, f"Create intern failed: {r.text}"
    intern_id = r.json()["id"]
    print(f"[PASS] 10. Intern Onboarded Successfully OK: {r.json()['full_name']} ({r.json()['intern_code']})")

    # 11. Convert Intern to Full-Time Employee
    convert_payload = {
        "designation": "Associate Backend Engineer",
        "department": "Engineering",
        "reporting_manager": "Aarav Sharma",
        "date_of_joining": "2027-01-01",
        "base_salary": 45000.0,
        "hra": 18000.0,
        "conveyance_allowance": 2000.0,
        "special_allowance": 5000.0,
        "professional_tax": 200.0,
        "pf_opted": True
    }
    r = requests.post(f"{BASE_URL}/api/interns/{intern_id}/convert", headers=headers, json=convert_payload)
    assert r.status_code == 200, f"Convert intern failed: {r.text}"
    print(f"[PASS] 11. Intern Converted to Full-Time Employee OK: {r.json()['message']}")

    # 12. Statutory Salary Calculation Engine
    calc_payload = {
        "base_salary": 65000.0,
        "hra": 26000.0,
        "conveyance_allowance": 3000.0,
        "special_allowance": 11000.0,
        "pf_opted": True,
        "professional_tax": 200.0,
        "bonus": 5000.0,
        "other_deductions": 0.0,
        "working_days": 30,
        "lop_days": 1
    }
    r = requests.post(f"{BASE_URL}/api/payroll/calculate-salary", json=calc_payload)
    assert r.status_code == 200
    calc_res = r.json()
    assert calc_res["deductions"]["pf"] == 7800.0  # 12% of 65000
    assert calc_res["deductions"]["pt"] == 200.0
    print(f"[PASS] 12. Statutory Salary Engine OK: Gross=Rs.{calc_res['gross_salary']}, Net=Rs.{calc_res['net_salary']}, Words='{calc_res['net_salary_words']}'")

    # 13. Batch Payroll Run for September 2026
    r = requests.post(f"{BASE_URL}/api/payroll/batch-run", headers=headers, json={
        "month": "September",
        "year": 2026,
        "department": None
    })
    assert r.status_code == 200, f"Batch payroll failed: {r.text}"
    print(f"[PASS] 13. Batch Payroll Run OK: {r.json()['message']}")

    # 14. Salary Register Summary & Slips
    r = requests.get(f"{BASE_URL}/api/payroll/summary?month=September&year=2026", headers=headers)
    assert r.status_code == 200
    summary = r.json()
    print(f"[PASS] 14. Monthly Payroll Register OK: {summary['total_slips']} slips, Net Disbursed=Rs.{summary['total_net_disbursed']:,}")

    # 15. Printable Payslip HTML Format
    slips_res = requests.get(f"{BASE_URL}/api/payroll/slips?month=September&year=2026", headers=headers)
    assert slips_res.status_code == 200
    first_slip = slips_res.json()["slips"][0]
    r_print = requests.get(f"{BASE_URL}/api/payroll/slip/{first_slip['id']}/printable")
    assert r_print.status_code == 200
    assert "SALARY PAYSLIP" in r_print.text
    assert "Rexera Technologies Inc." in r_print.text
    print(f"[PASS] 15. Printable Official Payslip HTML Generated OK: Slip={first_slip['slip_number']}")

    # 16. Dashboard Metrics
    r_dash = requests.get(f"{BASE_URL}/api/dashboard/metrics", headers=headers)
    assert r_dash.status_code == 200
    dash = r_dash.json()
    print(f"[PASS] 16. Executive Dashboard Aggregated OK: Candidates={dash['total_candidates']}, Employees={dash['active_employees']}, Interns={dash['active_interns']}")

    # 17. Frontend HTML Pages HTTP Availability
    pages = [
        "/",
        "/admin-login.html",
        "/dashboard.html",
        "/candidates.html",
        "/employees.html",
        "/add-employee.html",
        "/interns.html",
        "/intern-form.html",
        "/joining-login.html",
        "/joining-form.html",
        "/salary-slip.html",
        "/salary-report.html",
        "/payroll.html"
    ]
    for p in pages:
        res_page = requests.get(f"{BASE_URL}{p}")
        assert res_page.status_code == 200, f"Page {p} returned {res_page.status_code}"
    print(f"[PASS] 17. All {len(pages)} Frontend HTML Pages Loaded Successfully!")

    print("=" * 60)
    print("[SUCCESS] ALL 17 INTEGRATION TEST SUITES PASSED FLAWLESSLY!")
    print("=" * 60)

if __name__ == "__main__":
    test_full_system()
