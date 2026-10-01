"""
The one PF / EPF calculation. Payroll, payslips, previews, the PF dashboard, reports and the employee
form all get their PF figures from here (directly, or from what payroll stored), never from their own math.

Pure functions only (no database), so the statutory arithmetic is unit-tested on its own:

    PF wage      = MIN(MAX(PF base, minimum PF wage), maximum PF wage)
    Employee PF  = PF wage x employee rate
    Employer PF  = PF wage x employer rate
    EPS          = EPS wage x EPS rate   (EPS wage = PF wage, or the rule's EPS ceiling if lower)
    Employer EPF = Employer PF - EPS

Every amount is computed with Decimal and rounded half-up, per the rule's rounding (paise by default),
so the same inputs give the same figures everywhere they are shown.
"""
from datetime import date, datetime
from decimal import Decimal, ROUND_HALF_UP, InvalidOperation
from typing import Any, Dict, Iterable, List, Optional
import calendar

BASIS_BASIC = "BASIC"
BASIS_BASIC_DA = "BASIC_DA"
BASIS_STATUTORY = "STATUTORY"
BASES = {
    BASIS_BASIC: "Basic salary",
    BASIS_BASIC_DA: "Basic + DA",
    BASIS_STATUTORY: "Statutory PF wage",
}
ROUNDING = {"PAISE": Decimal("0.01"), "RUPEE": Decimal("1")}

# Outcome of the eligibility check, in the order the engine decides them.
CALCULATED = "CALCULATED"        # PF applies and was calculated
DISABLED = "DISABLED"            # PF is switched off in PF configuration
EXEMPT = "EXEMPT"                # employee explicitly exempted, with a reason
NOT_APPLICABLE = "NOT_APPLICABLE"  # outside the employee's PF membership dates
ERROR = "ERROR"                  # something needed is missing: payroll can't be finalized


def D(value: Any) -> Decimal:
    if value is None or value == "":
        return Decimal("0")
    try:
        return Decimal(str(value))
    except (InvalidOperation, ValueError):
        return Decimal("0")


def _round(value: Decimal, rounding: str) -> Decimal:
    return value.quantize(ROUNDING.get(rounding or "PAISE", ROUNDING["PAISE"]), rounding=ROUND_HALF_UP)


def money(value: Decimal) -> float:
    """Stored and returned as a JSON number already rounded to paise (Postgres keeps JSONB numbers as numeric)."""
    return float(value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))


def to_date(value: Any) -> Optional[date]:
    if not value:
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    try:
        return datetime.strptime(str(value)[:10], "%Y-%m-%d").date()
    except ValueError:
        return None


def period_end(year: int, month_no: int) -> date:
    """The date a payroll month is judged on: its last day (a rule in force on that day applies to the month)."""
    return date(int(year), int(month_no), calendar.monthrange(int(year), int(month_no))[1])


def rule_covers(rule: Dict[str, Any], on: date) -> bool:
    start, end = to_date(rule.get("effective_from")), to_date(rule.get("effective_to"))
    return bool(start) and start <= on and (end is None or on <= end)


def rule_for(rules: Iterable[Dict[str, Any]], on: date) -> Optional[Dict[str, Any]]:
    """The active rule in force on `on` (latest start wins should two ever overlap)."""
    candidates = [r for r in rules if str(r.get("status", "")).upper() == "ACTIVE" and rule_covers(r, on)]
    candidates.sort(key=lambda r: str(r.get("effective_from")), reverse=True)
    return candidates[0] if candidates else None


def ranges_overlap(a_from: date, a_to: Optional[date], b_from: date, b_to: Optional[date]) -> bool:
    return a_from <= (b_to or date.max) and b_from <= (a_to or date.max)


