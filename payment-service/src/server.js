import pg from 'pg';
import { config } from './config/index.js';
import { log } from './logger.js';
import { createApp } from './app.js';
import { paymentRepository } from './repositories/payments.js';
import { Broker, PROCESSING_QUEUE } from './messaging/broker.js';
import { paymentHandler } from './workers/process-payment.js';
import { runOutbox } from './workers/outbox.js';

const settings = config();
const pool = new pg.Pool(settings.database);
pool.on('error', error => log('error', 'database_pool_error', { error: error.message }));
const repository = paymentRepository(pool);
const broker = new Broker({ queue: PROCESSING_QUEUE, handler: paymentHandler(repository, settings.processingDelay), log });
const controller = new AbortController();
const app = createApp({ repository, health: async () => {
  let database = false;
  try { await pool.query('SELECT 1'); database = true; } catch { /* Degradação reportada em JSON. */ }
  return { status: database && broker.ready ? 'ok' : 'degraded', service: 'payment-service', database, rabbitmq: broker.ready };
} });
const server = app.listen(settings.port, () => log('info', 'http_listening', { port: settings.port }));
const tasks = [broker.run(controller.signal), runOutbox(pool, broker, controller.signal)];
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  controller.abort();
  const deadline = setTimeout(() => process.exit(1), 12000).unref();
  await new Promise(resolve => server.close(resolve));
  await broker.close();
  await Promise.allSettled(tasks);
  await pool.end();
  clearTimeout(deadline);
  log('info', 'shutdown');
}
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
