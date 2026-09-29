"""
Tests for Google Workspace Authentication with strict domain enforcement:
Allowed: @rexera.co.in, @rexera.in, @rexera.com
Blocked: all other domains
"""
import pytest
from app.services.google_auth_service import is_rexera_domain, ALLOWED_DOMAINS


def test_domain_validation_helper():
    # Valid domains
    assert is_rexera_domain("admin@rexera.co.in") is True
    assert is_rexera_domain("sales@rexera.in") is True
    assert is_rexera_domain("employee@rexera.com") is True
    assert is_rexera_domain("FIRST.LAST@REXERA.CO.IN") is True

    # Blocked domains
    assert is_rexera_domain("user@gmail.com") is False
    assert is_rexera_domain("user@yahoo.com") is False
    assert is_rexera_domain("user@rexera.org") is False
    assert is_rexera_domain("user@rexera.co") is False
    assert is_rexera_domain("user@fake-rexera.com") is False
    assert is_rexera_domain("") is False
    assert is_rexera_domain(None) is False


def test_google_config_endpoint(client):
    res = client.get("/api/auth/google/config")
    assert res.status_code == 200
    data = res.json()
    assert "allowed_domains" in data
    assert "@rexera.co.in" in data["allowed_domains"]
    assert "@rexera.in" in data["allowed_domains"]
    assert "@rexera.com" in data["allowed_domains"]


def test_google_auth_rejects_external_domains(client):
    external_emails = [
        "hacker@gmail.com",
        "contractor@outlook.com",
        "phishing@rexera.net",
        "attacker@otherdomain.com",
    ]
    for email in external_emails:
        res = client.post("/api/auth/google", json={"email": email})
        assert res.status_code == 403
        assert "Only @rexera.co.in, @rexera.in, and @rexera.com" in res.json()["detail"]


def test_google_auth_accepts_rexera_domains(client):
    allowed_emails = [
        "dhairya@rexera.co.in",
        "tech@rexera.in",
        "finance@rexera.com",
    ]
    for email in allowed_emails:
        res = client.post("/api/auth/google", json={"email": email})
        assert res.status_code == 200
        data = res.json()
        assert data["access_token"] is not None
        assert data["email"] == email.lower()
        assert data["role"] is not None

        # Verify access token works with /api/auth/me
        headers = {"Authorization": f"Bearer {data['access_token']}"}
        me_res = client.get("/api/auth/me", headers=headers)
        assert me_res.status_code == 200
        assert me_res.json()["email"] == email.lower()
