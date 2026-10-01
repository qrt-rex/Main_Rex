"""
PF dashboard, lists and reports. Figures come from two places, never from separate math:
  * payroll_pf_transactions: what payroll actually calculated (and, once finalized, can't change)
  * pf_engine.evaluate: today's position for employees payroll hasn't reached yet ("projected")
"""
from collections import defaultdict
from datetime import date
from typing import Any, Dict, List

from app.database import get_collection
from app.services import pf_engine, pf_service
from app.utils.validators import MONTH_NAMES

ACTIVE_STATUSES = ["Active", "Probation"]
SUM_FIELDS = ("pf_wage", "employee_pf", "employer_pf", "eps", "employer_epf")


def _month_no(month: Any) -> int:
    if isinstance(month, int) or str(month).isdigit():
        return int(month)
    return MONTH_NAMES.index(str(month).strip().title()) + 1


def _period_key(year: int, month_no: int) -> str:
    return f"{int(year):04d}-{int(month_no):02d}"


def _r2(v: float) -> float:
    return round(float(v or 0) + 0.0, 2)


async def _employees(department: str = "", branch: str = "", employee_id: str = "", include_inactive: bool = False) -> List[Dict[str, Any]]:
    query: Dict[str, Any] = {} if include_inactive else {"employee_status": {"$in": ACTIVE_STATUSES}}
    if department and department.lower() != "all":
        query["department"] = department
    if branch and branch.lower() != "all":
        query["branch"] = branch
    emps = await get_collection("employees").find(query).to_list(5000)
    if employee_id:
        emps = [e for e in emps if str(e["_id"]) == employee_id or e.get("employee_code") == employee_id]
    return emps


def _tx_row(tx: Dict[str, Any]) -> Dict[str, Any]:
    return {**tx, "eps": tx.get("eps_contribution", 0.0), "source": "payroll", "id": str(tx.get("_id") or tx.get("id") or "")}


async def employee_rows(year: int, month: Any, *, department: str = "", branch: str = "", employee_id: str = "",
                        pf_status: str = "", pf_applicable: str = "", eps_applicable: str = "",
                        include_inactive: bool = False) -> List[Dict[str, Any]]:
    """One row per employee for a month: payroll's PF figures where payroll ran, otherwise the engine's projection."""
    month_no = _month_no(month)
    on = pf_engine.period_end(year, month_no)
    rules, settings, details = await pf_service.list_rules(), await pf_service.get_settings(), await pf_service.details_map()
    txs = {str(t.get("employee_id")): t for t in await get_collection("payroll_pf_transactions").find(
        {"year": int(year), "month": MONTH_NAMES[month_no - 1]}).to_list(10000)}
    rows = []
    for emp in await _employees(department, branch, employee_id, include_inactive):
        eid = str(emp["_id"])
        d = details.get(eid)
        live = pf_engine.evaluate(emp, d, rules, settings, on)
        tx = txs.get(eid)
        figures = {k: tx.get("eps_contribution" if k == "eps" else k, 0.0) for k in SUM_FIELDS} if tx else {k: live.get(k, 0.0) for k in SUM_FIELDS}
        rows.append({
            "employee_id": eid, "employee_code": emp.get("employee_code", ""), "employee_name": emp.get("full_name", ""),
            "department": emp.get("department", ""), "branch": emp.get("branch", ""), "email": emp.get("email", ""),
            "employee_status": emp.get("employee_status", ""),
            "basic_salary": tx.get("basic_salary") if tx else live.get("basic_salary"),
            "da": tx.get("da", 0.0) if tx else live.get("da"),
            **figures,
            "total_contribution": _r2(figures["employee_pf"] + figures["employer_pf"]),
            "pf_applicable": bool((d or pf_engine.default_details(emp)).get("pf_applicable")),
            "eps_applicable": bool((d or pf_engine.default_details(emp)).get("eps_applicable", True)),
            "uan": (d or {}).get("uan", ""), "pf_member_id": (d or {}).get("pf_member_id", ""),
            "pf_joining_date": (d or {}).get("pf_joining_date", ""),
            "exemption_reason": (d or {}).get("exemption_reason", ""),
            "details_recorded": d is not None,
            "pf_status": tx.get("status") if tx else live.get("status"),
            "reason": tx.get("reason") if tx else live.get("reason"),
            "rule_name": tx.get("pf_rule_name") if tx else live.get("rule_name", ""),
            "wage_limited_by": live.get("wage_limited_by"),
            "issues": live.get("issues", []),
            "source": "payroll" if tx else "projected",
            "payroll_finalized": bool(tx and tx.get("finalized")),
        })

    def keep(r):
        if pf_status and pf_status.upper() != "ALL" and r["pf_status"] != pf_status.upper():
            return False
        if pf_applicable in ("yes", "no") and r["pf_applicable"] != (pf_applicable == "yes"):
            return False
        if eps_applicable in ("yes", "no") and r["eps_applicable"] != (eps_applicable == "yes"):
            return False
        return True
    rows = [r for r in rows if keep(r)]
    rows.sort(key=lambda r: (r["department"], r["employee_name"]))
    return rows


