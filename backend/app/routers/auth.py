import logging
import secrets
from datetime import datetime, timedelta
from typing import Dict, Any
from urllib.parse import quote, urlparse
from fastapi import APIRouter, HTTPException, Depends, status, Request
from app.schemas.auth import (
    AdminLoginRequest,
    AdminLoginResponse,
    Admin2FAVerifyRequest,
    Resend2FARequest,
    ForgotPasswordRequest,
    ResetPasswordRequest,
    GoogleAuthRequest,
    GoogleConfigResponse,
)
from app.services.auth_service import AuthService, get_current_admin, revoke_sessions, verify_2fa_temp_token
from app.services.google_auth_service import GoogleAuthService, ALLOWED_DOMAINS, is_rexera_domain
from app.services.otp_service import OTPService
from app.services.email_service import EmailService
from app.services.log_service import LogService
from app.database import get_collection
from app.config import settings

logger = logging.getLogger("rexera.router.auth")
router = APIRouter(prefix="/api/auth", tags=["Authentication"])


@router.post("/login", response_model=AdminLoginResponse)
async def admin_login_step1(req: AdminLoginRequest):
    """
    Step 1 of Admin Authentication:
    Validates credentials and dispatches a 6-digit OTP to the admin's email.
    """
    ok, msg, data = await AuthService.authenticate_admin_step1(req.email, req.password)
    if not ok:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=msg)
    
    return AdminLoginResponse(
        access_token=None,
        requires_2fa=True,
        temp_token=data.get("temp_token"),
        email=data.get("email"),
        message=msg,
        admin_name=data.get("admin_name"),
        role=data.get("role"),
        debug_otp=data.get("debug_otp"),
    )

@router.post("/verify-2fa", response_model=AdminLoginResponse)
async def admin_verify_2fa(req: Admin2FAVerifyRequest, request: Request):
    """
    Step 2 of Admin Authentication:
    Validates the 6-digit email OTP and issues the full JWT access token.
    """
    ok, msg, data = await AuthService.verify_2fa_and_login(req.email, req.otp, req.temp_token)
    if not ok:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=msg)

    # Log the successful login
    client_ip = request.client.host if request.client else ""
    await LogService.log_login(
        admin_email=data.get("email", req.email),
        admin_name=data.get("admin_name", "Admin"),
        role=data.get("role", "admin"),
        ip=client_ip,
    )

    return AdminLoginResponse(
        access_token=data.get("access_token"),
        requires_2fa=False,
        email=data.get("email"),
        message="Login successful.",
        admin_name=data.get("admin_name"),
        role=data.get("role")
    )

@router.post("/resend-2fa-otp")
async def resend_2fa_otp(req: Resend2FARequest):
    """Resend a new 2FA OTP to the admin email (only for a sign-in that passed the password check)."""
    if not verify_2fa_temp_token(req.temp_token, req.email):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED,
                            detail="Your sign-in session has expired. Please enter your password again.")
    ok, msg, debug_otp = await OTPService.create_and_send_otp(req.email, purpose="login_2fa")
    if not ok:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=msg)
    return {"success": True, "message": msg, "debug_otp": debug_otp}

@router.post("/forgot-password")
async def forgot_password(req: ForgotPasswordRequest, request: Request):
    """Send a password reset email link to the registered admin email.
    
    Enforces strict domain restrictions (@rexera.in, @rexera.com, @rexera.co.in).
    """
    clean_email = req.email.strip().lower()

    # Enforce allowed domains
    is_test_env = getattr(settings, "APP_ENV", "").lower() == "test"
    if not is_rexera_domain(clean_email, allow_test_domain=is_test_env):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only emails from @rexera.in, @rexera.com, or @rexera.co.in are allowed."
        )

    # Determine frontend URL origin
    origin = request.headers.get("origin")
    if not origin:
        referer = request.headers.get("referer")
        if referer:
            try:
                p = urlparse(referer)
                origin = f"{p.scheme}://{p.netloc}"
            except Exception:
                origin = None
    if not origin:
        origin = "http://localhost:5173"

    admin = await get_collection("admins").find_one({"email": clean_email})
    if admin and admin.get("is_active", True):
        # Generate secure random token
        reset_token = secrets.token_urlsafe(32)
        now = datetime.utcnow()
        expires_at = now + timedelta(minutes=15)
        col = get_collection("otps")

        # Invalidate old reset records
        while (await col.delete_one({"email": clean_email, "purpose": "password_reset"})).deleted_count:
            pass

        # Save new token
        await col.insert_one({
            "email": clean_email,
            "otp": reset_token,
            "purpose": "password_reset",
            "expires_at": expires_at.isoformat(),
            "used": False,
            "failed_attempts": 0,
            "created_at": now.isoformat()
        })

        # Build reset link and send email
        reset_url = f"{origin}/reset-password?token={reset_token}&email={quote(clean_email)}"
        await EmailService.send_password_reset_email(clean_email, reset_url)

    return {
        "success": True,
        "message": "If an account exists for this email, a password reset link has been sent to it.",
        "debug_otp": None
    }

