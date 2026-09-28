import os
from typing import List, Optional
from pydantic_settings import BaseSettings
from pydantic import Field

class Settings(BaseSettings):
    APP_NAME: str = "Rexera HR Management System"
    APP_ENV: str = "development"
    DEBUG: bool = False
    PORT: int = 8000
    HOST: str = "0.0.0.0"
    CORS_ORIGINS: List[str] = ["*"]

    # Database (PostgreSQL)
    POSTGRES_URI: str = "postgresql+asyncpg://postgres:postgres@localhost:5432/rexera_hr"
    DB_SCHEMA: str = "hr_rexera"

    # Security
    JWT_SECRET_KEY: str = "rexera_super_secure_jwt_secret_key_2026_random_string_change_in_prod"
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 1440  # 24 hours
    OTP_EXPIRE_MINUTES: int = 10
    SESSION_TIMEOUT_MINUTES: int = 60  # Auto-logout after this many minutes of inactivity

    # Default Admin
    DEFAULT_ADMIN_EMAIL: str = "superadmin@rexera.co.in"
    DEFAULT_ADMIN_PASSWORD: str = "QRT##11111"
    DEFAULT_ADMIN_USERNAME: str = "superadmin"
    SEED_DUMMY_DATA: bool = False

    # SMTP / Email (Hostinger)
    SMTP_HOST: str = "smtp.hostinger.com"
    SMTP_PORT: int = 587
    SMTP_USER: Optional[str] = "no-reply@hr.rexera.in"
    SMTP_PASSWORD: Optional[str] = ""
    SMTP_FROM_EMAIL: str = "no-reply@hr.rexera.in"
    SMTP_FROM_NAME: str = "Rexera HR Portal"
    EMAIL_DEV_MODE: bool = False
    # HTTPS email API (Brevo), used instead of SMTP when set. Needed on hosts that block SMTP (e.g. Render).
    BREVO_API_KEY: Optional[str] = ""

    # Automations: the in-process scheduler (turn off on extra workers so jobs run once)
    AUTOMATIONS_ENABLED: bool = True
    AUTOMATION_TIMEZONE: str = "Asia/Kolkata"

    # Company Details
    COMPANY_NAME: str = "Rexera Technologies Inc."
    COMPANY_ADDRESS: str = "Rexera, Ahmedabad"
    COMPANY_PHONE: str = "+91 40 4852 9000"
    COMPANY_EMAIL: str = "hr@rexera.co.in"
    COMPANY_WEBSITE: str = "https://www.rexera.co.in"

    class Config:
        env_file = os.path.join(os.path.dirname(os.path.dirname(__file__)), ".env")
        env_file_encoding = "utf-8"
        extra = "ignore"

settings = Settings()
