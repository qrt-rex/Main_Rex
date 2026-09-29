from typing import Optional
from pydantic import BaseModel, EmailStr, Field

class AdminLoginRequest(BaseModel):
    email: EmailStr
    password: str

class AdminLoginResponse(BaseModel):
    access_token: Optional[str] = None
    token_type: str = "bearer"
    requires_2fa: bool = False
    temp_token: Optional[str] = None
    email: str
    message: str
    admin_name: Optional[str] = None
    role: Optional[str] = None
    debug_otp: Optional[str] = None  # only populated when EMAIL_DEV_MODE is on

class Admin2FAVerifyRequest(BaseModel):
    email: EmailStr
    otp: str
    temp_token: Optional[str] = None  # required: issued by /login after the password check

class Resend2FARequest(BaseModel):
    email: EmailStr
    temp_token: Optional[str] = None  # required: issued by /login after the password check

class ForgotPasswordRequest(BaseModel):
    email: EmailStr

class ResetPasswordRequest(BaseModel):
    email: EmailStr
    otp: str
    new_password: str = Field(min_length=8, max_length=128)
