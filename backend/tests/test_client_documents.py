"""Client document forms: submitted by staff from their dashboard, reviewed by Legal."""
from tests.conftest import login

FORM = {"name": "Riya Shah", "email": "riya@clientco.test", "phone": "9876543210", "company_name": "ClientCo Pvt Ltd",
        "gst_number": "24ABCDE1234F1Z5", "pan_number": "ABCDE1234F", "company_pan_number": "AABCC1234D",
        "aadhaar_number": "1234 5678 9012", "note": "Needs GST filing"}


def employee_headers(client, auth, store, email="doc.staff@rexera-test.com"):
    client.post("/api/users", headers=auth, json={"username": "docstaff", "email": email, "role": "employee", "password": "Passw0rd!x"})
    return login(client, store, email, "Passw0rd!x")


def submit(client, headers, data=None, files=None):
    return client.post("/api/client-documents", headers=headers, data=data or FORM, files=files or {})


def test_employee_submits_and_legal_reviews(client, auth, store):
    staff = employee_headers(client, auth, store)
    files = [("coi", ("coi.pdf", b"%PDF-1.4 coi", "application/pdf")),
             ("bank_statement", ("statement.pdf", b"%PDF-1.4 bank", "application/pdf")),
             ("other_documents", ("moa.docx", b"docx bytes", "application/vnd.openxmlformats-officedocument.wordprocessingml.document")),
             ("other_documents", ("photo.jpg", b"jpeg bytes", "image/jpeg"))]
    r = submit(client, staff, files=files)
    assert r.status_code == 201, r.text
    sub = r.json()["submission"]
    assert sub["reference"].startswith("DOC-") and sub["file_count"] == 4 and sub["status"] == "PENDING"

    mine = client.get("/api/client-documents/mine", headers=staff).json()["items"]
    assert [m["id"] for m in mine] == [sub["id"]]
    # Staff can't open the Legal review list or the files.
    assert client.get("/api/client-documents", headers=staff).status_code == 403
    assert client.get(f"/api/client-documents/{sub['id']}", headers=staff).status_code == 403

    listed = client.get("/api/client-documents", headers=auth, params={"search": "ClientCo"}).json()
    row = next(i for i in listed["items"] if i["id"] == sub["id"])
    assert row["aadhaar_number"] == "XXXX XXXX 9012" and "files" not in row

    detail = client.get(f"/api/client-documents/{sub['id']}", headers=auth).json()
    assert detail["aadhaar_number"] == "123456789012" and detail["gst_number"] == "24ABCDE1234F1Z5"
    coi = next(f for f in detail["files"] if f["field"] == "coi")
    dl = client.get(f"/api/client-documents/{sub['id']}/files/{coi['file_id']}", headers=auth)
    assert dl.status_code == 200 and dl.content == b"%PDF-1.4 coi" and "coi.pdf" in dl.headers["content-disposition"]
    assert sum(1 for f in detail["files"] if f["field"] == "other_documents") == 2

    r = client.patch(f"/api/client-documents/{sub['id']}/status", headers=auth, json={"status": "APPROVED", "legal_note": "All verified"})
    assert r.status_code == 200
    assert client.patch(f"/api/client-documents/{sub['id']}/status", headers=auth, json={"status": "Banana"}).status_code == 422
    after = client.get(f"/api/client-documents/{sub['id']}", headers=auth).json()
    assert after["status"] == "APPROVED" and after["legal_note"] == "All verified"


def test_every_field_is_optional(client, auth):
    # Nothing is required and odd formats are kept as typed (the form only warns).
    r = submit(client, auth, {"name": "asdfg", "email": "dfghjk", "phone": "dfghjk", "gst_number": "fghjk", "pan_number": "dfghj"})
    assert r.status_code == 201, r.text
    detail = client.get(f"/api/client-documents/{r.json()['submission']['id']}", headers=auth).json()
    assert (detail["email"], detail["phone"], detail["gst_number"], detail["pan_number"]) == ("dfghjk", "dfghjk", "FGHJK", "DFGHJ")
    # A lone document is enough, and a +91 number is still tidied up.
    assert submit(client, auth, {"phone": "+91 98765 43210"}).json()["submission"]["phone"] == "9876543210"
    only_file = client.post("/api/client-documents", headers=auth, data={}, files=[("itr", ("itr.pdf", b"%PDF", "application/pdf"))])
    assert only_file.status_code == 201, only_file.text
    listed = client.get("/api/legal/clients", headers=auth, params={"kind": "document"}).json()["items"]
    assert any(c["company_name"] == "asdfg" for c in listed)  # no company name: shown by contact name


def test_validation(client, auth):
    assert client.post("/api/client-documents", headers=auth, data={"name": "  "}).status_code == 422  # completely empty
    assert submit(client, auth, files=[("itr", ("itr.exe", b"MZ", "application/octet-stream"))]).status_code == 422
    big = b"x" * (10 * 1024 * 1024 + 1)
    assert submit(client, auth, files=[("itr", ("itr.pdf", big, "application/pdf"))]).status_code == 422


def test_roles_without_permission_cannot_submit(client, auth, store):
    client.post("/api/users", headers=auth, json={"username": "itdoc", "email": "it.doc@rexera-test.com", "role": "it", "password": "Passw0rd!x"})
    headers = login(client, store, "it.doc@rexera-test.com", "Passw0rd!x")
    assert submit(client, headers).status_code == 403
