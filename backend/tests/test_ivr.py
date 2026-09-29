"""IVR dialer proxy: sign-in, token handling and data calls against a fake IVR provider."""
import json

import httpx
import pytest

from app.config import settings
from app.routers import ivr as ivr_router
from tests.test_sales_hub import user

IVR_USER = {"id": 1220, "name": "Rexera Test Co", "email": "ivr@rexera-test.com", "role": "company_admin",
            "company": {"id": 74, "code": "RT", "click_to_call_api_enabled": True}}


def fake_ivr(request: httpx.Request) -> httpx.Response:
    path = request.url.path
    auth = request.headers.get("authorization", "")
    if path == "/api/auth/login":
        body = json.loads(request.content)
        if body == {"email": "ivr@rexera-test.com", "password": "right", "clientApp": "dialer"}:
            return httpx.Response(200, json={"success": True, "message": "Login successful",
                                             "data": {"user": IVR_USER, "accessToken": "acc-1", "refreshToken": "ref-1"}})
        return httpx.Response(401, json={"success": False, "message": "Invalid credentials"})
    if path == "/api/auth/refresh":
        if json.loads(request.content) == {"refreshToken": "ref-1"}:
            return httpx.Response(200, json={"success": True, "data": {"accessToken": "acc-2"}})
        return httpx.Response(401, json={"success": False, "message": "Refresh token expired"})
    if auth not in ("Bearer acc-1", "Bearer acc-2"):
        return httpx.Response(401, json={"success": False, "message": "Token expired"})
    if path == "/api/ivr/campaigns" and request.method == "GET":
        return httpx.Response(200, json={"success": True, "data": [{"id": 7, "name": "GST BLAST", "status": "running"}],
                                         "echo": dict(request.url.params)})
    if path == "/api/dialer/call":
        return httpx.Response(200, json={"success": True, "data": {"call_id": "c-1", "sent": json.loads(request.content)}})
    if path == "/api/ivr/campaigns/7/pause":
        return httpx.Response(200, json={"success": True})
    return httpx.Response(404, json={"success": False, "message": "Not found"})


@pytest.fixture
def ivr(monkeypatch):
    monkeypatch.setattr(settings, "IVR_API_BASE_URL", "https://ivr.example.test/")
    monkeypatch.setattr(ivr_router, "_client", lambda: httpx.AsyncClient(transport=httpx.MockTransport(fake_ivr)))


def test_ivr_not_configured(client, auth, monkeypatch):
    monkeypatch.setattr(settings, "IVR_API_BASE_URL", "")
    assert client.get("/api/ivr/status", headers=auth).json() == {"configured": False}
    r = client.post("/api/ivr/login", headers=auth, json={"email": "a@b.co", "password": "x"})
    assert r.status_code == 503 and "IVR_API_BASE_URL" in r.json()["detail"]


def test_ivr_login_data_and_refresh(client, auth, store, ivr):
    _, rep_h = user(client, auth, store, "ivr.rep@rexera-test.com", "sales")
    assert client.get("/api/ivr/status", headers=rep_h).json() == {"configured": True}

    # Needs a CRM session first; wrong IVR credentials are a 400 (never a 401 that would end the CRM session).
    assert client.post("/api/ivr/login", json={"email": "ivr@rexera-test.com", "password": "right"}).status_code == 401
    bad = client.post("/api/ivr/login", headers=rep_h, json={"email": "ivr@rexera-test.com", "password": "wrong"})
    assert bad.status_code == 400 and bad.json()["detail"] == "Invalid credentials"

    s = client.post("/api/ivr/login", headers=rep_h, json={"email": " ivr@rexera-test.com ", "password": "right"}).json()
    assert s == {"user": IVR_USER, "accessToken": "acc-1", "refreshToken": "ref-1"}

    # Data calls carry the IVR token; query params pass through.
    r = client.get("/api/ivr/data/campaigns?page=2", headers={**rep_h, "X-IVR-Token": "acc-1"})
    assert r.status_code == 200 and r.json()["data"][0]["name"] == "GST BLAST" and r.json()["echo"] == {"page": "2"}
    assert client.get("/api/ivr/data/campaigns", headers=rep_h).status_code == 419
    assert client.get("/api/ivr/data/campaigns", headers={**rep_h, "X-IVR-Token": "stale"}).status_code == 419
    assert client.get("/api/ivr/data/secrets", headers={**rep_h, "X-IVR-Token": "acc-1"}).status_code == 404
    missing = client.get("/api/ivr/data/dids", headers={**rep_h, "X-IVR-Token": "acc-1"})
    assert missing.status_code == 502

    # Refresh keeps the old refresh token when the IVR doesn't rotate it.
    assert client.post("/api/ivr/refresh", headers=rep_h, json={"refreshToken": "ref-1"}).json() == \
        {"user": None, "accessToken": "acc-2", "refreshToken": "ref-1"}
    assert client.post("/api/ivr/refresh", headers=rep_h, json={"refreshToken": "ref-old-xx"}).status_code == 419

    # Click-to-call normalises the number; sales staff can't run campaign actions.
    call = client.post("/api/ivr/call", headers={**rep_h, "X-IVR-Token": "acc-2"}, json={"destination_number": "+91 98765-00101"})
    assert call.status_code == 200 and call.json()["data"]["sent"] == {"destination_number": "+919876500101"}
    call = client.post("/api/ivr/call", headers={**rep_h, "X-IVR-Token": "acc-2"},
                       json={"destination_number": "9876500101", "caller_did": "0794000", "campaign_id": "31"})
    assert call.json()["data"]["sent"] == {"destination_number": "9876500101", "caller_did": "0794000", "campaign_id": "31"}
    assert client.post("/api/ivr/call", headers={**rep_h, "X-IVR-Token": "acc-2"}, json={"destination_number": "call me maybe"}).status_code == 422
    assert client.post("/api/ivr/campaigns/7/pause", headers={**rep_h, "X-IVR-Token": "acc-2"}).status_code == 403
    assert client.post("/api/ivr/campaigns/7/pause", headers={**auth, "X-IVR-Token": "acc-2"}).status_code == 200
    assert client.post("/api/ivr/campaigns/7/explode", headers={**auth, "X-IVR-Token": "acc-2"}).status_code == 404
