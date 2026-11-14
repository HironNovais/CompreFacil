// Usa SOMENTE os serviços do Compose deste diretório. Execute fora de uma apresentação.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { paymentUrl, notificationUrl, pool, healthy, createPayment, succeeded, notified, compose,
  json, connectAmqp, publish, eventually } from './helpers.js';
let db;
before(async () => {
  await healthy(paymentUrl); await healthy(notificationUrl); db = pool();
  // O teste derruba o banco de propósito; clientes ociosos também recebem 57P01.
  db.on('error', error => {
    if (!['57P01', 'ECONNRESET'].includes(error.code)) throw error;
    console.log(JSON.stringify({ evidence: 'expected_database_disconnect', code: error.code }));
  });
});
after(async () => { compose('start', 'postgres', 'rabbitmq', 'payment-service', 'notification-service'); await db?.end(); });

test('Notificação parada: pagamento conclui, duas mensagens ficam na fila e são consumidas ao voltar', async () => {
  compose('stop', 'notification-service');
  try {
    const payment = await createPayment(); await succeeded(payment.id);
    const connection = await connectAmqp();
    try {
      const channel = await connection.createChannel();
      const info = await eventually(async () => {
        const result = await channel.checkQueue('payments.notifications');
        return result.messageCount >= 2 && result;
      });
      assert.equal(info.consumerCount, 0);
      console.log(JSON.stringify({ evidence: 'notification_offline', paymentId: payment.id, queued: info.messageCount }));
    } finally { await connection.close(); }
    compose('start', 'notification-service'); await healthy(notificationUrl);
    assert.equal((await notified(payment.id)).length, 2);
  } finally { compose('start', 'notification-service'); }
});
test('Reinício de Notificação mantém deduplicação persistente', async () => {
  const payment = await createPayment(); await succeeded(payment.id); await notified(payment.id);
  const { rows } = await db.query('SELECT payload FROM outbox WHERE payment_id=$1 ORDER BY sequence', [payment.id]);
  compose('restart', 'notification-service'); await healthy(notificationUrl);
  const connection = await connectAmqp();
  try {
    const channel = await connection.createConfirmChannel();
    for (const row of rows) await publish(channel, '', 'payments.notifications', row.payload);
    await eventually(async () => (await channel.checkQueue('payments.notifications')).messageCount === 0);
    await delay(500);
    assert.equal((await json(`${notificationUrl}/notifications?paymentId=${payment.id}`)).body.data.length, 2);
  } finally { await connection.close(); }
});
test('RabbitMQ parado: API aceita em outbox e recupera publicação após reconectar', async () => {
  compose('stop', 'rabbitmq');
  let payment;
  try {
    await eventually(async () => (await json(`${paymentUrl}/health`)).status === 503);
    payment = await createPayment();
    const { rows } = await db.query('SELECT p.status,o.published_at FROM payments p JOIN outbox o ON o.payment_id=p.id WHERE p.id=$1', [payment.id]);
    assert.equal(rows[0].status, 'PENDENTE'); assert.equal(rows[0].published_at, null);
    compose('start', 'rabbitmq'); await healthy(paymentUrl); await healthy(notificationUrl);
    await succeeded(payment.id); await notified(payment.id);
    console.log(JSON.stringify({ evidence: 'outbox_recovery', paymentId: payment.id }));
  } finally { compose('start', 'rabbitmq'); }
});
test('Processo de Pagamento morto durante trabalho recupera tarefa não confirmada', async () => {
  const payment = await createPayment();
  await eventually(async () => (await db.query("SELECT published_at FROM outbox WHERE payment_id=$1 AND event_type='SOLICITACAO_RECEBIDA'", [payment.id])).rows[0].published_at !== null);
  compose('kill', '-s', 'SIGKILL', 'payment-service');
  try {
    assert.equal((await db.query('SELECT status FROM payments WHERE id=$1', [payment.id])).rows[0].status, 'PENDENTE');
    compose('start', 'payment-service'); await healthy(paymentUrl);
    await succeeded(payment.id); await notified(payment.id);
    assert.equal((await db.query("SELECT count(*) FROM outbox WHERE payment_id=$1 AND event_type='PAGAMENTO_CONFIRMADO'", [payment.id])).rows[0].count, '1');
  } finally { compose('start', 'payment-service'); }
});
test('Pagamento parado: Notificação continua saudável e consumindo AMQP', async () => {
  const payment = await createPayment(); await succeeded(payment.id); await notified(payment.id);
  const event = (await db.query('SELECT payload FROM outbox WHERE payment_id=$1 ORDER BY sequence LIMIT 1', [payment.id])).rows[0].payload;
  compose('stop', 'payment-service');
  try {
    assert.equal((await json(`${notificationUrl}/health`)).status, 200);
    const connection = await connectAmqp();
    try {
      const channel = await connection.createConfirmChannel();
      const independentEvent = { ...event, eventId: randomUUID(), paymentId: randomUUID() };
      await publish(channel, '', 'payments.notifications', independentEvent);
      await eventually(async () => (await json(`${notificationUrl}/notifications?paymentId=${independentEvent.paymentId}`)).body.data.length === 1);
    } finally { await connection.close(); }
  } finally { compose('start', 'payment-service'); await healthy(paymentUrl); }
});
test('PostgreSQL parado: API retorna 503, Notificação permanece disponível e banco recupera', async () => {
  compose('stop', 'postgres');
  try {
    await eventually(async () => (await json(`${paymentUrl}/health`)).status === 503);
    const response = await json(`${paymentUrl}/payments`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ customerName: 'Falha banco', customerEmail: 'teste@exemplo.com', amount: 10, currency: 'BRL' }) });
    assert.equal(response.status, 503);
    assert.equal((await json(`${notificationUrl}/health`)).status, 200);
  } finally { compose('start', 'postgres'); await healthy(paymentUrl); }
});
test('Recriar contêineres mantém PostgreSQL, filas e deduplicação nos volumes', async () => {
  const payment = await createPayment(); await succeeded(payment.id); await notified(payment.id);
  compose('up', '-d', '--force-recreate', 'payment-service', 'notification-service');
  await healthy(paymentUrl); await healthy(notificationUrl);
  assert.equal((await json(`${paymentUrl}/payments/${payment.id}`)).body.status, 'SUCESSO');
  assert.equal((await notified(payment.id)).length, 2);
});

test('RabbitMQ reiniciado preserva mensagens duráveis enquanto Notificação está parada', async () => {
  compose('stop', 'notification-service');
  try {
    const payment = await createPayment(); await succeeded(payment.id);
    let connection = await connectAmqp();
    try {
      const channel = await connection.createChannel();
      await eventually(async () => (await channel.checkQueue('payments.notifications')).messageCount >= 2);
    } finally { await connection.close(); }
    compose('restart', 'rabbitmq'); await healthy(paymentUrl);
    connection = await connectAmqp();
    try {
      const channel = await connection.createChannel();
      assert.ok((await channel.checkQueue('payments.notifications')).messageCount >= 2);
    } finally { await connection.close(); }
    compose('start', 'notification-service'); await healthy(notificationUrl);
    assert.equal((await notified(payment.id)).length, 2);
  } finally { compose('start', 'rabbitmq', 'notification-service'); }
});
