import { randomBytes, createHash } from 'node:crypto';
import { cookies } from 'next/headers';
import { one, run } from './db.js';
import { ensure } from './policy.js';
export const hash=s=>createHash('sha256').update(s).digest('hex');
export const cookieOptions={httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'lax',path:'/'};
export async function currentEmployee(){const token=(await cookies()).get('atolls_session')?.value;if(!token)return null;
return one('SELECT e.* FROM sessions s JOIN employees e ON e.id=s.employee_id WHERE s.token_hash=? AND s.expires>? AND e.active=1',hash(token),Date.now())||null;}
export async function requireEmployee(){const e=await currentEmployee();ensure(e,401,'Sign in with an active company account.');return e;}
export async function createSession(employee){const token=randomBytes(32).toString('hex');run('DELETE FROM sessions WHERE expires<?',Date.now());const result=run('INSERT INTO sessions SELECT ?,id,? FROM employees WHERE id=? AND active=1',hash(token),Date.now()+7*86400000,employee.id);ensure(result.changes,403,'Inactive');(await cookies()).set('atolls_session',token,{...cookieOptions,maxAge:7*86400});}
export function checkOrigin(request){ensure(request.headers.get('origin')===new URL(process.env.APP_URL).origin,403,'Invalid request origin.');}
