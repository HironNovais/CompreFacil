import amqp from 'amqplib';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

export const EXCHANGE = 'payments.events';
export const PROCESSING_QUEUE = 'payments.processing';
export const NOTIFICATION_QUEUE = 'payments.notifications';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export class InvalidEvent extends Error {}
export function parseEvent(content) {
  let event;
  try { event = JSON.parse(content.toString()); } catch { throw new InvalidEvent('Evento não contém JSON válido'); }
  const statuses = { SOLICITACAO_RECEBIDA: 'PENDENTE', PAGAMENTO_CONFIRMADO: 'SUCESSO' };
  if (!event || !Object.hasOwn(statuses, event.eventType) || event.status !== statuses[event.eventType] ||
      typeof event.eventId !== 'string' || !UUID.test(event.eventId) ||
      typeof event.paymentId !== 'string' || !UUID.test(event.paymentId) ||
      typeof event.occurredAt !== 'string' || !Number.isFinite(Date.parse(event.occurredAt))) {
    throw new InvalidEvent('Contrato de evento inválido');
  }
  return event;
}

export async function topology(channel) {
  await channel.assertExchange(EXCHANGE, 'topic', { durable: true });
  for (const queue of [PROCESSING_QUEUE, NOTIFICATION_QUEUE]) {
    await channel.assertQueue(queue, { durable: true });
    await channel.assertQueue(queue + '.dead', { durable: true });
    await channel.bindQueue(queue, EXCHANGE, 'SOLICITACAO_RECEBIDA');
  }
  await channel.bindQueue(NOTIFICATION_QUEUE, EXCHANGE, 'PAGAMENTO_CONFIRMADO');
}

export class Broker {
  constructor({ queue, handler, log, env = process.env }) {
    this.queue = queue;
    this.handler = handler;
    this.log = log;
    this.ready = false;
    this.connection = null;
    this.options = { protocol: 'amqp', hostname: env.AMQP_HOST || 'localhost',
      port: Number(env.AMQP_PORT || 5672), username: env.AMQP_USER || 'compre_facil',
      password: env.AMQP_PASSWORD || 'local_academic_password', heartbeat: 5 };
    this.pending = new Map();
  }

  async run(signal) {
    while (!signal.aborted) {
      let connection;
      try {
        connection = await amqp.connect(this.options, { timeout: 3000 });
        this.connection = connection;
        const closed = new Promise(resolve => connection.once('close', () => { this.ready = false; resolve(); }));
        connection.on('error', error => this.log('error', 'amqp_error', { error: error.message }));
        connection.on('blocked', reason => { this.ready = false; this.log('warn', 'amqp_blocked', { reason }); });
        connection.on('unblocked', () => { this.ready = true; });
        const publisher = await connection.createConfirmChannel();
        const consumer = await connection.createChannel();
        for (const channel of [publisher, consumer]) {
          channel.on('error', error => this.log('error', 'channel_error', { error: error.message }));
          channel.on('close', () => { this.ready = false; connection.close().catch(() => {}); });
        }
        this.publisher = publisher;
        publisher.on('return', message => {
          this.pending.get(message.properties.correlationId)?.(new Error('Mensagem sem fila de destino'));
        });
        await topology(consumer);
        await consumer.prefetch(1);
        await consumer.consume(this.queue, message => {
          if (!message) { connection.close().catch(() => {}); return; }
          this.consume(consumer, message).catch(error => {
            this.log('error', 'consumer_channel_lost', { error: error.message });
            connection.close().catch(() => {});
          });
        }, { noAck: false });
        this.ready = true;
        this.log('info', 'amqp_ready', { queue: this.queue });
        if (signal.aborted) await connection.close();
        await closed;
      } catch (error) {
        this.log('error', 'amqp_reconnect', { error: error.message });
      } finally {
        this.ready = false;
        await connection?.close().catch(() => {});
        this.connection = null;
      }
      if (!signal.aborted) await delay(1000);
    }
  }

  async consume(channel, message) {
    try {
      const event = parseEvent(message.content);
      await this.handler(event);
      channel.ack(message);
    } catch (error) {
      const attempts = Number(message.properties.headers?.['x-retry-count'] || 0);
      const dead = error instanceof InvalidEvent || !Number.isSafeInteger(attempts) || attempts >= 3;
      this.log('error', dead ? 'message_dead_lettered' : 'message_retry', {
        error: error.message, eventId: message.properties.messageId, attempt: attempts + 1, queue: this.queue,
      });
      try {
        if (!dead) await delay(500);
        await this.send('', this.queue + (dead ? '.dead' : ''), message.content, {
          ...message.properties, headers: { ...message.properties.headers, 'x-retry-count': attempts + 1,
            'x-error': error.message.slice(0, 250) },
        });
        // Confirma o original somente depois do publisher confirm da cópia.
        channel.ack(message);
      } catch (publishError) {
        channel.nack(message, false, true);
        throw publishError; // Fecha a conexão e reconecta; evita loop apertado.
      }
    }
  }

  publish(event) {
    return this.send(EXCHANGE, event.eventType, Buffer.from(JSON.stringify(event)), {
      messageId: event.eventId, type: event.eventType, contentType: 'application/json',
    });
  }

  send(exchange, routingKey, content, properties = {}) {
    if (!this.publisher) return Promise.reject(new Error('RabbitMQ não conectado'));
    const correlationId = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => finish(new Error('Timeout aguardando publisher confirm')), 5000);
      const finish = error => {
        clearTimeout(timer);
        this.pending.delete(correlationId);
        error ? reject(error) : resolve();
      };
      this.pending.set(correlationId, finish);
      try {
        this.publisher.publish(exchange, routingKey, content,
          { ...properties, persistent: true, mandatory: true, correlationId }, finish);
      } catch (error) { finish(error); }
    });
  }

  async close() { this.ready = false; await this.connection?.close().catch(() => {}); }
}
