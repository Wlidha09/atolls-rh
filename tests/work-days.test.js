import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {createClient} from '@libsql/client/node';
import {calculateWorkDays,monthBounds} from '../lib/work-days.js';
import {workDaysReport} from '../lib/work-report.js';
import {installTestClient,initializeSchema,run,one,closeDatabase} from '../lib/db.js';
process.env.NODE_ENV='test';
const holiday=date=>({date});
const leave=(start_date,end_date,status='Approved')=>({start_date,end_date,status});
test('October reference: 31 days minus 9 weekends and 3 weekday holidays equals 19',()=>{
 assert.deepEqual(calculateWorkDays(2026,10,['2026-10-01','2026-10-02','2026-10-05'].map(holiday)),{totalDays:31,weekends:9,publicHolidays:3,approvedLeave:0,netWorkedDays:19});
});
test('weekend holidays, duplicate holidays and leave overlaps never double deduct',()=>{
 const result=calculateWorkDays(2026,10,['2026-10-03','2026-10-05','2026-10-05'].map(holiday),[leave('2026-10-02','2026-10-06'),leave('2026-10-06','2026-10-07')]);
 assert.deepEqual(result,{totalDays:31,weekends:9,publicHolidays:1,approvedLeave:3,netWorkedDays:18});
});
test('only approved leave counts, clipped at month boundaries including year transitions',()=>{
 const result=calculateWorkDays(2027,1,[],[leave('2026-12-28','2027-01-04'),leave('2027-01-29','2027-02-03'),leave('2027-01-05','2027-01-07','Pending'),leave('2027-01-08','2027-01-11','Rejected'),leave('2026-12-01','2026-12-02')]);
 assert.equal(result.totalDays,31);assert.equal(result.weekends,10);assert.equal(result.approvedLeave,3);assert.equal(result.netWorkedDays,18);
});
test('leap February and full-month leave calculate correctly without negative totals',()=>{
 assert.equal(monthBounds(2024,2).days,29);assert.equal(monthBounds(2025,2).days,28);
 const result=calculateWorkDays(2024,2,[holiday('2024-02-01')],[leave('2024-01-01','2024-03-31')]);
 assert.deepEqual(result,{totalDays:29,weekends:8,publicHolidays:1,approvedLeave:20,netWorkedDays:0});
});
test('invalid month and year values fail before querying data',()=>{
 for(const [year,month] of [[2026,0],[2026,13],[NaN,1],[2026,1.5],[1969,1],[2101,1],[2026,NaN]])assert.throws(()=>monthBounds(year,month),error=>error.status===400);
});
const dir=mkdtempSync(join(tmpdir(),'atolls-work-days-'));
installTestClient(createClient({url:pathToFileURL(join(dir,'fixture.sqlite')).href}));
await initializeSchema();
await run("INSERT INTO departments(id,name) VALUES(1,'People')");
await run("INSERT INTO employees(id,email,name,title,role,onboarded,supervisor_id) VALUES(1,'hr@test.invalid','HR','HR','RH',1,NULL),(2,'manager@test.invalid','Manager','Lead','Owner',1,1),(3,'employee@test.invalid','Employee','Engineer','Dev',1,2),(4,'inactive@test.invalid','Inactive','Engineer','Dev',1,NULL)");
await run('UPDATE employees SET active=0 WHERE id=4');
await run("INSERT INTO holidays(name,date,office) VALUES('Holiday','2026-10-01','Tunis'),('Duplicate holiday','2026-10-01','Berlin'),('Weekend holiday','2026-10-03','Tunis')");
await run("INSERT INTO leaves(employee_id,type,start_date,end_date,status,note) VALUES(3,'Annual leave','2026-10-02','2026-10-05','Approved','Private note'),(2,'Sick leave','2026-10-06','2026-10-07','Approved','Private medical note'),(3,'Annual leave','2026-10-08','2026-10-09','Pending','Pending')");
const employee=id=>one('SELECT * FROM employees WHERE id=?',id);
after(()=>{closeDatabase();rmSync(dir,{recursive:true,force:true})});
test('employees and managers receive only their own monthly totals, without leave details',async()=>{
 const own=await workDaysReport(await employee(3),2026,10);
 assert.equal(own.organization,false);assert.equal(own.employees.length,1);assert.equal(own.employees[0].id,3);assert.equal(own.employees[0].approvedLeave,2);assert.equal(own.employees[0].netWorkedDays,19);
 const manager=await workDaysReport(await employee(2),2026,10);
 assert.equal(manager.organization,false);assert.deepEqual(manager.employees.map(e=>e.id),[2]);
 assert.ok(!JSON.stringify(manager).includes('Private'));
});
test('HR report lists all employees including inactive accounts with per-employee totals',async()=>{
 const report=await workDaysReport(await employee(1),2026,10);
 assert.equal(report.organization,true);assert.equal(report.employees.length,4);assert.equal(report.employees.find(e=>e.id===4).active,0);
 assert.equal(report.employees.reduce((sum,e)=>sum+e.netWorkedDays,0),80);
 assert.ok(report.employees.every(e=>!('email' in e)&&!('note' in e)&&!('google_sub' in e)));
});
test('report reloads current access rather than trusting stale roles or active flags',async()=>{
 const stale=await employee(1);
 await run("UPDATE employees SET role='Dev' WHERE id=1");
 const report=await workDaysReport(stale,2026,10);assert.equal(report.organization,false);assert.deepEqual(report.employees.map(e=>e.id),[1]);
 await run('UPDATE employees SET active=0 WHERE id=1');
 await assert.rejects(()=>workDaysReport(stale,2026,10),error=>error.status===401);
 const inactive=await employee(4);await assert.rejects(()=>workDaysReport(inactive,2026,10),error=>error.status===401);
});
