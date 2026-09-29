# Rex CRM

React 19 + TypeScript + Vite frontend and a FastAPI + PostgreSQL backend for the Rex CRM: HR,
payroll, sales, legal, billing and the role-based dashboards behind a single sign-in.

```
frontend/   React app (Vite). Modules live in src/hr, src/billing, src/dashboards ...
backend/    FastAPI API (app/routers, app/services, app/schemas) and its tests (tests/)
docs/       QA report and the original Rexera-HR readme
```

---

## Running the servers

Two processes are needed: the API first, then the frontend. Each command keeps running in
the terminal that started it.

### 1. Backend API

Install once: `cd backend && pip install -r requirements.txt`, then copy `.env.example` to `.env`.

Production schema (`hr_rexera`, from `backend/.env`), port 8000:

```bash
cd backend && python -m uvicorn app.main:app --port 8000
```

Isolated development schema (`hr_rexera_dev`), port 8010. It writes nothing to production
data, seeds sample records, and simulates outbound email so the 6-digit sign-in code is
shown on screen instead of being emailed:

```powershell
$env:DB_SCHEMA='hr_rexera_dev'; $env:SEED_DUMMY_DATA='true'; $env:EMAIL_DEV_MODE='True'; cd backend; python -m uvicorn app.main:app --port 8010
```

Check it is up at <http://127.0.0.1:8010/api/health> — the response names the schema it
connected to.

### 2. Frontend

```bash
cd frontend && npm install && npm run dev
```

Vite serves <http://localhost:5173> by default. To pin the port and point at the dev API:

```powershell
$env:VITE_API_BASE_URL='http://localhost:8010'; cd frontend; npx vite --port 5180 --strictPort
```

`VITE_API_BASE_URL` (in `frontend/.env` or `.env.local`) decides which API the app talks to
(8000 = production data, 8010 = dev schema). Restart Vite after changing it — the value is
read at startup.

### Stopping the servers

Press `Ctrl+C` in the terminal running each one. If a server was started in the background
or its terminal is gone, stop it by port:

```powershell
Get-NetTCPConnection -LocalPort 5180 -State Listen | Select-Object -ExpandProperty OwningProcess | Sort-Object -Unique | ForEach-Object { Stop-Process -Id $_ -Force }
```

Use `8010` (or `8000`, `5173`) for the other servers. To confirm nothing is left listening:

```powershell
Get-NetTCPConnection -LocalPort 8000,8010,5173,5180 -State Listen -ErrorAction SilentlyContinue | Select-Object LocalPort, OwningProcess
```

---

## Where to find the dashboards

Sign in once at **`/login`** — there is no separate login per role. After the password and
the 6-digit code, the CRM reads your role and sends you to your own dashboard.

| Role | Dashboard URL | What it shows |
|---|---|---|
| Super Admin, Admin | `/dashboard/admin` | Workforce, payroll, pipeline, users, access, activity |
| IT Department | `/dashboard/it` | Infrastructure, database, security, deployment, monitoring, backup, user logs |
| Sales Person | `/dashboard/sales` | Clients, active work, delivery progress, sales modules |
| Support | `/dashboard/support` | Open client requests, pending work, clients, announcements |
| Employee | `/dashboard/employee` | Own profile, tasks, leave, payslip, company updates |
| HR, Legal | `/dashboard/hr`, `/dashboard/legal` | Permission-driven workspace for that role |

`/dashboard` always redirects to the dashboard your role owns. Opening another role's URL
sends you back to your own (a Super Admin may open any of them), and the API enforces the
same permissions on the data itself.

### Related screens

| Screen | URL |
|---|---|
| HR module overview | `/hr` |
| Attendance | `/hr/attendance` |
| Leave | `/hr/leave` |
| Payslips (generate / register) | `/hr/payslips` |
| Billing & Invoicing | `/billing` |
| Users and accounts | `/admin/users` |
| Roles and permissions | `/admin/permissions` |
| Activity log | `/admin/activity` |
| API documentation | `http://127.0.0.1:8010/docs` |

---

## Roles and permissions

Roles and permissions live in `backend/app/services/rbac_service.py` (`ROLES`, `CATALOG`,
`DEFAULT_ROLE_PERMISSIONS`, `ROUTE_RULES`). A Super Admin can change any role's permissions
at **`/admin/permissions`** without a code change; it takes effect within 30 seconds.
Saved role settings override the code defaults, so after a default changes in code, check
the role in that screen too.

### One backend for everything

There is a single API process (`backend/`, one `uvicorn app.main:app`). HR, payroll, sales,
legal, billing, users and roles are all routers of that one app, and the React frontend
talks only to it. Roles never mean separate servers: they only decide what each signed-in
account may see and do. (Ports 8000 and 8010 are the same backend pointed at production or
the dev schema, not two services.)

### Access for one person (Users > Manage access)

Besides changing a whole role, a Super Admin (or anyone with `permissions.manage`) can shape
one account at **`/admin/users`** > row menu > **Manage access**:

- **Additional roles** — the person keeps their own role and also gets everything the ticked
  roles can do. Example: an Employee given *Sales* and *Admin* gets employee access, sales
  access and admin access together.
- **Feature access** — for any single feature choose *Inherit* (follow their roles), *Allow*
  (add it) or *Deny* (remove it even if a role has it). Deny always wins.

Effective access = all of the person's roles, plus *Allow*, minus *Deny*. It is stored on the
account (`extra_roles`, `grants`, `denies`), enforced by the server on every request, and takes
effect on their next request. It is written to the activity log. Super Admin accounts cannot
be edited, nobody can change their own access, and an editor who is not a Super Admin can only
hand out access they hold themselves. The dashboard stays the one for the person's own role;
they may also open the dashboards of their additional roles (e.g. `/dashboard/sales`).
Business rules that used to look at the account's single role (sales person on invoices,
sales incentive, leave routing) now consider all of their roles; leave goes to the most
senior approver among them.

