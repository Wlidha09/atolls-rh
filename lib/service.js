import { z } from 'zod';
import { all, one, run, transaction, audit, queueNotification } from './db.js';
import { ensure, manages, canReview, workingDays } from './policy.js';
const text = z.string().trim().min(1).max(200),
  id = z.number().int().positive();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(s => !isNaN(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s, 'Invalid calendar date');
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const role = z.enum(['Dev', 'Owner', 'RH']);
const schemas = {
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
    supervisor_id: id.nullable()
  }),
  employeeUpdate: z.object({
    id,
    name: text.optional(),
    title: text.optional(),
    role,
    active: z.boolean(),
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
const publicColumns = 'id,name,title,department_id,availability';
async function employee(id) {
  const e = await one('SELECT * FROM employees WHERE id=?', id);
  ensure(e, 404, 'Employee not found.');
  return e;
}
function requireRH(actor) {
  ensure(actor.role === 'RH');
}
async function department(id) {
  ensure(await one('SELECT id FROM departments WHERE id=?', id), 400, 'Department not found.');
}
async function supervisorValid(supervisor, target) {
  if (supervisor === null) return;
  let s = await employee(supervisor);
  ensure(s.active && ['Owner', 'RH'].includes(s.role), 400, 'Supervisor must be an active Owner or RH administrator.');
  let visited = new Set([target]);
  while (s) {
    ensure(!visited.has(s.id), 400, 'Supervisor assignments cannot form a cycle.');
    visited.add(s.id);
    s = s.supervisor_id ? await employee(s.supervisor_id) : null;
  }
}
export async function snapshot(actor) {
  const full = actor.role === 'RH' ? await all('SELECT * FROM employees ORDER BY name') : await all(`SELECT ${publicColumns},CASE WHEN supervisor_id=? THEN supervisor_id ELSE NULL END AS supervisor_id FROM employees WHERE active=1 ORDER BY name`, actor.id);
  const team = actor.role === 'RH' ? (await all('SELECT id FROM employees')).map(x => x.id) : [actor.id, ...(actor.role === 'Owner' ? (await all('SELECT id FROM employees WHERE supervisor_id=?', actor.id)).map(x => x.id) : [])];
  const placeholders = team.map(() => '?').join(',');
  return {
    me: actor,
    employees: full,
    departments: await all('SELECT * FROM departments ORDER BY name'),
    leaves: await all(`SELECT l.*,e.name,e.title,e.supervisor_id FROM leaves l JOIN employees e ON e.id=l.employee_id WHERE l.employee_id IN (${placeholders}) ORDER BY l.created_at DESC`, ...team),
    rooms: await all('SELECT * FROM rooms ORDER BY name'),
    meetings: await all('SELECT m.*,e.name AS organizer,r.name AS room FROM meetings m JOIN employees e ON e.id=m.organizer_id JOIN rooms r ON r.id=m.room_id WHERE m.end_at>? ORDER BY m.start_at', new Date().toISOString()),
    attendees: await all('SELECT * FROM meeting_attendees'),
    tickets: await all(`SELECT t.*,e.name AS assignee FROM tickets t JOIN employees e ON e.id=t.assignee_id WHERE t.assignee_id IN (${placeholders}) OR t.created_by=? ORDER BY t.id DESC`, ...team, actor.id),
    holidays: await all('SELECT * FROM holidays ORDER BY date'),
    logs: actor.role === 'RH' ? await all('SELECT l.*,e.name AS actor FROM logs l LEFT JOIN employees e ON e.id=l.actor_id ORDER BY l.id DESC LIMIT 200') : await all('SELECT l.*,e.name AS actor FROM logs l LEFT JOIN employees e ON e.id=l.actor_id WHERE l.actor_id=? ORDER BY l.id DESC LIMIT 100', actor.id),
    notifications: await all('SELECT * FROM notifications WHERE employee_id=? ORDER BY id DESC LIMIT 100', actor.id)
  };
}
export async function mutate(actor, action, raw) {
  ensure(typeof action === 'string' && Object.hasOwn(schemas, action), 400, 'Unknown operation.');
  const parsed = schemas[action].safeParse(raw);
  ensure(parsed.success, 400, parsed.error?.issues.map(x => `${x.path.join('.')}: ${x.message}`).join('; '));
  const d = parsed.data;
  ensure(actor.onboarded || action === 'profile' || action === 'readNotifications', 409, 'Complete your onboarding profile first.');
  return await transaction(async () => {
    const latest = await employee(actor.id);
    ensure(latest.active, 401, 'This account is inactive.');
    ensure(latest.role === actor.role && latest.supervisor_id === actor.supervisor_id, 409, 'Your access changed. Refresh the portal and try again.');
    if (action === 'profile') {
      await department(d.department_id);
      ensure(d.end_hour > d.start_hour, 400, 'Work end time must be after start time.');
      // Organizational assignment can only be selected during onboarding. Later changes require HR.
      ensure(!actor.onboarded || actor.department_id === d.department_id, 403, 'Ask HR to change your department.');
      await run('UPDATE employees SET name=?,title=?,department_id=?,theme=?,language=?,office_days=?,start_hour=?,end_hour=?,onboarded=1 WHERE id=?', d.name, d.title, d.department_id, d.theme, d.language, JSON.stringify([...new Set(d.office_days)]), d.start_hour, d.end_hour, actor.id);
    } else if (action === 'availability') await run('UPDATE employees SET availability=? WHERE id=?', d.availability, actor.id);else if (action === 'department') {
      requireRH(actor);
      await run('INSERT INTO departments(name) VALUES(?)', d.name);
    } else if (action === 'employeeCreate') {
      requireRH(actor);
      await department(d.department_id);
      ensure(d.email.split('@')[1] === process.env.COMPANY_DOMAIN?.toLowerCase(), 400, 'Use the configured company domain.');
      ensure(!(await one('SELECT id FROM employees WHERE email=?', d.email)), 409, 'This employee already exists.');
      await supervisorValid(d.supervisor_id, -1);
      await run('INSERT INTO employees(name,email,title,department_id,role,supervisor_id) VALUES(?,?,?,?,?,?)', d.name, d.email, d.title, d.department_id, d.role, d.supervisor_id);
    } else if (action === 'employeeUpdate') {
      requireRH(actor);
      let target = await employee(d.id);
      await department(d.department_id);
      await supervisorValid(d.supervisor_id, d.id);
      ensure(actor.id !== target.id || d.active && d.role === 'RH', 400, 'You cannot deactivate or demote your own administrator account.');
      if (target.role === 'RH' && (!d.active || d.role !== 'RH')) ensure((await one("SELECT count(*) AS n FROM employees WHERE role='RH' AND active=1 AND id<>?", d.id)).n > 0, 400, 'Keep at least one active RH administrator.');
      if (!d.active || d.role === 'Dev') ensure(!(await one('SELECT id FROM employees WHERE supervisor_id=? AND active=1', d.id)), 400, 'Reassign active direct reports before deactivating or demoting this supervisor.');
      await run('UPDATE employees SET name=?,title=?,role=?,active=?,department_id=?,supervisor_id=? WHERE id=?', d.name || target.name, d.title || target.title, d.role, d.active ? 1 : 0, d.department_id, d.supervisor_id, d.id);
      if (!d.active) await run('DELETE FROM sessions WHERE employee_id=?', d.id);
    } else if (action === 'leave') {
      ensure(d.end_date >= d.start_date && d.start_date >= new Date().toISOString().slice(0, 10), 400, 'Choose a future or current date range.');
      ensure(d.end_date <= new Date(Date.now() + 366 * 86400000).toISOString().slice(0, 10), 400, 'Request leave within the next year.');
      ensure(workingDays(d.start_date, d.end_date) > 0, 400, 'Select at least one working day.');
      ensure(!(await one("SELECT id FROM leaves WHERE employee_id=? AND status<>'Rejected' AND start_date<=? AND end_date>=?", actor.id, d.end_date, d.start_date)), 409, 'You already have a leave request overlapping these dates.');
      await run('INSERT INTO leaves(employee_id,type,start_date,end_date,note) VALUES(?,?,?,?,?)', actor.id, d.type, d.start_date, d.end_date, d.note);
      const reviewers = actor.supervisor_id ? [{
        id: actor.supervisor_id
      }] : await all("SELECT id FROM employees WHERE role='RH' AND active=1 AND id<>?", actor.id);
      for (const r of reviewers) await queueNotification(r.id, 'New leave request', `${actor.name} requested ${d.type}: ${d.start_date} to ${d.end_date}. Review it in the Atolls HR portal.`);
    } else if (action === 'review') {
      const leave = await one('SELECT * FROM leaves WHERE id=?', d.id);
      ensure(leave, 404, 'Leave request not found.');
      ensure(canReview(actor, await employee(leave.employee_id)));
      ensure(leave.status === 'Pending', 409, 'This request was already reviewed.');
      await run('UPDATE leaves SET status=?,reviewed_by=? WHERE id=?', d.status, actor.id, d.id);
      await queueNotification(leave.employee_id, 'Leave request ' + d.status.toLowerCase(), `Your leave request for ${leave.start_date} to ${leave.end_date} was ${d.status.toLowerCase()} by ${actor.name}.`);
    } else if (action === 'room') {
      requireRH(actor);
      await run('INSERT INTO rooms(name,capacity,equipment) VALUES(?,?,?)', d.name, d.capacity, d.equipment);
    } else if (action === 'meeting') {
      d.start_at = new Date(d.start_at).toISOString();
      d.end_at = new Date(d.end_at).toISOString();
      ensure(d.end_at > d.start_at && d.start_at > new Date().toISOString(), 400, 'Choose a future meeting with an end after its start.');
      ensure(await one('SELECT id FROM rooms WHERE id=?', d.room_id), 404, 'Room not found.');
      ensure(!(await one('SELECT id FROM meetings WHERE room_id=? AND start_at<? AND end_at>?', d.room_id, d.end_at, d.start_at)), 409, 'The room is already booked for this time.');
      const attendeeIds = [...new Set([actor.id, ...d.attendees])];
      let room = await one('SELECT * FROM rooms WHERE id=?', d.room_id);
      ensure(attendeeIds.length <= room.capacity, 400, 'Too many attendees for this room.');
      for (const id of attendeeIds) ensure((await employee(id)).active, 400, 'Attendees must be active employees.');
      const result = await run('INSERT INTO meetings(title,room_id,organizer_id,start_at,end_at) VALUES(?,?,?,?,?)', d.title, d.room_id, actor.id, d.start_at, d.end_at);
      for (const id of attendeeIds) {
        await run('INSERT INTO meeting_attendees VALUES(?,?)', Number(result.lastInsertRowid), id);
        if (id !== actor.id) await queueNotification(id, 'Meeting invitation: ' + d.title, `${actor.name} invited you to ${d.title} in ${room.name}, ${d.start_at} to ${d.end_at}.`);
      }
    } else if (action === 'cancelMeeting') {
      const m = await one('SELECT * FROM meetings WHERE id=?', d.id);
      ensure(m, 404, 'Meeting not found.');
      ensure(m.organizer_id === actor.id || actor.role === 'RH');
      for (const a of await all('SELECT employee_id FROM meeting_attendees WHERE meeting_id=?', m.id)) if (a.employee_id !== actor.id) await queueNotification(a.employee_id, 'Meeting cancelled: ' + m.title, `${m.title} scheduled for ${m.start_at} has been cancelled.`);
      await run('DELETE FROM meetings WHERE id=?', d.id);
    } else if (action === 'ticket') {
      const assignee = await employee(d.assignee_id);
      ensure(assignee.active, 400, 'Assignee must be active.');
      ensure(assignee.id === actor.id || manages(actor, assignee));
      await run('INSERT INTO tickets(title,description,priority,assignee_id,created_by) VALUES(?,?,?,?,?)', d.title, d.description, d.priority, d.assignee_id, actor.id);
    } else if (action === 'ticketStatus') {
      const ticket = await one('SELECT * FROM tickets WHERE id=?', d.id);
      ensure(ticket, 404, 'Ticket not found.');
      ensure(ticket.assignee_id === actor.id || ticket.created_by === actor.id || manages(actor, await employee(ticket.assignee_id)));
      await run('UPDATE tickets SET status=? WHERE id=?', d.status, d.id);
    } else if (action === 'holiday') {
      requireRH(actor);
      await run('INSERT INTO holidays(name,date,office) VALUES(?,?,?)', d.name, d.date, d.office);
    } else if (action === 'readNotifications') await run('UPDATE notifications SET is_read=1 WHERE employee_id=?', actor.id);
    await audit(actor.id, action.startsWith('employee') ? 'Access' : 'Activity', `${actor.name}: ${action}${d.id ? ' #' + d.id : ''}${d.title ? ' — ' + d.title : ''}${d.status ? ' → ' + d.status : ''}`);
    return {
      ok: true
    };
  });
}
