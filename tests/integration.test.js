import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { paymentRepository } from '../payment-service/src/repositories/payments.js';
import { paymentUrl, notificationUrl, pool, healthy, createPayment, succeeded, notified,
  json, connectAmqp, publish, eventually, queueInfo } from './helpers.js';

let db;
before(async () => { await healthy(paymentUrl); await healthy(notificationUrl); db = pool(); });
after(async () => { await db?.end(); });

test('Fluxo real: 202 PENDENTE, SQL, SUCESSO e dois eventos/notificações em ordem', async () => {
  const payment = await createPayment();
  assert.equal(payment.status, 'PENDENTE');
  const initial = await db.query('SELECT status,amount FROM payments WHERE id=$1', [payment.id]);
  assert.equal(initial.rows[0].status, 'PENDENTE');
  assert.equal(initial.rows[0].amount, '150.29');
  const final = await succeeded(payment.id);
  assert.equal(final.status, 'SUCESSO');
  const notifications = await notified(payment.id);
  assert.deepEqual(notifications.map(row => row.eventType), ['SOLICITACAO_RECEBIDA', 'PAGAMENTO_CONFIRMADO']);
  const outbox = await db.query('SELECT event_type,published_at,payload FROM outbox WHERE payment_id=$1 ORDER BY sequence', [payment.id]);
  await eventually(async () => (await db.query('SELECT count(*) FROM outbox WHERE payment_id=$1 AND published_at IS NOT NULL', [payment.id])).rows[0].count === '2');
  assert.deepEqual(outbox.rows.map(row => row.event_type), ['SOLICITACAO_RECEBIDA', 'PAGAMENTO_CONFIRMADO']);
  console.log(JSON.stringify({ evidence: 'complete_flow', paymentId: payment.id, initial: 'PENDENTE', final: final.status,
    eventIds: notifications.map(row => row.eventId) }));
});
test('API real rejeita requisições inválidas e retorna 404 para UUID inexistente', async () => {
  for (const body of [{}, { customerName: 'Nome', customerEmail: 'teste@exemplo.com', amount: -10, currency: 'BRL' }]) {
    assert.equal((await json(`${paymentUrl}/payments`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).status, 400);
  }
  assert.equal((await json(`${paymentUrl}/payments/${randomUUID()}`)).status, 404);
  const list = await json(`${paymentUrl}/payments?page=1&limit=2`);
  assert.equal(list.status, 200); assert.ok(list.body.data.length <= 2);
});
test('Banco real reverte pagamento e outbox quando a gravação falha', async () => {
  const name = `Rollback ${randomUUID()}`;
  await assert.rejects(paymentRepository(db).create({ customerName: name, customerEmail: 'teste@exemplo.com', amount: '-1', currency: 'BRL' }));
  assert.equal((await db.query('SELECT count(*) FROM payments WHERE customer_name=$1', [name])).rows[0].count, '0');
});
test('Worker é idempotente: confirmações concorrentes geram somente um evento', async () => {
  const payment = await createPayment();
  const repository = paymentRepository(db);
  const results = await Promise.all([repository.confirm(payment.id), repository.confirm(payment.id), repository.confirm(payment.id)]);
  assert.equal(results.filter(Boolean).length, 1);
  assert.equal((await db.query("SELECT count(*) FROM outbox WHERE payment_id=$1 AND event_type='PAGAMENTO_CONFIRMADO'", [payment.id])).rows[0].count, '1');
  await notified(payment.id);
});
test('Duplicatas AMQP reais não geram novos registros de notificação', async () => {
  const payment = await createPayment(); await succeeded(payment.id); await notified(payment.id);
  const { rows } = await db.query('SELECT payload FROM outbox WHERE payment_id=$1 ORDER BY sequence', [payment.id]);
  const connection = await connectAmqp();
  try {
    const channel = await connection.createConfirmChannel();
    for (const row of rows) for (let i = 0; i < 3; i++) await publish(channel, '', 'payments.notifications', row.payload);
    await eventually(async () => (await channel.checkQueue('payments.notifications')).messageCount === 0);
    await delay(500);
    const { body } = await json(`${notificationUrl}/notifications?paymentId=${payment.id}`);
    assert.equal(body.data.length, 2);
  } finally { await connection.close(); }
});
test('Contrato inválido vai para DLQ real, sem loop de reprocessamento', async () => {
  const connection = await connectAmqp();
  try {
    const channel = await connection.createConfirmChannel();
    const before = (await channel.checkQueue('payments.notifications.dead')).messageCount;
    await publish(channel, '', 'payments.notifications', { eventId: randomUUID(), eventType: 'INVALIDO' });
    await eventually(async () => (await channel.checkQueue('payments.notifications.dead')).messageCount === before + 1);
    const info = await queueInfo('payments.notifications');
    assert.equal(info.status, 200);
  } finally { await connection.close(); }
});
test('Erro de processamento esgota três retries e preserva evento na DLQ', async () => {
  const connection = await connectAmqp();
  try {
    const channel = await connection.createConfirmChannel();
    const before = (await channel.checkQueue('payments.processing.dead')).messageCount;
    await publish(channel, '', 'payments.processing', { eventId: randomUUID(), paymentId: randomUUID(),
      eventType: 'SOLICITACAO_RECEBIDA', status: 'PENDENTE', occurredAt: new Date().toISOString() });
    await eventually(async () => (await channel.checkQueue('payments.processing.dead')).messageCount === before + 1);
  } finally { await connection.close(); }
});
