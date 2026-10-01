"""
PF / EPF data: configuration, effective-dated rules, each employee's PF details, the PF transaction stored
with every payroll, the PF audit trail and PF notifications. All arithmetic is delegated to pf_engine.

Collections (Postgres JSONB tables, see database.KNOWN_COLLECTIONS; unique indexes in database.EXTRA_INDEXES):
  pf_settings              one document: PF on/off and what payroll finalization requires
  pf_rules                 effective-dated rules; never overwritten once finalized payroll has used them
  employee_pf_details      one per employee (unique employee_id, unique UAN)
  payroll_pf_transactions  one per payroll record (unique payroll_id): the PF figures payroll used
  pf_audit_logs            append-only, one row per changed field
  pf_events                notifications shown in the bell (inbox.pf_items)
"""
import logging
from datetime import date, datetime, timedelta
from typing import Any, Dict, List, Optional, Tuple

from fastapi import HTTPException, status

from app.database import fix_id, fix_ids, get_collection
from app.services import pf_engine
from app.services.audit_service import AuditService
from app.schemas.pf import validate_rule_values

logger = logging.getLogger("rexera.pf")

SETTINGS_ID = "pf_settings"
DEFAULT_SETTINGS = {"enabled": True, "require_uan_to_finalize": False, "require_member_id_to_finalize": False}
RULE_MONEY_FIELDS = ("minimum_pf_wage", "maximum_pf_wage", "employee_contribution_percent",
                     "employer_contribution_percent", "eps_percent", "eps_enabled", "eps_wage_ceiling",
                     "calculation_basis", "rounding", "effective_from")
DETAIL_FIELDS = ("pf_applicable", "eps_applicable", "uan", "pf_member_id", "previous_pf_member_id", "pf_joining_date",
                 "statutory_pf_wage", "exemption_reason", "effective_from", "effective_to")
FIELD_LABELS = {
    "pf_applicable": "PF Applicable", "eps_applicable": "EPS Applicable", "uan": "UAN", "pf_member_id": "PF Member ID",
    "previous_pf_member_id": "Previous PF Member ID", "pf_joining_date": "PF Joining Date",
    "statutory_pf_wage": "Statutory PF Wage", "exemption_reason": "PF Exemption Reason",
    "effective_from": "Effective From", "effective_to": "Effective To", "pf_wage": "PF Wage",
    "employee_pf": "Employee PF", "employer_pf": "Employer PF", "eps": "EPS", "employer_epf": "Employer EPF",
    "basic_salary": "Basic Salary", "da": "DA",
}


def _now() -> str:
    return datetime.utcnow().isoformat()


def _plain(v: Any) -> Any:
    """Decimal -> float for storage (already validated to 2 / 4 places)."""
    try:
        from decimal import Decimal
        if isinstance(v, Decimal):
            return float(v)
    except Exception:
        pass
    return v


def _actor(admin: Dict[str, Any]) -> Tuple[str, str]:
    return str(admin.get("email") or ""), str(admin.get("role") or "")


# ---------------------------------------------------------------------------
# Audit trail and notifications
# ---------------------------------------------------------------------------
async def audit(admin: Dict[str, Any], *, entity: str, entity_id: str, field: str, old: Any, new: Any,
                reason: str = "", ip: str = "", employee: Optional[Dict[str, Any]] = None) -> None:
    email, role = _actor(admin)
    await get_collection("pf_audit_logs").insert_one({
        "entity": entity, "entity_id": entity_id,
        "employee_id": str(employee.get("_id") or employee.get("id")) if employee else "",
        "employee_code": (employee or {}).get("employee_code", ""),
        "employee_name": (employee or {}).get("full_name", ""),
        "field_name": FIELD_LABELS.get(field, field), "field_key": field,
        "old_value": _plain(old), "new_value": _plain(new),
        "changed_by": email, "changed_by_name": admin.get("username") or email, "changed_by_role": role,
        "reason": reason or "", "ip_address": ip or "", "created_at": _now(),
    })


