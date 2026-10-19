import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { createClient } from '@libsql/client/node';
import { installTestClient, initializeSchema, one, run, closeDatabase } from '../lib/db.js';
import { seedDatabase } from '../lib/seed.js';
import { acceptGoogleIdentity } from '../lib/identity.js';
import { googleAllowed, googleHostedDomainHint } from '../lib/policy.js';
process.env.NODE_ENV = 'test';
process.env.COMPANY_DOMAIN = 'company.test';
process.env.ADMIN_EMAIL = 'selected.admin@gmail.com';
const dir = mkdtempSync(join(tmpdir(), 'atolls-external-'));
installTestClient(createClient({ url: pathToFileURL(join(dir, 'test.sqlite')).href }));
await initializeSchema();
after(() => { closeDatabase(); rmSync(dir, { recursive: true, force: true }); });
const profile = { email: process.env.ADMIN_EMAIL, email_verified: true, sub: 'verified-external-sub', name: 'External Admin' };
test('only the exact configured external email bypasses the employee domain restriction', () => {
  assert.equal(googleAllowed(profile, 'company.test', process.env.ADMIN_EMAIL), true);
  assert.equal(googleAllowed({ ...profile, email: 'another@gmail.com' }, 'company.test', process.env.ADMIN_EMAIL), false);
  assert.equal(googleAllowed({ ...profile, email_verified: false }, 'company.test', process.env.ADMIN_EMAIL), false);
  assert.equal(googleAllowed({ ...profile, email: 'selected.admin@gmail.com.attacker.test' }, 'company.test', process.env.ADMIN_EMAIL), false);
  assert.equal(googleAllowed({ email: 'employee@company.test', hd: 'company.test', email_verified: true }, 'company.test', process.env.ADMIN_EMAIL), true);
  assert.equal(googleAllowed({ email: 'employee@company.test', email_verified: true }, 'company.test', process.env.ADMIN_EMAIL), false);
});
test('Google account chooser supports the external administrator', () => {
  assert.equal(googleHostedDomainHint('company.test', process.env.ADMIN_EMAIL), undefined);
  assert.equal(googleHostedDomainHint('company.test', 'admin@company.test'), 'company.test');
});
test('external admin cannot sign in before explicit database provisioning', async () => {
  await assert.rejects(() => acceptGoogleIdentity(profile), e => e.message === 'Configuration');
  assert.equal((await one('SELECT count(*) AS n FROM employees')).n, 0);
});
test('seed accepts an external administrator and verified sign-in retains RH access', async () => {
  await seedDatabase();
  const admin = await acceptGoogleIdentity(profile);
  assert.equal(admin.email, process.env.ADMIN_EMAIL);
  assert.equal(admin.role, 'RH');
  assert.equal((await one('SELECT google_sub FROM employees WHERE id=?', admin.id)).google_sub, profile.sub);
  await assert.rejects(() => acceptGoogleIdentity({ ...profile, sub: 'different-sub' }), e => e.message === 'OAuth');
  await assert.rejects(() => acceptGoogleIdentity({ ...profile, email: 'another@gmail.com' }), e => e.message === 'Domain');
});
test('inactive external admin is still blocked and generates a security notification', async () => {
  await run("INSERT INTO employees(email,name,role) VALUES('other@company.test','Other HR','RH')");
  await run('UPDATE employees SET active=0 WHERE email=?', process.env.ADMIN_EMAIL);
  await assert.rejects(() => acceptGoogleIdentity(profile), e => e.message === 'Inactive');
  assert.ok(await one("SELECT id FROM notifications WHERE subject='Security: inactive account login'"));
  assert.ok(await one("SELECT id FROM logs WHERE detail LIKE 'Inactive account sign-in blocked:%'"));
});
