import {migrateTurso} from '../lib/migration.js';
import {describeError} from '../lib/diagnostics.js';
try{const result=await migrateTurso();console.log('Migration complete:',result.employees,'employees; source digest:',result.sourceDigest)}catch(error){console.error(describeError(error));process.exitCode=1}
