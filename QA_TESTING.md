# QA Testing Report — Rex CRM

| | |
|---|---|
| Date | 29 September 2026; sales scorecard & incentive feature added 30 September 2026 |
| Build under test | `main` after merging the Google Workspace sign-in and password-reset-link commits (`59bddaf`, `3165116`, `5e6f03d`), plus the sales scorecard & incentive feature (section 4a) |
| Backend | FastAPI app in `backend/` (228 API route/method pairs) |
| Frontend | React 19 + Vite app in `frontend/` (46 pages) |
| Environment | Windows 11, Python 3.11, Node / Vite 8. All runs used an in-memory data store: no real database was written and no email was sent. |
| Result | **Pass.** 6 defects found and fixed during this cycle (1 critical, 3 high, 2 medium); no open defects. Open questions are listed in section 7. |

---

## 1. Summary

| Check | Scope | Result |
|---|---|---|
| Automated backend suite | 313 test cases across 23 areas (section 3) | **313 passed, 0 failed** |
| Function coverage | Backend functions executed by the suite (measured before the Google sign-in merge) | **571 of 656 (87%)**; the rest explained in section 6 |
| Access-control sweep | Every API route × (signed out + 7 user types) | **1,824 checks, 0 mismatches, 0 server errors** |
| Screen sweep | 42 pages × 7 user types in a real browser (before the 4 scorecard / incentive pages, which were checked by hand as Sales, HR and Super Admin) | **294 page visits, 0 errors, 0 failed API calls, 0 script errors** |
| Python static analysis | `pyflakes` over `backend/app` | **0 findings** |
| TypeScript | `tsc -b` | **0 errors** |
| Frontend lint | `oxlint src` | **0 errors**, 34 advisory warnings (section 7) |
| Production build | `vite build` | **Succeeds** |

The automated test suite was removed from the repository after this run, as requested. A copy is kept
outside the project at `Downloads\rex-hr\Main_Rex_test_suite_backup_2026-09-30.zip`.

---

## 2. Method

1. **Automated suite**: the backend test suite ran the real application in-process against an
   in-memory store that reproduces the Postgres query behaviour. It exercised every module end to end
   through the HTTP API.
2. **Function coverage**: Python's profiler hook recorded every backend function that ran during the
   suite, then compared against every function defined in `backend/app`.
3. **Access-control sweep**: for each of the 228 route/method pairs, a request was sent signed out and
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
| Sales incentive & payroll attendance | 34 | Monthly slabs (20 %–40 %), salary ×3 eligibility, daily and whole-week 5 %, monthly slab added at ×4, DSC taken off first, DSC Super Admin only and kept per payment, rules HR and above, leaderboard privacy and isolation, Excel / PDF download, finalized payroll protected, recalculation history, attendance from Start/End Day, half day for a day never ended, Sundays, staff without punches, absent before the joining date and after the exit date |
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

Routes each user type can reach, out of 228. All matched the rules.

| User type | Allowed | Refused |
|---|---|---|
| Super Admin | 228 | 0 |
| HR | 179 | 49 |
| Admin / Accounting | 129 | 99 |
| Employee / Sales Person | 75 | 153 |
| Legal | 60 | 168 |
| IT | 31 | 197 |
| Operation Team | 29 | 199 |

Pages each user type can open (screen sweep; every other page correctly shows "not found"):

| User type | Pages available |
|---|---|
| Super Admin | All 46 |
| HR | 32: all HR pages including payroll, payslips, sales incentives and incentive settings, the sales scorecard, all billing, notifications, settings |
| Admin / Accounting | 28: HR overview, employees, leave, sales workspace and sales pages (including the scorecard), legal, all billing, users, activity, automations, finance/projects/reports |
| Employee / Sales Person | 18: own attendance, own leave, broadcasts, sales pages including the scorecard, billing (no clients/payments), notifications, settings |
| Legal | 6: legal, sales workspace (manages schemes), notifications, settings |
| Operation Team | 7: broadcasts, customers, contacts, notifications, settings |
| IT | 6: users, activity log, notifications, settings |

Public pages `/apply` and `/joining` open for everyone, signed in or not.

---

## 4a. Sales scorecard & incentive feature (30 September)

Added: DSC on payments, the collection scorecard and leaderboard, HR incentive rules, Super Admin DSC
setting, incentive flow into payroll and payslips, recalculation history and the month-end run.

Rules you chose for this feature:

- Collections are recorded by accounts / HR in Billing → Payments, not by sales staff.
- Daily, weekly and monthly incentives add up.
- The weekly 5 % is on the whole week.

How it was checked:

- a 71-check end-to-end script on an in-memory copy of the app
- 9 new cases in the automated suite (now 313)
- the access sweep (6 new routes)
- the new pages in a real browser as Sales, HR and Super Admin

