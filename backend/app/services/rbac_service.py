"""
Central role-based access control.

Single source of truth for:
  * the permission catalog (served to the CRM frontend via /api/rbac/catalog)
  * default grants per role (overridable by a Super Admin, persisted in `role_permissions`)
  * which permission every API route requires (ROUTE_RULES)

Every API router is mounted with `Depends(enforce)` (see main.py), so a route that is
missing from ROUTE_RULES is denied, never silently open.
"""
import logging
import time
from typing import Any, Dict, List, Optional, Set, Tuple, Union

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials

from app.database import get_collection
from app.services.auth_service import get_current_admin, security

logger = logging.getLogger("rexera.rbac")

SUPERADMIN = "superadmin"

ROLES: List[Dict[str, str]] = [
    {"id": "superadmin", "label": "Super Admin"},
    {"id": "admin", "label": "Admin / Accounting"},
    {"id": "hr", "label": "HR"},
    {"id": "legal", "label": "Legal"},
    {"id": "sales", "label": "Employee / Sales Person"},
    {"id": "support", "label": "Operation Team"},
    {"id": "it", "label": "IT"},
]
ROLE_IDS = {r["id"] for r in ROLES}

# group id -> (group label, [(permission key, label)])
CATALOG: List[Tuple[str, str, List[Tuple[str, str]]]] = [
    ("hr_workforce", "HR · Workforce", [
        ("hr.dashboard.view", "View HR dashboard"),
        ("hr.employees.view", "View employees"),
        ("hr.employees.create", "Add employees"),
        ("hr.employees.edit", "Edit employees"),
        ("hr.employees.delete", "Delete employees"),
        ("hr.employees.bank", "Reveal bank account numbers"),
        ("hr.interns.view", "View interns"),
        ("hr.interns.create", "Add interns"),
        ("hr.interns.edit", "Edit & convert interns"),
        ("hr.interns.delete", "Delete interns"),
    ]),
    ("hr_recruitment", "HR · Recruitment", [
        ("hr.recruitment.view", "View candidates"),
        ("hr.recruitment.manage", "Update candidates & issue joining tokens"),
        ("hr.recruitment.delete", "Delete candidates"),
    ]),
    ("hr_operations", "HR · Operations", [
        ("hr.attendance.view", "View attendance"),
        ("hr.attendance.edit", "Edit attendance rules & punches"),
        ("hr.leave.view", "View leave"),
        ("hr.leave.apply", "Apply leave on behalf of employees"),
        ("hr.leave.approve", "Approve or reject leave"),
        ("hr.productivity.view", "View productivity"),
        ("hr.productivity.manage", "Manage tasks, timesheets & blockers"),
        ("hr.performance.view", "View & export performance reports"),
        ("hr.broadcasts.view", "View broadcasts"),
        ("hr.broadcasts.publish", "Publish broadcasts"),
        ("hr.import.manage", "Run smart bulk imports"),
        ("hr.backup.manage", "Export & restore HR data backups"),
    ]),
    ("hr_payroll", "HR · Payroll", [
        ("hr.payroll.view", "View payroll, payslips & salary register"),
        ("hr.payroll.process", "Calculate payroll, generate & email payslips"),
        ("hr.payroll.approve", "Approve, finalize, unlock & mark payroll paid"),
        ("hr.advances.view", "View advances, loans, bonuses & overtime"),
        ("hr.advances.manage", "Issue advances, loans, bonuses & overtime"),
        ("hr.settings.manage", "Manage payroll settings, SMTP & templates"),
    ]),
    ("sales", "Sales", [
        ("sales.customers.view", "Customers"),
        ("sales.leads.view", "Leads"),
        ("sales.deals.view", "Deals"),
        ("sales.contacts.view", "Contacts"),
        ("sales.hub.view", "Sales workspace: my leads & dialer, schemes, material, team progress, day start/end"),
        ("sales.hub.manage", "Add & edit leads, schemes, flyers/material and sales information"),
    ]),
    ("legal", "Legal", [
        ("legal.view", "Contracts & cases (only clients assigned to you, unless Legal team)"),
        ("legal.manage", "Legal team: see every client, assign, approve & import"),
        ("documents.submit", "Submit client document forms (COI, GST, PAN, ITR…)"),
    ]),
    ("operations", "Operations", [
        ("finance.view", "Finance"),
        ("projects.view", "Projects"),
        ("reports.view", "Reports"),
    ]),
    ("billing", "Billing & Invoicing", [
        ("billing.view", "View invoices, quotations & billing dashboard"),
        ("billing.create", "Create & edit proforma invoices and quotations"),
        ("billing.tax_invoice", "Issue & edit tax invoices (without it, only proforma invoices)"),
        ("billing.manage", "Manage billing clients, payments & settings"),
    ]),
    ("administration", "Administration", [
        ("users.manage", "Manage users"),
        ("permissions.manage", "Manage roles & permissions"),
        ("audit.view", "View activity logs"),
        ("automations.manage", "Manage automations (scheduled emails, payroll runs, reminders)"),
    ]),
    ("workspace", "Workspace & Systems", [
        ("clients.view", "Client, project & delivery overview"),
        ("support.desk.view", "Support desk requests & messages"),
        ("it.systems.view", "Infrastructure, database & monitoring"),
        ("it.security.view", "Security & access events"),
        ("it.deployment.view", "Deployments & releases"),
        ("it.backup.manage", "Run & restore system backups"),
    ]),
]
ALL_PERMISSIONS: List[str] = [key for _, _, perms in CATALOG for key, _ in perms]
_ALL_SET = set(ALL_PERMISSIONS)

