import asyncio
import copy
import re
import uuid
import pytest
from datetime import datetime
from fastapi.testclient import TestClient

from app.main import app
from app.config import settings
from app.database import db_manager
import app.database as database
from app.utils.security import hash_password
from app.utils.tokens import create_access_token


class InMemoryCursor:
    def __init__(self, docs):
        self.docs = list(docs)

    def sort(self, key, direction=1):
        def _sort_key(d):
            return d.get(key, "")
        self.docs.sort(key=_sort_key, reverse=(direction == -1))
        return self

    def skip(self, n):
        self.docs = self.docs[n:]
        return self

    def limit(self, n):
        self.docs = self.docs[:n]
        return self

    async def to_list(self, length=None):
        if length is not None:
            return copy.deepcopy(self.docs[:length])
        return copy.deepcopy(self.docs)

    def __iter__(self):
        return iter(self.docs)


class InMemoryCollection:
    def __init__(self, name, store):
        self.name = name
        self.store = store

    def _get_table(self):
        if self.name not in self.store:
            self.store[self.name] = {}
        return self.store[self.name]

    def _matches(self, doc, query):
        if not query:
            return True
        for k, v in query.items():
            if k == "$or":
                if not any(self._matches(doc, q) for q in v):
                    return False
                continue
            if k == "$and":
                if not all(self._matches(doc, q) for q in v):
                    return False
                continue
            
            doc_val = doc.get(k)
            if isinstance(v, dict):
                for op, opval in v.items():
                    if op == "$in":
                        if doc_val not in opval:
                            return False
                    elif op == "$ne":
                        if doc_val == opval:
                            return False
                    elif op == "$gte":
                        if doc_val is None or doc_val < opval:
                            return False
                    elif op == "$lte":
                        if doc_val is None or doc_val > opval:
                            return False
                    elif op == "$gt":
                        if doc_val is None or doc_val <= opval:
                            return False
                    elif op == "$lt":
                        if doc_val is None or doc_val >= opval:
                            return False
                    elif op == "$regex":
                        flags = re.IGNORECASE if v.get("$options") == "i" else 0
                        if not doc_val or not re.search(opval, str(doc_val), flags):
                            return False
            else:
                if doc_val != v:
                    return False
        return True

    async def find_one(self, filter=None, projection=None):
        table = self._get_table()
        for doc in table.values():
            if self._matches(doc, filter or {}):
                return copy.deepcopy(doc)
        return None

    def find(self, filter=None, projection=None):
        table = self._get_table()
        matches = [copy.deepcopy(doc) for doc in table.values() if self._matches(doc, filter or {})]
        return InMemoryCursor(matches)

    async def insert_one(self, document):
        table = self._get_table()
        doc = copy.deepcopy(document)
        if "_id" not in doc:
            doc["_id"] = str(uuid.uuid4())
        doc_id = str(doc["_id"])
        doc["id"] = doc_id
        table[doc_id] = doc
        class Res:
            inserted_id = doc_id
        return Res()

    async def update_one(self, filter, update):
        table = self._get_table()
        for doc_id, doc in table.items():
            if self._matches(doc, filter or {}):
                if "$set" in update:
                    for sk, sv in update["$set"].items():
                        doc[sk] = sv
                if "$inc" in update:
                    for ik, iv in update["$inc"].items():
                        doc[ik] = doc.get(ik, 0) + iv
                return database.UpdateResult(1, 1)
        return database.UpdateResult(0, 0)

    async def delete_one(self, filter):
        table = self._get_table()
        for doc_id, doc in table.items():
            if self._matches(doc, filter or {}):
                del table[doc_id]
                return database.DeleteResult(1)
        return database.DeleteResult(0)

    async def count_documents(self, filter=None):
        table = self._get_table()
        return sum(1 for doc in table.values() if self._matches(doc, filter or {}))


@pytest.fixture
def store(monkeypatch):
    data_store = {}
    monkeypatch.setattr(database, "get_collection", lambda name: InMemoryCollection(name, data_store))
    monkeypatch.setattr(db_manager, "get_collection", lambda name: InMemoryCollection(name, data_store))
    return data_store


@pytest.fixture
def client(store):
    return TestClient(app)


@pytest.fixture
def auth(store):
    superadmin_id = "superadmin-1"
    store["admins"] = {
        superadmin_id: {
            "_id": superadmin_id,
            "id": superadmin_id,
            "username": "superadmin",
            "email": settings.DEFAULT_ADMIN_EMAIL.lower(),
            "password_hash": hash_password(settings.DEFAULT_ADMIN_PASSWORD),
            "role": "superadmin",
            "is_active": True,
            "created_at": datetime.utcnow().isoformat(),
        }
    }
    token = create_access_token({
        "sub": superadmin_id,
        "email": settings.DEFAULT_ADMIN_EMAIL.lower(),
        "username": "superadmin",
        "role": "superadmin",
        "scope": "admin_access",
    })
    return {"Authorization": f"Bearer {token}"}


def user(client, auth_headers, store, email, role):
    user_id = str(uuid.uuid4())
    user_doc = {
        "_id": user_id,
        "id": user_id,
        "username": email.split("@")[0],
        "email": email.strip().lower(),
        "password_hash": hash_password("Password123!"),
        "role": role,
        "is_active": True,
        "created_at": datetime.utcnow().isoformat(),
    }
    if "admins" not in store:
        store["admins"] = {}
    store["admins"][user_id] = user_doc

    token = create_access_token({
        "sub": user_id,
        "email": email.strip().lower(),
        "username": email.split("@")[0],
        "role": role,
        "scope": "admin_access",
    })
    headers = {"Authorization": f"Bearer {token}"}
    return user_doc, headers
