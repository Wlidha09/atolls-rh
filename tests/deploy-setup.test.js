import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { createClient } from '@libsql/client/node';
import { installTestClient, initializeSchema, one, run, closeDatabase } from '../lib/db.js';
import { seedDatabase } from '../lib/seed.js';
import { initializeForDeploy } from '../lib/deploy-setup.js';
import { describeError } from '../lib/diagnostics.js';

process.env.NODE_ENV = 'test';
const dir = mkdtempSync(join(tmpdir(), 'atolls-deploy-'));
installTestClient(createClient({ url: pathToFileURL(join(dir, 'test.sqlite')).href }));
after(() => { closeDatabase(); rmSync(dir, { recursive: true, force: true }); });
const env = { INITIALIZE_DATABASE: 'true', NETLIFY: 'true', CONTEXT: 'production', COMPANY_DOMAIN: 'atolls.test', ADMIN_EMAIL: 'admin@atolls.test' };

test('setup is opt-in and skipped outside a production Netlify build', async () => {
  const operations = { initializeSchema: () => assert.fail('Unexpected schema write'), seedDatabase: () => assert.fail('Unexpected seed') };
  assert.equal(await initializeForDeploy({}, operations), 'disabled');
  assert.equal(await initializeForDeploy({ ...env, CONTEXT: 'deploy-preview' }, operations), 'skipped');
  assert.equal(await initializeForDeploy({ ...env, NETLIFY: undefined }, operations), 'skipped');
});
test('malformed administrator email is rejected before any database changes', async () => {
  const operations = { initializeSchema: () => assert.fail('Unexpected schema write'), seedDatabase: () => assert.fail('Unexpected seed') };
  await assert.rejects(() => initializeForDeploy({ ...env, ADMIN_EMAIL: 'invalid-email' }, operations), /valid Google account email/);
});
test('one-time setup creates the complete schema, administrator and rooms', async () => {
  assert.equal(await initializeForDeploy(env), 'initialized');
  const admin = await one('SELECT * FROM employees WHERE email=?', env.ADMIN_EMAIL);
  assert.equal(admin.role, 'RH');
  assert.equal(admin.active, 1);
  assert.equal((await one('SELECT count(*) AS n FROM departments')).n, 5);
  assert.equal((await one('SELECT count(*) AS n FROM rooms')).n, 3);
});
test('repeated setup preserves employee data and does not duplicate seed records', async () => {
  await run("UPDATE employees SET name='Custom administrator name' WHERE email=?", env.ADMIN_EMAIL);
  await initializeSchema();
  await seedDatabase(env);
  assert.equal((await one('SELECT name FROM employees WHERE email=?', env.ADMIN_EMAIL)).name, 'Custom administrator name');
  assert.equal((await one('SELECT count(*) AS n FROM employees')).n, 1);
  assert.equal((await one('SELECT count(*) AS n FROM rooms')).n, 3);
});
test('setup never reactivates a disabled administrator', async () => {
  await run('UPDATE employees SET active=0 WHERE email=?', env.ADMIN_EMAIL);
  await assert.rejects(() => seedDatabase(env), /never reactivated or promoted/);
  assert.equal((await one('SELECT active FROM employees WHERE email=?', env.ADMIN_EMAIL)).active, 0);
});
test('diagnostic logs redact configured credentials', () => {
  const error = Object.assign(new Error('Failed auth using secret-token-value and password-value'), { code: 'AUTH_FAILED' });
  assert.equal(describeError(error, { TURSO_AUTH_TOKEN: 'secret-token-value', SMTP_PASS: 'password-value' }), 'AUTH_FAILED: Failed auth using [REDACTED] and [REDACTED]');
});
