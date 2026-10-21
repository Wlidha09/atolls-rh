import {rows,get,insert,update,audit,queueNotification,transaction} from './db.js';
import {ensure,googleAllowed,isConfiguredAdministrator} from './policy.js';
import {hydrateEmployee,findRole} from './role-store.js';
import {employeeDefaults} from './seed.js';
export async function acceptGoogleIdentity(profile){
 ensure(googleAllowed(profile,process.env.COMPANY_DOMAIN,process.env.ADMIN_EMAIL),403,'Domain');
 const email=profile.email.toLowerCase();
 const result=await transaction(async()=>{
  let employee=(await rows('employees')).find(e=>e.email===email);
  if(employee&&!employee.active){await audit(employee.id,'Security',`Inactive account sign-in blocked: ${email}`);const supervisor=employee.supervisor_id?await get('employees',employee.supervisor_id):null;for(const recipient of supervisor?.active?[supervisor]:(await rows('employees')).filter(e=>e.role==='RH'&&e.active))await queueNotification(recipient.id,'Security: inactive account login',`${employee.name} (${email}) attempted to sign in with a deactivated account. Access was blocked.`);return {blocked:true}}
  if(email.split('@')[1]!==process.env.COMPANY_DOMAIN?.trim().toLowerCase())ensure(employee,503,'Configuration');
  ensure(!employee?.google_sub||employee.google_sub===profile.sub,403,'OAuth');
  if(!employee){ensure(!isConfiguredAdministrator(email,process.env.ADMIN_EMAIL),503,'Configuration');const supervisor=(await rows('employees')).find(e=>e.role==='RH'&&e.active);ensure(supervisor,503,'Configuration');const role=await findRole('Employee');employee=await insert('employees',{...employeeDefaults,email,name:profile.name||email,google_sub:profile.sub,supervisor_id:supervisor.is_manager?supervisor.id:null,assigned_role_id:role.id});}
  else {await update('employees',employee.id,{google_sub:profile.sub});employee.google_sub=profile.sub}
  await audit(employee.id,'Security','Google sign-in succeeded');return {employee:await hydrateEmployee(employee)};
 });ensure(!result.blocked,403,'Inactive');return result.employee;
}
