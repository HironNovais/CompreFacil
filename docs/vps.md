# Demonstração pelo navegador na VPS

Endereço HTTPS validado em **14/11/2026**: **https://probability-vid-calvin-jersey.trycloudflare.com**. Localmente, com o Compose da raiz, use **http://localhost:8088**.

O endereço público é um **Quick Tunnel gratuito e temporário**. Ele pode mudar se o conector reiniciar e não possui garantia de disponibilidade. A porta 8088 da VPS está vinculada somente a `127.0.0.1`; a demonstração não aceita mais acesso direto externo por essa porta.

## O que o professor consegue ver

Abra o endereço no Chrome, mantenha os dados fictícios de exemplo e clique em **Criar pagamento**. A resposta HTTP 202 inicia o acompanhamento: registro no PostgreSQL, consumo do primeiro aviso, confirmação pelo worker e consumo do segundo aviso. O estado passa de PENDENTE para SUCESSO. Abra **Ver os eventos recebidos** para examinar os avisos e seus eventIds; selecione outra transação no histórico para consultar novamente.

O acesso público não exige Docker, Node, terminal ou instalação de extensões. O processamento é real entre os contêineres; a aprovação financeira e os avisos ao usuário são simulados. Nenhum e-mail, SMS ou WhatsApp é enviado. Use somente dados fictícios: esta é uma demonstração pública, sem login.

## Separação da Sala Privada

- Projeto Compose exclusivo: `compre-facil-demo`.
- Rede exclusiva: `compre-facil-demo_default`, sem conexão às redes da Sala Privada.
- PostgreSQL, RabbitMQ e SQLite com volumes próprios e sem dados copiados de outro sistema.
- Credenciais aleatórias geradas no servidor em `/opt/compre-facil-distribuido/shared/runtime.env`, com permissão 600. Esse arquivo não é incluído no código ou nas evidências.
- Nginx vinculado somente à porta local `127.0.0.1:8088`. Banco, broker, APIs e conector não publicam portas externas.
- Limites: PostgreSQL 256 MiB/0,35 CPU; RabbitMQ 384 MiB/0,40 CPU; Pagamento 160 MiB/0,25 CPU; Notificação 128 MiB/0,20 CPU; web 64 MiB/0,10 CPU; conector 96 MiB/0,15 CPU. A soma dos limites é **1.088 MiB**, diferente do consumo efetivo.
- Logs Docker com rotação de 5 MB e dois arquivos por serviço. Pelo túnel, o gateway enxerga o endereço interno do conector: o limite de 10 POSTs/minuto, com burst de 3, é compartilhado entre os visitantes dessa rota.

O host e seus recursos físicos continuam compartilhados: essa separação não garante disponibilidade independente diante de falha da própria VPS. A instalação não altera o proxy das portas 80/443 nem os contêineres da Sala Privada.

## Túnel HTTPS e fechamento do acesso direto

`deploy/tunnel-compose.yml` acrescenta o conector `cloudflared` à rede exclusiva da demonstração. Ele cria uma conexão de saída para Cloudflare e encaminha o endereço HTTPS ao Nginx interno `http://web:80`. Nenhum redirecionamento HTTP para o IP da VPS é usado.

Após verificar o túnel, `WEB_BIND` foi alterado para `127.0.0.1`, somente o contêiner web foi recriado e a unidade legada `compre-facil-demo-firewall.service` foi desativada. Sua exceção de firewall para 8088 foi removida. As regras da Sala Privada para 80/443 foram preservadas.

Na instalação atual, o arquivo adicional fica em `/opt/compre-facil-distribuido/shared/tunnel-compose.yml`. Para uma instalação nova, inicie os serviços da aplicação e acrescente o arquivo de túnel:

```bash
# A partir da raiz do projeto, usando o arquivo de credenciais privado:
docker compose --project-name compre-facil-demo --env-file /CAMINHO/PRIVADO/runtime.env -f deploy/vps-compose.yml -f deploy/tunnel-compose.yml up -d
docker logs --tail 60 compre-facil-demo-tunnel-1
```

Os logs mostram o endereço `https://...trycloudflare.com`. Não ative os arquivos legados de exceção de firewall nesse modo; eles permanecem somente como referência da instalação anterior.

Segundo a [documentação oficial de Quick Tunnels](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/), qualquer pessoa com o link pode acessar, o hostname muda ao recriar o túnel e não há garantia de disponibilidade. Não foi configurada autenticação por e-mail ou senha.

