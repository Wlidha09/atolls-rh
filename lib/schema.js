// Run only during explicit setup or the opt-in production deployment migration.
export const schema = `
CREATE TABLE IF NOT EXISTS roles (
 id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE COLLATE NOCASE,
 is_system INTEGER NOT NULL DEFAULT 0 CHECK(is_system IN (0,1)),
 scope TEXT NOT NULL DEFAULT 'self' CHECK(scope IN ('self','team','global')),
 permissions_json TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS departments (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE);
CREATE TABLE IF NOT EXISTS employees (
 id INTEGER PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
 google_sub TEXT UNIQUE, title TEXT NOT NULL DEFAULT '', department_id INTEGER REFERENCES departments(id),
 role TEXT NOT NULL DEFAULT 'Dev' CHECK(role IN ('Dev','Owner','RH')),
 active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)), supervisor_id INTEGER REFERENCES employees(id),
 onboarded INTEGER NOT NULL DEFAULT 0, theme TEXT DEFAULT 'Light', language TEXT DEFAULT 'English',
 office_days TEXT DEFAULT '["Mon","Tue","Thu"]', start_hour TEXT DEFAULT '09:00', end_hour TEXT DEFAULT '17:00',
 availability TEXT DEFAULT 'In office' CHECK(availability IN ('In office','Remote','On leave')),
 created_at TEXT DEFAULT CURRENT_TIMESTAMP,
 assigned_role_id INTEGER REFERENCES roles(id)
);
CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, employee_id INTEGER NOT NULL REFERENCES employees(id), expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS leaves (
 id INTEGER PRIMARY KEY, employee_id INTEGER NOT NULL REFERENCES employees(id), type TEXT NOT NULL,
 start_date TEXT NOT NULL, end_date TEXT NOT NULL, note TEXT DEFAULT '',
 status TEXT NOT NULL DEFAULT 'Pending' CHECK(status IN ('Pending','Approved','Rejected')),
 reviewed_by INTEGER REFERENCES employees(id), created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS rooms (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, capacity INTEGER NOT NULL, equipment TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS meetings (id INTEGER PRIMARY KEY, title TEXT NOT NULL, room_id INTEGER NOT NULL REFERENCES rooms(id),
 organizer_id INTEGER NOT NULL REFERENCES employees(id), start_at TEXT NOT NULL, end_at TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS meeting_attendees (meeting_id INTEGER NOT NULL REFERENCES meetings(id) ON DELETE CASCADE, employee_id INTEGER NOT NULL REFERENCES employees(id), PRIMARY KEY(meeting_id,employee_id));
CREATE TABLE IF NOT EXISTS tickets (id INTEGER PRIMARY KEY, title TEXT NOT NULL, description TEXT DEFAULT '', priority TEXT NOT NULL CHECK(priority IN ('Low','Medium','High')),
 status TEXT DEFAULT 'To do' CHECK(status IN ('To do','In progress','Done')), assignee_id INTEGER NOT NULL REFERENCES employees(id), created_by INTEGER NOT NULL REFERENCES employees(id));
CREATE TABLE IF NOT EXISTS holidays (id INTEGER PRIMARY KEY, name TEXT NOT NULL, date TEXT NOT NULL, office TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS logs (id INTEGER PRIMARY KEY, actor_id INTEGER REFERENCES employees(id), type TEXT NOT NULL, detail TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS notifications (id INTEGER PRIMARY KEY, employee_id INTEGER NOT NULL REFERENCES employees(id), subject TEXT NOT NULL,
 body TEXT NOT NULL, is_read INTEGER DEFAULT 0, email_status TEXT DEFAULT 'Queued' CHECK(email_status IN ('Queued','Sending','Sent')),
 attempts INTEGER DEFAULT 0, last_attempt TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);`;
