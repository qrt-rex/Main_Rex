"""Request bodies for PF / EPF management. Money and rates arrive as Decimal (never float) and are range-checked here;
cross-record rules (overlapping rules, duplicate UANs, rules already used by finalized payroll) live in pf_service."""
import re
from decimal import Decimal
from typing import Optional

from pydantic import BaseModel, Field, field_validator, model_validator

from app.services.pf_engine import BASES, ROUNDING
from app.utils.validators import optional_iso_date, require_iso_date

UAN_RE = re.compile(r"^\d{12}$")
# Establishment-issued member ID, e.g. MHBAN00000640000000125 (letters, digits and "/" only).
MEMBER_ID_RE = re.compile(r"^[A-Z0-9/]{10,30}$")

Amount = Field(ge=0, le=Decimal("100000000"), max_digits=12, decimal_places=2)
Percent = Field(ge=0, le=100, max_digits=7, decimal_places=4)
RULE_STATUSES = ("ACTIVE", "INACTIVE")


def _reason(v: Optional[str]) -> str:
    return (v or "").strip()[:500]


class PFSettingsUpdate(BaseModel):
    enabled: Optional[bool] = None
    require_uan_to_finalize: Optional[bool] = None
    require_member_id_to_finalize: Optional[bool] = None
    reason: str = Field(default="", max_length=500)


class _RuleFields(BaseModel):
    @field_validator("calculation_basis", check_fields=False)
    @classmethod
    def _basis(cls, v):
        if v is None:
            return v
        v = str(v).strip().upper()
        if v not in BASES:
            raise ValueError(f"PF wage basis must be one of: {', '.join(BASES.values())}.")
        return v

    @field_validator("rounding", check_fields=False)
    @classmethod
    def _rounding(cls, v):
        if v is None:
            return v
        v = str(v).strip().upper()
        if v not in ROUNDING:
            raise ValueError("Rounding must be PAISE or RUPEE.")
        return v

    @field_validator("status", check_fields=False)
    @classmethod
    def _status(cls, v):
        if v is None:
            return v
        v = str(v).strip().upper()
        if v not in RULE_STATUSES:
            raise ValueError("Rule status must be Active or Inactive.")
        return v

    @field_validator("effective_from", check_fields=False)
    @classmethod
    def _from(cls, v):
        return v if v is None else require_iso_date(v, "Effective from")

    @field_validator("effective_to", check_fields=False)
    @classmethod
    def _to(cls, v):
        return v if v is None else optional_iso_date(v, "Effective to")

    @field_validator("rule_name", check_fields=False)
    @classmethod
    def _name(cls, v):
        if v is not None and not str(v).strip():
            raise ValueError("Give the rule a name.")
        return v.strip() if isinstance(v, str) else v


class PFRuleCreate(_RuleFields):
    rule_name: str = Field(max_length=120)
    minimum_pf_wage: Decimal = Amount
    maximum_pf_wage: Decimal = Amount
    employee_contribution_percent: Decimal = Percent
    employer_contribution_percent: Decimal = Percent
    eps_percent: Decimal = Percent
    eps_enabled: bool = True
    eps_wage_ceiling: Optional[Decimal] = Field(default=None, ge=0, le=Decimal("100000000"), max_digits=12, decimal_places=2)
    calculation_basis: str = "BASIC"
    rounding: str = "PAISE"
    effective_from: str
    effective_to: Optional[str] = ""
    status: str = "ACTIVE"
    applicability_notes: str = Field(default="", max_length=1000)
    # End the current open-ended rule the day before this one starts (instead of rejecting the overlap).
    close_previous: bool = True
    reason: str = Field(default="", max_length=500)

    @model_validator(mode="after")
    def _consistent(self):
        validate_rule_values(self.model_dump())
        return self


class PFRuleUpdate(_RuleFields):
    rule_name: Optional[str] = Field(default=None, max_length=120)
    minimum_pf_wage: Optional[Decimal] = Field(default=None, ge=0, le=Decimal("100000000"), max_digits=12, decimal_places=2)
    maximum_pf_wage: Optional[Decimal] = Field(default=None, ge=0, le=Decimal("100000000"), max_digits=12, decimal_places=2)
    employee_contribution_percent: Optional[Decimal] = Field(default=None, ge=0, le=100, max_digits=7, decimal_places=4)
    employer_contribution_percent: Optional[Decimal] = Field(default=None, ge=0, le=100, max_digits=7, decimal_places=4)
    eps_percent: Optional[Decimal] = Field(default=None, ge=0, le=100, max_digits=7, decimal_places=4)
    eps_enabled: Optional[bool] = None
    eps_wage_ceiling: Optional[Decimal] = Field(default=None, ge=0, le=Decimal("100000000"), max_digits=12, decimal_places=2)
    calculation_basis: Optional[str] = None
    rounding: Optional[str] = None
    effective_from: Optional[str] = None
    effective_to: Optional[str] = None
    status: Optional[str] = None
    applicability_notes: Optional[str] = Field(default=None, max_length=1000)
    reason: str = Field(default="", max_length=500)