async def notify(kind: str, title: str, description: str, *, audience: str = "hr", employee: Optional[Dict[str, Any]] = None,
                 link: str = "/hr/pf", key: Optional[str] = None) -> None:
    """A bell item. `key` makes it idempotent (the same failure on every recalculation is one notification)."""
    doc = {"audience": audience, "kind": kind, "title": title, "description": description, "link": link,
           "employee_id": str(employee.get("_id") or employee.get("id")) if employee else "",
           "employee_email": str((employee or {}).get("email") or "").strip().lower(), "created_at": _now()}
    col = get_collection("pf_events")
    if key:
        await col.update_one({"_id": key}, {"$set": doc}, upsert=True)
    else:
        await col.insert_one(doc)


# ---------------------------------------------------------------------------
# Settings and rules
# ---------------------------------------------------------------------------
async def get_settings() -> Dict[str, Any]:
    doc = await get_collection("pf_settings").find_one({"_id": SETTINGS_ID}) or {}
    return {**DEFAULT_SETTINGS, **{k: v for k, v in doc.items() if k in DEFAULT_SETTINGS or k in ("updated_by", "updated_at")}}


async def update_settings(changes: Dict[str, Any], admin: Dict[str, Any], reason: str = "", ip: str = "") -> Dict[str, Any]:
    current = await get_settings()
    changes = {k: bool(v) for k, v in changes.items() if k in DEFAULT_SETTINGS and v is not None and bool(v) != current.get(k)}
    if not changes:
        return current
    email, _ = _actor(admin)
    await get_collection("pf_settings").update_one(
        {"_id": SETTINGS_ID}, {"$set": {**changes, "updated_by": email, "updated_at": _now()}}, upsert=True)
    for k, v in changes.items():
        await audit(admin, entity="pf_settings", entity_id=SETTINGS_ID, field=k, old=current.get(k), new=v, reason=reason, ip=ip)
    if "enabled" in changes:
        await notify("rule", f"PF was {'enabled' if changes['enabled'] else 'disabled'}",
                     f"By {email}{' · ' + reason if reason else ''}", key=f"pf-enabled-{_now()[:16]}")
    await AuditService.log_action(user_email=email, user_role=admin.get("role", ""), action="Updated PF settings",
                                  entity_type="pf_settings", entity_id=SETTINGS_ID, old_value=current, new_value=changes)
    return await get_settings()


async def list_rules() -> List[Dict[str, Any]]:
    rules = fix_ids(await get_collection("pf_rules").find({}).to_list(1000))
    rules.sort(key=lambda r: str(r.get("effective_from") or ""), reverse=True)
    return rules


async def _finalized_use(rule_id: str) -> Optional[str]:
    """The latest payroll date a finalized payroll calculated with this rule (None if none ever did)."""
    txs = await get_collection("payroll_pf_transactions").find({"pf_rule_id": rule_id, "finalized": True}).to_list(100000)
    return max((str(t.get("calculation_date") or "") for t in txs), default=None)


def _overlaps(candidate: Dict[str, Any], rules: List[Dict[str, Any]], exclude_id: Optional[str] = None) -> Optional[Dict[str, Any]]:
    if str(candidate.get("status", "ACTIVE")).upper() != "ACTIVE":
        return None
    c_from, c_to = pf_engine.to_date(candidate.get("effective_from")), pf_engine.to_date(candidate.get("effective_to"))
    for r in rules:
        if str(r.get("id")) == str(exclude_id or "") or str(r.get("status", "")).upper() != "ACTIVE":
            continue
        r_from, r_to = pf_engine.to_date(r.get("effective_from")), pf_engine.to_date(r.get("effective_to"))
        if c_from and r_from and pf_engine.ranges_overlap(c_from, c_to, r_from, r_to):
            return r
    return None


def _rule_label(r: Dict[str, Any]) -> str:
    return f"\"{r.get('rule_name')}\" ({r.get('effective_from')} to {r.get('effective_to') or 'open-ended'})"


