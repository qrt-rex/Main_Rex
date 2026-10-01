"""
Payroll inputs for sales staff, taken from what they do in the Sales workspace and Billing:

* attendance for the month from their Start Day / End Day punches (`attendance` records),
  approved leave, and the days they never started (absent);
* the collection incentive, from client payments received on invoices that name them as the
  sales person. Every figure uses the NET collection: the payment minus the DSC deducted when the
  payment was recorded (the gross amount stays on the payment too).

This module is the one incentive engine: the scorecard, the leaderboard, the monthly incentive report and
its exports all call it. The incentive is paid separately: it is never added to salary or payslips. Rules come from the HR incentive settings (defaults in brackets); monthly
salary = the standard gross of the salary structure:
  * eligibility: net month collection >= salary x eligibility multiplier (3), else nothing is paid
  * daily:   every day with net collection >= daily threshold (10,000) pays daily % (5) of that day
  * weekly:  every Mon-Sun week (days inside the month) with >= weekly threshold (50,000) pays
             weekly % (5) of the whole week, on top of the daily incentive
  * monthly: at net collection >= salary x target multiplier (4), the slab % of the whole month's
             net collection is paid on top (< 2L 20%, 2-3L 25%, 3-4L 27.5%, 4-5L 30%, 5-6L 32.5%,
             6-7L 35%, 7-8L 37.5%, 8L+ 40%)
"""
import calendar
import logging
import re
from collections import defaultdict
from datetime import date, datetime, timedelta
from typing import Any, Dict, Iterator, List, Optional, Tuple

from app.database import get_collection
from app.services.audit_service import AuditService
from app.services.rbac_service import has_role

logger = logging.getLogger("rexera.sales_payroll")

WEEKLY_OFF_WEEKDAY = 6  # Sunday: paid, never counted absent (the payroll engine assumes 4 weekly offs a month)
SETTINGS_ID = "incentive_rules"
_DEFAULT_SLABS = [(0, 200_000, 20.0), (200_000, 300_000, 25.0), (300_000, 400_000, 27.5), (400_000, 500_000, 30.0),
                  (500_000, 600_000, 32.5), (600_000, 700_000, 35.0), (700_000, 800_000, 37.5), (800_000, None, 40.0)]
DEFAULT_CONFIG: Dict[str, Any] = {
    "dsc_amount": 850.0,  # Super Admin only
    "daily_threshold": 10_000.0, "daily_percent": 5.0,
    "weekly_threshold": 50_000.0, "weekly_percent": 5.0,
    "eligibility_multiplier": 3.0, "target_multiplier": 4.0,
    "slabs": [{"min": lo, "max": hi, "percent": pct, "active": True} for lo, hi, pct in _DEFAULT_SLABS],
    "version": 0,
}


def _r(x: float) -> float:
    return round(x + 1e-9, 2)


async def get_config() -> Dict[str, Any]:
    doc = await get_collection("sales_settings").find_one({"_id": SETTINGS_ID}) or {}
    return {**DEFAULT_CONFIG, **{k: v for k, v in doc.items() if k in DEFAULT_CONFIG or k in ("updated_by", "updated_at")}}


async def save_config(changes: Dict[str, Any], actor: str) -> Dict[str, Any]:
    """Stores new rules as the next version. Payments keep the DSC they were recorded with, and payroll keeps
    the incentive it was calculated with, so a change only affects what is calculated from now on."""
    old = await get_config()
    new = {**{k: old[k] for k in DEFAULT_CONFIG}, **changes, "version": int(old["version"]) + 1,
           "updated_by": actor, "updated_at": datetime.utcnow().isoformat()}
    col = get_collection("sales_settings")
    if await col.find_one({"_id": SETTINGS_ID}):
        await col.update_one({"_id": SETTINGS_ID}, {"$set": new})
    else:
        await col.insert_one({"_id": SETTINGS_ID, **new})
    await AuditService.log_action(user_email=actor, user_role="", action="Changed sales incentive settings",
                                  entity_type="sales_settings", entity_id=SETTINGS_ID,
                                  old_value={k: old[k] for k in changes}, new_value=changes)
    return await get_config()


def slab_percent(amount: float, slabs: List[Dict[str, Any]]) -> float:
    """The % of the active slab the amount falls in: min inclusive, max exclusive, no max = and above."""
    for s in slabs:
        if s.get("active", True) and amount >= float(s["min"]) and (s.get("max") is None or amount < float(s["max"])):
            return float(s["percent"])
    return 0.0


