# Validation — Turso update

- `npm test`: **17 tests passed**. Tests cover role-scoped reads and mutations, leave review/notifications, room conflicts, account deactivation, session revocation, inactive Google identity alerts, onboarding, SMTP delivery, async transaction rollback and request isolation, missing database configuration, and valid/empty/non-JSON HTTP response handling.
- Tests execute database operations through the asynchronous `@libsql/client` API with isolated temporary local libSQL databases. Production imports `@libsql/client/http` and never opens a local file.
- Next.js 16.4.0 production build: passed, including compilation and route generation, with no Turso or Google credentials available. Build does not initialize a database.
- Production HTTP smoke checks: landing page returns 200, unauthenticated portal returns JSON 401, unconfigured health endpoint returns diagnostic JSON 503, and missing Google configuration redirects safely.
- `npm audit --omit=dev`: zero reported vulnerabilities at verification time.

The execution workspace cannot expose Node's resident-memory metrics. Build and HTTP verification used a temporary environment-only shim for that reporting API; it is not included in this project. No database/authentication behavior was bypassed. The test server was bound explicitly to loopback because this environment restricts network-interface enumeration.

No live Turso credentials were available, so the actual hosted database, setup/seed commands against that database and Netlify deployment must be verified after configuration using `npm run db:check` and `/api/health`. Google sign-in with company accounts and company SMTP delivery also need your credentials. The included Netlify scheduled notification function follows the documented JavaScript format but was not deployed or triggered in Netlify here. Interactive browser checks and Docker execution were not repeated in this environment.
