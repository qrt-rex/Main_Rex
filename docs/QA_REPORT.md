# Rexera HR Portal: QA Test Report

**Date:** 19 September 2026  |  **Scope:** full application (backend API, admin portal UI, public forms)  |  **Total checks:** 342

## 1. Summary

| Result | Count | Meaning |
|---|---:|---|
| PASS | 274 | Works as expected |
| FIXED | 21 | Was broken, fixed during this QA session and re-verified |
| FAIL | 35 | Defect still open |
| WARN | 12 | Weakness or observation, still open, lower urgency |

**Verdict.** The core HR flows (login with emailed 2FA, employee directory, recruitment, leave, payroll calculation with advance/loan recovery, payslips, salary register, broadcasts) work. The QA pass found and fixed **one critical security hole and several features that did not work at all** (listed in section 3). What remains open falls into three groups: **missing rate limiting and role separation**, **missing input validation on money and date fields**, and **report exports that silently produce no file** (section 4). Two items need a business decision rather than a code fix (attendance capture after removing punch-in, and how HR vs Superadmin roles should differ).

### Results by area

| Area | PASS | FIXED | FAIL | WARN |
|---|---:|---:|---:|---:|
| Authentication, 2FA and sessions | 24 | 0 | 1 | 0 |
| Email OTP service | 5 | 0 | 2 | 0 |
| Access control (Superadmin vs HR) | 0 | 0 | 3 | 1 |
| Employee directory | 20 | 1 | 4 | 0 |
| Recruitment pipeline | 17 | 0 | 3 | 0 |
| Joining tokens and onboarding portal | 11 | 0 | 2 | 1 |
| Interns and trainees | 11 | 0 | 2 | 0 |
| Attendance and shift rules | 12 | 0 | 2 | 0 |
| Leave management | 13 | 0 | 1 | 0 |
| Client productivity, tasks and timesheets | 26 | 0 | 1 | 0 |
| Advances, loans, bonuses and overtime | 22 | 0 | 6 | 1 |
| Payroll engine, payslips and Salary Register | 41 | 0 | 1 | 1 |
| Payroll settings and SMTP | 8 | 0 | 0 | 1 |
| Performance reports and exports | 10 | 0 | 4 | 3 |
| Smart Bulk Import | 10 | 1 | 1 | 0 |
| Company broadcasts | 8 | 0 | 0 | 2 |
| Activity logs | 7 | 0 | 0 | 0 |
| Dashboard and backup | 4 | 0 | 0 | 0 |
| Platform and web security | 2 | 0 | 2 | 1 |
| Browser (UI) end-to-end checks | 11 | 17 | 0 | 0 |
| Regression checks for defects fixed during QA | 10 | 0 | 0 | 0 |
| Security fixes verified during QA | 2 | 2 | 0 | 0 |
| Security observations (open) | 0 | 0 | 0 | 1 |
| **Total** | **274** | **21** | **35** | **12** |

## 2. The changes you asked for

| # | Request | Status | What was done and how it was verified |
|---|---|---|---|
| 1 | Remove geolocation and punch in / punch out | Done | Removed the Punch In / Punch Out buttons, live clock, GPS detection text, geofence radius setting and the Geofence column from the Attendance page; dashboard wording updated. The backend endpoints still exist but nothing in the UI calls them. Verified by inspecting the page. |
| 2 | Sync shift and grace with Automated Attendance Policies | Done | The policies card is now generated from the saved Shift & Grace settings. Saving 10:00 / 10:45 / 12:15 / 17:00 rewrote the card immediately to match (previously it was hard-coded to 9:00 / 9:45 / 11:15 / 4:00 PM). |
| 3 | Log daily timesheet not working | Fixed | The Assigned Client Task list was always empty because nothing in the UI could create a task. Added a **New Task** button and modal, plus a clear empty-state message. Also relaxed the rule that demanded an attendance record for the day, which could no longer be met once punching is gone (leave, absent, holiday and week-off days are still blocked). Verified: task created, then 6 hours logged, and the dashboard showed 6.0 billed hours. |
| 4 | Issue salary advance not working | Fixed | The employee list never loaded (stuck on 'Loading active employees...') because the page treated the paged API response as a plain array. Verified by submitting the form in the browser. |
| 5 | Employee loan, bonus and overtime not working | Fixed | Same root cause as advances (all four forms share one employee loader). Each form was submitted in the browser and its table grew by one row. |
| 6 | Salary Register not working | Fixed | The register read an unused collection, so it was always empty and Generate Payslip never created an official slip. It now lists payroll records, the totals use real PF/PT figures (PF was an estimate), and Generate Payslip properly finalizes the payslip and commits advance/loan recovery. Verified: list, search, summary, slip detail and printable payslip. |
| 7 | Page scrolls left and right | Fixed | Root cause: the main content area could grow wider than the screen when a table was wide. Employees and Payroll overflowed on laptop screens; seven pages overflowed on phones. After the fix, **all 18 admin pages have zero sideways overflow at 1366, 1024, 768 and 390 px**. Stylesheet and script links were also versioned so browsers pick up the new files. |
| 8 | End-to-end QA and report | Done | This document: 342 checks across API, UI and security. |

## 3. Defects found and fixed during QA

| Severity | Defect | Root cause and fix |
|---|---|---|
| Critical | **Stored XSS from the public application form.** Script typed into the candidate name executed in an HR admin's browser when they opened the Candidates page, allowing session-token theft. 2FA does not prevent it because the token is issued after login. | Public forms now neutralise markup characters on input, and every candidate value is HTML-escaped on render. Buttons no longer pass names through inline `onclick` strings. Verified with tag, attribute and JS-string payloads and with a payload stored before the fix. |
| Critical | **Employee directory returns HTTP 500 for everyone** if a single malformed employee record exists. This took down the directory, the attendance filter and every employee dropdown. | A record created by Smart Bulk Import had the wrong shape. Import now writes valid records, and the API fills gaps in any legacy record instead of failing. |
| High | **Smart Bulk Import (Employees) created unusable records**: it used different field names, mapped a bank IFSC code to Employee ID, and silently overwrote an existing employee. | Import now maps to the real employee fields (including bank details), matches on employee code or email, fills required defaults, rejects invalid rows, and imported staff can be paid through payroll. |
| High | **Employee codes were duplicated after a deletion** (EMP-034 issued twice), which breaks payroll IDs and timesheet lookups. | Codes are now the highest existing number plus one. |
| High | **Activity Logs page never loaded** (called an API path that returned 404). | Route now accepts both forms. |
| High | **Company Broadcasts history showed only the seed broadcast**; anything you published never appeared. | Added a broadcast list endpoint and the page now renders all broadcasts, newest first. |
| Medium | Employee dropdowns on Leaves, Performance Reports (first 20 only) and Payslip (first 200) hid the rest of the staff. | All three now request up to 2,000 employees. |
| Medium | Bank account number was returned unmasked by default from `GET /employees/{id}`, contradicting the documented masking. | Masked by default; only `unmask=true` reveals it (the UI already asks for that explicitly). |
| Medium | Broadcast title was rendered unescaped in the admin notification feed (script injection). | Title is escaped. |
| Low | Unsupported Bulk Import targets (Attendance Logs, Client Projects) crashed with HTTP 500. | Returns a clear HTTP 400. |
| Low | Local development could not connect to a non-SSL Postgres after the Supabase change. | SSL is now required only for remote hosts. |

