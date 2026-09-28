import secrets
import string
from datetime import datetime, timedelta
from typing import Optional, Dict, Any
import jwt
from app.config import settings

def generate_alphanumeric_token(prefix: str = "REX", length: int = 6) -> str:
    """
    Generate a cryptographically secure uppercase alphanumeric token.
    Example output: REX-A1B2C3 or INT-7K9M2P
    """
    chars = string.ascii_uppercase + string.digits
    # Avoid ambiguous characters (0, O, I, 1, L)
    clean_chars = "".join([c for c in chars if c not in "0OI1L"])
    code = "".join(secrets.choice(clean_chars) for _ in range(length))
    return f"{prefix}-{code}"

def generate_otp(length: int = 6) -> str:
    """Generate a 6-digit numeric OTP."""
    digits = string.digits
    return "".join(secrets.choice(digits) for _ in range(length))

def create_access_token(data: Dict[str, Any], expires_delta: Optional[timedelta] = None) -> str:
    """Create a signed JWT access token."""
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire, "iat": datetime.utcnow()})
    encoded_jwt = jwt.encode(to_encode, settings.JWT_SECRET_KEY, algorithm=settings.JWT_ALGORITHM)
    return encoded_jwt

def decode_access_token(token: str) -> Optional[Dict[str, Any]]:
    """Decode and verify a JWT access token."""
    try:
        payload = jwt.decode(token, settings.JWT_SECRET_KEY, algorithms=[settings.JWT_ALGORITHM])
        return payload
    except Exception:
        return None
