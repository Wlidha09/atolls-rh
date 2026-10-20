# Atolls HR Portal — Turso + Netlify

Full-stack JavaScript with Next.js App Router, Google Workspace OAuth and a remote **Turso libSQL** database. The server uses the HTTP client: no local SQLite file, writable disk or `node:sqlite` dependency is used in production. Database access, business operations, sessions, audits and notification outbox operations are asynchronous.

## Update an existing Netlify site: Departments and Roles

1. Replace the source in your connected repository with this complete updated project, preserving your own changes. Keep your existing Netlify environment variables.
2. Add `INITIALIZE_DATABASE=true` with **Builds** scope and **Production** context for one production deployment. `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` must remain available to **Builds and Functions**.
3. Deploy. This adds the role tables, Employee and Manager, and an optional employee role reference. Existing employee records, assigned Dev/Owner/RH roles and sessions are preserved.
4. After the deployment succeeds, remove `INITIALIZE_DATABASE` and verify `/api/health` returns ready.

The Roles page follows the supplied dark card and permission-matrix design. Default permissions preserve the existing application behavior: Employee matches Dev, Manager matches Owner, and RH retains organization administration. New company signups receive Employee. Custom roles can be created, edited and assigned from the employee form.

## Netlify setup without a terminal

If you have already created a Turso libSQL database, you can initialize the application during one production Netlify deployment:

1. Update the source in the repository connected to Netlify with this project. Keep the build command `npm run build`; it now includes an optional setup step.
2. In Netlify environment variables, verify `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` are available to both Builds and Functions in the Production context.
3. Set `ADMIN_EMAIL` to the exact Google account that should be the initial administrator. Its domain may differ from `COMPANY_DOMAIN`, including a personal Gmail address.
4. Add `INITIALIZE_DATABASE=true`, with Builds scope and Production context only.
5. Trigger a production deployment. Its build log should say `Database setup complete.` before the Next.js build begins.
6. Remove `INITIALIZE_DATABASE` after this deployment succeeds. Future builds then do not touch the database.
7. Open your site's `/api/health`. It should return `{"ok":true,"database":"ready"}`. Then sign in with the seeded administrator and complete onboarding.

Setup creates missing tables, departments, rooms and the configured initial administrator. It does not delete records, reset accounts, change existing roles, or reactivate employees. Preview/branch builds and local builds cannot use this automatic setup option. If setup fails, deployment stops and the existing deployed site is left in place. Setup is idempotent and includes the additive roles migration described below; future schema changes still need explicit migrations.

The documentation uses generic example domains so the application's public site URL and company domain are not repeated in these files. Keep secret scanning enabled. Only actual credentials need to be marked as secrets.

## 1. Create a Turso account and libSQL database

Visit https://turso.tech/ and create an account. Install the Turso CLI using the instructions at https://docs.turso.tech/cli/installation (macOS, Linux, or WSL on Windows). Then open a terminal:

```bash
turso auth login
turso db create atolls-hr
turso db show atolls-hr --url
turso db tokens create atolls-hr
```

Use `turso auth signup` instead of `login` if you still need to register. This project uses **libSQL**. Omit the `--tursodb` flag: that flag selects Turso's other engine and SDK. Copy the exact URL returned by the CLI and the database access token. Keep the token private.

## 2. Install this updated project

Install Node.js **24**, extract the archive, and open a terminal inside `atolls-hr`, where `package.json` lives:

```bash
npm ci
```

Use this entire updated project, not only `lib/db.js`: the service, OAuth callback, sessions, tests and scripts also changed to use async database calls. Preserve your own uncommitted customizations when replacing an existing checkout. This archive contains no real credentials.

## 3. Create `.env.local`

Copy `.env.example` to `.env.local` in the project root. On macOS/Linux/WSL:

```bash
cp .env.example .env.local
```

On Windows PowerShell:

```powershell
Copy-Item .env.example .env.local
```

Edit `.env.local`:

```env
APP_URL=http://localhost:3000
TURSO_DATABASE_URL=libsql://COPY-THE-EXACT-URL-FROM-TURSO
TURSO_AUTH_TOKEN=YOUR-DATABASE-TOKEN
GOOGLE_CLIENT_ID=YOUR-GOOGLE-OAUTH-CLIENT-ID
GOOGLE_CLIENT_SECRET=YOUR-NEW-GOOGLE-OAUTH-CLIENT-SECRET
COMPANY_DOMAIN=example.com
ADMIN_EMAIL=YOUR-ADMIN@example.net
```

