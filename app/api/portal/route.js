import { requireEmployee, checkOrigin, withEmployee } from '../../../lib/session.js';
import { snapshot, mutate } from '../../../lib/service.js';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
function error(e) {
  if (!e.status) console.error('Portal operation failed:', e.message);
  return Response.json({
    error: e.status ? e.message : 'The operation could not be completed.'
  }, {
    status: e.status || 500
  });
}
export async function GET() {
  try {
    return Response.json(await withEmployee(snapshot), {
      headers: {
        'Cache-Control': 'no-store'
      }
    });
  } catch (e) {
    return error(e);
  }
}
export async function POST(request) {
  try {
    checkOrigin(request);
    const actor = await requireEmployee();
    const length = Number(request.headers.get('content-length') || 0);
    if (length > 32768) return Response.json({
      error: 'Request too large'
    }, {
      status: 413
    });
    const body = await request.text();
    if (body.length > 32768) return Response.json({
      error: 'Request too large'
    }, {
      status: 413
    });
    let parsed;
    try {
      parsed = JSON.parse(body);
    } catch {
      return Response.json({
        error: 'Invalid JSON'
      }, {
        status: 400
      });
    }
    return Response.json(await mutate(actor, parsed.action, parsed.data));
  } catch (e) {
    return error(e);
  }
}
