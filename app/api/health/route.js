import {read,state} from '../../../lib/db.js';
import {describeError} from '../../../lib/diagnostics.js';
export const runtime='nodejs';export const dynamic='force-dynamic';
export async function GET(){try{await read(()=>{if(!state().meta.initialized)throw Object.assign(new Error('Import Turso data or initialize Firebase first.'),{status:503,code:'SCHEMA_MISSING'})});return Response.json({ok:true,database:'ready',provider:'firebase-realtime-database'},{headers:{'Cache-Control':'no-store'}})}catch(error){console.error('Database health:',describeError(error));return Response.json({ok:false,database:'unavailable',code:error.code||'DATABASE_UNAVAILABLE',error:error.status?error.message:'Firebase connection failed.'},{status:503,headers:{'Cache-Control':'no-store'}})}}
