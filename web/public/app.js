const $ = (id) => document.getElementById(id);
const money = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});
const date = new Intl.DateTimeFormat("pt-BR", {
  dateStyle: "short",
  timeStyle: "medium",
});
const state = {
  selectedId: null,
  payment: null,
  notifications: [],
  page: 1,
  loading: false,
  submitting: false,
};
let timer;

function formatDate(value) {
  return value && Number.isFinite(Date.parse(value))
    ? date.format(new Date(value))
    : "Instante não disponível";
}

async function request(path, options = {}) {
  const response = await fetch(path, {
    signal: AbortSignal.timeout(8000),
    cache: "no-store",
    ...options,
  });
  let body;
  try {
    body = await response.json();
  } catch {
    body = {};
  }
  if (!response.ok) {
    const error = new Error(
      body.error ||
        (response.status === 429
          ? "Muitas solicitações. Aguarde um minuto antes de criar outro pagamento."
          : "Não foi possível consultar o serviço. Tentaremos atualizar novamente."),
    );
    error.status = response.status;
    error.body = body;
    throw error;
  }
  return body;
}

function feedback(message, error = false) {
  $("form-feedback").textContent = message;
  $("form-feedback").classList.toggle("error", error);
}

function component(name, ready, label) {
  $("health-" + name).textContent = label;
  $("dot-" + name).classList.toggle("up", ready === true);
  $("dot-" + name).classList.toggle("down", ready === false);
}

async function healthResult(path) {
  try {
    return await request(path);
  } catch (error) {
    return error.body?.service ? error.body : null;
  }
}

async function loadHealth() {
  const [payment, notification] = await Promise.all([
    healthResult("/api/payment/health"),
    healthResult("/api/notification/health"),
  ]);
  component(
    "payment",
    payment ? payment.status === "ok" : null,
    payment
      ? payment.status === "ok"
        ? "Operacional · REST"
        : "Serviço degradado"
      : "Sem resposta",
  );
  component(
    "database",
    payment?.database ?? null,
    payment
      ? payment.database
        ? "Conectado · persistência"
        : "Banco indisponível"
      : "Não verificado",
  );
  const rabbitmq =
    payment?.rabbitmq === true || notification?.rabbitmq === true;
  const rabbitmqKnown = payment || notification;
  component(
    "rabbitmq",
    rabbitmqKnown ? rabbitmq : null,
    rabbitmq
      ? "Conectado · AMQP"
      : rabbitmqKnown
        ? "Sem conexão"
        : "Não verificado",
  );
  component(
    "notification",
    notification ? notification.status === "ok" : null,
    notification
      ? notification.status === "ok"
        ? "Operacional · consumidor"
        : "Serviço degradado"
      : "Sem resposta",
  );
  const healthy = payment?.status === "ok" && notification?.status === "ok";
  $("connection-warning").hidden = healthy;
  $("connection-warning").textContent = healthy
    ? ""
    : "Um ou mais serviços estão indisponíveis ou degradados. A tela preserva os últimos dados consultados e tenta atualizar automaticamente. Pagamentos e avisos podem levar mais tempo para aparecer.";
}

function badge(status) {
  const element = document.createElement("span");
  element.className =
    "status-badge " +
    (status === "SUCESSO" ? "status-success" : "status-pending");
  element.textContent = status;
  return element;
}

function cell(text) {
  const element = document.createElement("td");
  element.textContent = text;
  return element;
}

async function loadHistory() {
  const page = state.page;
  try {
    const result = await request(`/api/payment/payments?page=${page}&limit=10`);
    if (page !== state.page) return;
    const data = result.data;
    const body = $("history-body");
    body.replaceChildren();
    for (const payment of data) {
      const row = document.createElement("tr");
      row.classList.toggle("selected-row", payment.id === state.selectedId);
      const description = cell("");
      const name = document.createElement("strong");
      name.textContent = payment.customerName;
      const id = document.createElement("code");
      id.textContent = payment.id.slice(0, 8) + "…" + payment.id.slice(-4);
      description.append(name, id);
      row.append(description, cell(money.format(Number(payment.amount))));
      const status = cell("");
      status.append(badge(payment.status));
      row.append(status, cell(formatDate(payment.createdAt)));
      const action = cell("");
      const button = document.createElement("button");
      button.className = "row-button";
      button.type = "button";
      button.textContent = "↗";
      button.setAttribute("aria-label", `Ver transação ${payment.id}`);
      button.addEventListener("click", () => selectPayment(payment.id));
      action.append(button);
      row.append(action);
      body.append(row);
    }
    if (data.length === 0) {
      const row = document.createElement("tr");
      const empty = cell(
        "Nenhuma transação nesta página. Crie um pagamento para começar.",
      );
      empty.colSpan = 5;
      empty.className = "table-empty";
      row.append(empty);
      body.append(row);
    }
    $("history-count").textContent = data.length;
    $("page-number").textContent = `Página ${state.page}`;
    $("previous-page").disabled = state.page <= 1;
    $("next-page").disabled = data.length < 10;
    $("history-message").textContent =
      `Até 10 transações por página · ${formatDate(new Date().toISOString())}`;
  } catch {
    if (page !== state.page) return;
    $("history-message").textContent =
      "Histórico temporariamente indisponível. Dados anteriores preservados.";
    if (!$("history-body").querySelector("button")) {
      $("history-body").querySelector("td").textContent =
        "Não foi possível carregar o histórico. Nova tentativa em instantes.";
    }
  }
}

