# Atolls HR Portal

Full-stack JavaScript application for the Atolls contractor division. Next.js App Router and React provide the UI and HTTP routes; Node's SQLite driver stores employee records, opaque sessions, leaves, meetings, work tickets, audit events and notifications. No TypeScript or external database service is required.

## Run locally

Install **Node.js 24 or newer**. From this project directory:

```bash
npm ci
cp .env.example .env.local
```

Edit `.env.local`. Set `COMPANY_DOMAIN` to your actual Google Workspace domain and `ADMIN_EMAIL` to a Google account on that domain. This account becomes the initial RH administrator. Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` as explained below. Then:

```bash
npm run seed
npm run dev
```

Open http://localhost:3000. Sign in as the seeded administrator and complete the onboarding profile. The seed command creates five departments, three rooms, and the administrator; it does not create fake employees or sample activity. Re-running the seed does not overwrite existing accounts or reactivate inactive employees.

## Google OAuth configuration

1. Create a Google Cloud OAuth application for your organization and configure its consent screen. Use the Internal audience where your Workspace organization supports it.
2. Create an OAuth client of type **Web application**.
3. Add `http://localhost:3000` as an authorized JavaScript origin and `http://localhost:3000/api/auth/callback` as an authorized redirect URI.
4. Copy the client ID and client secret into `.env.local`.
5. Set `APP_URL` to the exact origin, including the port locally. For production use your HTTPS origin and register the corresponding `/api/auth/callback` URL in Google.

The app implements authorization code flow with PKCE, state, nonce, and signature verification through Google's public keys. It checks issuer, audience, expiration, verified email, exact email domain and the Google Workspace `hd` claim. The authorization `hd` hint alone does not grant access.

First-time verified company users automatically receive **Dev** access and must complete onboarding. HR can pre-create employees and assign their department, role and supervisor. An email already bound to a different Google subject cannot be reused silently. No developer login bypass is included.

## Workflows

- **Dashboard:** live counts, visible leave requests, office calendar, recent activity and today's meetings.
- **Employees:** active employee directory for everyone; full records, profile edits, departments, access roles, supervisor assignment and deactivation for RH.
- **Departments & Roles:** organization directory, department creation and documented role scopes.
- **Leave:** requests, duplicate-date detection, scoped approvals, status tracking and supervisor/employee notifications. Self-approval is blocked, including for RH; another authorized reviewer must approve.
- **Availability & Holidays:** employees update their daily status; RH maintains office holiday dates. Usual office days and hours are stored in profile preferences.
- **Meetings & Rooms:** room creation, bookings, capacity checks, attendee invitations and cancellation notifications. Times are entered in the user's local timezone, stored as UTC and displayed in local time. Booking conflict checks and inserts run together inside a SQLite write transaction.
- **Work Tickets:** assignment, priority, descriptions and status changes, restricted by access scope.
- **Activity Logs:** persistent audit trail; RH sees the latest 200 workspace events, other users see their own latest 100 events. Older events remain in the database.
- **Profile & Settings:** onboarding, profile editing, office days/hours, light/dark themes, language preference, notifications and sign-out.

## Permissions and account security

| Role | Access |
| --- | --- |
| Dev | Own profile, own leave, own/created tickets, shared active directory and room bookings |
| Owner | Dev access plus leave review and ticket assignment for direct reports |
| RH | Employee/department/room/holiday management, all leave review, all tickets and workspace audit log |

Permissions are enforced in the service layer; hiding a UI button is not the access control. Each request reads the current employee record from the database. Sessions are random opaque tokens, stored as SHA-256 hashes with expiration. Cookies are HttpOnly and SameSite=Lax; production cookies are Secure. Mutating requests require the configured origin. Deactivation removes sessions, and inactive records cannot authenticate even with valid Google credentials. An inactive Google login persists a security event and notifies the supervisor, falling back to active RH administrators when no active supervisor exists.

Self-deactivation and self-demotion of RH users are blocked. Supervisors cannot be deactivated or demoted to Dev until their active reports are reassigned. Supervisor cycles are rejected.

## Notifications and email

In-app notifications are saved transactionally with requests and security events. Email uses an outbox in the same database; notifications are queued even when SMTP is unavailable.

For delivery, configure `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_FROM`, and optionally `SMTP_USER` / `SMTP_PASS`. Run a separate worker alongside the Next.js server:

```bash
npm run worker
```

Alternatively, `npm run notify` makes one delivery pass. Without SMTP, emails remain queued; in-app notifications are still available. The worker retries failed emails, uses atomic claims, and recovers abandoned claims. Delivery is at least once: a crash after SMTP accepts an email but before its status is saved can result in a duplicate. Inactive recipients do not receive email.

Production processes can use `node scripts/worker.js` and `node scripts/seed.js` with environment variables provided by the host instead of `.env.local`.

## Build and test

```bash
npm test
npm run build
npm start
```

Tests use a separate temporary database. They exercise Google domain/identity policy, onboarding, scoped reads, unauthorized mutations, self-review prevention, leave notifications, room overlap checks, session revocation, inactive-login security notifications, invalid input and transactional access guards.

## Hosting

Use a **single persistent Node.js host** with writable storage. SQLite is appropriate for this internal-tool baseline; do not place the app on an ephemeral filesystem or run replicas with separate databases. Keep the database and its WAL files on the same durable volume and take regular backups. A future multi-instance deployment should migrate to a shared relational database and distributed job queue.

A Dockerfile is included:

```bash
docker build -t atolls-hr .
docker volume create atolls-data
docker run --rm --env-file .env.local -v atolls-data:/data atolls-hr node scripts/seed.js
docker run -d --name atolls-hr --env-file .env.local -p 3000:3000 -v atolls-data:/data atolls-hr
docker run -d --name atolls-mail --env-file .env.local -v atolls-data:/data atolls-hr node scripts/worker.js
```

For these production containers, use an HTTPS `APP_URL` and a reverse proxy with TLS in front of port 3000. Secure cookies will not authenticate over plain HTTP. Do not set `DB_PATH` in the environment file when using the default Docker volume path, or set it to `/data/atolls.sqlite`.

## Current scope

This is an implemented starter application, not a configured live company deployment. Real OAuth and SMTP delivery require your organization's credentials. The UI is English; Deutsch/Français preferences are stored but translations are not yet implemented. Availability is manually updated rather than calculated from a recurring schedule. Leave totals count Monday–Friday; entitlement accrual, statutory holiday exclusions, partial days and payroll integrations are not implemented. The initial database schema initializes automatically; future schema changes need explicit versioned migrations. Audit events currently have no export or pagination UI. Meeting invitations are portal/email notifications, not Google Calendar events. Google OAuth and SMTP end-to-end checks must be completed with your own accounts before rollout.

## Project structure

```text
app/portal.js                    React UI
app/globals.css                  Responsive light/dark styling
app/api/portal/route.js          Authenticated read/mutation API
app/api/auth/google/route.js     OAuth initiation
app/api/auth/callback/route.js   Verified OAuth callback
app/api/auth/logout/route.js     Session revocation
lib/db.js                       SQLite schema and transaction helpers
lib/service.js                  Validated business operations and scoped reads
lib/policy.js                   Access rules
lib/identity.js                 Google identity and inactive-account handling
lib/session.js                  Session cookies and active-account checks
lib/notifications.js            SMTP outbox delivery
scripts/                        Seed and email worker commands
tests/security.test.js          Security and workflow regression tests
```
