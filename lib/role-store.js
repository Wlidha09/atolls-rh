import {rows,get,read} from './db.js';
import {ensure} from './policy.js';
export function decodeRole(row){return {...row,is_system:!!row.is_system,permissions:row.permissions||JSON.parse(row.permissions_json)}}
export async function listRoles(){return (await rows('roles')).sort((a,b)=>Number(b.is_system)-Number(a.is_system)||a.id-b.id).map(decodeRole)}
export async function findRole(name){const role=(await listRoles()).find(role=>role.name.toLowerCase()===name.toLowerCase());ensure(role,400,'Role not found.');return role}
export async function hydrateEmployee(employee){return read(async()=>{
 if(!employee)return null;employee={...employee,active:employee.active??0,supervisor_id:employee.supervisor_id??null,assigned_role_id:employee.assigned_role_id??null};
 const row=employee.assigned_role_id?await get('roles',employee.assigned_role_id):(await rows('roles')).find(role=>role.name.toLowerCase()===employee.role.toLowerCase());
 ensure(row,503,'Roles are not initialized. Run Firebase setup or import existing data.');
 const role=decodeRole(row);return {...employee,role:role.name,role_id:role.id,access_scope:role.scope,permissions:role.permissions};
})}
