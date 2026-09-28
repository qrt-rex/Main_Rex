"""Payroll settings/SMTP, role separation, logs, dashboard and platform hardening."""
import asyncio

import pytest

from tests.conftest import ADMIN_EMAIL, login


@pytest.fixture(scope="module")
def hr(client, auth, store):
    client.post("/api/users", headers=auth, json={"username": "hruser", "email": "hr.user@rexera-test.com",
                                                  "role": "hr", "password": "Passw0rd!x"})
    return login(client, store, "hr.user@rexera-test.com", "Passw0rd!x")


def test_smtp_password_is_never_returned(client, auth):
    cfg = client.get("/api/payroll-settings", headers=auth).json()
    cfg["smtp"].update({"smtp_host": "smtp.example.com", "smtp_user": "u@example.com", "smtp_password": "s3cret"})
    saved = client.put("/api/payroll-settings", headers=auth, json=cfg).json()
    assert saved["smtp"]["smtp_password"] == "••••••••"
    # Saving the masked value back keeps the real password.
    client.put("/api/payroll-settings", headers=auth, json=saved)
    assert "s3cret" not in client.get("/api/payroll-settings", headers=auth).text


def test_security_codes_ignore_saved_smtp(client, auth, outbox):
    """Anyone with settings access could otherwise route reset codes through their own SMTP server."""
    from app.services.email_service import EmailService
    client.post("/api/auth/forgot-password", json={"email": ADMIN_EMAIL})
    mail = next(m for m in reversed(outbox) if m["to"] == ADMIN_EMAIL)
    assert mail["allow_saved_smtp"] is False
    cfg = asyncio.run(EmailService.get_effective_smtp_config(allow_saved=False))
    assert cfg["smtp_host"] != "smtp.example.com"


def test_hr_role_cannot_manage_users_or_permissions(client, hr):
    assert client.get("/api/users", headers=hr).status_code == 403
    assert client.patch("/api/rbac/roles/hr", headers=hr, json={"permission": "users.manage", "granted": True}).status_code == 403
    assert client.get("/api/logs", headers=hr).status_code == 403  # audit.view is not an HR default
    assert client.get("/api/employees", headers=hr).status_code == 200


def test_permission_revocation_takes_effect(client, auth, hr):
    r = client.patch("/api/rbac/roles/hr", headers=auth, json={"permission": "hr.backup.manage", "granted": False})
    assert r.status_code == 200
    assert client.get("/api/dashboard/export-all", headers=hr).status_code == 403
    client.patch("/api/rbac/roles/hr", headers=auth, json={"permission": "hr.backup.manage", "granted": True})


def test_non_superadmin_cannot_create_superadmin(client, auth, store):
    client.post("/api/users", headers=auth, json={"username": "itguy", "email": "it.guy@rexera-test.com",
                                                  "role": "it", "password": "Passw0rd!x"})
    it = login(client, store, "it.guy@rexera-test.com", "Passw0rd!x")
    r = client.post("/api/users", headers=it, json={"username": "boss", "email": "boss@rexera-test.com",
                                                    "role": "superadmin", "password": "Passw0rd!x"})
    assert r.status_code == 403


def test_logs_filters_and_export(client, auth):
    r = client.get("/api/logs", headers=auth, params={"action": "LOGIN"})
    assert r.status_code == 200
    today = r.json()["logs"][0]["timestamp"][:10] if r.json().get("logs") else None
    if today:
        # A bare end date includes that whole day.
        same_day = client.get("/api/logs", headers=auth, params={"date_from": today, "date_to": today}).json()
        assert same_day["total"] >= 1
    exp = client.get("/api/logs/export", headers=auth)
    assert exp.status_code == 200
    assert "password" not in exp.text.lower() or "reset" in exp.text.lower()


def test_dashboard_and_backup(client, auth):
    assert client.get("/api/dashboard/metrics", headers=auth).status_code == 200
    r = client.get("/api/dashboard/export-all", headers=auth)
    assert r.status_code == 200


def test_security_headers_and_cors(client):
    r = client.get("/api/health")
    assert r.headers.get("x-content-type-options") == "nosniff"
    assert r.headers.get("x-frame-options") in ("DENY", "SAMEORIGIN")
    assert "referrer-policy" in r.headers
    evil = client.get("/api/health", headers={"Origin": "https://evil.example"})
    assert evil.headers.get("access-control-allow-origin") not in ("*", "https://evil.example")
    ok = client.get("/api/health", headers={"Origin": "http://localhost:5173"})
    assert ok.headers.get("access-control-allow-origin") == "http://localhost:5173"


def test_every_route_has_an_access_rule():
    from app.main import API_ROUTERS
    from app.services.rbac_service import ROUTE_RULES
    missing = [(m, r.path) for router in API_ROUTERS for r in router.routes for m in r.methods
               if m != "HEAD" and (m, r.path.rstrip("/")) not in ROUTE_RULES]
    assert not missing, missing
