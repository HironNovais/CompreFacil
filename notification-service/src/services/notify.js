import { InvalidEvent } from '../messaging/broker.js';

export function notificationHandler(store, log) {
  return async event => {
    let message;
    if (event.eventType === 'SOLICITACAO_RECEBIDA') message = '[NOTIFICACAO] Solicitação de pagamento recebida. Transação: ';
    else if (event.eventType === 'PAGAMENTO_CONFIRMADO') message = '[NOTIFICACAO] Pagamento confirmado com sucesso. Transação: ';
    else throw new InvalidEvent('Tipo de evento desconhecido');
    message += event.paymentId;
    const inserted = store.record(event, message);
    log('info', inserted ? 'notification_recorded' : 'duplicate_ignored', {
      eventId: event.eventId, paymentId: event.paymentId, eventType: event.eventType,
      ...(inserted ? { message } : {}),
    });
  };
}