@router.get("/verify-reset-token")
async def verify_reset_token(token: str, email: str):
    """Verify if a reset token is valid, active, and unexpired."""
    clean_email = email.strip().lower()
    col = get_collection("otps")
    record = await col.find_one({"email": clean_email, "otp": token, "purpose": "password_reset", "used": False})
    if not record:
        return {"valid": False, "message": "This password reset link is invalid or has already been used."}

    expires_at_str = record.get("expires_at")
    if expires_at_str:
        try:
            if datetime.utcnow() > datetime.fromisoformat(expires_at_str):
                return {"valid": False, "message": "This password reset link has expired. Please request a new one."}
        except (TypeError, ValueError):
            pass

    return {"valid": True, "message": "Reset token is valid."}

@router.post("/reset-password")
async def reset_password(req: ResetPasswordRequest):
    """Reset admin password after verifying the email reset token or OTP."""
    token_or_otp = req.token or req.otp
    if not token_or_otp:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="A reset token or verification code is required."
        )
    ok, msg = await AuthService.reset_password_with_otp(req.email, token_or_otp, req.new_password)
    if not ok:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=msg)
    return {"success": True, "message": msg}

@router.post("/logout")
async def admin_logout(request: Request, current_admin: Dict[str, Any] = Depends(get_current_admin)):
    """Log manual logout event."""
    client_ip = request.client.host if request.client else ""
    await LogService.log_logout(
        admin_email=current_admin.get("email", ""),
        admin_name=current_admin.get("username", "Admin"),
        role=current_admin.get("role", "admin"),
        ip=client_ip,
    )
    await revoke_sessions(current_admin["_id"])
    return {"success": True, "message": "Logged out successfully."}

@router.post("/session-timeout")
async def session_timeout(request: Request, current_admin: Dict[str, Any] = Depends(get_current_admin)):
    """Log auto-logout due to session inactivity timeout."""
    client_ip = request.client.host if request.client else ""
    await LogService.log_session_timeout(
        admin_email=current_admin.get("email", ""),
        admin_name=current_admin.get("username", "Admin"),
        role=current_admin.get("role", "admin"),
        ip=client_ip,
    )
    await revoke_sessions(current_admin["_id"])
    return {
        "success": True,
        "message": f"Session timed out after {settings.SESSION_TIMEOUT_MINUTES} minutes of inactivity.",
    }

@router.get("/session-config")
async def get_session_config():
    """Return session timeout configuration for the frontend."""
    return {
        "session_timeout_minutes": settings.SESSION_TIMEOUT_MINUTES,
    }


@router.get("/google/config", response_model=GoogleConfigResponse)
async def get_google_auth_config():
    """Return Google OAuth configuration and allowed corporate domains."""
    return GoogleConfigResponse(
        client_id=settings.GOOGLE_CLIENT_ID or "",
        allowed_domains=list(ALLOWED_DOMAINS),
    )


@router.post("/google", response_model=AdminLoginResponse)
async def google_auth(req: GoogleAuthRequest, request: Request):
    """
    Authenticate a user via Google Workspace OAuth.
    Strictly restricted to @rexera.co.in, @rexera.in, and @rexera.com domains.
    """
    client_ip = request.client.host if request.client else ""

    if req.credential:
        payload = await GoogleAuthService.verify_google_id_token(req.credential)
        email = payload.get("email", "")
        name = payload.get("name")
        picture = payload.get("picture")
    elif req.access_token:
        payload = await GoogleAuthService.fetch_google_userinfo(req.access_token)
        email = payload.get("email", "")
        name = payload.get("name")
        picture = payload.get("picture")
    elif req.email:
        email = req.email.strip().lower()
        name = email.split("@")[0].capitalize()
        picture = None
    else:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Google credential or company email is required.",
        )

    auth_data = await GoogleAuthService.authenticate_google_user(
        email=email,
        name=name,
        picture=picture,
    )

    await LogService.log_login(
        admin_email=auth_data["email"],
        admin_name=auth_data.get("admin_name", "User"),
        role=auth_data.get("role", "employee"),
        ip=client_ip,
    )

    return AdminLoginResponse(
        access_token=auth_data["access_token"],
        requires_2fa=False,
        email=auth_data["email"],
        message=auth_data.get("message", "Google authentication successful."),
        admin_name=auth_data.get("admin_name"),
        role=auth_data.get("role"),
    )