async def create_rule(body: Dict[str, Any], admin: Dict[str, Any], ip: str = "") -> Dict[str, Any]:
    reason = body.pop("reason", "") or ""
    close_previous = body.pop("close_previous", True)
    rule = {k: _plain(v) for k, v in body.items()}
    rule["effective_to"] = rule.get("effective_to") or ""
    rules = await list_rules()
    new_from = pf_engine.to_date(rule["effective_from"])

    # Close the open-ended rule this one follows, the day before it starts (if that keeps finalized history intact).
    to_close = None
    if close_previous and rule.get("status") == "ACTIVE":
        open_ended = [r for r in rules if str(r.get("status")).upper() == "ACTIVE" and not r.get("effective_to")
                      and pf_engine.to_date(r.get("effective_from")) and pf_engine.to_date(r.get("effective_from")) < new_from]
        if open_ended:
            to_close = max(open_ended, key=lambda r: str(r.get("effective_from")))
            closing_on = (new_from - timedelta(days=1)).isoformat()
            used = await _finalized_use(to_close["id"])
            if used and used > closing_on:
                raise HTTPException(status_code=status.HTTP_409_CONFLICT,
                                    detail=f"{_rule_label(to_close)} was used for finalized payroll up to {used}. "
                                           f"The new rule must start after {used}.")
            to_close = {**to_close, "effective_to": closing_on}

    others = [to_close if to_close and r["id"] == to_close["id"] else r for r in rules]
    clash = _overlaps(rule, others)
    if clash:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT,
                            detail=f"These dates overlap the active rule {_rule_label(clash)}. End that rule first, or pick other dates.")

    email, _ = _actor(admin)
    now = _now()
    if to_close:
        await get_collection("pf_rules").update_one({"_id": to_close["id"]}, {"$set": {
            "effective_to": to_close["effective_to"], "updated_by": email, "updated_at": now}})
        await audit(admin, entity="pf_rule", entity_id=to_close["id"], field="effective_to", old="",
                    new=to_close["effective_to"], reason=f"Superseded by \"{rule['rule_name']}\"", ip=ip)

    doc = {**rule, "created_by": email, "created_at": now, "updated_by": email, "updated_at": now}
    res = await get_collection("pf_rules").insert_one(doc)
    rule_id = str(res.inserted_id)
    for k in ("rule_name", *RULE_MONEY_FIELDS, "effective_to", "status"):
        if doc.get(k) not in (None, ""):
            await audit(admin, entity="pf_rule", entity_id=rule_id, field=k, old=None, new=doc.get(k), reason=reason or "New PF rule", ip=ip)
    await AuditService.log_action(user_email=email, user_role=admin.get("role", ""), action="Created PF rule",
                                  entity_type="pf_rule", entity_id=rule_id, new_value={k: doc.get(k) for k in RULE_MONEY_FIELDS})
    await notify("rule", f"New PF rule: {doc['rule_name']}",
                 f"Effective from {doc['effective_from']} · PF wage ₹{doc['minimum_pf_wage']:,.0f} to ₹{doc['maximum_pf_wage']:,.0f} · "
                 f"{doc['employee_contribution_percent']}% / {doc['employer_contribution_percent']}% · EPS {doc['eps_percent']}%",
                 key=f"pf-rule-created-{rule_id}")
    saved = fix_id(await get_collection("pf_rules").find_one({"_id": rule_id}))
    await _notify_rule_impact(saved)
    return saved


async def update_rule(rule_id: str, changes: Dict[str, Any], admin: Dict[str, Any], ip: str = "") -> Dict[str, Any]:
    reason = changes.pop("reason", "") or ""
    current = fix_id(await get_collection("pf_rules").find_one({"_id": rule_id}))
    if not current:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="PF rule not found.")
    changes = {k: _plain(v) for k, v in changes.items() if v is not None}
    if "effective_to" in changes:
        changes["effective_to"] = changes["effective_to"] or ""
    changes = {k: v for k, v in changes.items() if current.get(k) != v}
    if not changes:
        return current

    used = await _finalized_use(rule_id)
    if used:
        locked = [k for k in changes if k in RULE_MONEY_FIELDS]
        if locked:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT,
                                detail=f"This rule was used for finalized payroll (up to {used}), so its wages, rates, basis and start date "
                                       f"can't change. Create a new effective-dated rule instead.")
        new_to = changes.get("effective_to", current.get("effective_to"))
        if new_to and new_to < used:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT,
                                detail=f"This rule was used for finalized payroll up to {used}; it can't end before that.")

    merged = {**current, **changes}
    try:
        validate_rule_values(merged)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(e))
    clash = _overlaps(merged, await list_rules(), exclude_id=rule_id)
    if clash:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT,
                            detail=f"These dates overlap the active rule {_rule_label(clash)}.")

    email, _ = _actor(admin)
    await get_collection("pf_rules").update_one({"_id": rule_id}, {"$set": {**changes, "updated_by": email, "updated_at": _now()}})
    for k, v in changes.items():
        await audit(admin, entity="pf_rule", entity_id=rule_id, field=k, old=current.get(k), new=v, reason=reason, ip=ip)
    await AuditService.log_action(user_email=email, user_role=admin.get("role", ""), action="Updated PF rule",
                                  entity_type="pf_rule", entity_id=rule_id,
                                  old_value={k: current.get(k) for k in changes}, new_value=changes)
    saved = fix_id(await get_collection("pf_rules").find_one({"_id": rule_id}))
    await notify("rule", f"PF rule changed: {saved['rule_name']}",
                 ", ".join(f"{FIELD_LABELS.get(k, k.replace('_', ' '))}: {current.get(k) or '—'} → {v or '—'}" for k, v in changes.items())[:300],
                 key=f"pf-rule-updated-{rule_id}-{_now()[:16]}")
    if any(k in RULE_MONEY_FIELDS for k in changes):
        await _notify_rule_impact(saved)
    return saved


