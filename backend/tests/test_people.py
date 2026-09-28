"""Employees, candidates and interns: CRUD, validation and the bugs fixed in this pass."""
import itertools

import pytest

_seq = itertools.count(1)


def emp_payload(**over):
    n = next(_seq)
    body = {
        "full_name": f"Test Employee {n}", "email": f"emp{n}@rexera-test.com", "mobile_number": "98765 43210",
        "department": "SALES", "designation": "BDM", "date_of_joining": "2026-01-15",
        "base_salary": 50000, "hra": 20000, "conveyance_allowance": 2000, "special_allowance": 5000,
        "professional_tax": 200, "pf_opted": True, "bank_name": "HDFC Bank", "account_no": "50100492817264",
        "ifsc_code": "hdfc0001234",
    }
    body.update(over)
    return body


@pytest.fixture(scope="module")
def employee(client, auth):
    r = client.post("/api/employees", headers=auth, json=emp_payload())
    assert r.status_code == 200, r.text
    return r.json()


# ---------------------------------------------------------------- employees

def test_create_employee_normalises_and_computes_salary(client, auth, employee):
    assert employee["employee_code"].startswith("EMP-")
    assert employee["mobile_number"] == "9876543210"
    assert employee["ifsc_code"] == "HDFC0001234"
    assert employee["gross_salary"] == 77000
    assert employee["estimated_net_salary"] == 77000 - 6000 - 200


@pytest.mark.parametrize("override, field", [
    ({"base_salary": -1}, "base_salary"),
    ({"hra": -5}, "hra"),
    ({"mobile_number": "abcdefghij"}, "mobile_number"),
    ({"mobile_number": "12345"}, "mobile_number"),
    ({"ifsc_code": "BADIFSC"}, "ifsc_code"),
    ({"date_of_joining": "31/12/2026"}, "date_of_joining"),
    ({"date_of_joining": "2026-02-30"}, "date_of_joining"),
    ({"employee_status": "Banana"}, "employee_status"),
    ({"full_name": "   "}, "full_name"),
    ({"email": "not-an-email"}, "email"),
])
def test_create_employee_rejects_invalid(client, auth, override, field):
    r = client.post("/api/employees", headers=auth, json=emp_payload(**override))
    assert r.status_code == 422, r.text
    assert any(field in [str(p) for p in e["loc"]] for e in r.json()["detail"]), r.text


def test_blank_bank_details_are_allowed(client, auth):
    r = client.post("/api/employees", headers=auth, json=emp_payload(bank_name="", account_no="", ifsc_code=""))
    assert r.status_code == 200, r.text
    # The old form's placeholder IFSC is treated as blank rather than rejected.
    r = client.post("/api/employees", headers=auth, json=emp_payload(ifsc_code="REX0001"))
    assert r.status_code == 200 and r.json()["ifsc_code"] == ""


def test_duplicate_email_rejected_case_insensitively(client, auth, employee):
    r = client.post("/api/employees", headers=auth, json=emp_payload(email=employee["email"].upper()))
    assert r.status_code == 409


def test_duplicate_employee_code_rejected(client, auth, employee):
    r = client.post("/api/employees", headers=auth, json=emp_payload(employee_code=employee["employee_code"]))
    assert r.status_code == 409


def test_update_email_to_someone_elses_rejected(client, auth, employee):
    other = client.post("/api/employees", headers=auth, json=emp_payload()).json()
    r = client.put(f"/api/employees/{other['id']}", headers=auth, json={"email": employee["email"]})
    assert r.status_code == 409
    # Keeping your own email is fine.
    r = client.put(f"/api/employees/{employee['id']}", headers=auth, json={"email": employee["email"]})
    assert r.status_code == 200


def test_update_recalculates_and_validates(client, auth, employee):
    r = client.put(f"/api/employees/{employee['id']}", headers=auth, json={"base_salary": 60000})
    assert r.status_code == 200 and r.json()["gross_salary"] == 87000
    assert client.put(f"/api/employees/{employee['id']}", headers=auth, json={"base_salary": -10}).status_code == 422
    assert client.put(f"/api/employees/{employee['id']}", headers=auth, json={"mobile_number": "x"}).status_code == 422
    assert client.put("/api/employees/nope", headers=auth, json={"designation": "X"}).status_code == 404


def test_masked_account_number_never_overwrites_real_one(client, auth, employee):
    masked = client.get(f"/api/employees/{employee['id']}", headers=auth).json()["account_no"]
    assert "•" in masked
    client.put(f"/api/employees/{employee['id']}", headers=auth, json={"account_no": masked})
    real = client.get(f"/api/employees/{employee['id']}", headers=auth, params={"unmask": "true"}).json()["account_no"]
    assert real == "50100492817264"


