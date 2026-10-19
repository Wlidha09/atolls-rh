import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const dir = mkdtempSync(join(tmpdir(), 'atolls-tests-'));

process.env.COMPANY_DOMAIN = 'atolls.test';
const {
  run,
  one,
  all,
  default: db
} = await import('../lib/db.js');
const {createClient} = await import('@libsql/client/node');
const {installTestClient,initializeSchema} = await import('../lib/db.js');
const {pathToFileURL} = await import('node:url');
process.env.NODE_ENV='test';
installTestClient(createClient({url:pathToFileURL(join(dir,'test.sqlite')).href}));
await initializeSchema();
const {
  mutate,
  snapshot
} = await import('../lib/service.js');
const {
  googleAllowed,
  workingDays,
  canReview
} = await import('../lib/policy.js');
const {
  acceptGoogleIdentity
} = await import('../lib/identity.js');
await run("INSERT INTO departments(name) VALUES('Engineering')");
await run("INSERT INTO employees(id,email,name,title,department_id,role,onboarded) VALUES(1,'hr@atolls.test','HR','Administrator',1,'RH',1)");
await run("INSERT INTO employees(id,email,name,title,department_id,role,onboarded,supervisor_id) VALUES(2,'owner@atolls.test','Owner','Lead',1,'Owner',1,1),(3,'dev@atolls.test','Dev','Engineer',1,'Dev',1,2),(4,'other@atolls.test','Other','Engineer',1,'Dev',1,1)");
await run("INSERT INTO rooms(id,name,capacity,equipment) VALUES(1,'Cove',6,'Screen')");
const employee = async id => await one('SELECT * FROM employees WHERE id=?', id),
  hr = await employee(1),
  owner = await employee(2),
  dev = await employee(3),
  other = await employee(4);
