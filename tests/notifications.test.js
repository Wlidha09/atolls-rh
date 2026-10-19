import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const dir = mkdtempSync(join(tmpdir(), 'atolls-mail-'));

const {
  run,
  one,
  queueNotification,
  default: db
} = await import('../lib/db.js');
const {createClient} = await import('@libsql/client/node');
const {installTestClient,initializeSchema} = await import('../lib/db.js');
const {pathToFileURL} = await import('node:url');
process.env.NODE_ENV='test';
installTestClient(createClient({url:pathToFileURL(join(dir,'mail.sqlite')).href}));
await initializeSchema();
const {
  deliverNotifications
} = await import('../lib/notifications.js');
await run("INSERT INTO employees(id,email,name,role) VALUES(1,'supervisor@atolls.test','Supervisor','RH')");
after(() => {
  db.close();
  rmSync(dir, {
    recursive: true,
    force: true
  });
});
test('notifications stay queued when SMTP is not configured', async () => {
  delete process.env.SMTP_HOST;
  await queueNotification(1, 'Security alert', 'An inactive login was blocked.');
  const result = await deliverNotifications();
  assert.equal(result.sent, 0);
  assert.equal((await one('SELECT email_status FROM notifications')).email_status, 'Queued');
});
test('SMTP worker delivers queued security email and records delivery', async () => {
  let received = '';
  const server = createServer(socket => {
    socket.write('220 local-test ESMTP\r\n');
    let buffer = '',
      dataMode = false;
    socket.on('data', chunk => {
      buffer += chunk.toString();
      while (true) {
        if (dataMode) {
          const end = buffer.indexOf('\r\n.\r\n');
          if (end < 0) break;
          received += buffer.slice(0, end);
          buffer = buffer.slice(end + 5);
          dataMode = false;
          socket.write('250 accepted\r\n');
          continue;
        }
        const end = buffer.indexOf('\r\n');
        if (end < 0) break;
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        if (line.startsWith('EHLO')) socket.write('250-local-test\r\n250 SIZE 1000000\r\n');else if (line === 'DATA') {
          dataMode = true;
          socket.write('354 Send data\r\n');
        } else if (line === 'QUIT') {
          socket.end('221 Bye\r\n');
        } else socket.write('250 OK\r\n');
      }
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  process.env.SMTP_HOST = '127.0.0.1';
  process.env.SMTP_PORT = String(server.address().port);
  process.env.SMTP_SECURE = 'false';
  process.env.SMTP_FROM = 'HR <hr@atolls.test>';
  try {
    const result = await deliverNotifications();
    assert.equal(result.sent, 1);
    assert.equal((await one('SELECT email_status FROM notifications')).email_status, 'Sent');
    assert.match(received, /Security alert/);
    assert.match(received, /inactive login/);
    assert.match(received, /supervisor@atolls.test/);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
