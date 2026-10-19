import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
const dir=mkdtempSync(join(tmpdir(),'atolls-tests-'));
process.env.DB_PATH=join(dir,'test.sqlite');process.env.COMPANY_DOMAIN='atolls.test';
const {run,one,all,default:db}=await import('../lib/db.js');
const {mutate,snapshot}=await import('../lib/service.js');
const {googleAllowed,workingDays,canReview}=await import('../lib/policy.js');
const {acceptGoogleIdentity}=await import('../lib/identity.js');
run("INSERT INTO departments(name) VALUES('Engineering')");
run("INSERT INTO employees(id,email,name,title,department_id,role,onboarded) VALUES(1,'hr@atolls.test','HR','Administrator',1,'RH',1)");
run("INSERT INTO employees(id,email,name,title,department_id,role,onboarded,supervisor_id) VALUES(2,'owner@atolls.test','Owner','Lead',1,'Owner',1,1),(3,'dev@atolls.test','Dev','Engineer',1,'Dev',1,2),(4,'other@atolls.test','Other','Engineer',1,'Dev',1,1)");
run("INSERT INTO rooms(id,name,capacity,equipment) VALUES(1,'Cove',6,'Screen')");
const employee=id=>one('SELECT * FROM employees WHERE id=?',id),hr=employee(1),owner=employee(2),dev=employee(3),other=employee(4);
function expectStatus(fn,status){assert.throws(fn,e=>e.status===status)}
test('Google domain requires verified email, Workspace hd and exact domain',()=>{
 assert.equal(googleAllowed({email:'dev@atolls.test',email_verified:true,hd:'atolls.test'},'atolls.test'),true);
 for(const p of [{email:'dev@evil.test',email_verified:true,hd:'atolls.test'},{email:'dev@atolls.test',email_verified:false,hd:'atolls.test'},{email:'dev@sub.atolls.test',email_verified:true,hd:'sub.atolls.test'},{email:'dev@atolls.test',email_verified:true}])assert.equal(googleAllowed(p,'atolls.test'),false);
});
test('Dev cannot create employees or inspect company audit trail',()=>{
 expectStatus(()=>mutate(dev,'employeeCreate',{name:'X',email:'x@atolls.test',title:'Engineer',department_id:1,role:'RH',supervisor_id:null}),403);
 assert.ok(snapshot(dev).logs.every(l=>l.actor_id===dev.id));
});
test('leave notifications and review permissions are enforced',()=>{
 const day=new Date(Date.now()+14*86400000);while([0,6].includes(day.getUTCDay()))day.setUTCDate(day.getUTCDate()+1);const date=day.toISOString().slice(0,10);
 mutate(dev,'leave',{type:'Annual leave',start_date:date,end_date:date});
 const leave=one('SELECT * FROM leaves WHERE employee_id=3');
 assert.equal(one('SELECT * FROM notifications WHERE employee_id=2').subject,'New leave request');
 expectStatus(()=>mutate(dev,'review',{id:leave.id,status:'Approved'}),403);
 expectStatus(()=>mutate(other,'review',{id:leave.id,status:'Approved'}),403);
 mutate(owner,'review',{id:leave.id,status:'Approved'});
 assert.equal(one('SELECT status FROM leaves WHERE id=?',leave.id).status,'Approved');
 expectStatus(()=>mutate(hr,'review',{id:leave.id,status:'Rejected'}),409);
 assert.equal(snapshot(other).leaves.length,0);
 expectStatus(()=>mutate(dev,'leave',{type:'Annual leave',start_date:date,end_date:date}),409);
});
test('Owners cannot review their own leave or manage unrelated employees',()=>{
 assert.equal(canReview(owner,owner),false);assert.equal(canReview(owner,other),false);assert.equal(canReview(owner,dev),true);
 expectStatus(()=>mutate(owner,'ticket',{title:'Unauthorized task',description:'',priority:'Low',assignee_id:4}),403);
});
test('room booking conflicts are atomic and adjacent meetings are permitted',()=>{
 const start=new Date(Date.now()+21*86400000);start.setUTCHours(10,0,0,0);
 const a=start.toISOString(),b=new Date(start.getTime()+3600000).toISOString(),c=new Date(start.getTime()+7200000).toISOString();
 mutate(dev,'meeting',{title:'Planning',room_id:1,start_at:a,end_at:b,attendees:[2]});
 expectStatus(()=>mutate(other,'meeting',{title:'Overlap',room_id:1,start_at:a,end_at:b}),409);
 mutate(other,'meeting',{title:'Adjacent',room_id:1,start_at:b,end_at:c});
 const m=one('SELECT * FROM meetings WHERE organizer_id=3');
 expectStatus(()=>mutate(other,'cancelMeeting',{id:m.id}),403);
 assert.equal(all('SELECT * FROM meetings').length,2);
});
test('deactivation revokes sessions; self-demotion and supervisor cycles are blocked',()=>{
 run('INSERT INTO sessions VALUES(?,?,?)','test',4,Date.now()+86400000);
 mutate(hr,'employeeUpdate',{id:4,role:'Dev',active:false,department_id:1,supervisor_id:1});
 assert.equal(one('SELECT active FROM employees WHERE id=4').active,0);
 assert.equal(one('SELECT * FROM sessions WHERE employee_id=4'),undefined);
 expectStatus(()=>mutate(hr,'employeeUpdate',{id:1,role:'Dev',active:true,department_id:1,supervisor_id:null}),400);
 expectStatus(()=>mutate(hr,'employeeUpdate',{id:2,role:'Owner',active:true,department_id:1,supervisor_id:2}),400);
});
test('input validation rejects unknown actions, impossible dates and inverted work hours',()=>{
 expectStatus(()=>mutate(dev,'deleteEverything',{}),400);
 expectStatus(()=>mutate(dev,'constructor',{}),400);
 expectStatus(()=>mutate(dev,'leave',{type:'Annual leave',start_date:'2030-02-30',end_date:'2030-02-30'}),400);
 expectStatus(()=>mutate(dev,'profile',{name:'Dev',title:'Engineer',department_id:1,theme:'Light',language:'English',office_days:['Mon'],start_hour:'17:00',end_hour:'09:00'}),400);
 assert.equal(workingDays('2026-10-16','2026-10-19'),2);
});
test('inactive Google identity is rejected and supervisor receives a persistent security notification',()=>{
 expectStatus(()=>acceptGoogleIdentity({sub:'inactive-sub',email:'other@atolls.test',email_verified:true,hd:'atolls.test',name:'Other'}),403);
 assert.ok(one("SELECT id FROM notifications WHERE employee_id=1 AND subject='Security: inactive account login'"));
 assert.ok(one("SELECT id FROM logs WHERE actor_id=4 AND type='Security' AND detail LIKE 'Inactive account%'"));
 expectStatus(()=>mutate(other,'availability',{availability:'Remote'}),401);
});
test('first-time Google users receive Dev access and incomplete onboarding',()=>{
 const fresh=acceptGoogleIdentity({sub:'new-google-sub',email:'new@atolls.test',email_verified:true,hd:'atolls.test',name:'New Person'});
 assert.equal(fresh.role,'Dev');assert.equal(fresh.onboarded,0);
 expectStatus(()=>mutate(fresh,'ticket',{title:'Premature',priority:'Low',assignee_id:fresh.id}),409);
 expectStatus(()=>acceptGoogleIdentity({sub:'different-google-sub',email:'new@atolls.test',email_verified:true,hd:'atolls.test'}),403);
 mutate(fresh,'profile',{name:'New Person',title:'Engineer',department_id:1,theme:'Light',language:'English',office_days:['Mon'],start_hour:'09:00',end_hour:'17:00'});
 assert.equal(employee(fresh.id).onboarded,1);
});
after(()=>{db.close();rmSync(dir,{recursive:true,force:true})});
