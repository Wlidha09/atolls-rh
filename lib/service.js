import {z} from 'zod';
import {rows,get,insert,update,removeWhere,read,transaction,audit,queueNotification} from './db.js';
import {ensure,manages,canReview,workingDays} from './policy.js';
import {ACTIONS,FEATURES,hasPermission,roleScope,canGrantRole,storedRole} from './roles.js';
import {hydrateEmployee,listRoles,findRole} from './role-store.js';
import {employeeDefaults} from './seed.js';
const text = z.string().trim().min(1).max(200),
  id = z.number().int().positive();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(s => !isNaN(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s, 'Invalid calendar date');
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const role = z.string().trim().min(1).max(50);
const permissions = z.object(Object.fromEntries(FEATURES.map(([key]) => [key, z.object(Object.fromEntries(ACTIONS.map(action => [action, z.boolean()]))).strict()]))).strict();
const roleFields = {name: z.string().trim().min(2).max(50), scope: z.enum(['self','team','global']), permissions};
const schemas = {
  roleCreate: z.object(roleFields),
  roleEdit: z.object({id, ...roleFields}),
  roleDelete: z.object({id}),
  profile: z.object({
    name: text,
    title: text,
    department_id: id,
    theme: z.enum(['Light', 'Dark']),
    language: z.enum(['English', 'Deutsch', 'Français']),
    office_days: z.array(z.enum(['Mon', 'Tue', 'Wed', 'Thu', 'Fri'])).max(5),
    start_hour: time,
    end_hour: time
  }),
  availability: z.object({
    availability: z.enum(['In office', 'Remote', 'On leave'])
  }),
  employeeCreate: z.object({
    name: text,
    email: z.email().max(254).transform(s => s.toLowerCase()),
    title: text,
    department_id: id,
    role,
    is_manager: z.boolean().optional(),
    supervisor_id: id.nullable()
  }),
  employeeUpdate: z.object({
    id,
    name: text.optional(),
    title: text.optional(),
    role,
    active: z.boolean(),
    is_manager: z.boolean().optional(),
    department_id: id,
    supervisor_id: id.nullable()
  }),
  department: z.object({
    name: text
  }),
  leave: z.object({
    type: z.enum(['Annual leave', 'Personal leave', 'Sick leave']),
    start_date: date,
    end_date: date,
    note: z.string().trim().max(2000).default('')
  }),
  review: z.object({
    id,
    status: z.enum(['Approved', 'Rejected'])
  }),
  room: z.object({
    name: text,
    capacity: z.number().int().min(1).max(500),
    equipment: text
  }),
  meeting: z.object({
    title: text,
    room_id: id,
    start_at: z.iso.datetime(),
    end_at: z.iso.datetime(),
    attendees: z.array(id).max(100).default([])
  }),
  cancelMeeting: z.object({
    id
  }),
  ticket: z.object({
    title: text,
    description: z.string().trim().max(4000).default(''),
    priority: z.enum(['Low', 'Medium', 'High']),
    assignee_id: id
  }),
  ticketStatus: z.object({
    id,
    status: z.enum(['To do', 'In progress', 'Done'])
  }),
  holiday: z.object({
    name: text,
    date,
    office: text
  }),
  readNotifications: z.object({})
};
async function employee(id){const e=await hydrateEmployee(await get('employees',id));ensure(e,404,'Employee not found.');return e}
function requirePermission(actor,feature,action){ensure(hasPermission(actor,feature,action),403,'This role does not have the required permission.')}
async function department(id){ensure(await get('departments',id),400,'Department not found.')}
async function supervisorValid(id,target){if(id===null)return;let supervisor=await employee(id);ensure(supervisor.active&&supervisor.is_manager,400,'Supervisor must be an active employee marked as Manager.');const visited=new Set([target]);while(supervisor){ensure(!visited.has(supervisor.id),400,'Supervisor assignments cannot form a cycle.');visited.add(supervisor.id);supervisor=supervisor.supervisor_id?await employee(supervisor.supervisor_id):null}}
const sortName=(a,b)=>a.name.localeCompare(b.name),newest=(a,b)=>b.id-a.id;
export async function snapshot(actor){return read(async()=>{
 actor=await employee(actor.id);ensure(actor.active,401,'Inactive');
 const scope=roleScope(actor),can=(f,a='view')=>hasPermission(actor,f,a);
 const allEmployees=await rows('employees'),directory=can('employees'),full=directory&&scope==='global'&&can('employees','edit');
 const team=new Set([actor.id,...allEmployees.filter(e=>scope==='global'||(scope==='team'&&e.supervisor_id===actor.id)).map(e=>e.id)]);
 const directoryRows=full?await Promise.all(allEmployees.map(hydrateEmployee)):directory?allEmployees.filter(e=>e.active).map(({id,name,title,department_id,availability,supervisor_id})=>({id,name,title,department_id,availability,supervisor_id:supervisor_id===actor.id?supervisor_id:null})):[actor];
 const roles=await listRoles(),departments=await rows('departments'),rooms=await rows('rooms');
 const joinEmployee=row=>{const e=allEmployees.find(e=>e.id===row.employee_id);return e?{...row,name:e.name,title:e.title,supervisor_id:e.supervisor_id}:null};
 return {me:actor,employees:directoryRows.sort(sortName),roles:can('roles')?roles:[],assignableRoles:roles.filter(r=>canGrantRole(actor,r)).map(({id,name})=>({id,name})),departments:(can('departments')||!actor.onboarded?departments:departments.filter(d=>d.id===actor.department_id)).sort(sortName),
  leaves:can('leaveApprovals')?(await rows('leaves')).filter(l=>team.has(l.employee_id)).sort(newest).map(joinEmployee).filter(Boolean):[],
  rooms:can('meetingRooms')?rooms.sort(sortName):[],meetings:can('meetingRooms')?(await rows('meetings')).filter(m=>m.end_at>new Date().toISOString()).sort((a,b)=>a.start_at.localeCompare(b.start_at)).map(m=>({...m,organizer:allEmployees.find(e=>e.id===m.organizer_id)?.name,room:rooms.find(r=>r.id===m.room_id)?.name})):[],
  attendees:can('meetingRooms')?await rows('meeting_attendees'):[],tickets:(await rows('tickets')).filter(t=>team.has(t.assignee_id)||t.created_by===actor.id).sort(newest).map(t=>({...t,assignee:allEmployees.find(e=>e.id===t.assignee_id)?.name})),
  holidays:can('holidays')?(await rows('holidays')).sort((a,b)=>a.date.localeCompare(b.date)):[],logs:can('logs')?(await rows('logs')).filter(l=>scope==='global'||l.actor_id===actor.id).sort(newest).slice(0,scope==='global'?200:100).map(l=>({...l,actor:allEmployees.find(e=>e.id===l.actor_id)?.name})):[],notifications:(await rows('notifications')).filter(n=>n.employee_id===actor.id).sort(newest).slice(0,100)};
})}
export async function mutate(actor,action,raw){
 ensure(typeof action==='string'&&Object.hasOwn(schemas,action),400,'Unknown operation.');const parsed=schemas[action].safeParse(raw);ensure(parsed.success,400,parsed.error?.issues.map(i=>`${i.path.join('.')}: ${i.message}`).join('; '));
 return transaction(async()=>{
 const d=structuredClone(parsed.data),latest=await employee(actor.id);ensure(latest.active,401,'This account is inactive.');ensure(latest.role===actor.role&&latest.supervisor_id===actor.supervisor_id,409,'Your access changed. Refresh the portal and try again.');actor=latest;
 ensure(actor.onboarded||['profile','readNotifications'].includes(action),409,'Complete your onboarding profile first.');
 const permission={employeeCreate:['employees','create'],employeeUpdate:['employees','edit'],department:['departments','create'],leave:['leaveApprovals','create'],review:['leaveApprovals','edit'],room:['meetingRooms','create'],holiday:['holidays','create'],roleCreate:['roles','create'],roleEdit:['roles','edit'],roleDelete:['roles','delete']}[action];if(permission)requirePermission(actor,...permission);
 if(['employeeCreate','employeeUpdate','department','room','holiday'].includes(action))ensure(roleScope(actor)==='global',403,'Organization administration requires global scope.');
 if(['roleCreate','roleEdit'].includes(action)){
   ensure(canGrantRole(actor,d),403,'A role cannot grant more permissions or a wider scope than your own.');ensure(FEATURES.every(([key])=>d.permissions[key].view||ACTIONS.every(a=>!d.permissions[key][a])),400,'Enable View before enabling other permissions.');
   if(action==='roleEdit'){const current=await get('roles',d.id);ensure(current,404,'Role not found.');ensure(canGrantRole(actor,(await listRoles()).find(r=>r.id===d.id)),403,'You cannot manage a role beyond your own access.');ensure(!current.is_system||d.name===current.name,400,'System role names cannot be changed.');ensure(actor.role_id!==d.id,403,'You cannot edit your own assigned role.');
    if(d.scope==='self'||!d.permissions.leaveApprovals.edit){const people=await rows('employees');ensure(!people.some(e=>e.active&&(e.assigned_role_id===d.id||(!e.assigned_role_id&&e.role===current.name))&&people.some(report=>report.active&&report.supervisor_id===e.id)),409,'Reassign active direct reports before removing supervisor permissions.');}}
   ensure(!(await rows('roles')).some(r=>r.id!==d.id&&r.name.toLowerCase()===d.name.toLowerCase()),409,'A role with this name already exists.');
   if(action==='roleCreate')await insert('roles',{...d,is_system:false});else await update('roles',d.id,{name:d.name,scope:d.scope,permissions:d.permissions});
 }else if(action==='roleDelete'){
   const current=(await listRoles()).find(r=>r.id===d.id);ensure(current,404,'Role not found.');ensure(canGrantRole(actor,current),403,'You cannot manage a role beyond your own access.');ensure(!['Employee','RH'].includes(current.name),409,'Employee and RH are required by sign-in.');ensure(!(await rows('employees')).some(e=>e.assigned_role_id===d.id||(!e.assigned_role_id&&e.role===current.name)),409,'Reassign all employees before deleting this role.');await removeWhere('roles',r=>r.id===d.id);
 }else if(action==='profile'){
   await department(d.department_id);ensure(d.end_hour>d.start_hour,400,'Work end time must be after start time.');ensure(!actor.onboarded||actor.department_id===d.department_id,403,'Ask HR to change your department.');await update('employees',actor.id,{...d,office_days:JSON.stringify([...new Set(d.office_days)]),onboarded:1});
 }else if(action==='availability')await update('employees',actor.id,d);
 else if(action==='department'){ensure(!(await rows('departments')).some(r=>r.name===d.name),409,'Department already exists.');await insert('departments',d)}
 else if(action==='employeeCreate'||action==='employeeUpdate'){
   await department(d.department_id);const people=await rows('employees'),selected=await findRole(d.role);ensure(canGrantRole(actor,selected),403,'You cannot assign permissions beyond your own role.');await supervisorValid(d.supervisor_id,d.id||-1);
   const fields={name:d.name,title:d.title,department_id:d.department_id,role:storedRole(selected.name),assigned_role_id:selected.id,supervisor_id:d.supervisor_id};
   if(action==='employeeCreate'){ensure(d.email.split('@')[1]===process.env.COMPANY_DOMAIN?.trim().toLowerCase(),400,'Use the configured company domain.');ensure(!people.some(e=>e.email===d.email),409,'This employee already exists.');await insert('employees',{...employeeDefaults,...fields,email:d.email,is_manager:d.is_manager?1:0});}
   else {const target=await employee(d.id);if(target.role_id!==selected.id)requirePermission(actor,'roles','edit');ensure(actor.id!==target.id||(d.active&&selected.id===target.role_id),400,'You cannot deactivate yourself or change your own role.');if(target.role==='RH'&&(!d.active||selected.name!=='RH'))ensure(people.some(e=>e.id!==d.id&&e.active&&(e.assigned_role_id===target.role_id||(!e.assigned_role_id&&e.role==='RH'))),400,'Keep at least one active RH administrator.');
    if(!d.active||!(d.is_manager??target.is_manager))ensure(!people.some(e=>e.active&&e.supervisor_id===d.id),400,'Reassign active direct reports before deactivating or demoting this supervisor.');
    await update('employees',d.id,{...fields,name:d.name||target.name,title:d.title||target.title,active:d.active?1:0,is_manager:(d.is_manager??target.is_manager)?1:0});if(!d.active)await removeWhere('sessions',s=>s.employee_id===d.id);
   }
 }else if(action==='leave'){
   ensure(d.end_date>=d.start_date&&d.start_date>=new Date().toISOString().slice(0,10),400,'Choose a future or current date range.');ensure(d.end_date<=new Date(Date.now()+366*86400000).toISOString().slice(0,10),400,'Request leave within the next year.');ensure(workingDays(d.start_date,d.end_date)>0,400,'Select at least one working day.');ensure(!(await rows('leaves')).some(l=>l.employee_id===actor.id&&l.status!=='Rejected'&&l.start_date<=d.end_date&&l.end_date>=d.start_date),409,'You already have an overlapping leave request.');await insert('leaves',{...d,employee_id:actor.id,status:'Pending',reviewed_by:null});
   const reviewers=actor.supervisor_id?[await get('employees',actor.supervisor_id)]:(await rows('employees')).filter(e=>e.role==='RH'&&e.active&&e.id!==actor.id);for(const r of reviewers.filter(e=>e?.active))await queueNotification(r.id,'New leave request',`${actor.name} requested ${d.type}: ${d.start_date} to ${d.end_date}. Review it in the Atolls HR portal.`);
 }else if(action==='review'){
   const leave=await get('leaves',d.id);ensure(leave,404,'Leave request not found.');ensure(canReview(actor,await employee(leave.employee_id)));ensure(leave.status==='Pending',409,'This request was already reviewed.');await update('leaves',d.id,{status:d.status,reviewed_by:actor.id});await queueNotification(leave.employee_id,'Leave request '+d.status.toLowerCase(),`Your leave request for ${leave.start_date} to ${leave.end_date} was ${d.status.toLowerCase()} by ${actor.name}.`);
 }else if(action==='room'){ensure(!(await rows('rooms')).some(r=>r.name===d.name),409,'Room already exists.');await insert('rooms',d)}
 else if(action==='meeting'){
   requirePermission(actor,'meetingRooms','view');ensure(d.end_at>d.start_at&&d.start_at>new Date().toISOString(),400,'Choose a future meeting with an end after its start.');const room=await get('rooms',d.room_id);ensure(room,404,'Room not found.');ensure(!(await rows('meetings')).some(m=>m.room_id===d.room_id&&m.start_at<d.end_at&&m.end_at>d.start_at),409,'The room is already booked for this time.');const attendees=[...new Set([actor.id,...d.attendees])];ensure(attendees.length<=room.capacity,400,'Too many attendees for this room.');for(const id of attendees)ensure((await employee(id)).active,400,'Attendees must be active employees.');const meeting=await insert('meetings',{title:d.title,room_id:d.room_id,organizer_id:actor.id,start_at:d.start_at,end_at:d.end_at});for(const id of attendees){await insert('meeting_attendees',{meeting_id:meeting.id,employee_id:id});if(id!==actor.id)await queueNotification(id,'Meeting invitation: '+d.title,`${actor.name} invited you to ${d.title} in ${room.name}, ${d.start_at} to ${d.end_at}.`)}
 }else if(action==='cancelMeeting'){
   requirePermission(actor,'meetingRooms','view');const meeting=await get('meetings',d.id);ensure(meeting,404,'Meeting not found.');ensure(meeting.organizer_id===actor.id||(roleScope(actor)==='global'&&hasPermission(actor,'meetingRooms','edit')));for(const attendee of (await rows('meeting_attendees')).filter(a=>a.meeting_id===d.id&&a.employee_id!==actor.id))await queueNotification(attendee.employee_id,'Meeting cancelled: '+meeting.title,`${meeting.title} scheduled for ${meeting.start_at} has been cancelled.`);await removeWhere('meeting_attendees',a=>a.meeting_id===d.id);await removeWhere('meetings',m=>m.id===d.id);
 }else if(action==='ticket'){
   const assignee=await employee(d.assignee_id);ensure(assignee.active,400,'Assignee must be active.');ensure(assignee.id===actor.id||manages(actor,assignee));await insert('tickets',{...d,created_by:actor.id,status:'To do'});
 }else if(action==='ticketStatus'){const ticket=await get('tickets',d.id);ensure(ticket,404,'Ticket not found.');ensure(ticket.assignee_id===actor.id||ticket.created_by===actor.id||manages(actor,await employee(ticket.assignee_id)));await update('tickets',d.id,{status:d.status});}
 else if(action==='holiday')await insert('holidays',d);
 else if(action==='readNotifications')for(const n of (await rows('notifications')).filter(n=>n.employee_id===actor.id))await update('notifications',n.id,{is_read:1});
 await audit(actor.id,action.startsWith('employee')||action.startsWith('role')?'Access':'Activity',`${actor.name}: ${action}${d.id?' #'+d.id:''}${d.title||d.name?' — '+(d.title||d.name):''}${d.status?' → '+d.status:''}`);return {ok:true};
 })
}
