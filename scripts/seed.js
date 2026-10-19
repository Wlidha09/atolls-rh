import { one, run, transaction, closeDatabase } from '../lib/db.js';
if (!process.env.COMPANY_DOMAIN || !process.env.ADMIN_EMAIL || process.env.ADMIN_EMAIL.toLowerCase().split('@')[1] !== process.env.COMPANY_DOMAIN.toLowerCase()) throw new Error('Set COMPANY_DOMAIN and matching ADMIN_EMAIL in .env.local first.');
await transaction(async () => {
  for (const name of ['Engineering', 'Design', 'Marketing', 'People & Culture', 'Operations']) await run('INSERT OR IGNORE INTO departments(name) VALUES(?)', name);
  const dept = await one('SELECT id FROM departments WHERE name=?', 'People & Culture');
  // Idempotent: never reactivate, demote or overwrite an existing account.
  await run("INSERT OR IGNORE INTO employees(email,name,title,department_id,role) VALUES(?,?,?,?, 'RH')", process.env.ADMIN_EMAIL.toLowerCase(), 'HR Administrator', 'HR Administrator', dept.id);
  for (const [name, capacity, equipment] of [['The Cove', 6, 'Display · Whiteboard'], ['The Reef', 12, 'Video conferencing'], ['The Lagoon', 4, 'Quiet focus room']]) await run('INSERT OR IGNORE INTO rooms(name,capacity,equipment) VALUES(?,?,?)', name, capacity, equipment);
});
console.log('Departments, rooms and the initial HR administrator are ready.');

closeDatabase();
