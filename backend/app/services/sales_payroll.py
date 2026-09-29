"""
Payroll inputs for sales staff, taken from what they do in the Sales workspace and Billing:

* attendance for the month from their Start Day / End Day punches (`attendance` records),
  approved leave, and the days they never started (absent);
* the collection incentive, from client payments received on invoices that name them as the
  sales person.

Incentive rules (monthly salary = the standard gross of the salary structure):
  * collection below salary x3            -> no incentive
  * salary x3 up to (below) salary x4     -> daily and weekly 5%: a day with >= 10,000 collected pays 5% of that
                                             day; a week (Mon-Sun, days inside the month) with >= 50,000 pays 5% of
                                             the week's money not already paid as daily incentive
  * collection at or above salary x4      -> the monthly slab % of the whole month's collection instead
                                             (< 2L 20%, 2-3L 25%, 3-4L 27.5%, 4-5L 30%, 5-6L 32.5%, 6-7L 35%,
                                             7-8L 37.5%, 8L+ 40%); it replaces daily/weekly so no rupee pays twice
"""
import calendar
import logging
import re
from collections import defaultdict
from datetime import date
from typing import Any, Dict, List, Optional, Tuple

from app.database import get_collection
from app.services.rbac_service import normalize_role

logger = logging.getLogger("rexera.sales_payroll")

DAILY_MIN, WEEKLY_MIN, DAILY_WEEKLY_PCT = 10_000.0, 50_000.0, 5.0
GATE_MULTIPLE, TARGET_MULTIPLE = 3, 4
# (collection at or above, % of the month's collection), highest first; below the last one is BASE_SLAB_PCT.
SLABS: List[Tuple[float, float]] = [(800_000, 40.0), (700_000, 37.5), (600_000, 35.0), (500_000, 32.5),
                                    (400_000, 30.0), (300_000, 27.5), (200_000, 25.0)]
BASE_SLAB_PCT = 20.0
WEEKLY_OFF_WEEKDAY = 6  # Sunday: paid, never counted absent (the payroll engine assumes 4 weekly offs a month)


def _r(x: float) -> float:
    return round(x + 1e-9, 2)


def slab_percent(collection: float) -> float:
    for floor, pct in SLABS:
        if collection >= floor:
            return pct
    return BASE_SLAB_PCT


def monthly_salary(structure: Dict[str, Any]) -> float:
    """Standard monthly gross: basic + HRA + allowances (what the payroll engine calls standard gross)."""
    base = float(structure.get("base_salary") or 0)
    hra = float(structure.get("hra_value") or 0)
    if structure.get("hra_type") == "percentage":
        hra = base * hra / 100
    return _r(base + hra + sum(float(structure.get(k) or 0) for k in
                               ("conveyance_allowance", "medical_allowance", "special_allowance", "other_allowances")))


def compute_incentive(payments: List[Tuple[str, float]], salary: float) -> Dict[str, Any]:
    """payments: (YYYY-MM-DD, amount) collected in the payroll month. Pure, so it is easy to test."""
    total = _r(sum(a for _, a in payments))
    gate, target = _r(salary * GATE_MULTIPLE), _r(salary * TARGET_MULTIPLE)
    out: Dict[str, Any] = {"monthly_salary": _r(salary), "collection": total, "gate_amount": gate, "target_amount": target,
                           "mode": "none", "slab_percent": None, "daily_incentive": 0.0, "weekly_incentive": 0.0,
                           "monthly_incentive": 0.0, "incentive": 0.0, "days": [], "weeks": [], "note": ""}
    if salary <= 0:
        out["note"] = "No monthly salary on the salary structure, so no incentive target."
        return out
    if total < gate:
        out["note"] = f"Collection ₹{total:,.2f} is below the ₹{gate:,.2f} (salary x{GATE_MULTIPLE}) needed for any incentive."
        return out
    if total >= target:
        pct = slab_percent(total)
        out.update(mode="monthly", slab_percent=pct, monthly_incentive=_r(total * pct / 100))
        out["incentive"] = out["monthly_incentive"]
        out["note"] = f"Met the salary x{TARGET_MULTIPLE} target: {pct:g}% of ₹{total:,.2f}."
        return out

    by_day: Dict[str, float] = defaultdict(float)
    for d, a in payments:
        by_day[d] += a
    weeks: Dict[Tuple[int, int], List[str]] = defaultdict(list)
    for d in by_day:
        weeks[date.fromisoformat(d).isocalendar()[:2]].append(d)
    daily_total = weekly_total = 0.0
    for key in sorted(weeks):
        days = sorted(weeks[key])
        week_sum = sum(by_day[d] for d in days)
        qualified = [d for d in days if by_day[d] >= DAILY_MIN]
        for d in qualified:
            amt = _r(by_day[d] * DAILY_WEEKLY_PCT / 100)
            daily_total += amt
            out["days"].append({"date": d, "collection": _r(by_day[d]), "incentive": amt})
        if week_sum >= WEEKLY_MIN:
            rest = week_sum - sum(by_day[d] for d in qualified)  # money already paid as daily incentive is not paid again
            if rest > 0:
                amt = _r(rest * DAILY_WEEKLY_PCT / 100)
                weekly_total += amt
                out["weeks"].append({"from": days[0], "to": days[-1], "collection": _r(week_sum), "incentive": amt})
    out.update(mode="daily_weekly", daily_incentive=_r(daily_total), weekly_incentive=_r(weekly_total))
    out["incentive"] = _r(daily_total + weekly_total)
    out["note"] = (f"Collection ₹{total:,.2f} is between salary x{GATE_MULTIPLE} and x{TARGET_MULTIPLE}: "
                   f"daily/weekly {DAILY_WEEKLY_PCT:g}% incentives apply.")
    return out


