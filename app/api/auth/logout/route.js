import { cookies } from 'next/headers';
import { run } from '../../../../lib/db.js';
import { hash, checkOrigin } from '../../../../lib/session.js';
export async function POST(request){try{checkOrigin(request);const jar=await cookies();const token=jar.get('atolls_session')?.value;if(token)run('DELETE FROM sessions WHERE token_hash=?',hash(token));jar.delete('atolls_session');return Response.json({ok:true});}catch{return Response.json({error:'Invalid request'},{status:403});}}