async function expectStatus(fn, status) {
  await assert.rejects(fn, e => e.status === status);
}
test('Google domain requires verified email, Workspace hd and exact domain', () => {
  assert.equal(googleAllowed({
    email: 'dev@atolls.test',
    email_verified: true,
    hd: 'atolls.test'
  }, 'atolls.test'), true);
  for (const p of [{
    email: 'dev@evil.test',
    email_verified: true,
    hd: 'atolls.test'
  }, {
    email: 'dev@atolls.test',
    email_verified: false,
    hd: 'atolls.test'
  }, {
    email: 'dev@sub.atolls.test',
    email_verified: true,
    hd: 'sub.atolls.test'
  }, {
    email: 'dev@atolls.test',
    email_verified: true
  }]) assert.equal(googleAllowed(p, 'atolls.test'), false);
});
test('Dev cannot create employees or inspect company audit trail', async () => {
  await expectStatus(async () => await mutate(dev, 'employeeCreate', {
    name: 'X',
    email: 'x@atolls.test',
    title: 'Engineer',
    department_id: 1,
    role: 'RH',
    supervisor_id: null
  }), 403);
  assert.ok((await snapshot(dev)).logs.every(l => l.actor_id === dev.id));
});
test('leave notifications and review permissions are enforced', async () => {
  const day = new Date(Date.now() + 14 * 86400000);
  while ([0, 6].includes(day.getUTCDay())) day.setUTCDate(day.getUTCDate() + 1);
  const date = day.toISOString().slice(0, 10);
  await mutate(dev, 'leave', {
    type: 'Annual leave',
    start_date: date,
    end_date: date
  });
  const leave = await one('SELECT * FROM leaves WHERE employee_id=3');
  assert.equal((await one('SELECT * FROM notifications WHERE employee_id=2')).subject, 'New leave request');
  await expectStatus(async () => await mutate(dev, 'review', {
    id: leave.id,
    status: 'Approved'
  }), 403);
  await expectStatus(async () => await mutate(other, 'review', {
    id: leave.id,
    status: 'Approved'
  }), 403);
  await mutate(owner, 'review', {
    id: leave.id,
    status: 'Approved'
  });
  assert.equal((await one('SELECT status FROM leaves WHERE id=?', leave.id)).status, 'Approved');
  await expectStatus(async () => await mutate(hr, 'review', {
    id: leave.id,
    status: 'Rejected'
  }), 409);
  assert.equal((await snapshot(other)).leaves.length, 0);
  await expectStatus(async () => await mutate(dev, 'leave', {
    type: 'Annual leave',
    start_date: date,
    end_date: date
  }), 409);
});
test('Owners cannot review their own leave or manage unrelated employees', async () => {
  assert.equal(canReview(owner, owner), false);
  assert.equal(canReview(owner, other), false);
  assert.equal(canReview(owner, dev), true);
  await expectStatus(async () => await mutate(owner, 'ticket', {
    title: 'Unauthorized task',
    description: '',
    priority: 'Low',
    assignee_id: 4
  }), 403);
});
test('room booking conflicts are atomic and adjacent meetings are permitted', async () => {
  const start = new Date(Date.now() + 21 * 86400000);
  start.setUTCHours(10, 0, 0, 0);
  const a = start.toISOString(),
    b = new Date(start.getTime() + 3600000).toISOString(),
    c = new Date(start.getTime() + 7200000).toISOString();
  await mutate(dev, 'meeting', {
    title: 'Planning',
    room_id: 1,
    start_at: a,
    end_at: b,
    attendees: [2]
  });
  await expectStatus(async () => await mutate(other, 'meeting', {
    title: 'Overlap',
    room_id: 1,
    start_at: a,
    end_at: b
  }), 409);
  await mutate(other, 'meeting', {
    title: 'Adjacent',
    room_id: 1,
    start_at: b,
    end_at: c
  });
  const m = await one('SELECT * FROM meetings WHERE organizer_id=3');
  await expectStatus(async () => await mutate(other, 'cancelMeeting', {
    id: m.id
  }), 403);
  assert.equal((await all('SELECT * FROM meetings')).length, 2);
});
test('deactivation revokes sessions; self-demotion and supervisor cycles are blocked', async () => {
  await run('INSERT INTO sessions VALUES(?,?,?)', 'test', 4, Date.now() + 86400000);
  await mutate(hr, 'employeeUpdate', {
    id: 4,
    role: 'Dev',
    active: false,
    department_id: 1,
    supervisor_id: 1
  });
  assert.equal((await one('SELECT active FROM employees WHERE id=4')).active, 0);
  assert.equal(await one('SELECT * FROM sessions WHERE employee_id=4'), undefined);
  await expectStatus(async () => await mutate(hr, 'employeeUpdate', {
    id: 1,
    role: 'Dev',
    active: true,
    department_id: 1,
    supervisor_id: null
  }), 400);
  await expectStatus(async () => await mutate(hr, 'employeeUpdate', {
    id: 2,
    role: 'Owner',
    active: true,
    department_id: 1,
    supervisor_id: 2
  }), 400);
});
test('input validation rejects unknown actions, impossible dates and inverted work hours', async () => {
  await expectStatus(async () => await mutate(dev, 'deleteEverything', {}), 400);
  await expectStatus(async () => await mutate(dev, 'constructor', {}), 400);
  await expectStatus(async () => await mutate(dev, 'leave', {
    type: 'Annual leave',
    start_date: '2030-02-30',
    end_date: '2030-02-30'
  }), 400);
  await expectStatus(async () => await mutate(dev, 'profile', {
    name: 'Dev',
    title: 'Engineer',
    department_id: 1,
    theme: 'Light',
    language: 'English',
    office_days: ['Mon'],
    start_hour: '17:00',
    end_hour: '09:00'
  }), 400);
  assert.equal(workingDays('2026-10-16', '2026-10-19'), 2);
});
test('inactive Google identity is rejected and supervisor receives a persistent security notification', async () => {
  await expectStatus(async () => await acceptGoogleIdentity({
    sub: 'inactive-sub',
    email: 'other@atolls.test',
    email_verified: true,
    hd: 'atolls.test',
    name: 'Other'
  }), 403);
  assert.ok(await one("SELECT id FROM notifications WHERE employee_id=1 AND subject='Security: inactive account login'"));
  assert.ok(await one("SELECT id FROM logs WHERE actor_id=4 AND type='Security' AND detail LIKE 'Inactive account%'"));
  await expectStatus(async () => await mutate(other, 'availability', {
    availability: 'Remote'
  }), 401);
});
test('first-time Google users receive Dev access and incomplete onboarding', async () => {
  const fresh = await acceptGoogleIdentity({
    sub: 'new-google-sub',
    email: 'new@atolls.test',
    email_verified: true,
    hd: 'atolls.test',
    name: 'New Person'
  });
  assert.equal(fresh.role, 'Dev');
  assert.equal(fresh.onboarded, 0);
  await expectStatus(async () => await mutate(fresh, 'ticket', {
    title: 'Premature',
    priority: 'Low',
    assignee_id: fresh.id
  }), 409);
  await expectStatus(async () => await acceptGoogleIdentity({
    sub: 'different-google-sub',
    email: 'new@atolls.test',
    email_verified: true,
    hd: 'atolls.test'
  }), 403);
  await mutate(fresh, 'profile', {
    name: 'New Person',
    title: 'Engineer',
    department_id: 1,
    theme: 'Light',
    language: 'English',
    office_days: ['Mon'],
    start_hour: '09:00',
    end_hour: '17:00'
  });
  assert.equal((await employee(fresh.id)).onboarded, 1);
});
after(() => {
  db.close();
  rmSync(dir, {
    recursive: true,
    force: true
  });
});
