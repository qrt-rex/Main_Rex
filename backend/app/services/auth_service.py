import logging
import time
from datetime import datetime, timedelta
from typing import Optional, Dict, Any, Tuple
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from app.database import get_collection, fix_id
from app.config import settings
from app.utils.security import hash_password, verify_password
from app.utils.tokens import create_access_token, decode_access_token
from app.services.otp_service import OTPService

logger = logging.getLogger("rexera.auth")
security = HTTPBearer(auto_error=False)

# Consecutive wrong passwords before an account is locked, and for how long.
MAX_FAILED_LOGINS = 5
LOCKOUT_MINUTES = 15


def verify_2fa_temp_token(temp_token: Optional[str], email: str) -> bool:
    """True when temp_token was issued by a successful password check for this email."""
    payload = decode_access_token(temp_token) if temp_token else None
    return bool(
        payload
        and payload.get("scope") == "2fa_pending"
        and str(payload.get("email", "")).lower() == email.strip().lower()
    )

class AuthService:
    @classmethod
    async def init_default_admin(cls):
        """Seed default admin if no admins exist."""
        col = get_collection("admins")
        admin_count = await col.count_documents({})
        if admin_count == 0:
            logger.info("No admin accounts found. Creating default superadmin account...")
            admin_doc = {
                "username": settings.DEFAULT_ADMIN_USERNAME,
                "email": settings.DEFAULT_ADMIN_EMAIL.lower(),
                "password_hash": hash_password(settings.DEFAULT_ADMIN_PASSWORD),
                "role": "superadmin",
                "is_active": True,
                "created_at": datetime.utcnow().isoformat(),
                "updated_at": datetime.utcnow().isoformat(),
                "last_login": None
            }
            await col.insert_one(admin_doc)
            logger.info(f"Default superadmin created: {settings.DEFAULT_ADMIN_EMAIL}")

    @classmethod
    async def authenticate_admin_step1(cls, email: str, password: str) -> Tuple[bool, str, Dict[str, Any]]:
        """
        Step 1: Check password and send 2FA OTP to admin email.
        """
        col = get_collection("admins")
        admin = await col.find_one({"email": email.strip().lower()})
        
        if not admin or not admin.get("is_active", True):
            return False, "Invalid email or password.", {}

        locked_until = admin.get("locked_until")
        if locked_until:
            try:
                remaining = datetime.fromisoformat(locked_until) - datetime.utcnow()
            except (TypeError, ValueError):
                remaining = timedelta(0)
            if remaining.total_seconds() > 0:
                minutes = int(remaining.total_seconds() // 60) + 1
                raise HTTPException(
                    status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                    detail=f"Too many failed sign-in attempts. Please try again in {minutes} minutes.",
                )

        if not verify_password(password, admin.get("password_hash", "")):
            failures = int(admin.get("failed_login_attempts", 0)) + 1
            update: Dict[str, Any] = {"failed_login_attempts": failures}
            if failures >= MAX_FAILED_LOGINS:
                update = {"failed_login_attempts": 0,
                          "locked_until": (datetime.utcnow() + timedelta(minutes=LOCKOUT_MINUTES)).isoformat()}
                logger.warning(f"Account {admin['email']} locked after {failures} failed sign-in attempts")
            await col.update_one({"_id": admin["_id"]}, {"$set": update})
            return False, "Invalid email or password.", {}

        if admin.get("failed_login_attempts") or admin.get("locked_until"):
            await col.update_one({"_id": admin["_id"]}, {"$set": {"failed_login_attempts": 0, "locked_until": None}})

        # Credentials valid! Send 2FA OTP
        ok, msg, debug_otp = await OTPService.create_and_send_otp(admin["email"], purpose="login_2fa")
        if not ok:
            return False, msg, {}
        
        # Issue a short-lived temporary token for 2FA step
        temp_token = create_access_token(
            {"sub": str(admin["_id"]), "email": admin["email"], "scope": "2fa_pending"},
            expires_delta=timedelta(minutes=10)
        )
        
        return True, "Credentials verified. Please enter the 6-digit OTP sent to your email.", {
            "requires_2fa": True,
            "temp_token": temp_token,
            "email": admin["email"],
            "admin_name": admin.get("username", "Admin"),
            "role": admin.get("role", "admin"),
            "debug_otp": debug_otp
        }

    @classmethod
    async def verify_2fa_and_login(cls, email: str, otp: str, temp_token: Optional[str]) -> Tuple[bool, str, Dict[str, Any]]:
        """
        Step 2: Verify 2FA OTP and issue full JWT access token.
        Requires the temp_token from step 1, so the emailed code alone never signs anyone in.
        """
        if not verify_2fa_temp_token(temp_token, email):
            return False, "Your sign-in session has expired. Please enter your password again.", {}
        col = get_collection("admins")
        admin = await col.find_one({"email": email.strip().lower()})
        if not admin or not admin.get("is_active", True):
            return False, "Invalid or expired verification code.", {}

        ok, msg = await OTPService.verify_otp(email, otp, purpose="login_2fa")
        if not ok:
            return False, msg, {}

        # Update last login
        now = datetime.utcnow().isoformat()
        await col.update_one({"_id": admin["_id"]}, {"$set": {"last_login": now, "updated_at": now}})

        # Issue full JWT token
        token_payload = {
            "sub": str(admin["_id"]),
            "email": admin["email"],
            "username": admin.get("username", "Admin"),
            "role": admin.get("role", "admin"),
            "scope": "admin_access"
        }
        access_token = create_access_token(token_payload)

        return True, "Login successful.", {
            "access_token": access_token,
            "token_type": "bearer",
            "email": admin["email"],
            "admin_name": admin.get("username", "Admin"),
            "role": admin.get("role", "admin")
        }

    @classmethod
    async def reset_password_with_otp(cls, email: str, otp: str, new_password: str) -> Tuple[bool, str]:
        col = get_collection("admins")
        clean_email = email.strip().lower()
        admin = await col.find_one({"email": clean_email})
        if not admin:
            return False, "Admin account not found with this email."

        ok, msg = await OTPService.verify_otp(clean_email, otp, purpose="password_reset")
        if not ok:
            return False, msg

        new_hash = hash_password(new_password)
        now = datetime.utcnow().isoformat()
        await col.update_one({"_id": admin["_id"]}, {"$set": {
            "password_hash": new_hash, "updated_at": now,
            "failed_login_attempts": 0, "locked_until": None,
        }})
        # A password reset signs out every existing session (e.g. one opened with the old password).
        await revoke_sessions(admin["_id"])
        return True, "Password has been successfully updated. You may now log in."

async def revoke_sessions(admin_id: str) -> None:
    """End every session issued to this account up to now (tokens with an earlier `iat`)."""
    await get_collection("admins").update_one(
        {"_id": admin_id}, {"$set": {"sessions_revoked_at": int(time.time())}}
    )


async def get_current_admin(request: Request, credentials: Optional[HTTPAuthorizationCredentials] = Depends(security)) -> Dict[str, Any]:
    # Resolved once per request: the RBAC guard and the endpoint both depend on this.
    cached = getattr(request.state, "admin", None)
    if cached is not None:
        return cached

    if not credentials or not credentials.credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication token missing or invalid.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    token = credentials.credentials
    payload = decode_access_token(token)
    if not payload or payload.get("scope") != "admin_access":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired session token.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    col = get_collection("admins")
    admin = await col.find_one({"_id": payload.get("sub")})
    if not admin or not admin.get("is_active", True):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Admin user not found or deactivated.",
        )
    if payload.get("iat", 0) < admin.get("sessions_revoked_at", 0):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="This session has been signed out.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    request.state.admin = fix_id(admin)
    return request.state.admin

get_current_user = get_current_admin