class PFRuleStatusUpdate(BaseModel):
    status: str
    reason: str = Field(default="", max_length=500)

    @field_validator("status")
    @classmethod
    def _status(cls, v):
        v = str(v).strip().upper()
        if v not in RULE_STATUSES:
            raise ValueError("Rule status must be Active or Inactive.")
        return v


def validate_rule_values(r: dict) -> None:
    """Checks that hold for any single rule (create, and an update merged onto the stored rule)."""
    mn, mx = Decimal(str(r.get("minimum_pf_wage") or 0)), Decimal(str(r.get("maximum_pf_wage") or 0))
    if mx <= 0:
        raise ValueError("Maximum PF wage must be more than ₹0.")
    if mn > mx:
        raise ValueError("Minimum PF wage can't be more than the maximum PF wage.")
    emp, er = Decimal(str(r.get("employee_contribution_percent") or 0)), Decimal(str(r.get("employer_contribution_percent") or 0))
    if not (0 < emp <= 100) or not (0 < er <= 100):
        raise ValueError("Employee and employer PF % must be more than 0 and at most 100.")
    eps = Decimal(str(r.get("eps_percent") or 0))
    if eps < 0 or eps > er:
        raise ValueError("EPS % can't be negative or more than the employer PF %.")
    ceiling = r.get("eps_wage_ceiling")
    if ceiling not in (None, "") and Decimal(str(ceiling)) < 0:
        raise ValueError("EPS wage ceiling can't be negative.")
    start, end = r.get("effective_from"), r.get("effective_to")
    if start and end and str(end) < str(start):
        raise ValueError("Effective to can't be before effective from.")


class EmployeePFUpdate(BaseModel):
    pf_applicable: bool = True
    eps_applicable: bool = True
    uan: str = Field(default="", max_length=20)
    pf_member_id: str = Field(default="", max_length=40)
    previous_pf_member_id: str = Field(default="", max_length=40)
    pf_joining_date: str = ""
    statutory_pf_wage: Optional[Decimal] = Field(default=None, ge=0, le=Decimal("100000000"), max_digits=12, decimal_places=2)
    exemption_reason: str = Field(default="", max_length=500)
    effective_from: str = ""
    effective_to: str = ""
    reason: str = Field(default="", max_length=500)

    @field_validator("uan")
    @classmethod
    def _uan(cls, v):
        v = re.sub(r"\s", "", v or "")
        if v and not UAN_RE.match(v):
            raise ValueError("UAN must be exactly 12 digits.")
        return v

    @field_validator("pf_member_id", "previous_pf_member_id")
    @classmethod
    def _member(cls, v):
        v = re.sub(r"\s", "", v or "").upper()
        if v and not MEMBER_ID_RE.match(v):
            raise ValueError("PF Member ID must be 10 to 30 letters or digits (e.g. MHBAN00000640000000125).")
        return v

    @field_validator("pf_joining_date")
    @classmethod
    def _joined(cls, v):
        return optional_iso_date(v, "PF joining date")

    @field_validator("effective_from")
    @classmethod
    def _from(cls, v):
        return optional_iso_date(v, "Effective from")

    @field_validator("effective_to")
    @classmethod
    def _to(cls, v):
        return optional_iso_date(v, "Effective to")

    @model_validator(mode="after")
    def _rules(self):
        self.exemption_reason = self.exemption_reason.strip()
        if not self.pf_applicable and len(self.exemption_reason) < 3:
            raise ValueError("Give the exemption reason: an employee can only be made PF-exempt with a reason.")
        if self.pf_applicable:
            self.exemption_reason = ""
        if self.effective_from and self.effective_to and self.effective_to < self.effective_from:
            raise ValueError("Effective to can't be before effective from.")
        if self.pf_member_id and self.previous_pf_member_id and self.pf_member_id == self.previous_pf_member_id:
            raise ValueError("The previous PF Member ID is the same as the current one.")
        return self


class PFCalculateRequest(BaseModel):
    basic_salary: Decimal = Amount
    da: Decimal = Field(default=Decimal("0"), ge=0, le=Decimal("100000000"), max_digits=12, decimal_places=2)
    statutory_pf_wage: Optional[Decimal] = Field(default=None, ge=0, le=Decimal("100000000"), max_digits=12, decimal_places=2)
    eps_applicable: bool = True
    employee_id: Optional[str] = None
    on_date: Optional[str] = None  # defaults to today
    rule_id: Optional[str] = None  # preview a specific rule (e.g. a future one)

    @field_validator("on_date")
    @classmethod
    def _on(cls, v):
        return optional_iso_date(v, "Date") or None
