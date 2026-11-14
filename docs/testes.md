# Validação executada

Data: **14/11/2026**, fuso de apresentação `America/Sao_Paulo`; os logs registram instantes em UTC. Ambiente: Windows, PowerShell, Docker Desktop com contêineres Linux. As versões efetivas do runtime, PostgreSQL, RabbitMQ e Compose estão em [evidencias/fluxo-real.json](evidencias/fluxo-real.json).

## Resultado consolidado

| Comando executado | Resultado observado |
|---|---|
| `npm run setup` | Instalação reproduzível pelos lockfiles dos dois serviços; nenhuma vulnerabilidade reportada pelo npm no momento da instalação |
| `npm run check` | 22 arquivos JavaScript na etapa original; 25 após acrescentar a interface |
| `docker compose config --quiet` | Configuração aceita, código de saída 0 |
| `docker compose up --build -d` | Quatro serviços na etapa original; quinto contêiner web acrescentado depois |
| `docker compose ps` | PostgreSQL, RabbitMQ, Pagamento, Notificação e, na evolução, web com estado healthy |
| `npm test` | **29 testes passaram**, zero falhas, zero ignorados |
| `npm run test:integration` | **7 testes passaram**, zero falhas, zero ignorados; PostgreSQL e RabbitMQ reais |
| `npm run test:failures` | **8 testes passaram**, zero falhas, zero ignorados; interrupções reais dos serviços do Compose |

