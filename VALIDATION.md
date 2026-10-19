# Validation

- Next.js 16.4.0 production build: passed, including compilation and route generation.
- `npm test`: 11 tests passed, including access policy, leave workflows, room conflicts, onboarding, session revocation, inactive Google identity notifications, and SMTP delivery against a local test server.
- Production HTTP smoke checks: passed for unauthenticated requests, scoped employee data, RH/Dev permissions, request-origin checks, unknown operations, OAuth PKCE initiation, invalid callbacks, deactivation and persistent session revocation after reactivation.
- `npm audit --omit=dev`: zero reported vulnerabilities at verification time.

The execution workspace cannot expose Node's resident-memory metrics. Build verification used a temporary environment-only shim for that reporting API; the shim is not part of this project and no application behavior was bypassed. The production server was bound explicitly to the loopback interface during HTTP checks because this workspace also restricts network-interface enumeration.

Interactive browser checks were not completed: the environment could not download a valid Chromium archive. The responsive UI compiled successfully but still needs a browser review on your own machine. Real Google sign-in and company SMTP credentials were unavailable; Google identity policy and local SMTP delivery were tested, while live provider integration remains to be verified after configuration. Docker configuration is included but was not executed in this workspace.
