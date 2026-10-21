# Validation — Departments and Roles update

- `npm test`: **46 tests passed**. Tests cover role-scoped reads and mutations, leave review/notifications, room conflicts, account deactivation, session revocation, inactive Google identity alerts, onboarding, SMTP delivery, async transaction rollback and request isolation, missing database configuration, and valid/empty/non-JSON HTTP response handling.
- Tests execute database operations through the asynchronous `@libsql/client` API with isolated temporary local libSQL databases. Production imports `@libsql/client/http` and never opens a local file.
- Next.js 16.4.0 production build: passed, including compilation and route generation, with no Turso or Google credentials available. Build does not initialize a database.
- Production HTTP smoke checks: landing page returns 200, unauthenticated portal returns JSON 401, unconfigured health endpoint returns diagnostic JSON 503, and missing Google configuration redirects safely.
- `npm audit --omit=dev`: zero reported vulnerabilities at verification time.

The execution workspace cannot expose Node's resident-memory metrics. Build and HTTP verification used a temporary environment-only shim for that reporting API; it is not included in this project. No database/authentication behavior was bypassed. The test server was bound explicitly to loopback because this environment restricts network-interface enumeration.

No live Turso credentials were available, so the actual hosted database, setup/seed commands against that database and Netlify deployment must be verified after configuration using `npm run db:check` and `/api/health`. Google sign-in with company accounts and company SMTP delivery also need your credentials. The included Netlify scheduled notification function follows the documented JavaScript format but was not deployed or triggered in Netlify here. Docker execution was not repeated in this environment.

## One-time Netlify initialization update

The test suite now also covers opt-in production-only setup, preflight administrator-domain validation, complete schema/seed creation, repeatability without overwriting profiles, refusal to reactivate existing accounts, and credential redaction in diagnostic logs. Production build through the new scripts/build.js entry point passed with initialization disabled. The initialization path was exercised against an isolated libSQL database; it was not run against the user's live Turso database or Netlify account. Health responses now distinguish missing schema, missing administrator, and missing configuration.

## External administrator update

Only the exact Google-verified ADMIN_EMAIL account may be outside COMPANY_DOMAIN. The account must be explicitly seeded as RH; there is no automatic privilege grant during sign-in. Other employees still require the exact Google Workspace domain and hd claim. Tests cover external administrator provisioning/sign-in, unverified and non-allowlisted external rejection, Google subject binding, inactive-account blocking/security notifications, and the account chooser domain hint. The production build passed. Google OAuth Audience must permit external accounts for a live external administrator; live Google verification remains to be performed with the configured account.

## Departments and Roles update

Eight additional automated tests cover legacy-schema migration without data/session loss, repeatable setup, Employee/Manager assignment with the legacy role constraint, Manager direct-report review, permission validation, protected system roles, custom role lifecycle and assignment, scope/permission escalation rejection, and own-role protection. The production build passed.

Production browser checks used an isolated libSQL database and real service operations behind an intercepted portal API, without changing application authentication. Checks passed for separate navigation, all five system roles, the 32-checkbox matrix, custom role creation/editing/deletion, role choices in the employee form, dark/light themes, mobile layouts, no JavaScript errors and no page overflow. These checks do not validate live Google OAuth or a hosted Turso migration.

## Role actions and Manager checkbox update

Role actions now include system-role permission editing and deletion of unused optional system roles. The required Employee/RH roles, fixed system names, own-role edits and roles assigned to employees remain protected. Two additional tests cover manager-only supervisor assignment, independent checkbox changes, reporting-line protection, repeatable manager migration, and persistence of deleted optional roles. Security fixtures explicitly mark supervisors as managers.

The updated browser checks also verify Edit/Delete controls on all five system cards, saving the Manager checkbox without a supervisor, checkbox persistence, and a Team Leader list that includes a checked employee and excludes an unchecked employee. Supervisor is optional in the form.

## Monthly Work Tickets calculator

Eight additional tests cover the October reference (31 − 9 − 3 = 19), duplicate holidays and overlapping leave, approved-only leave clipped across months/years, leap February and full-month leave, invalid periods, employee/manager personal-only report access, HR totals including inactive employees, and reloading current access to reject stale privileges/inactive accounts. Calculations use UTC date-only arithmetic. Next.js production build passed with the new authenticated `/api/work-days` route. No hosted database or Netlify deployment was performed.

Browser checks passed against the production build with isolated libSQL fixtures and the real report service: reference calculation, HR employee selection/search and aggregate totals, month/year changes and leap February, employee personal-only view, light/dark themes, mobile layouts, no page overflow or JavaScript errors. The actual unauthenticated report endpoint returned JSON 401. Browser checks used intercepted authenticated API requests; live Google OAuth/Netlify/Turso were not exercised.
