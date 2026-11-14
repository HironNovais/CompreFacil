import express from 'express';

export function createApp({ store, broker }) {
  const app = express();
  app.disable('x-powered-by');
  app.get('/health', (_req, res) => {
    let storage = false;
    try { storage = store.healthy(); } catch { /* O status HTTP indica a falha. */ }
    const ok = broker.ready && storage;
    res.status(ok ? 200 : 503).json({ status: ok ? 'ok' : 'degraded', service: 'notification-service', rabbitmq: broker.ready, storage });
  });
  app.get('/notifications', (req, res) => {
    const { paymentId } = req.query;
    if (paymentId !== undefined && (typeof paymentId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(paymentId))) {
      return res.status(400).json({ error: 'paymentId inválido' });
    }
    res.json({ data: store.list(paymentId) });
  });
  app.use((_req, res) => res.status(404).json({ error: 'Rota não encontrada' }));
  app.use((_error, _req, res, _next) => res.status(503).json({ error: 'Armazenamento temporariamente indisponível' }));
  return app;
}
