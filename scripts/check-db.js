import {read,state} from '../lib/db.js';
try{await read(()=>{if(!state().meta.initialized)throw Error('Firebase is not initialized. Import Turso data or run setup.');console.log('Firebase connection and schema: OK.')})}catch(error){console.error(error.message);process.exitCode=1}
