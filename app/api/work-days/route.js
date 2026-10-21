import {withEmployee} from '../../../lib/session.js';
import {workDaysReport} from '../../../lib/work-report.js';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request) {
  try {
    const query = new URL(request.url).searchParams;
    const report = await withEmployee(actor=>workDaysReport(actor, Number(query.get('year')), Number(query.get('month'))));
    return Response.json(report, {headers: {'Cache-Control': 'private, no-store'}});
  } catch (error) {
    if (!error.status) console.error('Work days report failed:', error.message);
    return Response.json({error: error.status ? error.message : 'Work days could not be loaded. Try again.'}, {status: error.status || 500, headers: {'Cache-Control': 'private, no-store'}});
  }
}
