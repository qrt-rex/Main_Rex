import json
import logging
import urllib.request
import urllib.error
import asyncio
from datetime import datetime
from typing import Optional, Dict, Any
from urllib.parse import quote
from fastapi import HTTPException, status

from app.config import settings
from app.database import get_collection
from app.utils.tokens import create_access_token

logger = logging.getLogger("rexera.auth.google")

ALLOWED_DOMAINS = ("@rexera.co.in", "@rexera.in", "@rexera.com")


def is_rexera_domain(email: str, allow_test_domain: bool = False) -> bool:
    """Return True if email domain is @rexera.co.in, @rexera.in, or @rexera.com."""
    clean = (email or "").strip().lower()
    if allow_test_domain and clean.endswith("@rexera-test.com"):
        return True
    return any(clean.endswith(d) for d in ALLOWED_DOMAINS)


def _client_id() -> str:
    """Google sign-in is off until GOOGLE_CLIENT_ID is set: without it, a Google token issued to any
    other website for a Rexera address would be accepted here."""
    if not settings.GOOGLE_CLIENT_ID:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                            detail="Google sign-in is not configured.")
    return settings.GOOGLE_CLIENT_ID


async def _google_json(url: str, invalid_detail: str, headers: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
    def _fetch():
        req = urllib.request.Request(url, headers={"User-Agent": "RexCRM-Backend/1.0", **(headers or {})})
        with urllib.request.urlopen(req, timeout=10) as resp:
            return json.loads(resp.read().decode("utf-8"))

    try:
        return await asyncio.get_running_loop().run_in_executor(None, _fetch)
    except urllib.error.HTTPError as e:
        logger.warning(f"Google HTTP error {e.code}: {e.read().decode('utf-8', errors='ignore')}")
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=invalid_detail)
    except Exception as e:
        logger.error(f"Google verification request failed: {e}")
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY,
                            detail="Unable to verify Google authentication with Google servers.")


def _check_token(payload: Dict[str, Any], client_id: str) -> None:
    """The token must be for this app's client ID and for an address Google has verified."""
    if payload.get("aud") != client_id:
        logger.warning(f"Google token aud mismatch: expected {client_id}, got {payload.get('aud')}")
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Google token audience mismatch.")
    if payload.get("email_verified") not in (True, "true", "True", 1):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN,
                            detail="Your Google email address is not verified by Google.")


class GoogleAuthService:
    @classmethod
    async def verify_google_id_token(cls, id_token: str) -> Dict[str, Any]:
        """Verify a Google ID token via Google's tokeninfo endpoint."""
        client_id = _client_id()
        payload = await _google_json(f"https://oauth2.googleapis.com/tokeninfo?id_token={quote(id_token)}",
                                     "Invalid Google credential token. Please sign in again.")
        _check_token(payload, client_id)
        return payload

    @classmethod
    async def fetch_google_userinfo(cls, access_token: str) -> Dict[str, Any]:
        """Verify an OAuth2 access token was issued to this app, then fetch the user's profile."""
        client_id = _client_id()
        invalid = "Invalid Google access token. Please sign in again."
        token_info = await _google_json(
            f"https://oauth2.googleapis.com/tokeninfo?access_token={quote(access_token)}", invalid)
        _check_token(token_info, client_id)
        profile = await _google_json("https://www.googleapis.com/oauth2/v3/userinfo", invalid,
                                     {"Authorization": f"Bearer {access_token}"})
        # Sign in as the address the verified token belongs to.
        return {**profile, "email": token_info.get("email", "")}

    @classmethod
    async def authenticate_google_user(
        cls,
        email: str,
        name: Optional[str] = None,
        picture: Optional[str] = None
    ) -> Dict[str, Any]:
        """Authenticate or auto-provision an active user after domain validation."""
        clean_email = (email or "").strip().lower()

        # Strict corporate domain check
        if not is_rexera_domain(clean_email):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Access restricted: Only @rexera.co.in, @rexera.in, and @rexera.com Google accounts are allowed."
            )

        col = get_collection("admins")
        admin = await col.find_one({"email": clean_email})
        now = datetime.utcnow().isoformat()

        if admin:
            if not admin.get("is_active", True):
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Your account has been deactivated. Please contact your administrator."
                )

            update_data: Dict[str, Any] = {
                "last_login": now,
                "updated_at": now,
                "auth_provider": "google",
            }
            if picture and not admin.get("picture"):
                update_data["picture"] = picture
            if name and (not admin.get("username") or admin.get("username") == "Admin"):
                update_data["username"] = name

            await col.update_one({"_id": admin["_id"]}, {"$set": update_data})
            role = admin.get("role", "employee")
            username = admin.get("username") or name or clean_email.split("@")[0].capitalize()
            user_id = str(admin["_id"])
        else:
            # Check if this email belongs to an employee in the employees collection
            emp_col = get_collection("employees")
            emp = await emp_col.find_one({"email": clean_email})

            role = "employee"
            username = name or (emp.get("full_name") if emp else None) or clean_email.split("@")[0].capitalize()

            new_user = {
                "username": username,
                "email": clean_email,
                "password_hash": None,
                "role": role,
                "is_active": True,
                "auth_provider": "google",
                "picture": picture,
                "employee_code": emp.get("employee_code") if emp else None,
                "created_at": now,
                "updated_at": now,
                "last_login": now,
            }
            res = await col.insert_one(new_user)
            user_id = str(res.inserted_id)
            logger.info(f"Auto-provisioned new Google user account: {clean_email} (role: {role})")

        token_payload = {
            "sub": user_id,
            "email": clean_email,
            "username": username,
            "role": role,
            "scope": "admin_access",
        }
        access_token = create_access_token(token_payload)

        return {
            "access_token": access_token,
            "token_type": "bearer",
            "email": clean_email,
            "admin_name": username,
            "role": role,
            "message": "Google authentication successful."
        }
