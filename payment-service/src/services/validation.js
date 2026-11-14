export class ValidationError extends Error {}
export const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function validatePayment(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ValidationError('Envie um objeto JSON');
  const { customerName, customerEmail, amount, currency } = body;
  if (typeof customerName !== 'string' || !customerName.trim() || customerName.trim().length > 120) {
    throw new ValidationError('customerName é obrigatório e deve ter até 120 caracteres');
  }
  if (typeof customerEmail !== 'string' || customerEmail.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail)) {
    throw new ValidationError('customerEmail deve ser um e-mail válido de até 254 caracteres');
  }
  // A forma decimal canônica evita aceitar subcentavos que seriam arredondados a zero.
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0 || amount > 9999999999.99 ||
      !/^\d+(?:\.\d{1,2})?$/.test(String(amount))) {
    throw new ValidationError('amount deve ser número positivo, até 9999999999.99, com no máximo duas casas decimais');
  }
  if (currency !== 'BRL') throw new ValidationError('currency deve ser BRL nesta simulação');
  return { customerName: customerName.trim(), customerEmail, amount: amount.toFixed(2), currency };
}

export function pagination(query) {
  const parse = (value, fallback, max) => {
    if (value === undefined) return fallback;
    if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value) || Number(value) > max) {
      throw new ValidationError('Paginação inválida: page >= 1 e limit entre 1 e 100');
    }
    return Number(value);
  };
  const page = parse(query.page, 1, 1000000);
  const limit = parse(query.limit, 20, 100);
  return { page, limit, offset: (page - 1) * limit };
}
