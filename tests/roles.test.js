import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {createClient} from '@libsql/client/node';
import {installTestClient,initializeSchema,one,run,closeDatabase} from '../lib/db.js';
import {schema} from '../lib/schema.js';
import {SYSTEM_ROLES,emptyPermissions,hasPermission} from '../lib/roles.js';
import {hydrateEmployee,listRoles} from '../lib/role-store.js';
import {mutate,snapshot} from '../lib/service.js';
process.env.NODE_ENV='test';process.env.COMPANY_DOMAIN='company.test';
const dir=mkdtempSync(join(tmpdir(),'atolls-roles-'));
const client=createClient({url:pathToFileURL(join(dir,'test.sqlite')).href});
installTestClient(client);
// Simulate the previously deployed schema and retain existing records and sessions.
const oldSchema=schema.replace(/CREATE TABLE IF NOT EXISTS roles \([\s\S]*?\);/,'').replace(/CREATE TABLE IF NOT EXISTS schema_migrations[^;]*;/,'').replace(/,\n assigned_role_id INTEGER REFERENCES roles\(id\),\n is_manager INTEGER NOT NULL DEFAULT 0 CHECK\(is_manager IN \(0,1\)\)/,'');
await client.executeMultiple(oldSchema);
await run("INSERT INTO departments(id,name) VALUES(1,'Engineering')");
await run("INSERT INTO employees(id,email,name,title,department_id,role,onboarded,supervisor_id) VALUES(1,'hr@company.test','HR','HR',1,'RH',1,NULL),(2,'owner@company.test','Owner','Lead',1,'Owner',1,1),(3,'dev@company.test','Dev','Engineer',1,'Dev',1,2),(4,'other@company.test','Other','Engineer',1,'Dev',1,1)");
await run('INSERT INTO sessions VALUES(?,?,?)','existing-session',3,Date.now()+86400000);
await initializeSchema();
const employee=async id=>hydrateEmployee(await one('SELECT * FROM employees WHERE id=?',id));
const hr=await employee(1);
after(()=>{closeDatabase();rmSync(dir,{recursive:true,force:true})});
test('migration adds five roles without changing existing employee roles or sessions',async()=>{
 assert.deepEqual((await listRoles()).map(role=>role.name),['Dev','Employee','Manager','Owner','RH']);
 assert.equal((await employee(2)).role,'Owner');assert.equal((await employee(3)).role,'Dev');
 assert.ok(await one('SELECT token_hash FROM sessions WHERE token_hash=?','existing-session'));
 await initializeSchema();assert.equal((await listRoles()).length,5);
});
test('Employee and Manager can be assigned without violating legacy SQLite role constraints',async()=>{
 await mutate(hr,'employeeUpdate',{id:2,role:'Manager',active:true,department_id:1,supervisor_id:1});
 await mutate(hr,'employeeUpdate',{id:3,role:'Employee',active:true,department_id:1,supervisor_id:2});
 assert.equal((await employee(2)).role,'Manager');assert.equal((await employee(3)).role,'Employee');
 assert.equal((await one('SELECT role FROM employees WHERE id=2')).role,'Owner');
 assert.equal(hasPermission(await employee(2),'leaveApprovals','edit'),true);
 assert.equal(hasPermission(await employee(3),'employees','edit'),false);
});
test('Manager sees and reviews direct-report leave only',async()=>{
 const day=new Date(Date.now()+10*86400000);while([0,6].includes(day.getUTCDay()))day.setUTCDate(day.getUTCDate()+1);const date=day.toISOString().slice(0,10);
 await mutate(await employee(3),'leave',{type:'Annual leave',start_date:date,end_date:date});
 await mutate(await employee(4),'leave',{type:'Annual leave',start_date:date,end_date:date});
 const manager=await employee(2), ownTeam=await snapshot(manager);
 assert.equal(ownTeam.leaves.length,1);assert.equal(ownTeam.leaves[0].employee_id,3);
 await mutate(manager,'review',{id:ownTeam.leaves[0].id,status:'Approved'});
 const unrelated=await one('SELECT id FROM leaves WHERE employee_id=4');
 await assert.rejects(()=>mutate(manager,'review',{id:unrelated.id,status:'Approved'}),e=>e.status===403);
});
test('role creation is restricted and case-insensitive duplicate names are rejected',async()=>{
 const permissions=emptyPermissions();permissions.roles.view=true;permissions.departments.view=true;
 const definition={name:'Read only',scope:'self',permissions};
 const employeeActor=await employee(3);
 await assert.rejects(()=>mutate(employeeActor,'roleCreate',definition),e=>e.status===403);
 await mutate(hr,'roleCreate',definition);
 assert.equal((await listRoles()).length,6);
 await assert.rejects(()=>mutate(hr,'roleCreate',{...definition,name:'READ ONLY'}),e=>e.status===409);
 const invalid=emptyPermissions();invalid.employees.view=true;invalid.employees.delete=true;
 await assert.rejects(()=>mutate(hr,'roleCreate',{name:'Beyond creator',scope:'global',permissions:invalid}),e=>e.status===403);
 const inconsistent=emptyPermissions();inconsistent.roles.create=true;
 await assert.rejects(()=>mutate(hr,'roleCreate',{name:'Missing view',scope:'self',permissions:inconsistent}),e=>e.status===400);
});
test('system permissions can be edited but required roles and system names are protected',async()=>{
 const system=(await listRoles()).find(role=>role.name==='Employee');
 const permissions=structuredClone(system.permissions);permissions.logs.view=false;
 await mutate(hr,'roleEdit',{id:system.id,name:system.name,scope:system.scope,permissions});
 assert.equal((await employee(3)).permissions.logs.view,false);
 await assert.rejects(()=>mutate(hr,'roleEdit',{id:system.id,name:'Renamed',scope:system.scope,permissions}),e=>e.status===400);
 await assert.rejects(()=>mutate(hr,'roleDelete',{id:system.id}),e=>e.status===409);
 const dev=(await listRoles()).find(role=>role.name==='Dev');
 await assert.rejects(()=>mutate(hr,'roleDelete',{id:dev.id}),e=>e.status===409);
});
test('custom roles can be assigned, constrain server access, and remain linked after renaming',async()=>{
 const role=(await listRoles()).find(role=>role.name==='Read only');
 await mutate(hr,'employeeUpdate',{id:4,role:role.name,active:true,department_id:1,supervisor_id:1});
 const restricted=await employee(4), state=await snapshot(restricted);
 assert.equal(restricted.role,'Read only');assert.equal(state.employees.length,1);assert.equal(state.logs.length,0);
 await assert.rejects(()=>mutate(restricted,'department',{name:'Unauthorized'}),e=>e.status===403);
 await mutate(hr,'roleEdit',{id:role.id,name:'Read only renamed',scope:role.scope,permissions:role.permissions});
 assert.equal((await employee(4)).role,'Read only renamed');
 await assert.rejects(()=>mutate(hr,'roleDelete',{id:role.id}),e=>e.status===409);
 await mutate(hr,'employeeUpdate',{id:4,role:'Employee',active:true,department_id:1,supervisor_id:1});
 await mutate(hr,'roleDelete',{id:role.id});
 assert.equal((await listRoles()).some(item=>item.id===role.id),false);
});
test('a custom role creator cannot escalate beyond their own permissions or scope',async()=>{
 const permissions=emptyPermissions();permissions.roles.view=true;permissions.roles.create=true;
 await mutate(hr,'roleCreate',{name:'Limited creator',scope:'self',permissions});
 await mutate(hr,'employeeUpdate',{id:4,role:'Limited creator',active:true,department_id:1,supervisor_id:1});
 const creator=await employee(4);
 await assert.rejects(()=>mutate(creator,'roleCreate',{name:'Escalate scope',scope:'global',permissions}),e=>e.status===403);
 const stronger=structuredClone(permissions);stronger.employees.view=true;stronger.employees.edit=true;
 await assert.rejects(()=>mutate(creator,'roleCreate',{name:'Escalate permissions',scope:'self',permissions:stronger}),e=>e.status===403);
});
test('administrators cannot change their own assigned role',async()=>{
 await assert.rejects(()=>mutate(hr,'employeeUpdate',{id:1,role:'Employee',active:true,department_id:1,supervisor_id:null}),e=>e.status===400);
});

