import { initializeSchema, closeDatabase } from '../lib/db.js';
try {
  await initializeSchema();
  console.log('Turso tables are ready. Next run npm run seed.');
} catch (error) {
  console.error('Database setup failed:', error.message);
  process.exitCode = 1;
} finally { closeDatabase(); }
