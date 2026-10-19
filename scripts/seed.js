import {seedDatabase} from '../lib/seed.js';
import {closeDatabase} from '../lib/db.js';
import {describeError} from '../lib/diagnostics.js';
try { await seedDatabase(); console.log('Departments, rooms and the initial HR administrator are ready.'); } catch(error) { console.error('Database seed failed:',describeError(error)); process.exitCode=1; } finally { closeDatabase(); }
