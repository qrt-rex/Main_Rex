import json
import re
import uuid
import asyncio
import logging
from typing import Any, Dict, List, Optional
from datetime import datetime, date

from sqlalchemy.ext.asyncio import create_async_engine, AsyncEngine
from sqlalchemy import text

from app.config import settings

logger = logging.getLogger("rexera.database")
logging.basicConfig(level=logging.INFO)

# Every collection the app uses; tables for these are created up front on connect().
KNOWN_COLLECTIONS = [
    "absenteeism_telemetry", "admins", "advance_transactions", "attendance",
    "attendance_settings", "audit_logs", "bonuses", "broadcast_receipts",
    "broadcasts", "candidates", "clients", "email_logs", "employee_loans",
    "employees", "import_jobs", "interns", "joining_tokens", "leave_balances",
    "leave_requests", "loan_transactions", "notifications", "onboarding_submissions",
    "otps", "overtime", "payroll_revisions", "payroll_settings", "payrolls",
    "project_tasks", "projects", "report_jobs", "salary_advances", "salary_slips",
    "salary_structures", "timesheets", "activity_logs", "role_permissions",
    "billing_invoices", "billing_quotations", "billing_clients", "billing_products",
    "billing_payments", "billing_branches", "billing_settings", "billing_counters",
    "legal_records", "automations", "automation_runs", "client_documents", "client_document_files",
    "sales_leads", "sales_calls", "sales_schemes", "sales_materials", "sales_material_files", "sales_day_sessions",
]


class InsertResult:
    def __init__(self, inserted_id):
        self.inserted_id = inserted_id


class UpdateResult:
    def __init__(self, matched_count: int, modified_count: int):
        self.matched_count = matched_count
        self.modified_count = modified_count


class DeleteResult:
    def __init__(self, deleted_count: int):
        self.deleted_count = deleted_count


def _json_default(obj):
    if isinstance(obj, (datetime, date)):
        return obj.isoformat()
    raise TypeError(f"Object of type {type(obj)} is not JSON serializable")


def _dumps(value: Any) -> str:
    return json.dumps(value, default=_json_default)


# ---------------------------------------------------------------------------
# PostgreSQL engine: one table per collection, `id text primary key` +
# `data jsonb`, so every existing Mongo-style query in the codebase
# (find_one/find/insert_one/update_one/delete_one/count_documents, with
# $in/$gte/$lte/$gt/$lt/$ne/$regex/$or/$and filters) keeps working unchanged.
# ---------------------------------------------------------------------------

def _validate_table_name(name: str) -> str:
    if not name.replace("_", "").isalnum() or not name[0].isalpha():
        raise ValueError(f"Unsafe collection name: {name}")
    return name


_SAFE_KEY = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$")


def _key_path(key: str) -> List[str]:
    """Field names are interpolated into SQL, so only plain identifiers (optionally dotted) are allowed."""
    if not isinstance(key, str) or not _SAFE_KEY.match(key):
        raise ValueError(f"Unsafe field name in query: {key!r}")
    return key.split(".")


def _json_ref(key: str, as_text: bool) -> str:
    """SQL for a (possibly dotted) field: data->'a' / data->>'a', or data#>'{a,b}' / data#>>'{a,b}'."""
    parts = _key_path(key)
    if len(parts) == 1:
        return f"data{'->>' if as_text else '->'}'{parts[0]}'"
    return f"data{'#>>' if as_text else '#>'}'{{{','.join(parts)}}}'"


def _nest(key: str, value: Any) -> Dict[str, Any]:
    """{'a.b': v} -> {'a': {'b': v}} so dotted keys match nested documents via jsonb containment."""
    parts = _key_path(key)
    out: Any = value
    for p in reversed(parts):
        out = {p: out}
    return out