| Check (from the feature's validation list) | Result |
|---|---|
| DSC ticked / not ticked; ₹10,000 with ₹850 DSC | Pass: gross ₹10,000, DSC ₹850, scorecard ₹9,150 (misses the ₹10,000 daily threshold) |
| Super Admin changes DSC to ₹1,000, then back | Pass: new payments use the new amount; payments already recorded keep theirs |
| Who can change DSC / incentive rules | Pass: DSC Super Admin only (HR and Sales refused); rules HR, Admin / Accounting, Super Admin (Sales refused) |
| Employee isolation (two sales people, different salaries) | Pass: each person's scorecard, incentive and payroll use only payments on invoices naming them |
| Eligibility at salary ₹30,000: ₹89,999 / ₹90,000 | Pass: Not eligible (₹1 to go) / Eligible |
| Monthly target: ₹1,19,999 / ₹1,20,000 | Pass: no slab / 20 % slab |
| Every slab boundary, ₹1,99,999 to ₹8,00,001 | Pass: all 16 values give the expected % |
| Daily + weekly + monthly add up | Pass: e.g. ₹1,20,000 in one day at salary ₹30,000 = 6,000 + 6,000 + 24,000 |
| Same payment listed twice | Pass: counted once |
| Payment removed (correction or refund) | Pass: drops out of the scorecard and any payroll not yet finalized; logged in the activity log |
| Rules changed | Pass: saved as a new version with who and when, logged; finalized payroll unchanged |
| Payroll finalized, then more collections | Pass: recalculation refused until unlocked; the finalized incentive stays |
| Recalculation | Pass: payroll keeps who, when, the incentive before and after, and the rules version |
| Payslip | Pass: Sales Performance section with gross, DSC, net, eligibility, target, daily / weekly / monthly and total |
| Leaderboard visibility | Pass: Sales see colleagues' collections and rank but not their target or incentive; HR sees everything plus payroll status |
| Download (Excel / PDF) | Pass: HR and above; Sales refused |
| Month-end run (1st of the month) | Pass: records every sales person's final incentive; lists payroll that carries a different figure; running it again updates rather than duplicates |
| Payments on a cancelled invoice | Not counted (existing rule, not separately tested) |
| Many sales people / many payments | A period's payments are read once for everyone, not per person; not load-tested |
| Joins mid-month: incentive | As decided: based only on the payments collected, against the full monthly salary targets |
| Joins or leaves mid-month: attendance | Pass: every day before the joining date and after the exit date (last working day) is absent (loss of pay), Sundays included, for office and sales staff. A month wholly before joining or after leaving is fully absent; other months are unaffected; joining and leaving in the same month works; clearing the exit date restores the full month; an exit before joining is refused. The payslip form explains the days |
| Salary changes | Payroll uses the salary structure at calculation time; finalized payroll keeps its copy |
| Correcting a payment | As decided: remove and record again, both in the activity log |

---

## 5. Defects found in this cycle

| ID | Severity | Defect | Fix | Verified |
|---|---|---|---|---|
| QA-05 | **Critical** | *Found after the first report.* Posting only an email address to `POST /api/auth/google` returned a working session for that account, Super Admin included, with no password, code or Google check. With no Google client ID set, the login page's Google button opened a form that did exactly this. Google tokens were also accepted without checking they had been issued to this app. | An email alone is accepted only when `APP_ENV=test`. Google sign-in is off until `GOOGLE_CLIENT_ID` is set, and every token must be issued to that client ID. The account signed in is the token's own address. The Google button is hidden without a client ID, and the email-only form is removed. | In-memory check in production mode: email only → 400; no client ID → 503; token for another app → 401; token for this app → 200. Suite 304/304. |
| QA-06 | **High** | *Found after the first report.* On every start, `seed.py` reset the passwords of 11 built-in accounts to values written in the code, restored their roles, reactivated them, and printed the Super Admin password to the log. | The seed step creates missing accounts only, never changes existing ones, and prints no passwords. | In-memory check: a deactivated account with its own password is unchanged after a restart, and no password appears in the output. |
| QA-07 | **High** | *Found after the first report.* The password reset email built its link from the requesting browser's Origin header, which a caller can set to anything. Someone could request a real reset email for another person whose link opened their own site and captured the reset token. | The link uses `COMPANY_WEBSITE`; the caller's Origin is used only when it is an address in `CORS_ORIGINS`, or localhost. | In-memory check: a fake Origin gives a `COMPANY_WEBSITE` link; localhost and no Origin behave as described. |
| QA-08 | Medium | *Found after the first report.* Forgot-password had no send limit, so anyone could send unlimited reset emails to any address (inbox flooding, email quota). The server also started in production with the public default JWT secret or with sign-in codes returned by the API. | Reset emails share the sign-in code limit (5 per address per 15 minutes); over it the answer is unchanged and nothing is sent, so accounts are not revealed. In production the server refuses to start with the default or a short JWT secret, or with `EMAIL_DEV_MODE=True`. | In-memory check: 7 requests send 5 emails with identical answers, and the last link still works; each unsafe production setting stops start-up, and a strong secret starts. Suite 304/304. |
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
