"""Per-user access: extra roles and allow / deny overrides on top of a user's own role."""
import itertools

from tests.conftest import login

_seq = itertools.count(1)


def make_user(client, store, auth, role="employee"):
    n = next(_seq)
    email = f"acc{role}{n}@rexera-test.com"
    r = client.post("/api/users", headers=auth, json={"username": f"acc{role}{n}", "email": email, "role": role, "password": "Passw0rd!x"})
    assert r.status_code == 201, r.text
    return r.json()["id"], email, login(client, store, email, "Passw0rd!x")


def set_access(client, auth, uid, **body):
    return client.put(f"/api/rbac/users/{uid}/access", headers=auth, json=body)


def me(client, h):
    return client.get("/api/rbac/me", headers=h).json()


def test_extra_roles_add_access_on_top_of_the_primary_role(client, store, auth):
    uid, _, h = make_user(client, store, auth, "employee")
    assert "billing.view" not in me(client, h)["permissions"]
    assert client.get("/api/billing/invoices", headers=h).status_code == 403
    assert client.get("/api/users", headers=h).status_code == 403

    r = set_access(client, auth, uid, extra_roles=["sales", "admin"])
    assert r.status_code == 200, r.text
    assert r.json()["extra_roles"] == ["sales", "admin"]
    # Applies on the very next request, no new sign-in: sales gives billing, admin gives user management.
    assert client.get("/api/billing/invoices", headers=h).status_code == 200
    assert client.get("/api/users", headers=h).status_code == 200
    m = me(client, h)
    assert m["role"] == "employee" and m["extra_roles"] == ["sales", "admin"]
    assert {"billing.view", "sales.hub.manage", "users.manage", "hr.broadcasts.view"} <= set(m["permissions"])  # union incl. its own role

    assert set_access(client, auth, uid, extra_roles=[]).status_code == 200  # taking them away removes it again
    assert client.get("/api/billing/invoices", headers=h).status_code == 403
    assert me(client, h)["extra_roles"] == []


def test_allow_and_deny_single_features(client, store, auth):
    uid, _, h = make_user(client, store, auth, "employee")
    assert set_access(client, auth, uid, grants=["billing.view"]).status_code == 200
    assert client.get("/api/billing/invoices", headers=h).status_code == 200
    assert client.post("/api/billing/invoices", headers=h, json={}).status_code == 403  # only the one feature was allowed

    sid, _, sh = make_user(client, store, auth, "sales")
    assert client.get("/api/billing/invoices", headers=sh).status_code == 200
    assert set_access(client, auth, sid, denies=["billing.view"]).status_code == 200
    assert client.get("/api/billing/invoices", headers=sh).status_code == 403  # denied although the sales role has it
    assert "billing.view" not in me(client, sh)["permissions"]
    # A deny beats an allow from another role, and the role itself is unchanged for everyone else.
    assert set_access(client, auth, sid, extra_roles=["hr"], denies=["billing.view"]).status_code == 200
    assert client.get("/api/billing/invoices", headers=sh).status_code == 403
    assert client.get("/api/rbac/users/%s/access" % sid, headers=auth).json()["denies"] == ["billing.view"]


def test_access_validation_and_protection(client, store, auth):
    uid, _, _ = make_user(client, store, auth, "employee")
    assert set_access(client, auth, uid, extra_roles=["nope"]).status_code == 422
    assert set_access(client, auth, uid, extra_roles=["superadmin"]).status_code == 422
    assert set_access(client, auth, uid, grants=["not.a.permission"]).status_code == 422
    assert set_access(client, auth, uid, grants=["billing.view"], denies=["billing.view"]).status_code == 422
    assert set_access(client, auth, "missing", extra_roles=[]).status_code == 404
    # The user's own primary role listed as extra is ignored, not stored twice.
    assert set_access(client, auth, uid, extra_roles=["employee", "sales"]).json()["extra_roles"] == ["sales"]
    # Super Admin accounts and one's own account can't be edited.
    users = client.get("/api/users", headers=auth).json()
    boss = next(u for u in users if u["role"] == "superadmin")
    assert set_access(client, auth, boss["id"], extra_roles=["sales"]).status_code == 400
    assert client.get("/api/users", headers=auth).json()  # listing still works
    listed = next(u for u in client.get("/api/users", headers=auth).json() if u["id"] == uid)
    assert listed["extra_roles"] == ["sales"]


def test_only_permission_managers_and_no_escalation(client, store, auth):
    uid, _, plain = make_user(client, store, auth, "employee")
    target, _, _ = make_user(client, store, auth, "employee")
    assert set_access(client, plain, target, grants=["billing.view"]).status_code == 403  # needs permissions.manage
    # A delegate: allowed to manage access, but only up to what they hold themselves.
    assert set_access(client, auth, uid, grants=["permissions.manage", "billing.view"]).status_code == 200
    assert set_access(client, plain, target, grants=["billing.view"]).status_code == 200
    r = set_access(client, plain, target, grants=["billing.tax_invoice"])
    assert r.status_code == 403 and "only give access you have" in r.json()["detail"]
    assert set_access(client, plain, target, extra_roles=["admin"]).status_code == 403  # admin role holds more than they do
    assert set_access(client, plain, uid, grants=[]).status_code == 400  # not their own


def test_other_features_follow_the_combined_roles(client, store, auth):
    # HR as an extra role lets an employee decide sales leave (leave routing uses all roles)...
    sid, semail, sales_h = make_user(client, store, auth, "sales")
    client.post("/api/employees", headers=auth, json={"full_name": "Multi Sales", "email": semail, "mobile_number": "9822200000",
                                                      "department": "SALES", "designation": "Exec", "date_of_joining": "2026-01-01",
                                                      "base_salary": 30000, "hra": 12000, "professional_tax": 200})
    leave = client.post("/api/leaves/apply-own", headers=sales_h, json={"leave_type": "CL", "start_date": "2027-05-03", "end_date": "2027-05-03", "reason": "Family function"}).json()["data"]
    assert leave["approval_level"] == "HR"
    eid, _, emp_h = make_user(client, store, auth, "employee")
    assert client.post("/api/leaves/decision", headers=emp_h, json={"leave_request_id": leave["id"], "action": "APPROVE"}).status_code == 403
    set_access(client, auth, eid, extra_roles=["hr"])
    ok = client.post("/api/leaves/decision", headers=emp_h, json={"leave_request_id": leave["id"], "action": "APPROVE"})
    assert ok.status_code == 200 and ok.json()["data"]["status"] == "APPROVED"
    # ...and an employee given Sales counts as a sales person for invoices.
    set_access(client, auth, eid, extra_roles=["sales"])
    assert eid and semail in [p["email"] for p in client.get("/api/billing/sales-people", headers=auth).json()["items"]]
    assert any(p["email"].startswith("accemployee") for p in client.get("/api/billing/sales-people", headers=auth).json()["items"])