# ---------------------------------------------------------------------------
# Employee PF details
# ---------------------------------------------------------------------------
async def _employee(emp_id: str) -> Dict[str, Any]:
    emp = await get_collection("employees").find_one({"_id": emp_id})
    if not emp:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Employee not found.")
    return emp


async def get_details(emp: Dict[str, Any]) -> Dict[str, Any]:
    emp_id = str(emp.get("_id") or emp.get("id"))
    doc = await get_collection("employee_pf_details").find_one({"employee_id": emp_id})
    return fix_id(doc) if doc else pf_engine.default_details(emp)


async def details_map() -> Dict[str, Dict[str, Any]]:
    return {str(d.get("employee_id")): d for d in await get_collection("employee_pf_details").find({}).to_list(100000)}


async def save_details(emp_id: str, body: Dict[str, Any], admin: Dict[str, Any], ip: str = "") -> Dict[str, Any]:
    emp = await _employee(emp_id)
    reason = (body.pop("reason", "") or "").strip()
    body = {k: _plain(v) for k, v in body.items() if k in DETAIL_FIELDS}
    settings = await get_settings()

    if body.get("pf_applicable") and settings.get("require_member_id_to_finalize") and not body.get("pf_member_id"):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                            detail="PF Member ID is required for PF-applicable employees (PF configuration).")
    if body.get("uan"):
        dup = await get_collection("employee_pf_details").find_one({"uan": body["uan"], "employee_id": {"$ne": emp_id}})
        if dup:
            other = await get_collection("employees").find_one({"_id": dup.get("employee_id")}) or {}
            raise HTTPException(status_code=status.HTTP_409_CONFLICT,
                                detail=f"UAN {body['uan']} already belongs to {other.get('full_name') or 'another employee'} "
                                       f"({other.get('employee_code') or dup.get('employee_id')}).")

    before = await get_details(emp)
    changed = {k: v for k, v in body.items() if before.get(k) != v and not (before.get(k) in (None, "") and v in (None, ""))}
    is_new = bool(before.get("is_default"))
    if not changed and not is_new:
        return await employee_pf_view(emp)

    rules, now = await list_rules(), _now()
    today = date.today()
    pf_before = pf_engine.evaluate(emp, None if is_new else before, rules, settings, today)

    email, _ = _actor(admin)
    doc = {**{k: before.get(k) for k in DETAIL_FIELDS}, **body, "employee_id": emp_id,
           "employee_code": emp.get("employee_code", ""), "updated_by": email, "updated_at": now}
    col = get_collection("employee_pf_details")
    if is_new:
        doc.update(created_by=email, created_at=now)
        await col.insert_one(doc)
    else:
        await col.update_one({"employee_id": emp_id}, {"$set": doc})
    # The employee record's provident-fund switch mirrors PF applicability (older screens read it).
    if bool(emp.get("pf_opted", True)) != bool(doc["pf_applicable"]):
        await get_collection("employees").update_one({"_id": emp_id}, {"$set": {"pf_opted": bool(doc["pf_applicable"]), "updated_at": now}})

    for k in (DETAIL_FIELDS if is_new else changed):
        if is_new and doc.get(k) in (None, "") and before.get(k) in (None, ""):
            continue
        await audit(admin, entity="employee_pf_details", entity_id=emp_id, field=k, old=None if is_new else before.get(k),
                    new=doc.get(k), reason=reason or ("PF details recorded" if is_new else ""), ip=ip, employee=emp)

    pf_after = pf_engine.evaluate(emp, doc, rules, settings, today)
    await _record_pf_change(emp, pf_before, pf_after, admin, reason or "PF details updated", ip)
    await AuditService.log_action(user_email=email, user_role=admin.get("role", ""), action="Updated PF details",
                                  entity_type="employee_pf_details", entity_id=emp_id, employee_name=emp.get("full_name"),
                                  old_value={k: before.get(k) for k in changed}, new_value=changed)

    name, was_applicable = emp.get("full_name", "An employee"), bool(before.get("pf_applicable"))
    if doc["pf_applicable"] and not was_applicable:
        await notify("member", f"{name} is now PF applicable", f"{emp.get('employee_code', '')} · by {email}",
                     employee=emp, link="/hr/pf?tab=employees", key=f"pf-applicable-{emp_id}-{now[:16]}")
    if not doc["pf_applicable"] and (was_applicable or "exemption_reason" in changed):
        await notify("exempt", f"{name} was marked PF-exempt", f"{doc.get('exemption_reason')} · by {email}",
                     employee=emp, link="/hr/pf?tab=employees", key=f"pf-exempt-{emp_id}-{now[:16]}")
    return await employee_pf_view(emp)


