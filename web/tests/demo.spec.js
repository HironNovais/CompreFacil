import { test, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";

test("Pagamento real pela interface chega a SUCESSO e mostra os dois avisos", async ({
  page,
}, info) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const documentResponse = await page.goto("/");
  expect(documentResponse.headers()["content-security-policy"]).toContain("default-src 'self'");
  await expect(page.locator("#health-payment")).toContainText("Operacional");
  await expect(page.locator("#health-notification")).toContainText(
    "Operacional",
  );
  await page
    .getByLabel("Nome do cliente")
    .fill(`Professor ${info.project.name}`);
  const responsePromise = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/payment/payments") &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Criar pagamento" }).click();
  const response = await responsePromise;
  expect(response.status()).toBe(202);
  const accepted = await response.json();
  expect(accepted.status).toBe("PENDENTE");
  await expect(page.locator("#selected-id")).toHaveText(accepted.id);
  await expect(page.locator("#selected-status")).toHaveText("SUCESSO", {
    timeout: 15000,
  });
  await expect(page.locator("#step-received")).toHaveClass(/done/);
  await expect(page.locator("#step-notified")).toHaveClass(/done/, {
    timeout: 15000,
  });
  await page.locator(".event-details summary").click();
  await expect(page.locator("#events-json")).toContainText(
    "SOLICITACAO_RECEBIDA",
  );
  await expect(page.locator("#events-json")).toContainText(
    "PAGAMENTO_CONFIRMADO",
  );
  const records = JSON.parse(await page.locator("#events-json").textContent());
  expect(records).toHaveLength(2);
  expect(records.every((record) => record.paymentId === accepted.id)).toBe(
    true,
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
  mkdirSync("artifacts", { recursive: true });
  await page.screenshot({
    path: `artifacts/ui-${info.project.name}.png`,
    fullPage: true,
  });
  console.log(
    JSON.stringify({
      evidence: "browser_payment",
      project: info.project.name,
      paymentId: accepted.id,
      events: records.length,
    }),
  );
});

test("Validação do formulário impede envio de valor zero", async ({ page }) => {
  await page.goto("/");
  let submitted = 0;
  page.on("request", (request) => {
    if (request.method() === "POST") submitted++;
  });
  await page.getByLabel("Valor do pagamento").fill("0");
  await page.getByRole("button", { name: "Criar pagamento" }).click();
  expect(
    await page
      .getByLabel("Valor do pagamento")
      .evaluate((input) => input.validity.rangeUnderflow),
  ).toBe(true);
  expect(submitted).toBe(0);
});

test("Conteúdo digitado é exibido como texto, sem executar HTML", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("Nome do cliente").fill("<img src=x onerror=alert(1)>");
  await page.getByRole("button", { name: "Criar pagamento" }).click();
  await expect(page.locator("#selected-customer")).toHaveText(
    "<img src=x onerror=alert(1)>",
  );
  await expect(page.locator("#history-body")).toContainText(
    "<img src=x onerror=alert(1)>",
  );
  expect(await page.locator('img[src="x"]').count()).toBe(0);
});

test("Degradação de serviço aparece na tela sem inventar estado do banco", async ({
  page,
}) => {
  await page.route("**/api/payment/health", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        service: "payment-service",
        status: "degraded",
        database: true,
        rabbitmq: false,
      }),
    }),
  );
  await page.goto("/");
  await expect(page.locator("#health-payment")).toHaveText("Serviço degradado");
  await expect(page.locator("#health-database")).toContainText("Conectado");
  await expect(page.locator("#connection-warning")).toBeVisible();
});

test("Resposta incerta não reenvia POST automaticamente", async ({ page }) => {
  let submitted = 0;
  await page.route("**/api/payment/payments", async (route) => {
    if (route.request().method() === "POST") {
      submitted++;
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "Falha simulada de resposta" }),
      });
    } else await route.continue();
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Criar pagamento" }).click();
  await expect(page.locator("#form-feedback")).toContainText(
    "Consulte o histórico antes de reenviar",
  );
  await expect(
    page.getByRole("button", { name: "Criar pagamento" }),
  ).toBeEnabled();
  await page.waitForTimeout(1800);
  expect(submitted).toBe(1);
});
