import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { loadEnvFile } from 'node:process';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
try { loadEnvFile('.env'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
const require = createRequire(new URL('../payment-service/package.json', import.meta.url));
export const pg = require('pg');
export const amqp = require('amqplib');
export const paymentUrl = `http://127.0.0.1:${process.env.PAYMENT_PORT || 3000}`;
export const notificationUrl = `http://127.0.0.1:${process.env.NOTIFICATION_PORT || 3001}`;
export const managementUrl = `http://127.0.0.1:${process.env.RABBITMQ_UI_PORT || 15672}`;
export function pool() {
  return new pg.Pool({ host: '127.0.0.1', port: Number(process.env.POSTGRES_PORT || 55432),
    user: process.env.POSTGRES_USER || 'compre_facil', password: process.env.POSTGRES_PASSWORD || 'local_academic_password',
    database: process.env.POSTGRES_DB || 'payments', connectionTimeoutMillis: 3000 });
}
export async function connectAmqp() {
  return amqp.connect({ hostname: '127.0.0.1', port: Number(process.env.AMQP_PORT || 5672),
    username: process.env.RABBITMQ_USER || 'compre_facil', password: process.env.RABBITMQ_PASSWORD || 'local_academic_password' });
}
export function compose(...args) {
  return execFileSync('docker', ['compose', ...args], { encoding: 'utf8', timeout: 90000, stdio: ['ignore', 'pipe', 'pipe'] });
}
export async function json(url, options = {}) {
  const response = await fetch(url, { signal: AbortSignal.timeout(5000), ...options });
  return { status: response.status, body: await response.json() };
}
export async function eventually(check, timeout = 30000) {
  const end = Date.now() + timeout;
  let lastError;
  do {
    try { const result = await check(); if (result) return result; }
    catch (error) { lastError = error; }
    await delay(200);
  } while (Date.now() < end);
  throw new Error(`Condição não atendida em ${timeout}ms`, { cause: lastError });
}
export async function healthy(base) { return eventually(async () => (await json(`${base}/health`)).status === 200, 60000); }
export async function createPayment() {
  const result = await json(`${paymentUrl}/payments`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ customerName: `Teste ${randomUUID()}`, customerEmail: 'teste@exemplo.com', amount: 150.29, currency: 'BRL' }) });
  if (result.status !== 202) throw new Error(`Criação retornou ${result.status}: ${JSON.stringify(result.body)}`);
  return result.body;
}
export async function succeeded(id) {
  return eventually(async () => {
    const { body } = await json(`${paymentUrl}/payments/${id}`);
    return body.status === 'SUCESSO' && body;
  });
}
export async function notified(id) {
  return eventually(async () => {
    const { body } = await json(`${notificationUrl}/notifications?paymentId=${id}`);
    return body.data?.length === 2 && body.data;
  });
}
export async function queueInfo(queue) {
  const username = process.env.RABBITMQ_USER || 'compre_facil';
  const password = process.env.RABBITMQ_PASSWORD || 'local_academic_password';
  return json(`${managementUrl}/api/queues/%2F/${queue}`, { headers: {
    Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`,
  } });
}
export async function publish(channel, exchange, key, event, headers = {}) {
  const content = Buffer.isBuffer(event) ? event : Buffer.from(JSON.stringify(event));
  await new Promise((resolve, reject) => channel.publish(exchange, key, content,
    { persistent: true, messageId: event.eventId, headers }, error => error ? reject(error) : resolve()));
}
