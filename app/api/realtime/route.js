import {cookies} from 'next/headers';
import {checkOrigin,withEmployee,hash} from '../../../lib/session.js';
import {realtimeCredentials} from '../../../lib/firebase.js';
export const runtime='nodejs';export const dynamic='force-dynamic';
export async function POST(request){try{checkOrigin(request);const result=await withEmployee(async employee=>{const token=(await cookies()).get('atolls_session')?.value;return realtimeCredentials(employee,hash(token))});return Response.json(result,{headers:{'Cache-Control':'private, no-store'}})}catch(error){return Response.json({error:error.status?error.message:'Live updates are temporarily unavailable.'},{status:error.status||503,headers:{'Cache-Control':'private, no-store'}})}}