def monthly_salary(structure: Dict[str, Any]) -> float:
    """Standard monthly gross: basic + HRA + allowances (what the payroll engine calls standard gross)."""
    base = float(structure.get("base_salary") or 0)
    hra = float(structure.get("hra_value") or 0)
    if structure.get("hra_type") == "percentage":
        hra = base * hra / 100
    return _r(base + hra + sum(float(structure.get(k) or 0) for k in
                               ("conveyance_allowance", "medical_allowance", "special_allowance", "other_allowances")))


def compute_incentive(payments: List[Dict[str, Any]], salary: float, cfg: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """payments: one person's collections in the month ({id, date, gross, dsc, net}). Pure, so it is easy to test."""
    cfg = cfg or DEFAULT_CONFIG
    unique = list({p["id"]: p for p in payments}.values())  # a payment counts once, however often it was listed
    net = _r(sum(p["net"] for p in unique))
    gate, target = _r(salary * float(cfg["eligibility_multiplier"])), _r(salary * float(cfg["target_multiplier"]))

    by_day: Dict[str, float] = defaultdict(float)
    for p in unique:
        by_day[p["date"]] += p["net"]
    days = [{"date": d, "collection": _r(v), "incentive": _r(v * float(cfg["daily_percent"]) / 100)}
            for d, v in sorted(by_day.items()) if v >= float(cfg["daily_threshold"])]
    by_week: Dict[Tuple[int, int], List[str]] = defaultdict(list)
    for d in sorted(by_day):
        by_week[date.fromisoformat(d).isocalendar()[:2]].append(d)
    weeks = []
    for key in sorted(by_week):
        ds = by_week[key]
        total = sum(by_day[d] for d in ds)
        if total >= float(cfg["weekly_threshold"]):
            weeks.append({"from": ds[0], "to": ds[-1], "collection": _r(total),
                          "incentive": _r(total * float(cfg["weekly_percent"]) / 100)})

    eligible = salary > 0 and net >= gate
    target_met = salary > 0 and net >= target
    pct = slab_percent(net, cfg["slabs"]) if target_met else None
    daily = _r(sum(d["incentive"] for d in days)) if eligible else 0.0
    weekly = _r(sum(w["incentive"] for w in weeks)) if eligible else 0.0
    monthly = _r(net * pct / 100) if eligible and target_met else 0.0

    e_mult, t_mult = f"{float(cfg['eligibility_multiplier']):g}", f"{float(cfg['target_multiplier']):g}"
    if salary <= 0:
        note = "No monthly salary on the salary structure, so there is no incentive target."
    elif not eligible:
        note = (f"Not eligible: needs ₹{gate:,.2f} net collection (salary x{e_mult}); has ₹{net:,.2f}, "
                f"₹{gate - net:,.2f} to go.")
    elif not target_met:
        note = (f"Eligible: daily and weekly incentives are paid. The monthly incentive needs ₹{target:,.2f} "
                f"(salary x{t_mult}); ₹{target - net:,.2f} to go.")
    else:
        note = f"Eligible and met the salary x{t_mult} target: daily + weekly + {pct:g}% monthly slab."
    return {
        "monthly_salary": _r(salary), "gross_collection": _r(sum(p["gross"] for p in unique)),
        "dsc_deduction": _r(sum(p["dsc"] for p in unique)), "net_collection": net, "collection": net,
        "payments_counted": len(unique), "gate_amount": gate, "target_amount": target,
        "eligible": eligible, "target_met": target_met, "slab_percent": pct,
        "eligibility": {"status": "Eligible" if eligible else "Not eligible", "required": gate, "current": net,
                        "remaining": _r(max(gate - net, 0.0))},
        "target_achievement": _r(net / target * 100) if target > 0 else 0.0,
        "daily_incentive": daily, "weekly_incentive": weekly, "monthly_incentive": monthly,
        "incentive": _r(daily + weekly + monthly), "days": days, "weeks": weeks,
        "config_version": cfg.get("version", 0), "note": note,
    }


def _iso_date(value: Any) -> Optional[date]:
    try:
        return date.fromisoformat(str(value or "")[:10])
    except ValueError:
        return None


def _email_match(email: str) -> Dict[str, Any]:
    return {"$regex": f"^{re.escape(email.strip())}$", "$options": "i"}


def _months(start: date, end: date) -> Iterator[str]:
    y, m = start.year, start.month
    while (y, m) <= (end.year, end.month):
        yield f"{y}-{m:02d}"
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)


