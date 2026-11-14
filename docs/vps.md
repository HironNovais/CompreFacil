# Demonstração pelo navegador na VPS

Endereço publicado e validado em **14/11/2026**: **http://187.127.6.251:8088**. Localmente, com o Compose da raiz, use **http://localhost:8088**.

## O que o professor consegue ver

Abra o endereço no Chrome, mantenha os dados fictícios de exemplo e clique em **Criar pagamento**. A resposta HTTP 202 inicia o acompanhamento: registro no PostgreSQL, consumo do primeiro aviso, confirmação pelo worker e consumo do segundo aviso. O estado passa de PENDENTE para SUCESSO. Abra **Ver os eventos recebidos** para examinar os avisos e seus eventIds; selecione outra transação no histórico para consultar novamente.

O acesso público não exige Docker, Node, terminal ou instalação de extensões. O processamento é real entre os contêineres; a aprovação financeira e os avisos ao usuário são simulados. Nenhum e-mail, SMS ou WhatsApp é enviado. Use somente dados fictícios: esta é uma demonstração pública, sem login.

## Separação da Sala Privada

- Projeto Compose exclusivo: `compre-facil-demo`.
- Rede exclusiva: `compre-facil-demo_default`, sem conexão às redes da Sala Privada.
- PostgreSQL, RabbitMQ e SQLite com volumes próprios e sem dados copiados de outro sistema.
- Credenciais aleatórias geradas no servidor em `/opt/compre-facil-distribuido/shared/runtime.env`, com permissão 600. Esse arquivo não é incluído no código ou nas evidências.
- Somente o Nginx publica uma porta: TCP 8088. Banco, broker e APIs não têm portas públicas nessa instalação.
- Limites: PostgreSQL 256 MiB/0,35 CPU; RabbitMQ 384 MiB/0,40 CPU; Pagamento 160 MiB/0,25 CPU; Notificação 128 MiB/0,20 CPU; web 64 MiB/0,10 CPU. A soma dos limites de memória é **992 MiB**; não representa consumo efetivo constante.
- Logs Docker com rotação de 5 MB e dois arquivos por serviço. O gateway limita criação de pagamentos a 10 POSTs/minuto por IP, com burst de 3.

O host e seus recursos físicos continuam compartilhados: essa separação não garante disponibilidade independente diante de falha da própria VPS. A instalação não altera o proxy das portas 80/443 nem os contêineres da Sala Privada.

## Firewall específico da porta 8088

A VPS possui uma cadeia de firewall que restringe o acesso direto ao origin nas portas de destino 80/443. Como Docker traduz `8088 → 80` antes da cadeia `DOCKER-USER`, foi necessária uma exceção que identifica **somente a porta original 8088**, via conntrack. A cadeia de proteção da Sala Privada e suas regras de 80/443 foram preservadas. Esse comportamento de DNAT é explicado na [documentação oficial do Docker](https://docs.docker.com/engine/network/firewall-iptables/).

`deploy/firewall-vps.sh` mantém essa única regra, identificada pelo comentário `compre-facil-demo-8088`. O arquivo foi instalado em `/opt/compre-facil-distribuido/shared/firewall-vps.sh`; a unidade `compre-facil-demo-firewall.service` foi instalada e habilitada para reaplicá-la após Docker iniciar. Não houve reboot do servidor para testar a sequência de inicialização.

Para uma instalação nova nessa VPS, além do instalador de contêineres, copie os dois arquivos de firewall aos caminhos abaixo e ative a unidade:

```bash
# Executar como root, a partir da cópia dos arquivos do projeto:
install -m 700 deploy/firewall-vps.sh /opt/compre-facil-distribuido/shared/firewall-vps.sh
install -m 644 deploy/compre-facil-demo-firewall.service /etc/systemd/system/compre-facil-demo-firewall.service
systemctl daemon-reload
systemctl enable --now compre-facil-demo-firewall.service
```

Para remover somente essa exceção, use `systemctl disable --now compre-facil-demo-firewall.service`. A unidade remove sua regra em `ExecStop`, sem limpar outras regras ou reiniciar Docker.

## Arquivos de operação

`deploy/vps-compose.yml` define a topologia específica do servidor, sem as portas de desenvolvimento. `deploy/install-vps.sh` instala uma release já transferida para a área exclusiva da aplicação, gera as credenciais na primeira execução, espera a prontidão e atualiza o link `current` depois das verificações HTTP locais.

```text
/opt/compre-facil-distribuido/
├── releases/<identificador>/   código de cada release
├── shared/runtime.env         credenciais exclusivas, não versionadas
├── shared/deploy-*.log         resultado de instalação
└── current -> releases/<identificador-validado>
```

Como administrador com SSH autorizado, conferir estado:

```bash
ssh root@187.127.6.251
cd /opt/compre-facil-distribuido/current
docker compose --project-name compre-facil-demo --env-file /opt/compre-facil-distribuido/shared/runtime.env -f deploy/vps-compose.yml ps
docker logs --tail 30 compre-facil-demo-payment-service-1
docker logs --tail 30 compre-facil-demo-notification-service-1
```

Parar somente esta demonstração, preservando os volumes:

```bash
docker compose --project-name compre-facil-demo --env-file /opt/compre-facil-distribuido/shared/runtime.env -f deploy/vps-compose.yml stop
```

Iniciar novamente:

```bash
docker compose --project-name compre-facil-demo --env-file /opt/compre-facil-distribuido/shared/runtime.env -f deploy/vps-compose.yml up -d --wait --wait-timeout 180
```

Não execute os testes locais de interrupção contra os projetos da Sala Privada. Não use `down -v` para uma parada: ele elimina os dados da demonstração. O histórico e a outbox permanecem nos volumes e não são apagados ao recriar os contêineres.

## Publicação e acesso

O endereço usa **HTTP por IP**, conforme a preferência escolhida; o Chrome pode indicar conexão não segura. Não inserir informações sensíveis ou de clientes reais. Um subdomínio com certificado pode ser acrescentado posteriormente, se desejado.

O repositório para entrega é **https://github.com/HironNovais/CompreFacil**. A entrega acadêmica do PDF exige **o link do repositório com código e instruções no AVA**; inclua o endereço da demonstração como complemento. A submissão no AVA continua sendo uma etapa do aluno.

As evidências da validação pública e da comparação com os serviços existentes são registradas em `docs/evidencias/`, separadas dos testes de desenvolvimento local.

## Validação observada

- Cinco contêineres da demonstração saudáveis, respeitando os limites configurados.
- **Dois testes públicos de navegador aprovados**, desktop e mobile simulado: POST 202, estado final SUCESSO e dois avisos persistidos. As requisições atravessaram o IP público e a porta 8088, a partir da estação local.
- **32 arquivos da release verificados por SHA-256 no servidor**, sem divergências em relação ao pacote transferido; assets públicos comparados com os arquivos locais.
- Os **21 contêineres preexistentes** da Sala Privada/homologação mantiveram os mesmos IDs. A API interna de saúde e o site público da Sala Privada responderam HTTP 200 depois da instalação. Não foram executadas alterações em seus bancos de dados ou processos.
- O snapshot de recursos durante a verificação apontou aproximadamente **150 MiB** somando os cinco contêineres; trata-se de uma observação pontual, não uma estimativa de capacidade sob carga.

Relatórios: [validação pública](evidencias/vps-validacao.json), [testes no navegador](evidencias/vps-interface-testes.txt), [captura desktop](evidencias/vps-desktop.png) e [captura mobile](evidencias/vps-mobile.png).