def calculate_pf(
    basic: Any,
    rule: Dict[str, Any],
    *,
    da: Any = 0,
    statutory_wage: Any = None,
    eps_applicable: bool = True,
) -> Dict[str, Any]:
    """PF on one month's salary under one rule. Raises ValueError when the rule's basis needs a figure that's missing."""
    rounding = str(rule.get("rounding") or "PAISE").upper()
    basis = str(rule.get("calculation_basis") or BASIS_BASIC).upper()
    basic_d, da_d = D(basic), D(da)
    if basic_d < 0 or da_d < 0:
        raise ValueError("Salary amounts can't be negative.")

    if basis == BASIS_BASIC_DA:
        pf_base = basic_d + da_d
    elif basis == BASIS_STATUTORY:
        if statutory_wage in (None, "") or D(statutory_wage) <= 0:
            raise ValueError("This PF rule uses the statutory PF wage, but none is set for the employee.")
        pf_base = D(statutory_wage)
    else:
        pf_base = basic_d

    minimum, maximum = D(rule.get("minimum_pf_wage")), D(rule.get("maximum_pf_wage"))
    pf_wage = _round(min(max(pf_base, minimum), maximum), rounding)

    emp_rate = D(rule.get("employee_contribution_percent"))
    er_rate = D(rule.get("employer_contribution_percent"))
    eps_rate = D(rule.get("eps_percent")) if rule.get("eps_enabled", True) else Decimal("0")

    employee_pf = _round(pf_wage * emp_rate / 100, rounding)
    employer_pf = _round(pf_wage * er_rate / 100, rounding)

    eps_wage = Decimal("0")
    eps = Decimal("0")
    if eps_applicable and eps_rate > 0:
        ceiling = D(rule.get("eps_wage_ceiling"))
        eps_wage = min(pf_wage, ceiling) if ceiling > 0 else pf_wage
        eps = min(_round(eps_wage * eps_rate / 100, rounding), employer_pf)
    employer_epf = employer_pf - eps

    return {
        "rule_id": str(rule.get("id") or rule.get("_id") or ""),
        "rule_name": rule.get("rule_name", ""),
        "calculation_basis": basis,
        "rounding": rounding,
        "basic_salary": money(basic_d),
        "da": money(da_d),
        "pf_base": money(pf_base),
        "minimum_pf_wage": money(minimum),
        "maximum_pf_wage": money(maximum),
        "pf_wage": money(pf_wage),
        "wage_limited_by": "minimum" if pf_base < minimum else "maximum" if pf_base > maximum else None,
        "employee_pf_percent": float(emp_rate),
        "employer_pf_percent": float(er_rate),
        "eps_percent": float(eps_rate) if eps_applicable else 0.0,
        "eps_applicable": bool(eps_applicable and eps_rate > 0),
        "eps_wage": money(eps_wage),
        "employee_pf": money(employee_pf),
        "employer_pf": money(employer_pf),
        "eps": money(eps),
        "employer_epf": money(employer_epf),
        "total_contribution": money(employee_pf + employer_pf),
    }


ZERO = {"pf_wage": 0.0, "employee_pf": 0.0, "employer_pf": 0.0, "eps": 0.0, "employer_epf": 0.0, "total_contribution": 0.0}


def default_details(employee: Dict[str, Any]) -> Dict[str, Any]:
    """PF details for an employee nobody has filled in yet: the employee record's provident-fund switch decides."""
    return {
        "employee_id": str(employee.get("_id") or employee.get("id") or ""),
        "pf_applicable": bool(employee.get("pf_opted", True)),
        "eps_applicable": True,
        "uan": "", "pf_member_id": "", "previous_pf_member_id": "",
        "pf_joining_date": "", "statutory_pf_wage": None, "exemption_reason": "",
        "effective_from": "", "effective_to": "",
        "is_default": True,
    }


