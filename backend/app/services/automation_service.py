"""
CRM automations: scheduled jobs HR switches on and configures in Administration > Automations.

Every automation is off until someone enables it, and each one only acts on work that appeared
after it was enabled or that it has not handled before (tracked on the records themselves), so
switching one on never floods employees or clients with messages about old records.

Payroll automation stops at CALCULATED: approving and paying salaries stays with HR.
"""
import asyncio
import calendar
import html
import logging
from datetime import date, datetime, timedelta
from typing import Any, Awaitable, Callable, Dict, List, Optional

import pytz

from app.config import settings
from app.database import get_collection
from app.services.email_service import EmailService

logger = logging.getLogger("rexera.automations")

MONTHS = list(calendar.month_name)[1:]
GLOBAL_ID = "_global"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def tz():
    return pytz.timezone(settings.AUTOMATION_TIMEZONE)


def now_local() -> datetime:
    return datetime.now(tz())


def _parse_utc(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(str(value))
    except ValueError:
        return None
    return pytz.utc.localize(dt) if dt.tzinfo is None else dt


def _date(value: Any) -> Optional[date]:
    try:
        return date.fromisoformat(str(value)[:10])
    except (TypeError, ValueError):
        return None


def _money(v: Any) -> str:
    return f"₹{float(v or 0):,.2f}"


def _e(v: Any) -> str:
    return html.escape(str(v if v is not None else ""))


def email_html(heading: str, body: str) -> str:
    """Shared layout for automated emails. `body` must already be escaped HTML."""
    return f"""<div style="font-family:Segoe UI,Arial,sans-serif;background:#f8fafc;padding:20px;color:#1e293b">
<div style="max-width:620px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden">
<div style="background:#09234b;color:#fff;padding:18px 22px"><h2 style="margin:0;font-size:18px">{_e(heading)}</h2></div>
<div style="padding:20px 22px;font-size:14px;line-height:1.6">{body}</div>
<div style="background:#f1f5f9;padding:12px 22px;font-size:11px;color:#64748b">{_e(settings.COMPANY_NAME)} · automated message</div>
</div></div>"""


def table_html(headers: List[str], rows: List[List[Any]]) -> str:
    th = "".join(f'<th style="text-align:left;padding:6px 8px;border-bottom:1px solid #e2e8f0">{_e(h)}</th>' for h in headers)
    trs = "".join("<tr>" + "".join(f'<td style="padding:6px 8px;border-bottom:1px solid #f1f5f9">{_e(c)}</td>' for c in r) + "</tr>" for r in rows)
    return f'<table style="border-collapse:collapse;width:100%;font-size:13px"><thead><tr>{th}</tr></thead><tbody>{trs}</tbody></table>'


async def send(to: Optional[str], subject: str, heading: str, body: str) -> bool:
    if not to:
        return False
    ok, err = await EmailService.send_email(to_email=to, subject=subject, html_content=email_html(heading, body))
    if not ok:
        logger.warning(f"Automation email to {to} failed: {err}")
    return ok


class Ctx:
    """What a handler gets: its options, when it was switched on, the notification addresses."""

    def __init__(self, options: Dict[str, Any], enabled_at: Optional[datetime], hr_email: str, accounts_email: str):
        self.options = options
        self.enabled_at = enabled_at
        self.hr_email = hr_email
        self.accounts_email = accounts_email
        self.now = now_local()
        self.today = self.now.date()

    def opt(self, key: str, default: Any) -> Any:
        value = self.options.get(key)
        return default if value in (None, "") else value

    def after_enabled(self, value: Optional[str]) -> bool:
        """True when a UTC timestamp is later than the moment the automation was switched on."""
        ts = _parse_utc(value)
        return bool(ts and (self.enabled_at is None or ts >= self.enabled_at))


Handler = Callable[[Ctx], Awaitable[str]]


# ---------------------------------------------------------------------------
# Payroll
# ---------------------------------------------------------------------------
async def payroll_monthly_run(ctx: Ctx) -> str:
    from app.schemas.advanced_payroll import BulkPayrollRunRequest
    from app.services.payroll_service import PayrollService

    month, year = MONTHS[ctx.today.month - 1], ctx.today.year
    existing = await get_collection("payrolls").find({"month": month, "year": year}).to_list(10000)
    done = {str(p.get("employee_id")) for p in existing}
    active = await get_collection("employees").find({"employee_status": "Active"}).to_list(10000)
    pending = [str(e["_id"]) for e in active if str(e["_id"]) not in done]
    if not pending:
        return f"Payroll for {month} {year} already exists for every active employee."
    # Only employees without a record: HR's edits to existing records are never recalculated away.
    res = await PayrollService.run_advanced_bulk_payroll(
        BulkPayrollRunRequest(month=month, year=year, employee_ids=pending, auto_approve=False),
        user_email="automation")
    msg = f"Calculated {month} {year} payroll for {res['successful_count']} employee(s); awaiting HR approval."
    if res["failed_count"]:
        msg += f" {res['failed_count']} failed: " + "; ".join(f"{f['employee_name']} ({f['reason']})" for f in res["failed"][:5])
    rows = [[s["employee_code"], s["employee_name"], _money(s["net_salary"])] for s in res["successful"]]
    if rows:
        await send(ctx.hr_email, f"Payroll calculated for {month} {year} - approval needed", "Payroll ready for approval",
                   f"<p>{_e(msg)}</p>{table_html(['Code', 'Employee', 'Net pay'], rows)}")
    return msg


async def payslip_email(ctx: Ctx) -> str:
    from app.services.pdf_service import PDFService
    from app.services.payroll_service import PayrollService

    col = get_collection("payrolls")
    records = await col.find({"status": {"$in": ["FINALIZED", "PAID"]}}).to_list(10000)
    # Only payrolls finalized after this was switched on: old payslips are never mailed out in bulk.
    due = [r for r in records if not r.get("email_sent") and ctx.after_enabled(r.get("locked_at"))]
    sent = failed = 0
    for rec in due:
        payroll = await PayrollService.get_payroll_by_id(str(rec["_id"]))
        if not payroll:
            continue
        res = await EmailService.send_payslip_email(employee_id=payroll["employee_id"], payroll_record=payroll,
                                                    payslip_html=PDFService.generate_salary_slip_html(payroll))
        if res.get("success"):
            sent += 1
            await col.update_one({"_id": rec["_id"]}, {"$set": {"email_sent": True, "email_sent_at": datetime.utcnow().isoformat()}})
        else:
            failed += 1
    return f"Emailed {sent} payslip(s)" + (f", {failed} failed (see Payroll settings > delivery logs)." if failed else ".")


async def payroll_approval_reminder(ctx: Ctx) -> str:
    records = await get_collection("payrolls").find({"status": {"$in": ["CALCULATED", "UNDER_REVIEW", "APPROVED"]}}).to_list(10000)
    if not records:
        return "No payroll waiting for approval."
    rows = [[f"{r.get('month')} {r.get('year')}", r.get("employee_name"), r.get("status"), _money(r.get("net_salary"))] for r in records]
    await send(ctx.hr_email, f"{len(records)} payroll record(s) waiting for approval", "Payroll waiting for action",
               f"<p>These payroll records are not finalized yet. Approve and finalize them in HR &gt; Payroll.</p>"
               f"{table_html(['Month', 'Employee', 'Status', 'Net pay'], rows)}")
    return f"Reminded HR about {len(records)} payroll record(s)."


# ---------------------------------------------------------------------------
# Billing
# ---------------------------------------------------------------------------
async def invoice_reminders(ctx: Ctx) -> str:
    before_days = int(ctx.opt("days_before_due", 3))
    overdue_steps = sorted({int(x) for x in str(ctx.opt("overdue_days", "1,7,15,30")).split(",") if x.strip().isdigit()})
    col = get_collection("billing_invoices")
    invoices = await col.find({"balance_amount": {"$gt": 0}}).to_list(10000)
    sent = 0
    for inv in invoices:
        if inv.get("status") == "cancelled" or inv.get("invoice_type", "invoice") != "invoice":
            continue
        client = inv.get("client") or {}
        due = _date(inv.get("due_date"))
        if not client.get("email") or not due:
            continue
        days = (ctx.today - due).days  # negative: not due yet
        stage = None
        if days < 0 and -days <= before_days:
            stage = "before"
        elif days == 0:
            stage = "due"
        elif days > 0:
            reached = [s for s in overdue_steps if days >= s]
            stage = f"overdue-{reached[-1]}" if reached else None
        done = inv.get("automation_reminders") or []
        if not stage or stage in done:
            continue
        # A late start sends one reminder for the latest step, never every missed step.
        if stage.startswith("overdue") and any(d.startswith("overdue") and int(d.split("-")[1]) >= int(stage.split("-")[1]) for d in done):
            continue
        bank = (inv.get("branch") or {}).get("bank_details") or {}
        when = {"before": f"is due on {due:%d %b %Y}", "due": "is due today"}.get(stage, f"was due on {due:%d %b %Y} ({days} days ago)")
        body = (f"<p>Dear {_e(client.get('contact_person') or client.get('name'))},</p>"
                f"<p>This is a reminder that invoice <b>{_e(inv.get('invoice_number'))}</b> {_e(when)}. "
                f"The balance due is <b>{_e(_money(inv.get('balance_amount')))}</b> of {_e(_money(inv.get('grand_total')))}.</p>"
                + (f"<p>Bank: {_e(bank.get('account_name'))}, A/C {_e(bank.get('account_number'))}, IFSC {_e(bank.get('ifsc_code'))}"
                   + (f", UPI {_e(bank.get('upi_id'))}" if bank.get("upi_id") else "") + "</p>" if bank else "")
                + "<p>If you have already paid, please ignore this message.</p>")
        subject = f"{'Payment reminder' if stage != 'before' else 'Upcoming payment'}: invoice {inv.get('invoice_number')}"
        if await send(client["email"], subject, "Payment reminder", body):
            sent += 1
            await col.update_one({"_id": inv["_id"]}, {"$set": {"automation_reminders": done + [stage]}})
    return f"Sent {sent} invoice reminder(s)."


async def quotation_expiry(ctx: Ctx) -> str:
    col = get_collection("billing_quotations")
    expired = 0
    for q in await col.find({"status": {"$in": ["draft", "sent"]}}).to_list(10000):
        valid = _date(q.get("valid_until"))
        if valid and valid < ctx.today:
            await col.update_one({"_id": q["_id"]}, {"$set": {"status": "expired", "updated_at": datetime.utcnow().isoformat()}})
            expired += 1
    return f"Marked {expired} quotation(s) as expired."


async def billing_summary(ctx: Ctx) -> str:
    invoices = [i for i in await get_collection("billing_invoices").find({"balance_amount": {"$gt": 0}}).to_list(10000)
                if i.get("status") != "cancelled" and i.get("invoice_type", "invoice") == "invoice"]
    if not invoices:
        return "No outstanding invoices."
    overdue = [i for i in invoices if (_date(i.get("due_date")) or ctx.today) < ctx.today]
    total = sum(float(i.get("balance_amount") or 0) for i in invoices)
    rows = [[i.get("invoice_number"), (i.get("client") or {}).get("name"), i.get("due_date"), _money(i.get("balance_amount"))]
            for i in sorted(overdue, key=lambda i: str(i.get("due_date")))[:50]]
    body = (f"<p>Outstanding: <b>{_e(_money(total))}</b> across {len(invoices)} invoice(s); "
            f"<b>{len(overdue)}</b> overdue.</p>" + (table_html(["Invoice", "Client", "Due", "Balance"], rows) if rows else ""))
    await send(ctx.accounts_email, f"Receivables summary {ctx.today:%d %b %Y}", "Daily receivables summary", body)
    return f"Summary sent: {len(invoices)} outstanding, {len(overdue)} overdue."


# ---------------------------------------------------------------------------
# HR
# ---------------------------------------------------------------------------
async def celebrations(ctx: Ctx) -> str:
    emp_col = get_collection("employees")
    employees = await emp_col.find({"employee_status": {"$in": ["Active", "Probation"]}}).to_list(10000)
    subs = {str(s.get("employee_id")): s for s in await get_collection("onboarding_submissions").find({}).to_list(10000)}
    year, sent = str(ctx.today.year), 0
    for emp in employees:
        if not emp.get("email"):
            continue
        wishes = dict(emp.get("automation_wishes") or {})
        dob = _date(emp.get("date_of_birth") or (subs.get(str(emp["_id"])) or {}).get("date_of_birth"))
        doj = _date(emp.get("date_of_joining"))
        name = _e(emp.get("full_name"))
        if dob and (dob.month, dob.day) == (ctx.today.month, ctx.today.day) and wishes.get("birthday") != year:
            if await send(emp["email"], f"Happy Birthday, {emp.get('full_name')}!", "Happy Birthday!",
                          f"<p>Dear {name},</p><p>Everyone at {_e(settings.COMPANY_NAME)} wishes you a very happy birthday "
                          f"and a wonderful year ahead!</p>"):
                wishes["birthday"], sent = year, sent + 1
        if doj and doj.year < ctx.today.year and (doj.month, doj.day) == (ctx.today.month, ctx.today.day) and wishes.get("anniversary") != year:
            years = ctx.today.year - doj.year
            if await send(emp["email"], f"Happy {years}-year work anniversary!", "Happy work anniversary!",
                          f"<p>Dear {name},</p><p>Congratulations on completing <b>{years} year{'s' if years > 1 else ''}</b> "
                          f"with {_e(settings.COMPANY_NAME)}. Thank you for everything you do!</p>"):
                wishes["anniversary"], sent = year, sent + 1
        if wishes != (emp.get("automation_wishes") or {}):
            await emp_col.update_one({"_id": emp["_id"]}, {"$set": {"automation_wishes": wishes}})
    return f"Sent {sent} birthday/anniversary wish(es)."


def _add_months(d: date, months: int) -> date:
    m = d.month - 1 + months
    y, m = d.year + m // 12, m % 12 + 1
    return date(y, m, min(d.day, calendar.monthrange(y, m)[1]))


async def probation_intern_alerts(ctx: Ctx) -> str:
    window = int(ctx.opt("days_ahead", 7))
    months = int(ctx.opt("probation_months", 6))
    rows, marks = [], []
    emp_col, intern_col = get_collection("employees"), get_collection("interns")
    for emp in await emp_col.find({"employee_status": "Probation"}).to_list(10000):
        doj = _date(emp.get("date_of_joining"))
        if not doj:
            continue
        end = _add_months(doj, months)
        if 0 <= (end - ctx.today).days <= window and emp.get("automation_probation_alert") != end.isoformat():
            rows.append(["Probation ends", emp.get("full_name"), emp.get("employee_code"), f"{end:%d %b %Y}"])
            marks.append((emp_col, emp["_id"], "automation_probation_alert", end.isoformat()))
    for intern in await intern_col.find({"status": "Ongoing"}).to_list(10000):
        end = _date(intern.get("end_date"))
        if end and 0 <= (end - ctx.today).days <= window and intern.get("automation_end_alert") != end.isoformat():
            rows.append(["Internship ends", intern.get("full_name"), intern.get("intern_code"), f"{end:%d %b %Y}"])
            marks.append((intern_col, intern["_id"], "automation_end_alert", end.isoformat()))
    if not rows:
        return "No probations or internships ending soon."
    if await send(ctx.hr_email, f"{len(rows)} probation/internship end date(s) coming up", "Upcoming end dates",
                  f"<p>Review these before their end date (confirm, extend or convert).</p>"
                  f"{table_html(['Event', 'Name', 'Code', 'Date'], rows)}"):
        for col, _id, field, value in marks:
            await col.update_one({"_id": _id}, {"$set": {field: value}})
    return f"Alerted HR about {len(rows)} end date(s)."


async def pending_leave_reminder(ctx: Ctx) -> str:
    older_than = int(ctx.opt("pending_days", 2))
    cutoff = datetime.utcnow() - timedelta(days=older_than)
    pending = []
    for lv in await get_collection("leave_requests").find({"status": "PENDING"}).to_list(10000):
        created = _parse_utc(lv.get("created_at"))
        if created and created.replace(tzinfo=None) <= cutoff:
            pending.append(lv)
    if not pending:
        return f"No leave requests pending for more than {older_than} day(s)."
    rows = [[lv.get("employee_name"), lv.get("leave_type"), f"{lv.get('start_date')} to {lv.get('end_date')}", lv.get("total_days")] for lv in pending]
    await send(ctx.hr_email, f"{len(pending)} leave request(s) waiting for a decision", "Leave requests waiting",
               f"<p>These requests have been pending for more than {older_than} day(s). Decide them in HR &gt; Leave.</p>"
               f"{table_html(['Employee', 'Type', 'Dates', 'Days'], rows)}")
    return f"Reminded HR about {len(pending)} pending leave request(s)."


# ---------------------------------------------------------------------------
# Recruitment & onboarding
# ---------------------------------------------------------------------------
async def auto_joining_link(ctx: Ctx) -> str:
    from app.routers.joining import generate_joining_token
    from app.schemas.joining import GenerateTokenRequest

    tokens = await get_collection("joining_tokens").find({}).to_list(20000)
    has_token = {str(t.get("candidate_id")) for t in tokens if t.get("candidate_id")}
    issued, skipped = 0, 0
    for cand in await get_collection("candidates").find({"status": "Selected"}).to_list(10000):
        cid = str(cand["_id"])
        # Only candidates selected after this was switched on; older ones are left to HR.
        if cid in has_token or not ctx.after_enabled(cand.get("updated_at")):
            continue
        if not cand.get("email"):
            skipped += 1
            continue
        await generate_joining_token(GenerateTokenRequest(
            candidate_id=cid, full_name=cand.get("candidate_name") or "Candidate", email=cand["email"],
            department=cand.get("department") or ctx.opt("default_department", "SALES"),
            designation=cand.get("position_applied") or "Associate",
            expires_in_days=int(ctx.opt("link_valid_days", 7))), admin={"email": "automation"})
        issued += 1
    return f"Sent {issued} joining link(s)." + (f" {skipped} selected candidate(s) have no email." if skipped else "")


async def onboarding_reminders(ctx: Ctx) -> str:
    every = int(ctx.opt("remind_every_days", 2))
    col = get_collection("joining_tokens")
    now = datetime.utcnow()
    reminded, expired = 0, []
    for tok in await col.find({"used": False}).to_list(20000):
        exp = _parse_utc(tok.get("expires_at"))
        if exp and exp.replace(tzinfo=None) < now:
            if not tok.get("automation_expired"):
                expired.append(tok)
                await col.update_one({"_id": tok["_id"]}, {"$set": {"automation_expired": True}})
            continue
        last = _parse_utc(tok.get("automation_reminded_at") or tok.get("created_at"))
        if last and now - last.replace(tzinfo=None) >= timedelta(days=every) and tok.get("email"):
            portal = f"{settings.COMPANY_WEBSITE}/joining"
            if await send(tok["email"], f"Reminder: complete your Rexera onboarding ({tok.get('token')})", "Complete your onboarding",
                          f"<p>Dear {_e(tok.get('full_name'))},</p><p>Your onboarding is not complete yet. Use joining token "
                          f"<b>{_e(tok.get('token'))}</b> on the <a href=\"{_e(portal)}\">onboarding portal</a> before "
                          f"{_e(str(tok.get('expires_at'))[:10])}.</p>"):
                reminded += 1
                await col.update_one({"_id": tok["_id"]}, {"$set": {"automation_reminded_at": now.isoformat()}})
    if expired:
        await send(ctx.hr_email, f"{len(expired)} joining link(s) expired unused", "Joining links expired",
                   "<p>These candidates did not complete onboarding before their link expired. Issue a new link from "
                   "HR &gt; Recruitment if they are still joining.</p>"
                   + table_html(["Candidate", "Email", "Token", "Expired"],
                                [[t.get("full_name"), t.get("email"), t.get("token"), str(t.get("expires_at"))[:10]] for t in expired]))
    return f"Sent {reminded} onboarding reminder(s); {len(expired)} link(s) expired."


# ---------------------------------------------------------------------------
# Registry
# ---------------------------------------------------------------------------
AUTOMATIONS: List[Dict[str, Any]] = [
    {"id": "payroll_monthly_run", "category": "Payroll", "label": "Monthly payroll run",
     "description": "Calculates this month's payroll for every active employee who doesn't have one yet, then emails HR the list to approve. Existing records (and HR's edits) are left untouched.",
     "schedule": {"type": "monthly", "day": 28, "time": "10:00"}, "handler": payroll_monthly_run},
    {"id": "payslip_email", "category": "Payroll", "label": "Email payslips",
     "description": "Emails each employee their payslip once their payroll is finalized. Only payrolls finalized after you switch this on are sent.",
     "schedule": {"type": "interval", "minutes": 60}, "handler": payslip_email},
    {"id": "payroll_approval_reminder", "category": "Payroll", "label": "Payroll approval reminder",
     "description": "Emails HR a list of payroll records that are calculated but not yet finalized.",
     "schedule": {"type": "daily", "time": "10:00"}, "handler": payroll_approval_reminder},
    {"id": "invoice_reminders", "category": "Billing", "label": "Invoice payment reminders",
     "description": "Emails clients before an invoice is due, on the due date and at set days after it (one email per step). Only tax invoices with a client email.",
     "schedule": {"type": "daily", "time": "10:30"}, "handler": invoice_reminders,
     "options": [{"key": "days_before_due", "label": "Remind days before due", "type": "number", "default": 3},
                 {"key": "overdue_days", "label": "Overdue reminder days (comma separated)", "type": "text", "default": "1,7,15,30"}]},
    {"id": "quotation_expiry", "category": "Billing", "label": "Expire old quotations",
     "description": "Marks draft or sent quotations as expired once their valid-until date has passed.",
     "schedule": {"type": "daily", "time": "00:30"}, "handler": quotation_expiry},
    {"id": "billing_summary", "category": "Billing", "label": "Daily receivables summary",
     "description": "Emails accounts the total outstanding and the list of overdue invoices.",
     "schedule": {"type": "daily", "time": "09:30"}, "handler": billing_summary},
    {"id": "celebrations", "category": "HR", "label": "Birthday & work-anniversary wishes",
     "description": "Emails employees on their birthday (from their onboarding details) and on each work anniversary.",
     "schedule": {"type": "daily", "time": "09:00"}, "handler": celebrations},
    {"id": "probation_intern_alerts", "category": "HR", "label": "Probation & internship end alerts",
     "description": "Emails HR once when an employee's probation or an intern's internship is about to end.",
     "schedule": {"type": "daily", "time": "09:15"}, "handler": probation_intern_alerts,
     "options": [{"key": "days_ahead", "label": "Alert days ahead", "type": "number", "default": 7},
                 {"key": "probation_months", "label": "Probation length (months)", "type": "number", "default": 6}]},
    {"id": "pending_leave_reminder", "category": "HR", "label": "Pending leave reminder",
     "description": "Emails HR the leave requests that have waited too long for a decision.",
     "schedule": {"type": "daily", "time": "11:00"}, "handler": pending_leave_reminder,
     "options": [{"key": "pending_days", "label": "Remind after (days pending)", "type": "number", "default": 2}]},
    {"id": "auto_joining_link", "category": "Recruitment", "label": "Send joining link on selection",
     "description": "When a candidate is marked Selected, issues their joining token and emails the onboarding link. Only candidates selected after you switch this on.",
     "schedule": {"type": "interval", "minutes": 30}, "handler": auto_joining_link,
     "options": [{"key": "default_department", "label": "Department when the candidate has none", "type": "text", "default": "SALES"},
                 {"key": "link_valid_days", "label": "Link valid for (days)", "type": "number", "default": 7}]},
    {"id": "onboarding_reminders", "category": "Recruitment", "label": "Onboarding reminders",
     "description": "Reminds candidates who haven't completed onboarding, and tells HR when an unused joining link expires.",
     "schedule": {"type": "daily", "time": "10:15"}, "handler": onboarding_reminders,
     "options": [{"key": "remind_every_days", "label": "Remind every (days)", "type": "number", "default": 2}]},
]
BY_ID = {a["id"]: a for a in AUTOMATIONS}


class AutomationService:
    _locks: Dict[str, asyncio.Lock] = {}

    @staticmethod
    def _col():
        return get_collection("automations")

    @classmethod
    async def global_settings(cls) -> Dict[str, str]:
        doc = await cls._col().find_one({"automation_id": GLOBAL_ID}) or {}
        payroll = await get_collection("payroll_settings").find_one({"type": "company_settings"}) or {}
        fallback = payroll.get("company_email") or settings.COMPANY_EMAIL
        return {"hr_email": doc.get("hr_email") or fallback, "accounts_email": doc.get("accounts_email") or fallback}

    @classmethod
    async def save_global_settings(cls, hr_email: str, accounts_email: str) -> Dict[str, str]:
        await cls._col().update_one({"automation_id": GLOBAL_ID},
                                    {"$set": {"automation_id": GLOBAL_ID, "hr_email": hr_email, "accounts_email": accounts_email}},
                                    upsert=True)
        return await cls.global_settings()

    @classmethod
    async def state(cls, automation_id: str) -> Dict[str, Any]:
        spec = BY_ID[automation_id]
        doc = await cls._col().find_one({"automation_id": automation_id}) or {}
        return {
            "id": automation_id, "category": spec["category"], "label": spec["label"], "description": spec["description"],
            "enabled": bool(doc.get("enabled", False)),
            "schedule": {**spec["schedule"], **(doc.get("schedule") or {})},
            "options": [{**o, "value": (doc.get("options") or {}).get(o["key"], o["default"])} for o in spec.get("options", [])],
            "enabled_at": doc.get("enabled_at"), "last_run_at": doc.get("last_run_at"),
            "last_status": doc.get("last_status"), "last_message": doc.get("last_message"),
        }

    @classmethod
    async def list_all(cls) -> List[Dict[str, Any]]:
        return [await cls.state(a["id"]) for a in AUTOMATIONS]

    @classmethod
    async def update(cls, automation_id: str, enabled: bool, schedule: Dict[str, Any], options: Dict[str, Any]) -> Dict[str, Any]:
        spec = BY_ID[automation_id]
        doc = await cls._col().find_one({"automation_id": automation_id}) or {}
        allowed = {o["key"]: o for o in spec.get("options", [])}
        clean_opts = {k: v for k, v in options.items() if k in allowed}
        changes: Dict[str, Any] = {"automation_id": automation_id, "enabled": enabled,
                                   "schedule": {k: v for k, v in schedule.items() if k in spec["schedule"]},
                                   "options": {**(doc.get("options") or {}), **clean_opts},
                                   "updated_at": datetime.utcnow().isoformat()}
        if enabled and not doc.get("enabled"):
            # "Only new work" and the next scheduled run are measured from this moment.
            changes["enabled_at"] = datetime.utcnow().isoformat()
        await cls._col().update_one({"automation_id": automation_id}, {"$set": changes}, upsert=True)
        return await cls.state(automation_id)

    @classmethod
    async def run(cls, automation_id: str, trigger: str = "manual") -> Dict[str, Any]:
        spec = BY_ID[automation_id]
        lock = cls._locks.setdefault(automation_id, asyncio.Lock())
        if lock.locked():
            raise ValueError("This automation is already running.")
        async with lock:
            doc = await cls._col().find_one({"automation_id": automation_id}) or {}
            glob = await cls.global_settings()
            ctx = Ctx(doc.get("options") or {}, _parse_utc(doc.get("enabled_at")), glob["hr_email"], glob["accounts_email"])
            started = datetime.utcnow().isoformat()
            try:
                message, status = await spec["handler"](ctx), "success"
            except Exception as e:  # a failing job must never stop the scheduler
                logger.exception(f"Automation {automation_id} failed")
                message, status = f"Failed: {e}", "failed"
            finished = datetime.utcnow().isoformat()
            await cls._col().update_one({"automation_id": automation_id},
                                        {"$set": {"automation_id": automation_id, "last_run_at": finished,
                                                  "last_status": status, "last_message": message}}, upsert=True)
            run = {"automation_id": automation_id, "label": spec["label"], "trigger": trigger, "status": status,
                   "message": message, "started_at": started, "finished_at": finished}
            await get_collection("automation_runs").insert_one(dict(run))
            return run

    @classmethod
    async def runs(cls, limit: int = 100) -> List[Dict[str, Any]]:
        docs = await get_collection("automation_runs").find({}).sort("finished_at", -1).to_list(limit)
        return [{k: v for k, v in d.items() if k != "_id"} | {"id": str(d["_id"])} for d in docs]

    # ------------------------------------------------------------------ scheduling
    @staticmethod
    def is_due(state: Dict[str, Any], now: datetime) -> bool:
        if not state["enabled"]:
            return False
        ref = _parse_utc(state.get("last_run_at")) or _parse_utc(state.get("enabled_at"))
        if ref is None:
            return False
        sched = state["schedule"]
        if sched.get("type") == "interval":
            return now - ref >= timedelta(minutes=max(5, int(sched.get("minutes") or 60)))
        try:
            hour, minute = (int(x) for x in str(sched.get("time") or "09:00").split(":")[:2])
        except ValueError:
            hour, minute = 9, 0
        slot = now.replace(hour=hour, minute=minute, second=0, microsecond=0)
        if sched.get("type") == "monthly":
            day = min(max(1, int(sched.get("day") or 1)), calendar.monthrange(now.year, now.month)[1])
            slot = slot.replace(day=day)
        # Due once the slot has passed, and only if nothing ran since that slot.
        return slot <= now and ref < slot

    @classmethod
    async def tick(cls) -> List[str]:
        now = now_local()
        ran = []
        for spec in AUTOMATIONS:
            state = await cls.state(spec["id"])
            if cls.is_due(state, now):
                await cls.run(spec["id"], trigger="schedule")
                ran.append(spec["id"])
        return ran

    @classmethod
    async def scheduler_loop(cls, interval_seconds: int = 60):
        logger.info("Automation scheduler started.")
        while True:
            try:
                await cls.tick()
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception("Automation scheduler tick failed")
            await asyncio.sleep(interval_seconds)