`ADMIN_EMAIL` may be a Google account on a different domain, including Gmail. Only this exact verified address is exempt from the employee domain restriction. No variables in this list need `NEXT_PUBLIC_`. Do not commit `.env.local` or share its contents. If a credential has previously been shared, replace it before use.

## 4. Initialize the remote database once

These commands operate on the **remote Turso database configured in `.env.local`**:

```bash
npm run db:setup
npm run seed
npm run db:check
```

Expected final output: `Database connection, tables and administrator: OK.`

`db:setup` creates missing tables; `seed` creates the initial RH administrator, five departments and three rooms. These commands are repeatable: they do not clear tables, overwrite employee profiles or reactivate inactive accounts. For Netlify, use the one-time setup flag above and remove it afterward. Do not expose setup as a public web endpoint. `ADMIN_EMAIL` alone does not create an account; the seed command must run.

This starts a fresh remote database. Existing SQLite data is not imported automatically. If you have records to retain, back up the original database and plan a separate data import before switching production.

## 5. Configure Google OAuth

In Google Cloud Console → Google Auth Platform:

1. Configure Branding and Audience. If ADMIN_EMAIL is outside your Workspace organization, select External. While the app is in Testing, add the administrator and any required employee test accounts under Test users. Use Internal only when every allowed account belongs to that organization.
2. Open Clients → Create client → Web application.
3. Add the production authorized JavaScript origin:

```text
https://your-site.netlify.app
```

4. Add this exact authorized redirect URI:

```text
https://your-site.netlify.app/api/auth/callback
```

For local testing, also add origin `http://localhost:3000` and redirect URI `http://localhost:3000/api/auth/callback`.

Copy the OAuth client ID and current client secret into the server environment. Database tokens and Google OAuth credentials are separate. Ordinary employees must have a verified Workspace identity with `hd` matching `COMPANY_DOMAIN`. The exact verified `ADMIN_EMAIL` address is an exception and may be outside that domain; it must be explicitly seeded as RH before signing in. Other personal accounts remain blocked. For an external administrator, set Google Auth Platform Audience to External and, while Testing, add that administrator under Test users. An Internal Google audience will block accounts outside the organization before the app can authenticate them.

## 6. Test locally

```bash
npm run dev
```

Open http://localhost:3000/api/health. Expected response:

```json
{"ok":true,"database":"ready"}
```

Then open http://localhost:3000 and sign in with the seeded administrator. Complete the onboarding profile. Newly seen company accounts receive Employee access and must complete onboarding; HR can pre-create accounts and assign access.

## 7. Update Netlify

Replace the old source in the Git repository connected to the existing Netlify site, including `package.json`, `package-lock.json`, `netlify.toml`, `lib/`, `app/`, `scripts/` and `netlify/functions/`. Keep `.env.local` out of Git. The tracked `.env.example` contains only placeholders.

Build settings:

| Setting | Value |
| --- | --- |
| Base directory | Folder containing `package.json`; `atolls-hr` if your repository contains that folder, otherwise leave blank |
| Build command | `npm run build` |
| Publish directory | `.next`, relative to the base directory |
| Node version | `24` |

Use Netlify's Next.js framework integration. Do not publish a static export or drag only an `out`/`.next` folder into manual static hosting: API routes require the server-side framework deployment. Remove any old `/* /index.html 200` SPA catch-all redirect.

In Netlify → Project configuration → Environment variables, add the following for the Production deployment context, with **Builds and Functions** scope (or all scopes):

```env
APP_URL=https://your-site.netlify.app
TURSO_DATABASE_URL=THE-SAME-URL-USED-LOCALLY
TURSO_AUTH_TOKEN=THE-SAME-TOKEN-USED-LOCALLY
GOOGLE_CLIENT_ID=YOUR-GOOGLE-CLIENT-ID
GOOGLE_CLIENT_SECRET=YOUR-CURRENT-GOOGLE-CLIENT-SECRET
COMPANY_DOMAIN=example.com
ADMIN_EMAIL=YOUR-ADMIN@example.net
```

Remove the old `DB_PATH` variable. Push your source changes and redeploy; clear the build cache if Netlify still uses the old dependencies. Keep preview deployments on a separate database if you enable them: do not seed or test changes against production accidentally.

## 8. Verify the deployed app

Open https://your-site.netlify.app/api/health. It should return `{"ok":true,"database":"ready"}`.

