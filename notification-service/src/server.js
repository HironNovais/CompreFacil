import { createApp } from './app.js';
import { Broker, NOTIFICATION_QUEUE } from './messaging/broker.js';
import { notificationHandler } from './services/notify.js';
import { NotificationStore } from './services/notification-store.js';
import { log } from './logger.js';

const port = Number(process.env.PORT || 3001);
if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error('PORT inválida');
const store = new NotificationStore(process.env.NOTIFICATION_DB || './data/notifications.db');
const broker = new Broker({ queue: NOTIFICATION_QUEUE, handler: notificationHandler(store, log), log });
const controller = new AbortController();
const server = createApp({ store, broker }).listen(port, () => log('info', 'http_listening', { port }));
const task = broker.run(controller.signal);
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  controller.abort();
  const deadline = setTimeout(() => process.exit(1), 12000).unref();
  await new Promise(resolve => server.close(resolve));
  await broker.close();
  await task;
  store.close();
  clearTimeout(deadline);
  log('info', 'shutdown');
}
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
