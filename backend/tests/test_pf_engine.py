"""PF engine: the statutory arithmetic and the eligibility decisions, without a database."""
from datetime import date

import pytest

from app.services import pf_engine
from app.services.pf_engine import calculate_pf, evaluate, rule_for

CURRENT = {
    "id": "current", "rule_name": "PF Rule 2026 - Current", "status": "ACTIVE",
    "minimum_pf_wage": 14000, "maximum_pf_wage": 25000,
    "employee_contribution_percent": 12, "employer_contribution_percent": 12, "eps_percent": 8.33,
    "calculation_basis": "BASIC", "rounding": "PAISE", "effective_from": "2026-09-17", "effective_to": "",
}
PREVIOUS = {**CURRENT, "id": "previous", "rule_name": "PF Rule 2026 - Previous", "minimum_pf_wage": 0,
            "maximum_pf_wage": 15000, "effective_from": "2000-01-01", "effective_to": "2026-09-16"}
SETTINGS = {"enabled": True, "require_uan_to_finalize": False, "require_member_id_to_finalize": False}


# --- 28. PF wage tests (1-12) -------------------------------------------------------------------
@pytest.mark.parametrize("basic, wage", [
    (5000, 14000), (10000, 14000), (13999, 14000), (14000, 14000), (18000, 18000), (20000, 20000),
    (24999, 24999), (25000, 25000), (25001, 25000), (30000, 25000), (40000, 25000), (100000, 25000),
])
def test_pf_wage_is_basic_clamped_between_minimum_and_maximum(basic, wage):
    assert calculate_pf(basic, CURRENT)["pf_wage"] == wage


# --- 28. Contribution tests ---------------------------------------------------------------------
@pytest.mark.parametrize("wage, pf", [(14000, 1680), (18000, 2160), (20000, 2400), (25000, 3000)])
def test_twelve_percent_contributions(wage, pf):
    r = calculate_pf(wage, CURRENT)
    assert r["employee_pf"] == pf and r["employer_pf"] == pf


# --- 3. Calculation examples (Employees A-J) ----------------------------------------------------
@pytest.mark.parametrize("basic, wage, employee_pf, employer_pf", [
    (10000, 14000, 1680, 1680), (12000, 14000, 1680, 1680), (14000, 14000, 1680, 1680),
    (18000, 18000, 2160, 2160), (20000, 20000, 2400, 2400), (25000, 25000, 3000, 3000),
    (30000, 25000, 3000, 3000), (40000, 25000, 3000, 3000), (50000, 25000, 3000, 3000), (100000, 25000, 3000, 3000),
])
def test_spec_examples_a_to_j(basic, wage, employee_pf, employer_pf):
    r = calculate_pf(basic, CURRENT)
    assert (r["pf_wage"], r["employee_pf"], r["employer_pf"]) == (wage, employee_pf, employer_pf)


# --- 4 / 8. EPS and employer EPF ----------------------------------------------------------------
def test_eps_and_employer_epf_at_20000():
    r = calculate_pf(20000, CURRENT)
    assert (r["employee_pf"], r["employer_pf"], r["eps"], r["employer_epf"]) == (2400, 2400, 1666, 734)


def test_preview_example_basic_40000():
    r = calculate_pf(40000, CURRENT)
    assert r["basic_salary"] == 40000 and r["pf_wage"] == 25000 and r["wage_limited_by"] == "maximum"
    assert (r["employee_pf"], r["employer_pf"], r["eps"], r["employer_epf"]) == (3000, 3000, 2082.50, 917.50)
    assert r["eps"] + r["employer_epf"] == r["employer_pf"]


def test_minimum_flagged_when_basic_below_floor():
    assert calculate_pf(10000, CURRENT)["wage_limited_by"] == "minimum"
    assert calculate_pf(18000, CURRENT)["wage_limited_by"] is None


def test_eps_not_applicable_puts_all_employer_pf_into_epf():
    r = calculate_pf(20000, CURRENT, eps_applicable=False)
    assert r["eps"] == 0 and r["employer_epf"] == r["employer_pf"] == 2400


def test_eps_ceiling_and_disabled_eps_are_configurable():
    capped = calculate_pf(25000, {**CURRENT, "eps_wage_ceiling": 15000})
    assert capped["eps_wage"] == 15000 and capped["eps"] == 1249.5 and capped["employer_epf"] == 1750.5
    off = calculate_pf(25000, {**CURRENT, "eps_enabled": False})
    assert off["eps"] == 0 and off["employer_epf"] == 3000


def test_rates_and_limits_come_from_the_rule_not_constants():
    future = {**CURRENT, "minimum_pf_wage": 16000, "maximum_pf_wage": 30000, "employee_contribution_percent": 10,
              "employer_contribution_percent": 13, "eps_percent": 8}
    r = calculate_pf(40000, future)
    assert (r["pf_wage"], r["employee_pf"], r["employer_pf"], r["eps"], r["employer_epf"]) == (30000, 3000, 3900, 2400, 1500)
    assert calculate_pf(1000, future)["pf_wage"] == 16000


def test_rounding_policy_paise_and_rupee():
    paise = calculate_pf(24999, CURRENT)
    assert paise["employee_pf"] == 2999.88 and paise["eps"] == 2082.42 and paise["employer_epf"] == 917.46
    rupee = calculate_pf(24999, {**CURRENT, "rounding": "RUPEE"})
    assert rupee["employee_pf"] == 3000 and rupee["eps"] == 2082 and rupee["employer_epf"] == 918


