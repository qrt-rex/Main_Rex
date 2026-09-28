# Rex CRM

React 19 + TypeScript + Vite frontend for the Rex CRM, with the Rexera-HR module and the
role-based dashboards integrated into one application behind a single sign-in.

- **Frontend:** this folder (`D:\Main Rex`)
- **Backend:** `C:\Users\dhair\Downloads\rex-hr\Rexera-HR\backend` (FastAPI + PostgreSQL)

---

## Running the servers

Two processes are needed: the API first, then the frontend. Each command keeps running in
the terminal that started it.

### 1. Backend API

Production schema (`hr_rexera`), port 8000:

```bash
cd "C:\Users\dhair\Downloads\rex-hr\Rexera-HR\backend" && python -m uvicorn app.main:app --port 8000
```

Isolated development schema (`hr_rexera_dev`), port 8010. It writes nothing to production
data, seeds sample records, and simulates outbound email so the 6-digit sign-in code is
shown on screen instead of being emailed:

```powershell
$env:DB_SCHEMA='hr_rexera_dev'; $env:SEED_DUMMY_DATA='true'; $env:EMAIL_DEV_MODE='True'; cd "C:\Users\dhair\Downloads\rex-hr\Rexera-HR\backend"; python -m uvicorn app.main:app --port 8010
```

Check it is up at <http://127.0.0.1:8010/api/health> — the response names the schema it
connected to.

### 2. Frontend

```bash
cd "D:\Main Rex" && npm install && npm run dev
```

Vite serves <http://localhost:5173> by default. To pin the port and point at the dev API:

```powershell
$env:VITE_API_BASE_URL='http://localhost:8010'; cd "D:\Main Rex"; npx vite --port 5180 --strictPort
```

`VITE_API_BASE_URL` in `.env` decides which API the app talks to (8000 = production data,
8010 = dev schema). Restart Vite after changing it — the value is read at startup.

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

With the dev servers above, the admin dashboard is at
<http://localhost:5180/dashboard/admin>.

`/dashboard` always redirects to the dashboard your role owns. Opening another role's URL
sends you back to your own (a Super Admin may open any of them), and the API enforces the
same permissions on the data itself.

The dashboards deliberately have no module sidebar: each one links out to the areas that
role may open. Module pages (`/hr`, `/admin/users`, and the rest) keep the sidebar layout.

### Related screens

| Screen | URL |
|---|---|
| HR module overview | `/hr` |
| Users and accounts | `/admin/users` |
| Roles and permissions | `/admin/permissions` |
| Activity log | `/admin/activity` |
| API documentation | `http://127.0.0.1:8010/docs` |

---

## Roles and permissions

Roles and permissions live in `backend/app/services/rbac_service.py` (`ROLES`, `CATALOG`,
`DEFAULT_ROLE_PERMISSIONS`, `ROUTE_RULES`). A Super Admin can change any role's permissions
at **`/admin/permissions`** without a code change; it takes effect within 30 seconds.

An entity a role has no permission for is not rendered at all — no locked or dimmed cards.
Unauthorised URLs show the 404 page, and the API refuses the underlying request
independently of the frontend.

---

## Other commands

Type-check:

```bash
npx tsc -b
```

Production build (writes to `dist/`):

```bash
npm run build
```
