from tests.conftest import ADMIN_EMAIL


def test_health(client):
    r = client.get("/api/health")
    assert r.status_code == 200
    assert r.json()["status"] == "healthy"


def test_login_and_me(client, auth):
    r = client.get("/api/auth/me", headers=auth)
    assert r.status_code == 200, r.text
    assert r.json()["email"] == ADMIN_EMAIL
    assert r.json()["role"] == "superadmin"
