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
    otp: Optional[str] = None
    token: Optional[str] = None
    new_password: str = Field(min_length=8, max_length=128)

class ChangePasswordRequest(BaseModel):
    old_password: str
    new_password: str

class AdminProfileResponse(BaseModel):
    id: str
    username: str
    email: str
    role: str
    is_active: bool
    last_login: Optional[str] = None

class GoogleAuthRequest(BaseModel):
    credential: Optional[str] = None
    access_token: Optional[str] = None
    email: Optional[str] = None


class GoogleConfigResponse(BaseModel):
    client_id: Optional[str] = None
    allowed_domains: list[str]

