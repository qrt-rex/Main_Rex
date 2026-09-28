"""
Test harness for the Rexera HR API.

Runs the real FastAPI app in-process against an in-memory document store, so the suite
never touches the Postgres/Supabase database in backend/.env and never sends real email.
"""
import os
import sys

# Must be set before `app.config` is imported: env vars override backend/.env.
os.environ.update({
    "POSTGRES_URI": "postgresql+asyncpg://test:test@127.0.0.1:1/unused",
    "DB_SCHEMA": "hr_test",
    "EMAIL_DEV_MODE": "True",
    "BREVO_API_KEY": "",
    "SMTP_PASSWORD": "",
    "SEED_DUMMY_DATA": "False",
    "APP_ENV": "test",
    "DEFAULT_ADMIN_EMAIL": "admin@rexera-test.com",
    "DEFAULT_ADMIN_PASSWORD": "Admin@12345",
    "CORS_ORIGINS": '["http://localhost:5173"]',
})

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

import pytest
from fastapi.testclient import TestClient

from app.database import db_manager
from app.services import email_service as email_module
from tests.memdb import MemStore

# Manual scripts that drive a *running* server (and its real database); never collect them.
collect_ignore = ["test_e2e.py", "test_import_export.py", "test_all_modules_e2e.py"]

ADMIN_EMAIL = "admin@rexera-test.com"
ADMIN_PASSWORD = "Admin@12345"


class Outbox(list):
    def last_to(self, address: str):
        for m in reversed(self):
            if m["to"] == address:
                return m
        return None


@pytest.fixture(scope="session")
def store():
    return MemStore()


@pytest.fixture(scope="session")
def outbox():
    return Outbox()


@pytest.fixture(scope="session")
def client(store, outbox):
    async def fake_connect():
        db_manager.db = object()
        db_manager.is_live_pg = False

    async def fake_close():
        pass

    async def fake_send(cls, to_email, subject, html_content, attachment_bytes=None, attachment_filename=None,
                        allow_saved_smtp=True):
        outbox.append({"to": to_email, "subject": subject, "html": html_content,
                       "attachment": attachment_filename, "attachment_size": len(attachment_bytes or b""),
                       "allow_saved_smtp": allow_saved_smtp})
        return True, None

    mp = pytest.MonkeyPatch()
    mp.setattr(db_manager, "connect", fake_connect)
    mp.setattr(db_manager, "close", fake_close)
    mp.setattr(db_manager, "get_collection", store.collection)
    mp.setattr(email_module.EmailService, "send_email", classmethod(fake_send))

    from app.main import app
    with TestClient(app, raise_server_exceptions=False) as c:
        yield c
    mp.undo()


def otp_for(store: MemStore, email: str, purpose: str) -> str:
    rows = [r for r in store.tables.get("otps", {}).values()
            if r.get("email") == email.lower() and r.get("purpose") == purpose and not r.get("used")]
    assert rows, f"no active {purpose} OTP for {email}"
    return rows[-1]["otp"]


def login(client: TestClient, store: MemStore, email: str, password: str) -> dict:
    r = client.post("/api/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, r.text
    step1 = r.json()
    code = otp_for(store, email, "login_2fa")
    r = client.post("/api/auth/verify-2fa", json={"email": email, "otp": code, "temp_token": step1["temp_token"]})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest.fixture(scope="session")
def auth(client, store):
    return login(client, store, ADMIN_EMAIL, ADMIN_PASSWORD)
