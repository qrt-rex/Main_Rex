# Rex CRM

Rexera's internal CRM: HR, payroll, attendance and leave, sales, billing and invoicing, legal, and
administration, behind one sign-in. There is one backend (FastAPI + PostgreSQL) and one web app
(React). Roles never mean separate servers: they only decide what each signed-in person may see and do.

```
backend/                FastAPI API (one process serves every module)
  app/main.py           app, routers, serves the built web app
  app/routers/          one file per module (HTTP endpoints)
  app/services/         business logic (payroll, leave, attendance, billing rules, notifications…)
  app/schemas/          request / response models and validation
  app/utils/            shared helpers (security, validators, sanitising, number-to-words)
  app/config.py         settings, read from backend/.env
  app/database.py       PostgreSQL document store (JSONB tables)
  app/seed.py           first-run accounts and reference data
  logo.png, stamp.png   images used on payslips
frontend/               React 19 + TypeScript + Vite + Tailwind
  src/App.tsx           routes
  src/modules/registry.ts   every page, its path and the permission that shows it
  src/auth/ src/hr/ src/billing/ src/sales/ src/dashboards/ src/pages/ src/components/ src/lib/
QA_TESTING.md           latest QA report
```

---

## Run it

### Backend

```bash
cd backend
pip install -r requirements.txt
copy .env.example .env        # then fill it in (see Configuration)
python -m uvicorn app.main:app --port 8000
```

Check <http://127.0.0.1:8000/api/health>: it reports the database schema it connected to.
API documentation is at `/docs` whenever `APP_ENV` is not `production`.

### Web app: two ways

**One process (simplest).** Build the web app once; the backend then serves it on its own port:

```bash
cd frontend
npm install
npm run build
```

Open <http://127.0.0.1:8000>. Rebuild after frontend changes. HTML is sent with `no-cache`, so a
refresh always shows the latest build.

**Development server (while changing the frontend).** This gives hot reload on port 5173 and talks
to the API on `http://localhost:8000`:

```bash
cd frontend
npm run dev
```

To point it at another API, set `VITE_API_BASE_URL` in `frontend/.env.local` and restart Vite.

### Other commands

```bash
cd frontend && npx tsc -b      # type-check
cd frontend && npm run lint    # oxlint
cd backend && python -m pyflakes app
```

### Deploy on Render

One Render web service runs everything. The backend serves the API and the built web app.

| Setting | Value |
|---|---|
| Root Directory | empty (repository root) |
| Build Command | `pip install -r backend/requirements.txt && cd frontend && npm ci && npm run build` |
| Start Command | `cd backend && uvicorn app.main:app --host 0.0.0.0 --port $PORT` |

Set these environment variables:

- `PYTHON_VERSION` (e.g. `3.11.9`) and `NODE_VERSION=22`
- the backend settings (see Configuration), because `backend/.env` is not uploaded
- `APP_ENV=production`, `EMAIL_DEV_MODE=False` and your own `JWT_SECRET_KEY` (the server refuses to start in
  production without them)
- `COMPANY_WEBSITE` set to the service's address (reset and joining links use it)

Add that address to the Google OAuth client's allowed JavaScript origins.

---

## Configuration (`backend/.env`)

`backend/.env.example` lists every setting. The important ones:

| Setting | Purpose |
|---|---|
| `POSTGRES_URI` | PostgreSQL connection (`postgresql+asyncpg://…`). `DB_SCHEMA` picks the schema (default `hr_rexera`). |
| `JWT_SECRET_KEY` | Signs sessions. **Set a long random value in production**: with `APP_ENV=production` the server refuses to start if it is the default or shorter than 32 characters. |
| `SMTP_*` / `BREVO_API_KEY` | Outgoing email: sign-in codes, leave decisions, payslips, broadcasts. |
| `EMAIL_DEV_MODE` | `True` shows sign-in codes on screen instead of emailing them. **Use `False` in production** (the server refuses to start in production otherwise). |
| `COMPANY_WEBSITE` | Address the app is served from. Joining emails link to `{COMPANY_WEBSITE}/joining`, and password reset emails to `{COMPANY_WEBSITE}/reset-password` (or to an address in `CORS_ORIGINS`, or localhost, when the request came from there). |
| `CORS_ORIGINS` | Allowed browser origins, e.g. `["*"]` or `["http://localhost:5173"]`. |
| `DEFAULT_ADMIN_*` | The Super Admin account created on first start. |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | *Sign in with Google*. It is off, and its button hidden, while `GOOGLE_CLIENT_ID` is empty. Only Google tokens issued to that client ID and accounts on the domains in `ALLOWED_GOOGLE_DOMAINS` (rexera.co.in, rexera.in, rexera.com) are accepted. |

---

## User types and access

There are seven user types:

| User type | id | Lands on |
|---|---|---|
| Super Admin | `superadmin` | `/dashboard/admin` (may open any dashboard) |
| Admin / Accounting | `admin` | `/dashboard/admin` |
| HR | `hr` | `/dashboard/hr` |
| Legal | `legal` | `/dashboard/legal` |
| Employee / Sales Person | `sales` | `/dashboard/sales` |
| Operation Team | `support` | `/dashboard/support` |
| IT | `it` | `/dashboard/it` |

Accounts saved under the older name `employee` are read as Employee / Sales Person.

People sign in at `/login` in one of two ways:

- email, password and a 6-digit code sent to their email
- *Sign in with Google* using a Rexera Workspace account

