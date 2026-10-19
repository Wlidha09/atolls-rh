import nodemailer from 'nodemailer';
import { all, run } from './db.js';
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
  await run("UPDATE notifications SET email_status='Queued' WHERE email_status='Sending' AND last_attempt<datetime('now','-10 minutes')");
  const pending = await all("SELECT n.*,e.email FROM notifications n JOIN employees e ON e.id=n.employee_id WHERE n.email_status='Queued' AND e.active=1 ORDER BY n.id LIMIT 50");
  let sent = 0;
  for (const n of pending) {
    if (sent >= maxMessages || Date.now() - started >= maxDurationMs) break;
    const claim = await run("UPDATE notifications SET email_status='Sending',attempts=attempts+1,last_attempt=CURRENT_TIMESTAMP WHERE id=? AND email_status='Queued'", n.id);
    if (!claim.changes) continue;
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
      await run("UPDATE notifications SET email_status='Sent' WHERE id=?", n.id);
      sent++;
    } catch {
      await run("UPDATE notifications SET email_status='Queued' WHERE id=?", n.id);
    } finally { clearTimeout(timer); }
  }
  smtp.close();
  return {
    sent,
    pending: pending.length > sent
  };
}
