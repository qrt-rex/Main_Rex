"""
API tests run the real app against a real PostgreSQL in a throwaway schema (dropped afterwards).
Point TEST_POSTGRES_URI at a database you can create schemas in, e.g.

    TEST_POSTGRES_URI=postgresql+asyncpg://postgres:postgres@localhost:5432/rexera_hr pytest

Without it the API tests are skipped (the PF engine tests still run).
"""
import os
import uuid

import pytest

TEST_URI = os.environ.get("TEST_POSTGRES_URI", "")


class Api:
    """A TestClient plus helpers to sign in as any account and to run database coroutines on the app's loop."""

    def __init__(self, client):
        self.client = client

    def run(self, fn, *args):
        return self.client.portal.call(fn, *args)

    def token_for(self, email: str) -> str:
        from app.database import get_collection
        from app.utils.tokens import create_access_token

        async def find():
            return await get_collection("admins").find_one({"email": email.lower()})
        admin = self.run(find)
        assert admin, f"no account {email}"
        return create_access_token({"sub": str(admin["_id"]), "email": admin["email"], "scope": "admin_access"})

    def as_(self, email: str):
        token = self.token_for(email)
        client = self.client

        class _As:
            def __getattr__(self, method):
                def call(url, **kw):
                    headers = {**kw.pop("headers", {}), "Authorization": f"Bearer {token}"}
                    return getattr(client, method)(url, headers=headers, **kw)
                return call
        return _As()


@pytest.fixture(scope="session")
def api():
    if not TEST_URI:
        pytest.skip("Set TEST_POSTGRES_URI to run the API tests against PostgreSQL.")
    from app.config import settings
    schema = f"pf_test_{uuid.uuid4().hex[:10]}"
    settings.POSTGRES_URI = TEST_URI
    settings.DB_SCHEMA = schema
    settings.APP_ENV = "test"
    settings.EMAIL_DEV_MODE = True
    settings.AUTOMATIONS_ENABLED = False
    settings.SEED_DUMMY_DATA = False

    from fastapi.testclient import TestClient
    from app.main import app
    with TestClient(app) as client:
        api = Api(client)
        yield api

        async def drop():
            from sqlalchemy import text
            from app.database import db_manager
            async with db_manager.engine.begin() as conn:
                await conn.execute(text(f"DROP SCHEMA IF EXISTS {schema} CASCADE"))
        api.run(drop)
