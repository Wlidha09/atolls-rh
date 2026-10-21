import {randomBytes,createHash} from 'node:crypto';
import {cookies} from 'next/headers.js';
import {get,insert,removeWhere,read,transaction} from './db.js';
import {ensure} from './policy.js';
import {hydrateEmployee} from './role-store.js';
export const hash=s=>createHash('sha256').update(s).digest('hex');
export const cookieOptions={httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'lax',path:'/'};
export async function sessionEmployee(tokenHash){return read(async()=>{const session=await get('sessions',tokenHash);if(!session||session.expires<=Date.now())return null;const employee=await get('employees',session.employee_id);return employee?.active?hydrateEmployee(employee):null})}
export async function currentEmployee(){const token=(await cookies()).get('atolls_session')?.value;return token?sessionEmployee(hash(token)):null}
export async function withEmployee(fn){const token=(await cookies()).get('atolls_session')?.value;ensure(token,401,'Sign in with an active company account.');return read(async()=>{const employee=await sessionEmployee(hash(token));ensure(employee,401,'Sign in with an active company account.');return fn(employee)})}
export async function requireEmployee(){const employee=await currentEmployee();ensure(employee,401,'Sign in with an active company account.');return employee}
export async function createSession(employee){const token=randomBytes(32).toString('hex'),token_hash=hash(token);await transaction(async()=>{const current=await get('employees',employee.id);ensure(current?.active,403,'Inactive');await removeWhere('sessions',s=>s.expires<Date.now());await insert('sessions',{token_hash,employee_id:employee.id,expires:Date.now()+7*86400000},token_hash)});(await cookies()).set('atolls_session',token,{...cookieOptions,maxAge:7*86400})}
export function checkOrigin(request){ensure(request.headers.get('origin')===new URL(process.env.APP_URL).origin,403,'Invalid request origin.')}