def _build_field_clause(key: str, val: Any, params: Dict[str, Any], counter: List[int]) -> str:
    is_id = (key == "_id")

    def next_param(value: Any) -> str:
        pname = f"p{counter[0]}"
        counter[0] += 1
        params[pname] = value
        return pname

    if isinstance(val, dict) and any(isinstance(k, str) and k.startswith("$") for k in val.keys()):
        clauses = []
        for op, opval in val.items():
            if op == "$options":
                continue
            if op == "$in":
                if is_id:
                    names = [f":{next_param(str(item))}" for item in opval]
                    clauses.append(f"id IN ({', '.join(names)})" if names else "FALSE")
                else:
                    ors = [f"data @> (:{next_param(_dumps(_nest(key, item)))})::jsonb" for item in opval]
                    clauses.append("(" + " OR ".join(ors) + ")" if ors else "FALSE")
            elif op == "$ne":
                if is_id:
                    clauses.append(f"id != :{next_param(str(opval))}")
                else:
                    clauses.append(f"NOT (data @> (:{next_param(_dumps(_nest(key, opval)))})::jsonb)")
            elif op in ("$gte", "$lte", "$gt", "$lt"):
                sqlop = {"$gte": ">=", "$lte": "<=", "$gt": ">", "$lt": "<"}[op]
                if is_id:
                    clauses.append(f"id {sqlop} :{next_param(str(opval))}")
                else:
                    clauses.append(f"({_json_ref(key, as_text=False)}) {sqlop} (:{next_param(_dumps(opval))})::jsonb")
            elif op == "$regex":
                case_insensitive = val.get("$options") == "i"
                sqlop = "~*" if case_insensitive else "~"
                col = "id" if is_id else _json_ref(key, as_text=True)
                clauses.append(f"{col} {sqlop} :{next_param(opval)}")
            else:
                raise ValueError(f"Unsupported query operator: {op}")
        return " AND ".join(clauses) if clauses else "TRUE"

    if is_id:
        return f"id = :{next_param(str(val))}"
    return f"data @> (:{next_param(_dumps(_nest(key, val)))})::jsonb"


def build_where(filter: Optional[Dict[str, Any]], params: Dict[str, Any], counter: List[int]) -> str:
    if not filter:
        return "TRUE"
    clauses = []
    for k, v in filter.items():
        if k == "$or":
            sub = [build_where(item, params, counter) for item in v]
            clauses.append("(" + " OR ".join(sub) + ")")
        elif k == "$and":
            sub = [build_where(item, params, counter) for item in v]
            clauses.append("(" + " AND ".join(sub) + ")")
        else:
            clauses.append(_build_field_clause(k, v, params, counter))
    return " AND ".join(clauses) if clauses else "TRUE"


def _row_to_doc(row) -> Dict[str, Any]:
    doc = dict(row.data)
    doc["_id"] = row.id
    return doc


def _apply_projection(doc: Dict[str, Any], projection: Optional[Dict[str, int]]) -> Dict[str, Any]:
    if not projection:
        return doc
    include_keys = [k for k, v in projection.items() if v == 1]
    exclude_keys = [k for k, v in projection.items() if v == 0]
    if include_keys:
        res = {}
        if "_id" in doc and projection.get("_id", 1) != 0:
            res["_id"] = doc["_id"]
        for k in include_keys:
            if k in doc:
                res[k] = doc[k]
        return res
    if exclude_keys:
        res = dict(doc)
        for k in exclude_keys:
            res.pop(k, None)
        return res
    return doc


class PostgresCursor:
    def __init__(self, adapter: "PostgresDocumentAdapter", filter: Optional[Dict[str, Any]], projection: Optional[Dict[str, int]]):
        self.adapter = adapter
        self.filter = filter or {}
        self.projection = projection
        self._sort_key = None
        self._sort_direction = 1
        self._skip_count = 0
        self._limit_count = None

    def sort(self, key: str, direction: int = 1):
        self._sort_key = key
        self._sort_direction = direction
        return self

    def skip(self, count: int):
        self._skip_count = count
        return self

    def limit(self, count: int):
        self._limit_count = count
        return self

    async def to_list(self, length: Optional[int] = None) -> List[Dict[str, Any]]:
        await self.adapter._ensure()
        params: Dict[str, Any] = {}
        counter = [0]
        where = build_where(self.filter, params, counter)
        sql = f"SELECT id, data FROM {self.adapter.table} WHERE {where}"
        if self._sort_key:
            direction = "DESC" if self._sort_direction == -1 else "ASC"
            if self._sort_key == "_id":
                sql += f" ORDER BY id {direction}"
            else:
                sql += f" ORDER BY ({_json_ref(self._sort_key, as_text=True)}) {direction}"
        limit = length if length is not None else self._limit_count
        if limit is not None:
            sql += f" LIMIT {int(limit)}"
        if self._skip_count:
            sql += f" OFFSET {int(self._skip_count)}"
        async with self.adapter.engine.connect() as conn:
            result = await conn.execute(text(sql), params)
            rows = result.fetchall()
        docs = [_apply_projection(_row_to_doc(r), self.projection) for r in rows]
        return docs

    def __aiter__(self):
        self._items = None
        self._idx = 0
        return self

    async def __anext__(self):
        if self._items is None:
            self._items = await self.to_list()
            self._idx = 0
        if self._idx >= len(self._items):
            raise StopAsyncIteration
        item = self._items[self._idx]
        self._idx += 1
        return item


