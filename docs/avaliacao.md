# Roteiro para apresentar ao professor

Reserve cerca de 5–10 minutos. Use o README para instalação; este roteiro destaca o que observar.

## Demonstração rápida no Chrome

Abra `http://localhost:8088` localmente ou o endereço da VPS registrado em [vps.md](vps.md). A página já mostra a saúde de Pagamento, PostgreSQL, RabbitMQ e Notificação. Os campos têm valores fictícios prontos: clique em **Criar pagamento**, observe `PENDENTE → SUCESSO`, os quatro passos e os dois avisos em **Ver os eventos recebidos**. Selecione uma transação no histórico para consultar novamente. O professor não precisa instalar programas para acessar essa demonstração hospedada.

A prova por navegador complementa a entrega do código. O link do repositório com instruções continua obrigatório no AVA; não substitua esse link pelo endereço da demonstração.

## 1. Mostrar a separação

Abra as pastas `payment-service` e `notification-service`: cada uma possui código, pacote npm e Dockerfile próprios. Execute `docker compose ps` e mostre os cinco contêineres saudáveis, incluindo a interface. Notificação não recebe credenciais PostgreSQL e só depende do RabbitMQ no Compose.

## 2. Demonstrar o fluxo

Abra `requests/payments.http` com REST Client ou use o exemplo PowerShell do README. Mantenha outro terminal com:

```bash
docker compose logs -f payment-service notification-service
```

Crie um pagamento. Mostre o HTTP 202 com `PENDENTE` e o `id`; consulte imediatamente e novamente após aproximadamente 2 s. A consulta posterior apresenta `SUCESSO`. Uma consulta imediata pode já mostrar `SUCESSO` se o avaliador demorar a executá-la; isso não altera o estado inicial aceito no POST.

Nos logs, localize o mesmo `paymentId` e os dois `eventId`: primeiro `SOLICITACAO_RECEBIDA`, depois `PAGAMENTO_CONFIRMADO`. Consulte `http://localhost:3001/notifications?paymentId=ID` para ver os avisos persistidos. O envio ao usuário é simulado por esses avisos/logs, conforme permitido pelo enunciado.

Confirme a persistência diretamente no PostgreSQL:

```bash
docker compose exec postgres psql -U compre_facil -d payments -c "SELECT id,amount,status,created_at,updated_at FROM payments ORDER BY created_at DESC LIMIT 5;"
docker compose exec postgres psql -U compre_facil -d payments -c "SELECT payment_id,event_type,published_at FROM outbox ORDER BY sequence DESC LIMIT 10;"
```

Se personalizar credenciais no `.env`, adapte usuário/banco nesses comandos.

## 3. Demonstrar independência e tolerância a falhas

1. Execute `docker compose stop notification-service`.
2. Crie novo pagamento: continua recebendo 202 e chegando a `SUCESSO`.
3. Abra `http://localhost:15672`, com as credenciais locais do README, e mostre as duas mensagens prontas em `payments.notifications`, sem consumidor.
4. Execute `docker compose start notification-service`.
5. Mostre os dois avisos nos logs/histórico e a fila sendo esvaziada.

A aprovação não espera a Notificação. Para demonstrar a independência inversa, `docker compose stop payment-service` mantém `GET http://localhost:3001/health` funcionando; depois use `docker compose start payment-service`.

## 4. Mostrar os testes e a confiabilidade

```bash
npm run setup
npm test
npm run test:integration
npm run test:failures
```

Execute as suítes sequencialmente. A última interrompe infraestrutura e demora mais; durante uma apresentação curta, prefira mostrar o resultado já salvo em `docs/evidencias/` e executar apenas o cenário manual anterior. As filas `.dead` conterão mensagens propositalmente inválidas após os testes; são evidências de erro controlado, não falhas inesperadas.

Explique três decisões: outbox atômica evita gravar pagamento sem evento; publisher confirm e ack manual tratam entrega; `eventId UNIQUE` em SQLite evita duplicação após reiniciar Notificação. Mostre a suíte que testa esses comportamentos. Não chame logs de envio real de e-mail nem prometa alta disponibilidade de um broker único.

## Matriz de aceitação

| Critério solicitado | Implementação / evidência |
|---|---|
| Dois microsserviços Node.js separados | Pastas, packages, imagens e processos distintos |
| Serviços independentes | Testes com cada serviço parado e consumo da Notificação sem Pagamento |
| PostgreSQL funcional | SQL real, constraints, consulta e rollback testados |
| RabbitMQ funcional | AMQP real, exchange e filas verificadas |
| Docker Compose funcional | Build e execução dos cinco contêineres saudáveis |
| API REST operacional | POST, consulta, listagem, saúde e erros testados |
| Registro inicial PENDENTE | Resposta 202 e consulta SQL imediata em integração |
| Comunicação AMQP real | Filas reais e publisher confirms |
| Publicação SOLICITACAO_RECEBIDA | Outbox e log com eventId |
| Consumo da solicitação | Registro durável e log de Notificação |
| Confirmação simulada | Worker AMQP com latência configurável |
| Atualização SUCESSO | SQL e GET comprovados |
| Publicação PAGAMENTO_CONFIRMADO | Outbox e log do segundo eventId |
| Consumo da confirmação | Segundo aviso persistido |
| Processamento assíncrono | HTTP 202 antes da aprovação; recuperação de tarefa após SIGKILL |
| Durabilidade e ack | Mensagens sobrevivem a reinício do RabbitMQ; ack após processamento |
| Tratamento de erros | Validação, retries limitados, filas .dead, saúde degradada, reconexão |
| Testes automatizados | `npm test`, `test:integration` e `test:failures` |
| README completo | Instalação, diagrama, API, testes, recuperação e resultados |
| Preparado para GitHub | `.gitignore`, lockfiles, documentação, CI e instruções de publicação |

Os requisitos de desenvolvimento foram implementados e verificados. O link do repositório para enviar no AVA é **https://github.com/HironNovais/CompreFacil**, conforme [github.md](github.md). A demonstração pública complementa a entrega do código.
