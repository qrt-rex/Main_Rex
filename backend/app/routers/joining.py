import logging
from datetime import datetime, timedelta
from typing import Dict, Any, Optional
from fastapi import APIRouter, HTTPException, Depends, status, Request
from app.database import get_collection, fix_id
from pydantic import ValidationError
from app.schemas.joining import (
    GenerateTokenRequest,
    JoiningTokenResponse,
    ValidateTokenRequest,
    ValidateTokenResponse,
    VerifyTokenOTPRequest,
    OnboardingSubmitRequest,
    OnboardingSubmissionResponse
)
from app.schemas.employee import EmployeeCreateRequest
from app.utils.tokens import generate_alphanumeric_token
from app.utils.validators import validate_pan, validate_aadhaar, validate_ifsc, validate_mobile, row_error
from app.services.otp_service import OTPService
from app.services.email_service import EmailService
from app.services.employee_service import EmployeeService
from app.services.candidate_service import CandidateService
from app.services.log_service import LogService
from app.services.auth_service import get_current_admin

logger = logging.getLogger("rexera.router.joining")
router = APIRouter(prefix="/api/joining", tags=["Onboarding & Joining"])

# How long after verifying the emailed code the candidate may submit the onboarding form.
ONBOARDING_SESSION_HOURS = 24

@router.post("/generate-token", response_model=JoiningTokenResponse)
async def generate_joining_token(req: GenerateTokenRequest, admin: Dict[str, Any] = Depends(get_current_admin)):
    """
    Admin endpoint to generate a cryptographically random joining token (e.g. REX-A1B2C3)
    for selected candidates and dispatch the onboarding invitation email.
    """
    col = get_collection("joining_tokens")
    
    # Check if active unused token already exists for candidate
    if req.candidate_id:
        existing = await col.find_one({"candidate_id": req.candidate_id, "used": False})
        if existing:
            # Check expiry
            exp = datetime.fromisoformat(existing["expires_at"])
            if exp > datetime.utcnow():
                token_data = fix_id(existing)
                if token_data:
                    return JoiningTokenResponse(**token_data)

    prefix = "INT" if req.token_type == "intern" else "REX"
    token_str = generate_alphanumeric_token(prefix=prefix, length=6)
    expires_at = (datetime.utcnow() + timedelta(days=req.expires_in_days)).isoformat()
    now = datetime.utcnow().isoformat()

    doc = {
        "token": token_str,
        "candidate_id": req.candidate_id,
        "full_name": req.full_name,
        "email": req.email.lower(),
        "department": req.department or "Engineering",
        "designation": req.designation or "Associate",
        "token_type": req.token_type,
        "expires_at": expires_at,
        "used": False,
        "created_at": now
    }
    
    res = await col.insert_one(doc)
    doc["id"] = str(res.inserted_id)
    doc["_id"] = str(res.inserted_id)

    # Dispatch email invitation
    await EmailService.send_joining_token_email(
        to_email=req.email,
        candidate_name=req.full_name,
        token=token_str,
        position=req.designation or "Associate"
    )

    # If linked to candidate, update candidate status
    if req.candidate_id:
        await CandidateService.update_candidate_status(req.candidate_id, "Selected", f"Joining token {token_str} issued.")

    return JoiningTokenResponse(**doc)

@router.post("/validate-token", response_model=ValidateTokenResponse)
async def validate_joining_token(req: ValidateTokenRequest):
    """
    Validates the joining token entered on the /joining page.
    Triggers an email OTP to the candidate's registered email for identity verification.
    """
    col = get_collection("joining_tokens")
    clean_token = req.token.strip().upper()
    
    record = await col.find_one({"token": clean_token})
    if not record:
        return ValidateTokenResponse(
            valid=False,
            message="Invalid joining token. Please verify the token from your offer email.",
            token=clean_token
        )

    if record.get("used", False):
        return ValidateTokenResponse(
            valid=False,
            message="This joining token has already been used to complete onboarding.",
            token=clean_token
        )

    # Check expiration
    expires_at_str = record.get("expires_at")
    if expires_at_str:
        expires_at = datetime.fromisoformat(expires_at_str)
        if datetime.utcnow() > expires_at:
            return ValidateTokenResponse(
                valid=False,
                message="This joining token has expired. Please contact Rexera HR for a new token.",
                token=clean_token
            )

    # Token is valid! Dispatch Email OTP
    await OTPService.create_and_send_otp(record["email"], purpose="onboarding")

    return ValidateTokenResponse(
        valid=True,
        message=f"Token verified. A 6-digit identity OTP has been sent to {record['email']}.",
        token=clean_token,
        candidate_id=record.get("candidate_id"),
        full_name=record.get("full_name"),
        email=record.get("email"),
        department=record.get("department"),
        designation=record.get("designation"),
        token_type=record.get("token_type", "employee"),
        requires_email_otp=True
    )

async def _active_token(token: str) -> Optional[Dict[str, Any]]:
    """The unused, unexpired joining-token record for this token string."""
    record = await get_collection("joining_tokens").find_one({"token": token.strip().upper(), "used": False})
    if not record:
        return None
    try:
        if datetime.utcnow() > datetime.fromisoformat(record.get("expires_at", "")):
            return None
    except ValueError:
        return None
    return record


