import {initializeSchema} from './db.js';
import {seedDatabase,validateAdministrator} from './seed.js';
import {migrateTurso} from './migration.js';
export async function initializeForDeploy(env=process.env,operations={initializeSchema,seedDatabase,migrateTurso}){
 const setup=env.INITIALIZE_DATABASE==='true',migrate=env.MIGRATE_TURSO_TO_FIREBASE==='true';
 if(!setup&&!migrate)return 'disabled';
 if(env.NETLIFY!=='true'||env.CONTEXT!=='production'){console.log('Database initialization/import skipped outside a production Netlify build.');return 'skipped'}
 if(setup&&migrate)throw Error('Use MIGRATE_TURSO_TO_FIREBASE OR INITIALIZE_DATABASE, not both. Import must target an empty Firebase namespace.');
 if(migrate){const result=await operations.migrateTurso(env);console.log('Turso import complete:',result.employees,'employees. Source unchanged; sessions cleared. Remove MIGRATE_TURSO_TO_FIREBASE.');return 'migrated'}
 validateAdministrator(env);await operations.initializeSchema();await operations.seedDatabase(env);console.log('Firebase setup complete. Remove INITIALIZE_DATABASE.');return 'initialized';
}
