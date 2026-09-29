import logging
from typing import Dict, Any
from fastapi import APIRouter, HTTPException, Depends, status, Request
from app.schemas.auth import (
    AdminLoginRequest,
    AdminLoginResponse,
    Admin2FAVerifyRequest,
    Resend2FARequest,
    ForgotPasswordRequest,
    ResetPasswordRequest,
    AdminProfileResponse,
    GoogleAuthRequest,
    GoogleConfigResponse,
)
from app.services.auth_service import AuthService, get_current_admin, revoke_sessions, verify_2fa_temp_token
from app.services.google_auth_service import GoogleAuthService, ALLOWED_DOMAINS
from app.services.otp_service import OTPService
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
async def forgot_password(req: ForgotPasswordRequest):
    """Send a password reset OTP code to the registered admin email.

    Always answers the same way (no account enumeration), and never returns the code:
    anyone may call this, so the code must only ever reach the mailbox.
    """
    admin = await get_collection("admins").find_one({"email": req.email.strip().lower()})
    if admin and admin.get("is_active", True):
        try:
            await OTPService.create_and_send_otp(req.email, purpose="password_reset")
        except HTTPException:
            pass  # rate-limited: answer identically so the response never reveals the account exists
    return {"success": True, "message": "If an account exists for this email, a reset code has been sent to it.",
            "debug_otp": None}

@router.post("/reset-password")
async def reset_password(req: ResetPasswordRequest):
    """Reset admin password after verifying the email OTP."""
    ok, msg = await AuthService.reset_password_with_otp(req.email, req.otp, req.new_password)
    if not ok:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=msg)
    return {"success": True, "message": msg}

@router.get("/me", response_model=AdminProfileResponse)
async def get_me(current_admin: Dict[str, Any] = Depends(get_current_admin)):
    """Return profile details of the logged-in administrator."""
    return AdminProfileResponse(
        id=current_admin.get("id", str(current_admin.get("_id"))),
        username=current_admin.get("username", "Admin"),
        email=current_admin.get("email"),
        role=current_admin.get("role", "admin"),
        is_active=current_admin.get("is_active", True),
        last_login=current_admin.get("last_login")
    )

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


