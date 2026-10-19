import { deliverNotifications } from '../../lib/notifications.js';
export default async function () {
  const result = await deliverNotifications({ maxMessages: 10, maxDurationMs: 18000 });
  console.log('Notification delivery:', result.sent, 'sent; pending:', result.pending);
}
export const config = { schedule: '*/5 * * * *' };