*Forgot password* emails a reset link that opens `/reset-password`.

- **Roles & permissions** (`/admin/permissions`): a Super Admin decides what each user type can do.
  Changes apply within 30 seconds and are enforced by the server on every request.
- **One person's access** (`/admin/users` → row menu → *Manage access*):
  - *Additional roles*: the person also gets everything those roles can do.
  - *Allow* adds a single feature; *Deny* removes one.
  - Effective access is all roles, plus Allow, minus Deny.
  - Nobody can change their own access, Super Admins can't be edited, and non-Super Admins can only
    give access they hold themselves.
- **Fixed rules**: no setting can change these, not the role matrix, a per-person Allow, or an old
  saved setting:
  - **Schemes, flyers/posts, sales information and lead management** are for Admin / Accounting,
    Legal and Super Admin. Employees / Sales Persons view them and are notified when new ones appear.
  - **Salaries** (payroll register, all payslips, running and approving payroll) are for HR,
    Admin / Accounting and Super Admin. Everyone can open **their own** payslip from their dashboard.
  - **Attendance is private**: only HR, Admin / Accounting and Super Admin see other people's
    attendance; everyone else sees only their own.
- A page a person has no access to does not appear anywhere, and opening its address shows "not
  found". The API refuses the underlying requests independently of the web app. Every API route has
  an access rule in `backend/app/services/rbac_service.py`; a route without one is refused.

---

## Modules

| Module | Where | Highlights |
|---|---|---|
| Dashboards | `/dashboard` | One per user type; pending approvals, own leave, own payslip, company updates |
| Notifications | the bell, `/notifications` | Requests waiting on you, outcomes of your requests, broadcasts with **Acknowledge**, new schemes/material/leads |
| Employees & interns | `/hr/employees`, `/hr/interns` | Directory, profiles, bulk import |
| Recruitment | `/hr/recruitment` | Candidate pipeline, joining tokens |
| Attendance | `/hr/attendance` | Today / Yesterday / This week / This month filters, counts per status and per employee |
| Leave | `/hr/leave` | *Request my leave*; balances; approvals routed by role (below) |
| Payroll & payslips | `/hr/payroll`, `/hr/payslips` | Calculation, approval, locking, bank export, payslips, sales incentive |
| Broadcasts | `/hr/broadcasts` | Company announcements, optional acknowledgement with live counts |
| Productivity & performance | `/hr/productivity`, `/hr/performance` | Tasks, timesheets, blockers, scorecards |
| Sales workspace | `/sales/hub`, sales dashboard | Leads and dialer, Start / End Day, schemes, flyers/posts, sales information, team progress |
| Billing & invoicing | `/billing` | Tax and proforma invoices, quotations, requests, clients, payments, GSTR-1, reports, documents |
| Legal | `/legal` | Client records, assignments, approvals, client document forms |
| Administration | `/admin/users`, `/admin/permissions`, `/admin/activity`, `/admin/automations` | Accounts, access, activity log, scheduled automations |
| Public pages | `/apply`, `/joining` | Candidate application and new-joiner onboarding, no sign-in |

### Leave approval

Anyone signed in can request their own leave. If they have no employee record, their login is used.

| Who asks | Who approves |
|---|---|
| Employee / Sales Person, Legal, Operation Team, IT | HR (Admin / Accounting or Super Admin may also decide) |
| HR | Admin / Accounting or Super Admin |
| Admin / Accounting | Super Admin |

Nobody decides their own request. Approved leave is marked on attendance and used by payroll.

### Attendance and payroll

- **Start Day / End Day** in the Sales workspace records the punch in and punch out. The shift rules
  decide the status:
  - on time: Present
  - after the grace time: Late
  - very late, or logging out before the early-logout cutoff: Half Day
- **When a payslip is calculated**, the month is built from these punches and approved leave:
  - A day started but not ended counts as a half day.
  - A working day with no punch and no leave counts as absent.
  - Sundays are paid days off.
- **Sales collection incentive**, from payments received on invoices that name the person as sales
  person. Salary = monthly standard gross.

| Collection in the month | Incentive |
|---|---|
| Below salary ×3 | None |
| Salary ×3 up to ×4 | 5 % of each day with ₹10,000 or more collected, plus 5 % of each Mon–Sun week with ₹50,000 or more (money already paid daily is not paid again) |
| Salary ×4 or more | Monthly slab on the whole month's collection instead: under ₹2L 20 %, ₹2–3L 25 %, ₹3–4L 27.5 %, ₹4–5L 30 %, ₹5–6L 32.5 %, ₹6–7L 35 %, ₹7–8L 37.5 %, ₹8L+ 40 % |

### Billing rules

- **Tax invoices** are issued by HR (and Super Admin) by default (`billing.tax_invoice`).
- **Proforma invoices and quotations** can be created by anyone with billing create access
  (Employee / Sales Person, HR, Admin).
- **Payments, clients, deletes and approving requests** need billing manage access.
- **GST**: Gujarat supplies get CGST + SGST; other states get IGST. Each line is taxed at its own rate.
- **Numbering**: invoice numbers run per branch and financial year.

---

## Quality

See **[QA_TESTING.md](QA_TESTING.md)** for the latest QA cycle. It covers:

- the 300-case backend suite
- an access-control sweep of every API route for every user type
- a screen sweep of every page for every user type
- static analysis
- defects found and fixed
- open recommendations

The automated test suite is not kept in this repository; the QA report says where a copy is archived.
