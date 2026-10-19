import nodemailer from 'nodemailer';
import { all, run } from './db.js';
export async function deliverNotifications(){
 if(!process.env.SMTP_HOST)return {sent:0,pending:true};
 const smtp=nodemailer.createTransport({host:process.env.SMTP_HOST,port:Number(process.env.SMTP_PORT||587),secure:process.env.SMTP_SECURE==='true',connectionTimeout:15000,greetingTimeout:15000,socketTimeout:60000,disableFileAccess:true,disableUrlAccess:true,...(process.env.SMTP_USER?{auth:{user:process.env.SMTP_USER,pass:process.env.SMTP_PASS}}:{})});
 run("UPDATE notifications SET email_status='Queued' WHERE email_status='Sending' AND last_attempt<datetime('now','-10 minutes')");
 const pending=all("SELECT n.*,e.email FROM notifications n JOIN employees e ON e.id=n.employee_id WHERE n.email_status='Queued' AND e.active=1 ORDER BY n.id LIMIT 50");
 let sent=0;
 for(const n of pending){const claim=run("UPDATE notifications SET email_status='Sending',attempts=attempts+1,last_attempt=CURRENT_TIMESTAMP WHERE id=? AND email_status='Queued'",n.id);if(!claim.changes)continue;
 try {await smtp.sendMail({from:process.env.SMTP_FROM,to:n.email,subject:n.subject,text:n.body});run("UPDATE notifications SET email_status='Sent' WHERE id=?",n.id);sent++;}
 catch {run("UPDATE notifications SET email_status='Queued' WHERE id=?",n.id);}}
 return {sent,pending:pending.length>sent};
}
