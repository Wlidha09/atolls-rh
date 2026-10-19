import { one } from '../../../lib/db.js';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET() {
  try {
    const schema = await one("SELECT count(*) AS n FROM sqlite_master WHERE type='table' AND name IN ('employees','sessions','leaves','meetings','notifications')");
    if (schema.n !== 5) throw new Error('Database schema is incomplete.');
    const admin = await one("SELECT count(*) AS n FROM employees WHERE role='RH' AND active=1");
    if (!admin.n) throw new Error('Run npm run seed to create the first HR administrator.');
    return Response.json({ ok: true, database: 'ready' }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('Database health check failed:', error.code || error.status || error.name);
    return Response.json({ ok: false, database: 'unavailable', error: 'Check Turso environment variables, then run db:setup and seed.' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
