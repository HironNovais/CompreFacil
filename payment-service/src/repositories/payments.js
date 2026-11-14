import { randomUUID } from 'node:crypto';

export async function transaction(pool, operation) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await operation(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally { client.release(); }
}

function event(paymentId, eventType, status) {
  return { eventId: randomUUID(), eventType, paymentId, status, occurredAt: new Date().toISOString() };
}

async function storeEvent(client, payload) {
  await client.query('INSERT INTO outbox(event_id,payment_id,event_type,payload) VALUES($1,$2,$3,$4)',
    [payload.eventId, payload.paymentId, payload.eventType, payload]);
}

export function paymentRepository(pool) {
  return {
    async create(input) {
      return transaction(pool, async client => {
        const id = randomUUID();
        await client.query(`INSERT INTO payments(id,customer_name,customer_email,amount,currency,status)
          VALUES($1,$2,$3,$4,$5,'PENDENTE')`, [id, input.customerName, input.customerEmail, input.amount, input.currency]);
        await storeEvent(client, event(id, 'SOLICITACAO_RECEBIDA', 'PENDENTE'));
        return { id, status: 'PENDENTE' };
      });
    },
    async confirm(id) {
      return transaction(pool, async client => {
        const { rows } = await client.query('SELECT status FROM payments WHERE id=$1 FOR UPDATE', [id]);
        if (!rows[0]) throw new Error('Pagamento do evento não encontrado');
        if (rows[0].status === 'SUCESSO') return false;
        await client.query("UPDATE payments SET status='SUCESSO',updated_at=NOW() WHERE id=$1", [id]);
        await storeEvent(client, event(id, 'PAGAMENTO_CONFIRMADO', 'SUCESSO'));
        return true;
      });
    },
    async find(id) {
      const { rows } = await pool.query(`SELECT id, customer_name AS "customerName", customer_email AS "customerEmail",
        amount, currency, status, created_at AS "createdAt", updated_at AS "updatedAt" FROM payments WHERE id=$1`, [id]);
      return rows[0];
    },
    async list({ limit, offset }) {
      const { rows } = await pool.query(`SELECT id, customer_name AS "customerName", customer_email AS "customerEmail",
        amount, currency, status, created_at AS "createdAt", updated_at AS "updatedAt"
        FROM payments ORDER BY created_at DESC,id DESC LIMIT $1 OFFSET $2`, [limit, offset]);
      return rows;
    },
  };
}
