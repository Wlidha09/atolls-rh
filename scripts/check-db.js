import { one, closeDatabase } from '../lib/db.js';
try {
  await one('SELECT 1 AS ok');
  const result = await one("SELECT count(*) AS n FROM sqlite_master WHERE type='table' AND name IN ('employees','sessions','leaves','meetings','notifications')");
  if (result.n !== 5) throw new Error('Connection succeeded, but tables are missing. Run npm run db:setup.');
  const admin = await one("SELECT count(*) AS n FROM employees WHERE role='RH' AND active=1");
  if (!admin.n) throw new Error('Tables exist, but no active HR administrator exists. Run npm run seed.');
  console.log('Database connection, tables and administrator: OK.');
} catch (error) {
  console.error('Database check failed:', error.message);
  process.exitCode = 1;
} finally { closeDatabase(); }