_HR_ALL = [p for p in ALL_PERMISSIONS if p.startswith("hr.")]
# Sales staff use the sales workspace but don't edit its leads/schemes/material: that is Admin & Legal.
_SALES_ALL = [p for p in ALL_PERMISSIONS if p.startswith("sales.") and p != "sales.hub.manage"]
_BILLING_ALL = ["billing.view", "billing.create", "billing.manage"]

# Existing `hr` accounts had unrestricted access in the standalone Rexera-HR app, so they
# keep every HR capability by default; a Super Admin can narrow this in Roles & Permissions.
DEFAULT_ROLE_PERMISSIONS: Dict[str, List[str]] = {
    "admin": ["users.manage", "audit.view", "hr.dashboard.view", "hr.employees.view", "hr.leave.view", "hr.leave.approve",
              *_SALES_ALL, "legal.view", "finance.view", "projects.view", "reports.view",
              "clients.view", "support.desk.view", *_BILLING_ALL, "automations.manage", "documents.submit",
              "sales.hub.manage"],
    "hr": [*_HR_ALL, *_BILLING_ALL, "billing.tax_invoice", "automations.manage", "documents.submit"],
    "legal": ["legal.view", "legal.manage", "sales.hub.view", "sales.hub.manage"],
    "sales": [*_SALES_ALL, "clients.view", "billing.view", "billing.create", "documents.submit", "hr.broadcasts.view", "hr.leave.view", "hr.attendance.view"],
    "it": ["it.systems.view", "it.security.view", "it.deployment.view", "it.backup.manage",
           "users.manage", "audit.view"],
    "support": ["support.desk.view", "clients.view", "sales.customers.view", "sales.contacts.view",
                "hr.broadcasts.view", "documents.submit"],
}

# ---------------------------------------------------------------------------
# Route rules: (METHOD, path template without trailing slash) -> requirement
#   PUBLIC        no authentication (candidate/onboarding portals, login)
#   AUTHENTICATED any signed-in account
#   "perm"        that permission; a tuple means all of them
# ---------------------------------------------------------------------------
PUBLIC = "__public__"
AUTHENTICATED = "__authenticated__"
Rule = Union[str, Tuple[str, ...]]

