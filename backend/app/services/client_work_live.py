"""
Real-time push for client work (Server-Sent Events).

Every mutation in client_work_service publishes one small event; each open dashboard receives the
events it is entitled to and refetches. Entitlement is decided here, once, from the subscriber's
scope at connect time:

  * monitors (Legal team) and admins receive every event;
  * everyone else only events for work they are the assignee / assigner of, or that was
    reassigned away from them.

Events carry ids and a status, never client data, so a refetch (which goes through the normal
RBAC checks) is what actually returns anything.

The hub lives in this process. With several workers a change reaches only the dashboards connected
to the worker that handled it; the frontend also polls every 30 s, so the others catch up.
"""
import asyncio
import itertools
import json
import time
from typing import Any, AsyncIterator, Dict, Iterable, Optional, Set

MAX_STREAM_SECONDS = 600   # clients reconnect, which re-reads their permissions
PING_SECONDS = 15
QUEUE_SIZE = 200


class Subscriber:
    def __init__(self, user_id: str, monitor: bool):
        self.user_id = user_id
        self.monitor = monitor
        self.queue: "asyncio.Queue[Dict[str, Any]]" = asyncio.Queue(maxsize=QUEUE_SIZE)
        self.overflowed = False


class LiveHub:
    def __init__(self) -> None:
        self._subs: Set[Subscriber] = set()
        self._seq = itertools.count(1)

    @property
    def subscriber_count(self) -> int:
        return len(self._subs)

    def subscribe(self, user_id: str, monitor: bool) -> Subscriber:
        sub = Subscriber(user_id, monitor)
        self._subs.add(sub)
        return sub

    def unsubscribe(self, sub: Subscriber) -> None:
        self._subs.discard(sub)

    def publish(self, event: Dict[str, Any], user_ids: Iterable[str] = ()) -> None:
        targets = {str(u) for u in user_ids if u}
        payload = {**event, "seq": next(self._seq), "at": time.time()}
        for sub in list(self._subs):
            if not (sub.monitor or sub.user_id in targets):
                continue
            try:
                sub.queue.put_nowait(payload)
            except asyncio.QueueFull:
                # A stalled client: drop its backlog and tell it to refetch everything.
                sub.overflowed = True
                while not sub.queue.empty():
                    sub.queue.get_nowait()
                sub.queue.put_nowait({"type": "resync", "seq": payload["seq"], "at": payload["at"]})

    async def stream(self, sub: Subscriber, is_disconnected=None) -> AsyncIterator[str]:
        """SSE frames for one subscriber until it disconnects or MAX_STREAM_SECONDS pass."""
        started = time.monotonic()
        try:
            yield "retry: 3000\n\n"
            yield _frame({"type": "ready", "subscribers": self.subscriber_count}, "ready")
            while time.monotonic() - started < MAX_STREAM_SECONDS:
                if is_disconnected is not None and await is_disconnected():
                    return
                try:
                    event = await asyncio.wait_for(sub.queue.get(), timeout=PING_SECONDS)
                except asyncio.TimeoutError:
                    yield ": ping\n\n"
                    continue
                yield _frame(event, event.get("type", "message"), event_id=event.get("seq"))
            yield _frame({"type": "reconnect"}, "reconnect")
        finally:
            self.unsubscribe(sub)


def _frame(data: Dict[str, Any], event: str, event_id: Optional[int] = None) -> str:
    head = f"id: {event_id}\n" if event_id is not None else ""
    return f"{head}event: {event}\ndata: {json.dumps(data, default=str)}\n\n"


hub = LiveHub()