- **503:** check the Turso URL/token in Netlify's Functions environment and confirm setup/seed used the same database. Check token validity and function logs.
- **404 or HTML:** check the repository base directory, Next.js framework integration and redirects.
- **`redirect_uri_mismatch`:** the URI registered in Google must equal the production callback URL above, and `APP_URL` must match the hostname you are using.
- **`/?error=Domain`:** use a verified Workspace account from the configured domain or the exact seeded `ADMIN_EMAIL`. Other external accounts are blocked. Keep `COMPANY_DOMAIN` set to the employee domain, not `gmail.com`.
- **`/?error=Configuration`:** verify Google credentials and the initial RH account.
- **`/?error=Database`:** Google verified the identity, but database access failed. Verify the database connection and schema.
- **`/api/portal` returns 401 before sign-in:** expected; this endpoint requires an active session.

The browser now reports empty/non-JSON responses with the HTTP status and diagnostic guidance, instead of throwing `Unexpected end of JSON input`.

## Email notifications on Netlify

In-app notifications persist immediately in Turso. SMTP is optional. Add `SMTP_HOST`, `SMTP_PORT` (usually `587`), `SMTP_SECURE` (`false` for STARTTLS on 587, `true` for implicit TLS on 465), `SMTP_FROM`, and optional `SMTP_USER` / `SMTP_PASS` to Netlify's Functions environment.

The included `netlify/functions/notifications.mjs` processes queued email every five minutes on the production deployment. It uses a bounded time budget and atomic message claims. Verify it appears with a Scheduled badge in Netlify and use Run now to test after setting SMTP. Unsent messages stay queued. Email delivery is at least once, so a rare crash after SMTP accepts a message can result in a duplicate.

For a persistent Node server, `npm run worker` runs a continuous worker. Do not run that infinite loop as a Netlify function. `npm run notify` runs one delivery pass locally. Neither command is needed for in-app notifications.

## Security and application behavior

- Sessions are random opaque tokens; only their SHA-256 hashes are stored in Turso. Session cookies are HttpOnly, SameSite=Lax and Secure in production.
- Each request checks the active account and current role. RH deactivation revokes sessions. Valid Google credentials cannot authenticate an inactive account; the attempt is audited and its supervisor is notified in-app.
- Employee and Dev manage their own records/work. Manager and Owner can approve direct-report leave and assign work to direct reports. RH manages the organization and sees the complete audit trail. Existing Dev, Owner and RH rights are preserved. All five system roles use shared room booking.
- Departments and Roles have separate pages. Roles shows permission chips and supports custom roles with a View/Create/Edit/Delete matrix and personal, direct-report or organization scope. Permission checks run on the server using the current assigned role.
- System roles are protected. Custom roles may only grant permissions and scope held by their creator; an assigned role cannot be deleted. Personal profile and work-ticket actions retain their existing baseline access. Matrix permissions govern the existing module actions; they do not add new CRUD screens to other modules.
- Self-approval, RH self-deactivation/demotion, supervisor cycles and deactivation of supervisors with active reports are rejected.
- Booking conflict checks and inserts execute in the same write transaction. AsyncLocalStorage keeps each request's statements bound to its own transaction across `await` calls.
- Public `/api/health` reports only readiness, never employees, credentials or database contents.

## Build and checks

```bash
npm test
npm run build
npm start
```

Tests use temporary local libSQL databases with the same async client API; no Turso credentials are needed. Production imports only the HTTP transport. `npm run build` does not connect to a database unless the one-time production Netlify setup flag is enabled.

See `VALIDATION.md` for checks performed and remaining integration limitations. The interface remains English; language preferences are stored but translations are not implemented. Leave day totals count Monday–Friday without automatic holiday/entitlement calculations. Future schema changes require explicit migrations. The current setup command initializes the schema and applies the additive roles migration; it is not a general-purpose migration engine.

## Reference links

- Turso setup: https://docs.turso.tech/quickstart
- Turso JavaScript/libSQL client: https://docs.turso.tech/sdk/ts/quickstart
- Google OAuth web server setup: https://developers.google.com/identity/protocols/oauth2/web-server
- Next.js on Netlify: https://docs.netlify.com/build/frameworks/framework-setup-guides/nextjs/overview/
- Netlify function variables: https://docs.netlify.com/build/functions/environment-variables/
- Netlify scheduled functions: https://docs.netlify.com/build/functions/scheduled-functions/