O túnel evita mostrar o endereço de origem no link e fecha a entrada direta da demonstração. Ele **não altera o IP da VPS** nem apaga divulgações anteriores. O IP apareceu em commits anteriores deste repositório e continua recuperável no histórico Git. Os arquivos atuais foram atualizados para não divulgá-lo, sem reescrever o histórico público.

## Arquivos de operação

`deploy/vps-compose.yml` define a topologia específica do servidor, sem as portas de desenvolvimento. `deploy/install-vps.sh` instala uma release já transferida para a área exclusiva da aplicação, gera as credenciais na primeira execução, espera a prontidão e atualiza o link `current` depois das verificações HTTP locais.

```text
/opt/compre-facil-distribuido/
├── releases/<identificador>/   código de cada release
├── shared/runtime.env         credenciais exclusivas, não versionadas
├── shared/tunnel-compose.yml  conector da demonstração
├── shared/deploy-*.log         resultado de instalação
└── current -> releases/<identificador-validado>
```

Como administrador com SSH autorizado, conferir estado:

```bash
ssh root@IP_DA_SUA_VPS
cd /opt/compre-facil-distribuido/current
cf_demo() { docker compose --project-name compre-facil-demo --env-file /opt/compre-facil-distribuido/shared/runtime.env -f deploy/vps-compose.yml -f /opt/compre-facil-distribuido/shared/tunnel-compose.yml "$@"; }
cf_demo ps
docker logs --tail 30 compre-facil-demo-payment-service-1
docker logs --tail 30 compre-facil-demo-notification-service-1
```

Parar somente esta demonstração, preservando os volumes:

```bash
cf_demo stop
```

Iniciar novamente:

```bash
cf_demo up -d --wait --wait-timeout 180
cf_demo logs --tail 60 tunnel
```

Não execute os testes locais de interrupção contra os projetos da Sala Privada. Não use `down -v` para uma parada: ele elimina os dados da demonstração. O histórico e a outbox permanecem nos volumes e não são apagados ao recriar os contêineres.

Os comandos `cf_demo` pressupõem que a função acima foi definida no terminal. Reiniciar o conector pode gerar outro endereço: atualize o README e o link enviado ao professor. A URL é temporária mesmo com política de reinicialização do contêiner.

## Publicação e acesso

O endereço público agora usa **HTTPS pelo túnel**, conforme a preferência escolhida. Não inserir informações sensíveis ou de clientes reais. Para um endereço estável, é necessário configurar um domínio/subdomínio e um túnel gerenciado.

O repositório para entrega é **https://github.com/HironNovais/CompreFacil**. A entrega acadêmica do PDF exige **o link do repositório com código e instruções no AVA**; inclua o endereço da demonstração como complemento. A submissão no AVA continua sendo uma etapa do aluno.

As evidências da validação pública e da comparação com os serviços existentes são registradas em `docs/evidencias/`, separadas dos testes de desenvolvimento local.

## Validação observada

- Cinco contêineres da demonstração saudáveis, respeitando os limites configurados.
- **Dois testes públicos de navegador aprovados**, desktop e mobile simulado: POST 202, estado final SUCESSO e dois avisos persistidos. As requisições atravessaram o IP público e a porta 8088, a partir da estação local.
- **32 arquivos da release verificados por SHA-256 no servidor**, sem divergências em relação ao pacote transferido; assets públicos comparados com os arquivos locais.
- Os **21 contêineres preexistentes** da Sala Privada/homologação mantiveram os mesmos IDs. A API interna de saúde e o site público da Sala Privada responderam HTTP 200 depois da instalação. Não foram executadas alterações em seus bancos de dados ou processos.
- O snapshot de recursos durante a verificação apontou aproximadamente **150 MiB** somando os cinco contêineres; trata-se de uma observação pontual, não uma estimativa de capacidade sob carga.

Os itens acima registram a instalação original, cujo endereço de origem foi omitido dos arquivos atuais. A validação posterior ao túnel consta em [tunnel-validacao.json](evidencias/tunnel-validacao.json) e [tunnel-testes.txt](evidencias/tunnel-testes.txt): dois testes completos pelo HTTPS, acesso direto externo a 8088 bloqueado e verificação de que os contêineres da Sala Privada permaneceram os mesmos.

Relatórios: [validação pública](evidencias/vps-validacao.json), [testes no navegador](evidencias/vps-interface-testes.txt), [captura desktop](evidencias/vps-desktop.png) e [captura mobile](evidencias/vps-mobile.png).