async def _record_pf_change(emp: Dict[str, Any], before: Dict[str, Any], after: Dict[str, Any], admin: Dict[str, Any],
                            reason: str, ip: str = "") -> None:
    """Audit the computed PF figures that moved, and tell the employee when their PF status or deduction changed."""
    moved = [k for k in ("pf_wage", "employee_pf", "employer_pf", "eps", "employer_epf") if before.get(k) != after.get(k)]
    for k in moved:
        await audit(admin, entity="pf_calculation", entity_id=str(emp.get("_id")), field=k, old=before.get(k), new=after.get(k),
                    reason=reason, ip=ip, employee=emp)
    status_changed = before.get("status") != after.get("status")
    if status_changed or "employee_pf" in moved:
        await notify("employee", "Your PF contribution status has been updated",
                     "Please review your latest payslip for the updated PF deduction." +
                     (f" Employee PF: ₹{before.get('employee_pf', 0):,.2f} → ₹{after.get('employee_pf', 0):,.2f}." if "employee_pf" in moved else ""),
                     audience="employee", employee=emp, link="/my/pf", key=f"pf-emp-change-{emp.get('_id')}-{_now()[:16]}")


async def on_salary_change(before_emp: Dict[str, Any], after_emp: Dict[str, Any], admin: Dict[str, Any], reason: str = "", ip: str = "") -> None:
    """Basic salary or DA changed: recompute PF under today's rule, audit what moved, tell the employee.
    Payroll picks the new figures up on its next calculation; finalized payroll keeps what it stored."""
    if (float(before_emp.get("base_salary") or 0), float(before_emp.get("da") or 0)) == \
       (float(after_emp.get("base_salary") or 0), float(after_emp.get("da") or 0)):
        return
    try:
        rules, settings = await list_rules(), await get_settings()
        details = await get_collection("employee_pf_details").find_one({"employee_id": str(after_emp.get("_id"))})
        today = date.today()
        old = pf_engine.evaluate(before_emp, details, rules, settings, today)
        new = pf_engine.evaluate(after_emp, details, rules, settings, today)
        for k in ("basic_salary", "da"):
            if old.get(k) != new.get(k):
                await audit(admin, entity="salary", entity_id=str(after_emp.get("_id")), field=k, old=old.get(k), new=new.get(k),
                            reason=reason or "Salary structure updated", ip=ip, employee=after_emp)
        await _record_pf_change(after_emp, old, new, admin, reason or "Salary structure updated", ip)
    except Exception as e:  # salary is saved either way; PF follows at the next payroll run
        logger.warning(f"PF recalculation after salary change failed for {after_emp.get('employee_code')}: {e}")


