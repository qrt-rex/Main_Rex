"""
Sales performance: the collection scorecard / leaderboard (day, week or month), each sales person's
own figures, the Excel / PDF download and the incentive rules. Every number comes from
sales_payroll, the same incentive engine payroll and payslips use.

Salaries are HR-only, so without payroll access a viewer sees other people's collections and rank
but not their monthly target or incentive (both reveal the salary); their own row is always complete.
"""
import io
from datetime import date
from typing import Any, Dict, List, Literal, Optional

import openpyxl
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from openpyxl.styles import Font
from pydantic import BaseModel, Field, model_validator
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

from app.database import get_collection
from app.services import sales_payroll as sp
from app.services.auth_service import get_current_admin
from app.services.rbac_service import get_user_permissions
from app.utils.validators import MONTH_NAMES

router = APIRouter(prefix="/api/sales-performance", tags=["Sales performance"])
Period = Literal["day", "week", "month"]
PERIOD_LABEL = {"day": "Daily", "week": "Weekly", "month": "Monthly"}
INCENTIVE_KEYS = ("eligible", "target_met", "eligibility", "slab_percent", "daily_incentive", "weekly_incentive",
                  "monthly_incentive", "incentive", "gate_amount", "target_amount", "target_achievement", "note")


def _day(value: Optional[str]) -> date:
    try:
        return date.fromisoformat(value) if value else date.today()
    except ValueError:
        raise HTTPException(status_code=422, detail="Use a date like 2026-09-30.")


def _totals(items: List[Dict[str, Any]]) -> Dict[str, Any]:
    return {"gross_collection": round(sum(x["gross"] for x in items), 2), "dsc_deduction": round(sum(x["dsc"] for x in items), 2),
            "net_collection": round(sum(x["net"] for x in items), 2), "payments": len(items)}


def _between(items: List[Dict[str, Any]], start: date, end: date) -> List[Dict[str, Any]]:
    return [x for x in items if start.isoformat() <= x["date"] <= end.isoformat()]


async def build_scorecard(period: str, day: date, department: str = "") -> Dict[str, Any]:
    """Every sales person's collections for the period, ranked by net collection, with their month's incentive."""
    start, end = sp.period_range(period, day)
    m_start, m_end = sp.month_range(day.year, day.month)
    cfg = await sp.get_config()
    people = await sp.sales_people()
    got = await sp.collections(min(start, m_start), max(end, m_end))
    rows = []
    for p in people:
        if department and p["department"] != department:
            continue
        mine = got.get(p["email"], [])
        totals = _totals(_between(mine, start, end))
        inc = sp.compute_incentive(_between(mine, m_start, m_end), p["salary"], cfg)
        target = {"day": cfg["daily_threshold"], "week": cfg["weekly_threshold"]}.get(period, inc["target_amount"])
        rows.append({**{k: p[k] for k in ("email", "name", "employee_id", "employee_code", "department")}, **totals,
                     "target": target, "achievement": round(totals["net_collection"] / target * 100, 1) if target else 0.0,
                     "incentive": {k: inc[k] for k in INCENTIVE_KEYS}})
    rows.sort(key=lambda r: (-r["net_collection"], r["name"].lower()))
    for i, r in enumerate(rows, 1):
        r["rank"] = i
    return {"period": period, "from": start.isoformat(), "to": end.isoformat(), "month": f"{MONTH_NAMES[day.month - 1]} {day.year}",
            "rows": rows, "departments": sorted({p["department"] for p in people}), "config_version": cfg["version"]}


@router.get("/scorecard")
async def scorecard(period: Period = "month", date_: Optional[str] = Query(None, alias="date"), department: str = "",
                    admin: Dict[str, Any] = Depends(get_current_admin)):
    day = _day(date_)
    board = await build_scorecard(period, day, department)
    perms = await get_user_permissions(admin)
    me = str(admin.get("email") or "").strip().lower()
    if "hr.payroll.view" in perms:
        # Where each person's payroll for the month stands, so HR sees what a recalculation would change.
        month_name = MONTH_NAMES[day.month - 1]
        payrolls = {str(p.get("employee_id")): p for p in
                    await get_collection("payrolls").find({"month": month_name, "year": day.year}).to_list(10000)}
        for r in board["rows"]:
            rec = payrolls.get(r["employee_id"])
            r["payroll"] = {"id": str(rec["_id"]), "status": rec.get("status"), "locked": bool(rec.get("is_locked")),
                            "incentive": (rec.get("earnings") or {}).get("incentive", 0.0)} if rec else None
    else:
        for r in board["rows"]:
            if r["email"] != me:
                r["incentive"] = None
                if period == "month":
                    r["target"] = r["achievement"] = None
    board["can_export"] = "sales.scorecard.export" in perms
    return board


@router.get("/me")
async def my_performance(date_: Optional[str] = Query(None, alias="date"), admin: Dict[str, Any] = Depends(get_current_admin)):
    """The signed-in sales person's collections today / this week / this month and the month's incentive."""
    day, me = _day(date_), str(admin.get("email") or "").strip().lower()
    person = next((p for p in await sp.sales_people() if p["email"] == me), None)
    if not person:
        return {"is_sales": False}
    w_start, w_end = sp.period_range("week", day)
    m_start, m_end = sp.month_range(day.year, day.month)
    mine = (await sp.collections(min(w_start, m_start), max(w_end, m_end), me)).get(me, [])
    cfg = await sp.get_config()
    return {"is_sales": True, "name": person["name"], "date": day.isoformat(), "month": f"{MONTH_NAMES[day.month - 1]} {day.year}",
            "today": _totals(_between(mine, day, day)), "week": _totals(_between(mine, w_start, w_end)),
            "month_totals": _totals(_between(mine, m_start, m_end)),
            "incentive": sp.compute_incentive(_between(mine, m_start, m_end), person["salary"], cfg),
            "rules": {k: cfg[k] for k in ("daily_threshold", "daily_percent", "weekly_threshold", "weekly_percent",
                                          "eligibility_multiplier", "target_multiplier", "dsc_amount")}}