Total da etapa original: **44 testes automatizados aprovados**. Esses relatórios foram registrados antes da publicação do código; o resultado posterior do GitHub Actions deve ser consultado na [aba Actions](https://github.com/HironNovais/CompreFacil/actions). A instalação posterior em Linux na VPS é descrita abaixo; não houve teste de alta disponibilidade, carga, envio externo ou pagamentos financeiros reais.

## Evolução com interface web

A etapa posterior acrescentou uma interface responsiva e um quinto contêiner Nginx. Os 29 testes de unidade/API foram reexecutados e passaram. O código dos dois microsserviços e seu protocolo AMQP permaneceram sem alteração; os 7 testes de integração e 8 de falhas acima pertencem à execução anterior documentada.

Foram executados **10 testes adicionais de navegador** com Playwright/Chromium, cinco em desktop e cinco em dispositivo móvel simulado: pagamento real com dois avisos, validação de valor zero, apresentação segura de conteúdo HTML digitado, sinalização de saúde degradada e ausência de reenvio automático de POST após resposta incerta. Os cenários de degradação/resposta incerta interceptam respostas somente no navegador; os testes de falha da etapa anterior interromperam serviços reais.

Os 10 passaram, sem erros JavaScript no fluxo de pagamento, com verificações de cabeçalhos e ausência de rolagem horizontal indevida. Resultado completo: [interface-testes.txt](evidencias/interface-testes.txt). Capturas: [desktop](evidencias/interface-desktop.png) e [mobile](evidencias/interface-mobile.png). São **54 casos automatizados distintos** documentados entre as etapas; não significa que todas as suítes tenham sido reexecutadas simultaneamente.

Para reproduzir a suíte visual:

```bash
npm ci
npx playwright install chromium
docker compose up --build --wait --wait-timeout 120
npm run test:ui
```

O Compose de desenvolvimento e o Compose específico da VPS foram validados separadamente. Resultados da instalação Linux e do acesso público são registrados em [vps.md](vps.md) e nas evidências dessa instalação; não se confundem com a execução de GitHub Actions.

Na VPS, os dois cenários de pagamento real da suíte visual foram reexecutados pelo **IP público**, com desktop e mobile simulado, e passaram. São repetições públicas desses casos, não dois casos inéditos que aumentariam o total de 54. A verificação comparou também integridade de arquivos e os contêineres existentes da Sala Privada.

Saídas completas: [unitários/API](evidencias/unitarios.txt), [integração](evidencias/integration.txt), [falhas](evidencias/failures.txt). O script `npm run evidence` cria **outro pagamento simulado real** e atualiza o [snapshot de ponta a ponta](evidencias/fluxo-real.json) e os [logs correspondentes](evidencias/fluxo-real.log.txt); ele não reexecuta nem altera os relatórios das suítes.

## Cenários, procedimentos e resultados

| Cenário | Procedimento / comando | Resultado esperado | Resultado observado |
|---|---|---|---|
| Campos obrigatórios ausentes | POST vazio, nome vazio e e-mail inválido nos testes de API | 400 sem persistência | 400; repositório não chamado |
| Valores inválidos | Zero, negativo, string, subcentavo, mais de duas casas, valor acima do limite e moeda diferente de BRL | 400 | Entradas rejeitadas; centavos válidos aceitos |
| Resposta inicial | POST válido e SELECT imediato em PostgreSQL | 202 e registro PENDENTE antes da simulação | 202 PENDENTE; SQL PENDENTE e amount 150.29 |
| Processamento assíncrono real | POST seguido de polling por GET | SUCESSO posteriormente | Estado alterado e instantes persistidos |
| Evento de solicitação | SELECT outbox e consumo de `payments.notifications` | SOLICITACAO_RECEBIDA publicado e aviso registrado | eventId e aviso de recebimento presentes |
| Evento de confirmação | SELECT outbox e histórico após SUCESSO | PAGAMENTO_CONFIRMADO depois da solicitação | Dois tipos na sequência esperada e dois avisos |
| Atomicidade SQL | Criar pelo repositório com valor proibido por constraint | ROLLBACK sem pagamento parcial | Nenhuma linha para o cliente de teste |
| Falha de publicação | Publisher rejeitado em teste de outbox | Não marcar published_at e executar ROLLBACK | UPDATE de publicação não executado; rollback comprovado |
| Confirmação concorrente | Três chamadas simultâneas do repositório para um pagamento | Uma transição e um evento de confirmação | Um resultado de alteração e uma linha de confirmação |
| Mensagem duplicada | Publicar cada evento três vezes adicionais via AMQP | Manter somente dois avisos | Dois registros no histórico; duplicatas ignoradas |
| Idempotência após reiniciar | Reiniciar Notificação e republicar os mesmos eventos | Não duplicar avisos | Dois registros preservados após reinício |
| Evento inválido | Publicar tipo desconhecido diretamente na fila | Quarentena sem loop | Contagem de `payments.notifications.dead` aumentou em um |
| Falha persistente no worker | Evento válido com paymentId inexistente | Três retries e depois quarentena | `payments.processing.dead` recebeu a mensagem após esgotar tentativas |
| Ack e nack | Testes do consumidor com falha ao transferir | Ack após processamento/confirm; nack requeue se cópia não confirmada | Ordem das operações e nack verificados |
| Transação inexistente | GET com UUID válido não cadastrado | 404 | 404; UUID malformado retorna 400 |
| Paginação e erros HTTP | GET page/limit e POST JSON malformado | Limites válidos; 400 para entradas incorretas | Offset e limite corretos; inválidos rejeitados |
| Notificação indisponível | `docker compose stop notification-service`; criar e consultar pagamento | Pagamento aprova; dois eventos ficam na fila | SUCESSO com duas mensagens e zero consumidores; avisos consumidos ao iniciar |
| Pagamento indisponível | Parar Pagamento e publicar novo evento AMQP direto | Notificação saudável e consumindo sem a outra API | Health 200 e novo aviso persistido |
| RabbitMQ indisponível | Parar RabbitMQ, criar pagamento, inspecionar outbox e iniciar broker | PENDENTE e published_at NULL; recuperar depois | API aceitou; reconexão levou a SUCESSO e dois avisos |
| Morte do processo no trabalho | SIGKILL após publicação e antes de confirmar; iniciar Pagamento | Tarefa recuperada e aprovada uma vez | Estado ainda PENDENTE após kill; depois SUCESSO e um evento de confirmação |
| PostgreSQL indisponível | Parar PostgreSQL e fazer POST válido | 503 no Pagamento; Notificação permanece saudável | 503 e Notificação 200; Pagamento recuperou sem recriação |
| Persistência do histórico | `up -d --force-recreate payment-service notification-service` | Pagamento e avisos mantidos em volumes | SUCESSO e dois registros preservados |
| Persistência do broker | Parar Notificação, concluir pagamento, reiniciar RabbitMQ e iniciar Notificação | Mensagens persistentes sobrevivem e são consumidas | Pelo menos duas mensagens mantidas; os dois avisos do pagamento foram registrados |

Os testes que manipulam os serviços fazem restauração em blocos `finally`; execute a suíte isoladamente. Dados simulados e filas de erro permanecem no ambiente para inspeção, sem limpeza destrutiva automática.

## Como reproduzir

```bash
docker compose up --build --wait --wait-timeout 120
npm run setup
npm run check
npm test
npm run test:integration
npm run test:failures
npm run evidence
docker compose ps
```

Mantenha `PROCESSING_DELAY_MS=1500`, o padrão, para que o teste de consulta imediata e a morte do processo durante trabalho tenham a janela observável esperada. Execute as suítes sequencialmente; não envie outros pagamentos durante as medições das filas. Se mudar portas ou credenciais, mantenha `.env` raiz consistente com o Compose; os helpers de integração leem esse arquivo.

O comando de falhas atua apenas no projeto Compose deste diretório e não remove volumes. A interrupção de PostgreSQL gera propositalmente desconexões `57P01`, tratadas tanto pela aplicação quanto pelo pool da suíte. Logs `message_retry`, `message_dead_lettered`, `amqp_error` e `database_pool_error` são esperados nos respectivos cenários induzidos.

## Limites da evidência

Os snapshots comprovam esta execução e não substituem uma reprodução pelo avaliador. Mensagens em filas `.dead` são erros sintéticos; não representam pagamentos reais. Aviso persistido/log não é prova de envio de e-mail ou mensagem externa. `SUCESSO` significa exclusivamente confirmação simulada. A retomada de RabbitMQ e processos foi testada; perda de disco, cluster e desastre completo não foram testados.
