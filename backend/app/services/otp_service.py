import logging
import secrets
from datetime import datetime, timedelta
from typing import Tuple, Optional
from fastapi import HTTPException, status
from app.database import get_collection
from app.utils.tokens import generate_otp
from app.config import settings
from app.services.email_service import EmailService

logger = logging.getLogger("rexera.otp")

# A code is burned after this many wrong guesses, so a 6-digit code cannot be brute-forced.
MAX_VERIFY_ATTEMPTS = 5
# At most this many codes per email + purpose inside the window (stops email-bombing).
MAX_SENDS_PER_WINDOW = 5
SEND_WINDOW_MINUTES = 15

# Purposes the unauthenticated /api/otp endpoints may issue or check. Admin login and
# password-reset codes are only ever issued by the auth flow itself.
PUBLIC_PURPOSES = {"onboarding", "candidate_apply"}


def send_window(previous: Optional[dict], now: datetime) -> Tuple[int, datetime]:
    """(send_count, window_started) for a new code, carried over from the previous code for the same
    email + purpose so replacing a code can't reset the counter. Over MAX_SENDS_PER_WINDOW = too many."""
    if not previous:
        return 1, now
    try:
        prev_start = datetime.fromisoformat(previous.get("window_started") or previous.get("created_at"))
    except (TypeError, ValueError):
        prev_start = now
    if now - prev_start < timedelta(minutes=SEND_WINDOW_MINUTES):
        return int(previous.get("send_count", 1)) + 1, prev_start
    return 1, now


class OTPService:
    @classmethod
    async def create_and_send_otp(cls, email: str, purpose: str = "login_2fa") -> Tuple[bool, str, Optional[str]]:
        """
        Generates an OTP, stores it in the database with expiry, and dispatches it via email.
        Returns: (success, message, debug_otp_for_dev)
        Raises HTTP 429 when too many codes were requested for this email recently.
        """
        col = get_collection("otps")
        clean_email = email.strip().lower()
        now = datetime.utcnow()

        send_count, window_started = send_window(await col.find_one({"email": clean_email, "purpose": purpose}), now)
        if send_count > MAX_SENDS_PER_WINDOW:
            wait = SEND_WINDOW_MINUTES - int((now - window_started).total_seconds() // 60)
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=f"Too many verification codes requested. Please try again in {max(wait, 1)} minutes.",
            )

        # Invalidate old codes for this email and purpose
        while (await col.delete_one({"email": clean_email, "purpose": purpose})).deleted_count:
            pass

        otp_code = generate_otp(6)
        expires_at = now + timedelta(minutes=settings.OTP_EXPIRE_MINUTES)

        doc = {
            "email": clean_email,
            "otp": otp_code,
            "purpose": purpose,
            "expires_at": expires_at.isoformat(),
            "used": False,
            "failed_attempts": 0,
            "send_count": send_count,
            "window_started": window_started.isoformat(),
            "created_at": now.isoformat()
        }
        await col.insert_one(doc)

        # Purpose description for email
        purpose_labels = {
            "login_2fa": "Admin 2-Factor Authentication",
            "onboarding": "Employee Onboarding Verification",
            "password_reset": "Admin Password Reset",
            "candidate_apply": "Candidate Application Verification"
        }
        purpose_label = purpose_labels.get(purpose, "Rexera Security Verification")

        # Dispatch email asynchronously
        sent = await EmailService.send_otp_email(clean_email, otp_code, purpose_label)
        if not sent:
            await col.delete_one({"email": clean_email, "purpose": purpose})
            return False, "Could not send the verification email. Please contact the administrator.", None

        debug_otp = otp_code if settings.EMAIL_DEV_MODE else None
        return True, f"A 6-digit verification code has been sent to {clean_email}.", debug_otp

    @classmethod
    async def verify_otp(cls, email: str, otp_code: str, purpose: str = "login_2fa") -> Tuple[bool, str]:
        """
        Verifies if the provided OTP is valid, unexpired, and unused.
        Each wrong guess counts against the active code; after MAX_VERIFY_ATTEMPTS it is burned.
        """
        col = get_collection("otps")
        clean_email = email.strip().lower()
        clean_otp = str(otp_code).strip()

        record = await col.find_one({"email": clean_email, "purpose": purpose, "used": False})
        if not record:
            return False, "Invalid or expired verification code."

        # Check expiration
        expires_at_str = record.get("expires_at")
        if expires_at_str:
            try:
                expires_at = datetime.fromisoformat(expires_at_str)
                if datetime.utcnow() > expires_at:
                    return False, "Verification code has expired. Please request a new code."
            except Exception:
                pass

        if not secrets.compare_digest(str(record.get("otp", "")), clean_otp):
            attempts = int(record.get("failed_attempts", 0)) + 1
            if attempts >= MAX_VERIFY_ATTEMPTS:
                await col.update_one({"_id": record["_id"]}, {"$set": {"used": True, "failed_attempts": attempts,
                                                                      "burned_at": datetime.utcnow().isoformat()}})
                return False, "Too many incorrect attempts. Please request a new verification code."
            await col.update_one({"_id": record["_id"]}, {"$set": {"failed_attempts": attempts}})
            return False, "Invalid or expired verification code."

        # Mark OTP as used
        await col.update_one({"_id": record["_id"]}, {"$set": {"used": True, "used_at": datetime.utcnow().isoformat()}})
        return True, "Verification successful."
