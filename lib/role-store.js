import { all, one } from './db.js';
import { ensure } from './policy.js';
export function decodeRole(row) {
  return { id: row.id, name: row.name, is_system: !!row.is_system, scope: row.scope, permissions: JSON.parse(row.permissions_json) };
}
export async function listRoles() {
  return (await all('SELECT * FROM roles ORDER BY is_system DESC,id')).map(decodeRole);
}
export async function findRole(name) {
  const row = await one('SELECT * FROM roles WHERE name=? COLLATE NOCASE', name);
  ensure(row, 400, 'Role not found.'); return decodeRole(row);
}
export async function hydrateEmployee(employee) {
  if (!employee) return null;
  const row = employee.assigned_role_id
    ? await one('SELECT * FROM roles WHERE id=?', employee.assigned_role_id)
    : await one('SELECT * FROM roles WHERE name=? COLLATE NOCASE', employee.role);
  ensure(row, 503, 'Roles are not initialized. Enable INITIALIZE_DATABASE for one production deployment.');
  const role = decodeRole(row);
  return { ...employee, role: role.name, role_id: role.id, access_scope: role.scope, permissions: role.permissions };
}
