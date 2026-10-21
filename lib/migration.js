import {emptyState,importState,COLLECTIONS} from './db.js';
import {SYSTEM_ROLES,ACTIONS,FEATURES} from './roles.js';
import {employeeDefaults} from './seed.js';
import {createHash} from 'node:crypto';
export function convertTurso(source){
 const state=emptyState();
 for(const name of COLLECTIONS){if(name==='sessions')continue;for(const [index,original]of (source[name]||[]).entries()){
  const row={...original};if(name==='meeting_attendees')row.id=index+1;
  if(!Number.isSafeInteger(row.id)||row.id<1)throw Error(`Invalid ID in ${name}.`);
  if(name==='roles'){row.permissions=row.permissions||JSON.parse(row.permissions_json);delete row.permissions_json;if(!FEATURES.every(([key])=>ACTIONS.every(action=>typeof row.permissions?.[key]?.[action]==='boolean')))throw Error('Role permissions are incomplete in source.');}
  state[name][String(row.id)]=row;
 }}
 if(!Object.keys(state.roles).length){for(const [index,role]of SYSTEM_ROLES.entries())state.roles[String(index+1)]={id:index+1,...role,is_system:true}}
 for(const row of Object.values(state.employees)){
  const hadManager=Object.hasOwn(row,'is_manager')&&row.is_manager!==null;
  Object.assign(row,{...employeeDefaults,...row});
  const role=row.assigned_role_id?state.roles[String(row.assigned_role_id)]:Object.values(state.roles).find(r=>r.name===row.role);
  if(!role)throw Error(`An employee has no matching role. Repair the source before importing.`);
  row.assigned_role_id=role.id;
  if(!hadManager)row.is_manager=role.name==='Manager'||Object.values(state.employees).some(e=>e.supervisor_id===row.id)?1:0;
  if(row.department_id&&!state.departments[String(row.department_id)])throw Error('An employee references a missing department.');
  if(row.supervisor_id&&!state.employees[String(row.supervisor_id)])throw Error('An employee references a missing supervisor.');
 }
 const emails=new Set(),subjects=new Set();for(const row of Object.values(state.employees)){const email=row.email.toLowerCase();if(emails.has(email))throw Error('Duplicate employee email in source.');emails.add(email);if(row.google_sub){if(subjects.has(row.google_sub))throw Error('Duplicate Google identity in source.');subjects.add(row.google_sub)}}
 for(const row of Object.values(state.leaves))if(!state.employees[String(row.employee_id)])throw Error('Leave references a missing employee.');
 for(const row of Object.values(state.meetings))if(!state.rooms[String(row.room_id)]||!state.employees[String(row.organizer_id)])throw Error('Meeting references a missing room or organizer.');
 for(const row of Object.values(state.meeting_attendees))if(!state.meetings[String(row.meeting_id)]||!state.employees[String(row.employee_id)])throw Error('Attendance references a missing meeting or employee.');
 for(const row of Object.values(state.notifications))if(!state.employees[String(row.employee_id)])throw Error('Notification references a missing employee.');
 state.meta={schemaVersion:1,initialized:true,counters:Object.fromEntries(COLLECTIONS.map(name=>[name,Math.max(0,...Object.values(state[name]).map(row=>row.id||0))])),importedAt:new Date().toISOString(),source:'turso',sourceDigest:createHash('sha256').update(JSON.stringify(source)).digest('hex')};
 return state;
}
export async function migrateTurso(env=process.env){
 if(!env.TURSO_DATABASE_URL||!env.TURSO_AUTH_TOKEN)throw Error('Turso read credentials are required for migration only.');
 const {createClient}=await import('@libsql/client/http');
 const client=createClient({url:env.TURSO_DATABASE_URL,authToken:env.TURSO_AUTH_TOKEN,intMode:'number'});
 let tx;try{
  tx=await client.transaction('read');const source={};const tables=(await tx.execute("SELECT name FROM sqlite_master WHERE type='table'")).rows.map(row=>row.name);
  for(const name of COLLECTIONS)if(name!=='sessions'&&tables.includes(name))source[name]=(await tx.execute(`SELECT * FROM ${name}`)).rows.map(row=>({...row}));
  await tx.commit();const state=convertTurso(source);if(!Object.keys(state.employees).length)throw Error('Source contains no employees; migration refused.');
  await importState(state);return {employees:Object.keys(state.employees).length,sourceDigest:state.meta.sourceDigest};
 }finally{tx?.close();client.close()}
}
