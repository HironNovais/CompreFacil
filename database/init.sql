CREATE TABLE IF NOT EXISTS payments (
  id UUID PRIMARY KEY,
  customer_name VARCHAR(120) NOT NULL,
  customer_email VARCHAR(254) NOT NULL,
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  currency CHAR(3) NOT NULL CHECK (currency = 'BRL'),
  status VARCHAR(8) NOT NULL CHECK (status IN ('PENDENTE', 'SUCESSO')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS payments_created_idx ON payments(created_at DESC, id DESC);

-- A alteração de estado e o evento são confirmados na MESMA transação SQL.
CREATE TABLE IF NOT EXISTS outbox (
  sequence BIGSERIAL PRIMARY KEY,
  event_id UUID NOT NULL UNIQUE,
  payment_id UUID NOT NULL REFERENCES payments(id),
  event_type VARCHAR(32) NOT NULL CHECK (event_type IN ('SOLICITACAO_RECEBIDA', 'PAGAMENTO_CONFIRMADO')),
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  published_at TIMESTAMPTZ,
  UNIQUE(payment_id, event_type)
);
CREATE INDEX IF NOT EXISTS outbox_pending_idx ON outbox(sequence) WHERE published_at IS NULL;