ROUTE_RULES: Dict[Tuple[str, str], Rule] = {
    # Authentication
    ("POST", "/api/auth/login"): PUBLIC,
    ("POST", "/api/auth/verify-2fa"): PUBLIC,
    ("POST", "/api/auth/resend-2fa-otp"): PUBLIC,
    ("POST", "/api/auth/forgot-password"): PUBLIC,
    ("POST", "/api/auth/reset-password"): PUBLIC,
    ("GET", "/api/auth/session-config"): PUBLIC,
    ("POST", "/api/auth/logout"): AUTHENTICATED,
    ("POST", "/api/auth/session-timeout"): AUTHENTICATED,
    # Public candidate / onboarding portals
    ("POST", "/api/otp/send"): PUBLIC,
    ("POST", "/api/candidates"): PUBLIC,
    ("POST", "/api/joining/validate-token"): PUBLIC,
    ("POST", "/api/joining/verify-token-otp"): PUBLIC,
    ("POST", "/api/joining/submit-onboarding"): PUBLIC,
    # RBAC & users
    ("GET", "/api/notifications"): AUTHENTICATED,  # filtered by permission inside the handler
    ("GET", "/api/rbac/me"): AUTHENTICATED,
    ("GET", "/api/rbac/catalog"): AUTHENTICATED,
    ("GET", "/api/rbac/roles"): "permissions.manage",
    ("PATCH", "/api/rbac/roles/{role}"): "permissions.manage",
    ("GET", "/api/rbac/users/{user_id}/access"): "permissions.manage",
    ("PUT", "/api/rbac/users/{user_id}/access"): "permissions.manage",
    ("GET", "/api/users"): "users.manage",
    ("POST", "/api/users"): "users.manage",
    ("PATCH", "/api/users/{user_id}"): "users.manage",
    # Role dashboards (blocks inside the payload are filtered by permission)
    ("GET", "/api/workspace/summary"): AUTHENTICATED,
    ("GET", "/api/workspace/system"): "it.systems.view",
    ("GET", "/api/workspace/desk"): "support.desk.view",
    # Dashboard & backup
    ("GET", "/api/dashboard/metrics"): "hr.dashboard.view",
    ("GET", "/api/dashboard/export-all"): "hr.backup.manage",
    ("POST", "/api/dashboard/import-all"): "hr.backup.manage",
    # Employees
    ("GET", "/api/employees"): "hr.employees.view",
    ("GET", "/api/employees/{emp_id}"): "hr.employees.view",
    ("POST", "/api/employees"): "hr.employees.create",
    ("POST", "/api/employees/bulk"): "hr.employees.create",
    ("PUT", "/api/employees/{emp_id}"): "hr.employees.edit",
    ("DELETE", "/api/employees/{emp_id}"): "hr.employees.delete",
    # Interns
    ("GET", "/api/interns"): "hr.interns.view",
    ("GET", "/api/interns/{intern_id}"): "hr.interns.view",
    ("POST", "/api/interns"): "hr.interns.create",
    ("POST", "/api/interns/bulk"): "hr.interns.create",
    ("PUT", "/api/interns/{intern_id}"): "hr.interns.edit",
    ("POST", "/api/interns/{intern_id}/convert"): ("hr.interns.edit", "hr.employees.create"),
    ("DELETE", "/api/interns/{intern_id}"): "hr.interns.delete",
    # Recruitment
    ("GET", "/api/candidates"): "hr.recruitment.view",
    ("GET", "/api/candidates/{candidate_id}"): "hr.recruitment.view",
    ("POST", "/api/candidates/bulk"): "hr.recruitment.manage",
    ("PUT", "/api/candidates/{candidate_id}"): "hr.recruitment.manage",
    ("PATCH", "/api/candidates/{candidate_id}/status"): "hr.recruitment.manage",
    ("DELETE", "/api/candidates/{candidate_id}"): "hr.recruitment.delete",
    ("POST", "/api/joining/generate-token"): "hr.recruitment.manage",
    # Attendance
    ("GET", "/api/attendance"): "hr.attendance.view",
    ("GET", "/api/attendance/config"): "hr.attendance.view",
    ("PUT", "/api/attendance/config"): "hr.attendance.edit",
    ("POST", "/api/attendance/punch-in"): "hr.attendance.edit",
    ("POST", "/api/attendance/punch-out"): "hr.attendance.edit",
    # Leave
    ("GET", "/api/leaves"): "hr.leave.view",
    ("GET", "/api/leaves/pending-dashboard"): "hr.leave.view",
    ("GET", "/api/leaves/balances/{employee_id}"): "hr.leave.view",
    ("POST", "/api/leaves/apply"): "hr.leave.apply",
    ("POST", "/api/leaves/decision"): "hr.leave.approve",
    ("POST", "/api/leaves/apply-own"): AUTHENTICATED,  # anyone requests their own leave; routing decides who approves
    # Productivity
    ("GET", "/api/productivity/clients"): "hr.productivity.view",
    ("GET", "/api/productivity/projects"): "hr.productivity.view",
    ("GET", "/api/productivity/tasks"): "hr.productivity.view",
    ("GET", "/api/productivity/dashboard/birds-eye"): "hr.productivity.view",
    ("POST", "/api/productivity/clients"): "hr.productivity.manage",
    ("POST", "/api/productivity/projects"): "hr.productivity.manage",
    ("POST", "/api/productivity/tasks"): "hr.productivity.manage",
    ("POST", "/api/productivity/tasks/quick"): "hr.productivity.manage",
    ("POST", "/api/productivity/timesheet/log"): "hr.productivity.manage",
    ("POST", "/api/productivity/tasks/flag-blocker"): "hr.productivity.manage",
    # Performance reports
    ("GET", "/api/reports/preview/individual/{employee_id}"): "hr.performance.view",
    ("GET", "/api/reports/preview/company"): "hr.performance.view",
    ("POST", "/api/reports/export-async"): "hr.performance.view",
    ("GET", "/api/reports/download/{job_id}"): "hr.performance.view",
    ("GET", "/api/reports/jobs/{job_id}"): "hr.performance.view",
    # Broadcasts (a user's own in-app feed only needs a session)
    ("GET", "/api/broadcasts"): "hr.broadcasts.view",
    ("POST", "/api/broadcasts/publish"): "hr.broadcasts.publish",
    ("POST", "/api/broadcasts/acknowledge/{broadcast_id}"): AUTHENTICATED,
    # Smart bulk import
    ("POST", "/api/bulk-import/preview-and-map"): "hr.import.manage",
    ("POST", "/api/bulk-import/execute"): "hr.import.manage",
    ("GET", "/api/bulk-import/jobs/{job_id}"): "hr.import.manage",
    ("GET", "/api/bulk-import/error-reports/{job_id}"): "hr.import.manage",
    # Payroll
    ("GET", "/api/payroll"): "hr.payroll.view",
    ("GET", "/api/payroll/record/{payroll_id}"): "hr.payroll.view",
    ("GET", "/api/payroll/dashboard-metrics"): "hr.payroll.view",
    ("GET", "/api/payroll/statement/{employee_id}/{year}"): "hr.payroll.view",
    ("GET", "/api/payroll/salary-structures/{employee_id}"): "hr.payroll.view",
    ("GET", "/api/payroll/slips"): "hr.payroll.view",
    ("GET", "/api/payroll/slip/{slip_id}"): "hr.payroll.view",
    ("GET", "/api/payroll/slip/{slip_id}/printable"): AUTHENTICATED,  # your own, or anyone's with hr.payroll.view
    ("GET", "/api/payroll/summary"): "hr.payroll.view",
    ("POST", "/api/payroll/calculate-salary"): "hr.payroll.view",
    ("GET", "/api/payroll/sales-preview"): "hr.payroll.view",
    ("PUT", "/api/payroll/salary-structures/{employee_id}"): "hr.payroll.process",
    ("POST", "/api/payroll/calculate"): "hr.payroll.process",
    ("POST", "/api/payroll/calculate-bulk"): "hr.payroll.process",
    ("PUT", "/api/payroll/record/{payroll_id}"): "hr.payroll.process",
    ("POST", "/api/payroll/record/{payroll_id}/send-email"): "hr.payroll.process",
    ("POST", "/api/payroll/send-bulk-email"): "hr.payroll.process",
    ("POST", "/api/payroll/generate-slip"): "hr.payroll.process",
    ("DELETE", "/api/payroll/slip/{slip_id}"): "hr.payroll.process",
    ("POST", "/api/payroll/adjust-salary"): "hr.payroll.process",
    ("POST", "/api/payroll/record/{payroll_id}/approve"): "hr.payroll.approve",
    ("POST", "/api/payroll/record/{payroll_id}/finalize"): "hr.payroll.approve",
    ("POST", "/api/payroll/record/{payroll_id}/unlock"): "hr.payroll.approve",
    ("POST", "/api/payroll/record/{payroll_id}/mark-paid"): "hr.payroll.approve",
    ("GET", "/api/payroll/bank-export"): "hr.payroll.approve",
    # Advances, loans, bonuses, overtime
    ("GET", "/api/advances"): "hr.advances.view",
    ("GET", "/api/loans"): "hr.advances.view",
    ("GET", "/api/bonuses"): "hr.advances.view",
    ("GET", "/api/overtime"): "hr.advances.view",
    ("POST", "/api/advances"): "hr.advances.manage",
    ("POST", "/api/advances/{advance_id}/approve"): "hr.advances.manage",
    ("POST", "/api/advances/{advance_id}/reject"): "hr.advances.manage",
    ("POST", "/api/loans"): "hr.advances.manage",
    ("POST", "/api/bonuses"): "hr.advances.manage",
    ("POST", "/api/overtime"): "hr.advances.manage",
    # Payroll settings (includes SMTP credentials)
    ("GET", "/api/payroll-settings"): "hr.settings.manage",
    ("PUT", "/api/payroll-settings"): "hr.settings.manage",
    ("POST", "/api/payroll-settings/test-smtp"): "hr.settings.manage",
    ("GET", "/api/payroll-settings/audit-logs"): "hr.settings.manage",
    ("GET", "/api/payroll-settings/email-logs"): "hr.settings.manage",
    # Activity logs
    ("GET", "/api/logs"): "audit.view",
    ("GET", "/api/logs/export"): "audit.view",
    # Billing & Invoices
    ("GET", "/api/billing/invoices"): "billing.view",
    ("GET", "/api/billing/invoices/next-number"): "billing.view",
    ("POST", "/api/billing/invoices"): "billing.create",
    ("GET", "/api/billing/invoices/{invoice_id}"): "billing.view",
    ("PUT", "/api/billing/invoices/{invoice_id}"): "billing.create",
    ("DELETE", "/api/billing/invoices/{invoice_id}"): "billing.manage",
    ("GET", "/api/billing/invoices/{invoice_id}/pdf"): "billing.view",
    ("GET", "/api/billing/quotations"): "billing.view",
    ("POST", "/api/billing/quotations"): "billing.create",
    ("GET", "/api/billing/quotations/{quotation_id}"): "billing.view",
    ("PUT", "/api/billing/quotations/{quotation_id}"): "billing.create",
    ("DELETE", "/api/billing/quotations/{quotation_id}"): "billing.manage",
    ("GET", "/api/billing/quotations/{quotation_id}/pdf"): "billing.view",
    ("POST", "/api/billing/quotations/{quotation_id}/convert"): "billing.create",
    ("GET", "/api/billing/clients"): "billing.view",
    ("POST", "/api/billing/clients"): "billing.manage",
    ("GET", "/api/billing/clients/{client_id}"): "billing.view",
    ("PUT", "/api/billing/clients/{client_id}"): "billing.manage",
    ("DELETE", "/api/billing/clients/{client_id}"): "billing.manage",
    ("GET", "/api/billing/products"): "billing.view",
    ("POST", "/api/billing/products"): "billing.manage",
    ("GET", "/api/billing/products/{product_id}"): "billing.view",
    ("PUT", "/api/billing/products/{product_id}"): "billing.manage",
    ("DELETE", "/api/billing/products/{product_id}"): "billing.manage",
    ("GET", "/api/billing/payments"): "billing.view",
    ("POST", "/api/billing/payments"): "billing.manage",
    ("GET", "/api/billing/dashboard/metrics"): "billing.view",
    ("GET", "/api/billing/reports/gstr1"): "billing.view",
    ("GET", "/api/billing/reports/aging"): "billing.view",
    ("GET", "/api/billing/sales-people"): "billing.view",
    ("GET", "/api/billing/requests"): "billing.view",
    ("POST", "/api/billing/requests"): "billing.view",
    ("GET", "/api/billing/requests/{request_id}"): "billing.view",
    ("POST", "/api/billing/requests/{request_id}/approve"): "billing.manage",
    ("POST", "/api/billing/requests/{request_id}/reject"): "billing.manage",
    ("GET", "/api/billing/documents"): "billing.view",
    ("POST", "/api/billing/documents"): "billing.manage",
    ("GET", "/api/billing/documents/{document_id}/download"): "billing.view",
    ("DELETE", "/api/billing/documents/{document_id}"): "billing.manage",
    ("DELETE", "/api/billing/payments/{payment_id}"): "billing.manage",
    ("GET", "/api/billing/export/invoices.csv"): "billing.view",
    ("GET", "/api/billing/reports/gst-register.csv"): "billing.view",
    ("GET", "/api/billing/reports/monthly"): "billing.view",
    # Legal Records & Compliance
    ("GET", "/api/legal/records"): "legal.view",
    ("POST", "/api/legal/records"): "legal.view",
    ("PATCH", "/api/legal/records/{record_id}/status"): "legal.view",
    ("GET", "/api/legal/export-missing-pdf"): "legal.view",
    ("GET", "/api/legal/records/{crm_id}/pdf"): "legal.view",
    ("GET", "/api/legal/staff"): "legal.view",
    ("POST", "/api/legal/records/import"): "legal.view",
    ("GET", "/api/legal/clients"): "legal.view",
    ("PUT", "/api/legal/clients/{kind}/{item_id}/assign"): "legal.view",
    ("PATCH", "/api/legal/clients/{kind}/{item_id}/status"): "legal.view",
    ("GET", "/api/legal/assigned/mine"): AUTHENTICATED,  # every user sees what Legal assigned to them
    # Client document forms (staff submit, Legal reviews)
    ("POST", "/api/client-documents"): "documents.submit",
    ("GET", "/api/client-documents/mine"): "documents.submit",
    ("GET", "/api/client-documents"): "legal.view",
    ("GET", "/api/client-documents/{submission_id}"): "legal.view",
    ("GET", "/api/client-documents/{submission_id}/files/{file_id}"): "legal.view",
    ("PATCH", "/api/client-documents/{submission_id}/status"): "legal.view",
    # Sales workspace (sales staff use it; Admin & Legal manage its content)
    ("GET", "/api/sales-hub/summary"): "sales.hub.view",
    ("POST", "/api/sales-hub/day/start"): "sales.hub.view",
    ("POST", "/api/sales-hub/day/end"): "sales.hub.view",
    ("GET", "/api/sales-hub/attendance"): "sales.hub.view",
    ("GET", "/api/sales-hub/progress"): "sales.hub.view",
    ("POST", "/api/sales-hub/leads/{lead_id}/calls"): "sales.hub.view",
    ("GET", "/api/sales-hub/leads/{lead_id}/calls"): "sales.hub.view",
    ("GET", "/api/sales-hub/materials/{material_id}/file"): "sales.hub.view",
    ("GET", "/api/sales-hub/assignees"): "sales.hub.manage",
    ("GET", "/api/sales-hub/leads"): "sales.hub.manage",
    ("POST", "/api/sales-hub/leads"): "sales.hub.view",
    ("POST", "/api/sales-hub/leads/import"): "sales.hub.manage",
    ("PUT", "/api/sales-hub/leads/{lead_id}"): "sales.hub.manage",
    ("DELETE", "/api/sales-hub/leads/{lead_id}"): "sales.hub.manage",
    ("GET", "/api/sales-hub/schemes"): "sales.hub.manage",
    ("POST", "/api/sales-hub/schemes"): "sales.hub.manage",
    ("PUT", "/api/sales-hub/schemes/{scheme_id}"): "sales.hub.manage",
    ("DELETE", "/api/sales-hub/schemes/{scheme_id}"): "sales.hub.manage",
    ("GET", "/api/sales-hub/materials"): "sales.hub.manage",
    ("POST", "/api/sales-hub/materials"): "sales.hub.manage",
    ("PUT", "/api/sales-hub/materials/{material_id}"): "sales.hub.manage",
    ("DELETE", "/api/sales-hub/materials/{material_id}"): "sales.hub.manage",
    # Automations
    ("GET", "/api/automations"): "automations.manage",
    ("PUT", "/api/automations/settings"): "automations.manage",
    ("GET", "/api/automations/runs"): "automations.manage",
    ("PUT", "/api/automations/{automation_id}"): "automations.manage",
    ("POST", "/api/automations/{automation_id}/run"): "automations.manage",
}

