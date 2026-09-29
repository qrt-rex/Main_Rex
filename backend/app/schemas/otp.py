from typing import Optional
from pydantic import BaseModel, EmailStr

class SendOTPRequest(BaseModel):
    email: EmailStr
    purpose: str = "onboarding"  # public purposes only: onboarding, candidate_apply

class OTPResponse(BaseModel):
    success: bool
    message: str
    debug_otp: Optional[str] = None  # Returned in dev mode for local testing
    expires_in_seconds: int = 600