test('only active employees explicitly marked Manager can be assigned as supervisor',async()=>{
 await assert.rejects(()=>mutate(hr,'employeeUpdate',{id:4,role:'Employee',active:true,department_id:1,supervisor_id:3}),e=>e.status===400);
 await mutate(hr,'employeeUpdate',{id:3,role:'Employee',active:true,is_manager:true,department_id:1,supervisor_id:2});
 await mutate(hr,'employeeUpdate',{id:4,role:'Employee',active:true,is_manager:false,department_id:1,supervisor_id:3});
 assert.equal((await employee(4)).supervisor_id,3);
 await assert.rejects(()=>mutate(hr,'employeeUpdate',{id:3,role:'Employee',active:true,is_manager:false,department_id:1,supervisor_id:2}),e=>e.status===400);
 await mutate(hr,'employeeUpdate',{id:4,role:'Employee',active:true,is_manager:false,department_id:1,supervisor_id:null});
 await mutate(hr,'employeeUpdate',{id:3,role:'Employee',active:true,is_manager:false,department_id:1,supervisor_id:2});
 assert.equal((await employee(3)).is_manager,0);
 await initializeSchema();assert.equal((await employee(3)).is_manager,0);
 await assert.rejects(()=>mutate(hr,'employeeUpdate',{id:4,role:'Employee',active:true,department_id:1,supervisor_id:3}),e=>e.status===400);
});
test('unused system roles can be deleted and repeated setup does not restore them',async()=>{
 const dev=(await listRoles()).find(role=>role.name==='Dev');
 await mutate(hr,'roleDelete',{id:dev.id});
 await initializeSchema();assert.equal((await listRoles()).some(role=>role.name==='Dev'),false);
});