# Extra permission when a query flag widens what a route returns.
QUERY_RULES: Dict[Tuple[str, str], Dict[str, str]] = {
    ("GET", "/api/employees/{emp_id}"): {"unmask": "hr.employees.bank"},
    ("GET", "/api/interns/{intern_id}"): {"unmask": "hr.employees.bank"},
}

# ---------------------------------------------------------------------------
# Role -> permission resolution
# ---------------------------------------------------------------------------
_CACHE_TTL_SECONDS = 30
# ponytail: per-process cache; with several workers a change can lag up to the TTL on the others.
_cache: Dict[str, Tuple[float, Set[str]]] = {}


# There are exactly seven user types (ROLES). Accounts saved under an older name keep working:
# "employee" was merged into Employee / Sales Person, "operations" is the Operation Team's id.
ROLE_ALIASES = {"employee": "sales", "operations": "support"}


def normalize_role(role: Optional[str]) -> str:
    r = (role or "").strip().lower()
    return ROLE_ALIASES.get(r, r)


async def get_role_permissions(role: Optional[str]) -> Set[str]:
    role = normalize_role(role)
    if role == SUPERADMIN:
        return set(_ALL_SET)
    if role not in ROLE_IDS:
        return set()  # unknown roles get nothing (fail closed)

    cached = _cache.get(role)
    if cached and cached[0] > time.monotonic():
        return cached[1]

    doc = await get_collection("role_permissions").find_one({"role": role})
    granted = doc["permissions"] if doc else DEFAULT_ROLE_PERMISSIONS.get(role, [])
    perms = {p for p in granted if p in _ALL_SET and not reserved_blocked(p, [role])}
    _cache[role] = (time.monotonic() + _CACHE_TTL_SECONDS, perms)
    return perms