def test_basis_basic_plus_da_and_statutory_wage():
    assert calculate_pf(12000, {**CURRENT, "calculation_basis": "BASIC_DA"}, da=4000)["pf_wage"] == 16000
    assert calculate_pf(12000, {**CURRENT, "calculation_basis": "STATUTORY"}, statutory_wage=21000)["pf_wage"] == 21000
    with pytest.raises(ValueError):
        calculate_pf(12000, {**CURRENT, "calculation_basis": "STATUTORY"})
    with pytest.raises(ValueError):
        calculate_pf(-1, CURRENT)


# --- 10 / 33. Effective-dated rule selection ----------------------------------------------------
def test_rule_selection_by_date():
    future = {**CURRENT, "id": "future", "rule_name": "Rule B", "effective_from": "2027-04-01", "maximum_pf_wage": 30000}
    current = {**CURRENT, "effective_to": "2027-03-31"}
    rules = [PREVIOUS, current, future]
    assert rule_for(rules, date(2026, 9, 16))["id"] == "previous"
    assert rule_for(rules, date(2026, 9, 17))["id"] == "current"
    assert rule_for(rules, date(2027, 3, 31))["id"] == "current"
    assert rule_for(rules, date(2027, 4, 30))["id"] == "future"
    assert rule_for([{**CURRENT, "status": "INACTIVE"}], date(2026, 10, 1)) is None
    assert rule_for(rules, date(1999, 1, 1)) is None


def test_payroll_month_uses_rule_in_force_on_its_last_day():
    assert pf_engine.period_end(2026, 9) == date(2026, 9, 30)
    assert pf_engine.period_end(2028, 2) == date(2028, 2, 29)
    assert rule_for([PREVIOUS, CURRENT], pf_engine.period_end(2026, 9))["id"] == "current"
    assert rule_for([PREVIOUS, CURRENT], pf_engine.period_end(2026, 8))["id"] == "previous"


def test_overlap_detection():
    assert pf_engine.ranges_overlap(date(2026, 1, 1), None, date(2026, 6, 1), date(2026, 7, 1))
    assert not pf_engine.ranges_overlap(date(2026, 1, 1), date(2026, 5, 31), date(2026, 6, 1), None)


# --- 11. Eligibility engine ---------------------------------------------------------------------
EMP = {"_id": "e1", "full_name": "Asha", "base_salary": 40000, "pf_opted": True}
ON = date(2026, 10, 31)


def details(**kw):
    return {"pf_applicable": True, "eps_applicable": True, "uan": "100200300400", "pf_member_id": "MHBAN00000640000000125", **kw}


def test_calculated_when_applicable():
    r = evaluate(EMP, details(), [CURRENT], SETTINGS, ON)
    assert r["status"] == "CALCULATED" and r["employee_pf"] == 3000 and not r["blocking"]
    assert r["steps"][0] == "PF is enabled" and r["steps"][-1] == "Employer EPF calculated"


def test_disabled_configuration_skips_with_reason():
    r = evaluate(EMP, details(), [CURRENT], {**SETTINGS, "enabled": False}, ON)
    assert r["status"] == "DISABLED" and r["employee_pf"] == 0 and r["reason"]


def test_exempt_needs_a_reason():
    ok = evaluate(EMP, details(pf_applicable=False, exemption_reason="International worker"), [CURRENT], SETTINGS, ON)
    assert ok["status"] == "EXEMPT" and "International worker" in ok["reason"] and not ok["blocking"]
    bad = evaluate(EMP, details(pf_applicable=False, exemption_reason=""), [CURRENT], SETTINGS, ON)
    assert bad["status"] == "ERROR" and bad["blocking"] and bad["employee_pf"] == 0


def test_legacy_employee_without_details_follows_pf_switch():
    assert evaluate(EMP, None, [CURRENT], SETTINGS, ON)["status"] == "CALCULATED"
    off = evaluate({**EMP, "pf_opted": False}, None, [CURRENT], SETTINGS, ON)
    assert off["status"] == "ERROR" and off["issues"][0]["code"] == "EXEMPT_WITHOUT_REASON"


def test_membership_dates():
    assert evaluate(EMP, details(effective_from="2026-11-01"), [CURRENT], SETTINGS, ON)["status"] == "NOT_APPLICABLE"
    assert evaluate(EMP, details(effective_to="2026-09-30"), [CURRENT], SETTINGS, ON)["status"] == "NOT_APPLICABLE"


def test_missing_rule_and_missing_basic_are_errors():
    assert evaluate(EMP, details(), [], SETTINGS, ON)["issues"][0]["code"] == "MISSING_RULE"
    assert evaluate({**EMP, "base_salary": 0}, details(), [CURRENT], SETTINGS, ON)["issues"][0]["code"] == "MISSING_BASIC"


def test_missing_uan_and_member_id_block_only_when_configured():
    r = evaluate(EMP, details(uan="", pf_member_id=""), [CURRENT], SETTINGS, ON)
    assert r["status"] == "CALCULATED" and not r["blocking"] and {i["code"] for i in r["issues"]} == {"MISSING_UAN", "MISSING_MEMBER_ID"}
    strict = evaluate(EMP, details(uan=""), [CURRENT], {**SETTINGS, "require_uan_to_finalize": True}, ON)
    assert strict["blocking"]