async def employee_pf_view(emp: Dict[str, Any], on: Optional[date] = None) -> Dict[str, Any]:
    """Everything the PF Details panel shows: the stored details, the rule in force and today's calculation."""
    on = on or date.today()
    details = await get_details(emp)
    rules, settings = await list_rules(), await get_settings()
    calc = pf_engine.evaluate(emp, None if details.get("is_default") else details, rules, settings, on)
    rule = pf_engine.rule_for(rules, on)
    return {
        "employee": {"id": str(emp.get("_id") or emp.get("id")), "employee_code": emp.get("employee_code", ""),
                     "full_name": emp.get("full_name", ""), "department": emp.get("department", ""),
                     "branch": emp.get("branch", ""), "base_salary": float(emp.get("base_salary") or 0), "da": float(emp.get("da") or 0)},
        "details": {k: details.get(k) for k in (*DETAIL_FIELDS, "is_default", "updated_by", "updated_at", "created_at")},
        "calculation": calc,
        "rule": rule,
        "settings": settings,
    }


async def estimate_employee_pf(emp: Dict[str, Any]) -> float:
    """Employee PF under today's rule, for the 'estimated take-home' kept on the employee record."""
    emp_id = str(emp.get("_id") or emp.get("id") or "")
    details = await get_collection("employee_pf_details").find_one({"employee_id": emp_id}) if emp_id else None
    return pf_engine.evaluate(emp, details, await list_rules(), await get_settings(), date.today()).get("employee_pf", 0.0)


# ---------------------------------------------------------------------------
# Payroll integration
# ---------------------------------------------------------------------------
async def evaluate_for_payroll(emp: Dict[str, Any], year: int, month_no: int, structure: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """The PF snapshot payroll stores on the record: the rule in force on the last day of the month, today's PF details."""
    on = pf_engine.period_end(year, month_no)
    details = await get_collection("employee_pf_details").find_one({"employee_id": str(emp.get("_id"))})
    basic = (structure or {}).get("base_salary", emp.get("base_salary"))
    da = (structure or {}).get("dearness_allowance", emp.get("da", 0))
    rules = await list_rules()
    snap = pf_engine.evaluate(emp, details, rules, await get_settings(), on, basic=basic, da=da)
    rule = pf_engine.rule_for(rules, on)
    if snap["status"] == pf_engine.CALCULATED and rule:
        # Enough to redo this month's PF later (e.g. a payroll edit to basic) with the same rule, whatever rules change.
        snap["rule_snapshot"] = {k: rule.get(k) for k in RULE_SNAPSHOT_FIELDS}
        snap["statutory_pf_wage"] = (details or {}).get("statutory_pf_wage")
    if snap["status"] == pf_engine.ERROR:
        await notify("failure", f"PF calculation failed for {emp.get('full_name', 'an employee')}",
                     f"{snap['reason']} · {on.strftime('%B %Y')}", employee=emp, link="/hr/pf?tab=reports",
                     key=f"pf-fail-{emp.get('_id')}-{on.isoformat()}")
    return snap


RULE_SNAPSHOT_FIELDS = ("id", "rule_name", "minimum_pf_wage", "maximum_pf_wage", "employee_contribution_percent",
                        "employer_contribution_percent", "eps_percent", "eps_enabled", "eps_wage_ceiling",
                        "calculation_basis", "rounding", "effective_from", "effective_to")


def recalculate_snapshot(snap: Dict[str, Any], basic: Any, da: Any) -> Dict[str, Any]:
    """A payroll edit changed basic / DA: redo PF with the rule this payroll already used (not today's rules)."""
    if snap.get("status") != pf_engine.CALCULATED or not snap.get("rule_snapshot"):
        return {**snap, "basic_salary": pf_engine.money(pf_engine.D(basic)), "da": pf_engine.money(pf_engine.D(da))}
    result = pf_engine.calculate_pf(basic, snap["rule_snapshot"], da=da, statutory_wage=snap.get("statutory_pf_wage"),
                                   eps_applicable=snap.get("eps_applicable", True))
    return {**snap, **result}


async def calculate_amounts(basic: Any, *, da: Any = 0, statutory_wage: Any = None, eps_applicable: bool = True,
                            on: Optional[date] = None, rule_id: Optional[str] = None) -> Dict[str, Any]:
    """PF on given amounts under the rule in force on `on` (or a chosen rule): the preview behind forms and the legacy calculator."""
    on = on or date.today()
    rules = await list_rules()
    rule = next((r for r in rules if r["id"] == rule_id), None) if rule_id else pf_engine.rule_for(rules, on)
    if rule_id and not rule:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="PF rule not found.")
    if not rule:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=f"No active PF rule covers {on.isoformat()}.")
    settings = await get_settings()
    try:
        result = pf_engine.calculate_pf(basic, rule, da=da, statutory_wage=statutory_wage, eps_applicable=eps_applicable)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(e))
    return {**result, "calculation_date": on.isoformat(), "pf_enabled": settings.get("enabled", True),
            "rule": {k: rule.get(k) for k in RULE_SNAPSHOT_FIELDS}}