# Rules tied to a role that no setting can change: not the role matrix, not a per-user Allow.
# A reserved permission only ever takes effect for someone who holds one of these roles
# (their own role, or an additional role a Super Admin gave them).
ROLE_RESERVED_PERMISSIONS: Dict[str, Set[str]] = {
    # Adding and editing schemes, flyers/posts, sales information and leads: sales staff only view them.
    "sales.hub.manage": {"superadmin", "admin", "legal"},
    # Everyone's salaries, payslips and the salary register. Staff still open their own payslip.
    "hr.payroll.view": {"superadmin", "admin", "hr"},
    "hr.payroll.process": {"superadmin", "admin", "hr"},
    "hr.payroll.approve": {"superadmin", "admin", "hr"},
}
# Everyone else sees only their own attendance, whatever permissions they hold.
FULL_ATTENDANCE_ROLES = {"superadmin", "admin", "hr"}


def reserved_blocked(permission: str, roles) -> bool:
    allowed = ROLE_RESERVED_PERMISSIONS.get(permission)
    return allowed is not None and not (set(roles) & allowed)


def sees_all_attendance(user: Optional[Dict[str, Any]]) -> bool:
    return bool(set(user_roles(user)) & FULL_ATTENDANCE_ROLES)


def user_roles(user: Optional[Dict[str, Any]]) -> List[str]:
    """A user's roles, primary first: the account's role plus any extra roles a Super Admin gave them."""
    out: List[str] = []
    for r in [(user or {}).get("role"), *((user or {}).get("extra_roles") or [])]:
        r = normalize_role(r)
        if r in ROLE_IDS and r not in out:
            out.append(r)
    return out


