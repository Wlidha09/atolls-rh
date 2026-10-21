import {rows,get,read} from './db.js';
import {hydrateEmployee} from './role-store.js';
import {ensure} from './policy.js';
import {hasPermission,roleScope} from './roles.js';
import {calculateWorkDays,monthBounds} from './work-days.js';
export async function workDaysReport(actor,year,month){monthBounds(year,month);return read(async()=>{
 const current=await hydrateEmployee(await get('employees',actor.id));ensure(current?.active,401,'Sign in with an active company account.');ensure(current.onboarded,409,'Complete your onboarding profile first.');
 const organization=roleScope(current)==='global'&&hasPermission(current,'employees','view')&&hasPermission(current,'employees','edit');
 const people=organization?await rows('employees'):[current],holidays=await rows('holidays'),leaves=await rows('leaves');
 return {year,month,organization,employees:people.sort((a,b)=>a.name.localeCompare(b.name)).map(({id,name,title,active})=>({id,name,title,active,...calculateWorkDays(year,month,holidays,leaves.filter(l=>l.employee_id===id))}))};
})}
