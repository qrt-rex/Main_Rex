"""
IVR / dialer provider proxy.

The browser never talks to the IVR directly: the CRM signs the user in to the IVR (their own IVR
email and password), hands the IVR session back to that browser tab, and every later IVR call comes
through here with the IVR access token in `X-IVR-Token`. That keeps the IVR's address in one server
setting (IVR_API_BASE_URL), avoids browser CORS limits, and keeps IVR tokens out of the CRM's own auth.

When the IVR rejects its token this answers 419, never 401, so an expired IVR session sends the user
back to the IVR sign-in page without signing them out of the CRM.
"""
import logging
import re
from typing import Any, Dict, Optional
from urllib.parse import quote

import httpx
from fastapi import APIRouter, Header, HTTPException, Request
from pydantic import BaseModel, Field

from app.config import settings

router = APIRouter(prefix="/api/ivr", tags=["IVR Dialer"])
logger = logging.getLogger("rexera.ivr")

IVR_SESSION_EXPIRED = 419

# Provider paths relative to IVR_API_BASE_URL. Any of them can be overridden with IVR_PATHS in .env.
DEFAULT_PATHS: Dict[str, str] = {
    "me": "/api/auth/me",
    "campaigns": "/api/ivr/campaigns",
    "cdr": "/api/cdr",
    "lead-lists": "/api/lead-lists",
    "agent-groups": "/api/agent-groups",
    "dispositions": "/api/dispositions",
    "dids": "/api/dids",
    "call": "/api/dialer/call",
    "campaign-action": "/api/ivr/campaigns/{id}/{action}",
}
READ_RESOURCES = {"me", "campaigns", "cdr", "lead-lists", "agent-groups", "dispositions", "dids"}
CAMPAIGN_ACTIONS = {"pause", "resume", "stop"}


def _path(name: str) -> str:
    return {**DEFAULT_PATHS, **(settings.IVR_PATHS or {})}[name]


def _base() -> str:
    base = (settings.IVR_API_BASE_URL or "").strip().rstrip("/")
    if not base:
        raise HTTPException(status_code=503, detail="The IVR connection isn't set up yet. Set IVR_API_BASE_URL in backend/.env.")
    return base


def _client() -> httpx.AsyncClient:
    """One client per request; tests replace this with a mock transport."""
    return httpx.AsyncClient(timeout=settings.IVR_TIMEOUT_SECONDS)


def _message(body: Any, fallback: str) -> str:
    if isinstance(body, dict):
        for key in ("message", "error", "detail"):
            value = body.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()
    return fallback


def _token(value: Optional[str]) -> str:
    if not value or not value.strip():
        raise HTTPException(status_code=IVR_SESSION_EXPIRED, detail="Sign in to the IVR first.")
    return value.strip()