def has_role(user: Optional[Dict[str, Any]], role: str) -> bool:
    return role in user_roles(user)


async def get_user_permissions(user: Optional[Dict[str, Any]]) -> Set[str]:
    """Everything this account may do: the union of all its roles, plus per-user allows, minus per-user denies.

    Super Admin always has everything. Roles are read live (30 s cache); the overrides live on the account itself,
    so a change applies on the user's next request.
    """
    roles = user_roles(user)
    if SUPERADMIN in roles:
        return set(_ALL_SET)
    perms: Set[str] = set()
    for r in roles:
        perms |= await get_role_permissions(r)
    perms |= {p for p in ((user or {}).get("grants") or []) if p in _ALL_SET}
    perms -= set((user or {}).get("denies") or [])
    return {p for p in perms if not reserved_blocked(p, roles)}


async def get_role_matrix() -> Dict[str, List[str]]:
    return {r["id"]: sorted(await get_role_permissions(r["id"])) for r in ROLES}


async def set_role_permission(role: str, permission: str, granted: bool, actor: str) -> List[str]:
    role = normalize_role(role)
    if role == SUPERADMIN:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Super Admin always has full access.")
    if role not in ROLE_IDS:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Unknown role.")
    if permission not in _ALL_SET:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unknown permission.")
    if granted and reserved_blocked(permission, [role]):
        who = ", ".join(next(r["label"] for r in ROLES if r["id"] == x) for x in sorted(ROLE_RESERVED_PERMISSIONS[permission]))
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"This permission is reserved for {who}; it can't be given to this role.")

    current = set(await get_role_permissions(role))
    if granted:
        current.add(permission)
    else:
        current.discard(permission)
    ordered = [p for p in ALL_PERMISSIONS if p in current]

    await get_collection("role_permissions").update_one(
        {"role": role},
        {"$set": {"role": role, "permissions": ordered, "updated_by": actor, "updated_at": time.time()}},
        upsert=True,
    )
    _cache.pop(role, None)
    return ordered