API: `GET/PUT /api/rbac/users/{id}/access`; `GET /api/rbac/me` returns the combined permissions.

An entity a role has no permission for is not rendered at all — no locked or dimmed cards.
Unauthorised URLs show the 404 page, and the API refuses the underlying request
independently of the frontend. Every API route needs a rule in `ROUTE_RULES`; a route
without one is denied.

---

## Billing & Invoicing (`/billing`)

Code: `backend/app/routers/billing.py`, `frontend/src/billing/`.

| Tab | What it does |
|---|---|
| Invoices | Search, filter, PDF, record payment, delete, **Export CSV** |
| Create Invoice | GST tax invoices and proforma invoices, numbered per branch and financial year |
| Requests | A billing user asks for an invoice; a manager approves (opens Create Invoice pre-filled) or rejects |
| Quotations | Draft, send, convert to a tax invoice |
| Clients / Payments | Client directory; payment ledger with **Remove payment** (puts the amount back on the balance) |
| GSTR & Reports | GSTR-1 summary, ageing, **monthly summary** and per-month **GST register CSV** |
| Documents | Shared rate cards, brochures and templates (5 MB each; always downloaded, never rendered inline) |

**Who can issue what.** Anyone with `billing.create` (Sales, HR, Admin) can create proforma
invoices and quotations. **Tax invoices are HR only**: the `billing.tax_invoice` permission
is required to create or edit one and to convert a quotation or approve a request into one.
Super Admin has every permission. Payments, clients, settings and deletes need `billing.manage`.

**Sales person on an invoice.** Create Invoice has a *Sales Person* field. Payments received
on that invoice count as that person's collection for the incentive below. A sales user's
own invoice defaults to themselves; only a billing manager can change it afterwards.

---

## Attendance (`/hr/attendance`)

- **Start Day / End Day** in the Sales workspace is the attendance punch-in / punch-out
  (`backend/app/routers/sales_hub.py`). The employee record is matched by login email. Field
  staff skip the office GPS/IP check. The shift rules in Attendance settings decide the
  status: on time = Present, after the grace time = Late, after the late cutoff or logging
  out before the early-logout cutoff = Half Day.
- **Filters:** Today, Yesterday, This week (Monday to today), This month, a single date, or
  All time, plus an employee filter. The API takes `date_from` / `date_to` (inclusive);
  `date_str` and `month` still work.
- **Counts:** the page shows how many Present, Late, Half day, Absent and On leave records
  fall in the range, and for multi-day ranges a *Days counted per employee* table with hours.

## Leave and approval routing (`/hr/leave`)

Anyone can **Request my leave** (it uses the employee record with the same email as their
login). Who approves is decided by the applicant's role:

| Applicant | Approved by |
|---|---|
| Sales, employees and other staff | HR (an Admin or Super Admin may also decide) |
| HR | Admin or Super Admin |
| Admin | Super Admin |

Nobody can decide their own request (a Super Admin excepted). Approvers see only the
requests they may decide in *Pending approval*; everyone else sees only their own history
and balances. New requests email HR, or every Admin / Super Admin for HR-level leave.
HR can still file leave on behalf of an employee with *Apply for an employee*; routing then
follows that employee's role. Approved leave becomes `ON_LEAVE` attendance and feeds payroll.

## Payslips, attendance and sales incentive

Code: `backend/app/services/payroll_service.py`, `backend/app/services/sales_payroll.py`.

**Attendance in payroll.** When a payslip is calculated without attendance typed in, the
month is built from the Start Day / End Day punches and approved leave:
full day = paid; half day (including a day started but never ended) = half a day's
deduction; a working day with no punch, no leave = absent; Sundays are paid weekly offs;
future days are not penalised. Staff with no punches and no sales account keep the old
full-month default. Attendance typed into the request always wins.

**Sales collection incentive.** For sales accounts the payslip adds a *Sales Incentive*
from client payments received in the month on invoices that name them as sales person.
"Monthly salary" is the standard gross of the salary structure.

| Collection in the month | Incentive |
|---|---|
| Below salary x3 | None |
| Salary x3 up to salary x4 | 5% daily and weekly: a day with ₹10,000 or more collected pays 5% of that day; a week (Mon–Sun) with ₹50,000 or more pays 5% of the week's money not already paid as daily |
| Salary x4 or more | Monthly slab % of the whole month's collection **instead of** daily/weekly |

Monthly slabs: under ₹2L 20%, ₹2–3L 25%, ₹3–4L 27.5%, ₹4–5L 30%, ₹5–6L 32.5%,
₹6–7L 35%, ₹7–8L 37.5%, ₹8L and above 40%.

The payslip form shows a *Sales attendance & incentive* card before you generate. HR can
override the incentive by typing an amount in the payroll request. `GET
/api/payroll/sales-preview` returns the same figures.

---

## Tests

```bash
cd backend && python -m pytest -q
```

Two tests fail on the existing code and are unrelated to the features above:
`test_attendance_leave.py::test_reject_and_approved_leave_shows_in_attendance` (expects the
username `admin`, the seeded one is `superadmin`) and `test_sales_hub.py::test_sales_person_flow`
(Sales is expected to be unable to manage schemes but holds `sales.hub.manage` by default).

## Other commands

Type-check and lint the frontend:

```bash
cd frontend && npx tsc -b && npx oxlint src
```

Production build (writes to `frontend/dist/`):

```bash
cd frontend && npm run build
```
