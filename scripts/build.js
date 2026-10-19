import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { initializeForDeploy } from '../lib/deploy-setup.js';
import { closeDatabase } from '../lib/db.js';
import { describeError } from '../lib/diagnostics.js';

try {
  await initializeForDeploy();
} catch (error) {
  console.error('Database initialization failed:', describeError(error));
  closeDatabase();
  process.exit(1);
} finally { closeDatabase(); }

const require = createRequire(import.meta.url);
const result = spawnSync(process.execPath, [require.resolve('next/dist/bin/next'), 'build', ...process.argv.slice(2)], { stdio: 'inherit', env: process.env });
if (result.error) console.error('Next.js build failed:', result.error.message);
process.exit(result.status ?? 1);
