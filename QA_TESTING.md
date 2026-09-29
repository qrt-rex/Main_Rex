# QA Testing Report — Rex CRM

| | |
|---|---|
| Date | 29 September 2026 |
| Build under test | `main` after merging the Google Workspace sign-in and password-reset-link commits (`59bddaf`, `3165116`, `5e6f03d`) |
| Backend | FastAPI app in `backend/` (222 API route/method pairs) |
| Frontend | React 19 + Vite app in `frontend/` (42 pages) |
| Environment | Windows 11, Python 3.11, Node / Vite 8. All runs used an in-memory data store: no real database was written and no email was sent. |
| Result | **Pass.** 2 defects found and fixed during this cycle (1 high, 1 medium); no open defects. Open questions are listed in section 7. |

---

## 1. Summary

| Check | Scope | Result |
|---|---|---|
| Automated backend suite | 304 test cases across 23 areas (section 3) | **304 passed, 0 failed** |
| Function coverage | Backend functions executed by the suite (measured before the Google sign-in merge) | **571 of 656 (87%)**; the rest explained in section 6 |
| Access-control sweep | Every API route × (signed out + 7 user types) | **1,776 checks, 0 mismatches, 0 server errors** |
| Screen sweep | 42 pages × 7 user types in a real browser | **294 page visits, 0 errors, 0 failed API calls, 0 script errors** |
| Python static analysis | `pyflakes` over `backend/app` | **0 findings** |
| TypeScript | `tsc -b` | **0 errors** |
| Frontend lint | `oxlint src` | **0 errors**, 34 advisory warnings (section 7) |
| Production build | `vite build` | **Succeeds** |

The automated test suite was removed from the repository after this run, as requested. A copy is kept
outside the project at `Downloads\rex-hr\Main_Rex_test_suite_backup_2026-09-29.zip`.

---

## 2. Method

1. **Automated suite**: the backend test suite ran the real application in-process against an
   in-memory store that reproduces the Postgres query behaviour. It exercised every module end to end
   through the HTTP API.
2. **Function coverage**: Python's profiler hook recorded every backend function that ran during the
   suite, then compared against every function defined in `backend/app`.
3. **Access-control sweep**: for each of the 222 route/method pairs, a request was sent signed out and
   as each of the seven user types. Each response was checked against the access rules in
   `rbac_service.ROUTE_RULES`:
   - Signed-out requests to protected routes must get 401.
   - A user type without the permission must be refused by the access guard.
   - A user type with the permission must get through.
   - Any 5xx response counts as a failure.
4. **Screen sweep**: in a real browser, signed in as each user type, every one of the 42 pages was
   opened. Each visit recorded whether the page rendered, redirected, or showed "not found" (no
   access). It also recorded any error screen, any failed API call (4xx/5xx) and any JavaScript error.
5. **Static analysis and build**: `pyflakes`, `tsc`, `oxlint`, `vite build`.
6. **Hands-on functional checks** (earlier in this session, in the browser):
   - candidate application submitted end to end
   - joining portal token step
   - own-leave request as a user with no employee record
   - payslip generation with sales incentive
   - Acknowledge on a broadcast, with the sender's count updating
   - new-scheme notification
   - Sales view-only scheme cards
   - attendance filters and counts
   - Manage access dialog
   - public pages served from the backend

---

## 3. Automated suite — test catalogue

