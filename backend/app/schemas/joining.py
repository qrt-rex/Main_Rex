from typing import Literal, Optional
from pydantic import BaseModel, EmailStr, Field, field_validator, model_validator
from app.utils.sanitize import clean_payload
from app.utils.validators import optional_phone, require_iso_date, require_mobile

class GenerateTokenRequest(BaseModel):
    candidate_id: Optional[str] = None
    full_name: str = Field(min_length=1, max_length=120)
    email: EmailStr
    department: Optional[str] = "Engineering"
    designation: Optional[str] = "Associate"
    token_type: Literal["employee", "intern"] = "employee"
    expires_in_days: int = Field(default=7, ge=1, le=90)

class JoiningTokenResponse(BaseModel):
    id: str
    token: str
    candidate_id: Optional[str] = None
    full_name: str
    email: str
    department: str
    designation: str
    token_type: str
    expires_at: str
    used: bool
    created_at: str

class ValidateTokenRequest(BaseModel):
    token: str = Field(min_length=1, max_length=40)

class VerifyTokenOTPRequest(BaseModel):
    token: str = Field(min_length=1, max_length=40)
    otp: str = Field(min_length=1, max_length=10)
    email: Optional[EmailStr] = None  # ignored: the code is always checked against the invited email

class ValidateTokenResponse(BaseModel):
    valid: bool
    message: str
    token: str
    candidate_id: Optional[str] = None
    full_name: Optional[str] = None
    email: Optional[str] = None
    department: Optional[str] = None
    designation: Optional[str] = None
    token_type: Optional[str] = "employee"
    requires_email_otp: bool = True

class AgreementAcceptance(BaseModel):
    accepted: bool = False  # must be explicitly true: an unsigned policy is never recorded as signed
    signature_name: str
    accepted_at: Optional[str] = None
    ip_address: Optional[str] = None

    @field_validator("accepted")
    @classmethod
    def _must_accept(cls, v):
        if v is not True:
            raise ValueError("The HR Policy Agreement must be accepted to complete onboarding.")
        return v

    @field_validator("signature_name")
    @classmethod
    def _signed(cls, v):
        if not v or not v.strip():
            raise ValueError("Please type your full legal name as your digital signature.")
        return v.strip()

class OnboardingSubmitRequest(BaseModel):
    @model_validator(mode="before")
    @classmethod
    def _neutralize_markup(cls, data):
        return clean_payload(data)

    token: str
    # Personal Details
    full_name: str
    parent_name: str  # Father / Mother Name
    date_of_birth: str
    gender: str
    marital_status: str
    nationality: str = "Indian"
    blood_group: str
    mobile_number: str
    alternate_mobile: Optional[str] = ""
    email: EmailStr
    
    # Addresses
    permanent_address: str
    correspondence_address: str
    
    # Identification
    aadhaar_number: str
    pan_number: str
    
    # Emergency Contact
    emergency_contact_name: str
    emergency_contact_number: str
    emergency_contact_relation: str
    family_contact: Optional[str] = ""
    
    # Banking Information
    bank_name: str
    account_no: str
    ifsc_code: str
    
    # Policy Agreement
    agreement: AgreementAcceptance

    @field_validator("date_of_birth")
    @classmethod
    def _dob(cls, v):
        return require_iso_date(v, "Date of birth")

    @field_validator("full_name", "parent_name", "permanent_address", "correspondence_address",
                     "emergency_contact_name", "emergency_contact_number", "bank_name", "account_no")
    @classmethod
    def _required(cls, v):
        if not v or not str(v).strip():
            raise ValueError("This field is required.")
        return str(v).strip()

    @field_validator("mobile_number")
    @classmethod
    def _mobile(cls, v):
        return require_mobile(v)

    @field_validator("alternate_mobile")
    @classmethod
    def _alternate(cls, v):
        return optional_phone(v, "Alternate number")

    @field_validator("emergency_contact_number")
    @classmethod
    def _emergency(cls, v):
        return optional_phone(v, "Emergency contact number")

class OnboardingSubmissionResponse(BaseModel):
    success: bool
    message: str
    submission_id: str
    employee_code: Optional[str] = None
    created_at: str
