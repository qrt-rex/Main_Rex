"""
In-memory stand-in for app.database.PostgresDocumentAdapter, used by the test suite.

It mirrors the semantics of the Postgres JSONB queries the real adapter builds
(`data @> ...` containment for equality, jsonb ordering for $gt/$lt, `data->>'k'`
text for $regex and sorting), so tests exercise the same filters without a server.
"""
import copy
import re
import uuid
from typing import Any, Dict, List, Optional

from app.database import DeleteResult, InsertResult, UpdateResult, _apply_projection, _key_path

_MISSING = object()


def _get_path(doc: Dict[str, Any], key: str) -> Any:
    """Resolve a dotted key like the real adapter's data#>'{a,b}' (validates the key the same way)."""
    cur: Any = doc
    for part in _key_path(key):
        if not isinstance(cur, dict) or part not in cur:
            return _MISSING
        cur = cur[part]
    return cur


def _contains(doc_val: Any, query_val: Any) -> bool:
    """Postgres jsonb containment for a nested value (no top-level scalar-in-array exception)."""
    if isinstance(query_val, dict):
        if not isinstance(doc_val, dict):
            return False
        return all(k in doc_val and _contains(doc_val[k], v) for k, v in query_val.items())
    if isinstance(query_val, list):
        if not isinstance(doc_val, list):
            return False
        return all(any(_contains(d, q) for d in doc_val) for q in query_val)
    if isinstance(doc_val, (dict, list)):
        return False
    if isinstance(query_val, bool) or isinstance(doc_val, bool):
        return type(query_val) is type(doc_val) and query_val == doc_val
    if isinstance(query_val, (int, float)) and isinstance(doc_val, (int, float)):
        return float(query_val) == float(doc_val)
    return query_val == doc_val


# jsonb cross-type ordering: Object > Array > Boolean > Number > String > Null
def _rank(v: Any) -> int:
    if v is None:
        return 0
    if isinstance(v, str):
        return 1
    if isinstance(v, bool):
        return 3
    if isinstance(v, (int, float)):
        return 2
    if isinstance(v, list):
        return 4
    return 5


def _compare(a: Any, b: Any) -> int:
    ra, rb = _rank(a), _rank(b)
    if ra != rb:
        return -1 if ra < rb else 1
    if isinstance(a, (dict, list)):
        a, b = str(a), str(b)
    return (a > b) - (a < b)


def _as_text(v: Any) -> Optional[str]:
    if v is None:
        return None
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, (dict, list)):
        import json
        return json.dumps(v)
    if isinstance(v, float) and v.is_integer():
        return str(int(v)) if abs(v) < 1e15 else str(v)
    return str(v)


def _match_field(doc: Dict[str, Any], key: str, val: Any) -> bool:
    is_id = key == "_id"
    cur = doc.get("_id") if is_id else _get_path(doc, key)
    present = cur is not _MISSING
    if not present:
        cur = None
    if isinstance(val, dict) and any(isinstance(k, str) and k.startswith("$") for k in val):
        for op, opval in val.items():
            if op == "$options":
                continue
            if op == "$in":
                if is_id:
                    ok = str(cur) in [str(x) for x in opval]
                else:
                    ok = present and any(_contains(cur, item) for item in opval)
                if not ok:
                    return False
            elif op == "$ne":
                if is_id:
                    if str(cur) == str(opval):
                        return False
                elif present and _contains(cur, opval):
                    return False
            elif op in ("$gte", "$lte", "$gt", "$lt"):
                if is_id:
                    a, b = str(cur), str(opval)
                    c = (a > b) - (a < b)
                else:
                    # data->'k' is SQL NULL when the key is missing, so the comparison is false
                    if not present:
                        return False
                    c = _compare(cur, opval)
                ok = {"$gte": c >= 0, "$lte": c <= 0, "$gt": c > 0, "$lt": c < 0}[op]
                if not ok:
                    return False
            elif op == "$regex":
                text = str(cur) if is_id else _as_text(cur)
                if text is None:
                    return False
                flags = re.IGNORECASE if val.get("$options") == "i" else 0
                if not re.search(opval, text, flags):
                    return False
            else:
                raise ValueError(f"Unsupported query operator: {op}")
        return True
    if is_id:
        return str(cur) == str(val)
    return present and _contains(cur, val)


def matches(doc: Dict[str, Any], flt: Optional[Dict[str, Any]]) -> bool:
    if not flt:
        return True
    for k, v in flt.items():
        if k == "$or":
            if not any(matches(doc, sub) for sub in v):
                return False
        elif k == "$and":
            if not all(matches(doc, sub) for sub in v):
                return False
        elif not _match_field(doc, k, v):
            return False
    return True


