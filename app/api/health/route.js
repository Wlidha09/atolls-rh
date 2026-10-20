import { one } from '../../../lib/db.js';
import { describeError } from '../../../lib/diagnostics.js';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET() {
  try {
    const schema = await one("SELECT count(*) AS n FROM sqlite_master WHERE type='table' AND name IN ('employees','sessions','leaves','meetings','notifications','roles','schema_migrations')");
    const migrated = schema.n === 7 && (await one('SELECT count(*) AS n FROM pragma_table_info(\'employees\') WHERE name IN (\'assigned_role_id\',\'is_manager\')')).n === 2;
    if (!migrated) throw Object.assign(new Error('Database roles migration is missing. Enable INITIALIZE_DATABASE for one production Netlify deploy.'), { code: 'SCHEMA_MISSING' });
    const admin = await one("SELECT count(*) AS n FROM employees WHERE role='RH' AND active=1");
    if (!admin.n) throw Object.assign(new Error('No active HR administrator exists. Check ADMIN_EMAIL and enable INITIALIZE_DATABASE for one production Netlify deploy.'), { code: 'ADMIN_MISSING' });
    return Response.json({ ok: true, database: 'ready' }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('Database health check failed:', describeError(error));
    const known = ['SCHEMA_MISSING', 'ADMIN_MISSING', 'DATABASE_CONFIGURATION'].includes(error.code);
    return Response.json({ ok: false, database: 'unavailable', code: known ? error.code : 'DATABASE_UNAVAILABLE', error: known ? error.message : 'Database query failed. Check the Turso URL/token, libSQL engine, and function logs.' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
