import {all, one} from './db.js';
import {hydrateEmployee} from './role-store.js';
import {ensure} from './policy.js';
import {hasPermission, roleScope} from './roles.js';
import {calculateWorkDays, monthBounds} from './work-days.js';

export async function workDaysReport(actor, year, month) {
  const {start, end} = monthBounds(year, month);
  // Reload role/account state so stale caller objects never grant report access.
  const current = await hydrateEmployee(await one('SELECT * FROM employees WHERE id=? AND active=1', actor.id));
  ensure(current, 401, 'Sign in with an active company account.');
  ensure(current.onboarded, 409, 'Complete your onboarding profile first.');
  const organization = roleScope(current) === 'global' && hasPermission(current, 'employees', 'view') && hasPermission(current, 'employees', 'edit');
  const employees = organization
    ? await all('SELECT id,name,title,active FROM employees ORDER BY name COLLATE NOCASE,id')
    : [{id: current.id, name: current.name, title: current.title, active: current.active}];
  const holidays = await all('SELECT date FROM holidays WHERE date>=? AND date<=?', start, end);
  const leaves = organization
    ? await all("SELECT employee_id,start_date,end_date,status FROM leaves WHERE status='Approved' AND start_date<=? AND end_date>=?", end, start)
    : await all("SELECT employee_id,start_date,end_date,status FROM leaves WHERE employee_id=? AND status='Approved' AND start_date<=? AND end_date>=?", current.id, end, start);
  const grouped = new Map();
  for (const leave of leaves) {
    if (!grouped.has(leave.employee_id)) grouped.set(leave.employee_id, []);
    grouped.get(leave.employee_id).push(leave);
  }
  return {year, month, organization, employees: employees.map(employee => ({...employee, ...calculateWorkDays(year, month, holidays, grouped.get(employee.id) || [])}))};
}
