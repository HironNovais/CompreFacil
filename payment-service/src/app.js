import express from 'express';
import { pagination, validatePayment, uuidPattern, ValidationError } from './services/validation.js';
import { log } from './logger.js';

export function createApp({ repository, health }) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '16kb' }));
  app.get('/health', async (_req, res) => {
    const state = await health();
    res.status(state.status === 'ok' ? 200 : 503).json(state);
  });
  app.post('/payments', async (req, res) => {
    const payment = await repository.create(validatePayment(req.body));
    log('info', 'payment_received', { paymentId: payment.id, status: payment.status });
    res.status(202).location(`/payments/${payment.id}`).json({ ...payment, message: 'Pagamento recebido para processamento' });
  });
  app.get('/payments', async (req, res) => {
    const params = pagination(req.query);
    res.json({ data: await repository.list(params), page: params.page, limit: params.limit });
  });
  app.get('/payments/:id', async (req, res) => {
    if (!uuidPattern.test(req.params.id)) throw new ValidationError('id deve ser um UUID válido');
    const payment = await repository.find(req.params.id);
    if (!payment) return res.status(404).json({ error: 'Pagamento não encontrado' });
    res.json(payment);
  });
  app.use((_req, res) => res.status(404).json({ error: 'Rota não encontrada' }));
  app.use((error, _req, res, _next) => {
    if (error instanceof ValidationError || error.type === 'entity.parse.failed') {
      return res.status(400).json({ error: error instanceof ValidationError ? error.message : 'JSON inválido' });
    }
    if (error.type === 'entity.too.large') return res.status(413).json({ error: 'JSON excede 16 KB' });
    log('error', 'http_error', { error: error.message });
    res.status(503).json({ error: 'Serviço temporariamente indisponível; consulte o estado antes de reenviar' });
  });
  return app;
}
