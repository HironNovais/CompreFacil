import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { NotificationStore } from '../src/services/notification-store.js';
import { notificationHandler } from '../src/services/notify.js';
import { parseEvent, Broker, InvalidEvent } from '../src/messaging/broker.js';
import { createApp } from '../src/app.js';

function event(type = 'SOLICITACAO_RECEBIDA') {
  return { eventId: randomUUID(), paymentId: randomUUID(), eventType: type,
    status: type === 'SOLICITACAO_RECEBIDA' ? 'PENDENTE' : 'SUCESSO', occurredAt: new Date().toISOString() };
}
test('Dois tipos geram mensagens distintas e duplicata não gera nova notificação', async () => {
  const store = new NotificationStore(':memory:');
  const logs = [];
  try {
    const handler = notificationHandler(store, (...args) => logs.push(args));
    const received = event();
    const confirmed = { ...event('PAGAMENTO_CONFIRMADO'), paymentId: received.paymentId };
    await handler(received); await handler(confirmed); await handler(received);
    const data = store.list(received.paymentId);
    assert.equal(data.length, 2);
    assert.ok(data[0].message.includes('Solicitação de pagamento recebida'));
    assert.ok(data[1].message.includes('Pagamento confirmado com sucesso'));
    assert.equal(logs.filter(row => row[1] === 'notification_recorded').length, 2);
    assert.equal(logs.at(-1)[1], 'duplicate_ignored');
  } finally { store.close(); }
});
test('Idempotência sobrevive ao fechamento e reabertura do SQLite em disco', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'compre-facil-'));
  const filename = join(dir, 'notifications.db');
  const input = event();
  let store = new NotificationStore(filename);
  try {
    await notificationHandler(store, () => {})(input);
    store.close(); store = new NotificationStore(filename);
    await notificationHandler(store, () => {})(input);
    assert.equal(store.list(input.paymentId).length, 1);
  } finally { store.close(); rmSync(dir, { recursive: true }); }
});
test('Contrato rejeita JSON inválido, evento desconhecido e status incompatível', () => {
  for (const input of ['{', JSON.stringify({ ...event(), eventType: 'INVALIDO' }),
    JSON.stringify({ ...event(), status: 'SUCESSO' }), JSON.stringify({ ...event(), eventId: 'x' })]) {
    assert.throws(() => parseEvent(Buffer.from(input)), InvalidEvent);
  }
  assert.equal(parseEvent(Buffer.from(JSON.stringify(event()))).status, 'PENDENTE');
});
test('Consumidor confirma somente após handler concluir', async () => {
  const actions = [];
  const broker = new Broker({ queue: 'test', handler: async () => actions.push('processado'), log() {} });
  await broker.consume({ ack: () => actions.push('ack') }, { content: Buffer.from(JSON.stringify(event())), properties: {} });
  assert.deepEqual(actions, ['processado', 'ack']);
});
test('Mensagem inválida é transferida à DLQ com confirmação antes do ack', async () => {
  const actions = [];
  const broker = new Broker({ queue: 'test', handler: async () => assert.fail('Não deveria consumir'), log() {} });
  broker.send = async (_exchange, queue) => actions.push(queue);
  await broker.consume({ ack: () => actions.push('ack') }, { content: Buffer.from('{'), properties: {} });
  assert.deepEqual(actions, ['test.dead', 'ack']);
});
test('Falha transitória republica com contador; após três retries envia à DLQ', async () => {
  const sent = [];
  const broker = new Broker({ queue: 'test', handler: async () => { throw new Error('falha'); }, log() {} });
  broker.send = async (_exchange, queue, _content, properties) => sent.push({ queue, properties });
  const message = { content: Buffer.from(JSON.stringify(event())), properties: {} };
  await broker.consume({ ack() {} }, message);
  assert.equal(sent[0].queue, 'test');
  assert.equal(sent[0].properties.headers['x-retry-count'], 1);
  await broker.consume({ ack() {} }, { ...message, properties: { headers: { 'x-retry-count': 3 } } });
  assert.equal(sent[1].queue, 'test.dead');
});
test('Falha ao transferir mensagem faz nack com requeue e propaga para reconexão', async () => {
  const broker = new Broker({ queue: 'test', handler: async () => {}, log() {} });
  broker.send = async () => { throw new Error('sem broker'); };
  const calls = [];
  const message = { content: Buffer.from('{'), properties: {} };
  await assert.rejects(broker.consume({ nack: (...args) => calls.push(args), ack: () => assert.fail() }, message));
  assert.deepEqual(calls, [[message, false, true]]);
});
test('Health degradado retorna 503 e não depende de Pagamento/PostgreSQL', async () => {
  const store = new NotificationStore(':memory:');
  try {
    const broker = { ready: false };
    const app = createApp({ store, broker });
    assert.equal((await request(app).get('/health')).status, 503);
    broker.ready = true;
    assert.equal((await request(app).get('/health')).status, 200);
    assert.deepEqual((await request(app).get('/notifications')).body.data, []);
  } finally { store.close(); }
});