| Area | Cases | What was verified |
|---|---|---|
| People (employees, interns, directory) | 48 | Create/edit/validate employees and interns, codes, duplicates, masking of bank data, search, bulk import rows |
| Billing & invoicing | 36 | GST maths per line, intra/inter-state, invoice numbering per branch/FY, proforma vs tax, HR-only tax invoices, quotations and conversion, clients/products, payments and reversal, requests (request → approve/reject), documents, CSV exports, monthly summary, sales person on invoices |
| Payroll | 28 | Salary calculation, LOP and half days, PF/PT, advances/loans/bonuses/overtime, approve → finalize → lock/unlock → mark paid, payslips, bank export, bulk run |
| Sales incentive & payroll attendance | 25 | Monthly slabs (20 %–40 %), salary ×3 gate, daily/weekly 5 %, no double pay, monthly replaces daily/weekly, attendance from Start/End Day, half day for a day never ended, Sundays, staff without punches |
| Reports | 24 | Individual and company performance reports, exports, validation |
| Attendance & leave | 22 | Punch classification (present/late/half day/early logout), shift rules, leave balances, paid vs LOP split, overlap checks, approved leave marks attendance |
| Authentication | 15 | Password + emailed code sign-in, resend, lockouts, one-time codes cannot be replayed or brute-forced, password reset, logout revokes the session, deactivated accounts rejected, rate limits |
| Google Workspace sign-in | 4 | Only rexera.co.in / rexera.in / rexera.com accounts accepted, other domains refused, session works |
| Onboarding (joining portal) | 13 | Token issue/validate/expire/reuse, emailed code required before submission, ID/bank validation, employee created on completion |
| Automations | 13 | Scheduled reminder rules and their switches |
| Productivity & broadcasts | 12 | Tasks, timesheets, blockers; broadcast publishing, HTML sanitising, audiences, acknowledgement |
| Database adapter | 12 | Query translation to SQL (filters, sorting, paging, updates) |
| Settings & administration | 9 | Users, roles, permission toggles, safeguards (last Super Admin, own role) |
| Imports & dashboard | 9 | Spreadsheet import, dashboard metrics |
| Leave routing & attendance filters | 6 | Sales → HR, HR → Admin, Admin → Super Admin; no self-approval; any login can request leave; date ranges and counts |
| Per-person access | 5 | Extra roles, Allow/Deny, no escalation, validation |
| Fixed role rules | 5 | Seven user types; schemes are view-only for sales whatever the settings; salaries private; own attendance only; bell notifications and broadcast acknowledgement |
| Web app serving | 4 | Old portal gone, payslip images served, React app with client-side routes, no-cache on the page |
| Legal | 4 | Client assignment and approval flow |
| Client documents | 4 | Staff submit, Legal reviews |
| Smoke | 2 | Health check, sign-in |
| Sales workspace | 2 | Leads, dialer, schemes/material, day start/end, privacy of the day board |
| Approvals inbox | 2 | Requests reach the right superior; requester sees the outcome |

---

## 4. Access control results

Routes each user type can reach, out of 222. All matched the rules.

| User type | Allowed | Refused |
|---|---|---|
| Super Admin | 222 | 0 |
| HR | 174 | 48 |
| Admin / Accounting | 125 | 97 |
| Employee / Sales Person | 72 | 150 |
| Legal | 59 | 163 |
| IT | 30 | 192 |
| Operation Team | 28 | 194 |

Pages each user type can open (screen sweep; every other page correctly shows "not found"):

| User type | Pages available |
|---|---|
| Super Admin | All 42 |
| HR | 29: all HR pages including payroll and payslips, all billing, notifications, settings |
| Admin / Accounting | 27: HR overview, employees, leave, sales workspace and sales pages, legal, all billing, users, activity, automations, finance/projects/reports |
| Employee / Sales Person | 17: own attendance, own leave, broadcasts, sales pages, billing (no clients/payments), notifications, settings |
| Legal | 6: legal, sales workspace (manages schemes), notifications, settings |
| Operation Team | 7: broadcasts, customers, contacts, notifications, settings |
| IT | 6: users, activity log, notifications, settings |

Public pages `/apply` and `/joining` open for everyone, signed in or not.

---

## 5. Defects found in this cycle

| ID | Severity | Defect | Fix | Verified |
|---|---|---|---|---|
| QA-01 | **High** | Employees / Sales Persons could open **Payroll** and **Payslips** and see every employee's salary. The default Sales role had the organisation-wide "View payroll, payslips & salary register" permission. | Payroll view/process/approve are now fixed rules for HR, Admin / Accounting and Super Admin only. They are removed from the Sales defaults and refused by the role matrix and per-person Allow. Everyone can still open **their own** payslip, and a "View payslip" button was added on their dashboard. | Automated check plus sweeps: staff get 403 on the register; they can open their own payslip, and someone else's reads as not found. |
| QA-02 | Medium | The role dashboard loaded its data conditionally, which breaks React's rules of hooks. A Super Admin switching between the Legal dashboard and another could crash the page. It also made an unused request on the HR dashboard. | The layout is chosen first; data is loaded only by the dashboards that use it. | Lint error cleared; screen sweep. |
| QA-04 | Low | The Google sign-in test (from the merged commits) checked the new session with `/api/auth/me`, a duplicate endpoint removed in this cycle. The two new Google modules also had unused imports. | Test uses `/api/rbac/me`, which the app uses; imports removed. | Suite 304/304. |
| QA-03 | Low | One automated test expected the approver name "admin" while the default Super Admin username is "superadmin". The test was wrong, not the app. | Test compares against the configured username. | Suite 300/300. |