function step(id, done, active, time, fallback) {
  $(id).classList.toggle("done", done);
  $(id).classList.toggle("active", !done && active);
  $(id).querySelector(".step-marker").textContent = done
    ? "✓"
    : {
        "step-created": "1",
        "step-received": "2",
        "step-confirmed": "3",
        "step-notified": "4",
      }[id];
  $(id).querySelector(".step-meta").textContent = done
    ? formatDate(time)
    : fallback;
}

function renderSelection() {
  if (!state.payment) return;
  const payment = state.payment;
  const received = state.notifications.find(
    (event) => event.eventType === "SOLICITACAO_RECEBIDA",
  );
  const confirmed = state.notifications.find(
    (event) => event.eventType === "PAGAMENTO_CONFIRMADO",
  );
  const success = payment.status === "SUCESSO";
  $("tracking-empty").hidden = true;
  $("tracking-content").hidden = false;
  $("selected-id").textContent = payment.id;
  const status = $("selected-status");
  status.textContent = payment.status;
  status.className =
    "status-badge " + (success ? "status-success" : "status-pending");
  $("selected-amount").textContent =
    payment.amount !== undefined
      ? money.format(Number(payment.amount))
      : "Registrando…";
  $("selected-customer").textContent =
    payment.customerName || "Pagamento aceito";
  step("step-created", true, false, payment.createdAt, "");
  step(
    "step-received",
    Boolean(received),
    !received,
    received?.processedAt,
    "Aguardando consumo do evento",
  );
  step(
    "step-confirmed",
    success,
    !success,
    payment.updatedAt,
    "Aguardando processamento do worker",
  );
  step(
    "step-notified",
    Boolean(confirmed),
    success && !confirmed,
    confirmed?.processedAt,
    "Aguardando consumo do evento",
  );
  $("events-json").textContent = JSON.stringify(state.notifications, null, 2);
}

async function loadSelection() {
  if (!state.selectedId) return;
  const selectedId = state.selectedId;
  const [payment, notifications] = await Promise.allSettled([
    request(`/api/payment/payments/${selectedId}`),
    request(`/api/notification/notifications?paymentId=${selectedId}`),
  ]);
  // Respostas atrasadas de outra seleção não podem substituir a transação atual.
  if (state.selectedId !== selectedId) return;
  if (payment.status === "fulfilled") state.payment = payment.value;
  if (notifications.status === "fulfilled")
    state.notifications = notifications.value.data;
  renderSelection();
}

async function selectPayment(id) {
  state.selectedId = id;
  state.payment = null;
  state.notifications = [];
  $("tracking-empty").hidden = false;
  $("tracking-content").hidden = true;
  await Promise.all([loadSelection(), loadHistory()]);
  $("tracking-title").scrollIntoView({ block: "nearest", behavior: "smooth" });
}

async function refresh() {
  if (state.loading) return;
  state.loading = true;
  clearTimeout(timer);
  try {
    await Promise.all([loadHealth(), loadHistory(), loadSelection()]);
  } finally {
    state.loading = false;
    const pending =
      state.selectedId &&
      (state.payment?.status !== "SUCESSO" || state.notifications.length < 2);
    if (!document.hidden) timer = setTimeout(refresh, pending ? 1500 : 6000);
  }
}

$("payment-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (state.submitting) return;
  state.submitting = true;
  $("submit-payment").disabled = true;
  $("submit-label").textContent = "Registrando…";
  feedback("");
  const payload = {
    customerName: $("customer-name").value,
    customerEmail: $("customer-email").value,
    amount: Number($("amount").value),
    currency: "BRL",
  };
  try {
    const accepted = await request("/api/payment/payments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    state.selectedId = accepted.id;
    state.payment = { ...payload, ...accepted };
    state.notifications = [];
    state.page = 1;
    renderSelection();
    feedback("Pagamento aceito (HTTP 202). Acompanhe a confirmação ao lado.");
    await Promise.all([loadHistory(), loadSelection(), loadHealth()]);
  } catch (error) {
    // O POST nunca é reenviado automaticamente: timeout pode ocorrer após COMMIT.
    feedback(
      error.status === 400 || error.status === 429
        ? error.message
        : "Não foi possível confirmar a resposta. Consulte o histórico antes de reenviar: o pagamento pode ter sido registrado.",
      true,
    );
    await loadHistory();
  } finally {
    state.submitting = false;
    $("submit-payment").disabled = false;
    $("submit-label").textContent = "Criar pagamento";
    if (!state.loading) void refresh();
  }
});

$("refresh-history").addEventListener("click", () => {
  void refresh();
});
$("previous-page").addEventListener("click", () => {
  if (state.page > 1) {
    state.page--;
    void loadHistory();
  }
});
$("next-page").addEventListener("click", () => {
  state.page++;
  void loadHistory();
});
$("copy-id").addEventListener("click", async () => {
  try {
    if (!navigator.clipboard?.writeText)
      throw new Error("Sem clipboard em HTTP");
    await navigator.clipboard.writeText(state.selectedId);
    feedback("Identificador copiado.");
  } catch {
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents($("selected-id"));
    selection.removeAllRanges();
    selection.addRange(range);
    feedback(
      "Identificador selecionado. Use Ctrl+C ou o menu Copiar do navegador.",
    );
  }
});

document.addEventListener("visibilitychange", () => {
  if (document.hidden) clearTimeout(timer);
  else if (!state.loading) void refresh();
});

void refresh();
