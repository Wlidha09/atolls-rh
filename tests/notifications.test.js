import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import {installTestTransport,initializeSchema,insert,rows,queueNotification} from '../lib/db.js';
import {deliverNotifications} from '../lib/notifications.js';
process.env.NODE_ENV='test';let root=null,version=0;
installTestTransport(async(path,options={})=>{if(options.method==='PUT'){if(options.etag!==String(version))return {conflict:true};root=structuredClone(options.value);version++;return {value:root}}return {value:structuredClone(root),etag:String(version)}});
await initializeSchema();await insert('employees',{id:1,email:'supervisor@atolls.test',name:'Supervisor',role:'RH',active:1});
test('notifications stay queued when SMTP is not configured', async () => {
  delete process.env.SMTP_HOST;
  await queueNotification(1, 'Security alert', 'An inactive login was blocked.');
  const result = await deliverNotifications();
  assert.equal(result.sent, 0);
  assert.equal((await rows('notifications'))[0].email_status, 'Queued');
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
    assert.equal((await rows('notifications'))[0].email_status, 'Sent');
    assert.match(received, /Security alert/);
    assert.match(received, /inactive login/);
    assert.match(received, /supervisor@atolls.test/);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
