export function integer(value, fallback, min = 0, max = 60000) {
  const result = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(result) || result < min || result > max) throw new Error('Configuração numérica inválida');
  return result;
}

export function config(env = process.env) {
  return {
    port: integer(env.PORT, 3000, 1, 65535),
    processingDelay: integer(env.PROCESSING_DELAY_MS, 1500),
    database: { host: env.PGHOST || 'localhost', port: integer(env.PGPORT, 5432, 1, 65535),
      user: env.PGUSER || 'compre_facil', password: env.PGPASSWORD || 'local_academic_password',
      database: env.PGDATABASE || 'payments', connectionTimeoutMillis: 3000, query_timeout: 10000, max: 10 },
  };
}