async def record_transaction(payroll: Dict[str, Any], snap: Dict[str, Any]) -> None:
    """Store (or replace, while the payroll is still open) the PF transaction for one payroll record."""
    pid = str(payroll.get("_id") or payroll.get("id"))
    doc = {
        "payroll_id": pid, "payroll_number": payroll.get("payroll_id", ""),
        "employee_id": payroll.get("employee_id"), "employee_code": payroll.get("employee_code", ""),
        "employee_name": payroll.get("employee_name", ""), "department": payroll.get("department", ""),
        "month": payroll.get("month"), "year": payroll.get("year"),
        "pf_rule_id": snap.get("rule_id") or "", "pf_rule_name": snap.get("rule_name") or "",
        "status": snap.get("status"), "reason": snap.get("reason"),
        "basic_salary": snap.get("basic_salary", 0.0), "da": snap.get("da", 0.0), "pf_wage": snap.get("pf_wage", 0.0),
        "minimum_pf_wage": snap.get("minimum_pf_wage"), "maximum_pf_wage": snap.get("maximum_pf_wage"),
        "employee_pf_percent": snap.get("employee_pf_percent"), "employer_pf_percent": snap.get("employer_pf_percent"),
        "eps_percent": snap.get("eps_percent"),
        "employee_pf": snap.get("employee_pf", 0.0), "employer_pf": snap.get("employer_pf", 0.0),
        "eps_contribution": snap.get("eps", 0.0), "employer_epf": snap.get("employer_epf", 0.0),
        "total_contribution": snap.get("total_contribution", 0.0),
        "uan": snap.get("uan", ""), "pf_member_id": snap.get("pf_member_id", ""),
        "calculation_date": snap.get("calculation_date"), "calculated_at": _now(),
        "finalized": payroll.get("status") in ("FINALIZED", "PAID"),
    }
    col = get_collection("payroll_pf_transactions")
    existing = await col.find_one({"payroll_id": pid})
    if existing and existing.get("finalized"):
        return  # finalized PF is never rewritten
    if existing:
        await col.update_one({"payroll_id": pid}, {"$set": doc})
    else:
        await col.insert_one(doc)


async def set_transaction_finalized(payroll_id: str, finalized: bool) -> None:
    await get_collection("payroll_pf_transactions").update_one(
        {"payroll_id": str(payroll_id)}, {"$set": {"finalized": finalized, "finalized_at": _now() if finalized else None}})


async def finalize_blockers(payroll: Dict[str, Any]) -> List[str]:
    """Why this payroll can't be finalized yet (empty when it can). Re-checks requirements switched on since calculation."""
    snap = payroll.get("pf")
    if not snap:
        return []  # payroll calculated before PF management existed: leave it as it was
    settings = await get_settings()
    out = [i["message"] for i in snap.get("issues") or [] if i.get("blocking")]
    if snap.get("status") == pf_engine.CALCULATED:
        if settings.get("require_uan_to_finalize") and not snap.get("uan") and "UAN is missing." not in out:
            out.append("UAN is missing.")
        if settings.get("require_member_id_to_finalize") and not snap.get("pf_member_id") and "PF Member ID is missing." not in out:
            out.append("PF Member ID is missing.")
    return out