async def dashboard(year: int, month: Any, **filters) -> Dict[str, Any]:
    month_no = _month_no(month)
    rows = await employee_rows(year, month_no, **filters)
    on = pf_engine.period_end(year, month_no)
    rules = await pf_service.list_rules()
    current = pf_engine.rule_for(rules, on)
    key = _period_key(year, month_no)

    audit = await get_collection("pf_audit_logs").find({"field_key": "pf_applicable"}).to_list(10000)
    changed_ids = {a.get("employee_id") for a in audit if str(a.get("created_at", ""))[:7] == key and a.get("old_value") is not None}
    in_scope = {r["employee_id"] for r in rows}
    details = await pf_service.details_map()

    def new_member(r):
        d = details.get(r["employee_id"]) or {}
        joined = str(d.get("pf_joining_date") or "")[:7]
        return r["pf_status"] == pf_engine.CALCULATED and (joined == key or (not joined and str(d.get("created_at") or "")[:7] == key))

    covered = [r for r in rows if r["pf_status"] == pf_engine.CALCULATED]
    totals = {k: _r2(sum(r[k] for r in covered)) for k in SUM_FIELDS}
    by_dept: Dict[str, Dict[str, float]] = defaultdict(lambda: {"employees": 0, **{k: 0.0 for k in SUM_FIELDS}})
    for r in covered:
        g = by_dept[r["department"] or "—"]
        g["employees"] += 1
        for k in SUM_FIELDS:
            g[k] = _r2(g[k] + r[k])
    return {
        "period": {"month": MONTH_NAMES[month_no - 1], "year": int(year), "on": on.isoformat()},
        "current_rule": current,
        "pf_enabled": (await pf_service.get_settings()).get("enabled", True),
        "metrics": {
            "employees": len(rows),
            "pf_covered": len(covered),
            "pf_exempt": sum(1 for r in rows if r["pf_status"] == pf_engine.EXEMPT),
            "not_applicable": sum(1 for r in rows if r["pf_status"] in (pf_engine.NOT_APPLICABLE, pf_engine.DISABLED)),
            "errors": sum(1 for r in rows if r["pf_status"] == pf_engine.ERROR),
            "new_members": sum(1 for r in rows if new_member(r)),
            "affected_by_rule": sum(1 for r in covered if r["wage_limited_by"]),
            "applicability_changed": len(changed_ids & in_scope),
            "total_pf_wage": totals["pf_wage"],
            "total_employee_pf": totals["employee_pf"],
            "total_employer_pf": totals["employer_pf"],
            "total_eps": totals["eps"],
            "total_employer_epf": totals["employer_epf"],
            "monthly_liability": _r2(totals["employee_pf"] + totals["employer_pf"]),
            "missing_uan": sum(1 for r in covered if not r["uan"]),
            "incomplete": sum(1 for r in rows if r["pf_status"] == pf_engine.ERROR or (
                r["pf_status"] == pf_engine.CALCULATED and (not r["uan"] or not r["pf_member_id"] or not r["details_recorded"]))),
            "from_payroll": sum(1 for r in rows if r["source"] == "payroll"),
            "projected": sum(1 for r in rows if r["source"] == "projected"),
        },
        "by_department": [{"department": k, **v} for k, v in sorted(by_dept.items())],
    }