async def _send(method: str, path: str, *, token: Optional[str] = None, json: Any = None,
                params: Optional[Dict[str, str]] = None, rejected_status: int = IVR_SESSION_EXPIRED,
                rejected_message: str = "Your IVR session has expired. Sign in again.") -> Any:
    headers = {"Accept": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    url = _base() + path
    try:
        async with _client() as client:
            res = await client.request(method, url, headers=headers, json=json, params=params or None)
    except httpx.HTTPError as exc:
        logger.warning("IVR %s %s failed: %s", method, path, exc)
        raise HTTPException(status_code=502, detail="Can't reach the IVR server. Try again in a moment.")

    try:
        body = res.json()
    except ValueError:
        body = None

    if res.status_code == 401:
        raise HTTPException(status_code=rejected_status, detail=_message(body, rejected_message))
    if res.status_code == 403:
        raise HTTPException(status_code=403, detail=_message(body, "Your IVR account isn't allowed to do that."))
    if res.status_code == 404:
        raise HTTPException(status_code=502, detail=_message(body, f"The IVR has no endpoint at {path}. Check IVR_PATHS in backend/.env."))
    if not res.is_success:
        if rejected_status != IVR_SESSION_EXPIRED and res.status_code in (400, 422):
            raise HTTPException(status_code=rejected_status, detail=_message(body, rejected_message))
        raise HTTPException(status_code=502, detail=_message(body, f"The IVR returned an error ({res.status_code})."))
    if body is None:
        raise HTTPException(status_code=502, detail="The IVR sent a response that isn't JSON.")
    if isinstance(body, dict) and body.get("success") is False:
        raise HTTPException(status_code=502, detail=_message(body, "The IVR refused the request."))
    return body


def _session(body: Any, fallback_refresh: Optional[str] = None) -> Dict[str, Any]:
    """{user, accessToken, refreshToken} from the IVR's `{success, message, data: {...}}` envelope."""
    data = body.get("data", body) if isinstance(body, dict) else {}
    if not isinstance(data, dict):
        data = {}
    access = data.get("accessToken") or data.get("access_token") or data.get("token")
    if not access:
        raise HTTPException(status_code=502, detail="The IVR response had no access token.")
    return {
        "user": data.get("user"),
        "accessToken": access,
        "refreshToken": data.get("refreshToken") or data.get("refresh_token") or fallback_refresh,
    }


class IvrLogin(BaseModel):
    email: str = Field(min_length=3, max_length=254)
    password: str = Field(min_length=1, max_length=256)


class IvrRefresh(BaseModel):
    refreshToken: str = Field(min_length=1, max_length=4096)


class IvrCall(BaseModel):
    destination_number: str = Field(min_length=6, max_length=24)
    caller_did: Optional[str] = Field(default=None, max_length=40)
    campaign_id: Optional[str] = Field(default=None, max_length=64)


@router.get("/status")
async def ivr_status():
    """Whether the server has an IVR to talk to (the sign-in page explains when it doesn't)."""
    return {"configured": bool((settings.IVR_API_BASE_URL or "").strip())}


@router.post("/login")
async def ivr_login(body: IvrLogin):
    payload: Dict[str, Any] = {"email": body.email.strip(), "password": body.password}
    if settings.IVR_CLIENT_APP:
        payload["clientApp"] = settings.IVR_CLIENT_APP
    res = await _send("POST", settings.IVR_LOGIN_PATH, json=payload,
                      rejected_status=400, rejected_message="The IVR didn't accept that email and password.")
    session = _session(res)
    if not isinstance(session["user"], dict):
        raise HTTPException(status_code=502, detail="The IVR login response had no user.")
    return session


@router.post("/refresh")
async def ivr_refresh(body: IvrRefresh):
    res = await _send("POST", settings.IVR_REFRESH_PATH, json={"refreshToken": body.refreshToken})
    return _session(res, fallback_refresh=body.refreshToken)


@router.get("/data/{resource}")
async def ivr_data(resource: str, request: Request, x_ivr_token: Optional[str] = Header(default=None)):
    if resource not in READ_RESOURCES:
        raise HTTPException(status_code=404, detail="Unknown IVR resource.")
    return await _send("GET", _path(resource), token=_token(x_ivr_token), params=dict(request.query_params))


@router.post("/call")
async def ivr_call(body: IvrCall, x_ivr_token: Optional[str] = Header(default=None)):
    number = re.sub(r"[^\d+]", "", body.destination_number)
    if not re.fullmatch(r"\+?\d{6,15}", number):
        raise HTTPException(status_code=422, detail="Enter a valid phone number.")
    payload: Dict[str, Any] = {"destination_number": number}
    if body.caller_did:
        payload["caller_did"] = body.caller_did
    if body.campaign_id:
        payload["campaign_id"] = body.campaign_id
    return await _send("POST", _path("call"), token=_token(x_ivr_token), json=payload)


@router.post("/campaigns/{campaign_id}/{action}")
async def ivr_campaign_action(campaign_id: str, action: str, x_ivr_token: Optional[str] = Header(default=None)):
    if action not in CAMPAIGN_ACTIONS:
        raise HTTPException(status_code=404, detail="Unknown campaign action.")
    path = _path("campaign-action").format(id=quote(campaign_id, safe=""), action=action)
    return await _send("POST", path, token=_token(x_ivr_token))