@router.get("/export")
async def export_scorecard(period: Period = "month", date_: Optional[str] = Query(None, alias="date"), department: str = "",
                           format: Literal["xlsx", "pdf"] = "xlsx", admin: Dict[str, Any] = Depends(get_current_admin)):
    board = await build_scorecard(period, _day(date_), department)
    title = f"Sales scorecard - {PERIOD_LABEL[period]}, {board['from']} to {board['to']}" + (f" - {department}" if department else "")
    header = ["Rank", "Employee", "Code", "Department", "Gross collection", "DSC", "Net collection", "Target", "Achievement %",
              f"Eligibility ({board['month']})", "Daily incentive", "Weekly incentive", "Monthly incentive", "Total incentive"]
    lines = [[r["rank"], r["name"], r["employee_code"], r["department"], r["gross_collection"], r["dsc_deduction"],
              r["net_collection"], r["target"], r["achievement"], r["incentive"]["eligibility"]["status"],
              r["incentive"]["daily_incentive"], r["incentive"]["weekly_incentive"], r["incentive"]["monthly_incentive"],
              r["incentive"]["incentive"]] for r in board["rows"]]
    buf = io.BytesIO()
    if format == "xlsx":
        wb = openpyxl.Workbook()
        ws = wb.active
        ws.title = "Scorecard"
        ws.append([title])
        ws["A1"].font = Font(bold=True, size=13)
        ws.append(header)
        for cell in ws[2]:
            cell.font = Font(bold=True)
        for line in lines:
            ws.append(line)
        wb.save(buf)
        media = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    else:
        money = lambda v: f"{v:,.2f}"  # noqa: E731
        body = [[str(x) if i in (0, 1, 2, 3, 9) else (f"{x}%" if i == 8 else money(x)) for i, x in enumerate(line)] for line in lines]
        table = Table([header] + body, repeatRows=1)
        table.setStyle(TableStyle([("FONTSIZE", (0, 0), (-1, -1), 7), ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1e3a8a")),
                                   ("TEXTCOLOR", (0, 0), (-1, 0), colors.white), ("GRID", (0, 0), (-1, -1), 0.25, colors.grey),
                                   ("ALIGN", (4, 1), (-1, -1), "RIGHT")]))
        doc = SimpleDocTemplate(buf, pagesize=landscape(A4), leftMargin=20, rightMargin=20, topMargin=24, bottomMargin=24)
        doc.build([Paragraph(title, getSampleStyleSheet()["Heading2"]), Spacer(1, 8), table])
        media = "application/pdf"
    buf.seek(0)
    return StreamingResponse(buf, media_type=media, headers={
        "Content-Disposition": f'attachment; filename="sales-scorecard-{period}-{board["from"]}.{format}"'})


# ---- Incentive rules (HR) and DSC amount (Super Admin) ----

class Slab(BaseModel):
    min: float = Field(ge=0)
    max: Optional[float] = Field(default=None, gt=0)
    percent: float = Field(ge=0, le=100)
    active: bool = True

    @model_validator(mode="after")
    def _range(self):
        if self.max is not None and self.max <= self.min:
            raise ValueError(f"A slab's upper limit ({self.max:,.0f}) must be more than its lower limit ({self.min:,.0f}).")
        return self


class IncentiveRules(BaseModel):
    daily_threshold: float = Field(gt=0)
    daily_percent: float = Field(ge=0, le=100)
    weekly_threshold: float = Field(gt=0)
    weekly_percent: float = Field(ge=0, le=100)
    eligibility_multiplier: float = Field(gt=0, le=100)
    target_multiplier: float = Field(gt=0, le=100)
    slabs: List[Slab] = Field(min_length=1, max_length=30)

    @model_validator(mode="after")
    def _no_overlap(self):
        self.slabs.sort(key=lambda s: s.min)
        active = [s for s in self.slabs if s.active]
        for a, b in zip(active, active[1:]):
            if a.max is None or a.max > b.min:
                raise ValueError(f"Active slabs overlap: the one from {a.min:,.0f} runs past {b.min:,.0f}.")
        return self


class DscAmount(BaseModel):
    dsc_amount: float = Field(ge=0, le=1_000_000)


def _actor(admin: Dict[str, Any]) -> str:
    return admin.get("email") or admin.get("username") or "admin"


@router.get("/config")
async def get_config(admin: Dict[str, Any] = Depends(get_current_admin)):
    return await sp.get_config()


@router.put("/config")
async def update_rules(rules: IncentiveRules, admin: Dict[str, Any] = Depends(get_current_admin)):
    """The DSC amount is not part of this: only a Super Admin changes it, through /config/dsc."""
    return await sp.save_config(rules.model_dump(), _actor(admin))


@router.put("/config/dsc")
async def update_dsc(body: DscAmount, admin: Dict[str, Any] = Depends(get_current_admin)):
    return await sp.save_config({"dsc_amount": round(body.dsc_amount, 2)}, _actor(admin))