class MemCursor:
    def __init__(self, coll: "MemCollection", flt, projection):
        self.coll, self.flt, self.projection = coll, flt or {}, projection
        self._sort_key, self._dir, self._skip, self._limit = None, 1, 0, None

    def sort(self, key: str, direction: int = 1):
        self._sort_key, self._dir = key, direction
        return self

    def skip(self, n: int):
        self._skip = n
        return self

    def limit(self, n: int):
        self._limit = n
        return self

    async def to_list(self, length: Optional[int] = None):
        docs = [d for d in self.coll._docs() if matches(d, self.flt)]
        if self._sort_key:
            key = self._sort_key
            def sort_text(d):
                if key == "_id":
                    return str(d["_id"])
                v = _get_path(d, key)
                return None if v is _MISSING else _as_text(v)
            vals = [(sort_text(d), d) for d in docs]
            desc = self._dir == -1
            present = sorted([p for p in vals if p[0] is not None], key=lambda p: p[0], reverse=desc)
            missing = [p for p in vals if p[0] is None]
            # Postgres: NULLS LAST for ASC, NULLS FIRST for DESC
            ordered = (missing + present) if desc else (present + missing)
            docs = [d for _, d in ordered]
        docs = docs[self._skip:]
        limit = length if length is not None else self._limit
        if limit is not None:
            docs = docs[: int(limit)]
        return [_apply_projection(d, self.projection) for d in docs]

    def __aiter__(self):
        self._items = None
        self._idx = 0
        return self

    async def __anext__(self):
        if self._items is None:
            self._items = await self.to_list()
        if self._idx >= len(self._items):
            raise StopAsyncIteration
        item = self._items[self._idx]
        self._idx += 1
        return item


class MemCollection:
    def __init__(self, store: "MemStore", name: str):
        self.store, self.name = store, name

    def _rows(self) -> Dict[str, Dict[str, Any]]:
        return self.store.tables.setdefault(self.name, {})

    def _docs(self) -> List[Dict[str, Any]]:
        # Round-trip copies so callers never mutate stored rows (the real adapter returns fresh dicts).
        return [dict(copy.deepcopy(v), _id=k) for k, v in self._rows().items()]

    async def find_one(self, flt, projection=None):
        for d in self._docs():
            if matches(d, flt):
                return _apply_projection(d, projection)
        return None

    def find(self, flt=None, projection=None):
        return MemCursor(self, flt, projection)

    async def insert_one(self, doc):
        d = copy.deepcopy(self.store.jsonify(doc))
        doc_id = str(d.pop("_id", None) or uuid.uuid4().hex)
        if doc_id in self._rows():
            raise ValueError(f"duplicate key {doc_id} in {self.name}")
        self._rows()[doc_id] = d
        return InsertResult(doc_id)

    async def update_one(self, flt, update, upsert: bool = False):
        for d in self._docs():
            if matches(d, flt):
                doc_id = d.pop("_id")
                for k, v in (update.get("$set") or {}).items():
                    d[k] = v
                for k in (update.get("$unset") or {}):
                    d.pop(k, None)
                for k, v in (update.get("$inc") or {}).items():
                    d[k] = d.get(k, 0) + v
                self._rows()[doc_id] = copy.deepcopy(self.store.jsonify(d))
                return UpdateResult(1, 1)
        if upsert:
            new_doc = {k: v for k, v in flt.items() if not k.startswith("$") and not isinstance(v, dict)}
            new_doc.update(update.get("$set") or {})
            for k, v in (update.get("$inc") or {}).items():
                new_doc[k] = new_doc.get(k, 0) + v
            new_id = str(new_doc.pop("_id", None) or uuid.uuid4().hex)
            self._rows()[new_id] = copy.deepcopy(self.store.jsonify(new_doc))
            return UpdateResult(0, 1)
        return UpdateResult(0, 0)

    async def delete_one(self, flt):
        for d in self._docs():
            if matches(d, flt):
                del self._rows()[d["_id"]]
                return DeleteResult(1)
        return DeleteResult(0)

    async def count_documents(self, flt=None):
        return sum(1 for d in self._docs() if matches(d, flt))

    async def create_index(self, *a, **k):
        pass

    async def ensure_table(self):
        pass


class MemStore:
    def __init__(self):
        self.tables: Dict[str, Dict[str, Dict[str, Any]]] = {}

    @staticmethod
    def jsonify(doc):
        # Same serialisation the real adapter applies (datetime -> ISO string via json.dumps default).
        import json
        from app.database import _dumps
        return json.loads(_dumps(doc))

    def collection(self, name: str) -> MemCollection:
        return MemCollection(self, name)
