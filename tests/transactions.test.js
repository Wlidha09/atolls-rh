import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { createClient } from '@libsql/client/node';
import { installTestClient, initializeSchema, one, run, transaction, closeDatabase, getClient } from '../lib/db.js';
process.env.NODE_ENV = 'test';
const dir = mkdtempSync(join(tmpdir(), 'atolls-transactions-'));
const create = () => createClient({ url: pathToFileURL(join(dir, 'test.sqlite')).href });
installTestClient(create());
await initializeSchema();
after(() => { closeDatabase(); rmSync(dir, { recursive: true, force: true }); });
test('async operations roll back the complete transaction on failure', async () => {
  await assert.rejects(() => transaction(async () => {
    await run("INSERT INTO departments(name) VALUES('Rollback team')");
    await new Promise(resolve => setTimeout(resolve, 5));
    throw new Error('Abort transaction');
  }), /Abort transaction/);
  assert.equal(await one("SELECT id FROM departments WHERE name='Rollback team'"), undefined);
});
test('a concurrent request cannot accidentally join another request transaction', async () => {
  let entered, release;
  const ready = new Promise(resolve => { entered = resolve; });
  const wait = new Promise(resolve => { release = resolve; });
  const otherClient = create();
  const main = getClient();
  // Use a second real connection for outside-transaction queries, as remote HTTP does.
  installTestClient({
    transaction: mode => main.transaction(mode),
    execute: statement => otherClient.execute(statement),
    close: () => { main.close(); otherClient.close(); }
  });
  const write = transaction(async () => {
    await run("INSERT INTO departments(name) VALUES('Private until committed')");
    entered();
    await wait;
    return (await one("SELECT name FROM departments WHERE name='Private until committed'")).name;
  });
  try {
    await ready;
    assert.equal(await one("SELECT id FROM departments WHERE name='Private until committed'"), undefined);
    release();
    assert.equal(await write, 'Private until committed');
    assert.ok(await one("SELECT id FROM departments WHERE name='Private until committed'"));
  } finally { release(); await write; }
});
test('missing production Turso configuration fails clearly instead of opening local SQLite', () => {
  closeDatabase();
  delete process.env.TURSO_DATABASE_URL;
  delete process.env.TURSO_AUTH_TOKEN;
  assert.throws(() => getClient(), error => error.status === 503 && /TURSO_DATABASE_URL/.test(error.message));
});
