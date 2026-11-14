import { transaction } from '../repositories/payments.js';
import { log } from '../logger.js';

export async function publishNext(pool, broker) {
  if (!broker.ready) return false;
  return transaction(pool, async client => {
    // Um publicador por vez preserva a ordem global mesmo com réplicas.
    const lock = await client.query('SELECT pg_try_advisory_xact_lock(27112026) AS acquired');
    if (!lock.rows[0].acquired) return false;
    const { rows } = await client.query('SELECT sequence,payload FROM outbox WHERE published_at IS NULL ORDER BY sequence LIMIT 1 FOR UPDATE');
    if (!rows[0]) return false;
    await broker.publish(rows[0].payload);
    await client.query('UPDATE outbox SET published_at=NOW() WHERE sequence=$1', [rows[0].sequence]);
    log('info', 'event_published', rows[0].payload);
    return true;
  });
}

export async function runOutbox(pool, broker, signal) {
  while (!signal.aborted) {
    let published = false;
    try { published = await publishNext(pool, broker); }
    catch (error) { log('error', 'outbox_retry', { error: error.message }); }
    if (!published) await new Promise(resolve => setTimeout(resolve, 250));
  }
}