def _email_match(email: str) -> Dict[str, Any]:
    return {"$regex": f"^{re.escape(email.strip())}$", "$options": "i"}


async def sales_user(email: Optional[str]) -> Optional[Dict[str, Any]]:
    """The login account behind an employee, if it is a sales account."""
    if not email:
        return None
    for u in await get_collection("admins").find({"email": _email_match(email)}).to_list(5):
        if u.get("is_active", True) and normalize_role(u.get("role")) == "sales":
            return u
    return None


async def month_payments(email: str, year: int, month: int) -> List[Tuple[str, float]]:
    """Payments received in the month on the (non-cancelled) invoices that name this person as sales person."""
    invoices = [i for i in await get_collection("billing_invoices").find({"sales_person_email": email.strip().lower()}).to_list(50000)
                if i.get("status") != "cancelled"]
    ids = [i["id"] for i in invoices if i.get("id")]
    if not ids:
        return []
    prefix = f"{year}-{month:02d}-"
    pays = await get_collection("billing_payments").find({"invoice_id": {"$in": ids}}).to_list(50000)
    return [(str(p["payment_date"])[:10], float(p.get("amount") or 0)) for p in pays if str(p.get("payment_date") or "").startswith(prefix)]


async def month_incentive(emp: Dict[str, Any], structure: Dict[str, Any], year: int, month: int) -> Optional[Dict[str, Any]]:
    """None for staff who are not sales accounts (they earn no collection incentive)."""
    if not await sales_user(emp.get("email")):
        return None
    payments = await month_payments(emp["email"], year, month)
    return compute_incentive(payments, monthly_salary(structure))


async def month_attendance(emp: Dict[str, Any], year: int, month: int, today: Optional[date] = None) -> Optional[Dict[str, Any]]:
    """
    The month's attendance from Start Day / End Day punches, in the shape the payroll engine takes.
    None (keep the old default of a full month) unless the employee has punches this month or is a sales
    account, so staff who don't use punches are not suddenly marked absent.
    """
    emp_id = emp.get("employee_code") or emp.get("employee_id") or str(emp.get("_id"))
    prefix = f"{year}-{month:02d}"
    records = await get_collection("attendance").find({"employee_id": emp_id, "attendance_date": {"$regex": f"^{prefix}-"}}).to_list(400)
    is_sales = bool(await sales_user(emp.get("email")))
    if not records and not is_sales:
        return None

    today = today or date.today()
    last = calendar.monthrange(year, month)[1]
    by_date = {r["attendance_date"]: r for r in records}
    leaves = [l for l in await get_collection("leave_requests").find({"employee_id": emp_id, "status": "APPROVED"}).to_list(500)
              if l.get("start_date", "") <= f"{prefix}-{last:02d}" and l.get("end_date", "") >= f"{prefix}-01"]

    def leave_on(day: str) -> Optional[Dict[str, Any]]:
        return next((l for l in leaves if l["start_date"] <= day <= l["end_date"]), None)

    present = half = absent = late = paid_leave = unpaid_leave = missed_end = offs = 0.0
    for n in range(1, last + 1):
        d = date(year, month, n)
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
            "weekly_offs": int(offs), "missed_end_day": int(missed_end), "full_days": int(present), "is_sales": is_sales}