async def collections(start: date, end: date, email: Optional[str] = None) -> Dict[str, List[Dict[str, Any]]]:
    """
    Collections per sales person (lower-case email) from `start` to `end` inclusive: payments on
    non-cancelled invoices that name them as sales person. Each person only ever gets their own invoices'
    payments, and a deleted (reversed) payment is simply gone, so it drops out of every figure.
    """
    months = "|".join(_months(start, end))
    pays = await get_collection("billing_payments").find({"payment_date": {"$regex": f"^({months})-"}}).to_list(200000)
    inv_ids = list({p["invoice_id"] for p in pays if p.get("invoice_id")})
    invoices = await get_collection("billing_invoices").find({"id": {"$in": inv_ids}}).to_list(200000) if inv_ids else []
    owner = {i["id"]: str(i["sales_person_email"]).strip().lower() for i in invoices
             if i.get("status") != "cancelled" and i.get("sales_person_email")}
    lo, hi, only = start.isoformat(), end.isoformat(), (email or "").strip().lower()
    out: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    for p in pays:
        who, day = owner.get(p.get("invoice_id")), str(p.get("payment_date"))[:10]
        if not who or not lo <= day <= hi or (only and who != only):
            continue
        gross, dsc = float(p.get("amount") or 0), float(p.get("dsc_amount") or 0)
        out[who].append({"id": str(p.get("id") or p.get("_id")), "date": day, "gross": gross, "dsc": dsc,
                         "net": _r(max(gross - dsc, 0.0)), "invoice_number": p.get("invoice_number", "")})
    return out


def month_range(year: int, month: int) -> Tuple[date, date]:
    return date(year, month, 1), date(year, month, calendar.monthrange(year, month)[1])


def period_range(period: str, day: date) -> Tuple[date, date]:
    """The day, the Mon-Sun week, or the month containing `day`."""
    if period == "day":
        return day, day
    if period == "week":
        monday = day - timedelta(days=day.weekday())
        return monday, monday + timedelta(days=6)
    return month_range(day.year, day.month)


async def record_month(year: int, month: int, actor: str) -> List[Dict[str, Any]]:
    """Works out and stores every sales person's incentive for the month (sales_incentive_snapshots). Recording
    again (a recalculation) keeps a history line: who, when, and the total before and after."""
    cfg = await get_config()
    got = await collections(*month_range(year, month))
    col = get_collection("sales_incentive_snapshots")
    now = datetime.utcnow().isoformat()
    out = []
    for p in await sales_people():
        inc = compute_incentive(got.get(p["email"], []), p["salary"], cfg)
        snap_id = f"{year}-{month:02d}-{p['email']}"
        doc = {"employee_id": p["employee_id"], "employee_code": p["employee_code"], "employee_name": p["name"],
               "email": p["email"], "month": calendar.month_name[month], "year": year, "salary": inc["monthly_salary"],
               "gross_collection": inc["gross_collection"], "dsc_deduction": inc["dsc_deduction"],
               "net_collection": inc["net_collection"], "eligibility_target": inc["gate_amount"],
               "monthly_target": inc["target_amount"], "daily_incentive": inc["daily_incentive"],
               "weekly_incentive": inc["weekly_incentive"], "monthly_incentive": inc["monthly_incentive"],
               "total_incentive": inc["incentive"], "eligibility_status": inc["eligibility"]["status"],
               "calculation_date": now, "calculated_by": actor, "config_version": inc["config_version"], "details": inc}
        old = await col.find_one({"_id": snap_id})
        doc["history"] = [*((old or {}).get("history") or []),
                          *([{"at": now, "by": actor, "previous_total": old.get("total_incentive", 0.0),
                              "new_total": inc["incentive"]}] if old else [])]
        if old:
            await col.update_one({"_id": snap_id}, {"$set": doc})
        else:
            await col.insert_one({"_id": snap_id, **doc})
        out.append(doc)
    await AuditService.log_action(user_email=actor, user_role="", action="Recorded sales incentives",
                                  entity_type="sales_incentives", entity_id=f"{year}-{month:02d}",
                                  new_value={"people": len(out), "total": _r(sum(d["total_incentive"] for d in out))})
    return out


async def sales_user(email: Optional[str]) -> Optional[Dict[str, Any]]:
    """The login account behind an employee, if it is a sales account."""
    if not email:
        return None
    for u in await get_collection("admins").find({"email": _email_match(email)}).to_list(5):
        if u.get("is_active", True) and has_role(u, "sales"):
            return u
    return None


