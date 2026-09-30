import re
from datetime import date, datetime
from typing import Optional, Tuple

PAN_REGEX = re.compile(r"^[A-Z]{5}[0-9]{4}[A-Z]$")
AADHAAR_REGEX = re.compile(r"^\d{12}$")
IFSC_REGEX = re.compile(r"^[A-Z]{4}0[A-Z0-9]{6}$")
MOBILE_REGEX = re.compile(r"^[6-9]\d{9}$")
EMAIL_REGEX = re.compile(r"^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$")

def validate_pan(pan: str) -> Tuple[bool, str]:
    if not pan:
        return False, "PAN number is required"
    clean_pan = pan.strip().upper()
    if not PAN_REGEX.match(clean_pan):
        return False, "Invalid PAN format. Standard format is 5 uppercase letters, 4 digits, and 1 letter (e.g., ABCDE1234F)"
    return True, clean_pan

def validate_aadhaar(aadhaar: str) -> Tuple[bool, str]:
    if not aadhaar:
        return False, "Aadhaar number is required"
    clean_aadhaar = re.sub(r"[\s-]", "", aadhaar.strip())
    if not AADHAAR_REGEX.match(clean_aadhaar):
        return False, "Invalid Aadhaar number. Must be exactly 12 numeric digits"
    return True, clean_aadhaar

def validate_ifsc(ifsc: str) -> Tuple[bool, str]:
    if not ifsc:
        return False, "IFSC code is required"
    clean_ifsc = ifsc.strip().upper()
    if not IFSC_REGEX.match(clean_ifsc):
        return False, "Invalid IFSC format. Must be 4 letters followed by 0 and 6 alphanumeric characters (e.g., HDFC0001234)"
    return True, clean_ifsc

def validate_mobile(mobile: str) -> Tuple[bool, str]:
    if not mobile:
        return False, "Mobile number is required"
    clean_mobile = re.sub(r"[\s+().-]", "", mobile.strip())
    if clean_mobile.startswith("91") and len(clean_mobile) == 12:
        clean_mobile = clean_mobile[2:]
    elif clean_mobile.startswith("0") and len(clean_mobile) == 11:
        clean_mobile = clean_mobile[1:]
    if not MOBILE_REGEX.match(clean_mobile):
        return False, "Invalid mobile number. Must be a valid 10-digit Indian mobile number"
    return True, clean_mobile

def validate_email(email: str) -> Tuple[bool, str]:
    if not email:
        return False, "Email address is required"
    clean_email = email.strip().lower()
    if not EMAIL_REGEX.match(clean_email):
        return False, "Invalid email address format"
    return True, clean_email

def row_error(e: Exception) -> str:
    """Readable one-line reason for a rejected bulk-import row."""
    detail = getattr(e, "detail", None)
    if isinstance(detail, str):
        return detail
    errors = getattr(e, "errors", None)
    if callable(errors):
        try:
            parts = []
            for err in errors():
                field = ".".join(str(p) for p in err.get("loc", ()))
                msg = str(err.get("msg", "")).replace("Value error, ", "")
                parts.append(f"{field.replace('_', ' ')}: {msg}" if field else msg)
            return "; ".join(parts)
        except Exception:
            pass
    return str(e)


def search_pattern(text: str) -> str:
    """User search text as a literal-match regex (safe for Postgres `~*` and Python `re`)."""
    return re.escape((text or "").strip()[:100])


# ---------------------------------------------------------------------------
# Pydantic field-validator helpers: return the cleaned value or raise ValueError
# (which FastAPI turns into a 422 with the message).
# ---------------------------------------------------------------------------
# Placeholder the old employee form stored when no bank details were given.
IFSC_PLACEHOLDERS = {"REX0001"}
MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July",
               "August", "September", "October", "November", "December"]


def require_mobile(value: str) -> str:
    ok, res = validate_mobile(value or "")
    if not ok:
        raise ValueError(res)
    return res


def optional_phone(value: Optional[str], label: str = "Phone number") -> str:
    """Blank stays blank; anything else must be a 10-digit number (spaces, dashes and a +91 / 0 prefix are dropped).
    Landlines count too (STD code + number is 10 digits), so no mobile-only first digit is required."""
    raw = str(value or "").strip()
    if not raw:
        return ""
    digits = re.sub(r"[\s+().-]", "", raw)
    if digits.startswith("91") and len(digits) == 12:
        digits = digits[2:]
    elif digits.startswith("0") and len(digits) == 11:
        digits = digits[1:]
    if not re.fullmatch(r"\d{10}", digits):
        raise ValueError(f"{label} must be a 10-digit number.")
    return digits


def optional_ifsc(value: Optional[str]) -> str:
    """Blank is allowed (bank details can be added later); anything else must be a real IFSC."""
    v = (value or "").strip().upper()
    if not v or v in IFSC_PLACEHOLDERS:
        return ""
    ok, res = validate_ifsc(v)
    if not ok:
        raise ValueError(res)
    return res


def parse_iso_date(value: str, label: str = "Date") -> date:
    v = str(value or "").strip()
    try:
        if len(v) != 10:
            raise ValueError
        return datetime.strptime(v, "%Y-%m-%d").date()
    except ValueError:
        raise ValueError(f"{label} must be a valid date (YYYY-MM-DD).") from None


def require_iso_date(value: str, label: str = "Date") -> str:
    """Validates a YYYY-MM-DD date and returns it normalised."""
    return parse_iso_date(value, label).isoformat()


def optional_iso_date(value: Optional[str], label: str = "Date") -> str:
    v = (value or "").strip()
    return require_iso_date(v, label) if v else ""


def require_hhmm(value: str, label: str = "Time") -> str:
    v = str(value or "").strip()
    m = re.fullmatch(r"([01]?\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?", v)  # <input type=time> may add :SS
    if not m:
        raise ValueError(f"{label} must be a valid 24-hour time (HH:MM).")
    return f"{int(m.group(1)):02d}:{m.group(2)}"


def require_choice(value: str, choices, label: str) -> str:
    v = str(value or "").strip()
    for c in choices:
        if v.lower() == c.lower():
            return c
    raise ValueError(f"{label} must be one of: {', '.join(choices)}.")


def require_month_name(value: str) -> str:
    return require_choice(value, MONTH_NAMES, "Month")


def mask_account_number(account_no: str) -> str:
    """Mask account number to show only last 4 digits (e.g. ••••••••1234)."""
    if not account_no:
        return ""
    clean = str(account_no).strip()
    if len(clean) <= 4:
        return "••••" + clean
    return "•" * (len(clean) - 4) + clean[-4:]