_ensured_tables: set = set()


class PostgresDocumentAdapter:
    """Mongo-collection-shaped adapter backed by a real Postgres table (id text PK, data jsonb)."""
    def __init__(self, name: str, engine: AsyncEngine):
        self.name = _validate_table_name(name)
        self.table = f"{settings.DB_SCHEMA}.col_{self.name}"
        self.engine = engine

    async def ensure_table(self):
        async with self.engine.begin() as conn:
            await conn.execute(text(
                f"CREATE TABLE IF NOT EXISTS {self.table} ("
                f"id TEXT PRIMARY KEY, "
                f"data JSONB NOT NULL, "
                f"created_at TIMESTAMPTZ DEFAULT now())"
            ))
            await conn.execute(text(
                f"CREATE INDEX IF NOT EXISTS idx_col_{self.name}_data ON {self.table} USING gin(data)"
            ))
        _ensured_tables.add(self.name)

    async def _ensure(self):
        # Covers collections whose name is only known at runtime (e.g. via a
        # class attribute), not present in KNOWN_COLLECTIONS at startup.
        if self.name not in _ensured_tables:
            await self.ensure_table()

    async def find_one(self, filter: Dict[str, Any], projection: Optional[Dict[str, int]] = None) -> Optional[Dict[str, Any]]:
        await self._ensure()
        params: Dict[str, Any] = {}
        counter = [0]
        where = build_where(filter, params, counter)
        sql = f"SELECT id, data FROM {self.table} WHERE {where} LIMIT 1"
        async with self.engine.connect() as conn:
            result = await conn.execute(text(sql), params)
            row = result.fetchone()
        if not row:
            return None
        return _apply_projection(_row_to_doc(row), projection)

    def find(self, filter: Optional[Dict[str, Any]] = None, projection: Optional[Dict[str, int]] = None) -> PostgresCursor:
        return PostgresCursor(self, filter, projection)

    async def insert_one(self, doc: Dict[str, Any]):
        await self._ensure()
        doc_copy = dict(doc)
        doc_id = str(doc_copy.pop("_id", None) or uuid.uuid4().hex)
        async with self.engine.begin() as conn:
            await conn.execute(
                text(f"INSERT INTO {self.table} (id, data) VALUES (:id, (:data)::jsonb)"),
                {"id": doc_id, "data": _dumps(doc_copy)},
            )
        return InsertResult(doc_id)

    async def update_one(self, filter: Dict[str, Any], update: Dict[str, Any], upsert: bool = False):
        await self._ensure()
        params: Dict[str, Any] = {}
        counter = [0]
        where = build_where(filter, params, counter)
        async with self.engine.begin() as conn:
            result = await conn.execute(text(f"SELECT id, data FROM {self.table} WHERE {where} LIMIT 1"), params)
            row = result.fetchone()

            if row:
                doc = dict(row.data)
                if "$set" in update:
                    for k, v in update["$set"].items():
                        doc[k] = v
                if "$unset" in update:
                    for k in update["$unset"]:
                        doc.pop(k, None)
                if "$inc" in update:
                    for k, v in update["$inc"].items():
                        doc[k] = doc.get(k, 0) + v
                await conn.execute(
                    text(f"UPDATE {self.table} SET data = (:data)::jsonb WHERE id = :id"),
                    {"data": _dumps(doc), "id": row.id},
                )
                return UpdateResult(1, 1)

            if upsert:
                new_doc = {k: v for k, v in filter.items() if not k.startswith("$") and not isinstance(v, dict)}
                if "$set" in update:
                    for k, v in update["$set"].items():
                        new_doc[k] = v
                # $inc on a missing document starts from 0 (it used to be dropped silently)
                for k, v in (update.get("$inc") or {}).items():
                    new_doc[k] = new_doc.get(k, 0) + v
                new_id = str(new_doc.pop("_id", None) or uuid.uuid4().hex)
                await conn.execute(
                    text(f"INSERT INTO {self.table} (id, data) VALUES (:id, (:data)::jsonb)"),
                    {"id": new_id, "data": _dumps(new_doc)},
                )
                return UpdateResult(0, 1)

            return UpdateResult(0, 0)

    async def delete_one(self, filter: Dict[str, Any]):
        await self._ensure()
        params: Dict[str, Any] = {}
        counter = [0]
        where = build_where(filter, params, counter)
        async with self.engine.begin() as conn:
            result = await conn.execute(
                text(f"DELETE FROM {self.table} WHERE id = (SELECT id FROM {self.table} WHERE {where} LIMIT 1) RETURNING id"),
                params,
            )
            deleted = result.fetchall()
        return DeleteResult(len(deleted))

    async def count_documents(self, filter: Optional[Dict[str, Any]] = None) -> int:
        await self._ensure()
        params: Dict[str, Any] = {}
        counter = [0]
        where = build_where(filter, params, counter)
        async with self.engine.connect() as conn:
            result = await conn.execute(text(f"SELECT COUNT(*) FROM {self.table} WHERE {where}"), params)
            return result.scalar_one()

    async def create_index(self, *args, **kwargs):
        pass