async def payroll_rows(year: int, month: Any, department: str = "") -> List[Dict[str, Any]]:
    """PF on the payroll screen and the pre-finalize preview: payroll's own figures where it ran, a preview otherwise."""
    month_no = _month_no(month)
    payrolls = {str(p.get("employee_id")): p for p in await get_collection("payrolls").find(
        {"year": int(year), "month": MONTH_NAMES[month_no - 1]}).to_list(10000)}
    on = pf_engine.period_end(year, month_no)
    rules, settings, details = await pf_service.list_rules(), await pf_service.get_settings(), await pf_service.details_map()
    out = []
    for emp in await _employees(department):
        eid = str(emp["_id"])
        pr = payrolls.get(eid)
        snap = (pr or {}).get("pf") or pf_engine.evaluate(emp, details.get(eid), rules, settings, on)
        out.append({
            "employee_id": eid, "employee_code": emp.get("employee_code", ""), "employee_name": emp.get("full_name", ""),
            "department": emp.get("department", ""),
            "payroll_id": str(pr["_id"]) if pr else None, "payroll_status": (pr or {}).get("status", "NOT_CALCULATED"),
            "net_salary": (pr or {}).get("net_salary"), "gross_salary": (pr or {}).get("gross_salary"),
            "legacy": bool(pr and not pr.get("pf")),  # payroll calculated before PF management: shown as stored
            "pf_status": snap.get("status") if snap else None, "reason": (snap or {}).get("reason"),
            "basic_salary": (snap or {}).get("basic_salary", (pr or {}).get("earnings", {}).get("basic")),
            "minimum_pf_wage": (snap or {}).get("minimum_pf_wage"), "maximum_pf_wage": (snap or {}).get("maximum_pf_wage"),
            "pf_wage": (snap or {}).get("pf_wage", 0.0),
            "employee_pf_percent": (snap or {}).get("employee_pf_percent"), "employer_pf_percent": (snap or {}).get("employer_pf_percent"),
            "eps_percent": (snap or {}).get("eps_percent"),
            "employee_pf": (snap or {}).get("employee_pf", (pr or {}).get("deductions", {}).get("pf", 0.0)),
            "employer_pf": (snap or {}).get("employer_pf", 0.0), "eps": (snap or {}).get("eps", 0.0),
            "employer_epf": (snap or {}).get("employer_epf", 0.0),
            "rule_name": (snap or {}).get("rule_name", ""),
            "blocking": bool((snap or {}).get("blocking")), "issues": (snap or {}).get("issues", []),
        })
    return out


def _in_range(tx: Dict[str, Any], start: str, end: str) -> bool:
    key = str(tx.get("calculation_date") or "")[:7]
    return (not start or key >= start) and (not end or key <= end)


