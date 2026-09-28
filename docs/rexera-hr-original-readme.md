# Rexera HR Management System Rebuild

An enterprise-grade full-stack Human Resources & Payroll Management Platform built with **HTML5, CSS3, Vanilla JavaScript**, **Python FastAPI**, and **PostgreSQL**.

![Rexera Brand Logo](/assets/logo.png)

---

## 🌟 Key Modules & Capabilities

1. **Recruitment & Candidate Pipeline (`/candidates.html` & `/index.html`)**
   - Public interview application form with dynamic multi-row controls for Education, Work Experience, and Skills matrix.
   - HR Admin recruitment pipeline with search, position filters, status management (`Applied`, `Screening`, `Interview Scheduled`, `Interviewed`, `Selected`, `Rejected`, `On Hold`, `Joined`), and full profile drawer.
   - One-click **Joining Token Generation** (`REX-XXXXXX`) and automated email dispatch.

2. **Full-Time Employee Directory & Compensation (`/employees.html` & `/add-employee.html`)**
   - Employee directory with search, department filtering, and status tracking.
   - **Sensitive Banking Protection**: Masked account numbers (`••••1234`) with one-click secure unmask toggle.
   - Live statutory salary computation (Basic, HRA, Conveyance, Allowances, PF 12%, PT ₹200).

3. **Interns & Trainees Management (`/interns.html` & `/intern-form.html`)**
   - Dedicated Intern Management System with Academic tracking (College, Degree, Branch, Semester, Roll number).
   - Mentor assignment, internship duration, and monthly stipend configuration.
   - **One-Click "Convert to Full-Time Employee"** workflow that carries over verified details into the Employee Directory and prompts full-time compensation setup.

4. **Candidate Onboarding Portal & HR Policy Agreement (`/joining-login.html` & `/joining-form.html`)**
   - Identity verification gate with Joining Token + 6-digit Email OTP.
   - 3-Step Onboarding Wizard with real-time Aadhaar (12 digits), PAN (`ABCDE1234F`), and IFSC validation.
   - **13-Clause Legal HR Policy Agreement** with digital signature, timestamp, and IP recording.

5. **Payroll Engine & Statutory Compliance (`/payroll.html`, `/salary-slip.html`, `/salary-report.html`)**
   - Automated PF deduction rules (12% of Basic salary) and Professional Tax (₹200).
   - Loss of Pay (LOP) calculations and Indian currency amount-to-words converter.
   - Official printable salary slips with company letterhead, signature lines, and official authorization stamp (`stamp.png`).
   - Monthly Batch Payroll runner and exportable Salary Register report (CSV / Excel format).

6. **Authentication & Security (`/admin-login.html`)**
   - JWT access tokens (HS256) with bcrypt password hashing.
   - Two-Factor Authentication (2FA) via 6-digit email OTP.
   - Admin password recovery with email verification code.

---

## 🚀 Getting Started

### 1. Prerequisites
- Python 3.11+
- A PostgreSQL database — either a [Supabase](https://supabase.com) project, any other cloud Postgres, or a local install. If none is reachable, the app automatically falls back to a local JSON file store (`backend/data/db_store.json`) so it still runs for development.

### 2. Installation
Install the required dependencies:
```bash
pip install -r backend/requirements.txt
```

### 3. Configure environment
Copy the example env file and fill in your own values:
```bash
cp backend/.env.example backend/.env
```

Key variables in `backend/.env`:

| Variable | Purpose |
|---|---|
| `POSTGRES_URI` | SQLAlchemy async connection string. For a [Supabase](https://supabase.com) project, use the transaction pooler: `postgresql+asyncpg://postgres.<project-ref>:<password>@aws-0-<region>.pooler.supabase.com:6543/postgres` (find this under Project Settings → Database → Connection string). URL-encode special characters in the password (`@` → `%40`, `#` → `%23`, etc). |
| `JWT_SECRET_KEY` | Secret used to sign admin session tokens — change this in production. |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASSWORD` / `SMTP_FROM_EMAIL` | Outbound mail for OTP codes, joining tokens, and payslip emails. |
| `EMAIL_DEV_MODE` | Defaults to `False`. While `True`, emails are only logged to the console (and OTPs are echoed back in API responses) instead of actually sending — for local development only, never in production. |
| `BREVO_API_KEY` | Optional. When set, email is sent over HTTPS through the [Brevo](https://www.brevo.com) API instead of SMTP. Required on hosts that block outbound SMTP (such as Render), where SMTP fails with `Network is unreachable`. The sender (`SMTP_FROM_EMAIL`) must be a verified sender in Brevo. |
| `DEFAULT_ADMIN_EMAIL` / `DEFAULT_ADMIN_PASSWORD` | Seeded superadmin account, created on first startup if no admin exists. |

`.env` is git-ignored — never commit real credentials.

### 4. Run the Application
Start the FastAPI server:
```bash
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --app-dir backend --reload
```
On startup the app connects to `POSTGRES_URI`, auto-creates one table per collection (`id TEXT PRIMARY KEY`, `data JSONB`) if they don't exist yet, and seeds default admin/demo data.

Open your browser and navigate to:
- **Public Candidate Portal**: `http://localhost:8000/`
- **Candidate Onboarding Gate**: `http://localhost:8000/joining-login.html`
- **HR Admin Portal**: `http://localhost:8000/admin-login.html`
- **Interactive API Documentation (Swagger)**: `http://localhost:8000/docs`
- **Health Check**: `http://localhost:8000/api/health` — reports whether it's on live Postgres or the embedded fallback store.

---

## 🗄️ Database

Data is stored as one Postgres table per collection (`col_employees`, `col_payrolls`, `col_admins`, ...), each with a `TEXT` primary key `id` and a `JSONB` `data` column plus a GIN index for query performance. The data-access layer in `backend/app/database.py` exposes a MongoDB-collection-shaped API (`find_one`, `find().sort().skip().limit()`, `insert_one`, `update_one`, `delete_one`, `count_documents`) implemented on top of SQLAlchemy's async engine, so application code reads and writes documents without hand-written SQL.

If `POSTGRES_URI` points at a PgBouncer transaction pooler (Supabase's port `6543`), the engine is created with `statement_cache_size=0` since that mode doesn't support asyncpg's prepared statements.

---

## 🔑 Default Credentials
Seeded on first run from `DEFAULT_ADMIN_EMAIL` / `DEFAULT_ADMIN_PASSWORD` in `.env`:
- **Admin Email**: `hr@rexera.co.in`
- **Password**: `Hr@@1234`
- **Demo Candidate Joining Token**: `REX-A1B2C3` (Candidate: Rahul Varma)
- **2FA code**: a random 6-digit code is emailed from `SMTP_FROM_EMAIL` (e.g. `no-reply@hr.rexera.in`) on every login. With `EMAIL_DEV_MODE=True` (local development only) the email is printed to the server console instead and the code is echoed in the API response. There is no fixed bypass code.