def test_list_search_filters_and_pagination(client, auth, employee):
    r = client.get("/api/employees", headers=auth, params={"search": employee["full_name"]})
    assert r.status_code == 200 and r.json()["total"] >= 1
    assert all("•" in e["account_no"] or not e["account_no"] for e in r.json()["employees"])
    r = client.get("/api/employees", headers=auth, params={"limit": 1, "page": 2})
    assert r.status_code == 200 and len(r.json()["employees"]) == 1
    assert client.get("/api/employees", headers=auth, params={"limit": 2001}).status_code == 422


@pytest.mark.parametrize("term", ["(", "[a-", "*", "\\", "a+b", ".*"])
def test_search_with_regex_characters_does_not_crash(client, auth, term):
    for path in ("/api/employees", "/api/candidates", "/api/interns", "/api/logs", "/api/payroll"):
        r = client.get(path, headers=auth, params={"search": term})
        assert r.status_code == 200, (path, term, r.text)


def test_employee_codes_unique_after_delete(client, auth):
    a = client.post("/api/employees", headers=auth, json=emp_payload()).json()
    b = client.post("/api/employees", headers=auth, json=emp_payload()).json()
    assert client.delete(f"/api/employees/{a['id']}", headers=auth).status_code == 200
    c = client.post("/api/employees", headers=auth, json=emp_payload()).json()
    assert c["employee_code"] not in (a["employee_code"], b["employee_code"])
    assert client.get(f"/api/employees/{a['id']}", headers=auth).status_code == 404


def test_bulk_employee_import_reports_bad_rows(client, auth):
    rows = [
        {"full_name": "Bulk Good", "email": "bulk.good@rexera-test.com", "mobile_number": 9812345678,
         "date_of_joining": "2026-03-01", "base_salary": "40000", "pf_opted": "No", "account_no": 50100492817264},
        {"full_name": "Bulk Bad", "email": "bulk.bad@rexera-test.com", "mobile_number": "123"},
    ]
    r = client.post("/api/employees/bulk", headers=auth, json=rows)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["inserted_count"] == 1 and body["failed_count"] == 1
    assert "mobile" in body["errors"][0]["error"].lower()
    emp = client.get("/api/employees", headers=auth, params={"search": "Bulk Good"}).json()["employees"][0]
    assert emp["pf_opted"] is False  # "No" used to be truthy
    full = client.get(f"/api/employees/{emp['id']}", headers=auth, params={"unmask": "true"}).json()
    assert full["account_no"] == "50100492817264"


# ---------------------------------------------------------------- candidates

def cand_payload(**over):
    n = next(_seq)
    body = {"candidate_name": f"Cand {n}", "position_applied": "BDM", "contact_number": "+91 91234 56789",
            "email": f"cand{n}@rexera-test.com", "interview_date": "2026-10-01"}
    body.update(over)
    return body


def test_public_application_and_duplicates(client, auth):
    body = cand_payload()
    assert client.post("/api/candidates", json=body).status_code == 200
    dup = client.post("/api/candidates", json={**body, "email": body["email"].upper(), "position_applied": "bdm"})
    assert dup.status_code == 409
    # Same person, different role: allowed.
    assert client.post("/api/candidates", json={**body, "position_applied": "Sales TL"}).status_code == 200


@pytest.mark.parametrize("override", [{"contact_number": "12ab"}, {"email": "bad"}, {"candidate_name": ""},
                                      {"interview_date": "tomorrow"}])
def test_application_validation(client, override):
    assert client.post("/api/candidates", json=cand_payload(**override)).status_code == 422


def test_candidate_markup_is_neutralised(client, auth):
    body = cand_payload(candidate_name="<script>alert(1)</script>")
    assert client.post("/api/candidates", json=body).status_code == 200
    found = client.get("/api/candidates", headers=auth, params={"search": body["email"]}).json()["candidates"][0]
    assert "<script>" not in found["candidate_name"]


def test_candidate_status_rules(client, auth):
    cid = client.post("/api/candidates", json=cand_payload()).json()["candidate_id"]
    assert client.patch(f"/api/candidates/{cid}/status", headers=auth, json={"status": "Banana"}).status_code == 422
    assert client.patch(f"/api/candidates/{cid}/status", headers=auth, json={"status": "Rejected"}).status_code == 400
    ok = client.patch(f"/api/candidates/{cid}/status", headers=auth, json={"status": "screening"})
    assert ok.status_code == 200 and ok.json()["status"] == "Screening"
    assert client.put(f"/api/candidates/{cid}", headers=auth, json={"status": "Nope"}).status_code == 422
    assert client.patch("/api/candidates/missing/status", headers=auth, json={"status": "Screening"}).status_code == 404


def test_candidate_sort_by_is_whitelisted(client, auth):
    """sort_by was interpolated into ORDER BY: a SQL injection vector."""
    bad = client.get("/api/candidates", headers=auth, params={"sort_by": "x') DESC; DROP TABLE t; --"})
    assert bad.status_code == 422
    ok = client.get("/api/candidates", headers=auth, params={"sort_by": "candidate_name", "sort_desc": "false"})
    assert ok.status_code == 200