def catalog_payload() -> Dict[str, Any]:
    return {
        "roles": ROLES,
        "reserved": {p: sorted(r) for p, r in ROLE_RESERVED_PERMISSIONS.items()},
        "groups": [
            {"id": gid, "label": label, "permissions": [{"key": k, "label": l} for k, l in perms]}
            for gid, label, perms in CATALOG
        ],
    }


# ---------------------------------------------------------------------------
# Enforcement
# ---------------------------------------------------------------------------
def _route_key(request: Request) -> Tuple[str, str]:
    route = request.scope.get("route")
    path = getattr(route, "path", None) or request.url.path
    method = "GET" if request.method == "HEAD" else request.method
    return method, (path.rstrip("/") or "/")


async def enforce(request: Request, credentials: Optional[HTTPAuthorizationCredentials] = Depends(security)):
    key = _route_key(request)
    rule = ROUTE_RULES.get(key)
    if rule is None:
        logger.error(f"Denied {key}: no access rule defined")
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="This endpoint has no access rule.")
    if rule == PUBLIC:
        return None

    admin = await get_current_admin(request, credentials)
    if rule == AUTHENTICATED:
        return admin

    required = [rule] if isinstance(rule, str) else list(rule)
    for flag, perm in QUERY_RULES.get(key, {}).items():
        if request.query_params.get(flag, "").lower() in ("1", "true", "yes"):
            required.append(perm)

    granted = await get_user_permissions(admin)
    missing = [p for p in required if p not in granted]
    if missing:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You don't have permission to perform this action.")
    return admin


def check_route_coverage(routers) -> None:
    """Log every API route that has no rule (it will be denied at runtime)."""
    for router in routers:
        for route in router.routes:
            path = route.path.rstrip("/")
            for method in route.methods:
                if method != "HEAD" and (method, path) not in ROUTE_RULES:
                    logger.error(f"RBAC: no access rule for {method} {path} — it will be denied")