## 4. Open defects and recommendations

Ordered by priority. Every item has at least one test in section 6 that reproduces it.

### P1: fix before relying on the system with real data

| ID | Area | Finding | Impact | Recommendation |
|---|---|---|---|---|
| SEC-1 | Login / OTP | No rate limiting or lockout. 12 wrong passwords all returned 401; 8 OTP-send requests all succeeded; 15 wrong OTP guesses were all accepted for checking. | Password guessing; a 6-digit code can be brute-forced within its 10-minute life; the unauthenticated OTP endpoint can be used to email-bomb any address. | Limit attempts per IP and per email (for example 5 per minute), lock the account or OTP after 5 wrong tries, and add a per-address send cap. |
| SEC-2 | Access control | HR-role users can delete employees, read and change payroll and SMTP settings, and download the **full database backup** (all bank and PAN data). There is no difference between HR and Superadmin. | Any HR account can exfiltrate or destroy company data. | Decide what HR may do, then enforce roles on the server for delete, settings, backup/export and salary adjustment. |
| SEC-3 | Onboarding | Onboarding can be submitted with **no OTP verification** and with the **HR policy agreement marked not accepted**; both are only checked in the browser. | A joining token alone completes onboarding, and an unsigned policy can be recorded as signed. | Enforce OTP-verified state and `agreement.accepted == true` in the API. |
| FUN-1 | Reports | Only Company-wide Excel and Individual PDF produce a file. Company PDF, Company CSV, Individual Excel and Individual CSV are accepted, reported as started or completed, and never produce a file. **On the page, the Download PDF button fails for Company scope and the Multi-Sheet Excel button fails for Individual scope.** | Users wait for a report that never arrives. | Implement the missing combinations or hide them and return HTTP 400. |
| FUN-2 | Attendance | With punching removed there is no way to record attendance. The Attendance Log stays empty (other than approved-leave rows), so the Late, Half-Day and 3-Lates rules and payroll loss-of-pay inputs have no data. | Attendance rules and analytics do nothing. | **Decision needed:** add HR manual attendance entry, a CSV import for attendance, or a biometric feed. |

### P2: data integrity (missing validation)

The API accepts values that should be rejected. Some of these later cause payroll failures (a negative salary makes payroll skip that employee) or crashes.

| Area | Accepted but should be rejected |
|---|---|
| Employees | Duplicate email; negative base salary; non-numeric mobile number; malformed IFSC code. |
| Candidates | Duplicate application (same email and position); non-numeric phone; an arbitrary status such as 'Banana'. |
| Interns | End date before start date; negative stipend. |
| Attendance settings | Grace cutoff earlier than shift start; malformed times such as 25:99 (would break late/half-day classification). |
| Leave | A 90-day casual leave that far exceeds the balance was accepted and approved. |
| Advances | Monthly installment larger than the advance; an advance 100x the salary. |
| Loans | EMI larger than the total payable; a malformed start date. |
| Bonus / Overtime | Invalid month name; more than 24 overtime hours in a day; malformed date. |
| Salary calculator | Negative base salary; loss-of-pay days greater than working days. |
| Timesheets | A malformed work date (`not-a-date` was saved). |
| Reports | Custom date range with no dates, or with the end before the start; an individual export with no employee. |

### P3: hardening

