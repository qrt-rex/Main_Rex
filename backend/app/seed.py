import os
import sys
import asyncio
import logging
from datetime import datetime, timedelta

backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

from app.config import settings
from app.database import db_manager, get_collection
from app.utils.security import hash_password
from app.services.payroll_service import PayrollService
from app.schemas.advanced_payroll import SinglePayrollCalculationRequest

logger = logging.getLogger("rexera.seed")

async def seed_database():
    await db_manager.connect()
    now_str = datetime.now().isoformat()
    
    # 1. Accounts: missing ones are created; existing ones are never touched, so a password, role or
    # deactivation set in the app survives a restart. Passwords are never printed.
    admin_col = get_collection("admins")
    accounts = [  # (username, email, first password, role)
        (settings.DEFAULT_ADMIN_USERNAME, settings.DEFAULT_ADMIN_EMAIL, settings.DEFAULT_ADMIN_PASSWORD, "superadmin"),
        ("Super Admin", "superadmin@rexera.co.in", "QRT##11111", "superadmin"),
        ("System Admin", "admin@rexera.co.in", "Admin@123", "admin"),
        ("HR Manager", "hr@rexera.co.in", "Hr@@1234", "hr"),
        ("HR Team", "hr@rexera.in", "Hr@@1234", "hr"),
        ("Legal Advisor", "legal@rexera.co.in", "admin", "legal"),
        ("Sales Lead", "sales@rexera.co.in", "Sales@123", "sales"),
        ("IT Support Engineer", "it@rexera.co.in", "ItDept@123", "it"),
        ("Customer Support Desk", "support@rexera.co.in", "Support@123", "support"),
        ("Rexera Employee", "employee@rexera.co.in", "Emp@123", "employee"),
        ("Rexera Staff", "employee@rexera.com", "Emp@123", "employee"),
    ]
    for username, email, password, role in accounts:
        email = email.lower()
        if await admin_col.find_one({"email": email}):
            continue
        await admin_col.insert_one({
            "username": username, "email": email, "password_hash": hash_password(password), "role": role,
            "is_active": True, "created_at": now_str, "updated_at": now_str, "last_login": None,
        })
        print(f"[OK] Created account: {email} (role: {role})")

    # 1c. Seed Legal Records
    from app.routers.legal import ensure_initial_records
    await ensure_initial_records()
    print("[OK] Seeded Legal Records (31 records).")

    # 2. Sample Employees (Only if SEED_DUMMY_DATA is True)
    emp_col = get_collection("employees")
    if settings.SEED_DUMMY_DATA and await emp_col.count_documents({}) == 0:
        sample_employees = [
            {
                "employee_code": "EMP-001",
                "full_name": "Aarav Sharma",
                "email": "aarav.sharma@rexera.com",
                "mobile_number": "9876543210",
                "department": "Engineering",
                "designation": "Senior Full-Stack Engineer",
                "reporting_manager": "Vikram Malhotra",
                "date_of_joining": "2024-03-15",
                "base_salary": 65000.0,
                "hra": 26000.0,
                "conveyance_allowance": 3000.0,
                "special_allowance": 11000.0,
                "professional_tax": 200.0,
                "pf_opted": True,
                "bank_name": "HDFC Bank",
                "account_no": "50100492817264",
                "ifsc_code": "HDFC0001024",
                "employee_status": "Active",
                "joining_status": "Completed",
                "gross_salary": 105000.0,
                "estimated_net_salary": 97000.0,
                "created_at": now_str,
                "updated_at": now_str
            },
            {
                "employee_code": "EMP-002",
                "full_name": "Pooja Hegde",
                "email": "pooja.hegde@rexera.com",
                "mobile_number": "9812345678",
                "department": "HR",
                "designation": "Talent Acquisition Lead",
                "reporting_manager": "Siddharth Roy",
                "date_of_joining": "2024-06-01",
                "base_salary": 45000.0,
                "hra": 18000.0,
                "conveyance_allowance": 2000.0,
                "special_allowance": 5000.0,
                "professional_tax": 200.0,
                "pf_opted": True,
                "bank_name": "ICICI Bank",
                "account_no": "002401569842",
                "ifsc_code": "ICIC0000024",
                "employee_status": "Active",
                "joining_status": "Completed",
                "gross_salary": 70000.0,
                "estimated_net_salary": 64400.0,
                "created_at": now_str,
                "updated_at": now_str
            },
            {
                "employee_code": "EMP-003",
                "full_name": "Rohan Deshmukh",
                "email": "rohan.d@rexera.com",
                "mobile_number": "9765432109",
                "department": "Sales & Marketing",
                "designation": "Business Development Manager",
                "reporting_manager": "Ananya Sen",
                "date_of_joining": "2024-09-10",
                "base_salary": 50000.0,
                "hra": 20000.0,
                "conveyance_allowance": 2500.0,
                "special_allowance": 7500.0,
                "professional_tax": 200.0,
                "pf_opted": True,
                "bank_name": "Axis Bank",
                "account_no": "918020054789123",
                "ifsc_code": "UTIB0000180",
                "employee_status": "Active",
                "joining_status": "Completed",
                "gross_salary": 80000.0,
                "estimated_net_salary": 73800.0,
                "created_at": now_str,
                "updated_at": now_str
            }
        ]
        for emp in sample_employees:
            res = await emp_col.insert_one(emp)
            # Generate sample salary slips
            slip_req = SinglePayrollCalculationRequest(
                employee_id=str(res.inserted_id),
                month="August",
                year=2026,
                working_days=31,
                paid_leave_days=31,
                unpaid_leave_days=0,
                bonus_amount=2000.0 if emp["department"] == "Sales & Marketing" else 0.0,
                other_deductions=0.0
            )
            rec = await PayrollService.calculate_employee_payroll(slip_req, save_record=True, status="APPROVED")
            await PayrollService.finalize_payroll(rec["id"], user_email="seed")
        print(f"[OK] Seeded {len(sample_employees)} sample employees with August 2026 salary slips.")

    # 3. Sample Candidates (Only if SEED_DUMMY_DATA is True)
    cand_col = get_collection("candidates")
    if settings.SEED_DUMMY_DATA and await cand_col.count_documents({}) == 0:
        sample_candidates = [
            {
                "candidate_name": "Kavya Nambiar",
                "position_applied": "Senior Frontend Developer",
                "interview_date": "2026-09-18",
                "contact_number": "9845012345",
                "email": "kavya.nambiar@example.com",
                "current_company": "Infosys",
                "total_experience": "4.5 Years",
                "notice_period": "30 Days",
                "current_ctc": "12 LPA",
                "expected_ctc": "16 LPA",
                "education": [
                    {"degree": "B.Tech Computer Science", "institution": "NIT Calicut", "year": "2021", "grade": "8.8 CGPA"}
                ],
                "work_experience": [
                    {"company": "Infosys", "role": "Frontend Specialist", "duration": "2021 - Present", "responsibilities": "Building scalable React & UI component design systems."}
                ],
                "skills": [
                    {"name": "JavaScript", "proficiency": "Expert", "comments": "Core JS & ES6+"},
                    {"name": "HTML5/CSS3", "proficiency": "Expert", "comments": "Responsive Layouts"}
                ],
                "languages_known": "English, Hindi, Malayalam",
                "hobbies": "UI Design, Open Source, Badminton",
                "strengths": "Fast learner, clean code advocate",
                "weaknesses": "Can be perfectionist with CSS alignment",
                "status": "Interview Scheduled",
                "interview_notes": "First round cleared with flying colors.",
                "has_joining_token": False,
                "joining_token": None,
                "assigned_hr": "pooja@rexera.co.in",
                "created_at": now_str,
                "updated_at": now_str
            },
            {
                "candidate_name": "Rahul Varma",
                "position_applied": "DevOps Engineer",
                "interview_date": "2026-09-16",
                "contact_number": "9731209876",
                "email": "rahul.varma@example.com",
                "current_company": "Cognizant",
                "total_experience": "3 Years",
                "notice_period": "Immediate",
                "current_ctc": "9 LPA",
                "expected_ctc": "13 LPA",
                "education": [
                    {"degree": "B.E Information Technology", "institution": "Anna University", "year": "2022", "grade": "8.2 CGPA"}
                ],
                "work_experience": [
                    {"company": "Cognizant", "role": "Cloud Analyst", "duration": "2022 - Present", "responsibilities": "Docker, Kubernetes and CI/CD pipelines."}
                ],
                "skills": [
                    {"name": "Docker & K8s", "proficiency": "Advanced", "comments": "Container orchestration"},
                    {"name": "Python & Bash", "proficiency": "Advanced", "comments": "Automation scripting"}
                ],
                "languages_known": "English, Tamil, Hindi",
                "hobbies": "Homelab setup, Cycling",
                "strengths": "Strong troubleshooting skills",
                "weaknesses": "None noted",
                "status": "Selected",
                "interview_notes": "Selected in final management round.",
                "has_joining_token": True,
                "joining_token": "REX-A1B2C3",
                "assigned_hr": "rohan@rexera.co.in",
                "created_at": now_str,
                "updated_at": now_str
            }
        ]
        
        # Insert candidates and token for Rahul
        c1 = await cand_col.insert_one(sample_candidates[0])
        c2 = await cand_col.insert_one(sample_candidates[1])
        
        token_col = get_collection("joining_tokens")
        token_doc = {
            "token": "REX-A1B2C3",
            "candidate_id": str(c2.inserted_id),
            "full_name": "Rahul Varma",
            "email": "rahul.varma@example.com",
            "department": "Engineering",
            "designation": "DevOps Engineer",
            "token_type": "employee",
            "expires_at": (datetime.now() + timedelta(days=7)).isoformat(),
            "used": False,
            "created_at": now_str
        }
        await token_col.insert_one(token_doc)
        print("[OK] Seeded sample candidates and active joining token: REX-A1B2C3")

    # 4. Sample Interns (Only if SEED_DUMMY_DATA is True)
    intern_col = get_collection("interns")
    if settings.SEED_DUMMY_DATA and await intern_col.count_documents({}) == 0:
        sample_interns = [
            {
                "intern_code": "INT-2026-001",
                "full_name": "Divya Patel",
                "email": "divya.patel@student.edu",
                "mobile_number": "9898012345",
                "gender": "Female",
                "date_of_birth": "2003-05-12",
                "college_university": "IIT Hyderabad",
                "degree": "B.Tech",
                "branch_specialization": "Computer Science & Data Science",
                "current_semester": "7th Semester",
                "roll_number": "CS21B045",
                "department": "Engineering",
                "domain_role": "AI / ML Research Intern",
                "assigned_mentor": "Aarav Sharma",
                "start_date": "2026-07-01",
                "end_date": "2026-12-31",
                "duration_months": 6,
                "internship_type": "Full-time",
                "monthly_stipend": 25000.0,
                "bank_name": "State Bank of India",
                "account_no": "34981204958",
                "ifsc_code": "SBIN0010045",
                "status": "Ongoing",
                "performance_rating": 4.8,
                "mentor_feedback": "Exceptional problem solving and prompt engineering capabilities.",
                "converted_employee_id": None,
                "created_at": now_str,
                "updated_at": now_str
            },
            {
                "intern_code": "INT-2026-002",
                "full_name": "Manish Gupta",
                "email": "manish.g@college.edu",
                "mobile_number": "9711029384",
                "gender": "Male",
                "date_of_birth": "2002-11-20",
                "college_university": "BITS Pilani",
                "degree": "B.E",
                "branch_specialization": "Electronics & Instrumentation",
                "current_semester": "8th Semester",
                "roll_number": "2021A7PS0234P",
                "department": "Product & Design",
                "domain_role": "Product Analyst Intern",
                "assigned_mentor": "Siddharth Roy",
                "start_date": "2026-06-01",
                "end_date": "2026-09-30",
                "duration_months": 4,
                "internship_type": "Full-time",
                "monthly_stipend": 20000.0,
                "bank_name": "Kotak Mahindra Bank",
                "account_no": "6710492819",
                "ifsc_code": "KKBK0000451",
                "status": "Under Review",
                "performance_rating": 4.5,
                "mentor_feedback": "Ready for conversion to Full-Time Associate Product Manager.",
                "converted_employee_id": None,
                "created_at": now_str,
                "updated_at": now_str
            }
        ]
        for intern in sample_interns:
            await intern_col.insert_one(intern)
        print(f"[OK] Seeded {len(sample_interns)} sample interns.")

    # 3. Seed Salary Structures for all existing employees if missing
    struct_col = get_collection("salary_structures")
    all_employees = await emp_col.find({}).to_list(1000)
    for emp in all_employees:
        emp_id = str(emp["_id"])
        exists = await struct_col.find_one({"employee_id": emp_id})
        if not exists:
            base = float(emp.get("base_salary", 35000.0))
            hra = float(emp.get("hra", round(base * 0.4, 2)))
            conv = float(emp.get("conveyance_allowance", 2000.0))
            spec = float(emp.get("special_allowance", 5000.0))
            struct_doc = {
                "employee_id": emp_id,
                "employee_code": emp.get("employee_code", ""),
                "employee_name": emp.get("full_name", ""),
                "department": emp.get("department", ""),
                "designation": emp.get("designation", ""),
                "salary_type": "monthly",
                "base_salary": base,
                "hra_type": "fixed",
                "hra_value": hra,
                "conveyance_allowance": conv,
                "medical_allowance": 1250.0,
                "special_allowance": spec,
                "other_allowances": 0.0,
                "pf_opted": emp.get("pf_opted", True),
                "pf_type": "percentage_12",
                "pf_fixed_amount": 0.0,
                "esi_opted": False,
                "esi_percentage": 0.75,
                "professional_tax": float(emp.get("professional_tax", 200.0)),
                "tds_percentage": 5.0 if base > 50000 else 0.0,
                "overtime_rate_per_hour": round((base / 240.0) * 1.5, 2),
                "is_active": True,
                "created_at": now_str,
                "updated_at": now_str
            }
            await struct_col.insert_one(struct_doc)
            print(f"[OK] Created Salary Structure for: {emp.get('full_name')}")

    # 4. Seed Sample Salary Advances if none exist
    adv_col = get_collection("salary_advances")
    if await adv_col.count_documents({}) == 0 and len(all_employees) > 0:
        emp1 = all_employees[0]
        sample_advance = {
            "advance_id": "REX-ADV-0001",
            "employee_id": str(emp1["_id"]),
            "employee_code": emp1.get("employee_code", "EMP-001"),
            "employee_name": emp1.get("full_name", "Aarav Sharma"),
            "department": emp1.get("department", "Engineering"),
            "request_date": "2026-09-01",
            "advance_amount": 30000.0,
            "reason": "Home relocation & setup expenses",
            "approval_status": "Approved",
            "approved_by": "HR Superadmin",
            "approval_date": "2026-09-02",
            "monthly_deduction_amount": 5000.0,
            "start_month": "September",
            "start_year": 2026,
            "paid_amount": 0.0,
            "remaining_balance": 30000.0,
            "status": "Approved",
            "created_at": now_str,
            "updated_at": now_str
        }
        await adv_col.insert_one(sample_advance)
        print(f"[OK] Seeded sample salary advance for {emp1.get('full_name')}")

    # 5. Seed Sample Loan if none exist
    loan_col = get_collection("employee_loans")
    if await loan_col.count_documents({}) == 0 and len(all_employees) > 1:
        emp2 = all_employees[1]
        sample_loan = {
            "loan_id": "REX-LOAN-0001",
            "employee_id": str(emp2["_id"]),
            "employee_code": emp2.get("employee_code", "EMP-002"),
            "employee_name": emp2.get("full_name", "Pooja Hegde"),
            "department": emp2.get("department", "HR"),
            "principal_amount": 50000.0,
            "interest_rate_percent": 4.0,
            "total_payable": 52000.0,
            "monthly_emi": 4333.33,
            "start_date": "2026-08-01",
            "paid_amount": 0.0,
            "remaining_amount": 52000.0,
            "status": "Active",
            "reason": "Higher Education Certification Assistance",
            "created_at": now_str,
            "updated_at": now_str
        }
        await loan_col.insert_one(sample_loan)
        print(f"[OK] Seeded sample employee loan for {emp2.get('full_name')}")

    # 7. Seed Attendance Settings
    att_settings_col = get_collection("attendance_settings")
    if not await att_settings_col.find_one({"company_id": "DEFAULT"}):
        from app.schemas.attendance import AttendanceConfig
        att_cfg = AttendanceConfig().dict()
        await att_settings_col.insert_one(att_cfg)
        print("[OK] Seeded default Attendance & Geofencing Settings.")

    # 8. Seed Leave Balances for all employees
    bal_col = get_collection("leave_balances")
    for emp in all_employees:
        emp_id = str(emp.get("_id"))
        if not await bal_col.find_one({"employee_id": emp_id}):
            from app.schemas.leave import LeaveBalance
            bal_doc = LeaveBalance(employee_id=emp_id).dict()
            await bal_col.insert_one(bal_doc)
    print(f"[OK] Seeded Leave Balances for {len(all_employees)} employees.")

    # 9. Seed Sample Clients & Projects if none exist
    client_col = get_collection("clients")
    proj_col = get_collection("projects")
    task_col = get_collection("project_tasks")
    if await client_col.count_documents({}) == 0:
        c1 = {
            "client_name": "Acme Corp",
            "company_name": "Acme Global Solutions",
            "contact_email": "client@acme.com",
            "is_active": True,
            "created_at": now_str
        }
        c1_res = await client_col.insert_one(c1)
        c1_id = str(c1_res.inserted_id)

        p1 = {
            "project_name": "HRMS Portal Redesign",
            "client_id": c1_id,
            "client_name": "Acme Corp",
            "project_manager_name": "Siddharth Roy",
            "project_manager_email": "siddharth.roy@rexera.com",
            "status": "ACTIVE",
            "budget_hours": 120.0,
            "logged_hours_total": 35.5,
            "start_date": "2026-09-01",
            "created_at": now_str
        }
        p1_res = await proj_col.insert_one(p1)
        p1_id = str(p1_res.inserted_id)

        if all_employees:
            emp1 = all_employees[0]
            emp1_id = str(emp1["_id"])
            t1 = {
                "project_id": p1_id,
                "project_name": "HRMS Portal Redesign",
                "client_id": c1_id,
                "client_name": "Acme Corp",
                "task_title": "Attendance Geofencing Implementation",
                "assigned_to_id": emp1_id,
                "assigned_to_name": emp1.get("full_name", "Aarav Sharma"),
                "assigned_to_email": emp1.get("email"),
                "estimated_hours": 16.0,
                "actual_hours_logged": 8.0,
                "status": "IN_PROGRESS",
                "is_blocked": False,
                "created_at": now_str,
                "updated_at": now_str
            }
            await task_col.insert_one(t1)
        print("[OK] Seeded Sample Client, Project, and Task.")

    # 10. Seed Sample Broadcast
    b_col = get_collection("broadcasts")
    if await b_col.count_documents({}) == 0:
        sample_b = {
            "broadcast_id": "REX-BCAST-0001",
            "title": "Welcome to Rexera Unified HRMS 2.0",
            "rich_html_content": "<p>We are excited to launch the updated <strong>Attendance, Leave Management, and Productivity Tracking Modules</strong>!</p><p>Please familiarize yourself with the shift timing guidelines (09:00 - 09:45 AM on-time window).</p>",
            "priority": "INFO",
            "audience_type": "ALL_EMPLOYEES",
            "requires_acknowledgment": False,
            "total_targeted_recipients": len(all_employees),
            "emails_dispatched_count": len(all_employees),
            "read_count": 0,
            "acknowledged_count": 0,
            "is_active": True,
            "created_by_id": "ADMIN",
            "created_by_name": "HR Superadmin",
            "created_at": now_str
        }
        await b_col.insert_one(sample_b)
        print("[OK] Seeded Sample Company Broadcast Announcement.")

    print("\n[SUCCESS] Database initialization and seed completed successfully!")

if __name__ == "__main__":
    asyncio.run(seed_database())