@router.post("/verify-token-otp")
async def verify_token_otp(
    body: Optional[VerifyTokenOTPRequest] = None,
    token: Optional[str] = None, otp: Optional[str] = None, email: Optional[str] = None,
):
    """Verifies the email OTP before opening the onboarding form.

    The code travels in the JSON body (query parameters are still read for pages cached
    before this change, but they end up in access logs). The code is always checked against
    the email the token was issued to, and the verification is recorded on the token so
    /submit-onboarding can require it.
    """
    token = body.token if body else token
    otp = body.otp if body else otp
    if not token or not otp:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Token and verification code are required.")
    record = await _active_token(token)
    if not record:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid, expired or already used joining token.")
    ok, msg = await OTPService.verify_otp(record["email"], otp, purpose="onboarding")
    if not ok:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=msg)
    await get_collection("joining_tokens").update_one(
        {"_id": record["_id"]}, {"$set": {"otp_verified_at": datetime.utcnow().isoformat()}}
    )
    return {"success": True, "message": "Email OTP verified. You may proceed to fill the onboarding form."}

@router.post("/submit-onboarding", response_model=OnboardingSubmissionResponse)
async def submit_onboarding(req: OnboardingSubmitRequest, request: Request):
    """
    Submits candidate onboarding details, validates PAN, Aadhaar, IFSC,
    records 13-clause HR Policy digital agreement acceptance, marks token used,
    and automatically registers the employee into the Employee Directory.
    """
    # 1. Verify token, and that its email OTP was verified (a token alone must not complete onboarding)
    col_tokens = get_collection("joining_tokens")
    token_record = await _active_token(req.token)
    if not token_record:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid, expired or already used joining token.")
    verified_at = token_record.get("otp_verified_at")
    try:
        verified_recently = bool(verified_at) and datetime.utcnow() - datetime.fromisoformat(verified_at) < timedelta(hours=ONBOARDING_SESSION_HOURS)
    except ValueError:
        verified_recently = False
    if not verified_recently:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN,
                            detail="Please verify the code sent to your email before submitting onboarding.")
    # The invitation's email is authoritative; the form can't register a different address.
    invited_email = token_record["email"].lower()

    # 2. Server-side validations
    ok_pan, pan_val = validate_pan(req.pan_number)
    if not ok_pan:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=pan_val)

    ok_aadhaar, aadhaar_val = validate_aadhaar(req.aadhaar_number)
    if not ok_aadhaar:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=aadhaar_val)

    ok_ifsc, ifsc_val = validate_ifsc(req.ifsc_code)
    if not ok_ifsc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=ifsc_val)

    ok_mobile, mob_val = validate_mobile(req.mobile_number)
    if not ok_mobile:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=mob_val)

    now = datetime.utcnow().isoformat()
    client_ip = request.client.host if request.client else "127.0.0.1"

    # 3. Create the employee first: if that fails (e.g. the email is already an employee),
    #    the token stays usable instead of being burned with no employee behind it.
    try:
        emp_payload = EmployeeCreateRequest(
            full_name=req.full_name,
            email=invited_email,
            mobile_number=mob_val,
            gender=req.gender,
            department=token_record.get("department") or "Engineering",
            designation=token_record.get("designation") or "Associate",
            date_of_joining=now[:10],
            base_salary=35000.0,  # Default starter or from candidate CTC
            hra=14000.0,
            conveyance_allowance=1600.0,
            special_allowance=4400.0,
            professional_tax=200.0,
            pf_opted=True,
            bank_name=req.bank_name,
            account_no=req.account_no,
            ifsc_code=ifsc_val,
            employee_status="Active",
            joining_status="Completed"
        )
    except ValidationError as e:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=row_error(e))
    created_emp = await EmployeeService.create_employee(emp_payload)

    # 4. Store onboarding submission
    col_subs = get_collection("onboarding_submissions")
    sub_doc = req.model_dump()
    sub_doc["email"] = invited_email
    sub_doc["pan_number"] = pan_val
    sub_doc["aadhaar_number"] = aadhaar_val
    sub_doc["ifsc_code"] = ifsc_val
    sub_doc["mobile_number"] = mob_val
    sub_doc["token_id"] = str(token_record["_id"])
    sub_doc["candidate_id"] = token_record.get("candidate_id")
    sub_doc["employee_id"] = created_emp["id"]
    sub_doc["agreement"]["accepted_at"] = now
    sub_doc["agreement"]["ip_address"] = client_ip
    sub_doc["submitted_at"] = now

    sub_res = await col_subs.insert_one(sub_doc)
    submission_id = str(sub_res.inserted_id)

    # 5. Mark token as used
    await col_tokens.update_one(
        {"_id": token_record["_id"]},
        {"$set": {"used": True, "used_at": now, "submission_id": submission_id}}
    )

    # 6. If candidate exists, update status to Joined
    if token_record.get("candidate_id"):
        await CandidateService.update_candidate_status(
            token_record["candidate_id"],
            "Joined",
            f"Onboarding completed successfully. Employee code: {created_emp['employee_code']}"
        )

    # 7. Log the onboarding completion for the dashboard notification feed
    await LogService.log_onboarding_completed(
        employee_name=created_emp.get("full_name", req.full_name),
        employee_code=created_emp.get("employee_code", ""),
        candidate_id=token_record.get("candidate_id") or "",
    )

    return OnboardingSubmissionResponse(
        success=True,
        message=f"Onboarding completed and HR Policy Agreement signed successfully! Welcome to Rexera, {req.full_name}.",
        submission_id=submission_id,
        employee_code=created_emp.get("employee_code"),
        created_at=now
    )