| ID | Finding | Recommendation |
|---|---|---|
| SEC-4 | CORS allows any website (`*`); no security headers (CSP, X-Frame-Options, nosniff, HSTS); API docs (`/docs`, `/openapi.json`) are public. | Set `CORS_ORIGINS` to your real domain, add a headers middleware, disable docs in production. |
| SEC-5 | Other admin pages (Employees, Interns, Leaves, Payroll, Advances, Productivity, Dashboard) still render values without escaping. Only reachable through data HR or an imported file supplies. | Wrap those template values in `escapeHtml()` (now available in `api.js`). |
| SEC-6 | Broadcast body is stored and emailed as raw HTML. | Sanitise to a safe tag allow-list. |
| SEC-7 | The joining-token OTP is sent in the URL query string, so it lands in access logs. | Move it to the request body. |
| SEC-8 | SMTP password is stored in the database settings record. | Prefer environment variables only, or encrypt at rest and never return it. |
| FUN-3 | Broadcast 'acknowledge' only works for employees, but employees cannot log in, so acknowledgements cannot happen. | Decide whether employees get a login or acknowledgement is done another way. |
| FUN-4 | Timestamps mix local time (seed data) and UTC (everything else), so ordering can be off by the time zone offset. | Store everything in UTC. |
| ENV-1 | Email delivery on Render is not yet confirmed. Render blocks SMTP, so OTP mail needs the Brevo API key set (and Brevo's IP restriction turned off). Not verifiable from a test machine. | Complete the Brevo setup, then log in once on the live site and confirm the code arrives. |

## 5. Scope, method and limits

- **What was tested:** 93 API paths, and all 22 pages (18 in the admin portal, 4 public), the login and 2FA flow, and the money maths (PF 12% of basic, professional tax, loss of pay, net pay in words, advance and loan recovery, bonus and overtime in payroll).
- **How:** an automated HTTP test harness (positive, negative, validation, authorisation and abuse cases) plus scripted browser checks driving the real forms. Layout was measured at four screen widths. Console errors and failed network requests were collected per page.
- **Where:** a separate local PostgreSQL 18 schema (`qa_test`) running the same code. **Your live Supabase data was not written to.** OTP emails were read from the database instead of an inbox.
- **Code state:** results reflect the working tree **including the fixes listed above, which are not yet committed or deployed**.

**Not covered (be aware):**

- Real email delivery (SMTP and Brevo) and PDF/Excel visual layout.
- Import of Leave Balances, and the destructive restore endpoint (`import-all`).
- Load and concurrency, other browsers or real phones, accessibility, and penetration testing beyond the injection and abuse cases listed.
- Role behaviour beyond the actions listed in section 6 (Access control).

## 6. Detailed results by function

Legend: **PASS** works | **FIXED** was broken, fixed and re-verified | **FAIL** open defect | **WARN** open observation. *Expected* is the correct behaviour; *Actual* is what the system returned.

### Authentication, 2FA and sessions

24 pass, 0 fixed, 1 fail, 0 warn

| # | Result | Test | Expected | Actual / notes |
|---:|---|---|---|---|
| 1 | PASS | Login with wrong password is rejected | 401 |  |
| 2 | PASS | Login with unknown email is rejected | 401 |  |
| 3 | PASS | No user enumeration (same error for bad email / bad password) | identical |  |
| 4 | PASS | Login with malformed email rejected (validation) | 422 |  |
| 5 | PASS | Login rejects NoSQL-style injection object as email | 422 |  |
| 6 | PASS | Login with valid credentials returns 2FA challenge | 200 |  |
| 7 | PASS | 2FA with wrong code rejected | 400/401 |  |
| 8 | PASS | 2FA with the old fixed bypass code 999999 rejected | 400/401 |  |
| 9 | PASS | OTP is a random 6-digit numeric code | 6 digits |  |
| 10 | PASS | 2FA with correct code issues access token | 200 |  |
| 11 | PASS | OTP is single-use (replay rejected) | 400/401 |  |
| 12 | PASS | GET /auth/me returns current admin | 200 |  |
| 13 | PASS | Protected route without token rejected | 401 |  |
| 14 | PASS | Protected route with forged token rejected | 401 |  |
| 15 | PASS | Session config endpoint | 200 |  |
| 16 | PASS | Resend 2FA OTP | 200 |  |
| 17 | PASS | Forgot-password for existing admin | 200 |  |
| 18 | PASS | Reset password with wrong OTP rejected | 400 |  |
| 19 | PASS | Reset password with correct OTP | 200 |  |
| 20 | PASS | Login works with the newly reset password | 200 |  |
| 21 | PASS | Old password no longer works after reset | 401 |  |
| 22 | PASS | HR-role user can complete login + 2FA | 200 |  |
| 23 | PASS | HR-role user can access employee directory | 200 |  |
| 24 | PASS | Logout endpoint | 200 |  |
| 25 | **FAIL** | Account lockout / rate limiting after repeated failed logins | 429/423 after N failures | 12 wrong attempts all returned {401} - No throttling: password brute-force is possible (2FA still protects). |

### Email OTP service

5 pass, 0 fixed, 2 fail, 0 warn

| # | Result | Test | Expected | Actual / notes |
|---:|---|---|---|---|
| 26 | PASS | Send OTP to valid email | 200 |  |
| 27 | PASS | Send OTP rejects invalid email | 422 |  |
| 28 | PASS | Verify wrong OTP rejected | 400 |  |
| 29 | PASS | Verify correct OTP accepted | 200 |  |
| 30 | PASS | Verify OTP replay rejected | 400 |  |
| 31 | **FAIL** | OTP-send endpoint is rate limited | 429 after burst | 8 sends -> {200} - Unauthenticated endpoint can be used to spam any address with emails. |
| 32 | **FAIL** | OTP verification limits wrong guesses | lockout | 15 wrong guesses -> {400} - 6-digit code with unlimited guesses within its 10-minute life. |

### Access control (Superadmin vs HR)

0 pass, 0 fixed, 3 fail, 1 warn

| # | Result | Test | Expected | Actual / notes |
|---:|---|---|---|---|
| 33 | **FAIL** | HR-role user cannot perform Superadmin-only actions: delete employees | 403 | HR user got 200 and deleted an employee - No role checks beyond 'is an admin'. An HR account has the same power as the Superadmin. |
| 34 | **FAIL** | HR-role user cannot read or change payroll/SMTP settings | 403 | HR user got 200 on GET and PUT /api/payroll-settings |
| 35 | **FAIL** | HR-role user cannot export the full database backup (every employee's bank/PAN data) | 403 | HR user got 200 on GET /api/dashboard/export-all - Highest-impact consequence of missing role separation. |
| 36 | **WARN** | HR-role user can read the audit log | depends on policy | 200 - Acceptable if HR is meant to audit, but consider read-only for non-superadmins. |

### Employee directory

20 pass, 1 fixed, 4 fail, 0 warn

| # | Result | Test | Expected | Actual / notes |
|---:|---|---|---|---|
| 37 | PASS | Create employee (valid) | 200/201 |  |
| 38 | PASS | Create second employee (auto-increments code) | 200/201 |  |
| 39 | PASS | Create employee missing required fields -> 422 | 422 |  |
| 40 | PASS | Create employee invalid email -> 422 | 422 |  |
| 41 | **FAIL** | Duplicate email rejected | 400/409/422 | 200 {"id": "afec021ee15d45398b3be1bb3085ccc9", "employee_code": "EMP-013", "full_name": "QA Emp 1", "email": "qa.emp1.1789813726@example.com", "mobile_number": "987 |
| 42 | **FAIL** | Negative base salary rejected | 400/422 | 200 {"id": "3629b436b90446acbbe0b25c970a160d", "employee_code": "EMP-014", "full_name": "QA Emp 4", "email": "qa.emp4.1789813726@example.com", "mobile_number": "987 |
| 43 | **FAIL** | Invalid mobile number (letters) rejected | 400/422 | 200 {"id": "9a0134e29a0745a999badbcb2d0935b7", "employee_code": "EMP-015", "full_name": "QA Emp 5", "email": "qa.emp5.1789813726@example.com", "mobile_number": "abc |
| 44 | **FAIL** | Invalid IFSC code rejected | 400/422 | 200 {"id": "6bc0158a5a35429ca106bc73f62376c1", "employee_code": "EMP-016", "full_name": "QA Emp 6", "email": "qa.emp6.1789813726@example.com", "mobile_number": "987 |
| 45 | PASS | Future joining date rejected or accepted (business rule) | 200/201/400/422 |  |
| 46 | PASS | List employees returns paginated shape | 200 |  |
| 47 | PASS | Search by name | 200 |  |
| 48 | PASS | Filter by department | 200 |  |
| 49 | PASS | Filter by status Active | 200 |  |
| 50 | PASS | Pagination (limit=1,page=2) | 200 |  |
| 51 | PASS | Limit above max (2001) rejected | 422 |  |
| 52 | **FIXED** | Get employee masks bank account by default | 200 | 200 {"id": "758438a2dfe94d339b38d0bae461bb2d", "employee_code": "EMP-011", "full_name": "QA Emp 1", "email": "qa.emp1.1789813726@example.com", "mobile_number": "987 - Fixed: default is now masked. |
| 53 | PASS | Get employee with unmask=true reveals account | 200 |  |
| 54 | PASS | Get unknown employee -> 404 | 404 |  |
| 55 | PASS | Update employee | 200 |  |
| 56 | PASS | Update persisted | 200 |  |
| 57 | PASS | Create throwaway employee | 200/201 |  |
| 58 | PASS | Delete employee | 200/204 |  |
| 59 | PASS | Deleted employee returns 404 | 404 |  |
| 60 | PASS | Bulk create employees | 200/201/422 |  |
| 61 | PASS | Employees list requires auth | 401 |  |

### Recruitment pipeline

17 pass, 0 fixed, 3 fail, 0 warn

| # | Result | Test | Expected | Actual / notes |
|---:|---|---|---|---|
| 62 | PASS | Create candidate (public application form) | 200/201 |  |
| 63 | PASS | Create candidate rejects missing required fields | 422 |  |
| 64 | PASS | Create candidate rejects invalid email | 422 |  |
| 65 | **FAIL** | Duplicate application (same email + position) rejected | 400/409/422 | 200 {"success": true, "message": "Application submitted successfully! Our HR team will contact you shortly.", "candidate_id": "b0c9dd5906e44fc4ad95adce742c22eb"} |
| 66 | **FAIL** | Candidate with invalid phone rejected | 400/422 | 200 {"success": true, "message": "Application submitted successfully! Our HR team will contact you shortly.", "candidate_id": "e52c1190be2748c1b3d1e4c0f76f7cb0"} |
| 67 | PASS | List candidates (admin) | 200 |  |
| 68 | PASS | List candidates requires auth | 401 |  |
| 69 | PASS | Search candidates | 200 |  |
| 70 | PASS | Filter candidates by status | 200 |  |
| 71 | PASS | Get candidate | 200 |  |
| 72 | PASS | Update candidate | 200 |  |
| 73 | PASS | Status change -> Screening | 200 |  |
| 74 | PASS | Status change -> Interview Scheduled | 200 |  |
| 75 | PASS | Status change -> Interviewed | 200 |  |
| 76 | PASS | Status change -> Selected | 200 |  |
| 77 | **FAIL** | Invalid status value rejected | 400/422 | 200 {"id": "04891870a9a549e98f199b52e9c7398c", "candidate_name": "QA Cand 1", "position_applied": "Python Developer", "interview_date": "", "contact_number": "91234 |
| 78 | PASS | Get unknown candidate -> 404 | 404 |  |
| 79 | PASS | Bulk create candidates | 200/201 |  |
| 80 | PASS | Create throwaway candidate | 200/201 |  |
| 81 | PASS | Delete candidate | 200/204 |  |

### Joining tokens and onboarding portal

11 pass, 0 fixed, 2 fail, 1 warn

| # | Result | Test | Expected | Actual / notes |
|---:|---|---|---|---|
| 82 | PASS | Generate joining token | 200/201 |  |
| 83 | PASS | Generate token requires admin auth | 401 |  |
| 84 | PASS | Validate good token | 200 |  |
| 85 | PASS | Validate bad token reports valid=false | 200 |  |
| 86 | PASS | Verify token OTP (wrong code) | 400/401/403 |  |
| 87 | PASS | Verify token OTP (correct code) | 200 |  |
| 88 | **WARN** | Token OTP passed as URL query string | - | verify-token-otp takes token/email/otp as query parameters; these end up in server/proxy access logs. Prefer a JSON body. |
| 89 | PASS | Submit onboarding form (valid) | 200/201 |  |
| 90 | PASS | Token cannot be reused after submission | 400/409/410 |  |
| 91 | PASS | Onboarding rejects invalid Aadhaar (not 12 digits) | 400/422 |  |
| 92 | PASS | Onboarding rejects invalid PAN format | 400/422 |  |
| 93 | **FAIL** | Onboarding rejects when HR policy agreement not accepted | 400/422 | 200 {"success": true, "message": "Onboarding completed and HR Policy Agreement signed successfully! Welcome to Rexera, QA Cand 1.", "submission_id": "2ba1412e9a3146 |
| 94 | PASS | Onboarding rejects invalid IFSC | 400/422 |  |
| 95 | **FAIL** | Onboarding without OTP verification rejected | 400/403 | 200 {"success": true, "message": "Onboarding completed and HR Policy Agreement signed successfully! Welcome to Rexera, QA Cand 1.", "submission_id": "dd2ef50e569147 |

### Interns and trainees

11 pass, 0 fixed, 2 fail, 0 warn

| # | Result | Test | Expected | Actual / notes |
|---:|---|---|---|---|
| 96 | PASS | Create intern | 200/201 |  |
| 97 | PASS | Create intern rejects missing fields | 422 |  |
| 98 | **FAIL** | Create intern rejects end date before start date | 400/422 | 200 {"id": "ad8739ec76de4cd18d59333c0f91acc9", "intern_code": "INT-2026-012", "full_name": "QA Intern 2", "email": "intern2.1789813726@example.com", "mobile_number" |
| 99 | **FAIL** | Create intern rejects negative stipend | 400/422 | 200 {"id": "71a28608fe574e80a845f5f6ba9ab311", "intern_code": "INT-2026-013", "full_name": "QA Intern 3", "email": "intern3.1789813726@example.com", "mobile_number" |
| 100 | PASS | List interns | 200 |  |
| 101 | PASS | Search interns | 200 |  |
| 102 | PASS | Get intern | 200 |  |
| 103 | PASS | Update intern | 200 |  |
| 104 | PASS | Bulk create interns | 200/201 |  |
| 105 | PASS | Convert intern to employee | 200/201 |  |
| 106 | PASS | Converted intern cannot be converted twice | 400/409 |  |
| 107 | PASS | Create throwaway intern | 200/201 |  |
| 108 | PASS | Delete intern | 200/204 |  |

### Attendance and shift rules

12 pass, 0 fixed, 2 fail, 0 warn

| # | Result | Test | Expected | Actual / notes |
|---:|---|---|---|---|
| 109 | PASS | Get attendance config | 200 |  |
| 110 | PASS | Update attendance config (valid) | 200 |  |
| 111 | PASS | Config persisted | 200 |  |
| 112 | **FAIL** | Config rejects grace cutoff earlier than shift start | 400/422 | 200 {"success": true, "message": "Attendance settings updated successfully."} |
| 113 | **FAIL** | Config rejects malformed time | 400/422 | 200 {"success": true, "message": "Attendance settings updated successfully."} |
| 114 | PASS | List attendance (all) | 200 |  |
| 115 | PASS | List attendance by date | 200 |  |
| 116 | PASS | List attendance by month | 200 |  |
| 117 | PASS | List attendance by employee | 200 |  |
| 118 | PASS | Attendance requires auth | 401 |  |
| 119 | PASS | Punch-in / punch-out UI | - | Removed from the Attendance page as requested (buttons, live clock, GPS detection, geofence radius/column). |
| 120 | PASS | Legacy punch-in API (UI removed; API retained) | 200/400/403/422 |  |
| 121 | PASS | Legacy punch-out API | 200/400/403/422 |  |
| 122 | PASS | Punch-in for unknown employee rejected | 400/404 |  |

### Leave management

13 pass, 0 fixed, 1 fail, 0 warn

| # | Result | Test | Expected | Actual / notes |
|---:|---|---|---|---|
| 123 | PASS | Leave balances for employee | 200 |  |
| 124 | PASS | Apply for casual leave | 200/201 |  |
| 125 | PASS | Overlapping leave request rejected | 400/409 |  |
| 126 | PASS | Leave with end date before start rejected | 400/422 |  |
| 127 | **FAIL** | Leave exceeding balance rejected | 400/422 | 201 {"success": true, "message": "Leave application submitted successfully.", "data": {"_id": "0582d7f3d4a14dba8935695aa84fcea3", "employee_id": "EMP-011", "employe |
| 128 | PASS | Leave for unknown employee rejected | 400/404 |  |
| 129 | PASS | Leave with too-short reason rejected | 422 |  |
| 130 | PASS | Invalid leave type rejected | 422 |  |
| 131 | PASS | List leave requests | 200 |  |
| 132 | PASS | Pending leaves dashboard | 200 |  |
| 133 | PASS | Approve leave request | 200 |  |
| 134 | PASS | Deciding an already-decided request rejected | 400/409 |  |
| 135 | PASS | Decision on unknown request -> 404 | 400/404 |  |
| 136 | PASS | Balance is reduced after approval | 200 |  |

### Client productivity, tasks and timesheets

26 pass, 0 fixed, 1 fail, 0 warn

| # | Result | Test | Expected | Actual / notes |
|---:|---|---|---|---|
| 137 | PASS | List clients | 200 |  |
| 138 | PASS | Create client | 201 |  |
| 139 | PASS | Create client rejects invalid email | 422 |  |
| 140 | PASS | Create project | 201 |  |
| 141 | PASS | List projects | 200 |  |
| 142 | PASS | Create task (full API) | 201 |  |
| 143 | PASS | Create task via quick endpoint (New Task modal) | 201 |  |
| 144 | PASS | Quick task re-uses existing client/project (no duplicates) | 200 |  |
| 145 | PASS | Quick task unknown employee -> 404 | 404 |  |
| 146 | PASS | Quick task rejects empty title | 422 |  |
| 147 | PASS | List tasks | 200 |  |
| 148 | PASS | Filter tasks by project | 200 |  |
| 149 | PASS | Log timesheet (valid, 6h) | 201 |  |
| 150 | PASS | Task hours + status updated after timesheet | 200 |  |
| 151 | PASS | Timesheet rejects 0 hours | 422 |  |
| 152 | PASS | Timesheet rejects >24 hours | 422 |  |
| 153 | PASS | Daily cap: 6h + 19h exceeds 24h/day | 400 |  |
| 154 | PASS | Timesheet rejects unknown task | 400 |  |
| 155 | PASS | Timesheet rejects unknown employee | 400 |  |
| 156 | PASS | Timesheet blocked on an approved-leave day | 400 |  |
| 157 | **FAIL** | Timesheet rejects malformed date | 400/422 | 201 {"success": true, "message": "Successfully logged 1.0 hours.", "data": {"_id": "6ad7749206234f409a16b9c467da644e", "employee_id": "EMP-011", "employee_name": "Q |
| 158 | PASS | Timesheet rejects too-short description | 422 |  |
| 159 | PASS | Flag blocker on task | 200 |  |
| 160 | PASS | Flag blocker rejects invalid category | 422 |  |
| 161 | PASS | Flag blocker rejects unknown task | 400/404 |  |
| 162 | PASS | Bird's-eye dashboard reflects logged hours + blocker | 200 |  |
| 163 | PASS | Productivity requires auth | 401 |  |

### Advances, loans, bonuses and overtime

22 pass, 0 fixed, 6 fail, 1 warn

| # | Result | Test | Expected | Actual / notes |
|---:|---|---|---|---|
| 164 | PASS | Issue salary advance (UI 'Issue Salary Advance') | 200/201 |  |
| 165 | PASS | Advance auto-approved with correct balance | 200 |  |
| 166 | PASS | Advance rejects zero amount | 400/422 |  |
| 167 | PASS | Advance rejects negative amount | 400/422 |  |
| 168 | **FAIL** | Advance rejects monthly installment larger than advance | 400/422 | 200 {"id": "08d1c7eb6f854f519f8a6500da8e7064", "advance_id": "REX-ADV-0010", "employee_id": "0ebee23fdf8a4ab3acb0fcbd4da1cbe7", "employee_code": "EMP-012", "employe |
| 169 | PASS | Advance rejects unknown employee | 400/404 |  |
| 170 | **WARN** | Advance far above salary (50x) is flagged/rejected | 400/422 | 200 {"id": "a3591106a8ac4be1a68c7d464ccec1f7", "advance_id": "REX-ADV-0011", "employee_id": "0ebee23fdf8a4ab3acb0fcbd4da1cbe7", "employee_code": "EMP-012", "employe |
| 171 | PASS | List advances + filter by status | 200 |  |
| 172 | PASS | Advance approve endpoint | 200/400/422 |  |
| 173 | PASS | Issue employee loan (UI 'Issue Employee Loan') | 200/201 |  |
| 174 | PASS | Loan total payable includes interest | 200 |  |
| 175 | PASS | Loan rejects negative interest | 400/422 |  |
| 176 | **FAIL** | Loan rejects EMI larger than total payable | 400/422 | 200 {"id": "d5e36c0bb1f642bcb3512ddce77d7df9", "loan_id": "REX-LOAN-0010", "employee_id": "0ebee23fdf8a4ab3acb0fcbd4da1cbe7", "employee_code": "EMP-012", "employee_ |
| 177 | PASS | Loan rejects zero principal | 400/422 |  |
| 178 | **FAIL** | Loan rejects malformed start date | 400/422 | 200 {"id": "1def680b0324452fbd14417e3ee81be2", "loan_id": "REX-LOAN-0011", "employee_id": "0ebee23fdf8a4ab3acb0fcbd4da1cbe7", "employee_code": "EMP-012", "employee_ |
| 179 | PASS | List loans | 200 |  |
| 180 | PASS | Award bonus (UI 'Bonuses & Incentives') | 200/201 |  |
| 181 | PASS | Bonus rejects negative amount | 400/422 |  |
| 182 | PASS | Bonus rejects unknown employee | 400/404 |  |
| 183 | **FAIL** | Bonus rejects invalid month name | 400/422 | 200 {"id": "71b78211e5694ce8806f2ebb60cf9ac9", "bonus_id": "BONUS-0008", "employee_id": "0ebee23fdf8a4ab3acb0fcbd4da1cbe7", "employee_name": "QA Emp 2", "type": "Pe |
| 184 | PASS | List bonuses + filters | 200 |  |
| 185 | PASS | Log overtime (UI 'Overtime Tracker') | 200/201 |  |
| 186 | PASS | Overtime rejects zero hours | 400/422 |  |
| 187 | PASS | Overtime rejects negative hours | 400/422 |  |
| 188 | **FAIL** | Overtime rejects >24 hours in a day | 400/422 | 200 {"id": "6f99bca35d984278b3db3a41995a6c5f", "employee_id": "0ebee23fdf8a4ab3acb0fcbd4da1cbe7", "employee_name": "QA Emp 2", "date": "2054-10-11", "hours": 30.0, |
| 189 | **FAIL** | Overtime rejects malformed date | 400/422 | 200 {"id": "7cda6293a94b4a5fa872bbd477e8a022", "employee_id": "0ebee23fdf8a4ab3acb0fcbd4da1cbe7", "employee_name": "QA Emp 2", "date": "31/12/2026", "hours": 2.0, " |
| 190 | PASS | Overtime rejects unknown employee | 400/404 |  |
| 191 | PASS | List overtime | 200 |  |
| 192 | PASS | Employee dropdown source returns wrapped object (regression check for the UI bug) | 200 |  |

### Payroll engine, payslips and Salary Register

41 pass, 0 fixed, 1 fail, 1 warn

| # | Result | Test | Expected | Actual / notes |
|---:|---|---|---|---|
| 193 | PASS | Salary structure read | 200 |  |
| 194 | PASS | Salary structure update | 200 |  |
| 195 | PASS | Salary structure update persisted | 200 |  |
| 196 | PASS | Salary calculator maths: gross, PF 12% of basic, PT, net | 200 |  |
| 197 | PASS | Salary calculator: LOP deduction (3 of 30 days) | 200 |  |
| 198 | PASS | Salary calculator: PF opt-out | 200 |  |
| 199 | PASS | Salary calculator: net salary in words | 200 |  |
| 200 | **WARN** | Salary calculator rejects LOP days > working days | 400/422 | 200 {"earnings": {"basic": 50000.0, "hra": 0.0, "conveyance": 0.0, "special_allowance": 0.0, "bonus": 0.0, "other_allowances": 0.0, "gross_earnings": 50000.0}, "ded |
| 201 | **FAIL** | Salary calculator rejects negative base salary | 400/422 | 200 {"earnings": {"basic": -1.0, "hra": 0.0, "conveyance": 0.0, "special_allowance": 0.0, "bonus": 0.0, "other_allowances": 0.0, "gross_earnings": -1.0}, "deduction |
| 202 | PASS | Calculate single payroll (Oct 2026) | 200 |  |
| 203 | PASS | Payroll includes advance EMI and loan EMI deductions | 200 |  |
| 204 | PASS | Payroll includes approved bonus | 200 |  |
| 205 | PASS | Payroll includes overtime pay | 200 |  |
| 206 | PASS | Bulk payroll run (Oct 2026) | 200 |  |
| 207 | PASS | Payroll list filters (month/year/status) | 200 |  |
| 208 | PASS | Payroll record read | 200 |  |
| 209 | PASS | Edit payroll record (manual adjustment) | 200 |  |
| 210 | PASS | Approve payroll | 200 |  |
| 211 | PASS | Finalize payroll (creates official slip) | 200 |  |
| 212 | PASS | Finalized payroll is locked against edits | 400/403/409 |  |
| 213 | PASS | Advance balance reduced after finalize | 200 |  |
| 214 | PASS | Loan balance reduced after finalize | 200 |  |
| 215 | PASS | Unlock requires a reason | 422 |  |
| 216 | PASS | Unlock with reason | 200 |  |
| 217 | PASS | Re-finalize after unlock | 200 |  |
| 218 | PASS | Mark payroll paid | 200 |  |
| 219 | PASS | Send payslip email (uses configured SMTP / dev mode) | 200 |  |
| 220 | PASS | Bulk email payslips | 200 |  |
| 221 | PASS | Bank export sheet | 200 |  |
| 222 | PASS | Annual statement for employee | 200 |  |
| 223 | PASS | Payroll dashboard metrics | 200 |  |
| 224 | PASS | Adjust salary component (with reason) | 200 |  |
| 225 | PASS | Adjust salary rejects empty reason | 400/422 |  |
| 226 | PASS | Batch payroll run (legacy 'Run Batch Payroll') | 200 |  |
| 227 | PASS | SALARY REGISTER: slips list returns payroll records | 200 |  |
| 228 | PASS | SALARY REGISTER: search by employee | 200 |  |
| 229 | PASS | SALARY REGISTER: summary totals match slips | 200 |  |
| 230 | PASS | SALARY REGISTER: slip detail | 200 |  |
| 231 | PASS | SALARY REGISTER: printable payslip HTML renders | 200 + name |  |
| 232 | PASS | Generate payslip (UI 'Generate Official Payslip') | 200 |  |
| 233 | PASS | Generated payslip appears in register | 200 |  |
| 234 | PASS | Finalized/paid payroll cannot be deleted from register | 400 |  |
| 235 | PASS | Payroll endpoints require auth | 401 |  |

### Payroll settings and SMTP

8 pass, 0 fixed, 0 fail, 1 warn

| # | Result | Test | Expected | Actual / notes |
|---:|---|---|---|---|
| 236 | PASS | Read company payroll settings | 200 |  |
| 237 | PASS | Update payroll settings | 200 |  |
| 238 | PASS | Settings persisted | 200 |  |
| 239 | PASS | SMTP test email endpoint (dev mode => simulated) | 200 |  |
| 240 | PASS | Audit log listing | 200 |  |
| 241 | PASS | Email log listing | 200 |  |
| 242 | PASS | Settings require auth | 401 |  |
| 243 | **WARN** | SMTP password stored in the database | - | Payroll settings persist the SMTP password as a plain field in the payroll_settings collection and return it in GET /api/payroll-settings. Prefer env-only secrets, or mas |
| 244 | PASS | GET settings does not leak the SMTP password | empty/masked |  |

### Performance reports and exports

10 pass, 0 fixed, 4 fail, 3 warn

| # | Result | Test | Expected | Actual / notes |
|---:|---|---|---|---|
| 245 | PASS | Company-wide report preview (this month) | 200 |  |
| 246 | PASS | Company report: custom date range | 200 |  |
| 247 | PASS | Company report: last quarter / YTD presets | 200 |  |
| 248 | PASS | Company report rejects invalid preset | 422 |  |
| 249 | **WARN** | Company report: custom range without dates | 400/422 | 200 {"company_name": "Rexera Technologies", "date_range_label": "2026-09-01 to 2026-09-19", "start_date": "2026-09-01", "end_date": "2026-09-19", "total_active_empl |
| 250 | **WARN** | Company report: end date before start date | 400/422 | 200 {"company_name": "Rexera Technologies", "date_range_label": "2026-12-31 to 2026-01-01", "start_date": "2026-12-31", "end_date": "2026-01-01", "total_active_empl |
| 251 | PASS | Individual report preview | 200 |  |
| 252 | PASS | Individual report unknown employee -> 404 | 400/404 |  |
| 253 | PASS | Export Company Wide as EXCEL produces a downloadable, valid file [Multi-Sheet Excel button (company scope)] | job accepted + file downloads |  |
| 254 | PASS | Export Individual as PDF produces a downloadable, valid file [Download PDF Report button (individual scope)] | job accepted + file downloads |  |
| 255 | **FAIL** | Export Company Wide as PDF produces a downloadable, valid file [Download PDF Report button (company scope)] | job accepted + file downloads | queue=202 download=404 46B - Job is accepted and reported as started/COMPLETED but no file is ever generated for this scope/format combination. |
| 256 | **FAIL** | Export Company Wide as CSV produces a downloadable, valid file [CSV export] | job accepted + file downloads | queue=202 download=404 46B - Job is accepted and reported as started/COMPLETED but no file is ever generated for this scope/format combination. |
| 257 | **FAIL** | Export Individual as EXCEL produces a downloadable, valid file [Multi-Sheet Excel button (individual scope)] | job accepted + file downloads | queue=202 download=404 46B - Job is accepted and reported as started/COMPLETED but no file is ever generated for this scope/format combination. |
| 258 | **FAIL** | Export Individual as CSV produces a downloadable, valid file [CSV export (individual)] | job accepted + file downloads | queue=202 download=404 46B - Job is accepted and reported as started/COMPLETED but no file is ever generated for this scope/format combination. |
| 259 | **WARN** | Individual export requires employee_id | 400/422 | 202 {"success": true, "job_id": "33006bd6-85b1-4a40-9e79-f98e3d69ff9a", "message": "Report generation has started in the background. You will receive an email once |
| 260 | PASS | Download unknown job -> 404 | 404 |  |
| 261 | PASS | Reports require auth | 401 |  |

### Smart Bulk Import

10 pass, 1 fixed, 1 fail, 0 warn

| # | Result | Test | Expected | Actual / notes |
|---:|---|---|---|---|
| 262 | PASS | Upload CSV and get auto-mapped columns | 200 + file_id + 3 rows |  |
| 263 | PASS | Dry-run import validates rows without writing | 200/202 |  |
| 264 | PASS | Execute import (real) | 200/202 |  |
| 265 | PASS | Poll import job status | 200 |  |
| 266 | PASS | Error report available for rejected rows | 200/404 |  |
| 267 | **FIXED** | Imported employees visible in directory | 200 | 200 {"total": 0, "page": 1, "limit": 20, "employees": []} - Fixed: import writes valid employee records. |
| 268 | PASS | Import job unknown id -> 404 | 404 |  |
| 269 | PASS | Upload rejects non-spreadsheet file types | 400/415/422 |  |
| 270 | PASS | Upload rejects empty file | 400/422 |  |
| 271 | PASS | Attendance-log import target: clean error (not a server crash) | 400 unsupported | Enum advertises ATTENDANCE_LOGS/CLIENT_PROJECTS but only EMPLOYEES and LEAVE_BALANCES are implemented. |
| 272 | **FAIL** | Attendance data source after punch widget removal | some way to record attendance | No UI or import path creates attendance records - With punching removed the Attendance Log stays empty, so LATE/HALF-DAY rules, 3-lates penalty and payroll LOP inputs receive no data. Needs manual entry or CSV import. |
| 273 | PASS | Bulk import requires auth | 401 |  |

### Company broadcasts

8 pass, 0 fixed, 0 fail, 2 warn

| # | Result | Test | Expected | Actual / notes |
|---:|---|---|---|---|
| 274 | PASS | Publish broadcast to all employees | 200/201/202 |  |
| 275 | PASS | Publish rejects empty title | 400/422 |  |
| 276 | PASS | Publish rejects invalid priority | 422 |  |
| 277 | PASS | Department-targeted broadcast | 200/201/202 |  |
| 278 | PASS | Custom-list broadcast | 200/201/202 |  |
| 279 | PASS | In-app notifications list | 200 |  |
| 280 | PASS | Broadcast analytics | 200 |  |
| 281 | **WARN** | Acknowledge broadcast | 200 | 400 {"detail": "Receipt record not found for this employee."} |
| 282 | **WARN** | Broadcast HTML is stored unsanitised | - | publish status 202 - Feed title is now escaped (fixed). The body (rich_html_content) is still stored and emailed as raw HTML; sanitise it or restrict to a safe tag allow-list. |
| 283 | PASS | Broadcast endpoints require auth | 401 |  |

### Activity logs

7 pass, 0 fixed, 0 fail, 0 warn

| # | Result | Test | Expected | Actual / notes |
|---:|---|---|---|---|
| 284 | PASS | List activity logs (paginated) | 200 |  |
| 285 | PASS | Filter logs by action | 200 |  |
| 286 | PASS | Search logs | 200 |  |
| 287 | PASS | Filter logs by date range | 200 |  |
| 288 | PASS | Export logs as CSV | 200 + data |  |
| 289 | PASS | Logs require auth | 401 |  |
| 290 | PASS | Logs do not contain passwords / OTP codes | no secrets |  |

### Dashboard and backup

4 pass, 0 fixed, 0 fail, 0 warn

| # | Result | Test | Expected | Actual / notes |
|---:|---|---|---|---|
| 291 | PASS | Dashboard metrics | 200 |  |
| 292 | PASS | Metrics payload keys | - | Dashboard metrics returns: total_candidates, active_employees, active_interns, pending_onboarding, total_payroll_processed, candidates_by_status, employees_by_department, |
| 293 | PASS | Export-all backup | 200 |  |
| 294 | PASS | Dashboard requires auth | 401 |  |

### Platform and web security

2 pass, 0 fixed, 2 fail, 1 warn

| # | Result | Test | Expected | Actual / notes |
|---:|---|---|---|---|
| 295 | PASS | Health endpoint | 200 |  |
| 296 | PASS | Swagger docs page available | 200 |  |
| 297 | **WARN** | Public API docs (/docs, /openapi.json) exposed | - | The full API surface is visible to anyone. Consider disabling in production (docs_url=None) or protecting it. |
| 298 | **FAIL** | CORS restricted to trusted origins | specific origin | Access-Control-Allow-Origin: https://evil.example - CORS_ORIGINS defaults to * (any website can call the API from a browser). |
| 299 | **FAIL** | Security headers present (nosniff, frame options, CSP, HSTS) | all present | missing: ['x-content-type-options', 'x-frame-options', 'content-security-policy', 'strict-transport-security'] - Add via middleware (or Render/Cloudflare headers). |

### Browser (UI) end-to-end checks

11 pass, 17 fixed, 0 fail, 0 warn

| # | Result | Test | Expected | Actual / notes |
|---:|---|---|---|---|
| 300 | PASS | Admin login with password + 2FA code entry (6 OTP boxes, key-by-key entry) | works |  |
| 301 | PASS | Attendance page: punch buttons, live clock, GPS text, geofence radius and geofence column removed | works |  |
| 302 | PASS | Attendance page: policies card mirrors saved Shift & Grace settings | works |  |
| 303 | PASS | Approved leave shows as ON_LEAVE rows in the attendance log | works |  |
| 304 | **FIXED** | Advances & Loans > Issue Salary Advance: employee dropdown loads and form submits | works after fix | Dropdown had 'Loading active employees...' forever; now lists employees and creates advance - Front end treated the paginated {employees:[...]} response as an array. |
| 305 | **FIXED** | Advances & Loans > Issue Employee Loan: employee dropdown loads and form submits | works after fix | Same root cause as advances |
| 306 | **FIXED** | Advances & Loans > Bonuses & Incentives: dropdown + submit | works after fix | Same root cause |
| 307 | **FIXED** | Advances & Loans > Overtime Tracker: dropdown + submit | works after fix | Same root cause |
| 308 | **FIXED** | Client Productivity > Log Daily Client Timesheet | works after fix | Task dropdown was always empty (no way to create tasks) - added New Task modal; timesheet now saves (6h logged, dashboard shows 6.0 billed hours) - Also relaxed the attendance-record requirement, which could no longer be met without punching. |
| 309 | **FIXED** | Salary Register lists payslips, summary and printable slip | works after fix | Register was always empty (read an unused collection). Now lists payroll records; PF total is real (was an estimate). |
| 310 | **FIXED** | Generate Payslip creates an official, finalized payslip | works after fix | Previously produced a record with no slip and no advance/loan recovery commit |
| 311 | **FIXED** | Sideways scrolling on 18 admin pages at 1366 / 1024 / 768 / 390 px | works after fix | Employees and Payroll overflowed on laptop screens; 7 pages overflowed on phones. Now 0 overflow at every width. - Root cause: flex child without min-width:0, plus non-wrapping filter rows, fixed 4-column grids and fixed-width charts. |
| 312 | **FIXED** | Stale CSS/JS after deploys (browser served old files) | works after fix | 10 pages linked assets without a version parameter; all links now versioned |
| 313 | **FIXED** | Activity Logs page loads | works after fix | Page called /api/logs (no trailing slash) and got 404; the table never loaded |
| 314 | **FIXED** | Leaves / Performance Reports / Payslip employee dropdowns show all employees | works after fix | Only the first 20 (Payslip: 200) employees were selectable; now up to 2000 |
| 315 | **FIXED** | Company Broadcasts history table lists all broadcasts | works after fix | Table was hard-coded to the seed broadcast REX-BCAST-0001; new broadcasts never appeared. Added GET /api/broadcasts. |
| 316 | PASS | Payslip generator UI: live salary preview + Generate Official Payslip + printable slip | works |  |
| 317 | PASS | Leave Management UI: apply for leave, approve from pending queue | works |  |
| 318 | PASS | Payroll Operations UI: Run Batch Payroll | works |  |
| 319 | PASS | Company Broadcasts UI: publish | works |  |
| 320 | PASS | Add Employee UI: create employee with salary preview | works |  |
| 321 | PASS | Client Productivity UI: New Task modal creates task and refreshes the dropdown | works |  |
| 322 | PASS | No failed network requests or console errors on 21 of 22 pages | works |  |
| 323 | **FIXED** | Employee directory / dropdowns crash (HTTP 500) when one malformed employee record exists | works after fix | A record created by Smart Bulk Import broke GET /api/employees for everyone (directory, attendance filter, all dropdowns) - Import now writes valid records and the API tolerates legacy malformed ones. |
| 324 | **FIXED** | Smart Bulk Import (Employees) creates usable employee records | works after fix | Wrote a different schema (employee_id/name/phone), mapped IFSC code to Employee ID and silently overwrote records; now maps correctly, fills required fields, validates ro |
| 325 | **FIXED** | Employee codes stay unique after deleting an employee | works after fix | Codes came from count+1, so EMP-034 was issued twice after a delete |
| 326 | **FIXED** | Bank account masked by default in GET /employees/{id} | works after fix | Default was unmasked, contradicting the documented behaviour |
| 327 | **FIXED** | Unsupported import target returns 400 (was HTTP 500) | works after fix | ATTENDANCE_LOGS / CLIENT_PROJECTS advertised by the API but not implemented |

### Regression checks for defects fixed during QA

10 pass, 0 fixed, 0 fail, 0 warn

| # | Result | Test | Expected | Actual / notes |
|---:|---|---|---|---|
| 328 | PASS | Employee codes stay unique after a deletion | unique code |  |
| 329 | PASS | Bank account is masked by default in GET /employees/{id} | 200 |  |
| 330 | PASS | Bank account visible only with unmask=true | 200 |  |
| 331 | PASS | Employee directory survives a legacy/malformed record | 200 |  |
| 332 | PASS | Bulk import auto-maps columns to the correct employee fields | correct mapping |  |
| 333 | PASS | Bulk import inserts valid rows and rejects invalid rows | 1 inserted, 1 failed |  |
| 334 | PASS | Imported employee appears in the directory with full details | 200 |  |
| 335 | PASS | Payroll can be calculated for an imported employee | 200 |  |
| 336 | PASS | Unsupported import target returns 400 instead of crashing (500) | 400 |  |
| 337 | PASS | Salary Register lists finalized payslips | 200 |  |

### Security fixes verified during QA

2 pass, 2 fixed, 0 fail, 0 warn

| # | Result | Test | Expected | Actual / notes |
|---:|---|---|---|---|
| 338 | PASS | Public candidate form still accepts legitimate names (apostrophes preserved as typographic marks) | 200 + Sean O’Neil |  |
| 339 | PASS | Employee onboarding submission still works after input sanitising | 200 |  |
| 340 | **FIXED** | Stored XSS: script in the public candidate form no longer runs in the HR admin's browser | no script execution | Verified in browser with tag, attribute and JS-string breakout payloads plus a pre-existing stored payload - CRITICAL when found: an unauthenticated visitor could run script in an admin session and steal the login token. Fixed by neutralising markup characters on the public form |
| 341 | **FIXED** | Stored XSS via broadcast title in the admin notification feed | escaped | Title is now HTML-escaped when rendered - Broadcast body is still stored as raw HTML and emailed as raw HTML. |

### Security observations (open)

0 pass, 0 fixed, 0 fail, 1 warn

| # | Result | Test | Expected | Actual / notes |
|---:|---|---|---|---|
| 342 | **WARN** | Other admin pages render user-entered values without escaping | escaped everywhere | Employees, Interns, Leaves, Payroll, Advances, Productivity, Dashboard tables still use unescaped innerHTML templates - Only reachable through data an admin/HR user (or an imported file) supplies. Apply escapeHtml() (now available globally in api.js) to those templates. |

## 7. Files changed during QA

Backend: `database.py`, `routers/` (broadcast, bulk_import, employees, logs, payroll, productivity), `schemas/` (bulk_import, candidate, joining), `services/` (employee_service, import_execution_engine, productivity_service), new `utils/sanitize.py`.

Frontend: `attendance`, `productivity`, `advances-loans`, `candidates`, `broadcasts`, `bulk-import`, `leaves`, `performance-reports`, `salary`, `dashboard` scripts; `api.js` (shared `escapeHtml`); `main.css`, `tables.css`, `dashboard.css`, `responsive.css`; and every HTML page (asset version bump so browsers load the new files).

