import { AsyncLocalStorage } from 'node:async_hooks';
import { createClient } from '@libsql/client/http';
import { schema } from './schema.js';
import { SYSTEM_ROLES } from './roles.js';

const context = new AsyncLocalStorage();
let client;
function configurationError(message) {
  const error = new Error(message);
  error.status = 503;
  error.code = 'DATABASE_CONFIGURATION';
  return error;
}
export function getClient() {
  if (client) return client;
  const url = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;
  if (!url || !authToken) throw configurationError('Database is not configured. Set TURSO_DATABASE_URL and TURSO_AUTH_TOKEN in the server environment.');
  if (!/^(libsql|https):\/\//.test(url)) throw configurationError('Use the remote libSQL database URL supplied by Turso.');
  client = createClient({ url, authToken, intMode: 'number' });
  return client;
}
// The production module imports only HTTP transport and never opens a file.
export function installTestClient(testClient) {
  if (process.env.NODE_ENV !== 'test') throw new Error('Test database injection is disabled.');
  client = testClient;
}
async function execute(sql, args) {
  return (context.getStore() || getClient()).execute({ sql, args });
}
export async function all(sql, ...args) {
  return (await execute(sql, args)).rows.map(row => ({ ...row }));
}
export async function one(sql, ...args) { return (await all(sql, ...args))[0]; }
export async function run(sql, ...args) {
  const result = await execute(sql, args);
  return { changes: result.rowsAffected, lastInsertRowid: result.lastInsertRowid == null ? null : Number(result.lastInsertRowid) };
}
export async function transaction(fn) {
  if (context.getStore()) throw new Error('Nested transactions are not supported.');
  const tx = await getClient().transaction('write');
  try {
    const result = await context.run(tx, fn);
    await tx.commit();
    return result;
  } catch (error) {
    if (!tx.closed) { try { await tx.rollback(); } catch {} }
    throw error;
  } finally { tx.close(); }
}
export async function initializeSchema() {
  const tx = await getClient().transaction('write');
  try {
    await tx.executeMultiple(schema);
    const columns = (await tx.execute('PRAGMA table_info(employees)')).rows;
    if (!columns.some(column => column.name === 'assigned_role_id')) {
      await tx.execute('ALTER TABLE employees ADD COLUMN assigned_role_id INTEGER REFERENCES roles(id)');
    }
    for (const role of SYSTEM_ROLES) {
      await tx.execute({ sql: 'INSERT OR IGNORE INTO roles(name,is_system,scope,permissions_json) VALUES(?,1,?,?)', args: [role.name, role.scope, JSON.stringify(role.permissions)] });
    }
    await tx.execute('INSERT OR IGNORE INTO schema_migrations(version) VALUES(1)');
    await tx.commit();
  } catch (error) { if (!tx.closed) { try { await tx.rollback(); } catch {} } throw error; }
  finally { tx.close(); }
}
export async function audit(actor, type, detail) {
  await run('INSERT INTO logs(actor_id,type,detail) VALUES(?,?,?)', actor, type, detail);
}
export async function queueNotification(employee, subject, body) {
  if (employee) await run('INSERT INTO notifications(employee_id,subject,body) VALUES(?,?,?)', employee, subject, body);
}
export function closeDatabase() { client?.close(); client = undefined; }
export default { close: closeDatabase };