def test_candidate_export_limit(client, auth):
    """The Recruitment page's export asks for 2000 rows; the API used to cap at 100 and 422."""
    assert client.get("/api/candidates", headers=auth, params={"limit": 2000}).status_code == 200


def test_candidate_bulk(client, auth):
    rows = [{"candidate_name": "Bulk C", "email": "bulkc@rexera-test.com", "contact_number": 9765432109,
             "position_applied": "BDM"},
            {"candidate_name": "Bulk C", "email": "bulkc@rexera-test.com", "contact_number": 9765432109,
             "position_applied": "BDM"},
            {"candidate_name": "No Phone", "email": "nophone@rexera-test.com"}]
    body = client.post("/api/candidates/bulk", headers=auth, json=rows).json()
    assert body["inserted_count"] == 1 and body["failed_count"] == 2


def test_candidate_delete(client, auth):
    cid = client.post("/api/candidates", json=cand_payload()).json()["candidate_id"]
    assert client.delete(f"/api/candidates/{cid}", headers=auth).status_code == 200
    assert client.get(f"/api/candidates/{cid}", headers=auth).status_code == 404


# ---------------------------------------------------------------- interns

def intern_payload(**over):
    n = next(_seq)
    body = {"full_name": f"Intern {n}", "email": f"intern{n}@rexera-test.com", "mobile_number": "9877112233",
            "college_university": "Nirma", "degree": "BBA", "branch_specialization": "Marketing",
            "department": "SALES", "domain_role": "Sales Intern", "assigned_mentor": "Mentor",
            "start_date": "2026-09-01", "end_date": "2026-12-31", "monthly_stipend": 15000,
            "account_no": "123456789012", "ifsc_code": "SBIN0001234"}
    body.update(over)
    return body


@pytest.mark.parametrize("override", [{"end_date": "2026-08-01"}, {"monthly_stipend": -1},
                                      {"mobile_number": "000"}, {"start_date": "01-09-2026"},
                                      {"status": "Whatever"}, {"performance_rating": 9}])
def test_intern_validation(client, auth, override):
    assert client.post("/api/interns", headers=auth, json=intern_payload(**override)).status_code == 422


def test_intern_update_checks_dates_against_stored_record(client, auth):
    i = client.post("/api/interns", headers=auth, json=intern_payload()).json()
    assert client.put(f"/api/interns/{i['id']}", headers=auth, json={"end_date": "2026-01-01"}).status_code == 422
    assert client.put(f"/api/interns/{i['id']}", headers=auth, json={"end_date": "2027-01-31"}).status_code == 200
    assert client.put("/api/interns/nope", headers=auth, json={"degree": "X"}).status_code == 404


def test_intern_bank_number_masked_unless_permitted(client, auth):
    i = client.post("/api/interns", headers=auth, json=intern_payload()).json()
    assert "•" in i["account_no"]
    listed = client.get("/api/interns", headers=auth).json()["interns"]
    assert all(not x["account_no"] or "•" in x["account_no"] for x in listed)
    full = client.get(f"/api/interns/{i['id']}", headers=auth, params={"unmask": "true"}).json()
    assert full["account_no"] == "123456789012"


def test_intern_codes_unique_after_delete(client, auth):
    a = client.post("/api/interns", headers=auth, json=intern_payload()).json()
    b = client.post("/api/interns", headers=auth, json=intern_payload()).json()
    client.delete(f"/api/interns/{a['id']}", headers=auth)
    c = client.post("/api/interns", headers=auth, json=intern_payload()).json()
    assert c["intern_code"] not in (a["intern_code"], b["intern_code"])


def test_intern_conversion(client, auth):
    i = client.post("/api/interns", headers=auth, json=intern_payload()).json()
    conv = {"designation": "BDM", "date_of_joining": "2027-01-01", "base_salary": 30000}
    r = client.post(f"/api/interns/{i['id']}/convert", headers=auth, json=conv)
    assert r.status_code == 200, r.text
    assert "•" in r.json()["employee"]["account_no"]
    assert client.post(f"/api/interns/{i['id']}/convert", headers=auth, json=conv).status_code == 400
    assert client.post("/api/interns/missing/convert", headers=auth, json=conv).status_code == 404
    assert client.post(f"/api/interns/{i['id']}/convert", headers=auth,
                       json={**conv, "base_salary": 0}).status_code == 422


def test_intern_bulk(client, auth):
    rows = [{"full_name": "Bulk I", "email": "bulki@rexera-test.com", "mobile_number": 9877112299,
             "start_date": "2026-09-01", "end_date": "2026-12-01", "duration_months": "3"},
            {"full_name": "Bad I", "email": "badi@rexera-test.com", "mobile_number": "1"}]
    body = client.post("/api/interns/bulk", headers=auth, json=rows).json()
    assert body["inserted_count"] == 1 and body["failed_count"] == 1