def evaluate(
    employee: Dict[str, Any],
    details: Optional[Dict[str, Any]],
    rules: List[Dict[str, Any]],
    settings: Dict[str, Any],
    on: date,
    *,
    basic: Any = None,
    da: Any = None,
) -> Dict[str, Any]:
    """The eligibility engine: PF enabled? -> exempt? -> applicable? -> which rule? -> PF wage -> contributions.

    Never skips silently: every outcome carries a status and a reason, and `issues` lists what must be fixed
    (an issue with blocking=True stops payroll from being finalized).
    """
    d = details or default_details(employee)
    basic = employee.get("base_salary") if basic is None else basic
    da = employee.get("da", 0) if da is None else da
    steps: List[str] = []
    issues: List[Dict[str, Any]] = []
    base = {
        "employee_id": str(employee.get("_id") or employee.get("id") or ""),
        "calculation_date": on.isoformat(),
        "basic_salary": money(D(basic)),
        "da": money(D(da)),
        "uan": d.get("uan") or "",
        "pf_member_id": d.get("pf_member_id") or "",
        "pf_applicable": bool(d.get("pf_applicable")),
        "eps_applicable": bool(d.get("eps_applicable", True)),
        "details_recorded": not d.get("is_default"),
        **ZERO,
    }

    def outcome(status: str, reason: str, **extra) -> Dict[str, Any]:
        return {**base, **extra, "status": status, "reason": reason, "steps": steps, "issues": issues,
                "blocking": any(i["blocking"] for i in issues)}

    if not settings.get("enabled", True):
        steps.append("PF is disabled in PF configuration")
        return outcome(DISABLED, "PF is disabled in PF configuration.")
    steps.append("PF is enabled")

    if not d.get("pf_applicable"):
        reason = str(d.get("exemption_reason") or "").strip()
        if reason:
            steps.append("Employee is PF-exempt")
            return outcome(EXEMPT, f"PF-exempt: {reason}")
        issues.append({"code": "EXEMPT_WITHOUT_REASON", "blocking": True,
                       "message": "PF is turned off for this employee but no exemption reason is recorded."})
        return outcome(ERROR, "PF is turned off without an exemption reason. Record the reason under PF details.")
    steps.append("Employee is not exempt")

    start, end = to_date(d.get("effective_from")), to_date(d.get("effective_to"))
    if start and on < start:
        steps.append("PF membership has not started")
        return outcome(NOT_APPLICABLE, f"PF applies from {start.isoformat()}.")
    if end and on > end:
        steps.append("PF membership has ended")
        return outcome(NOT_APPLICABLE, f"PF applied until {end.isoformat()}.")
    steps.append("Employee is PF applicable")

    rule = rule_for(rules, on)
    if not rule:
        issues.append({"code": "MISSING_RULE", "blocking": True, "message": f"No active PF rule covers {on.isoformat()}."})
        return outcome(ERROR, f"No active PF rule covers {on.isoformat()}.")
    steps.append(f"Rule applied: {rule.get('rule_name')}")

    if D(basic) <= 0:
        issues.append({"code": "MISSING_BASIC", "blocking": True, "message": "Basic salary is missing."})
        return outcome(ERROR, "Basic salary is missing, so PF can't be calculated.")

    try:
        result = calculate_pf(basic, rule, da=da, statutory_wage=d.get("statutory_pf_wage"),
                              eps_applicable=bool(d.get("eps_applicable", True)))
    except ValueError as e:
        issues.append({"code": "CALCULATION_FAILED", "blocking": True, "message": str(e)})
        return outcome(ERROR, str(e))
    steps += ["PF wage determined", "Employee PF calculated", "Employer PF calculated", "EPS calculated", "Employer EPF calculated"]

    if not base["uan"]:
        issues.append({"code": "MISSING_UAN", "blocking": bool(settings.get("require_uan_to_finalize")),
                       "message": "UAN is missing."})
    if not base["pf_member_id"]:
        issues.append({"code": "MISSING_MEMBER_ID", "blocking": bool(settings.get("require_member_id_to_finalize")),
                       "message": "PF Member ID is missing."})
    return outcome(CALCULATED, "PF calculated.", **result)
