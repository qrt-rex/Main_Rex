import asyncio
import httpx

BASE_URL = "http://127.0.0.1:8000"

async def test_import_export():
    async with httpx.AsyncClient(base_url=BASE_URL, timeout=10.0) as client:
        # 1. Login to get JWT
        print("1. Logging in as superadmin...")
        login_res = await client.post("/api/auth/login", json={"email": "hr@rexera.co.in", "password": "Hr@@1234"})
        assert login_res.status_code == 200, f"Login step 1 failed: {login_res.text}"
        
        otp_res = await client.post("/api/auth/verify-2fa", json={"email": "hr@rexera.co.in", "otp": "999999"})
        assert otp_res.status_code == 200, f"2FA failed: {otp_res.text}"
        token = otp_res.json()["access_token"]
        headers = {"Authorization": f"Bearer {token}"}
        print("   -> Logged in successfully.")

        # 2. Test Bulk Employee Import
        print("2. Testing Bulk Employee Import (/api/employees/bulk)...")
        emp_bulk_data = [
            {
                "full_name": "Bulk Emp One",
                "email": "bulk1@rexera.co.in",
                "mobile_number": "9811111111",
                "department": "Engineering",
                "designation": "Backend Engineer",
                "base_salary": 60000,
                "hra": 24000,
                "conveyance_allowance": 2000,
                "special_allowance": 5000,
                "professional_tax": 200,
                "pf_opted": True
            },
            {
                "full_name": "Bulk Emp Two",
                "email": "bulk2@rexera.co.in",
                "mobile_number": "9822222222",
                "department": "HR",
                "designation": "HR Recruiter",
                "base_salary": 45000,
                "hra": 18000,
                "conveyance_allowance": 2000,
                "special_allowance": 3000,
                "professional_tax": 200,
                "pf_opted": True
            }
        ]
        res = await client.post("/api/employees/bulk", json=emp_bulk_data, headers=headers)
        assert res.status_code == 200, f"Employee bulk failed: {res.text}"
        data = res.json()
        print(f"   -> Successfully imported {data['inserted_count']} employees.")

        # 3. Test Bulk Intern Import
        print("3. Testing Bulk Intern Import (/api/interns/bulk)...")
        intern_bulk_data = [
            {
                "full_name": "Bulk Intern Alpha",
                "email": "intern_alpha@college.edu",
                "mobile_number": "9833333333",
                "department": "Engineering",
                "domain_role": "React Developer Intern",
                "college_university": "IIT Bombay",
                "degree": "B.Tech",
                "branch_specialization": "Computer Science",
                "monthly_stipend": 20000,
                "duration_months": 6
            }
        ]
        res = await client.post("/api/interns/bulk", json=intern_bulk_data, headers=headers)
        assert res.status_code == 200, f"Intern bulk failed: {res.text}"
        data = res.json()
        print(f"   -> Successfully enrolled {data['inserted_count']} interns.")

        # 4. Test Bulk Candidate Import
        print("4. Testing Bulk Candidate Import (/api/candidates/bulk)...")
        cand_bulk_data = [
            {
                "candidate_name": "Bulk Candidate Alpha",
                "position_applied": "DevOps Architect",
                "email": "cand_alpha@example.com",
                "contact_number": "9844444444",
                "total_experience": "5 Years",
                "current_ctc": "15 LPA",
                "expected_ctc": "22 LPA"
            }
        ]
        res = await client.post("/api/candidates/bulk", json=cand_bulk_data, headers=headers)
        assert res.status_code == 200, f"Candidate bulk failed: {res.text}"
        data = res.json()
        print(f"   -> Successfully imported {data['inserted_count']} candidates.")

        # 5. Test Export All System Data
        print("5. Testing Full System Export (/api/dashboard/export-all)...")
        res = await client.get("/api/dashboard/export-all", headers=headers)
        assert res.status_code == 200, f"Export all failed: {res.text}"
        backup = res.json()
        print(f"   -> Exported: {len(backup['employees'])} employees, {len(backup['interns'])} interns, {len(backup['candidates'])} candidates, {len(backup['salary_slips'])} salary slips.")

        # 6. Test Import All System Data (Database Restore)
        print("6. Testing Full System Import / Restore (/api/dashboard/import-all)...")
        restore_payload = {
            "employees": [
                {
                    "full_name": "Restored Emp One",
                    "email": "restored1@rexera.co.in",
                    "mobile_number": "9855555555",
                    "department": "Finance",
                    "designation": "Financial Analyst",
                    "base_salary": 55000
                }
            ],
            "interns": [
                {
                    "full_name": "Restored Intern",
                    "email": "restored_intern@college.edu",
                    "mobile_number": "9866666666",
                    "department": "Engineering",
                    "domain_role": "Python Intern",
                    "college_university": "Nirma Univ",
                    "degree": "B.Tech",
                    "branch_specialization": "IT",
                    "monthly_stipend": 18000
                }
            ],
            "candidates": [
                {
                    "candidate_name": "Restored Candidate",
                    "position_applied": "Product Manager",
                    "email": "restored_cand@example.com",
                    "contact_number": "9877777777"
                }
            ]
        }
        res = await client.post("/api/dashboard/import-all", json=restore_payload, headers=headers)
        assert res.status_code == 200, f"Restore all failed: {res.text}"
        restore_res = res.json()
        print(f"   -> {restore_res['message']}")
        print("\n[ALL IMPORT/EXPORT TESTS PASSED 100% SUCCESSFULLY!]")

if __name__ == "__main__":
    asyncio.run(test_import_export())
