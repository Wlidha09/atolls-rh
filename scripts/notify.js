import {deliverNotifications} from '../lib/notifications.js';
import {closeDatabase} from '../lib/db.js';
try { console.log(await deliverNotifications()); } finally { closeDatabase(); }
