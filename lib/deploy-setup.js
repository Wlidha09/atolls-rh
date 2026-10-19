import { initializeSchema } from './db.js';
import { seedDatabase, validateAdministrator } from './seed.js';

export async function initializeForDeploy(env = process.env, operations = { initializeSchema, seedDatabase }) {
  if (env.INITIALIZE_DATABASE !== 'true') return 'disabled';
  if (env.NETLIFY !== 'true' || env.CONTEXT !== 'production') {
    console.log('Database setup skipped: only a production Netlify build can use INITIALIZE_DATABASE.');
    return 'skipped';
  }
  validateAdministrator(env);
  console.log('Initializing Turso tables and the first HR administrator.');
  await operations.initializeSchema();
  await operations.seedDatabase(env);
  console.log('Database setup complete. Remove INITIALIZE_DATABASE in Netlify.');
  return 'initialized';
}
