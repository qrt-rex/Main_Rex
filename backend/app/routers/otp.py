import logging
from fastapi import APIRouter, HTTPException, status
from app.schemas.otp import SendOTPRequest, VerifyOTPRequest, OTPResponse
from app.services.otp_service import OTPService, PUBLIC_PURPOSES

logger = logging.getLogger("rexera.router.otp")
router = APIRouter(prefix="/api/otp", tags=["Email OTP Verification"])


def _check_purpose(purpose: str) -> None:
    # These endpoints are public: they must never issue or consume admin login / password-reset codes.
    if purpose not in PUBLIC_PURPOSES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unsupported verification purpose.")


@router.post("/send", response_model=OTPResponse)
async def send_email_otp(req: SendOTPRequest):
    """Dispatches a 6-digit OTP code to the specified email."""
    _check_purpose(req.purpose)
    ok, msg, debug_otp = await OTPService.create_and_send_otp(req.email, purpose=req.purpose)
    if not ok:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=msg)
    return OTPResponse(
        success=True,
        message=msg,
        debug_otp=debug_otp,
        expires_in_seconds=600
    )

@router.post("/verify")
async def verify_email_otp(req: VerifyOTPRequest):
    """Verifies a 6-digit OTP code for the given email and purpose."""
    _check_purpose(req.purpose)
    ok, msg = await OTPService.verify_otp(req.email, req.otp, purpose=req.purpose)
    if not ok:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=msg)
    return {"success": True, "message": msg}
