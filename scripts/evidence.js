import { mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { paymentUrl, notificationUrl, pool, healthy, createPayment, succeeded, notified, json, compose } from '../tests/helpers.js';

await healthy(paymentUrl); await healthy(notificationUrl);
const payment = await createPayment();
const final = await succeeded(payment.id);
const notifications = await notified(payment.id);
const db = pool();
try {
  const { rows } = await db.query('SELECT event_id,event_type,payload,published_at FROM outbox WHERE payment_id=$1 ORDER BY sequence', [payment.id]);
  const evidence = {
    capturedAt: new Date().toISOString(), timezone: 'America/Sao_Paulo',
    environment: { host: process.platform, hostNode: process.version,
      containerNode: compose('exec', '-T', 'payment-service', 'node', '--version').trim(),
      postgres: compose('exec', '-T', 'postgres', 'postgres', '--version').trim(),
      rabbitmq: compose('exec', '-T', 'rabbitmq', 'rabbitmqctl', 'version').trim(),
      compose: execFileSync('docker', ['compose', 'version'], { encoding: 'utf8' }).trim() },
    health: { payment: (await json(`${paymentUrl}/health`)).body, notification: (await json(`${notificationUrl}/health`)).body },
    accepted: payment, final, outbox: rows, notifications,
  };
  mkdirSync('docs/evidencias', { recursive: true });
  writeFileSync('docs/evidencias/fluxo-real.json', JSON.stringify(evidence, null, 2) + '\n');
  const logs = compose('logs', '--no-color', '--tail', '100', 'payment-service', 'notification-service');
  writeFileSync('docs/evidencias/fluxo-real.log.txt', logs.split('\n').filter(line => line.includes(payment.id)).join('\n') + '\n');
  console.log(`Evidência real registrada: ${payment.id}; ${notifications.length} notificações`);
} finally { await db.end(); }