async def report(kind: str, *, start: str = "", end: str = "", department: str = "", branch: str = "",
                 employee_id: str = "", rule_id: str = "", finalized_only: bool = False) -> Dict[str, Any]:
    """start / end are YYYY-MM months (inclusive)."""
    kind = (kind or "monthly").lower()
    if kind in ("monthly", "department", "history"):
        txs = [t for t in await get_collection("payroll_pf_transactions").find({}).to_list(100000) if _in_range(t, start, end)]
        if finalized_only:
            txs = [t for t in txs if t.get("finalized")]
        if department and department.lower() != "all":
            txs = [t for t in txs if t.get("department") == department]
        if branch and branch.lower() != "all":
            in_branch = {str(e["_id"]) for e in await _employees(branch=branch, include_inactive=True)}
            txs = [t for t in txs if str(t.get("employee_id")) in in_branch]
        if employee_id:
            txs = [t for t in txs if str(t.get("employee_id")) == employee_id or t.get("employee_code") == employee_id]
        rows = [_tx_row(t) for t in txs]
        rows.sort(key=lambda r: (str(r.get("calculation_date")), r.get("department", ""), r.get("employee_name", "")))
        if kind == "department":
            groups: Dict[str, Dict[str, Any]] = {}
            for r in rows:
                g = groups.setdefault(r.get("department") or "—", {"department": r.get("department") or "—", "employees": set(),
                                                                   **{k: 0.0 for k in SUM_FIELDS}, "total_contribution": 0.0})
                g["employees"].add(r.get("employee_id"))
                for k in (*SUM_FIELDS, "total_contribution"):
                    g[k] = _r2(g[k] + float(r.get(k) or 0))
            rows = [{**g, "employees": len(g["employees"])} for g in groups.values()]
            rows.sort(key=lambda g: g["department"])
        totals = {k: _r2(sum(float(r.get(k) or 0) for r in rows)) for k in (*SUM_FIELDS, "total_contribution")}
        return {"kind": kind, "rows": rows, "totals": totals}

    if kind == "impact":
        rules = await pf_service.list_rules()
        rule = next((r for r in rules if r["id"] == rule_id), None) if rule_id else pf_engine.rule_for(rules, date.today())
        if not rule:
            return {"kind": kind, "rows": [], "totals": {}, "rule": None}
        rows = [{k: v for k, v in r.items() if not k.startswith("_")} for r in await pf_service.rule_impact(rule)]
        if department and department.lower() != "all":
            rows = [r for r in rows if r["department"] == department]
        return {"kind": kind, "rule": rule, "rows": rows,
                "totals": {"employees": len(rows), "difference_employee_pf": _r2(sum(r["difference_employee_pf"] for r in rows))}}

    if kind == "exceptions":
        today = date.today()
        rows: List[Dict[str, Any]] = []
        for r in await employee_rows(today.year, today.month, department=department, branch=branch, employee_id=employee_id):
            def add(code, message):
                rows.append({"employee_id": r["employee_id"], "employee_code": r["employee_code"], "employee_name": r["employee_name"],
                             "department": r["department"], "exception": code, "message": message, "period": "Current"})
            if not r["details_recorded"]:
                add("MISSING_PF_DETAILS", "PF details have not been recorded.")
            if r["pf_status"] == pf_engine.EXEMPT:
                add("EXEMPT", r["reason"])
            if r["pf_status"] == pf_engine.ERROR:
                add("CALCULATION_ERROR", r["reason"])
            if r["pf_status"] == pf_engine.CALCULATED:
                if not r["uan"]:
                    add("MISSING_UAN", "UAN is missing.")
                if not r["pf_member_id"]:
                    add("MISSING_MEMBER_ID", "PF Member ID is missing.")
        for t in await get_collection("payroll_pf_transactions").find({"status": pf_engine.ERROR}).to_list(10000):
            if _in_range(t, start, end) and (not department or department.lower() == "all" or t.get("department") == department):
                rows.append({"employee_id": t.get("employee_id"), "employee_code": t.get("employee_code"), "employee_name": t.get("employee_name"),
                             "department": t.get("department"), "exception": "PAYROLL_PF_ERROR", "message": t.get("reason"),
                             "period": f"{t.get('month')} {t.get('year')}"})
        for issue in await config_issues():
            rows.append({"employee_id": "", "employee_code": "", "employee_name": "PF configuration", "department": "",
                         "exception": "INVALID_CONFIGURATION", "message": issue, "period": "Current"})
        counts: Dict[str, int] = defaultdict(int)
        for r in rows:
            counts[r["exception"]] += 1
        return {"kind": kind, "rows": rows, "totals": dict(counts)}

    raise ValueError("Unknown report. Use monthly, department, history, impact or exceptions.")


async def config_issues() -> List[str]:
    """Problems with the PF rules themselves (shown in the exception report and on the configuration page)."""
    rules = [r for r in await pf_service.list_rules() if str(r.get("status")).upper() == "ACTIVE"]
    settings = await pf_service.get_settings()
    issues = []
    today = date.today()
    if settings.get("enabled", True) and not pf_engine.rule_for(rules, today):
        issues.append(f"No active PF rule covers today ({today.isoformat()}): payroll can't calculate PF.")
    for i, a in enumerate(rules):
        for b in rules[i + 1:]:
            af, at = pf_engine.to_date(a.get("effective_from")), pf_engine.to_date(a.get("effective_to"))
            bf, bt = pf_engine.to_date(b.get("effective_from")), pf_engine.to_date(b.get("effective_to"))
            if af and bf and pf_engine.ranges_overlap(af, at, bf, bt):
                issues.append(f"Active rules \"{a.get('rule_name')}\" and \"{b.get('rule_name')}\" overlap.")
    for r in rules:
        try:
            from app.schemas.pf import validate_rule_values
            validate_rule_values(r)
        except ValueError as e:
            issues.append(f"Rule \"{r.get('rule_name')}\": {e}")
    return issues
