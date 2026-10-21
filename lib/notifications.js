import nodemailer from 'nodemailer';
import {rows,get,update,transaction,read,timestamp} from './db.js';
export async function deliverNotifications({ maxMessages = 50, maxDurationMs = 120000 } = {}) {
  if (!process.env.SMTP_HOST) return {
    sent: 0,
    pending: true
  };
  const started = Date.now();
  const smtp = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true',
    connectionTimeout: 5000,
    greetingTimeout: 5000,
    socketTimeout: 5000,
    disableFileAccess: true,
    disableUrlAccess: true,
    ...(process.env.SMTP_USER ? {
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      }
    } : {})
  });
  await transaction(async()=>{for(const n of await rows('notifications'))if(n.email_status==='Sending'&&n.last_attempt<new Date(Date.now()-600000).toISOString().slice(0,19).replace('T',' '))await update('notifications',n.id,{email_status:'Queued'})});
  const pending=await read(async()=>{const employees=await rows('employees');return (await rows('notifications')).filter(n=>n.email_status==='Queued'&&employees.some(e=>e.id===n.employee_id&&e.active)).sort((a,b)=>a.id-b.id).slice(0,50).map(n=>({...n,email:employees.find(e=>e.id===n.employee_id).email}))});
  let sent = 0;
  for (const n of pending) {
    if (sent >= maxMessages || Date.now() - started >= maxDurationMs) break;
    const claim=await transaction(async()=>{const current=await get('notifications',n.id),employee=await get('employees',n.employee_id);if(current?.email_status!=='Queued'||!employee?.active)return false;await update('notifications',n.id,{email_status:'Sending',attempts:(current.attempts||0)+1,last_attempt:timestamp()});return true});
    if(!claim)continue;
    let timer;
    try {
      const remaining = Math.min(10000, maxDurationMs - (Date.now() - started));
      if (remaining <= 0) throw new Error('Delivery time budget reached.');
      await Promise.race([smtp.sendMail({
        from: process.env.SMTP_FROM,
        to: n.email,
        subject: n.subject,
        text: n.body
      }), new Promise((_, reject) => {
        timer = setTimeout(() => { smtp.close(); reject(new Error('Delivery timed out.')); }, remaining);
      })]);
      await update('notifications',n.id,{email_status:'Sent'});
      sent++;
    } catch {
      await update('notifications',n.id,{email_status:'Queued'});
    } finally { clearTimeout(timer); }
  }
  smtp.close();
  return {
    sent,
    pending: pending.length > sent
  };
}