Hygiene issues removed as part of the clean-up (not user-visible defects):

- a public `/api/otp/verify` endpoint nothing used
- a billing settings endpoint that saved arbitrary unvalidated fields
- a fake "ZIP export" endpoint that returned a success message without doing anything

---

## 6. Not covered by automated tests (residual risk)

| Area | Why | How it was checked instead |
|---|---|---|
| Real Postgres adapter (`database.py` connection and cursor code) | Tests use the in-memory store | The query translator is unit-tested (12 cases); the app runs daily against Postgres |
| Sending real email (SMTP / Brevo) | Must not send email from tests | Email content and recipients are asserted; delivery depends on the SMTP settings in `.env` |
| Scheduled automations loop and timers | Time-based | Each rule's logic is tested; the loop itself is not |
| Office GPS / IP check on punch-in | Start Day skips it for field staff | Not exercised |
| About 40 endpoints the suite did not call directly | See the list in section 7 | All were called by the access-control sweep with every user type; none returned a server error |
| Joining portal after the emailed code | Needs the candidate's mailbox | Covered by 13 API tests; the page was checked up to code dispatch |

---

## 7. Open items and recommendations

1. **APIs without a screen.** These work and are protected, but no page uses them. Keep them if they
   are planned, otherwise remove them:
   - salary structures (view/edit)
   - annual salary statement
   - salary adjustment
   - reject a salary advance
   - manual attendance punch in/out
   - productivity clients/projects
   - bulk-import error report download
   - report job status
   - Legal "missing PDF" export
   - single payroll record view
2. **Attendance for office staff.** Only people with the Sales workspace can Start / End Day. HR,
   Admin, Legal, IT and Operation Team have no in-app way to mark attendance.
3. **Invoice visibility.** Employees / Sales Persons can see every company invoice. Confirm this is
   intended, or limit them to invoices where they are the sales person.
4. **Production settings** in `backend/.env`:
   - Set `EMAIL_DEV_MODE=False` so sign-in codes are emailed, not shown on screen.
   - Replace the default `JWT_SECRET_KEY` with a random secret.
   - Set `COMPANY_WEBSITE` to the address the app is served from; joining emails link there.
5. **Automated tests.** The suite was removed on request. Reinstating it, or running it in CI from the
   backup, is strongly recommended before further changes.
6. **Lint advisories (34 warnings, no errors; 2 are in the new login page).**
   - 16 "set state in effect" (performance style)
   - 7 "only export components" (hot-reload only)
   - 4 "missing key", all false positives on data arrays passed to a keyed list
   - 3 "exhaustive deps"
   - 2 "refs during render"

   None affects behaviour; fix them opportunistically.

---

## 8. Clean-up performed in this cycle

- **Removed unused endpoints:**
  - billing: branches, quotation next-number, settings GET/PUT, the ZIP export stub
  - `/api/auth/me` (duplicate of `/api/rbac/me`)
  - broadcast in-app feed and single-broadcast analytics (the bell and Broadcasts list replace them)
  - public OTP verify
  - legacy payroll batch-run (duplicate of bulk calculate)

  Their access rules were removed with them.
- **Removed dead backend code:**
  - the end-of-day attendance module (never called)
  - unused helpers in the database, audit, employee and automation services
  - in-app notification copies of broadcasts that nothing read
  - 7 unused schema classes
  - 1 unused PDF style
  - about 95 unused imports
- **Removed unused dependencies:** `passlib`, `jinja2`, `aiosmtplib`, `pillow`.
- **Removed unused frontend code and files:**
  - an unreachable module
  - the Employee dashboard (Employee is part of Employee / Sales Person)
  - unused icons, a duplicate logo and a stray logo file
  - the ported Bill-Invoice clone
- **Tidied project files:**
  - old `docs/` (old README and QA report) replaced by this file and a new README
  - a stale Claude preview configuration that pointed at another machine
  - test-tool entries in `.gitignore`
- **Removed test code:** the `backend/tests` folder, with a backup outside the project.
