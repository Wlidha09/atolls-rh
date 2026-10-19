import { one, run, transaction } from './db.js';

export function validateAdministrator(env = process.env) {
  const domain = env.COMPANY_DOMAIN?.trim().toLowerCase();
  const email = env.ADMIN_EMAIL?.trim().toLowerCase();
  if (!domain || domain.includes('@') || !email || !/^[^@\s]+@[^@\s]+$/.test(email)) {
    throw new Error('Set COMPANY_DOMAIN to the employee domain and ADMIN_EMAIL to a valid Google account email before initializing the database.');
  }
  return email;
}

export async function seedDatabase(env = process.env) {
  const email = validateAdministrator(env);
  await transaction(async () => {
    for (const name of ['Engineering', 'Design', 'Marketing', 'People & Culture', 'Operations']) {
      await run('INSERT OR IGNORE INTO departments(name) VALUES(?)', name);
    }
    const dept = await one('SELECT id FROM departments WHERE name=?', 'People & Culture');
    await run("INSERT OR IGNORE INTO employees(email,name,title,department_id,role) VALUES(?,?,?,?, 'RH')", email, 'HR Administrator', 'HR Administrator', dept.id);
    const admin = await one('SELECT role,active FROM employees WHERE email=?', email);
    if (!admin.active || admin.role !== 'RH') throw new Error('ADMIN_EMAIL already belongs to an inactive or non-RH account. Existing accounts are never reactivated or promoted by setup.');
    for (const [name, capacity, equipment] of [['The Cove', 6, 'Display · Whiteboard'], ['The Reef', 12, 'Video conferencing'], ['The Lagoon', 4, 'Quiet focus room']]) {
      await run('INSERT OR IGNORE INTO rooms(name,capacity,equipment) VALUES(?,?,?)', name, capacity, equipment);
    }
  });
}
