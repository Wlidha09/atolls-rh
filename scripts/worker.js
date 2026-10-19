import {deliverNotifications} from '../lib/notifications.js';
import {setTimeout} from 'node:timers/promises';
let running=true;
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>{running=false;});
if(!process.env.SMTP_HOST){console.error('Set SMTP_HOST before starting the email worker. In-app notifications work independently.');process.exit(1);}
console.log('Atolls notification worker started.');
while(running){try{const result=await deliverNotifications();if(result.sent)console.log(`Delivered ${result.sent} email(s).`);}catch(error){console.error('Notification delivery failed:',error.message);}if(running)await setTimeout(30000);}
