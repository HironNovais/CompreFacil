import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { createApp } from '../src/app.js';
import { validatePayment } from '../src/services/validation.js';
import { transaction } from '../src/repositories/payments.js';
import { publishNext } from '../src/workers/outbox.js';

const valid = { customerName: 'Cliente Teste', customerEmail: 'cliente@exemplo.com', amount: 150, currency: 'BRL' };
function app(repository = {}) {
  return createApp({ repository, health: async () => ({ status: 'ok' }) });
}
test('POST retorna 202 PENDENTE depois de persistir e sem depender de broker/notificação', async () => {
  const id = randomUUID();
  let persisted = false;
  const response = await request(app({ create: async input => {
    assert.equal(input.amount, '150.00'); persisted = true; return { id, status: 'PENDENTE' };
  } })).post('/payments').send(valid);
  assert.equal(persisted, true);
  assert.equal(response.status, 202);
  assert.equal(response.body.status, 'PENDENTE');
  assert.equal(response.body.id, id);
  assert.equal(response.headers.location, `/payments/${id}`);
});
for (const [name, body] of Object.entries({
  vazio: {}, semNome: { ...valid, customerName: ' ' }, semEmail: { ...valid, customerEmail: 'invalido' },
  zero: { ...valid, amount: 0 }, negativo: { ...valid, amount: -1 }, string: { ...valid, amount: '150' },
  fracao: { ...valid, amount: 1.001 }, muitoAlto: { ...valid, amount: 10000000000 },
  subCentavo: { ...valid, amount: 0.00000001 }, fracaoProxima: { ...valid, amount: 1.00000000001 },
  moeda: { ...valid, currency: 'USD' }, lista: [], nulo: null,
})) {
  test(`Rejeita entrada inválida: ${name}`, async () => {
    let called = false;
    const response = await request(app({ create: async () => { called = true; } })).post('/payments').send(body);
    assert.equal(response.status, 400);
    assert.equal(called, false);
  });
}
test('Centavos e acentos são preservados; NaN e Infinity são rejeitados', () => {
  assert.equal(validatePayment({ ...valid, amount: 0.29, customerName: 'João' }).amount, '0.29');
  assert.throws(() => validatePayment({ ...valid, amount: NaN }));
  assert.throws(() => validatePayment({ ...valid, amount: Infinity }));
});
test('GET inexistente retorna 404; id malformado retorna 400', async () => {
  const api = app({ find: async () => undefined });
  assert.equal((await request(api).get(`/payments/${randomUUID()}`)).status, 404);
  assert.equal((await request(api).get('/payments/invalido')).status, 400);
});
test('Paginação valida limite e encaminha offset correto ao repositório', async () => {
  const api = app({ list: async params => { assert.equal(params.offset, 10); return []; } });
  assert.equal((await request(api).get('/payments?page=2&limit=10')).status, 200);
  for (const query of ['page=0', 'limit=101', 'page=abc', 'limit=1&limit=2', 'page=1000001']) {
    assert.equal((await request(api).get(`/payments?${query}`)).status, 400);
  }
});
test('JSON malformado retorna 400', async () => {
  assert.equal((await request(app()).post('/payments').set('Content-Type', 'application/json').send('{')).status, 400);
});
test('Falha do banco retorna 503 sem detalhes SQL na resposta', async () => {
  const result = await request(app({ create: async () => { throw new Error('SQL interno'); } })).post('/payments').send(valid);
  assert.equal(result.status, 503);
  assert.equal(JSON.stringify(result.body).includes('SQL interno'), false);
});
test('Transação falha executa rollback e libera conexão', async () => {
  const queries = [];
  const client = { query: async q => queries.push(q), release: () => queries.push('release') };
  await assert.rejects(transaction({ connect: async () => client }, async () => { throw new Error('falha'); }));
  assert.deepEqual(queries, ['BEGIN', 'ROLLBACK', 'release']);
});
test('Outbox não marca publicado quando publisher confirm falha', async () => {
  const queries = [];
  const payload = { eventId: randomUUID(), eventType: 'SOLICITACAO_RECEBIDA' };
  const client = { release() {}, query: async sql => {
    queries.push(sql);
    if (sql.includes('pg_try')) return { rows: [{ acquired: true }] };
    if (sql.includes('SELECT sequence')) return { rows: [{ sequence: 1, payload }] };
    return { rows: [] };
  } };
  await assert.rejects(publishNext({ connect: async () => client }, {
    ready: true, publish: async () => { throw new Error('broker indisponível'); },
  }));
  assert.ok(queries.includes('ROLLBACK'));
  assert.equal(queries.some(q => q.startsWith('UPDATE outbox')), false);
});