# ---------------------------------------------------------------------------
# Rule impact (who a rule change affects)
# ---------------------------------------------------------------------------
async def rule_impact(rule: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Each active employee whose PF differs between the rule before `rule` and `rule` itself."""
    on = pf_engine.to_date(rule.get("effective_from")) or date.today()
    rules = await list_rules()
    previous = pf_engine.rule_for([r for r in rules if r["id"] != rule.get("id")], on - timedelta(days=1))
    settings, details = await get_settings(), await details_map()
    rows = []
    for emp in await get_collection("employees").find({"employee_status": {"$in": ["Active", "Probation"]}}).to_list(5000):
        d = details.get(str(emp["_id"]))
        new = pf_engine.evaluate(emp, d, [rule], settings, on)
        old = pf_engine.evaluate(emp, d, [previous] if previous else [], settings, on - timedelta(days=1)) if previous else None
        if old and all(old.get(k) == new.get(k) for k in ("pf_wage", "employee_pf", "employer_pf", "eps")):
            continue
        rows.append({
            "employee_id": str(emp["_id"]), "employee_code": emp.get("employee_code", ""), "employee_name": emp.get("full_name", ""),
            "department": emp.get("department", ""), "basic_salary": new.get("basic_salary"),
            "previous_rule": (previous or {}).get("rule_name", "—"), "new_rule": rule.get("rule_name"),
            "previous_pf_wage": (old or {}).get("pf_wage", 0.0), "new_pf_wage": new.get("pf_wage", 0.0),
            "previous_employee_pf": (old or {}).get("employee_pf", 0.0), "new_employee_pf": new.get("employee_pf", 0.0),
            "previous_employer_pf": (old or {}).get("employer_pf", 0.0), "new_employer_pf": new.get("employer_pf", 0.0),
            "previous_eps": (old or {}).get("eps", 0.0), "new_eps": new.get("eps", 0.0),
            "difference_employee_pf": round(new.get("employee_pf", 0.0) - (old or {}).get("employee_pf", 0.0), 2),
            "_email": emp.get("email", ""), "_emp": emp,
        })
    return rows


async def _notify_rule_impact(rule: Dict[str, Any]) -> None:
    if str(rule.get("status")).upper() != "ACTIVE":
        return
    try:
        for row in await rule_impact(rule):
            if row["previous_employee_pf"] != row["new_employee_pf"]:
                await notify("employee", "Your PF contribution status has been updated",
                             f"From {rule['effective_from']}, your employee PF is ₹{row['new_employee_pf']:,.2f} "
                             f"(was ₹{row['previous_employee_pf']:,.2f}). Please review your latest payslip for the updated PF deduction.",
                             audience="employee", employee=row["_emp"], link="/my/pf",
                             key=f"pf-rule-impact-{rule['id']}-{row['employee_id']}")
    except Exception as e:
        logger.warning(f"Could not work out who PF rule {rule.get('id')} affects: {e}")


# ---------------------------------------------------------------------------
# First run
# ---------------------------------------------------------------------------
SEED_RULES = [
    {"rule_name": "PF Rule 2026 - Previous", "minimum_pf_wage": 0.0, "maximum_pf_wage": 15000.0,
     "effective_from": "2000-01-01", "effective_to": "2026-09-16",
     "applicability_notes": "Historical ceiling of ₹15,000 (no minimum PF wage)."},
    {"rule_name": "PF Rule 2026 - Current", "minimum_pf_wage": 14000.0, "maximum_pf_wage": 25000.0,
     "effective_from": "2026-09-17", "effective_to": "",
     "applicability_notes": "PF wage = MIN(MAX(Basic, ₹14,000), ₹25,000)."},
]


async def ensure_defaults() -> None:
    """Create the PF settings and the two starting rules once. Never touches them again (they're edited in the app)."""
    if not await get_collection("pf_settings").find_one({"_id": SETTINGS_ID}):
        await get_collection("pf_settings").insert_one({"_id": SETTINGS_ID, **DEFAULT_SETTINGS, "updated_by": "seed", "updated_at": _now()})
    if await get_collection("pf_rules").count_documents({}) == 0:
        now = _now()
        for r in SEED_RULES:
            await get_collection("pf_rules").insert_one({
                **r, "employee_contribution_percent": 12.0, "employer_contribution_percent": 12.0, "eps_percent": 8.33,
                "eps_enabled": True, "eps_wage_ceiling": None, "calculation_basis": pf_engine.BASIS_BASIC, "rounding": "PAISE",
                "status": "ACTIVE", "created_by": "seed", "created_at": now, "updated_by": "seed", "updated_at": now})
        logger.info("Seeded PF settings and rules.")
