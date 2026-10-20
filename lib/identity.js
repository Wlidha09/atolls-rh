import { all, one, run, audit, queueNotification, transaction } from './db.js';
import { ensure, googleAllowed, isConfiguredAdministrator } from './policy.js';
import { hydrateEmployee, findRole } from './role-store.js';
// Called only after signature, audience, issuer, expiration, state, PKCE and nonce verification.
export async function acceptGoogleIdentity(profile) {
  ensure(googleAllowed(profile, process.env.COMPANY_DOMAIN, process.env.ADMIN_EMAIL), 403, 'Domain');
  const email = profile.email.toLowerCase();
  const result = await transaction(async () => {
    let employee = await one('SELECT * FROM employees WHERE email=?', email);
    if (employee && !employee.active) {
      await audit(employee.id, 'Security', `Inactive account sign-in blocked: ${email}`);
      const supervisor = employee.supervisor_id ? await one('SELECT id FROM employees WHERE id=? AND active=1', employee.supervisor_id) : null;
      const recipients = supervisor ? [supervisor] : await all("SELECT id FROM employees WHERE role='RH' AND active=1");
      for (const r of recipients) await queueNotification(r.id, 'Security: inactive account login', `${employee.name} (${email}) attempted to sign in with a deactivated account. Access was blocked.`);
      return {
        blocked: true
      };
    }
    if (email.split('@')[1] !== process.env.COMPANY_DOMAIN?.trim().toLowerCase()) {
      ensure(employee?.role === 'RH', 503, 'Configuration');
    }
    ensure(!employee?.google_sub || employee.google_sub === profile.sub, 403, 'OAuth');
    if (!employee) {
      // The configured administrator must be provisioned by explicit setup,
      // never by trusting an unseeded external account at first sign-in.
      ensure(!isConfiguredAdministrator(email, process.env.ADMIN_EMAIL), 503, 'Configuration');
      const supervisor = await one("SELECT id FROM employees WHERE role='RH' AND active=1 ORDER BY id LIMIT 1");
      ensure(supervisor, 503, 'Configuration');
      const defaultRole = await findRole('Employee');
      const created = await run('INSERT INTO employees(email,name,google_sub,supervisor_id,assigned_role_id) VALUES(?,?,?,?,?)', email, profile.name || email, profile.sub, supervisor.id, defaultRole.id);
      employee = await one('SELECT * FROM employees WHERE id=?', Number(created.lastInsertRowid));
    } else await run('UPDATE employees SET google_sub=? WHERE id=?', profile.sub, employee.id);
    await audit(employee.id, 'Security', 'Google sign-in succeeded');
    return {
      employee: await hydrateEmployee(employee)
    };
  });
  ensure(!result.blocked, 403, 'Inactive');
  return result.employee;
}
