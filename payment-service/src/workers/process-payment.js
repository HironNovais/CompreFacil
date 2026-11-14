import { setTimeout as delay } from 'node:timers/promises';
import { log } from '../logger.js';

export function paymentHandler(repository, processingDelay) {
  return async event => {
    if (event.eventType !== 'SOLICITACAO_RECEBIDA') throw new Error('Worker aceita somente solicitações');
    // Apenas latência simulada: a tarefa real permanece não confirmada na fila durável.
    await delay(processingDelay);
    const changed = await repository.confirm(event.paymentId);
    log('info', changed ? 'payment_confirmed' : 'payment_duplicate_ignored', { paymentId: event.paymentId, eventId: event.eventId });
  };
}