class DatabaseManager:
    engine: Optional[AsyncEngine] = None
    db: Any = None
    is_live_pg: bool = False

    async def connect(self):
        if self.db is not None:
            return
        try:
            logger.info(f"Connecting to PostgreSQL at {settings.POSTGRES_URI[:40]}...")
            # statement_cache_size=0: required for PgBouncer transaction-pooling
            # mode (e.g. Supabase's pooler on port 6543), which doesn't support
            # asyncpg's prepared statements.
            uri = settings.POSTGRES_URI
            for prefix in ("postgresql://", "postgres://"):
                if uri.startswith(prefix):
                    uri = "postgresql+asyncpg://" + uri[len(prefix):]
            is_local = any(h in uri.split("@")[-1].split("/")[0] for h in ("localhost", "127.0.0.1"))
            engine = create_async_engine(
                uri,
                pool_pre_ping=True,
                connect_args={
                    "statement_cache_size": 0,
                    **({} if is_local else {"ssl": "require"}),
                },
            )
            async def _ping():
                async with engine.connect() as conn:
                    await conn.execute(text("SELECT 1"))
            await asyncio.wait_for(_ping(), timeout=8)
            self.engine = engine
            self.is_live_pg = True
            self.db = object()  # marker: postgres path is used via get_collection()
            async with engine.begin() as conn:
                await conn.execute(text(f"CREATE SCHEMA IF NOT EXISTS {settings.DB_SCHEMA}"))
            for name in KNOWN_COLLECTIONS:
                await PostgresDocumentAdapter(name, engine).ensure_table()
            logger.info("Successfully connected to PostgreSQL.")
        except Exception as e:
            # Postgres is the only supported store: fail fast rather than run on a local file.
            logger.error(f"Could not connect to PostgreSQL: {e}")
            raise RuntimeError("PostgreSQL is unavailable; check POSTGRES_URI.") from e

    async def close(self):
        if self.engine:
            await self.engine.dispose()
            logger.info("PostgreSQL connection closed.")

    def get_collection(self, name: str):
        return PostgresDocumentAdapter(name, self.engine)


db_manager = DatabaseManager()


def get_db():
    return db_manager.db


def get_collection(name: str):
    return db_manager.get_collection(name)


def fix_id(doc: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    """Normalize the id field for JSON serialization."""
    if not doc:
        return None
    doc_copy = dict(doc)
    if "_id" in doc_copy:
        doc_copy["id"] = str(doc_copy["_id"])
        doc_copy["_id"] = str(doc_copy["_id"])
    return doc_copy


def fix_ids(docs: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Normalize the id field across a list of documents."""
    return [fix_id(d) for d in docs if d is not None]
