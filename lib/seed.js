import {rows,insert,transaction} from './db.js';
export function validateAdministrator(env=process.env){const domain=env.COMPANY_DOMAIN?.trim().toLowerCase(),email=env.ADMIN_EMAIL?.trim().toLowerCase();if(!domain||domain.includes('@')||!email||!/^[^@\s]+@[^@\s]+$/.test(email))throw Error('Set COMPANY_DOMAIN and a valid ADMIN_EMAIL before setup.');return email}
export const employeeDefaults={title:'',department_id:null,google_sub:null,role:'Dev',active:1,supervisor_id:null,onboarded:0,theme:'Light',language:'English',office_days:'["Mon","Tue","Thu"]',start_hour:'09:00',end_hour:'17:00',availability:'In office',assigned_role_id:null,is_manager:0};
export async function seedDatabase(env=process.env){const email=validateAdministrator(env);return transaction(async()=>{
 for(const name of ['Engineering','Design','Marketing','People & Culture','Operations'])if(!(await rows('departments')).some(d=>d.name===name))await insert('departments',{name});
 const dept=(await rows('departments')).find(d=>d.name==='People & Culture');
 const existing=(await rows('employees')).find(e=>e.email===email);
 if(existing){if(!existing.active)throw Error('ADMIN_EMAIL belongs to an inactive account. Setup never reactivates accounts.');}
 else {const role=(await rows('roles')).find(r=>r.name==='RH');if(!role)throw Error('Initialize roles first.');await insert('employees',{...employeeDefaults,email,name:'HR Administrator',title:'HR Administrator',department_id:dept.id,role:'RH',assigned_role_id:role.id})}
 for(const [name,capacity,equipment]of [['The Cove',6,'Display · Whiteboard'],['The Reef',12,'Video conferencing'],['The Lagoon',4,'Quiet focus room']])if(!(await rows('rooms')).some(r=>r.name===name))await insert('rooms',{name,capacity,equipment});
})}