async def sales_people() -> List[Dict[str, Any]]:
    """Every active sales account, with its employee record's details and monthly salary (0 without one)."""
    people = []
    for u in await get_collection("admins").find({}).to_list(10000):
        if not (u.get("is_active", True) and has_role(u, "sales") and u.get("email")):
            continue
        email = str(u["email"]).strip().lower()
        emp = await get_collection("employees").find_one({"email": _email_match(email)}) or {}
        structure = await get_collection("salary_structures").find_one(
            {"employee_id": str(emp["_id"]), "is_active": True}) if emp else None
        # Without a saved structure, payroll builds one from the employee record: same numbers here.
        structure = structure or {"base_salary": emp.get("base_salary"), "hra_value": emp.get("hra"),
                                  "conveyance_allowance": emp.get("conveyance_allowance"),
                                  "special_allowance": emp.get("special_allowance")}
        people.append({"email": email, "name": emp.get("full_name") or u.get("username") or email,
                       "employee_id": str(emp["_id"]) if emp else "", "employee_code": emp.get("employee_code", ""),
                       "department": emp.get("department") or "Sales", "salary": monthly_salary(structure)})
    return people


async def month_attendance(emp: Dict[str, Any], year: int, month: int, today: Optional[date] = None) -> Optional[Dict[str, Any]]:
    """
    The month's attendance from Start Day / End Day punches, in the shape the payroll engine takes.
    None (keep the old default of a full month) unless the employee has punches this month, is a sales
    account, or joined / left part-way through, so staff who don't use punches are not suddenly marked absent.
    Every day before the joining date and after the exit date (the last working day) is absent (unpaid),
    Sundays included: they were not employed on those days.
    """
    emp_id = emp.get("employee_code") or emp.get("employee_id") or str(emp.get("_id"))
    prefix = f"{year}-{month:02d}"
    records = await get_collection("attendance").find({"employee_id": emp_id, "attendance_date": {"$regex": f"^{prefix}-"}}).to_list(400)
    is_sales = bool(await sales_user(emp.get("email")))
    last = calendar.monthrange(year, month)[1]
    joined, exited = _iso_date(emp.get("date_of_joining")), _iso_date(emp.get("date_of_exit"))
    joined_late = joined is not None and joined > date(year, month, 1)
    left_early = exited is not None and exited < date(year, month, last)
    punches = bool(records) or is_sales
    if not punches and not joined_late and not left_early:
        return None

    today = today or date.today()
    by_date = {r["attendance_date"]: r for r in records}
    leaves = [l for l in await get_collection("leave_requests").find({"employee_id": emp_id, "status": "APPROVED"}).to_list(500)
              if l.get("start_date", "") <= f"{prefix}-{last:02d}" and l.get("end_date", "") >= f"{prefix}-01"]

    def leave_on(day: str) -> Optional[Dict[str, Any]]:
        return next((l for l in leaves if l["start_date"] <= day <= l["end_date"]), None)

    present = half = absent = late = paid_leave = unpaid_leave = missed_end = offs = before_joining = after_exit = 0.0
    for n in range(1, last + 1):
        d = date(year, month, n)
        if joined_late and d < joined:
            absent += 1
            before_joining += 1
            continue
        if left_early and d > exited:
            absent += 1
            after_exit += 1
            continue
        if not punches:
            present += 1  # staff who don't punch: every day from joining is paid, as before
            continue
        if d > today:
            offs += 1  # not yet worked: not penalised (payroll normally runs after month end)
            continue
        key = d.isoformat()
        rec = by_date.get(key)
        status = rec.get("status") if rec else None
        if rec and rec.get("punch_in_time") and status in ("PRESENT", "LATE", "HALF_DAY"):
            # Started the day but never ended it: only half a day can be vouched for.
            forgot_end = not rec.get("punch_out_time") and d < today
            if status == "HALF_DAY" or forgot_end:
                half += 1
                missed_end += 1 if forgot_end and status != "HALF_DAY" else 0
            else:
                present += 1
            late += 1 if rec.get("is_late") else 0
            continue
        if status in ("HOLIDAY", "WEEK_OFF"):
            offs += 1
            continue
        leave = leave_on(key)
        if leave or status == "ON_LEAVE":
            days = 0.5 if (leave or {}).get("duration_type", "FULL_DAY") != "FULL_DAY" else 1.0
            if (leave or {}).get("leave_type") == "LOP":
                unpaid_leave += days
            else:
                paid_leave += days
            continue
        if d.weekday() == WEEKLY_OFF_WEEKDAY and status != "ABSENT":
            offs += 1
            continue
        absent += 1

    return {"working_days": last, "present_days": present + half + offs, "half_days": int(half), "absent_days": absent,
            "paid_leave_days": paid_leave, "unpaid_leave_days": unpaid_leave, "late_count": int(late),
            "weekly_offs": int(offs), "missed_end_day": int(missed_end), "full_days": int(present),
            "before_joining_days": int(before_joining), "after_exit_days": int(after_exit), "is_sales": is_sales}
